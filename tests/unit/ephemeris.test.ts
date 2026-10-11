// tests/unit/ephemeris.test.ts — the propagation-worker client (M3 step 11, README sections 5 and 6).
// Part 1 scripts the worker's replies; part 2 runs the real worker module in-process (messages structured-cloned with
// transfer, so sent buffers detach as in a browser) on the committed snapshot and checks the e2e numbers.
import { readFileSync } from "node:fs";
import { eciToGeodetic, gstime, json2satrec, propagate } from "satellite.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import { angularSeparationDeg, enuToAzAltDeg, type ObserverSite } from "../../src/domain/geo";
import {
  createPropagationContext,
  ISS_NORAD_ID,
  parseGpFile,
  SAMPLE_STRIDE,
  writeSample,
} from "../../src/domain/orbits";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import type {
  CatalogDelta,
  PropagationIn,
  PropagationOut,
  SkyPathOut,
  TrackOut,
} from "../../src/workers/protocol";
import { committedCameras, storeAt } from "../helpers/store";

const T_PASS_ISO = "2026-10-11T15:09:50Z"; // ISS at az 123.8°, apparent alt 28.9°, sunlit, Sun at −16.2°
const T_PASS = Date.parse(T_PASS_ISO);
const SNAPSHOT_MS = 1791690621000;
const APP_HREF = "http://localhost:4173/Overhead/";
const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const gpUrl = (group: string): string =>
  new URL(`${import.meta.env.BASE_URL}data/gp/${group}.json`, APP_HREF).href;

// ---- a Worker stand-in

type Handler = (msg: PropagationIn, transfer: Transferable[]) => void;

/** One Worker per test. `onPost` sees what the main thread sends; `reply` sends to the main thread. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: string;
  readonly options: WorkerOptions | undefined;
  readonly sent: PropagationIn[] = [];
  terminated = false;
  onPost: Handler = () => undefined;
  private readonly listeners = new Map<string, Set<(e: Event) => void>>();

  constructor(url: URL | string, options?: WorkerOptions) {
    this.url = String(url);
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(msg: PropagationIn, transfer: Transferable[] = []): void {
    if (this.terminated) throw new Error("posted to a terminated worker");
    // A real postMessage clones and detaches the transferred buffers on the sender's side.
    const copy = structuredClone(msg, { transfer });
    this.sent.push(copy);
    this.onPost(copy, transfer);
  }

  addEventListener(type: string, fn: (e: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Delivers a worker → main message now. */
  reply(msg: PropagationOut, transfer: Transferable[] = []): void {
    if (this.terminated) return;
    const data = structuredClone(msg, { transfer });
    for (const fn of this.listeners.get("message") ?? []) fn(new MessageEvent("message", { data }));
  }

  fail(message: string): void {
    for (const fn of this.listeners.get("error") ?? []) fn(new ErrorEvent("error", { message }));
  }

  of<T extends PropagationIn["type"]>(type: T): Extract<PropagationIn, { type: T }>[] {
    return this.sent.filter((m): m is Extract<PropagationIn, { type: T }> => m.type === type);
  }
}

// ---- modules, fresh per test (the ephemeris, clock loop and worker are module singletons)

type EphemerisModule = typeof import("../../src/state/ephemeris");
type ClockModule = typeof import("../../src/state/clockLoop");

interface Loaded {
  eph: EphemerisModule;
  clock: ClockModule;
}

async function loadModules(): Promise<Loaded> {
  vi.resetModules();
  const eph = await import("../../src/state/ephemeris");
  const clock = await import("../../src/state/clockLoop");
  return { eph, clock };
}

/** A manual FrameScheduler: frames run when the test says so. */
function manualFrames(clock: ClockModule, store: AppStore) {
  let pending: ((wallMs: number) => void) | null = null;
  const stop = clock.startClockLoop(store, {
    request: (cb) => {
      pending = cb;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  });
  return {
    stop,
    run(wallMs: number): void {
      const cb = pending;
      pending = null;
      cb?.(wallMs);
    },
  };
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function worker(): FakeWorker {
  const w = FakeWorker.instances.at(-1);
  if (w === undefined) throw new Error("no worker was created");
  return w;
}

function delta(
  firstIndex: number,
  rows: { norad: number; name: string; group: number; docked?: number }[],
): CatalogDelta {
  return {
    firstIndex,
    noradIds: Int32Array.from(rows.map((r) => r.norad)),
    names: rows.map((r) => r.name),
    groupIndex: Uint8Array.from(rows.map((r) => r.group)),
    epochMs: Float64Array.from(rows.map(() => SNAPSHOT_MS)),
    dockedWith: Int32Array.from(rows.map((r) => r.docked ?? -1)),
  };
}

let stops: (() => void)[] = [];

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("location", new URL(APP_HREF));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- part 1: scripted replies

describe("startEphemeris: messages and group status", () => {
  it("waits for the site, then sends init, stations and visual with absolute URLs", async () => {
    const { eph } = await loadModules();
    const store = createAppStore(initialState(T_PASS, DEFAULT_CAMERA_ID)); // cameras.json not loaded yet
    stops.push(eph.startEphemeris(store));
    const w = worker();
    expect(w.url).toMatch(/\/workers\/propagation\.worker\.ts$/);
    expect(w.options).toEqual({ type: "module" });
    expect(w.sent).toEqual([]);
    expect(store.getState().data.gp.stations.status).toBe("idle");

    const { enabledCameras } = await import("../../src/app/cameras");
    store.getState().actions.setRegistry(enabledCameras(committedCameras()));
    expect(w.sent.map((m) => m.type)).toEqual(["init", "loadGroup", "loadGroup"]);
    expect(w.sent[0]).toEqual({ type: "init", site: SITE, generation: expect.any(Number) });
    expect(w.of("loadGroup")).toEqual([
      { type: "loadGroup", group: "stations", url: gpUrl("stations") },
      { type: "loadGroup", group: "visual", url: gpUrl("visual") },
    ]);
    const gp = store.getState().data.gp;
    expect([gp.stations.status, gp.visual.status, gp.starlink.status]).toEqual([
      "loading",
      "loading",
      "idle",
    ]);
  });

  it("loads Starlink on the first turn-on, and again only after a groupError", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const { setLayer } = store.getState().actions;
    setLayer("starlink", true);
    expect(w.of("loadGroup").map((m) => m.group)).toEqual(["stations", "visual", "starlink"]);
    expect(w.of("loadGroup").at(-1)?.url).toBe(gpUrl("starlink"));
    expect(store.getState().data.gp.starlink.status).toBe("loading");
    setLayer("starlink", false);
    setLayer("starlink", true);
    expect(w.of("loadGroup")).toHaveLength(3); // no second request while loading
    w.reply({ type: "groupError", group: "starlink", message: "starlink.json: HTTP 503" });
    expect(store.getState().data.gp.starlink.status).toBe("error");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(w.of("loadGroup")).toHaveLength(3); // no retry loop
    setLayer("starlink", false);
    setLayer("starlink", true);
    expect(w.of("loadGroup").map((m) => m.group)).toEqual([
      "stations",
      "visual",
      "starlink",
      "starlink",
    ]);
  });

  it("sends Starlink after stations and visual when it is on before the site is known", async () => {
    const { eph } = await loadModules();
    const store = createAppStore(initialState(T_PASS, DEFAULT_CAMERA_ID));
    store.getState().actions.setLayer("starlink", true);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    expect(w.sent).toEqual([]);
    const { enabledCameras } = await import("../../src/app/cameras");
    store.getState().actions.setRegistry(enabledCameras(committedCameras()));
    expect(w.of("loadGroup").map((m) => m.group)).toEqual(["stations", "visual", "starlink"]);
  });

  it("flushes and sends setSite when the site changes, and nothing for an equal site", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const registry = store.getState().camera.registry;
    const camera = registry[DEFAULT_CAMERA_ID];
    if (camera === undefined) throw new Error("no default camera");
    const withSite = (site: CameraConfig["site"]) => ({
      ...registry,
      [DEFAULT_CAMERA_ID]: { ...camera, site },
    });
    store.getState().actions.setRegistry(withSite({ ...camera.site })); // a new object, same values
    expect(w.of("setSite")).toHaveLength(0);
    eph.requestSkyPaths(T_PASS - 30_000, T_PASS + 120_000, Int32Array.from([0]));
    const before = w.of("skyPaths")[0]?.generation ?? -1;
    const version = eph.ephemeris.pathsVersion;
    store
      .getState()
      .actions.setRegistry(withSite({ ...camera.site, latDeg: 47.1, lonDeg: 9.3, heightM: 500 }));
    const [setSite] = w.of("setSite");
    expect(setSite?.site).toEqual({ latDeg: 47.1, lonDeg: 9.3, heightM: 500 });
    expect(setSite?.generation).toBeGreaterThan(before); // samples from the old site are discarded
    expect(eph.ephemeris.pathsVersion).toBeGreaterThan(version); // old-site sky paths are dropped
    expect(eph.ephemeris.skyPaths.size).toBe(0);
  });

  it("appends the catalogue on groupLoaded and sets the group ready with its drawn count", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    w.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 3,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [
        { norad: 25544, name: "ISS (ZARYA)", group: 0 },
        { norad: 49044, name: "ISS (NAUKA)", group: 0, docked: 25544 },
        { norad: 48274, name: "CSS (TIANHE)", group: 0 },
      ]),
    });
    w.reply({
      type: "groupLoaded",
      group: "visual",
      totalCount: 4,
      fetchedAtMs: null,
      catalog: delta(3, [{ norad: 100882, name: "SIX DIGITS", group: 1 }]),
    });
    const { catalog } = eph.ephemeris;
    expect(catalog.count).toBe(4);
    expect([...catalog.noradIds]).toEqual([25544, 49044, 48274, 100882]);
    expect(catalog.names).toEqual(["ISS (ZARYA)", "ISS (NAUKA)", "CSS (TIANHE)", "SIX DIGITS"]);
    expect([...catalog.groupIndex]).toEqual([0, 0, 0, 1]);
    expect([...catalog.dockedWith]).toEqual([-1, 25544, -1, -1]);
    expect([...catalog.epochMs]).toEqual([SNAPSHOT_MS, SNAPSHOT_MS, SNAPSHOT_MS, SNAPSHOT_MS]);
    expect(catalog.indexByNorad.get(100882)).toBe(3);
    const gp = store.getState().data.gp;
    expect(gp.stations).toEqual({ status: "ready", fetchedAtMs: SNAPSHOT_MS, count: 2 });
    expect(gp.visual).toEqual({ status: "ready", fetchedAtMs: null, count: 1 });
    const frame = eph.updateEphemerisFrame(T_PASS);
    expect(frame.flags.length).toBe(4);
    expect(frame.mercator.length).toBe(8);
    expect(frame.enuKm.length).toBe(12);

    expect(eph.indexOfObjectId("sat:25544")).toBe(0);
    expect(eph.indexOfObjectId("sat:49044")).toBe(0); // docked: the host's index
    expect(eph.indexOfObjectId("sat:100882")).toBe(3);
    expect(eph.indexOfObjectId("sat:12345")).toBeNull();
    expect(eph.indexOfObjectId("planet:Jupiter")).toBeNull();
  });

  it("requests samples for the catalogue size once a group has loaded", async () => {
    const { eph, clock } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    expect(eph.updateEphemerisFrame(T_PASS).ready).toBe(false);
    expect(w.of("sample")).toHaveLength(0); // no pool before the first group
    w.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 2,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [
        { norad: 25544, name: "ISS (ZARYA)", group: 0 },
        { norad: 48274, name: "CSS (TIANHE)", group: 0 },
      ]),
    });
    const frames = manualFrames(clock, store);
    stops.push(frames.stop);
    frames.run(0);
    const requests = w.of("sample");
    expect(requests.map((r) => r.k)).toEqual([T_PASS / 100, T_PASS / 100 + 1, T_PASS / 100 + 2]);
    for (const r of requests) {
      expect(r.buffer.byteLength).toBe(2 * SAMPLE_STRIDE * 4);
      expect(r).toMatchObject({ stepMs: 100, groups: 0b011 });
    }
  });

  it("takes the Sun's altitude and the sunlit flag from the nearer sample (a on a tie)", async () => {
    const { eph, clock } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    w.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    const frames = manualFrames(clock, store);
    stops.push(frames.stop);
    const k = T_PASS / 100;
    store.getState().actions.seek(T_PASS + 70);
    frames.run(0); // requests k, k + 1, k + 2
    const answer = (
      req: Extract<PropagationIn, { type: "sample" }>,
      sunAltDeg: number,
      sunlit: 0 | 1,
    ) => {
      const data = new Float32Array(req.buffer);
      data.set([100, 100, 500, 0, 0, 0, sunlit, 1]); // 77.5° up, valid
      w.reply(
        {
          type: "sample",
          generation: req.generation,
          k: req.k,
          timeMs: req.k * req.stepMs,
          sunAltDeg,
          computeMs: 0.1,
          buffer: req.buffer,
        },
        [req.buffer],
      );
    };
    const [rk, rk1] = w.of("sample");
    if (rk === undefined || rk1 === undefined) throw new Error("no sample requests");
    expect([rk.k, rk1.k]).toEqual([k, k + 1]);
    answer(rk, -10, 0); // a: Sun −10°, in shadow
    answer(rk1, -20, 1); // b: Sun −20°, sunlit
    const at = (offsetMs: number, wallMs: number) => {
      store.getState().actions.seek(T_PASS + offsetMs);
      frames.run(wallMs);
      const f = eph.ephemeris.frame;
      return { ready: f.ready, sunAltDeg: f.sunAltDeg, flags: f.flags[0] };
    };
    expect(at(70, 16)).toEqual({ ready: true, sunAltDeg: -20, flags: 0b1111 }); // b is nearer
    expect(at(30, 32)).toEqual({ ready: true, sunAltDeg: -10, flags: 0b0101 }); // a is nearer
    expect(at(50, 48)).toEqual({ ready: true, sunAltDeg: -10, flags: 0b0101 }); // a tie takes a
  });

  it("keeps only the newest tracks reply and bumps pathsVersion", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    eph.requestTracks(T_PASS, 0, Int32Array.from([1, 2]));
    eph.requestTracks(T_PASS + 20_000, 0, Int32Array.from([1]));
    const [older, newer] = w.of("tracks");
    expect(older).toMatchObject({ timeMs: T_PASS, selectedIndex: 0 });
    expect([...(older?.otherIndices ?? [])]).toEqual([1, 2]);
    expect(newer?.requestId).toBeGreaterThan(older?.requestId ?? Number.POSITIVE_INFINITY);
    const track = (index: number): TrackOut => ({
      index,
      firstPointMs: T_PASS - 600_000,
      lonLatDeg: new Float64Array([1, 2, 3, 4]),
    });
    const version = eph.ephemeris.pathsVersion;
    w.reply({ type: "tracks", requestId: older?.requestId ?? -1, tracks: [track(0), track(2)] });
    expect(eph.ephemeris.tracks.size).toBe(0);
    expect(eph.ephemeris.pathsVersion).toBe(version);
    w.reply({ type: "tracks", requestId: newer?.requestId ?? -1, tracks: [track(0), track(1)] });
    expect([...eph.ephemeris.tracks.keys()]).toEqual([0, 1]);
    expect(eph.ephemeris.tracks.get(1)?.lonLatDeg).toEqual(new Float64Array([1, 2, 3, 4]));
    expect(eph.ephemeris.pathsVersion).toBe(version + 1);
    eph.requestTracks(T_PASS + 40_000, null, Int32Array.from([]));
    w.reply({ type: "tracks", requestId: w.of("tracks").at(-1)?.requestId ?? -1, tracks: [] });
    expect(eph.ephemeris.tracks.size).toBe(0); // every reply replaces the whole set
  });

  it("keeps sky paths from the newest request, unless it was sent before a site change", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const path = (index: number): SkyPathOut => ({
      index,
      firstPointMs: T_PASS - 32_000,
      enuKm: new Float32Array([1, 2, 3]),
    });
    const reply = (req: Extract<PropagationIn, { type: "skyPaths" }> | undefined, index: number) =>
      w.reply({
        type: "skyPaths",
        requestId: req?.requestId ?? -1,
        generation: req?.generation ?? -1,
        paths: [path(index)],
      });
    eph.requestSkyPaths(T_PASS - 30_200, T_PASS + 120_200, Int32Array.from([0]));
    const first = w.of("skyPaths")[0];
    expect(first).toMatchObject({ fromMs: T_PASS - 30_200, toMs: T_PASS + 120_200 });
    expect([...(first?.indices ?? [])]).toEqual([0]);
    // A flush that keeps the observer (here a group loading) leaves the request valid: ENU depends only on the site.
    w.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    const version = eph.ephemeris.pathsVersion;
    reply(first, 0);
    expect(eph.ephemeris.skyPaths.get(0)?.enuKm).toEqual(new Float32Array([1, 2, 3]));
    expect(eph.ephemeris.pathsVersion).toBe(version + 1);

    eph.requestSkyPaths(T_PASS - 28_200, T_PASS + 122_200, Int32Array.from([0, 1]));
    const second = w.of("skyPaths")[1];
    reply(first, 5);
    expect([...eph.ephemeris.skyPaths.keys()]).toEqual([0]); // an older requestId

    // A site change: the reply to a request sent before it holds ENU from the old observer.
    const registry = store.getState().camera.registry;
    const camera = registry[DEFAULT_CAMERA_ID];
    if (camera === undefined) throw new Error("no default camera");
    store.getState().actions.setRegistry({
      ...registry,
      [DEFAULT_CAMERA_ID]: { ...camera, site: { ...camera.site, latDeg: 47.1 } },
    });
    expect(eph.ephemeris.skyPaths.size).toBe(0);
    const cleared = eph.ephemeris.pathsVersion;
    reply(second, 1);
    expect(eph.ephemeris.skyPaths.size).toBe(0);
    expect(eph.ephemeris.pathsVersion).toBe(cleared);
    eph.requestSkyPaths(T_PASS - 26_200, T_PASS + 124_200, Int32Array.from([0]));
    const third = w.of("skyPaths")[2];
    expect(third?.generation).toBeGreaterThan(second?.generation ?? Number.POSITIVE_INFINITY);
    reply(third, 0);
    expect([...eph.ephemeris.skyPaths.keys()]).toEqual([0]);
  });

  it("marks loading groups failed when the worker itself fails", async () => {
    const { eph } = await loadModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    worker().fail("SyntaxError in the worker script");
    const gp = store.getState().data.gp;
    expect([gp.stations.status, gp.visual.status, gp.starlink.status]).toEqual([
      "error",
      "error",
      "idle",
    ]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("stops: terminates the worker, unsubscribes, resets the data; a second start is refused while running", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    const stop = eph.startEphemeris(store);
    expect(() => eph.startEphemeris(store)).toThrow();
    const w = worker();
    w.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    expect(eph.ephemeris.catalog.count).toBe(1);
    stop();
    stop(); // idempotent
    expect(w.terminated).toBe(true);
    expect(eph.ephemeris.catalog.count).toBe(0);
    expect(eph.indexOfObjectId("sat:25544")).toBeNull();
    store.getState().actions.setLayer("starlink", true);
    expect(w.of("loadGroup")).toHaveLength(2); // no longer listening
    eph.requestTracks(T_PASS, 0, Int32Array.from([])); // a no-op, not a throw
    stops.push(eph.startEphemeris(store)); // a fresh worker and catalogue
    expect(FakeWorker.instances).toHaveLength(2);
    expect(
      worker()
        .of("loadGroup")
        .map((m) => m.group),
    ).toEqual(["stations", "visual", "starlink"]);
  });
});

// ---- part 2: the real worker, in-process

const fixture = (file: string): string =>
  readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8");

/** Wires the FakeWorker to the real worker module: both directions cloned with transfer, delivered as macrotasks. */
async function startRealWorker(w: FakeWorker): Promise<void> {
  let workerListener: ((e: MessageEvent<PropagationIn>) => void) | null = null;
  vi.stubGlobal(
    "addEventListener",
    (_type: string, fn: (e: MessageEvent<PropagationIn>) => void) => {
      workerListener = fn;
    },
  );
  vi.stubGlobal("postMessage", (msg: PropagationOut, options: { transfer?: Transferable[] }) => {
    const transfer = options.transfer ?? [];
    const data = structuredClone(msg, { transfer });
    setTimeout(() => w.reply(data), 0);
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const file = url.slice(gpUrl("x").length - "x.json".length);
    return new Response(fixture(file), { status: 200 });
  });
  await import("../../src/workers/propagation.worker");
  w.onPost = (msg) => {
    setTimeout(() => workerListener?.(new MessageEvent("message", { data: msg })), 0);
  };
  // Messages sent before the hook-up (init, loadGroup) are replayed in order.
  for (const msg of w.sent) {
    setTimeout(() => workerListener?.(new MessageEvent("message", { data: msg })), 0);
  }
}

interface Running {
  eph: EphemerisModule;
  store: AppStore;
  frames: ReturnType<typeof manualFrames>;
  /** Runs one frame at wallMs, then lets the worker answer. */
  frame(wallMs: number): Promise<void>;
}

async function runRealWorker(iso: string, opts: { starlink?: boolean } = {}): Promise<Running> {
  const { eph, clock } = await loadModules();
  const store = storeAt(iso);
  if (opts.starlink === true) store.getState().actions.setLayer("starlink", true);
  stops.push(eph.startEphemeris(store));
  await startRealWorker(worker());
  await vi.waitFor(
    () => {
      const gp = store.getState().data.gp;
      expect(gp.stations.status).toBe("ready");
      expect(gp.visual.status).toBe("ready");
      if (opts.starlink === true) expect(gp.starlink.status).toBe("ready");
    },
    { timeout: 10_000 },
  );
  const frames = manualFrames(clock, store);
  stops.push(frames.stop);
  return {
    eph,
    store,
    frames,
    async frame(wallMs: number) {
      frames.run(wallMs);
      for (let i = 0; i < 4; i++) await macrotask();
    },
  };
}

function issIndex(eph: EphemerisModule): number {
  const i = eph.indexOfObjectId(`sat:${ISS_NORAD_ID}`);
  if (i === null) throw new Error("ISS not in the catalogue");
  return i;
}

describe("updateEphemerisFrame with the real worker", () => {
  it("puts the ISS where the e2e hover card expects it at 15:09:50Z", async () => {
    const run = await runRealWorker(T_PASS_ISO);
    const gp = run.store.getState().data.gp;
    expect(gp.stations).toEqual({ status: "ready", fetchedAtMs: SNAPSHOT_MS, count: 12 });
    expect(gp.visual).toEqual({ status: "ready", fetchedAtMs: SNAPSHOT_MS, count: 153 });
    for (let f = 0; f < 3 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const frame = run.eph.ephemeris.frame;
    expect(frame.ready).toBe(true);
    expect(frame.timeMs).toBe(T_PASS);
    const i = issIndex(run.eph);
    const az = frame.azAltDeg[2 * i] ?? Number.NaN;
    const alt = frame.azAltDeg[2 * i + 1] ?? Number.NaN;
    const range = frame.rangeKm[i] ?? Number.NaN;
    expect(`az ${az.toFixed(1)}°`).toBe("az 123.8°");
    expect(`alt ${alt.toFixed(1)}°`).toBe("alt 28.9°");
    expect(`${Math.round(range)} km`).toBe("795 km");
    expect(az).toBeCloseTo(123.812, 2);
    expect(alt).toBeCloseTo(28.872, 2); // geometric 28.841° + 0.030° refraction
    expect(range).toBeCloseTo(794.522, 1);
    expect(frame.flags[i]).toBe(0b1111); // valid, sunlit, above the horizon, visible
    expect(frame.sunAltDeg).toBeCloseTo(-16.2, 1);
    expect([...frame.enuKm.subarray(3 * i, 3 * i + 3)].every(Number.isFinite)).toBe(true);
  });

  it("lists exactly the e2e satellites above the horizon, highest first, and no docked vehicle", async () => {
    const run = await runRealWorker(T_PASS_ISO);
    for (let f = 0; f < 3 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const { catalog, frame } = run.eph.ephemeris;
    const above: number[] = [];
    for (let i = 0; i < catalog.count; i++) {
      if (((frame.flags[i] ?? 0) & 0b101) === 0b101 && (catalog.groupIndex[i] ?? 9) <= 1)
        above.push(i);
    }
    above.sort((p, q) => (frame.azAltDeg[2 * q + 1] ?? 0) - (frame.azAltDeg[2 * p + 1] ?? 0));
    expect(above.map((i) => catalog.names[i])).toEqual([
      "ISS (ZARYA)",
      "SL-3 R/B",
      "CYGNUS NG-24",
      "ORBVIEW 2 (SEASTAR)",
      "SL-3 R/B",
      "DUPLEX",
      "SPACEMOBILE-010",
      "CZ-8A R/B",
    ]);
    expect([catalog.noradIds[above[1] ?? -1], catalog.noradIds[above[4] ?? -1]]).toEqual([
      19046, 10114,
    ]);
    for (let i = 0; i < catalog.count; i++) {
      if ((catalog.dockedWith[i] ?? -1) !== -1) expect(frame.flags[i]).toBe(0);
    }
  });

  it("gives the ground position from O + M·ENU and Bowring, in EPSG:3857", async () => {
    const run = await runRealWorker(T_PASS_ISO);
    for (let f = 0; f < 3 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const frame = run.eph.ephemeris.frame;
    const i = issIndex(run.eph);
    const issOmm = parseGpFile(JSON.parse(fixture("stations.json")))[0];
    if (issOmm === undefined) throw new Error("no ISS record");
    const satrec = json2satrec(issOmm);
    const date = new Date(T_PASS);
    const pv = propagate(satrec, date);
    if (pv === null) throw new Error("ISS failed to propagate");
    const geo = eciToGeodetic(pv.position, gstime(date));
    const lonDeg = frame.lonLatDeg[2 * i] ?? Number.NaN;
    const latDeg = frame.lonLatDeg[2 * i + 1] ?? Number.NaN;
    // Float32 ENU samples: about 1e-4 km, i.e. 1e-6°.
    expect(Math.abs(latDeg - (geo.latitude * 180) / Math.PI)).toBeLessThan(1e-5);
    expect(Math.abs(lonDeg - (geo.longitude * 180) / Math.PI)).toBeLessThan(1e-5);
    const R = 6378137;
    expect(frame.mercator[2 * i]).toBeCloseTo((R * lonDeg * Math.PI) / 180, 3);
    expect(frame.mercator[2 * i + 1]).toBeCloseTo(
      R * Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360)),
      3,
    );
    expect(frame.mercator.every(Number.isFinite)).toBe(true);
  });

  it.each([
    [1, 0.001],
    [600, 0.001], // Hermite with the Earth-fixed velocity
  ])(
    "follows the ISS between samples while playing at %i× (≤ %f° from direct propagation)",
    async (rate, tolDeg) => {
      const run = await runRealWorker(T_PASS_ISO);
      const { actions } = run.store.getState();
      actions.setRate(rate as 1 | 600);
      actions.play();
      const i = issIndex(run.eph);
      const issOmm = parseGpFile(JSON.parse(fixture("stations.json")))[0];
      if (issOmm === undefined) throw new Error("no ISS record");
      const satrec = json2satrec(issOmm);
      const slot = new Float32Array(SAMPLE_STRIDE);
      const direct = new Float64Array(2);
      let checked = 0;
      for (let f = 0; f < 40; f++) {
        await run.frame(f * (1000 / 60));
        const frame = run.eph.ephemeris.frame;
        if (!frame.ready || frame.timeMs === T_PASS) continue;
        writeSample(satrec, createPropagationContext(frame.timeMs, SITE), slot, 0);
        enuToAzAltDeg(slot[0] ?? 0, slot[1] ?? 0, slot[2] ?? 0, direct, 0);
        const sep = angularSeparationDeg(
          frame.azAltDeg[2 * i] ?? Number.NaN,
          frame.azAltDeg[2 * i + 1] ?? Number.NaN,
          direct[0] ?? Number.NaN,
          apparentAltDeg(direct[1] ?? Number.NaN),
        );
        expect(sep).toBeLessThan(tolDeg);
        checked++;
      }
      expect(checked).toBeGreaterThan(30);
    },
  );

  it("records each sample reply's computeMs as an overhead:propagate measure and clears it", async () => {
    const measure = vi.spyOn(performance, "measure");
    const clear = vi.spyOn(performance, "clearMeasures");
    const run = await runRealWorker(T_PASS_ISO);
    for (let f = 0; f < 3; f++) await run.frame(f * 16);
    const calls = measure.mock.calls.filter((c) => c[0] === "overhead:propagate");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) {
      const options = c[1];
      expect(typeof options === "object" && options !== null && "duration" in options).toBe(true);
    }
    expect(clear).toHaveBeenCalledWith("overhead:propagate");
  });

  it("propagates Starlink once its toggle is on, after stations and visual", async () => {
    const run = await runRealWorker(T_PASS_ISO, { starlink: true });
    const gp = run.store.getState().data.gp;
    expect(gp.starlink).toEqual({ status: "ready", fetchedAtMs: SNAPSHOT_MS, count: 11102 });
    for (let f = 0; f < 4 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const { catalog, frame } = run.eph.ephemeris;
    expect(catalog.count).toBe(22 + 153 + 11102);
    expect(catalog.indexByNorad.size).toBe(11277);
    let valid = 0;
    for (let i = 175; i < catalog.count; i++) if (((frame.flags[i] ?? 0) & 1) === 1) valid++;
    expect(valid).toBeGreaterThan(11000);
    expect(frame.mercator.every(Number.isFinite)).toBe(true);
  });
});
