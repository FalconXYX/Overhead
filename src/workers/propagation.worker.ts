// src/workers/propagation.worker.ts — owns every satrec and propagates on the fixed sim-time grid t_k = k × D
// (M3 step 10, README section 5). One sample per request, written into the transferred buffer and sent back. Plain JS
// loop over writeSample; sub-points are computed on the main thread with the Bowring closed form, never eciToGeodetic.
import { json2satrec, type SatRec } from "satellite.js";
import type { ObserverSite } from "../domain/geo";
import {
  appendGroup,
  createPropagationContext,
  GP_GROUPS,
  type GpGroup,
  parseGpFile,
  SAMPLE_STRIDE,
  trackLonLatDeg,
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

/** Sample k at t_k = k × stepMs into the request's buffer, sent back transferred. */
function sample(msg: Extract<PropagationIn, { type: "sample" }>): void {
  const observer = requireSite();
  const out = new Float32Array(msg.buffer);
  const timeMs = msg.k * msg.stepMs; // a plain number (never Float32)
  const startMs = performance.now();
  const ctx = createPropagationContext(timeMs, observer);
  const n = Math.min(satrecs.length, Math.floor(out.length / SAMPLE_STRIDE));
  for (let i = 0; i < n; i++) {
    const satrec = satrecs[i];
    if (satrec === undefined || skip[i] === 1 || ((msg.groups >> (groupIndex[i] ?? 0)) & 1) === 0) {
      out.fill(0, i * SAMPLE_STRIDE, (i + 1) * SAMPLE_STRIDE); // valid = 0
    } else if (!writeSample(satrec, ctx, out, i) && warned[i] !== 1) {
      warned[i] = 1;
      console.warn(`NORAD ${noradIds[i]}: propagation failed (satrec error ${satrec.error})`);
    }
  }
  out.fill(0, n * SAMPLE_STRIDE); // rows past the catalogue (never in practice)
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

let loads: Promise<void> = Promise.resolve(); // loadGroup runs strictly in arrival order (gotcha 22)

addEventListener("message", (e: MessageEvent<PropagationIn>): void => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
      case "setSite":
        site = msg.site; // the main thread has flushed: older samples are discarded there
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
      case "setCamera":
        break; // [M8] stores the camera for the incoming check; nothing to store before then
      case "incoming":
        // [M8] collectIncoming; until then nothing is ever incoming.
        post({
          type: "incoming",
          requestId: msg.requestId,
          timeMs: msg.timeMs,
          computeMs: 0,
          entries: [],
        });
        break;
      case "setHorizonProfile": // [M8]
      case "arc": // [M4]
        break;
    }
  } catch (error) {
    post({ type: "error", message: `${msg.type}: ${errorText(error)}` });
  }
});
