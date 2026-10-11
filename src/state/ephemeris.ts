// src/state/ephemeris.ts — the propagation-worker client (M3 step 11, README sections 5 and 6): the satellite
// catalogue, the per-frame satellite arrays, ground tracks and sky paths. High-rate data lives here, never in the store.
import { fromEPSG4326 } from "ol/proj/epsg3857";
import { apparentAltDeg } from "../domain/astro";
import {
  ecefToLatLonDeg,
  enuToAzAltDeg,
  enuToEcef,
  enuToEcefMatrix,
  geodeticToEcefKm,
  type Mat3,
  type ObserverSite,
} from "../domain/geo";
import {
  GP_GROUPS,
  type GpGroup,
  interpModeForRate,
  interpolateEnuKm,
  isVisible,
  SAMPLE_STRIDE,
  sunlitAt,
} from "../domain/orbits";
import type {
  CatalogDelta,
  PropagationIn,
  PropagationOut,
  SkyPathOut,
  TrackOut,
} from "../workers/protocol";
import { frameCount, registerFrameUpdater } from "./clockLoop";
import { noradIdOf } from "./objectId";
import { SampleClient } from "./sampleClient";
import { selectGroupMask, selectSampleStepMs, selectSite } from "./selectors";
import type { AppStore } from "./store";
import type { CameraSite, ObjectId } from "./types";

export interface SatCatalog {
  count: number;
  noradIds: Int32Array;
  names: string[];
  groupIndex: Uint8Array;
  epochMs: Float64Array;
  dockedWith: Int32Array;
  indexByNorad: Map<number, number>;
}
export interface SatFrame {
  timeMs: number;
  ready: boolean;
  sunAltDeg: number;
  enuKm: Float64Array;
  azAltDeg: Float64Array; // altitude apparent
  rangeKm: Float64Array;
  lonLatDeg: Float64Array;
  mercator: number[]; // EPSG:3857 [x, y] per index
  flags: Uint8Array; // bit 0 valid, 1 sunlit, 2 above horizon, 3 visible
}
export interface Ephemeris {
  catalog: SatCatalog;
  frame: SatFrame;
  tracks: Map<number, TrackOut>;
  skyPaths: Map<number, SkyPathOut>;
  pathsVersion: number;
}

const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
const FLAG_ABOVE_HORIZON = 4;
const FLAG_VISIBLE = 8;
/** M3 uses the geometric horizon everywhere (M6 swaps in horizonAltAtAzDeg). */
const HORIZON_DEG = 0;

/**
 * The app's one ephemeris. Its objects keep their identity for the session (consumers may hold `ephemeris.catalog`
 * or `ephemeris.frame`); the typed arrays inside are replaced when a group loads, so read them through the object.
 */
export const ephemeris: Ephemeris = {
  catalog: {
    count: 0,
    noradIds: new Int32Array(0),
    names: [],
    groupIndex: new Uint8Array(0),
    epochMs: new Float64Array(0),
    dockedWith: new Int32Array(0),
    indexByNorad: new Map(),
  },
  frame: {
    timeMs: Number.NaN,
    ready: false,
    sunAltDeg: Number.NaN,
    enuKm: new Float64Array(0),
    azAltDeg: new Float64Array(0),
    rangeKm: new Float64Array(0),
    lonLatDeg: new Float64Array(0),
    mercator: [],
    flags: new Uint8Array(0),
  },
  tracks: new Map(),
  skyPaths: new Map(),
  pathsVersion: 0,
};

interface Session {
  readonly store: AppStore;
  readonly send: (msg: PropagationIn, transfer?: Transferable[]) => void;
  readonly client: SampleClient;
  /** The observer the worker propagates for; null until the first non-null site (init). */
  site: ObserverSite | null;
  readonly observerEcefKm: Float64Array; // O
  enuToEcef: Mat3; // M
  /**
   * The sample generation sent with the last init or setSite. Sky paths requested before it hold ENU from an older
   * observer; other flushes (a seek, a rate, mask or catalogue change) leave paths valid.
   */
  siteGeneration: number;
  starlinkRequested: boolean;
  tracksRequestId: number;
  skyPathsRequestId: number;
}

let session: Session | null = null;

// Per-frame cache: computes once per frameCount(), and skips the loop while time, pair and mask are unchanged.
let computedFrame = -1;
let lastA: unknown = null;
let lastB: unknown = null;
let lastGroups = -1;
const ecef = new Float64Array(3);
const latLon = new Float64Array(2);

function gpUrl(group: GpGroup): string {
  // Absolute (gotcha 15): a relative URL resolves against the worker script's folder.
  return new URL(`${import.meta.env.BASE_URL}data/gp/${group}.json`, location.href).href;
}

function forgetFrame(): void {
  computedFrame = -1;
  lastA = null;
  lastB = null;
  lastGroups = -1;
}

/** Per-frame arrays for `count` objects, all invalid. */
function sizeFrame(count: number): void {
  const f = ephemeris.frame;
  f.ready = false;
  f.enuKm = new Float64Array(3 * count);
  f.azAltDeg = new Float64Array(2 * count);
  f.rangeKm = new Float64Array(count);
  f.lonLatDeg = new Float64Array(2 * count);
  f.mercator = new Array<number>(2 * count).fill(0);
  f.flags = new Uint8Array(count);
  forgetFrame();
}

/** Back to an empty catalogue (start and stop): the worker's catalogue only appends, so a new worker starts over. */
function resetEphemeris(): void {
  const c = ephemeris.catalog;
  c.count = 0;
  c.noradIds = new Int32Array(0);
  c.names.length = 0;
  c.groupIndex = new Uint8Array(0);
  c.epochMs = new Float64Array(0);
  c.dockedWith = new Int32Array(0);
  c.indexByNorad.clear();
  sizeFrame(0);
  ephemeris.frame.timeMs = Number.NaN;
  ephemeris.frame.sunAltDeg = Number.NaN;
  ephemeris.tracks.clear();
  ephemeris.skyPaths.clear();
  ephemeris.pathsVersion++;
}

function concat<T extends Int32Array | Uint8Array | Float64Array>(
  old: T,
  add: T,
  make: (n: number) => T,
): T {
  const out = make(old.length + add.length);
  out.set(old);
  out.set(add, old.length);
  return out;
}

function appendCatalog(delta: CatalogDelta): void {
  const c = ephemeris.catalog;
  if (delta.firstIndex !== c.count) {
    throw new Error(`catalogue rows out of order: firstIndex ${delta.firstIndex}, have ${c.count}`);
  }
  c.noradIds = concat(c.noradIds, delta.noradIds, (n) => new Int32Array(n));
  c.groupIndex = concat(c.groupIndex, delta.groupIndex, (n) => new Uint8Array(n));
  c.epochMs = concat(c.epochMs, delta.epochMs, (n) => new Float64Array(n));
  c.dockedWith = concat(c.dockedWith, delta.dockedWith, (n) => new Int32Array(n));
  for (let i = 0; i < delta.noradIds.length; i++) {
    c.names.push(delta.names[i] ?? "");
    c.indexByNorad.set(delta.noradIds[i] ?? -1, c.count + i);
  }
  c.count += delta.noradIds.length;
}

function setObserver(s: Session, site: ObserverSite): void {
  s.site = site;
  geodeticToEcefKm(site.latDeg, site.lonDeg, site.heightM, s.observerEcefKm, 0);
  s.enuToEcef = enuToEcefMatrix(site.latDeg, site.lonDeg);
}

function loadGroup(s: Session, group: GpGroup): void {
  s.store.getState().actions.setGroupData(group, { status: "loading" });
  s.send({ type: "loadGroup", group, url: gpUrl(group) });
}

/** Starlink loads the first time its toggle is on, and again after a groupError; never before stations and visual. */
function maybeLoadStarlink(s: Session): void {
  if (s.site === null || s.starlinkRequested || !s.store.getState().layers.starlink) return;
  s.starlinkRequested = true;
  loadGroup(s, "starlink");
}

function onSite(s: Session, cameraSite: CameraSite | null): void {
  if (cameraSite === null) return; // cameras.json has not loaded yet
  const site: ObserverSite = {
    latDeg: cameraSite.latDeg,
    lonDeg: cameraSite.lonDeg,
    heightM: cameraSite.heightM,
  };
  const prev = s.site;
  if (prev === null) {
    setObserver(s, site);
    s.siteGeneration = s.client.generation;
    s.send({ type: "init", site, generation: s.siteGeneration });
    loadGroup(s, "stations"); // strictly in this order (gotcha 22)
    loadGroup(s, "visual");
    maybeLoadStarlink(s);
    return;
  }
  if (prev.latDeg === site.latDeg && prev.lonDeg === site.lonDeg && prev.heightM === site.heightM) {
    return; // another camera at the same point
  }
  s.client.flush(); // samples for the old observer are discarded when they come back
  setObserver(s, site);
  s.siteGeneration = s.client.generation;
  s.send({ type: "setSite", site, generation: s.siteGeneration });
  ephemeris.skyPaths.clear(); // ENU from the old observer
  ephemeris.pathsVersion++;
}

function onMessage(s: Session, msg: PropagationOut): void {
  const { actions } = s.store.getState();
  switch (msg.type) {
    case "groupLoaded": {
      appendCatalog(msg.catalog);
      sizeFrame(ephemeris.catalog.count);
      s.client.resize(msg.totalCount);
      let count = 0;
      for (const host of msg.catalog.dockedWith) if (host === -1) count++;
      actions.setGroupData(msg.group, { status: "ready", fetchedAtMs: msg.fetchedAtMs, count });
      break;
    }
    case "groupError":
      if (msg.group === "starlink") s.starlinkRequested = false; // retried only on the next turn-on
      actions.setGroupData(msg.group, { status: "error" });
      console.warn(`GP group ${msg.group} failed to load: ${msg.message}`);
      break;
    case "sample":
      s.client.onSample(msg);
      // The worker budget (README section 9), collected by tests/perf/propagation.perf.ts.
      performance.measure("overhead:propagate", {
        start: performance.now() - msg.computeMs,
        duration: msg.computeMs,
      });
      performance.clearMeasures("overhead:propagate");
      break;
    case "tracks":
      if (msg.requestId !== s.tracksRequestId) return; // an older request
      ephemeris.tracks.clear(); // every reply holds every requested track
      for (const t of msg.tracks) ephemeris.tracks.set(t.index, t);
      ephemeris.pathsVersion++;
      break;
    case "skyPaths":
      // An older request, or one sent before the observer moved.
      if (msg.requestId !== s.skyPathsRequestId || msg.generation < s.siteGeneration) return;
      ephemeris.skyPaths.clear();
      for (const p of msg.paths) ephemeris.skyPaths.set(p.index, p);
      ephemeris.pathsVersion++;
      break;
    case "error":
      console.error(`Propagation worker: ${msg.message}`);
      break;
    case "arc": // [M4]
    case "incoming": // [M8]
      break;
  }
}

/**
 * Creates the propagation worker (called once in main.tsx). Waits for the first non-null site, then sends `init` and
 * loads stations and visual; Starlink loads when its toggle is first on. Registers updateEphemerisFrame as a frame
 * updater. Returns stop(): terminates the worker and clears the catalogue.
 */
export function startEphemeris(store: AppStore): () => void {
  if (session !== null) throw new Error("ephemeris is already started");
  resetEphemeris();
  const worker = new Worker(new URL("../workers/propagation.worker.ts", import.meta.url), {
    type: "module",
  });
  const send = (msg: PropagationIn, transfer: Transferable[] = []): void =>
    worker.postMessage(msg, transfer);
  const s: Session = {
    store,
    send,
    client: new SampleClient(send),
    site: null,
    siteGeneration: 0,
    observerEcefKm: new Float64Array(3),
    enuToEcef: new Float64Array(9),
    starlinkRequested: false,
    tracksRequestId: 0,
    skyPathsRequestId: 0,
  };
  session = s;
  worker.addEventListener("message", (e: MessageEvent<PropagationOut>) => {
    if (session === s) onMessage(s, e.data);
  });
  worker.addEventListener("error", (e: ErrorEvent) => {
    if (session !== s) return;
    // The worker script itself failed (it catches its own errors): nothing that is loading will arrive.
    console.error(`Propagation worker failed: ${e.message}`);
    const { data, actions } = store.getState();
    for (const group of GP_GROUPS) {
      if (data.gp[group].status === "loading") actions.setGroupData(group, { status: "error" });
    }
  });
  const unsubscribeSite = store.subscribe(selectSite, (site) => onSite(s, site), {
    fireImmediately: true,
  });
  const unsubscribeStarlink = store.subscribe(
    (st) => st.layers.starlink,
    () => maybeLoadStarlink(s),
  );
  const unregister = registerFrameUpdater(updateEphemerisFrame);
  return () => {
    if (session !== s) return;
    unregister();
    unsubscribeSite();
    unsubscribeStarlink();
    worker.terminate();
    session = null;
    resetEphemeris();
  };
}

/**
 * Interpolates every object for this frame: ENU (linear, or Hermite at 600×) → az/alt → apparent alt (valid objects
 * only: gotcha 17) → range → sunlit from the nearer sample → ECEF = O + M·ENU → Bowring → EPSG:3857 in place.
 * Computes once per frameCount(); registered at boot and called first by every satellite layer updater.
 */
export function updateEphemerisFrame(simTimeMs: number): SatFrame {
  const frame = ephemeris.frame;
  const s = session;
  const n = frameCount();
  if (s === null || n === computedFrame) return frame;
  computedFrame = n;
  const state = s.store.getState();
  const groups = selectGroupMask(state);
  const pair = s.client.frame(simTimeMs, selectSampleStepMs(state), groups);
  if (pair === null) {
    // Nothing held for this time (start, a seek, a flush): no object has a position.
    if (frame.ready) frame.flags.fill(0);
    frame.ready = false;
    frame.timeMs = simTimeMs;
    lastA = null;
    lastB = null;
    return frame;
  }
  const { a, b } = pair;
  if (
    frame.ready &&
    simTimeMs === frame.timeMs &&
    a === lastA &&
    b === lastB &&
    groups === lastGroups
  ) {
    return frame;
  }
  lastA = a;
  lastB = b;
  lastGroups = groups;
  frame.ready = true;
  frame.timeMs = simTimeMs;
  // The Sun's altitude from the same sample sunlitAt reads: b only when it is strictly nearer.
  const sunAltDeg = simTimeMs - a.timeMs > b.timeMs - simTimeMs ? b.sunAltDeg : a.sunAltDeg;
  frame.sunAltDeg = sunAltDeg;
  const mode = interpModeForRate(state.clock.mode === "live" ? 1 : state.clock.rate);
  const { catalog } = ephemeris;
  const { enuKm, azAltDeg, rangeKm, lonLatDeg, mercator, flags } = frame;
  const m = s.enuToEcef;
  const ox = s.observerEcefKm[0] ?? 0;
  const oy = s.observerEcefKm[1] ?? 0;
  const oz = s.observerEcefKm[2] ?? 0;
  const count = Math.min(catalog.count, flags.length, a.data.length / SAMPLE_STRIDE);
  for (let i = 0; i < count; i++) {
    const i2 = 2 * i;
    const i3 = 3 * i;
    if (!interpolateEnuKm(a.data, a.timeMs, b.data, b.timeMs, i, simTimeMs, mode, enuKm, i3)) {
      flags[i] = 0;
      lonLatDeg[i2] = 0;
      lonLatDeg[i2 + 1] = 0;
      mercator[i2] = 0;
      mercator[i2 + 1] = 0;
      continue;
    }
    const e = enuKm[i3] ?? 0;
    const nn = enuKm[i3 + 1] ?? 0;
    const u = enuKm[i3 + 2] ?? 0;
    enuToAzAltDeg(e, nn, u, azAltDeg, i2);
    const altDeg = apparentAltDeg(azAltDeg[i2 + 1] ?? 0);
    azAltDeg[i2 + 1] = altDeg;
    rangeKm[i] = Math.hypot(e, nn, u);
    const sunlit = sunlitAt(a.data, a.timeMs, b.data, b.timeMs, i, simTimeMs);
    enuToEcef(m, e, nn, u, ecef, 0);
    ecefToLatLonDeg(ox + (ecef[0] ?? 0), oy + (ecef[1] ?? 0), oz + (ecef[2] ?? 0), latLon, 0);
    const lon = latLon[1] ?? 0;
    const lat = latLon[0] ?? 0;
    lonLatDeg[i2] = lon;
    lonLatDeg[i2 + 1] = lat;
    mercator[i2] = lon;
    mercator[i2 + 1] = lat;
    const group = GP_GROUPS[catalog.groupIndex[i] ?? 0] ?? "stations";
    flags[i] =
      FLAG_VALID |
      (sunlit ? FLAG_SUNLIT : 0) |
      (altDeg > HORIZON_DEG ? FLAG_ABOVE_HORIZON : 0) |
      (isVisible(sunlit, sunAltDeg, group, altDeg, HORIZON_DEG) ? FLAG_VISIBLE : 0);
  }
  fromEPSG4326(mercator, mercator);
  return frame;
}

/** Ground tracks: selected ±10 min, others ±3 min. Replies to older requests are ignored. */
export function requestTracks(
  timeMs: number,
  selectedIndex: number | null,
  otherIndices: Int32Array,
): void {
  const s = session;
  if (s === null) return;
  s.tracksRequestId++;
  // Not transferred: the caller may reuse otherIndices; structured clone copies it.
  s.send({ type: "tracks", requestId: s.tracksRequestId, timeMs, selectedIndex, otherIndices });
}

/** Trails and the selected 2-minute path. Replies to older requests, or sent before a site change, are ignored. */
export function requestSkyPaths(fromMs: number, toMs: number, indices: Int32Array): void {
  const s = session;
  if (s === null) return;
  s.skyPathsRequestId++;
  s.send({
    type: "skyPaths",
    requestId: s.skyPathsRequestId,
    generation: s.client.generation,
    fromMs,
    toMs,
    indices,
  });
}

/** Docked ids map to their host's index. */
export function indexOfObjectId(id: ObjectId): number | null {
  const norad = noradIdOf(id);
  if (norad === null) return null;
  const { catalog } = ephemeris;
  const index = catalog.indexByNorad.get(norad);
  if (index === undefined) return null;
  const host = catalog.dockedWith[index] ?? -1;
  return host === -1 ? index : (catalog.indexByNorad.get(host) ?? null);
}
