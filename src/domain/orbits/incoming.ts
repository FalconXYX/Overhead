// src/domain/orbits/incoming.ts — which satellites enter the camera frame within 60 s (M8 step 4).
// Each candidate is propagated forward in 5 s steps and every sample goes through the camera model. The footprint
// polygon is never used for this: a fixed-height polygon caught only 24 of 59 real entries (M8 gotcha 6).
// There is no "sunlit now" filter: sunlit is tested at each future sample, so satellites leaving Earth's shadow
// inside the frame are caught (58/58 and 167/167 instead of 51/58 and 121/167, gotcha 7). The Sun gate is per
// request, never per sample (gotcha 15).

import type { SatRec } from "satellite.js";
import { apparentAltDeg } from "../astro";
import { type CameraModel, projectAzAltDeg } from "../camera";
import { enuToAzAltDeg, type ObserverSite } from "../geo";
import { horizonAltAtAzDeg } from "../terrain";
import { GP_GROUPS, type GroupMask } from "./omm";
import {
  createPropagationContext,
  type PropagationContext,
  SAMPLE_STRIDE,
  SampleField,
  writeSample,
} from "./sample";
import { SUN_CUTOFF_DEG } from "./visibility";

export const INCOMING_STEP_MS = 5_000;
export const INCOMING_STEPS = 12;
export const INCOMING_MIN_ALT_DEG = -5;

export interface IncomingHit {
  readonly index: number;
  readonly etaSec: number;
}

// ---- context cache: k = 0…12 at timeMs + 5000·k, rebuilt only when timeMs or the site object changes. The worker
// passes its one stored site object; a fresh object per call would rebuild 13 contexts per candidate (gotcha 10).
const contexts: PropagationContext[] = [];
let cachedTimeMs = Number.NaN;
let cachedSite: ObserverSite | null = null;

function contextsFor(timeMs: number, site: ObserverSite): readonly PropagationContext[] {
  if (timeMs !== cachedTimeMs || site !== cachedSite || contexts.length === 0) {
    for (let k = 0; k <= INCOMING_STEPS; k++) {
      contexts[k] = createPropagationContext(timeMs + INCOMING_STEP_MS * k, site);
    }
    cachedTimeMs = timeMs;
    cachedSite = site;
  }
  return contexts;
}

// ---- the visible-in-frame predicate
const sample = new Float32Array(SAMPLE_STRIDE);
const azAlt = new Float64Array(2);
const uv = new Float64Array(2);

/**
 * Visible in frame, from the sample already written at index 0 and its apparent altitude: sunlit, above the terrain
 * horizon at its azimuth, and projected inside [0, W] × [0, H].
 */
function inFrame(
  azDeg: number,
  apparentAltitudeDeg: number,
  camera: CameraModel,
  horizonProfileDeg: Float32Array | null,
): boolean {
  if (sample[SampleField.sunlit] !== 1) return false;
  if (!(apparentAltitudeDeg > horizonAltAtAzDeg(horizonProfileDeg, azDeg))) return false;
  if (!projectAzAltDeg(camera, azDeg, apparentAltitudeDeg, uv, 0)) return false;
  const u = uv[0] ?? Number.NaN;
  const v = uv[1] ?? Number.NaN;
  return u >= 0 && u <= camera.widthPx && v >= 0 && v <= camera.heightPx;
}

/** Propagates into `sample` and writes [az, geometric alt] to azAlt; false when propagation fails. */
function sampleAt(satrec: SatRec, ctx: PropagationContext): boolean {
  if (!writeSample(satrec, ctx, sample, 0)) return false;
  enuToAzAltDeg(
    sample[SampleField.eKm] ?? Number.NaN,
    sample[SampleField.nKm] ?? Number.NaN,
    sample[SampleField.uKm] ?? Number.NaN,
    azAlt,
    0,
  );
  return true;
}

/** k = 1…12 over cached contexts; −1 on a propagation failure, 0 when it never enters, else 5k. */
function etaFromContexts(
  satrec: SatRec,
  ctxs: readonly PropagationContext[],
  camera: CameraModel,
  horizonProfileDeg: Float32Array | null,
): number {
  for (let k = 1; k <= INCOMING_STEPS; k++) {
    const ctx = ctxs[k];
    if (ctx === undefined || !sampleAt(satrec, ctx)) return -1;
    // apparentAltDeg only after writeSample succeeded: Refraction throws on NaN (gotcha 17).
    const alt = apparentAltDeg(azAlt[1] ?? Number.NaN);
    if (inFrame(azAlt[0] ?? Number.NaN, alt, camera, horizonProfileDeg)) {
      return (INCOMING_STEP_MS * k) / 1000;
    }
  }
  return 0;
}

/**
 * First t + 5k s (k = 1…12) at which the satellite projects inside [0, W] × [0, H], is sunlit, and its apparent
 * altitude is above horizonAltAtAzDeg(horizonProfileDeg, az). null if none, or if propagation fails.
 */
export function incomingEtaSec(
  satrec: SatRec,
  site: ObserverSite,
  camera: CameraModel,
  timeMs: number,
  horizonProfileDeg: Float32Array | null,
): number | null {
  const eta = etaFromContexts(satrec, contextsFor(timeMs, site), camera, horizonProfileDeg);
  return eta > 0 ? eta : null;
}

/**
 * The worker's incoming pass (M8 step 4): per-request Sun gate on SUN_CUTOFF_DEG, skips docked objects, groups
 * outside `groups`, objects at or below INCOMING_MIN_ALT_DEG and objects already in the frame; no "sunlit now"
 * filter. Sorted by etaSec, then index.
 */
export function collectIncoming(
  satrecs: readonly SatRec[],
  groupIndex: Uint8Array,
  skip: Uint8Array,
  groups: GroupMask,
  site: ObserverSite,
  camera: CameraModel,
  timeMs: number,
  horizonProfileDeg: Float32Array | null,
): IncomingHit[] {
  const ctxs = contextsFor(timeMs, site);
  const now = ctxs[0];
  if (now === undefined) return [];
  // Sun gate, once per request: in daylight no group is allowed and no satellite is touched.
  let allowed = 0;
  for (let g = 0; g < GP_GROUPS.length; g++) {
    const group = GP_GROUPS[g];
    if (
      group !== undefined &&
      (groups & (1 << g)) !== 0 &&
      SUN_CUTOFF_DEG[group] >= now.sunAltDeg
    ) {
      allowed |= 1 << g;
    }
  }
  if (allowed === 0) return [];
  const hits: IncomingHit[] = [];
  for (let i = 0; i < satrecs.length; i++) {
    if (skip[i] === 1) continue; // docked: it would duplicate its host (gotcha 16)
    const g = groupIndex[i];
    if (g === undefined || (allowed & (1 << g)) === 0) continue;
    const satrec = satrecs[i];
    if (satrec === undefined || !sampleAt(satrec, now)) continue;
    const alt = apparentAltDeg(azAlt[1] ?? Number.NaN);
    if (alt <= INCOMING_MIN_ALT_DEG) continue;
    if (inFrame(azAlt[0] ?? Number.NaN, alt, camera, horizonProfileDeg)) continue; // visible now, not incoming
    const eta = etaFromContexts(satrec, ctxs, camera, horizonProfileDeg);
    if (eta > 0) hits.push({ index: i, etaSec: eta });
  }
  hits.sort((a, b) => a.etaSec - b.etaSec || a.index - b.index);
  return hits;
}
