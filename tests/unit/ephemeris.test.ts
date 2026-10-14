// tests/unit/ephemeris.test.ts — the propagation-worker client (M3 step 11, README sections 5 and 6).
// Part 1 scripts the worker's replies; part 2 runs the real worker module in-process (messages structured-cloned with
// transfer, so sent buffers detach as in a browser) on the committed snapshot and checks the e2e numbers.
import { readFileSync } from "node:fs";
import { eciToGeodetic, gstime, json2satrec, propagate } from "satellite.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import {
  angularSeparationDeg,
  ecefToLatLonDeg,
  enuToAzAltDeg,
  enuToEcef,
  enuToEcefMatrix,
  geodeticToEcefKm,
  type ObserverSite,
} from "../../src/domain/geo";
import {
  belowSkyCutoff,
  createPropagationContext,
  ISS_NORAD_ID,
  parseGpFile,
  SAMPLE_STRIDE,
  writeSample,
} from "../../src/domain/orbits";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import type {
  CatalogDelta,
  PropagationIn,
  PropagationOut,
  SkyPathOut,
  TrackOut,
} from "../../src/workers/protocol";
import { committedCameras, storeAt, TEST_CAMERA_ID } from "../helpers/store";

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
    const store = createAppStore(initialState(T_PASS, TEST_CAMERA_ID)); // cameras.json not loaded yet
    stops.push(eph.startEphemeris(store));
    const w = worker();
    expect(w.url).toMatch(/\/workers\/propagation\.worker\.ts$/);
    expect(w.options).toEqual({ type: "module" });
    expect(w.sent).toEqual([]);
    expect(store.getState().data.gp.stations.status).toBe("idle");

    store.getState().actions.setRegistry(committedCameras()); // [Redesign] the test camera is not enabled in the app
    // [M8] setCamera follows init (the worker's first message), delivered inside loadGroup's setGroupData.
    expect(w.sent.map((m) => m.type)).toEqual(["init", "setCamera", "loadGroup", "loadGroup"]);
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
    const store = createAppStore(initialState(T_PASS, TEST_CAMERA_ID));
    store.getState().actions.setLayer("starlink", true);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    expect(w.sent).toEqual([]);
    store.getState().actions.setRegistry(committedCameras()); // [Redesign] the test camera is not enabled in the app
    expect(w.of("loadGroup").map((m) => m.group)).toEqual(["stations", "visual", "starlink"]);
  });

  it("flushes and sends setSite when the site changes, and nothing for an equal site", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const registry = store.getState().camera.registry;
    const camera = registry[TEST_CAMERA_ID];
    if (camera === undefined) throw new Error("no default camera");
    const withSite = (site: CameraConfig["site"]) => ({
      ...registry,
      [TEST_CAMERA_ID]: { ...camera, site },
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
    const camera = registry[TEST_CAMERA_ID];
    if (camera === undefined) throw new Error("no default camera");
    store.getState().actions.setRegistry({
      ...registry,
      [TEST_CAMERA_ID]: { ...camera, site: { ...camera.site, latDeg: 47.1 } },
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

describe("[M9] step 14f: a clip replays with its own element sets", () => {
  const CLIP_ID = "subaru-2026-10-11-iss";
  const appBase = new URL(import.meta.env.BASE_URL, APP_HREF).href; // as the app resolves its sidecarUrl
  const CLIP_GP = `${appBase}recordings/${CLIP_ID}.gp/`;
  const DATA_GP = `${appBase}data/gp/`;
  const urlsOf = (w: FakeWorker): string[] => w.of("loadGroup").map((m) => m.url);

  /** A fetch that answers the clip's meta.json probe with `answer`, and records every URL. */
  function probeFetch(answer: () => Response | Promise<Response>) {
    const calls: string[] = [];
    const fn = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url !== `${CLIP_GP}meta.json`) throw new Error(`unexpected fetch ${url}`);
      return answer();
    };
    return { fn, calls };
  }
  const metaJson = (): Response =>
    new Response(JSON.stringify({ stations: { fetchedAtMs: SNAPSHOT_MS } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  /** The clip camera as loadClipFromSidecarUrl commits it: videoUrl and startUtcMs set. */
  function loadClip(store: AppStore): void {
    const { registry } = store.getState().camera;
    const entry = registry[CLIP_ID];
    if (entry?.kind !== "local-video") throw new Error("no clip camera in the registry");
    store.getState().actions.setRegistry({
      ...registry,
      [CLIP_ID]: {
        ...entry,
        source: { ...entry.source, videoUrl: "blob:test", startUtcMs: 1791731310183 },
      },
    });
  }

  it("switches to <clip>.gp/ once the clip has loaded and meta.json answers JSON, and back for another camera", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    const probe = probeFetch(metaJson);
    stops.push(eph.startEphemeris(store, { fetch: probe.fn }));
    const w0 = worker();
    expect(urlsOf(w0)).toEqual([`${DATA_GP}stations.json`, `${DATA_GP}visual.json`]);
    // The clip camera before its clip loads: data/gp/, no probe, no restart.
    store.getState().actions.setActiveCamera(CLIP_ID);
    expect(probe.calls).toEqual([]);
    expect(FakeWorker.instances).toHaveLength(1);
    loadClip(store);
    expect(probe.calls).toEqual([`${CLIP_GP}meta.json`]);
    expect(FakeWorker.instances).toHaveLength(1); // until the probe answers
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const w1 = worker();
    expect(w0.terminated).toBe(true);
    // Started as at boot, on the clip's site, from the clip's directory.
    expect(w1.sent.map((m) => m.type).slice(0, 3)).toEqual(["init", "loadGroup", "loadGroup"]);
    const clipSite = store.getState().camera.registry[CLIP_ID]?.site;
    expect(w1.of("init")[0]?.site).toEqual({
      latDeg: clipSite?.latDeg,
      lonDeg: clipSite?.lonDeg,
      heightM: clipSite?.heightM,
    });
    expect(urlsOf(w1)).toEqual([`${CLIP_GP}stations.json`, `${CLIP_GP}visual.json`]);
    expect(w1.of("setCamera").length).toBe(1); // the camera model goes to the new worker too
    const { gp } = store.getState().data;
    expect([gp.stations.status, gp.visual.status, gp.starlink.status]).toEqual([
      "loading",
      "loading",
      "idle",
    ]);
    expect(eph.ephemeris.catalog.count).toBe(0);
    // Starlink on: loaded from the clip's directory as well.
    store.getState().actions.setLayer("starlink", true);
    expect(urlsOf(w1).at(-1)).toBe(`${CLIP_GP}starlink.json`);
    // Another camera: back to data/gp/ in a new worker, Starlink included.
    store.getState().actions.setActiveCamera(TEST_CAMERA_ID);
    expect(FakeWorker.instances).toHaveLength(3);
    expect(w1.terminated).toBe(true);
    expect(urlsOf(worker())).toEqual([
      `${DATA_GP}stations.json`,
      `${DATA_GP}visual.json`,
      `${DATA_GP}starlink.json`,
    ]);
    // The clip again: the probe's answer is kept for the session.
    store.getState().actions.setActiveCamera(CLIP_ID);
    expect(FakeWorker.instances).toHaveLength(4);
    expect(urlsOf(worker())[0]).toBe(`${CLIP_GP}stations.json`);
    expect(probe.calls).toHaveLength(1);
  });

  it.each([
    [
      "vite's index.html fallback",
      () =>
        new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }),
    ],
    [
      "a 404",
      () =>
        new Response("Not Found", { status: 404, headers: { "content-type": "application/json" } }),
    ],
    [
      "a body that is not JSON",
      () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    ],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("keeps data/gp/ when the probe meets %s, and asks once per clip", async (_name, answer) => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    const probe = probeFetch(answer);
    stops.push(eph.startEphemeris(store, { fetch: probe.fn }));
    store.getState().actions.setActiveCamera(CLIP_ID);
    loadClip(store);
    for (let i = 0; i < 4; i++) await macrotask();
    expect(probe.calls).toEqual([`${CLIP_GP}meta.json`]);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(urlsOf(worker())).toEqual([`${DATA_GP}stations.json`, `${DATA_GP}visual.json`]);
    store.getState().actions.setActiveCamera(TEST_CAMERA_ID);
    store.getState().actions.setActiveCamera(CLIP_ID);
    for (let i = 0; i < 4; i++) await macrotask();
    expect(probe.calls).toHaveLength(1);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("ignores the old worker after a restart and rebuilds the catalogue from the new one", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store, { fetch: probeFetch(metaJson).fn }));
    const w0 = worker();
    w0.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: 1,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    expect(eph.ephemeris.catalog.count).toBe(1);
    store.getState().actions.setActiveCamera(CLIP_ID);
    loadClip(store);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(eph.ephemeris.catalog.count).toBe(0);
    expect(store.getState().data.gp.stations.status).toBe("loading");
    worker().reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    expect(eph.ephemeris.catalog.count).toBe(1);
    expect(store.getState().data.gp.stations).toEqual({
      status: "ready",
      fetchedAtMs: SNAPSHOT_MS,
      count: 1,
    });
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

describe("updateEphemerisFrame with the terrain horizon (M6 step 10)", () => {
  it("uses the ready profile for above-horizon and visible, and recomputes a paused frame when it arrives", async () => {
    const run = await runRealWorker(T_PASS_ISO); // paused replay
    for (let f = 0; f < 3 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const i = issIndex(run.eph);
    const { frame } = run.eph.ephemeris;
    expect(frame.flags[i]).toBe(0b1111); // the geometric horizon until the profile is ready
    const { setHorizon } = run.store.getState().actions;
    // A 40° ridge everywhere: the ISS at apparent 28.9° is behind it. Same time, same samples: only the profile changed.
    setHorizon("synthetic-maunakea", {
      status: "ready",
      profileDeg: new Float32Array(360).fill(40),
    });
    await run.frame(100);
    expect(frame.timeMs).toBe(T_PASS);
    expect(frame.flags[i]).toBe(0b0011); // valid and sunlit; neither above the horizon nor visible
    // A sea horizon below 0° changes nothing for an object above 0°.
    setHorizon("synthetic-maunakea", { profileDeg: new Float32Array(360).fill(-1.93) });
    await run.frame(200);
    expect(frame.flags[i]).toBe(0b1111);
  });
});

// ---- [M8] the incoming check's camera, profile and requests (M8 step 6.2)

describe("M8: setCamera, setHorizonProfile and incoming requests", () => {
  it("sends setCamera for the active camera and each calibration change, and the profile after setSite", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const camera = store.getState().camera.registry[TEST_CAMERA_ID];
    if (camera === undefined) throw new Error("no default camera");
    expect(w.of("setCamera")).toEqual([
      {
        type: "setCamera",
        camera: {
          lens: camera.lens,
          calibration: camera.defaults,
          widthPx: camera.imageSize.widthPx,
          heightPx: camera.imageSize.heightPx,
        },
      },
    ]);
    const { actions } = store.getState();
    actions.updateCalibration({ rollDeg: 5 });
    expect(w.of("setCamera")).toHaveLength(2);
    expect(w.of("setCamera")[1]?.camera?.calibration.rollDeg).toBe(5);
    for (let i = 1; i <= 10; i++) actions.tick(T_PASS + 16 * i); // ticks send nothing
    expect(w.of("setCamera")).toHaveLength(2);
    expect(w.of("setHorizonProfile")).toHaveLength(0);

    const profile = new Float32Array(360).fill(-1.9);
    actions.setHorizon(TEST_CAMERA_ID, { status: "ready", profileDeg: profile });
    expect(w.of("setHorizonProfile")).toHaveLength(1);
    expect(w.of("setHorizonProfile")[0]?.profileDeg).toEqual(profile); // a structured-clone copy
    expect(w.of("setHorizonProfile")[0]?.profileDeg).not.toBe(profile);

    // Another site: setSite (which resets the worker's profile) before that camera's profile.
    actions.setActiveCamera("synthetic-walenstadt");
    const types = w.sent.map((m) => m.type);
    expect(types.slice(types.lastIndexOf("setSite"))).toEqual([
      "setSite",
      "setCamera",
      "setHorizonProfile",
    ]);
    expect(w.of("setHorizonProfile").at(-1)?.profileDeg).toBeNull();
  });

  it("posts incoming at most once per wall second, routes replies, and clears them on a flush or when inactive", async () => {
    const { eph, clock } = await loadModules();
    let wallMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wallMs);
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const frames = manualFrames(clock, store);
    stops.push(frames.stop);
    const run = (ms: number): void => {
      wallMs = ms;
      frames.run(ms);
    };
    run(0);
    expect(w.of("incoming")).toEqual([
      { type: "incoming", requestId: 1, timeMs: T_PASS, groups: 0b011 },
    ]);
    run(16); // one in flight
    expect(w.of("incoming")).toHaveLength(1);
    const reply: Extract<PropagationOut, { type: "incoming" }> = {
      type: "incoming",
      requestId: 1,
      timeMs: T_PASS,
      computeMs: 0.3,
      entries: [{ index: 0, etaSec: 35 }],
    };
    w.reply(reply);
    expect(eph.ephemeris.incoming).toEqual(reply);
    run(2_000); // paused and unchanged
    expect(w.of("incoming")).toHaveLength(1);

    // A group load flushes: the entries go, and the next frame asks again.
    w.reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    expect(eph.ephemeris.incoming).toBeNull();
    w.reply(reply); // a late answer to the flushed request
    expect(eph.ephemeris.incoming).toBeNull();
    run(2_016);
    expect(w.of("incoming").at(-1)).toMatchObject({ requestId: 2, groups: 0b011 });

    // Both satellite layers off: inactive, nothing posted, nothing held.
    w.reply({ ...reply, requestId: 2 });
    expect(eph.ephemeris.incoming?.requestId).toBe(2);
    store.getState().actions.setLayer("satellites", false);
    run(4_000);
    expect(eph.ephemeris.incoming).toBeNull();
    expect(w.of("incoming")).toHaveLength(2);
    store.getState().actions.setLayer("satellites", true);
    run(4_016);
    expect(w.of("incoming")).toHaveLength(3);

    // Playing at 60×: alerts pause.
    w.reply({ ...reply, requestId: 3 });
    store.getState().actions.setRate(60);
    store.getState().actions.play();
    run(6_000);
    run(8_000);
    expect(eph.ephemeris.incoming).toBeNull();
    expect(w.of("incoming")).toHaveLength(3);
  });

  it("sends no incoming request before a camera is known", async () => {
    const { eph, clock } = await loadModules();
    const store = createAppStore(initialState(T_PASS, TEST_CAMERA_ID)); // cameras.json not loaded yet
    stops.push(eph.startEphemeris(store));
    const frames = manualFrames(clock, store);
    stops.push(frames.stop);
    frames.run(0);
    frames.run(2_000);
    expect(worker().sent).toEqual([]);
    expect(eph.ephemeris.incoming).toBeNull();
  });

  it("heightKmOf is null before the frame is ready and for an invalid index", async () => {
    const { eph } = await loadModules();
    const store = storeAt(T_PASS_ISO);
    stops.push(eph.startEphemeris(store));
    expect(eph.heightKmOf(0)).toBeNull();
    worker().reply({
      type: "groupLoaded",
      group: "stations",
      totalCount: 1,
      fetchedAtMs: SNAPSHOT_MS,
      catalog: delta(0, [{ norad: 25544, name: "ISS (ZARYA)", group: 0 }]),
    });
    expect(eph.heightKmOf(0)).toBeNull(); // no sample yet
    expect(eph.heightKmOf(7)).toBeNull();
  });
});

describe("M8 with the real worker", () => {
  const T_INCOMING_ISO = "2026-10-11T15:05:07Z";
  const T_INCOMING = Date.parse(T_INCOMING_ISO);

  it("lists the ISS and SL-3 R/B 19046 on synthetic-maunakea at 15:05:07Z (the e2e chip)", async () => {
    const run = await runRealWorker(T_INCOMING_ISO);
    for (let f = 0; f < 5 && run.eph.ephemeris.incoming === null; f++) await run.frame(f * 16);
    const reply = run.eph.ephemeris.incoming;
    expect(reply?.timeMs).toBe(T_INCOMING);
    expect(reply?.computeMs).toBeGreaterThan(0);
    const { noradIds } = run.eph.ephemeris.catalog;
    expect(reply?.entries.map((e) => [noradIds[e.index], e.etaSec])).toEqual([
      [25544, 35],
      [19046, 55],
    ]);
  });

  it("heightKmOf gives the ISS's geodetic height, 422.400 km at 15:05:07Z (e2e test 4)", async () => {
    const run = await runRealWorker(T_INCOMING_ISO);
    for (let f = 0; f < 3 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const h = run.eph.heightKmOf(issIndex(run.eph));
    const omm = parseGpFile(JSON.parse(fixture("stations.json"))).find(
      (o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID,
    );
    if (omm === undefined) throw new Error("no ISS in the snapshot");
    const date = new Date(T_INCOMING);
    const pv = propagate(json2satrec(omm), date);
    if (pv === null || typeof pv.position === "boolean") throw new Error("ISS propagation failed");
    const reference = eciToGeodetic(pv.position, gstime(date)).height;
    expect(reference).toBeCloseTo(422.4, 3);
    expect(h).not.toBeNull();
    expect(Math.abs((h ?? Number.NaN) - reference)).toBeLessThan(0.005); // Float32 ENU samples
  });
});

describe("[M9] step 4: the Starlink sky cut-off and interleaved ground updates", () => {
  const STARLINK = 2; // GP_GROUPS index
  const O = new Float64Array(3);
  geodeticToEcefKm(SITE.latDeg, SITE.lonDeg, SITE.heightM, O, 0);
  const M = enuToEcefMatrix(SITE.latDeg, SITE.lonDeg);
  const ecef = new Float64Array(3);
  const latLon = new Float64Array(2);

  type Frame = EphemerisModule["ephemeris"]["frame"];
  const enuOf = (f: Frame, i: number): [number, number, number] => [
    f.enuKm[3 * i] ?? 0,
    f.enuKm[3 * i + 1] ?? 0,
    f.enuKm[3 * i + 2] ?? 0,
  ];
  /** Rows whose lonLatDeg is not O + M·ENU → Bowring of this frame's ENU (every valid row, after a full run). */
  function staleGroundRows(f: Frame, count: number): number[] {
    const stale: number[] = [];
    for (let i = 0; i < count; i++) {
      if (((f.flags[i] ?? 0) & 1) === 0) continue;
      enuToEcef(M, ...enuOf(f, i), ecef, 0);
      ecefToLatLonDeg(
        (O[0] ?? 0) + (ecef[0] ?? 0),
        (O[1] ?? 0) + (ecef[1] ?? 0),
        (O[2] ?? 0) + (ecef[2] ?? 0),
        latLon,
        0,
      );
      if (f.lonLatDeg[2 * i] !== latLon[1] || f.lonLatDeg[2 * i + 1] !== latLon[0]) stale.push(i);
    }
    return stale;
  }

  it("cuts Starlink rows below −3° from the sky only, keeps their ground position, and never cuts the selected row", async () => {
    const run = await runRealWorker(T_PASS_ISO, { starlink: true }); // paused replay
    for (let f = 0; f < 4 && !run.eph.ephemeris.frame.ready; f++) await run.frame(f * 16);
    const { catalog, frame } = run.eph.ephemeris;
    let cut = 0;
    let starlinkUp = 0;
    let firstCut = -1;
    for (let i = 0; i < catalog.count; i++) {
      const flags = frame.flags[i] ?? 0;
      if ((flags & 1) === 0) continue;
      const alt = frame.azAltDeg[2 * i + 1] ?? Number.NaN;
      const starlink = catalog.groupIndex[i] === STARLINK;
      const below = belowSkyCutoff(...enuOf(frame, i));
      expect(Number.isNaN(alt)).toBe(starlink && below);
      if (Number.isNaN(alt)) {
        cut++;
        if (firstCut < 0) firstCut = i;
        expect(flags & 0b1100).toBe(0); // neither above the horizon nor visible
        expect(Number.isNaN(frame.rangeKm[i] ?? 0)).toBe(true);
      } else if (starlink && alt > 0) {
        starlinkUp++;
      }
      expect(Number.isFinite(frame.mercator[2 * i] ?? Number.NaN)).toBe(true);
    }
    expect(cut).toBeGreaterThan(9_000);
    expect(starlinkUp).toBeGreaterThan(100); // the sky view still draws its Starlinks
    expect(staleGroundRows(frame, catalog.count)).toEqual([]);

    // Selecting a cut row recomputes the paused frame: the selected object always has its az/alt.
    run.store.getState().actions.select(`sat:${catalog.noradIds[firstCut] ?? 0}`);
    await run.frame(64);
    const alt = frame.azAltDeg[2 * firstCut + 1] ?? Number.NaN;
    expect(alt).toBeLessThan(-2);
    expect(frame.rangeKm[firstCut]).toBeGreaterThan(0);
    // And hovering another one does the same.
    const other = catalog.groupIndex.findIndex(
      (g, i) => g === STARLINK && i > firstCut && Number.isNaN(frame.azAltDeg[2 * i + 1] ?? 0),
    );
    run.store.getState().actions.hover(`sat:${catalog.noradIds[other] ?? 0}`);
    await run.frame(80);
    expect(Number.isFinite(frame.azAltDeg[2 * other + 1] ?? Number.NaN)).toBe(true);
  });

  it("updates half the Starlink rows on the ground per frame while playing, then every row once paused", async () => {
    const run = await runRealWorker(T_PASS_ISO, { starlink: true });
    const { actions } = run.store.getState();
    const { catalog, frame } = run.eph.ephemeris;
    actions.setRate(60);
    actions.play();
    const iss = issIndex(run.eph);
    let selected = -1;
    let interleaved = 0;
    let prev: Float64Array | null = null;
    for (let f = 0; f < 40; f++) {
      await run.frame(f * (1000 / 60));
      if (!frame.ready) continue;
      if (selected < 0) {
        selected = catalog.groupIndex.indexOf(STARLINK);
        actions.select(`sat:${catalog.noradIds[selected] ?? 0}`);
      }
      const cur = Float64Array.from(frame.lonLatDeg);
      if (prev !== null && cur[2 * iss] !== prev[2 * iss]) {
        // The ISS moved, so every freshly computed row moved: the rows that did not are the kept parity.
        const kept = new Set<number>();
        const moved = new Set<number>();
        for (let i = 0; i < catalog.count; i++) {
          if (catalog.groupIndex[i] !== STARLINK || ((frame.flags[i] ?? 0) & 1) === 0) continue;
          const same = cur[2 * i] === prev[2 * i] && cur[2 * i + 1] === prev[2 * i + 1];
          if (i === selected)
            expect(same).toBe(false); // exempt: updated every frame
          else (same ? kept : moved).add(i & 1);
        }
        expect(kept.size).toBeLessThanOrEqual(1);
        if (kept.size === 1) {
          expect(moved.has([...kept][0] ?? -1)).toBe(false);
          interleaved++;
        }
      }
      prev = cur;
    }
    expect(interleaved).toBeGreaterThan(10);
    // Kept rows that are drawn in the sky have this frame's ENU and last frame's ground point (rows skipped
    // entirely, below the cut-off, keep both).
    expect(staleGroundRows(frame, catalog.count).length).toBeGreaterThan(100);
    // Paused: the next frame runs every row once, though nothing else changed.
    actions.pause();
    await run.frame(41 * (1000 / 60));
    expect(staleGroundRows(frame, catalog.count)).toEqual([]);
  });
});
