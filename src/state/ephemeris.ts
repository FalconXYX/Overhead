// src/state/ephemeris.ts — the propagation-worker client (M3 step 11, README sections 5 and 6): the satellite
// catalogue, the per-frame satellite arrays, ground tracks, sky paths and a still image's exposure arc (M4 step 16);
// [M8] the camera model and terrain profile for the incoming check, its paced requests and latest reply, and the
// geodetic height of an object (step 6.2). High-rate data lives here, never in the store.
import { HALF_SIZE, MAX_SAFE_Y, RADIUS } from "ol/proj/epsg3857";
import { shallow } from "zustand/vanilla/shallow";
import { clipGpBaseUrl } from "../app/clip";
import { exposureArcGrid } from "../app/stillImage";
import { apparentAltDeg } from "../domain/astro";
import {
  ecefToLatLonDeg,
  enuToAzAltDeg,
  enuToEcef,
  enuToEcefMatrix,
  geodeticHeightKm,
  geodeticToEcefKm,
  type Mat3,
  type ObserverSite,
} from "../domain/geo";
import {
  belowSkyCutoff,
  GP_GROUPS,
  type GpGroup,
  interpModeForRate,
  interpolateEnuKm,
  isVisible,
  SAMPLE_STRIDE,
  SampleField,
  sunlitAt,
} from "../domain/orbits";
import { horizonAltAtAzDeg } from "../domain/terrain";
import type {
  CatalogDelta,
  PropagationIn,
  PropagationOut,
  SkyPathOut,
  TrackOut,
} from "../workers/protocol";
import { frameCount, registerFrameUpdater } from "./clockLoop";
import { IncomingClient } from "./incomingClient";
import { noradIdOf } from "./objectId";
import { type HeldSample, SampleClient } from "./sampleClient";
import {
  selectActiveCamera,
  selectCalibration,
  selectGroupMask,
  selectHorizonProfileDeg,
  selectIncomingActive,
  selectIncomingMask,
  selectSampleStepMs,
  selectSite,
} from "./selectors";
import type { AppStore } from "./store";
import type { AppState, Calibration, CameraConfig, CameraSite, ObjectId } from "./types";

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
/**
 * [M4] A still image's exposure arc (step 16): the worker's `arc` reply. Step s, object i at
 * (s × count + i) × SAMPLE_STRIDE, at startMs + s × stepMs. Read-only once held; a new reply replaces the object.
 */
export interface ExposureArc {
  readonly frameTimeMs: number; // the image it belongs to; its middle step
  readonly startMs: number;
  readonly stepMs: number;
  readonly steps: number;
  readonly count: number; // rows per step: the catalogue size when it was requested
  readonly data: Float32Array<ArrayBuffer>;
}
export interface Ephemeris {
  catalog: SatCatalog;
  frame: SatFrame;
  tracks: Map<number, TrackOut>;
  skyPaths: Map<number, SkyPathOut>;
  pathsVersion: number;
  /** [M4] The arc of the still image on screen, or null (none wanted, or its reply has not arrived). */
  arc: ExposureArc | null;
  /** [M8] The latest accepted incoming reply, or null. */
  readonly incoming: Extract<PropagationOut, { type: "incoming" }> | null;
}

const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
const FLAG_ABOVE_HORIZON = 4;
const FLAG_VISIBLE = 8;

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
  arc: null,
  // [M8] The incoming client's latest reply: null without a session, after a flush and while alerts are inactive.
  get incoming() {
    return session?.incoming.latest ?? null;
  },
};

/** What the last arc request was sent for: a change in any field sends a new one. */
interface ArcRequest {
  readonly frameTimeMs: number;
  readonly startMs: number;
  readonly stepMs: number;
  readonly steps: number;
  readonly count: number;
  readonly groups: number;
}

interface Session {
  readonly store: AppStore;
  /** Posts to the current worker ([M9] a restart replaces it). */
  readonly send: (msg: PropagationIn, transfer?: Transferable[]) => void;
  /** [M9] The current propagation worker; messages from an earlier one are ignored. */
  worker: Worker;
  /** [M9] Replaced, with the worker, when the element-set source changes (step 14f). */
  client: SampleClient;
  /**
   * [M9] The directory the worker loads its element sets from (absolute, ending in "/"): `data/gp/`, or a clip's
   * `recordings/<clip>.gp/` while that clip camera is active and the directory exists (step 14f).
   */
  gpBaseUrl: string;
  /** [M9] Injected for tests; the probe of a clip's `<clip>.gp/meta.json`. */
  readonly fetchFn: typeof fetch;
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
  /** Bumped by every arc request and every drop: only a reply to the latest request is kept. */
  arcRequestId: number;
  /** The arc request in flight or held; null while no arc is wanted. */
  arcRequest: ArcRequest | null;
  /** [M8] Paces `incoming` requests and filters stale replies (step 6.1). [M9] Replaced on a restart. */
  incoming: IncomingClient;
  /** [M8] A camera model has been sent (setCamera with a camera): incoming requests need one. */
  cameraSent: boolean;
}

let session: Session | null = null;

// Per-frame cache: computes once per frameCount(), and skips the loop while time, pair and mask are unchanged.
let computedFrame = -1;
let lastA: unknown = null;
let lastB: unknown = null;
let lastGroups = -1;
/** [M6] The terrain profile the flags were computed with: a new one recomputes them, even while paused. */
let lastProfile: Float32Array | null = null;
/** [M9] frameCount() and SampleClient.generation of the last frame that ran the loop (step 4). */
let lastLoopFrame = -1;
let lastLoopGeneration = -1;
/**
 * [M9] The last loop run was interleaved: half the Starlink rows still hold the ground fields of the frame before.
 * The next frame that would skip the loop (nothing changed, e.g. the first frame after a pause) runs it in full.
 */
let staleGroundRows = false;
/** [M9] The selected and hovered rows, cached by id and catalogue size: both are exempt from step 4's rules. */
let exemptIds: readonly [ObjectId | null, ObjectId | null, number] = [null, null, -1];
let exemptRows: readonly [number, number] = [-1, -1];
/** [M9] exemptRows as the last loop run used them. */
let lastExempt: readonly [number, number] | null = null;
const STARLINK_GROUP = GP_GROUPS.indexOf("starlink");
const VALID_AND_SUNLIT = FLAG_VALID | FLAG_SUNLIT;
/**
 * [M9] Per held sample: 1 where the row is valid and below the sky cut-off, computed once per sample (a new sample
 * arrives every sixth frame at 60× and 600×), so a kept row tests two bytes instead of two cones. Four slots reused
 * in turn: a frame needs two, and the slots are rewritten only when a new sample object appears.
 */
interface CutoffSlot {
  sample: HeldSample | null;
  bits: Uint8Array;
}
const cutoffSlots: CutoffSlot[] = Array.from({ length: 4 }, () => ({
  sample: null,
  bits: new Uint8Array(0),
}));
let nextCutoffSlot = 0;

function belowCutoffBits(sample: HeldSample, count: number): Uint8Array {
  for (const slot of cutoffSlots) if (slot.sample === sample) return slot.bits;
  const slot = cutoffSlots[nextCutoffSlot] ?? { sample: null, bits: new Uint8Array(0) };
  nextCutoffSlot = (nextCutoffSlot + 1) % cutoffSlots.length;
  if (slot.bits.length < count) slot.bits = new Uint8Array(count);
  const { data } = sample;
  const n = Math.min(count, data.length / SAMPLE_STRIDE);
  for (let i = 0; i < n; i++) {
    const o = i * SAMPLE_STRIDE;
    slot.bits[i] =
      data[o + SampleField.valid] === 1 &&
      belowSkyCutoff(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0)
        ? 1
        : 0;
  }
  slot.bits.fill(0, n);
  slot.sample = sample;
  return slot.bits;
}
const ecef = new Float64Array(3);
const latLon = new Float64Array(2);

/** The app's own element sets: `${BASE_URL}data/gp/`, absolute. */
function defaultGpBaseUrl(): string {
  // Absolute (gotcha 15): a relative URL resolves against the worker script's folder.
  return new URL(`${import.meta.env.BASE_URL}data/gp/`, location.href).href;
}

function gpUrl(s: Session, group: GpGroup): string {
  return new URL(`${group}.json`, s.gpBaseUrl).href; // [M9] the session's source (step 14f)
}

/**
 * [M9] Step 14f: each clip's `<clip>.gp/meta.json` probe, once per clip for the session. true: it answered OK with a
 * JSON content type and a JSON body; false: anything else (vite's index.html fallback, a 404, a network error).
 */
const clipGpProbes = new Map<string, boolean | Promise<boolean>>();

async function probeClipGp(fetchFn: typeof fetch, baseUrl: string): Promise<boolean> {
  try {
    const res = await fetchFn(new URL("meta.json", baseUrl).href, { cache: "no-cache" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
      await res.body?.cancel().catch(() => undefined);
      return false;
    }
    const json: unknown = JSON.parse(await res.text());
    return typeof json === "object" && json !== null;
  } catch {
    return false;
  }
}

/**
 * [M9] Step 14f rule 1: the clip's own directory while the active camera is a local-video camera with a sidecarUrl
 * whose clip has loaded (videoUrl set) and whose probe answered JSON; else data/gp/. Starts the probe on first need
 * and calls `onProbed` when it settles.
 */
function wantedGpBaseUrl(s: Session, onProbed: () => void): string {
  const camera = selectActiveCamera(s.store.getState());
  if (
    camera?.kind !== "local-video" ||
    camera.source.sidecarUrl === null ||
    camera.source.videoUrl === null
  ) {
    return defaultGpBaseUrl();
  }
  const appBase = new URL(import.meta.env.BASE_URL, location.href).href;
  const clipBase = clipGpBaseUrl(new URL(camera.source.sidecarUrl, appBase).href);
  const probe = clipGpProbes.get(clipBase);
  if (probe === undefined) {
    const pending = probeClipGp(s.fetchFn, clipBase).then((found) => {
      clipGpProbes.set(clipBase, found);
      onProbed();
      return found;
    });
    clipGpProbes.set(clipBase, pending);
    return defaultGpBaseUrl(); // until the probe answers
  }
  return probe === true ? clipBase : defaultGpBaseUrl();
}

function forgetFrame(): void {
  computedFrame = -1;
  lastA = null;
  lastB = null;
  lastGroups = -1;
  lastProfile = null;
  lastLoopFrame = -1; // [M9] the next loop run is a full one
  lastLoopGeneration = -1;
  staleGroundRows = false;
  exemptIds = [null, null, -1];
  lastExempt = null;
  for (const slot of cutoffSlots) slot.sample = null;
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
  ephemeris.arc = null;
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
  s.send({ type: "loadGroup", group, url: gpUrl(s, group) });
}

/** Starlink loads the first time its toggle is on, and again after a groupError; never before stations and visual. */
function maybeLoadStarlink(s: Session): void {
  if (s.site === null || s.starlinkRequested || !s.store.getState().layers.starlink) return;
  s.starlinkRequested = true;
  loadGroup(s, "starlink");
}

/** Forgets the arc request: a reply still in flight is ignored, and the held arc is dropped. */
function dropArc(s: Session): void {
  if (s.arcRequest === null && ephemeris.arc === null) return;
  s.arcRequest = null;
  s.arcRequestId++;
  ephemeris.arc = null;
}

/**
 * Exposure arcs (M4 step 16, README section 5 "Arcs"): while the active camera is a still image with
 * `exposureSec` > 1 and `frameTimeMs` is set, keeps one `arc` request on `exposureArcGrid`'s grid for the catalogue
 * and group mask as they are now. A new frame time or a moved observer (`siteMoved`) drops the held arc, which
 * belongs to another image or site; a larger catalogue or another mask keeps it until the new reply, as its rows
 * stay right. Nothing is sent before the site (init) or the first group, or for a grid of one step (exposures under
 * 5 s), which has no segment to draw: that camera keeps its dots.
 */
function syncArc(s: Session, siteMoved = false): void {
  const state = s.store.getState();
  const camera = selectActiveCamera(state);
  const frameTimeMs = state.camera.frameTimeMs;
  const grid =
    camera?.kind === "still-image" && frameTimeMs !== null
      ? exposureArcGrid(frameTimeMs, camera.source.exposureSec)
      : null;
  const count = ephemeris.catalog.count;
  if (frameTimeMs === null || grid === null || grid.steps < 2 || s.site === null || count === 0) {
    dropArc(s);
    return;
  }
  const groups = selectGroupMask(state);
  const sent = s.arcRequest;
  const sameImage =
    sent !== null &&
    sent.frameTimeMs === frameTimeMs &&
    sent.startMs === grid.startMs &&
    sent.stepMs === grid.stepMs &&
    sent.steps === grid.steps;
  if (sameImage && !siteMoved && sent.count === count && sent.groups === groups) return;
  if (!sameImage || siteMoved) ephemeris.arc = null;
  s.arcRequestId++;
  s.arcRequest = { frameTimeMs, ...grid, count, groups };
  // Once per image (and per group load, mask or site change), never per frame.
  const buffer = new Float32Array(grid.steps * count * SAMPLE_STRIDE).buffer;
  s.send(
    {
      type: "arc",
      requestId: s.arcRequestId,
      startMs: grid.startMs,
      stepMs: grid.stepMs,
      steps: grid.steps,
      groups,
      buffer,
    },
    [buffer],
  );
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
  s.incoming.flush(); // [M8] entries for the old observer
  ephemeris.skyPaths.clear(); // ENU from the old observer
  ephemeris.pathsVersion++;
  syncArc(s, true); // after setSite, so the worker computes it for the new observer
}

/**
 * [M8] The active camera's model input for the incoming check (step 6.2), sent on each change of the camera entry or
 * its calibration, then a flush. Nothing is sent before the registry loads: the worker starts without a camera, and
 * init must be its first message.
 */
function onCamera(
  s: Session,
  camera: CameraConfig | undefined,
  calibration: Calibration | undefined,
): void {
  if (camera === undefined || calibration === undefined) {
    if (!s.cameraSent) return;
    s.cameraSent = false;
    s.send({ type: "setCamera", camera: null });
  } else {
    s.cameraSent = true;
    s.send({
      type: "setCamera",
      camera: {
        lens: camera.lens,
        calibration,
        widthPx: camera.imageSize.widthPx,
        heightPx: camera.imageSize.heightPx,
      },
    });
  }
  s.incoming.flush();
}

/**
 * [M8] The terrain profile for the incoming check, a structured-clone copy (the store keeps the original), then a
 * flush. Its subscription is registered after the site's: setSite resets the worker's profile, so on a camera switch
 * setSite must reach the worker first.
 */
function onHorizonProfile(s: Session, profileDeg: Float32Array | null): void {
  s.send({ type: "setHorizonProfile", profileDeg });
  s.incoming.flush();
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
      syncArc(s); // the new rows need an arc too
      s.incoming.flush(); // [M8] the new rows may be incoming
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
    case "arc": {
      const sent = s.arcRequest;
      if (msg.requestId !== s.arcRequestId || sent === null) return; // an older request, or dropped
      const data = new Float32Array(msg.buffer);
      ephemeris.arc = {
        frameTimeMs: sent.frameTimeMs,
        startMs: msg.startMs,
        stepMs: msg.stepMs,
        steps: msg.steps,
        count: msg.steps > 0 ? Math.floor(data.length / (msg.steps * SAMPLE_STRIDE)) : 0,
        data,
      };
      break;
    }
    case "error":
      console.error(`Propagation worker: ${msg.message}`);
      break;
    case "incoming": // [M8] older requests are dropped by the client
      s.incoming.onReply(msg);
      break;
  }
}

function newPropagationWorker(): Worker {
  return new Worker(new URL("../workers/propagation.worker.ts", import.meta.url), {
    type: "module",
  });
}

/** Routes a worker's messages and failure to the session while it is the session's current worker. */
function listen(s: Session, worker: Worker): void {
  worker.addEventListener("message", (e: MessageEvent<PropagationOut>) => {
    if (session === s && s.worker === worker) onMessage(s, e.data);
  });
  worker.addEventListener("error", (e: ErrorEvent) => {
    if (session !== s || s.worker !== worker) return;
    // The worker script itself failed (it catches its own errors): nothing that is loading will arrive.
    console.error(`Propagation worker failed: ${e.message}`);
    const { data, actions } = s.store.getState();
    for (const group of GP_GROUPS) {
      if (data.gp[group].status === "loading") actions.setGroupData(group, { status: "error" });
    }
  });
}

/**
 * [M9] Step 14f rule 2: a new worker on `gpBaseUrl`, started as at boot. The catalogue only appends, so the old
 * worker is terminated and everything built from it is dropped: catalogue, frame arrays, samples, tracks, sky paths,
 * the arc and the incoming list. Then init with the active site, stations and visual, Starlink when its toggle is on
 * (every requested group goes to "loading"; Starlink off goes back to "idle"), the camera model and the terrain
 * profile. The selection survives: object ids are NORAD ids.
 */
function restartWorker(s: Session, gpBaseUrl: string): void {
  s.worker.terminate();
  s.gpBaseUrl = gpBaseUrl;
  s.worker = newPropagationWorker();
  listen(s, s.worker);
  s.client = new SampleClient(s.send);
  s.incoming = new IncomingClient((msg) => s.send(msg));
  s.starlinkRequested = false;
  s.cameraSent = false;
  s.arcRequest = null;
  s.arcRequestId++;
  resetEphemeris();
  const state = s.store.getState();
  if (!state.layers.starlink) {
    state.actions.setGroupData("starlink", { status: "idle", fetchedAtMs: null, count: 0 });
  }
  const site = s.site;
  if (site === null) return; // init waits for the first site, as at boot
  s.siteGeneration = s.client.generation;
  s.send({ type: "init", site, generation: s.siteGeneration });
  loadGroup(s, "stations"); // strictly in this order (gotcha 22)
  loadGroup(s, "visual");
  maybeLoadStarlink(s);
  onCamera(s, selectActiveCamera(state), selectCalibration(state));
  const profile = selectHorizonProfileDeg(state);
  if (profile !== null) onHorizonProfile(s, profile);
}

/**
 * [M9] Step 14f: follows the active camera's element-set source. Before the first site nothing has loaded, so only
 * the source is set; afterwards a change restarts the worker.
 */
function syncGpSource(s: Session): void {
  if (session !== s) return;
  const wanted = wantedGpBaseUrl(s, () => syncGpSource(s));
  if (wanted === s.gpBaseUrl) return;
  if (s.site === null) s.gpBaseUrl = wanted;
  else restartWorker(s, wanted);
}

/** [M9] What tests inject. */
export interface EphemerisOptions {
  /** The probe of a clip's `<clip>.gp/meta.json` (step 14f); the global fetch by default. */
  readonly fetch?: typeof fetch;
}

/**
 * Creates the propagation worker (called once in main.tsx). Waits for the first non-null site, then sends `init` and
 * loads stations and visual; Starlink loads when its toggle is first on. Registers updateEphemerisFrame as a frame
 * updater. Returns stop(): terminates the worker and clears the catalogue. [M9] The element sets come from data/gp/,
 * or from the active clip's own directory (step 14f): a change of source restarts the worker.
 */
export function startEphemeris(store: AppStore, options: EphemerisOptions = {}): () => void {
  if (session !== null) throw new Error("ephemeris is already started");
  resetEphemeris();
  const worker = newPropagationWorker();
  const send = (msg: PropagationIn, transfer: Transferable[] = []): void =>
    s.worker.postMessage(msg, transfer);
  const s: Session = {
    store,
    send,
    worker,
    client: new SampleClient(send),
    gpBaseUrl: defaultGpBaseUrl(),
    fetchFn: options.fetch ?? ((input, init) => fetch(input, init)),
    site: null,
    siteGeneration: 0,
    observerEcefKm: new Float64Array(3),
    enuToEcef: new Float64Array(9),
    starlinkRequested: false,
    tracksRequestId: 0,
    skyPathsRequestId: 0,
    arcRequestId: 0,
    arcRequest: null,
    incoming: new IncomingClient((msg) => send(msg)),
    cameraSent: false,
  };
  session = s;
  listen(s, worker);
  const unsubscribeSite = store.subscribe(selectSite, (site) => onSite(s, site), {
    fireImmediately: true,
  });
  const unsubscribeStarlink = store.subscribe(
    (st) => st.layers.starlink,
    () => {
      maybeLoadStarlink(s);
      syncArc(s); // the group mask changed
    },
  );
  // The camera slice changes only on discrete events (a camera, a frame time, a calibration), never per frame.
  const unsubscribeArc = store.subscribe(
    (st) => st.camera,
    () => syncArc(s),
    { fireImmediately: true },
  );
  // [M8] After the site subscription: init comes first, and setSite before a new camera's profile.
  const unsubscribeCamera = store.subscribe(
    (st) => [selectActiveCamera(st), selectCalibration(st)] as const,
    ([camera, calibration]) => onCamera(s, camera, calibration),
    { equalityFn: shallow, fireImmediately: true },
  );
  const unsubscribeHorizon = store.subscribe(selectHorizonProfileDeg, (profile) =>
    onHorizonProfile(s, profile),
  );
  // [M8] Alerts cover the groups on screen: another mask asks again at once.
  const unsubscribeIncomingMask = store.subscribe(selectIncomingMask, () => s.incoming.flush());
  // [M9] Last: on a camera switch the old worker has had its setSite and setCamera, and a restart resends both.
  const unsubscribeGpSource = store.subscribe(selectActiveCamera, () => syncGpSource(s), {
    fireImmediately: true,
  });
  const unregister = registerFrameUpdater(updateEphemerisFrame);
  return () => {
    if (session !== s) return;
    unregister();
    unsubscribeSite();
    unsubscribeStarlink();
    unsubscribeArc();
    unsubscribeCamera();
    unsubscribeHorizon();
    unsubscribeIncomingMask();
    unsubscribeGpSource();
    s.worker.terminate();
    session = null;
    resetEphemeris();
  };
}

/**
 * [M9] The selected and hovered rows (−1 for none), cached by id and catalogue size: step 4's two rules never apply
 * to them. Docked ids map to their host's row.
 */
function exemptRowsOf(
  selectedId: ObjectId | null,
  hoverId: ObjectId | null,
): readonly [number, number] {
  const count = ephemeris.catalog.count;
  if (exemptIds[0] !== selectedId || exemptIds[1] !== hoverId || exemptIds[2] !== count) {
    exemptIds = [selectedId, hoverId, count];
    exemptRows = [
      selectedId === null ? -1 : (indexOfObjectId(selectedId) ?? -1),
      hoverId === null ? -1 : (indexOfObjectId(hoverId) ?? -1),
    ];
  }
  return exemptRows;
}

/**
 * Interpolates every object for this frame: ENU (linear, or Hermite at 600×) → az/alt → apparent alt (valid objects
 * only: gotcha 17) → range → sunlit from the nearer sample → ECEF = O + M·ENU → Bowring → EPSG:3857 in place.
 * Computes once per frameCount(); registered at boot and called first by every satellite layer updater.
 *
 * [M9] Two rules for Starlink rows (step 4), never for the selected or hovered object, stations or visual:
 * 1. Sky cut-off: a row below SKY_CUTOFF_GEOMETRIC_DEG (belowSkyCutoff on the interpolated ENU) skips az/alt,
 *    refraction, range and the terrain horizon. Its above-horizon and visible flags are cleared, and its altitude and
 *    range are written NaN: every sky consumer tests `alt > 0`, so a stale altitude (from before a seek, or a row that
 *    fell more than 3° in one frame at 600×) would be drawn. Its azimuth is left as it was.
 * 2. Interleaved ground updates: while playing, and the previous frame ran this loop on the same sample generation,
 *    a row with (i & 1) !== (frameCount() & 1) keeps its lonLatDeg, mercator and sunlit flag from the frame before,
 *    so each Starlink updates on the ground at 30 Hz. Such a row below the cut-off in both samples is skipped
 *    entirely (the cone below −3° is convex). Any other frame (a seek, step or scrub while paused, a flush), and the
 *    first frame after playing stops, updates every row.
 */
export function updateEphemerisFrame(simTimeMs: number): SatFrame {
  const frame = ephemeris.frame;
  const s = session;
  const n = frameCount();
  if (s === null || n === computedFrame) return frame;
  computedFrame = n;
  const state = s.store.getState();
  // [M8] Before any early return: a flush while paused (a profile arriving, a layer toggle) must still post.
  s.incoming.frame(
    performance.now(),
    simTimeMs,
    selectIncomingActive(state) && s.cameraSent,
    selectIncomingMask(state),
  );
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
  // [M6] The terrain horizon, read once per frame; null (the geometric horizon) until the profile is ready.
  const profile = selectHorizonProfileDeg(state);
  // [M9] The selected and hovered rows: a change recomputes a paused frame, as they may have been cut or kept.
  const exempt = exemptRowsOf(state.selection.selectedId, state.selection.hoverId);
  const unchanged =
    frame.ready &&
    simTimeMs === frame.timeMs &&
    a === lastA &&
    b === lastB &&
    groups === lastGroups &&
    profile === lastProfile &&
    exempt === lastExempt;
  // [M9] After an interleaved frame, an unchanged frame (the first one after a pause, or a stalled clock) runs the
  // loop once in full, so no row is left a frame behind.
  if (unchanged && !staleGroundRows) return frame;
  lastA = a;
  lastB = b;
  lastGroups = groups;
  lastProfile = profile;
  lastExempt = exempt;
  frame.ready = true;
  frame.timeMs = simTimeMs;
  // [M9] Step 4's rules: interleave only while playing on the previous frame's sample generation.
  const generation = s.client.generation;
  const interleave =
    !unchanged &&
    state.clock.playing &&
    lastLoopFrame === n - 1 &&
    lastLoopGeneration === generation;
  lastLoopFrame = n;
  lastLoopGeneration = generation;
  staleGroundRows = interleave;
  const parity = n & 1;
  const [selectedRow, hoveredRow] = exempt;
  // [M9] Only interleaved frames read them.
  const belowA = interleave ? belowCutoffBits(a, ephemeris.catalog.count) : null;
  const belowB = interleave ? belowCutoffBits(b, ephemeris.catalog.count) : null;
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
    // [M9] Starlink rows other than the selected and hovered ones follow step 4's rules.
    const ruled =
      (catalog.groupIndex[i] ?? 0) === STARLINK_GROUP && i !== selectedRow && i !== hoveredRow;
    // [M9] Rule 2: on the other parity, a row valid last frame keeps its ground fields and sunlit flag.
    const keepGround =
      ruled && interleave && (i & 1) !== parity && ((flags[i] ?? 0) & FLAG_VALID) !== 0;
    if (keepGround && belowA?.[i] === 1 && belowB?.[i] === 1) {
      // Below the cut-off in both samples, so in between too: nothing in the sky, the ground waits a frame.
      flags[i] = (flags[i] ?? 0) & VALID_AND_SUNLIT;
      azAltDeg[i2 + 1] = Number.NaN;
      rangeKm[i] = Number.NaN;
      continue;
    }
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
    const sunlit = keepGround
      ? ((flags[i] ?? 0) & FLAG_SUNLIT) !== 0
      : sunlitAt(a.data, a.timeMs, b.data, b.timeMs, i, simTimeMs);
    let skyFlags = 0;
    if (ruled && belowSkyCutoff(e, nn, u)) {
      // [M9] Rule 1: below the sky cut-off, nothing to draw in the sky.
      azAltDeg[i2 + 1] = Number.NaN;
      rangeKm[i] = Number.NaN;
    } else {
      enuToAzAltDeg(e, nn, u, azAltDeg, i2);
      const altDeg = apparentAltDeg(azAltDeg[i2 + 1] ?? 0);
      azAltDeg[i2 + 1] = altDeg;
      rangeKm[i] = Math.hypot(e, nn, u);
      const group = GP_GROUPS[catalog.groupIndex[i] ?? 0] ?? "stations";
      // [M6] Above the terrain horizon at this azimuth (0° without a profile); drawing still uses alt > 0.
      const horizonDeg = horizonAltAtAzDeg(profile, azAltDeg[i2] ?? 0);
      skyFlags =
        (altDeg > horizonDeg ? FLAG_ABOVE_HORIZON : 0) |
        (isVisible(sunlit, sunAltDeg, group, altDeg, horizonDeg) ? FLAG_VISIBLE : 0);
    }
    flags[i] = FLAG_VALID | (sunlit ? FLAG_SUNLIT : 0) | skyFlags;
    if (keepGround) continue;
    enuToEcef(m, e, nn, u, ecef, 0);
    ecefToLatLonDeg(ox + (ecef[0] ?? 0), oy + (ecef[1] ?? 0), oz + (ecef[2] ?? 0), latLon, 0);
    const lon = latLon[1] ?? 0;
    const lat = latLon[0] ?? 0;
    lonLatDeg[i2] = lon;
    lonLatDeg[i2 + 1] = lat;
    // EPSG:3857 per row, exactly as ol/proj/epsg3857's fromEPSG4326 (an in-place pass over the whole array would
    // project the kept rows a second time).
    mercator[i2] = (HALF_SIZE * lon) / 180;
    const y = RADIUS * Math.log(Math.tan((Math.PI * (lat + 90)) / 360));
    mercator[i2 + 1] = y > MAX_SAFE_Y ? MAX_SAFE_Y : y < -MAX_SAFE_Y ? -MAX_SAFE_Y : y;
  }
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

/**
 * [M4] The exposure arc to draw now (step 16): the held arc while the clock is live on the image it was computed
 * for, where sim time is that image's frameTimeMs; else null, and the sky view draws dots. Allocates nothing.
 */
export function drawableExposureArc(state: AppState): ExposureArc | null {
  const arc = ephemeris.arc;
  if (arc === null || state.clock.mode !== "live") return null;
  return state.camera.frameTimeMs === arc.frameTimeMs ? arc : null;
}

/**
 * [M8] Geodetic height (km) of object `index` in the current frame: geodeticHeightKm(O + M·ENU) with the frame loop's
 * own WGS-84 observer O and ENU→ECEF matrix M; null when the frame is not ready or the object is not valid.
 */
export function heightKmOf(index: number): number | null {
  const s = session;
  const f = ephemeris.frame;
  if (s === null || !f.ready || ((f.flags[index] ?? 0) & FLAG_VALID) === 0) return null;
  const i3 = 3 * index;
  enuToEcef(s.enuToEcef, f.enuKm[i3] ?? 0, f.enuKm[i3 + 1] ?? 0, f.enuKm[i3 + 2] ?? 0, ecef, 0);
  return geodeticHeightKm(
    (s.observerEcefKm[0] ?? 0) + (ecef[0] ?? 0),
    (s.observerEcefKm[1] ?? 0) + (ecef[1] ?? 0),
    (s.observerEcefKm[2] ?? 0) + (ecef[2] ?? 0),
  );
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
