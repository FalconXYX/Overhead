// src/workers/propagation.worker.ts — owns every satrec and propagates on the fixed sim-time grid t_k = k × D
// (M3 step 10, README section 5). One sample per request, written into the transferred buffer and sent back; an
// exposure arc (M4 step 16) is the same, for every step of a still image's exposure. Plain JS
// loop over writeSample; sub-points are computed on the main thread with the Bowring closed form, never eciToGeodetic.
// [M8] The incoming check (step 5) runs here too, once per wall second, on the stored camera model and terrain profile.
// [M9] Samples go through writeCulledSample: Starlink is always culled (step 2); BulkPropagator is not used (step 3).
import { json2satrec, type SatRec } from "satellite.js";
// [M8] The camera index: geopose.ts compiles ajv lazily, so the validator never reaches this chunk (M4 gotcha G9).
import { type CameraModel, createCameraModel } from "../domain/camera";
import type { ObserverSite } from "../domain/geo";
import {
  appendGroup,
  type CullState,
  collectIncoming,
  createCullState,
  createPropagationContext,
  GP_GROUPS,
  type GpGroup,
  type GroupMask,
  type PropagationContext,
  parseGpFile,
  resetCullState,
  SAMPLE_STRIDE,
  trackLonLatDeg,
  writeCulledSample,
  writeSample,
} from "../domain/orbits";
import { floorToStepMs, TRACK_STEP_MS } from "../domain/time";
import {
  type CatalogDelta,
  type PropagationIn,
  type PropagationOut,
  SKY_PATH_STEP_MS,
  type SkyPathOut,
  type TrackOut,
} from "./protocol";

/** Track half-spans (README section 5, "tracks and incoming"): 61 and 19 points on the 20 s grid. */
const SELECTED_HALF_SPAN_MS = 600_000;
const OTHER_HALF_SPAN_MS = 180_000;

// ---- state: the catalogue only appends (M9 restarts the worker to rebuild it)
let site: ObserverSite | null = null;
/** NORAD ids already loaded, across groups. Replaced only when a group loads completely. */
let seen = new Set<number>();
const satrecs: SatRec[] = [];
const noradIds: number[] = [];
/** Per satrec: index into GP_GROUPS (bit of a GroupMask). */
let groupIndex = new Uint8Array(0);
/** Per satrec: 1 = docked (never sampled: valid = 0 in every sample). */
let skip = new Uint8Array(0);
/** Per satrec: 1 once a failed propagation was logged (README Errors rule 3: once per object per session). */
let warned = new Uint8Array(0);
/** meta.json, fetched once for the session; null when it failed. */
let meta: Promise<unknown> | null = null;
/** writeSample scratch for sky paths. */
const slot = new Float32Array(SAMPLE_STRIDE);
/** [M8] The incoming check's camera; null disables it. */
let camera: CameraModel | null = null;
/**
 * [M8] The terrain profile for the incoming check, as received (a structured-clone copy: the store keeps the
 * original); null is the geometric horizon. setSite resets it until the main thread sends the new camera's profile.
 */
let horizon: Float32Array | null = null;
/** [M9] Starlink culling (step 2): a new state on every groupLoaded, so the first sample after it is a full pass. */
let cullState: CullState = createCullState(0);
/** [M9] Per satrec: 1 = in the starlink group (culled). Rebuilt on every groupLoaded. */
let cullMask = new Uint8Array(0);
/**
 * [M9] Per satrec: 1 = not sampled (docked, or its group bit is not in the request's mask). Rebuilt on every
 * groupLoaded and whenever a sample's `groups` differs from sampleSkipGroups. The SampleClient flushes on a mask
 * change, so the next sample is a full pass anyway.
 */
let sampleSkip = new Uint8Array(0);
let sampleSkipGroups: GroupMask | null = null;
const STARLINK_GROUP = GP_GROUPS.indexOf("starlink");

// `{ transfer }` is the options form of postMessage: the same call in a worker, and it type-checks under the DOM lib
// too, so Node unit tests can import this file with stubbed globals.
const post = (msg: PropagationOut, transfer: Transferable[] = []): void =>
  postMessage(msg, { transfer });

function grown(a: Uint8Array<ArrayBuffer>, length: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(length);
  b.set(a);
  return b;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireSite(): ObserverSite {
  if (site === null) throw new Error("no site yet: init must come first");
  return site;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return json;
}

/** fetchedAtMs of `group` in meta.json, or null when meta.json failed or has no usable entry for it. */
async function fetchedAtMsOf(group: GpGroup, groupUrl: string): Promise<number | null> {
  meta ??= fetchJson(new URL("meta.json", groupUrl).href).catch((error: unknown) => {
    console.warn(`GP meta.json failed to load; fetch times unknown: ${errorText(error)}`);
    return null;
  });
  const m = await meta;
  const entry: unknown = typeof m === "object" && m !== null ? Reflect.get(m, group) : undefined;
  const ms: unknown =
    typeof entry === "object" && entry !== null ? Reflect.get(entry, "fetchedAtMs") : undefined;
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

/**
 * Fetches and appends one group (url is absolute, gotcha 15). Never rejects: a rejected `loads` chain would skip every
 * later loadGroup. Nothing is committed until every step has succeeded, so a failed group can be loaded again.
 */
async function loadGroup(group: GpGroup, url: string): Promise<void> {
  try {
    const fetchedAtMs = await fetchedAtMsOf(group, url);
    const omms = parseGpFile(await fetchJson(url));
    const nextSeen = new Set(seen);
    const entries = appendGroup(nextSeen, group, omms);
    const recs = entries.map((e) => json2satrec(e.omm));

    const firstIndex = satrecs.length;
    const n = entries.length;
    const g = GP_GROUPS.indexOf(group);
    const catalog: CatalogDelta = {
      firstIndex,
      noradIds: new Int32Array(n),
      names: entries.map((e) => e.name),
      groupIndex: new Uint8Array(n).fill(g),
      epochMs: new Float64Array(n),
      dockedWith: new Int32Array(n),
    };
    groupIndex = grown(groupIndex, firstIndex + n);
    skip = grown(skip, firstIndex + n);
    warned = grown(warned, firstIndex + n);
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      const satrec = recs[i];
      if (e === undefined || satrec === undefined) continue;
      catalog.noradIds[i] = e.noradId;
      catalog.epochMs[i] = e.epochMs;
      catalog.dockedWith[i] = e.dockedWith ?? -1;
      satrecs.push(satrec);
      noradIds.push(e.noradId);
      groupIndex[firstIndex + i] = g;
      skip[firstIndex + i] = e.dockedWith === null ? 0 : 1;
    }
    seen = nextSeen;
    // [M9] The catalogue grew: new culling state and masks, so the next sample is a full pass over every row.
    cullState = createCullState(satrecs.length);
    cullMask = new Uint8Array(satrecs.length);
    for (let i = 0; i < satrecs.length; i++) cullMask[i] = groupIndex[i] === STARLINK_GROUP ? 1 : 0;
    sampleSkipGroups = null;
    post({ type: "groupLoaded", group, totalCount: satrecs.length, fetchedAtMs, catalog }, [
      catalog.noradIds.buffer,
      catalog.groupIndex.buffer,
      catalog.epochMs.buffer,
      catalog.dockedWith.buffer,
    ]);
  } catch (error) {
    post({ type: "groupError", group, message: errorText(error) });
  }
}

/**
 * Objects 0 … count − 1 at ctx into rows firstRow … firstRow + count − 1 of out. Docked objects, objects outside
 * `groups` and rows past the catalogue get valid = 0 (the whole slot zeroed).
 */
function writeRows(
  ctx: PropagationContext,
  out: Float32Array,
  firstRow: number,
  count: number,
  groups: GroupMask,
): void {
  const n = Math.min(satrecs.length, count);
  for (let i = 0; i < n; i++) {
    const satrec = satrecs[i];
    const row = firstRow + i;
    if (satrec === undefined || skip[i] === 1 || ((groups >> (groupIndex[i] ?? 0)) & 1) === 0) {
      out.fill(0, row * SAMPLE_STRIDE, (row + 1) * SAMPLE_STRIDE); // valid = 0
    } else if (!writeSample(satrec, ctx, out, row) && warned[i] !== 1) {
      warned[i] = 1;
      console.warn(`NORAD ${noradIds[i]}: propagation failed (satrec error ${satrec.error})`);
    }
  }
  // Rows past the catalogue (never in practice).
  out.fill(0, (firstRow + n) * SAMPLE_STRIDE, (firstRow + count) * SAMPLE_STRIDE);
}

/** README Errors rule 3: one warning per object per session. */
function warnFailed(i: number): void {
  if (warned[i] === 1) return;
  warned[i] = 1;
  console.warn(`NORAD ${noradIds[i]}: propagation failed (satrec error ${satrecs[i]?.error})`);
}

/** [M9] sampleSkip for `groups`: docked objects and objects whose group bit is not in the mask. */
function syncSampleSkip(groups: GroupMask): void {
  if (sampleSkipGroups === groups && sampleSkip.length === satrecs.length) return;
  sampleSkipGroups = groups;
  if (sampleSkip.length !== satrecs.length) sampleSkip = new Uint8Array(satrecs.length);
  for (let i = 0; i < satrecs.length; i++) {
    sampleSkip[i] = skip[i] === 1 || ((groups >> (groupIndex[i] ?? 0)) & 1) === 0 ? 1 : 0;
  }
}

/**
 * Sample k at t_k = k × stepMs into the request's buffer, sent back transferred. [M9] Through writeCulledSample:
 * Starlink is culled (step 2), stations and visual are always propagated in full; computeMs times the whole call.
 */
function sample(msg: Extract<PropagationIn, { type: "sample" }>): void {
  const observer = requireSite();
  const out = new Float32Array(msg.buffer);
  const timeMs = msg.k * msg.stepMs; // a plain number (never Float32)
  const startMs = performance.now();
  const ctx = createPropagationContext(timeMs, observer);
  syncSampleSkip(msg.groups);
  writeCulledSample(
    cullState,
    satrecs,
    sampleSkip,
    cullMask,
    ctx,
    out,
    msg.k,
    msg.stepMs,
    msg.generation,
    warnFailed,
  );
  out.fill(0, satrecs.length * SAMPLE_STRIDE); // rows past the catalogue (never in practice)
  const computeMs = performance.now() - startMs;
  post(
    {
      type: "sample",
      generation: msg.generation,
      k: msg.k,
      timeMs,
      sunAltDeg: ctx.sunAltDeg,
      computeMs,
      buffer: msg.buffer,
    },
    [msg.buffer],
  );
}

/** One ground track, or null for an index without a satellite. */
function track(index: number, timeMs: number, halfSpanMs: number): TrackOut | null {
  const satrec = satrecs[index];
  if (satrec === undefined) return null;
  const points = 2 * Math.floor(halfSpanMs / TRACK_STEP_MS) + 1;
  const lonLat = new Float64Array(2 * points);
  const count = trackLonLatDeg(satrec, timeMs, halfSpanMs, lonLat);
  return {
    index,
    firstPointMs: floorToStepMs(timeMs, TRACK_STEP_MS) - floorToStepMs(halfSpanMs, TRACK_STEP_MS),
    lonLatDeg: count === points ? lonLat : lonLat.slice(0, 2 * count),
  };
}

/** Rebuilds every requested track (no per-satellite cache, README section 5): selected ±10 min, others ±3 min. */
function tracks(msg: Extract<PropagationIn, { type: "tracks" }>): void {
  const out: TrackOut[] = [];
  const add = (t: TrackOut | null): void => {
    if (t !== null) out.push(t);
  };
  if (msg.selectedIndex !== null) add(track(msg.selectedIndex, msg.timeMs, SELECTED_HALF_SPAN_MS));
  for (const index of msg.otherIndices) {
    if (index !== msg.selectedIndex) add(track(index, msg.timeMs, OTHER_HALF_SPAN_MS));
  }
  post(
    { type: "tracks", requestId: msg.requestId, tracks: out },
    out.map((t) => t.lonLatDeg.buffer),
  );
}

/**
 * ENU at every multiple of SKY_PATH_STEP_MS in [fromMs, toMs] for each index: one propagation context per time
 * step, shared by all indices. A path ends at its first failed propagation.
 */
function skyPaths(msg: Extract<PropagationIn, { type: "skyPaths" }>): void {
  const observer = requireSite();
  const firstMs = Math.ceil(msg.fromMs / SKY_PATH_STEP_MS) * SKY_PATH_STEP_MS;
  const steps = msg.toMs >= firstMs ? Math.floor((msg.toMs - firstMs) / SKY_PATH_STEP_MS) + 1 : 0;
  const recs: SatRec[] = [];
  const paths: SkyPathOut[] = [];
  for (const index of msg.indices) {
    const satrec = satrecs[index];
    if (satrec === undefined) continue;
    recs.push(satrec);
    paths.push({ index, firstPointMs: firstMs, enuKm: new Float32Array(3 * steps) });
  }
  const counts = new Int32Array(paths.length);
  const alive = new Uint8Array(paths.length).fill(1);
  let remaining = paths.length;
  for (let s = 0; s < steps && remaining > 0; s++) {
    const ctx = createPropagationContext(firstMs + s * SKY_PATH_STEP_MS, observer);
    for (let j = 0; j < paths.length; j++) {
      const satrec = recs[j];
      const path = paths[j];
      if (alive[j] !== 1 || satrec === undefined || path === undefined) continue;
      if (!writeSample(satrec, ctx, slot, 0)) {
        alive[j] = 0;
        remaining--;
        continue;
      }
      const c = counts[j] ?? 0;
      path.enuKm.set(slot.subarray(0, 3), 3 * c);
      counts[j] = c + 1;
    }
  }
  for (let j = 0; j < paths.length; j++) {
    const path = paths[j];
    const length = 3 * (counts[j] ?? 0);
    if (path !== undefined && length < path.enuKm.length) path.enuKm = path.enuKm.slice(0, length);
  }
  post(
    { type: "skyPaths", requestId: msg.requestId, generation: msg.generation, paths },
    paths.map((p) => p.enuKm.buffer),
  );
}

/**
 * Exposure arc (M4 step 16): `steps` samples from startMs, stepMs apart, one propagation context per step shared by
 * every object. Step s, object i goes to (s × count + i) × SAMPLE_STRIDE, count being the buffer's rows per step
 * (the catalogue size when it was sent). Docked objects and objects outside `groups` get valid = 0, as in a sample.
 * The same buffer goes back, transferred.
 */
function arc(msg: Extract<PropagationIn, { type: "arc" }>): void {
  const observer = requireSite();
  const out = new Float32Array(msg.buffer);
  const steps = msg.steps > 0 ? Math.floor(msg.steps) : 0;
  const count = steps > 0 ? Math.floor(out.length / (steps * SAMPLE_STRIDE)) : 0;
  for (let s = 0; s < steps; s++) {
    // Plain-number time arithmetic: Float32 epoch milliseconds would be about 23.5 s off.
    const ctx = createPropagationContext(msg.startMs + s * msg.stepMs, observer);
    writeRows(ctx, out, s * count, count, msg.groups);
  }
  post(
    {
      type: "arc",
      requestId: msg.requestId,
      startMs: msg.startMs,
      stepMs: msg.stepMs,
      steps: msg.steps,
      buffer: msg.buffer,
    },
    [msg.buffer],
  );
}

/**
 * [M8] Which satellites enter the frame within 60 s (step 5.4): collectIncoming over every satrec, timed with
 * performance.now() (the worker budget, README section 9). Without a site or a camera nothing is incoming.
 */
function incoming(msg: Extract<PropagationIn, { type: "incoming" }>): void {
  if (site === null || camera === null) {
    post({
      type: "incoming",
      requestId: msg.requestId,
      timeMs: msg.timeMs,
      computeMs: 0,
      entries: [],
    });
    return;
  }
  const startMs = performance.now();
  // The stored site object: collectIncoming caches its 13 contexts by its identity (gotcha 10).
  const entries = collectIncoming(
    satrecs,
    groupIndex,
    skip,
    msg.groups,
    site,
    camera,
    msg.timeMs,
    horizon,
  );
  const computeMs = performance.now() - startMs;
  // IncomingHit has IncomingEntry's shape: posted as is.
  post({ type: "incoming", requestId: msg.requestId, timeMs: msg.timeMs, computeMs, entries });
}

let loads: Promise<void> = Promise.resolve(); // loadGroup runs strictly in arrival order (gotcha 22)

addEventListener("message", (e: MessageEvent<PropagationIn>): void => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
      case "setSite":
        site = msg.site; // the main thread has flushed: older samples are discarded there
        horizon = null; // [M8] the profile belongs to the old site: null until the new one arrives
        resetCullState(cullState); // [M9] held rows are ENU from the old observer
        break;
      case "loadGroup":
        loads = loads.then(() => loadGroup(msg.group, msg.url));
        break;
      case "sample":
        sample(msg);
        break;
      case "tracks":
        tracks(msg);
        break;
      case "skyPaths":
        skyPaths(msg);
        break;
      case "setCamera": // [M8]
        camera = msg.camera === null ? null : createCameraModel(msg.camera);
        break;
      case "incoming": // [M8]
        incoming(msg);
        break;
      case "arc":
        arc(msg);
        break;
      case "setHorizonProfile": // [M8] stored as received
        horizon = msg.profileDeg;
        break;
    }
  } catch (error) {
    post({ type: "error", message: `${msg.type}: ${errorText(error)}` });
    // [M8] An empty reply still answers the request: the client waits for it before it sends the next one.
    if (msg.type === "incoming") {
      post({
        type: "incoming",
        requestId: msg.requestId,
        timeMs: msg.timeMs,
        computeMs: 0,
        entries: [],
      });
    }
  }
});
