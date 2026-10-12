// tests/unit/arcs.test.ts — exposure arcs (M4 step 16, README section 5 "arc"): the worker's arc reply, the ephemeris
// client's requests, and the sky satellites layer's arc geometry. The committed cfht-nanaao has exposureSec 0 and the
// 60 s ASK053 is not enabled yet, so the client tests run on a synthetic still-image camera: cfht-nanaao with 60 s.
import { readFileSync } from "node:fs";
import MultiLineString from "ol/geom/MultiLineString";
import { json2satrec, type SatRec } from "satellite.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exposureArcGrid } from "../../src/app/stillImage";
import { apparentAltDeg } from "../../src/domain/astro";
import {
  type CameraModel,
  createCameraModel,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
  toSkyMapCoord,
} from "../../src/domain/camera";
import { azAltToEnuUnit, enuToAzAltDeg, type ObserverSite } from "../../src/domain/geo";
import {
  appendGroup,
  createPropagationContext,
  parseGpFile,
  SAMPLE_STRIDE,
  SampleField,
  writeSample,
} from "../../src/domain/orbits";
import {
  createSkySatellites,
  LineWriter,
  type SkySatellites,
  trackedSkyIndices,
  writeSkyArcs,
  writeSkySatellites,
  writeTrails,
} from "../../src/map/sky/layers/satellites";
import type { ExposureArc, SatCatalog } from "../../src/state/ephemeris";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig, StillImageCamera } from "../../src/state/types";
import type {
  CatalogDelta,
  PropagationIn,
  PropagationOut,
  SkyPathOut,
} from "../../src/workers/protocol";
import { type FakeSat, fakeCatalog, fakeFrame } from "../helpers/satFrame";
import { committedCameras, storeAt } from "../helpers/store";

const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const T_PASS_ISO = "2026-10-11T15:09:50Z"; // ISS at az 123.8°, geometric alt 28.84°, sunlit, Sun at −16.2°
const T_PASS = Date.parse(T_PASS_ISO);
const SNAPSHOT_MS = 1791690621000;
const BASE = "http://localhost:4173/Overhead/data/gp/";
const APP_HREF = "http://localhost:4173/Overhead/";

type In<T extends PropagationIn["type"]> = Extract<PropagationIn, { type: T }>;
type Out<T extends PropagationOut["type"]> = Extract<PropagationOut, { type: T }>;

const fixture = (file: string): string =>
  readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8");

function grid60(frameTimeMs: number) {
  const grid = exposureArcGrid(frameTimeMs, 60);
  if (grid === null) throw new Error("a 60 s exposure must have an arc grid");
  return grid;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- part 1: the worker's arc message

interface WorkerHarness {
  send(msg: PropagationIn): void;
  posted: { msg: PropagationOut; transfer: Transferable[] }[];
  of<T extends PropagationOut["type"]>(type: T): Out<T>[];
}

/** Imports a fresh worker module with stubbed globals; fetch serves the committed snapshot. */
async function startWorker(): Promise<WorkerHarness> {
  const posted: WorkerHarness["posted"] = [];
  let listener: ((e: MessageEvent<PropagationIn>) => void) | null = null;
  vi.stubGlobal(
    "addEventListener",
    (_type: string, fn: (e: MessageEvent<PropagationIn>) => void) => {
      listener = fn;
    },
  );
  vi.stubGlobal("postMessage", (msg: PropagationOut, options: { transfer?: Transferable[] }) => {
    posted.push({ msg, transfer: options.transfer ?? [] });
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(BASE)) throw new Error(`unexpected fetch ${url}`);
    return new Response(fixture(url.slice(BASE.length)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.resetModules();
  await import("../../src/workers/propagation.worker");
  return {
    send(msg) {
      if (listener === null) throw new Error("the worker registered no message listener");
      listener(new MessageEvent("message", { data: msg }));
    },
    posted,
    of: <T extends PropagationOut["type"]>(type: T) =>
      posted.map((p) => p.msg).filter((m): m is Out<T> => m.type === type),
  };
}

async function workerWithStationsAndVisual(): Promise<WorkerHarness> {
  const w = await startWorker();
  w.send({ type: "init", site: SITE, generation: 0 });
  w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
  w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
  await vi.waitFor(() => expect(w.of("groupLoaded")).toHaveLength(2));
  return w;
}

/** The same snapshot through the domain functions directly: the reference. */
function referenceSatrecs(): { satrecs: SatRec[]; docked: boolean[] } {
  const seen = new Set<number>();
  const entries = [
    ...appendGroup(seen, "stations", parseGpFile(JSON.parse(fixture("stations.json")))),
    ...appendGroup(seen, "visual", parseGpFile(JSON.parse(fixture("visual.json")))),
  ];
  return {
    satrecs: entries.map((e) => json2satrec(e.omm)),
    docked: entries.map((e) => e.dockedWith !== null),
  };
}

/** The catalogue the client would build from the worker's groupLoaded replies. */
function catalogFrom(w: WorkerHarness): SatCatalog {
  const loaded = w.of("groupLoaded");
  const catalog: SatCatalog = {
    count: 0,
    noradIds: Int32Array.from(loaded.flatMap((g) => [...g.catalog.noradIds])),
    names: loaded.flatMap((g) => g.catalog.names),
    groupIndex: Uint8Array.from(loaded.flatMap((g) => [...g.catalog.groupIndex])),
    epochMs: Float64Array.from(loaded.flatMap((g) => [...g.catalog.epochMs])),
    dockedWith: Int32Array.from(loaded.flatMap((g) => [...g.catalog.dockedWith])),
    indexByNorad: new Map(),
  };
  catalog.count = catalog.noradIds.length;
  catalog.noradIds.forEach((id, i) => {
    catalog.indexByNorad.set(id, i);
  });
  return catalog;
}

describe("worker: arc", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("writes step s, object i at (s × count + i) × SAMPLE_STRIDE, bit for bit writeSample at startMs + s·stepMs", async () => {
    const w = await workerWithStationsAndVisual();
    const grid = grid60(T_PASS); // 13 samples from T − 30 s to T + 30 s
    const count = 175;
    const buffer = new ArrayBuffer(grid.steps * count * SAMPLE_STRIDE * 4);
    w.send({ type: "arc", requestId: 3, ...grid, groups: 0b011, buffer });
    const reply = w.posted.at(-1);
    if (reply?.msg.type !== "arc") throw new Error("no arc reply");
    expect(reply.msg).toEqual({
      type: "arc",
      requestId: 3,
      startMs: T_PASS - 30_000,
      stepMs: 5_000,
      steps: 13,
      buffer,
    });
    expect(reply.msg.buffer).toBe(buffer); // the same buffer back, transferred
    expect(reply.transfer).toEqual([buffer]);

    const ref = referenceSatrecs();
    const expected = new Float32Array(grid.steps * count * SAMPLE_STRIDE);
    for (let s = 0; s < grid.steps; s++) {
      const ctx = createPropagationContext(grid.startMs + s * grid.stepMs, SITE);
      ref.satrecs.forEach((satrec, i) => {
        if (!ref.docked[i]) writeSample(satrec, ctx, expected, s * count + i);
      });
    }
    // Bit for bit: compare the words, so +0/−0 and NaN payloads count too.
    expect(new Uint32Array(buffer)).toEqual(new Uint32Array(expected.buffer));

    // The middle step is the ordinary position at frameTimeMs, where picking happens.
    const iss = ref.satrecs[0];
    if (iss === undefined) throw new Error("no ISS");
    const slot = new Float32Array(SAMPLE_STRIDE);
    writeSample(iss, createPropagationContext(T_PASS, SITE), slot, 0);
    const mid = 6 * count * SAMPLE_STRIDE;
    expect([...new Float32Array(buffer).subarray(mid, mid + SAMPLE_STRIDE)]).toEqual([...slot]);
  });

  it("zeroes docked objects and objects outside the group mask in every step", async () => {
    const w = await workerWithStationsAndVisual();
    const steps = 3;
    const count = 175;
    const buffer = new ArrayBuffer(steps * count * SAMPLE_STRIDE * 4);
    new Float32Array(buffer).fill(7); // a reused buffer's old contents must not survive
    w.send({
      type: "arc",
      requestId: 1,
      startMs: T_PASS,
      stepMs: 5_000,
      steps,
      groups: 0b001,
      buffer,
    });
    const data = new Float32Array(buffer);
    const { docked } = referenceSatrecs();
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < count; i++) {
        const o = (s * count + i) * SAMPLE_STRIDE;
        const slot = [...data.subarray(o, o + SAMPLE_STRIDE)];
        if (i >= 22 || docked[i]) expect(slot).toEqual(new Array(SAMPLE_STRIDE).fill(0));
        else expect(slot[SampleField.valid]).toBe(1);
      }
    }
  });

  it("takes the rows per step from the buffer size", async () => {
    const w = await workerWithStationsAndVisual();
    const steps = 4;
    const count = 22; // a buffer sized before visual loaded
    const buffer = new ArrayBuffer(steps * count * SAMPLE_STRIDE * 4);
    w.send({
      type: "arc",
      requestId: 2,
      startMs: T_PASS,
      stepMs: 5_000,
      steps,
      groups: 0b011,
      buffer,
    });
    expect(w.of("arc").at(-1)?.buffer.byteLength).toBe(steps * count * SAMPLE_STRIDE * 4);
    const iss = referenceSatrecs().satrecs[0];
    if (iss === undefined) throw new Error("no ISS");
    const slot = new Float32Array(SAMPLE_STRIDE);
    writeSample(iss, createPropagationContext(T_PASS + 3 * 5_000, SITE), slot, 0);
    const o = 3 * count * SAMPLE_STRIDE; // step 3, object 0
    expect([...new Float32Array(buffer).subarray(o, o + SAMPLE_STRIDE)]).toEqual([...slot]);
  });

  it("replies with an error message, not an arc, before init", async () => {
    const w = await startWorker();
    w.send({
      type: "arc",
      requestId: 1,
      startMs: T_PASS,
      stepMs: 5_000,
      steps: 2,
      groups: 0b011,
      buffer: new ArrayBuffer(2 * SAMPLE_STRIDE * 4),
    });
    expect(w.posted.map((p) => p.msg.type)).toEqual(["error"]);
  });
});

// ---- part 2: the ephemeris client's arc requests

/** A Worker stand-in: records what the main thread sends (cloned with transfer, as a browser does). */
class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly sent: PropagationIn[] = [];
  /** Each postMessage's transfer list: the sender's buffers, detached once sent. */
  readonly transfers: Transferable[][] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<(e: Event) => void>>();

  constructor(_url: URL | string, _options?: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: PropagationIn, transfer: Transferable[] = []): void {
    if (this.terminated) throw new Error("posted to a terminated worker");
    this.sent.push(structuredClone(msg, { transfer }));
    this.transfers.push(transfer);
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

  reply(msg: PropagationOut, transfer: Transferable[] = []): void {
    if (this.terminated) return;
    const data = structuredClone(msg, { transfer });
    for (const fn of this.listeners.get("message") ?? []) fn(new MessageEvent("message", { data }));
  }

  of<T extends PropagationIn["type"]>(type: T): In<T>[] {
    return this.sent.filter((m): m is In<T> => m.type === type);
  }
}

type EphemerisModule = typeof import("../../src/state/ephemeris");

async function loadEphemeris(): Promise<EphemerisModule> {
  vi.resetModules();
  return import("../../src/state/ephemeris");
}

function worker(): FakeWorker {
  const w = FakeWorker.instances.at(-1);
  if (w === undefined) throw new Error("no worker was created");
  return w;
}

const STILL_ID = "test-still-60s";

function nanaao(): StillImageCamera {
  const camera = committedCameras()["cfht-nanaao"];
  if (camera?.kind !== "still-image") throw new Error("cfht-nanaao must be a still-image camera");
  return camera;
}

/** cfht-nanaao under another id with another exposure (60 s: ASK053's night exposure, M4 step 7). */
function stillCamera(exposureSec = 60, id = STILL_ID): StillImageCamera {
  const base = nanaao();
  return { ...base, id, source: { ...base.source, exposureSec } };
}

function addCameras(store: AppStore, ...cameras: CameraConfig[]): void {
  const { registry } = store.getState().camera;
  const added = Object.fromEntries(cameras.map((c) => [c.id, c]));
  store.getState().actions.setRegistry({ ...registry, ...added });
}

function delta(firstIndex: number, rows: { norad: number; group: number; docked?: number }[]) {
  const catalog: CatalogDelta = {
    firstIndex,
    noradIds: Int32Array.from(rows.map((r) => r.norad)),
    names: rows.map((r) => `SAT ${r.norad}`),
    groupIndex: Uint8Array.from(rows.map((r) => r.group)),
    epochMs: Float64Array.from(rows.map(() => SNAPSHOT_MS)),
    dockedWith: Int32Array.from(rows.map((r) => r.docked ?? -1)),
  };
  return catalog;
}

function stationsLoaded(w: FakeWorker): void {
  w.reply({
    type: "groupLoaded",
    group: "stations",
    totalCount: 2,
    fetchedAtMs: SNAPSHOT_MS,
    catalog: delta(0, [
      { norad: 25544, group: 0 },
      { norad: 48274, group: 0 },
    ]),
  });
}

function visualLoaded(w: FakeWorker): void {
  w.reply({
    type: "groupLoaded",
    group: "visual",
    totalCount: 3,
    fetchedAtMs: SNAPSHOT_MS,
    catalog: delta(2, [{ norad: 19046, group: 1 }]),
  });
}

/** Answers an arc request with its own buffer, filled with `value`. */
function replyArc(w: FakeWorker, req: In<"arc"> | undefined, value = 1): void {
  if (req === undefined) throw new Error("no arc request to answer");
  new Float32Array(req.buffer).fill(value);
  const { requestId, startMs, stepMs, steps, buffer } = req;
  w.reply({ type: "arc", requestId, startMs, stepMs, steps, buffer }, [buffer]);
}

const bytes = (steps: number, count: number): number => steps * count * SAMPLE_STRIDE * 4;

describe("ephemeris: arc requests", () => {
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
  });

  /** A store on the 60 s camera with stations loaded (2 rows), and the started client. */
  async function onStillCamera(exposureSec = 60) {
    const eph = await loadEphemeris();
    const store = storeAt(T_PASS_ISO);
    addCameras(store, stillCamera(exposureSec));
    stops.push(eph.startEphemeris(store));
    const w = worker();
    stationsLoaded(w);
    store.getState().actions.setActiveCamera(STILL_ID);
    return { eph, store, w, actions: store.getState().actions };
  }

  it("sends one arc per frame time: exposureArcGrid's grid, the group mask and a transferred buffer", async () => {
    const { w, actions } = await onStillCamera();
    expect(w.of("arc")).toHaveLength(0); // no image yet
    actions.setFrameTimeMs(T_PASS);
    const [first] = w.of("arc");
    expect(first).toMatchObject({
      startMs: T_PASS - 30_000,
      stepMs: 5_000,
      steps: 13,
      groups: 0b011,
    });
    expect(first?.buffer.byteLength).toBe(bytes(13, 2)); // Float32Array(steps × count × SAMPLE_STRIDE)
    const transfer = w.transfers[w.sent.indexOf(first as PropagationIn)] ?? [];
    expect(transfer).toHaveLength(1);
    expect((transfer[0] as ArrayBuffer).byteLength).toBe(0); // detached: transferred, not copied

    // Other camera changes with the same frame time send nothing.
    actions.updateCalibration({ rollDeg: 45 });
    actions.setCameraStatus(STILL_ID, "live");
    expect(w.of("arc")).toHaveLength(1);

    actions.setFrameTimeMs(T_PASS + 60_000); // the next image
    const second = w.of("arc")[1];
    expect(second).toMatchObject({ startMs: T_PASS + 30_000, stepMs: 5_000, steps: 13 });
    expect(second?.requestId).toBeGreaterThan(first?.requestId ?? Number.POSITIVE_INFINITY);
    expect(w.of("arc")).toHaveLength(2);
  });

  it("sends nothing for cfht-nanaao (exposure 0), exposures up to 5 s, or the synthetic camera", async () => {
    const { w, store, actions } = await onStillCamera(1);
    addCameras(store, stillCamera(4.9, "test-still-4.9s"));
    actions.setFrameTimeMs(T_PASS); // 1 s: dots, never arcs
    actions.setActiveCamera("test-still-4.9s");
    actions.setFrameTimeMs(T_PASS); // one 5 s grid point: no segment to draw
    actions.setActiveCamera("cfht-nanaao");
    actions.setFrameTimeMs(T_PASS);
    actions.setActiveCamera("synthetic-maunakea");
    actions.setFrameTimeMs(T_PASS);
    expect(w.of("arc")).toHaveLength(0);
    addCameras(store, stillCamera(5, "test-still-5s"));
    actions.setActiveCamera("test-still-5s");
    actions.setFrameTimeMs(T_PASS);
    expect(w.of("arc")).toEqual([
      expect.objectContaining({ startMs: T_PASS - 2_500, stepMs: 5_000, steps: 2 }),
    ]);
  });

  it("keeps the newest reply, drawn only in live mode on the frame it was computed for", async () => {
    const { eph, store, w, actions } = await onStillCamera();
    actions.setFrameTimeMs(T_PASS);
    actions.setFrameTimeMs(T_PASS + 60_000);
    const [older, newer] = w.of("arc");
    replyArc(w, older, 1);
    expect(eph.ephemeris.arc).toBeNull(); // a reply to an older request
    replyArc(w, newer, 2);
    const arc = eph.ephemeris.arc;
    expect(arc).toMatchObject({
      frameTimeMs: T_PASS + 60_000,
      startMs: T_PASS + 30_000,
      stepMs: 5_000,
      steps: 13,
      count: 2,
    });
    expect(arc?.data.length).toBe(13 * 2 * SAMPLE_STRIDE);
    expect(arc?.data.every((v) => v === 2)).toBe(true);

    expect(store.getState().clock.mode).toBe("replay");
    expect(eph.drawableExposureArc(store.getState())).toBeNull(); // replay: sim time is not the frame time
    actions.setMode("live");
    expect(eph.drawableExposureArc(store.getState())).toBe(arc);
    actions.seek(T_PASS);
    expect(eph.drawableExposureArc(store.getState())).toBeNull();
  });

  it("re-requests when the catalogue grows, the group mask changes or the site moves; drops the arc on a camera switch", async () => {
    const { eph, store, w, actions } = await onStillCamera();
    actions.setMode("live");
    actions.setFrameTimeMs(T_PASS);
    replyArc(w, w.of("arc")[0]);
    const held = eph.ephemeris.arc;
    expect(held).not.toBeNull();

    visualLoaded(w); // one more row
    expect(w.of("arc")[1]?.buffer.byteLength).toBe(bytes(13, 3));
    expect(eph.ephemeris.arc).toBe(held); // its rows stay right until the larger reply arrives

    actions.setLayer("starlink", true);
    expect(w.sent.at(-1)).toMatchObject({ type: "arc", groups: 0b111 });
    expect(w.of("loadGroup").at(-1)?.group).toBe("starlink");
    expect(eph.ephemeris.arc).toBe(held);

    // The observer moves: the held arc is from the old site, and the new request follows setSite.
    const camera = store.getState().camera.registry[STILL_ID];
    if (camera === undefined) throw new Error("no still camera");
    addCameras(store, { ...camera, site: { ...camera.site, latDeg: 47.1, lonDeg: 9.3 } });
    // [M8] The moved entry is a new camera entry too: setCamera follows.
    expect(w.sent.slice(-3).map((m) => m.type)).toEqual(["setSite", "arc", "setCamera"]);
    expect(eph.ephemeris.arc).toBeNull();
    expect(eph.drawableExposureArc(store.getState())).toBeNull();
    const lastRequest = w.of("arc").at(-1);
    if (lastRequest === undefined) throw new Error("no arc request");
    const late = { ...lastRequest, buffer: new ArrayBuffer(lastRequest.buffer.byteLength) };
    replyArc(w, lastRequest);
    expect(eph.ephemeris.arc?.count).toBe(3);

    const requests = w.of("arc").length;
    actions.setActiveCamera("synthetic-maunakea"); // frameTimeMs → null
    expect(eph.ephemeris.arc).toBeNull();
    replyArc(w, late); // a second answer to it arriving late, after the camera switch
    expect(eph.ephemeris.arc).toBeNull();
    expect(w.of("arc")).toHaveLength(requests);
  });

  it("waits for the site and a loaded catalogue", async () => {
    const eph = await loadEphemeris();
    const store = createAppStore(initialState(T_PASS, STILL_ID)); // cameras.json not loaded yet
    store.getState().actions.setFrameTimeMs(T_PASS);
    stops.push(eph.startEphemeris(store));
    const w = worker();
    const { enabledCameras } = await import("../../src/app/cameras");
    store
      .getState()
      .actions.setRegistry({ ...enabledCameras(committedCameras()), [STILL_ID]: stillCamera() });
    // No rows to propagate yet; [M8] setCamera follows init.
    expect(w.sent.map((m) => m.type)).toEqual(["init", "setCamera", "loadGroup", "loadGroup"]);
    stationsLoaded(w);
    expect(w.of("arc")).toHaveLength(1);
    expect(w.of("arc")[0]?.buffer.byteLength).toBe(bytes(13, 2));
  });

  it("stop() drops the held arc", async () => {
    const { eph, w, actions } = await onStillCamera();
    actions.setFrameTimeMs(T_PASS);
    replyArc(w, w.of("arc")[0]);
    expect(eph.ephemeris.arc).not.toBeNull();
    for (const stop of stops) stop();
    stops = [];
    expect(eph.ephemeris.arc).toBeNull();
  });
});

// ---- part 3: the sky layer's arc geometry

const fisheye = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

/** Sky-map coordinate of an apparent az/alt through `model`, or null when culled. */
function mapXy(model: CameraModel, azDeg: number, altDeg: number): [number, number] | null {
  const uv = new Float64Array(2);
  if (!projectAzAltDeg(model, azDeg, altDeg, uv, 0)) return null;
  const out = [0, 0];
  toSkyMapCoord(model, uv[0] ?? 0, uv[1] ?? 0, out, 0);
  return [out[0] ?? 0, out[1] ?? 0];
}

/** One step of one object: geometric az/alt, sunlit and valid unless said otherwise. */
interface ArcPoint {
  az: number;
  alt: number;
  lit?: boolean;
  valid?: boolean;
}

/** An object's 5 steps along a straight az/alt line, with per-step overrides. */
function track(az0: number, alt0: number, overrides: Partial<ArcPoint>[] = []): ArcPoint[] {
  return Array.from({ length: 5 }, (_, s) => ({
    az: az0 + 4 * s,
    alt: alt0 + 2 * s,
    ...overrides[s],
  }));
}

/** An arc buffer laid out as the worker writes it: step s, object i at (s × count + i) × SAMPLE_STRIDE. */
function arcOf(rows: ArcPoint[][], frameTimeMs = T_PASS): ExposureArc {
  const count = rows.length;
  const steps = rows[0]?.length ?? 0;
  const data = new Float32Array(steps * count * SAMPLE_STRIDE);
  const unit = new Float64Array(3);
  rows.forEach((row, i) => {
    row.forEach((p, s) => {
      if (p.valid === false) return; // the whole slot stays 0, as writeSample leaves it
      const o = (s * count + i) * SAMPLE_STRIDE;
      azAltToEnuUnit(p.az, p.alt, unit, 0);
      for (let c = 0; c < 3; c++) data[o + c] = (unit[c] ?? 0) * 1000;
      data[o + SampleField.sunlit] = p.lit === false ? 0 : 1;
      data[o + SampleField.valid] = 1;
    });
  });
  return { frameTimeMs, startMs: frameTimeMs - 10_000, stepMs: 5_000, steps, count, data };
}

const SATS: FakeSat[] = [
  { norad: 25544, name: "ISS (ZARYA)", group: 0, azDeg: 108, altDeg: 34 }, // 0
  { norad: 19046, name: "SL-3 R/B", group: 1, azDeg: 208, altDeg: 24 }, // 1
  { norad: 10114, name: "SL-3 R/B", group: 1, azDeg: 18, altDeg: 4 }, // 2
  { norad: 44713, name: "STARLINK-1007", group: 2, azDeg: 308, altDeg: 54 }, // 3
  { norad: 36086, name: "POISK", group: 0, azDeg: 108, altDeg: 34, dockedWith: 25544 }, // 4
  { norad: 22222, name: "PART VALID", group: 1, azDeg: 158, altDeg: 64 }, // 5
  { norad: 33333, name: "IN SHADOW", group: 1, azDeg: 258, altDeg: 44, sunlit: false }, // 6
];

const ROWS: ArcPoint[][] = [
  track(100, 30), // 0 the ISS: one run of 5
  track(200, 20, [{}, {}, { lit: false }]), // 1 enters shadow at step 2: runs 0–1 and 3–4
  track(10, 0, [{ alt: 1 }, { alt: -5 }]), // 2 below the horizon at step 1: 0 alone (dropped), then 2–4
  track(300, 50), // 3 Starlink: its own line, in the Starlink source
  track(100, 30), // 4 docked to the ISS: never drawn
  track(150, 60, [{}, {}, {}, { valid: false }]), // 5 no position at step 3: run 0–2, 4 alone (dropped)
  track(
    250,
    40,
    Array.from({ length: 5 }, () => ({ lit: false })),
  ), // 6 in shadow throughout: nothing
];
const IDS = { iss: 0, selected: null, hovered: null } as const;

/** Expected flat coordinates of object i's steps [from, to] (apparent altitude, as the layer draws). */
function expectedRun(model: CameraModel, row: ArcPoint[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let s = from; s <= to; s++) {
    const p = row[s];
    const xy = p === undefined ? null : mapXy(model, p.az, apparentAltDeg(p.alt));
    if (xy === null) throw new Error(`step ${s} does not project`);
    out.push(...xy);
  }
  return out;
}

function expectCoords(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, k) => {
    expect(actual[k]).toBeCloseTo(v, 3); // Float32 ENU: ~1e-5 px
  });
}

function lineOf(sats: SkySatellites, group: number): MultiLineString {
  const line = sats.arcs[group]?.line;
  if (line === undefined) throw new Error(`no arc line for group ${group}`);
  return line;
}

describe("writeSkyArcs", () => {
  it("draws, per group, only segments whose both ends are valid, sunlit, above the horizon and projected", () => {
    const sats = createSkySatellites();
    const catalog = fakeCatalog(SATS);
    expect(writeSkyArcs(sats, fisheye, arcOf(ROWS), catalog)).toBe(true);
    expect(sats.arcsShown).toBe(true);

    const stations = lineOf(sats, 0);
    expect(stations.getEnds()).toEqual([10]); // the ISS only: its docked module is skipped
    expectCoords(stations.getFlatCoordinates(), expectedRun(fisheye, ROWS[0] ?? [], 0, 4));

    const visual = lineOf(sats, 1);
    expect(visual.getEnds()).toEqual([4, 8, 14, 20]);
    const r1 = ROWS[1] ?? [];
    const r2 = ROWS[2] ?? [];
    const r5 = ROWS[5] ?? [];
    expectCoords(visual.getFlatCoordinates(), [
      ...expectedRun(fisheye, r1, 0, 1),
      ...expectedRun(fisheye, r1, 3, 4),
      ...expectedRun(fisheye, r2, 2, 4),
      ...expectedRun(fisheye, r5, 0, 2),
    ]);

    const starlink = lineOf(sats, 2);
    expect(starlink.getEnds()).toEqual([10]);
    expectCoords(starlink.getFlatCoordinates(), expectedRun(fisheye, ROWS[3] ?? [], 0, 4));

    // Stations and visual arcs live in the satellites layer's source, Starlink's in its own: the toggles apply.
    const [a0, a1, a2] = sats.arcs;
    const satellitesSource = sats.satellitesLayer.getSource();
    const starlinkSource = sats.starlinkLayer.getSource();
    expect(a0 && satellitesSource?.hasFeature(a0.feature)).toBe(true);
    expect(a1 && satellitesSource?.hasFeature(a1.feature)).toBe(true);
    expect(a2 && starlinkSource?.hasFeature(a2.feature)).toBe(true);
  });

  it("leaves an empty group's line out of its source", () => {
    const sats = createSkySatellites();
    const rows = [
      track(100, 30),
      track(
        200,
        20,
        Array.from({ length: 5 }, () => ({ lit: false })),
      ),
    ];
    writeSkyArcs(sats, fisheye, arcOf(rows), fakeCatalog(SATS.slice(0, 2)));
    const [stations, visual, starlink] = sats.arcs;
    expect(stations && sats.satellitesLayer.getSource()?.hasFeature(stations.feature)).toBe(true);
    expect(visual && sats.satellitesLayer.getSource()?.hasFeature(visual.feature)).toBe(false);
    expect(starlink && sats.starlinkLayer.getSource()?.hasFeature(starlink.feature)).toBe(false);
  });

  it("hides the dots and trails while arcs show, and keeps picking at the frame time (the arc's midpoint)", () => {
    const catalog = fakeCatalog(SATS);
    const frame = fakeFrame(SATS, T_PASS);
    const plain = createSkySatellites();
    writeSkySatellites(plain, fisheye, frame, catalog, IDS, true, true);

    const sats = createSkySatellites();
    writeSkyArcs(sats, fisheye, arcOf(ROWS), catalog);
    writeSkySatellites(sats, fisheye, frame, catalog, IDS, true, true);
    for (const c of sats.classes) expect(c.source.hasFeature(c.feature)).toBe(false); // no dots
    expect([...sats.xy.subarray(0, 2 * SATS.length)]).toEqual([
      ...plain.xy.subarray(0, 2 * SATS.length),
    ]);
    expect([...sats.skip.subarray(0, SATS.length)]).toEqual([
      ...plain.skip.subarray(0, SATS.length),
    ]);
    expect([...sats.projected.subarray(0, SATS.length)]).toEqual([
      ...plain.projected.subarray(0, SATS.length),
    ]);

    // No trails: none are requested, except the selected satellite's path ahead, and none are drawn.
    const tracked = new Int32Array(100);
    expect(trackedSkyIndices(sats, catalog, null, true, true, tracked, 100)).toBe(0);
    expect(trackedSkyIndices(sats, catalog, 5, true, true, tracked, 100)).toBe(1);
    const path: SkyPathOut = {
      index: 5,
      firstPointMs: T_PASS - 20_000,
      enuKm: Float32Array.from([0, 500, 900, 0, 510, 900, 0, 520, 900]),
    };
    const geometry = new MultiLineString([], "XY", []);
    writeTrails(new LineWriter(geometry), sats, fisheye, new Map([[5, path]]), tracked, 1, T_PASS);
    expect(geometry.getFlatCoordinates()).toEqual([]);

    // Arcs off: the dots come back, the arc lines leave their sources.
    expect(writeSkyArcs(sats, fisheye, null, catalog)).toBe(true);
    expect(sats.arcsShown).toBe(false);
    for (const a of sats.arcs) {
      expect(sats.satellitesLayer.getSource()?.hasFeature(a.feature)).toBe(false);
      expect(sats.starlinkLayer.getSource()?.hasFeature(a.feature)).toBe(false);
    }
    writeSkySatellites(sats, fisheye, frame, catalog, IDS, true, true);
    const [, , visualLit] = sats.classes;
    expect(visualLit?.source.hasFeature(visualLit.feature)).toBe(true);
    expect(trackedSkyIndices(sats, catalog, null, true, true, tracked, 100)).toBeGreaterThan(0);
  });

  it("writes once per arc and camera model: an unchanged pair fires no change", () => {
    const sats = createSkySatellites();
    const catalog = fakeCatalog(SATS);
    const arc = arcOf(ROWS);
    writeSkyArcs(sats, fisheye, arc, catalog);
    let changes = 0;
    for (const a of sats.arcs) a.line.on("change", () => changes++);
    expect(writeSkyArcs(sats, fisheye, arc, catalog)).toBe(false);
    expect(changes).toBe(0);

    const before = [...lineOf(sats, 0).getFlatCoordinates()];
    const rolled = createCameraModel({
      ...fisheye,
      calibration: { ...fisheye.calibration, rollDeg: fisheye.calibration.rollDeg - 30 },
    });
    expect(writeSkyArcs(sats, rolled, arc, catalog)).toBe(true); // a calibration nudge redraws
    expect(lineOf(sats, 0).getFlatCoordinates()).not.toEqual(before);
    expectCoords(lineOf(sats, 0).getFlatCoordinates(), expectedRun(rolled, ROWS[0] ?? [], 0, 4));
    expect(writeSkyArcs(sats, rolled, arcOf(ROWS, T_PASS + 60_000), catalog)).toBe(false); // same points
    expect(writeSkyArcs(sats, rolled, null, catalog)).toBe(true);
    expect(writeSkyArcs(sats, rolled, null, catalog)).toBe(false);
  });
});

// ---- part 4: the real worker's ISS arc through the layer

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

describe("the ISS's 60 s arc on the Nānā ao model", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("passes through the ISS's position at frameTimeMs and stays within 0.15 px of its true path", async () => {
    const w = await workerWithStationsAndVisual();
    const grid = grid60(T_PASS);
    const count = 175;
    const buffer = new ArrayBuffer(grid.steps * count * SAMPLE_STRIDE * 4);
    w.send({ type: "arc", requestId: 1, ...grid, groups: 0b011, buffer });
    const arc: ExposureArc = {
      frameTimeMs: T_PASS,
      ...grid,
      count,
      data: new Float32Array(buffer),
    };
    const camera = nanaao();
    const model = createCameraModel({
      lens: camera.lens,
      calibration: camera.defaults,
      widthPx: camera.imageSize.widthPx,
      heightPx: camera.imageSize.heightPx,
    });
    const sats = createSkySatellites();
    writeSkyArcs(sats, model, arc, catalogFrom(w));
    const stations = lineOf(sats, 0);
    expect(stations.getEnds()[0]).toBe(2 * 13); // the ISS (index 0) is sunlit and up for the whole exposure
    const flat = stations.getFlatCoordinates();

    const iss = referenceSatrecs().satrecs[0];
    if (iss === undefined) throw new Error("no ISS");
    const slot = new Float32Array(SAMPLE_STRIDE);
    const azAlt = new Float64Array(2);
    const truth = (timeMs: number): [number, number] => {
      writeSample(iss, createPropagationContext(timeMs, SITE), slot, 0);
      enuToAzAltDeg(slot[0] ?? 0, slot[1] ?? 0, slot[2] ?? 0, azAlt, 0);
      const xy = mapXy(model, azAlt[0] ?? 0, apparentAltDeg(azAlt[1] ?? 0));
      if (xy === null) throw new Error("the ISS left the frame");
      return xy;
    };
    const [midX, midY] = truth(T_PASS);
    expect(flat[12]).toBeCloseTo(midX, 9); // step 6 is frameTimeMs, where its dot and picking are
    expect(flat[13]).toBeCloseTo(midY, 9);

    let worst = 0;
    for (let j = 0; j < 12; j++) {
      for (let t = 0; t <= 5_000; t += 250) {
        const [x, y] = truth(grid.startMs + j * grid.stepMs + t);
        const d = segmentDistance(
          x,
          y,
          flat[2 * j] ?? 0,
          flat[2 * j + 1] ?? 0,
          flat[2 * j + 2] ?? 0,
          flat[2 * j + 3] ?? 0,
        );
        worst = Math.max(worst, d);
      }
    }
    expect(worst).toBeLessThan(0.15); // 5 s chords: within 0.104 px over 42 ISS windows (M4 step 16)
  });
});
