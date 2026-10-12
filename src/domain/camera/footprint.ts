// src/domain/camera/footprint.ts — where the camera frame looks at orbit height (M8 step 3).
// One sphere: R = EARTH_MEAN_RADIUS_KM and O = (R + h)·û (DECISIONS "Ground map"). The ring walks the frame
// boundary, clips it in geometric altitude to max(dip, terrain) + ε by bisecting each crossing and replacing every
// below-clip run with clip-curve points (never clamping per sample: that leaked up to 358 px out of the frame,
// M8 gotcha 4), casts each direction to the shell R + H, and unwraps the ring into the site's world copy.
// The polygon is a picture of the frame at one height, never a predictor (M8 gotcha 6).

import { Refraction } from "astronomy-engine";
import { apparentAltDeg } from "../astro";
import {
  azAltToEnuUnit,
  EARTH_MEAN_RADIUS_KM,
  enuToEcef,
  enuToEcefMatrix,
  geometricDipDeg,
  type ObserverSite,
  raySphereEntryKm,
  raySphereExitKm,
  sphericalLatLonDeg,
  sphericalObserverKm,
  unwrapLonDeg,
  wrap360,
} from "../geo";
import { horizonAltAtAzDeg } from "../terrain";
import { unprojectPixel } from "./inverse";
import { type CameraModel, horizonRadiusUnit, isFisheye } from "./lens";
import { projectAzAltDeg } from "./project";

export const FOOTPRINT_SAMPLES_PER_EDGE = 16;
/** The height presets of the Layers panel: the ISS shell and the lowered Starlink shell (DECISIONS "Ground map"). */
export const FOOTPRINT_PRESETS_KM = [420, 480] as const;
export const FOOTPRINT_FALLBACK_HEIGHT_KM = 420;
/** Clipped directions sit this far above the clip: a ray exactly at the dip is a tangent Earth hit (gotcha 3). */
export const FOOTPRINT_CLIP_EPS_DEG = 1e-6;

/** Halvings per bisected crossing; 240 px edge segments end below 1e-6 px. */
const BISECT_STEPS = 30;
/** The fisheye horizon circle shrinks by this factor so a sample on it still unprojects. */
const CIRCLE_SHRINK = 1 - 1e-9;
/** Cap of the refraction inversion below; it converges in at most 17 iterations wherever it converges at all. */
const INVERSE_REFRACTION_MAX_ITERATIONS = 50;

/**
 * geometricAltDeg (README refraction rule 6) with an iteration cap. astronomy-engine's InverseRefraction iterates
 * until |diff| < 1e-14 with no cap, and that never happens for about 0.1 % of apparent altitudes in [−90°, −64°]
 * (one ulp there is 1.4e-14, so diff hops between ±1 ulp) nor within 3e-5° of +90° (Refraction is 0 above 90°, so
 * the iterate flips across the clamp): those calls never return. A camera whose boundary reaches the zenith or
 * looks steeply down would hang the page. This runs the same fixed-point iteration with the same stopping rule, so
 * it returns geometricAltDeg's value wherever geometricAltDeg returns; elsewhere the last iterate is within 1 ulp
 * (or 3.2e-5° at the zenith, under a metre at orbit height).
 */
function geometricAltCappedDeg(apparentDeg: number): number {
  if (apparentDeg < -90 || apparentDeg > 90) return apparentDeg; // InverseRefraction returns 0 there
  let alt = apparentDeg - Refraction("normal", apparentDeg);
  for (let i = 0; i < INVERSE_REFRACTION_MAX_ITERATIONS; i++) {
    const diff = alt + Refraction("normal", alt) - apparentDeg;
    if (Math.abs(diff) < 1e-14) break;
    alt -= diff;
  }
  return apparentDeg + (alt - apparentDeg); // the same rounding as apparent + InverseRefraction(...)
}

/** [M8] Most pairs footprintLonLatDeg can write: 8 × samplesPerEdge (every sample plus two crossings per run). */
export function footprintMaxPairs(samplesPerEdge: number): number {
  return 8 * samplesPerEdge;
}

// Scratch, sized on the first call with a given samplesPerEdge; nothing is allocated after that.
let cachedN = 0;
let sampleAz = new Float64Array(0); // azimuth of each boundary sample (NaN when it does not unproject)
let sampleAlt = new Float64Array(0); // geometric altitude
let sampleAbove = new Uint8Array(0); // 1: geometric altitude − clip(az) ≥ 0
let dirs = new Float64Array(0); // [azDeg, geometric altDeg] per emitted direction
const pixel = new Float64Array(2);
const azAlt = new Float64Array(2);
const enu = new Float64Array(3);
const ray = new Float64Array(3);
const observer = new Float64Array(3);
const enuToEcefM = new Float64Array(9);
const vertex = new Float64Array(2);

function ensureScratch(n: number): void {
  if (n === cachedN) return;
  cachedN = n;
  sampleAz = new Float64Array(4 * n);
  sampleAlt = new Float64Array(4 * n);
  sampleAbove = new Uint8Array(4 * n);
  dirs = new Float64Array(2 * footprintMaxPairs(n));
}

/** Per-call inputs shared by the helpers below (module state, so a call allocates no closure). */
let model: CameraModel;
let profile: Float32Array | null = null;
let dipDeg = 0;
let samplesPerEdgeN = 1;
let circleRadiusPx = Number.POSITIVE_INFINITY;
/** Results of the last evaluate(): its azimuth and geometric altitude. */
let lastAz = Number.NaN;
let lastAlt = Number.NaN;

/** Geometric clip at az: max(dip, geometricAltDeg(profile(az))); a null profile or a non-finite value is the dip. */
function clipDeg(azDeg: number): number {
  if (profile === null) return dipDeg;
  const h = horizonAltAtAzDeg(profile, azDeg);
  if (!Number.isFinite(h)) return dipDeg; // M6 writes NaN for a ray with no samples
  const g = geometricAltCappedDeg(h);
  return g > dipDeg ? g : dipDeg; // NaN-safe, unlike Math.max
}

/**
 * Pixel of boundary position s ∈ [0, 4n) (wrapping): clockwise from the top-left corner, n per edge, linear along
 * an edge. On a fisheye a position outside the horizon circle moves radially onto it: corners are not sky (gotcha 5).
 */
function boundaryPixel(s: number): void {
  const n = samplesPerEdgeN;
  const total = 4 * n;
  let p = s % total;
  if (p < 0) p += total;
  const edge = Math.min(3, Math.floor(p / n));
  const t = (p - edge * n) / n;
  const w = model.widthPx;
  const h = model.heightPx;
  let u: number;
  let v: number;
  if (edge === 0) {
    u = w * t;
    v = 0;
  } else if (edge === 1) {
    u = w;
    v = h * t;
  } else if (edge === 2) {
    u = w - w * t;
    v = h;
  } else {
    u = 0;
    v = h - h * t;
  }
  if (circleRadiusPx < Number.POSITIVE_INFINITY) {
    const cx = model.calibration.cxPx;
    const cy = model.calibration.cyPx;
    const du = u - cx;
    const dv = v - cy;
    const r = Math.hypot(du, dv);
    if (r > circleRadiusPx) {
      const k = circleRadiusPx / r;
      u = cx + du * k;
      v = cy + dv * k;
    }
  }
  pixel[0] = u;
  pixel[1] = v;
}

/** Evaluates position s: sets lastAz and lastAlt (geometric) and returns true when it is above the clip. */
function evaluate(s: number): boolean {
  boundaryPixel(s);
  if (!unprojectPixel(model, pixel[0] ?? Number.NaN, pixel[1] ?? Number.NaN, azAlt, 0)) {
    lastAz = Number.NaN;
    lastAlt = Number.NaN;
    return false; // no preimage counts as below the clip
  }
  lastAz = azAlt[0] ?? Number.NaN;
  lastAlt = geometricAltCappedDeg(azAlt[1] ?? Number.NaN); // refraction rule 6: footprint rays are geometric
  return lastAlt - clipDeg(lastAz) >= 0;
}

function insideFrame(azDeg: number, apparentAltitudeDeg: number): boolean {
  if (!projectAzAltDeg(model, azDeg, apparentAltitudeDeg, pixel, 0)) return false;
  const u = pixel[0] ?? Number.NaN;
  const v = pixel[1] ?? Number.NaN;
  return u >= 0 && u <= model.widthPx && v >= 0 && v <= model.heightPx;
}

/** True when the clip-curve point at azDeg (raised by ε, then refracted) projects inside the frame. */
function clipPointInside(azDeg: number): boolean {
  const az = wrap360(azDeg);
  return insideFrame(az, apparentAltDeg(clipDeg(az) + FOOTPRINT_CLIP_EPS_DEG));
}

let dirCount = 0;
function emit(azDeg: number, altDeg: number): void {
  dirs[2 * dirCount] = azDeg;
  dirs[2 * dirCount + 1] = altDeg;
  dirCount += 1;
}
function emitClip(azDeg: number): void {
  const az = wrap360(azDeg);
  emit(az, clipDeg(az) + FOOTPRINT_CLIP_EPS_DEG);
}

/**
 * [M8] Orbit-height footprint on a sphere R = 6371.0088 km, O = (R + h)·û. Walks 4·samplesPerEdge boundary
 * samples (fisheye samples moved onto the horizon circle), clips in geometric altitude to
 * max(dip, geometricAltDeg(profile)) + FOOTPRINT_CLIP_EPS_DEG by bisecting each crossing and replacing every
 * below-clip run with clip-curve points (M8 step 3), drops any ray that hits the Earth first (a safety net),
 * and writes [lonDeg, latDeg] pairs into out (≥ footprintMaxPairs(samplesPerEdge) pairs), unwrapped starting
 * nearest site.lonDeg. Returns the pair count: 0 when the frame shows no sky, the ring would enclose a pole, or
 * heightKm ≤ the site height. The ring is open; the caller closes it.
 */
export function footprintLonLatDeg(
  cameraModel: CameraModel,
  site: ObserverSite,
  heightKm: number,
  samplesPerEdge: number,
  horizonProfileDeg: Float32Array | null,
  out: Float64Array,
): number {
  // 1. Guard.
  if (!Number.isFinite(heightKm) || !(heightKm > site.heightM / 1000)) return 0;
  const n = Math.floor(samplesPerEdge);
  if (!(n >= 1)) return 0;
  ensureScratch(n);
  model = cameraModel;
  profile = horizonProfileDeg;
  dipDeg = geometricDipDeg(site.heightM);
  samplesPerEdgeN = n;
  const c = cameraModel.calibration;
  if (isFisheye(cameraModel.lens)) {
    const rh = horizonRadiusUnit(cameraModel.lens);
    const rh2 = rh * rh;
    circleRadiusPx = c.focalPx * rh * (1 + c.k1 * rh2 + c.k2 * rh2 * rh2) * CIRCLE_SHRINK;
  } else {
    circleRadiusPx = Number.POSITIVE_INFINITY;
  }
  const total = 4 * n;

  // 2–3. Boundary samples and their margins.
  let firstAbove = -1;
  for (let i = 0; i < total; i++) {
    const above = evaluate(i);
    sampleAz[i] = lastAz;
    sampleAlt[i] = lastAlt;
    sampleAbove[i] = above ? 1 : 0;
    if (above && firstAbove < 0) firstAbove = i;
  }

  // 4. Walk.
  dirCount = 0;
  if (firstAbove < 0) {
    // None above: the whole clip curve if the zenith is in frame, else the frame shows no sky.
    if (!insideFrame(0, 90)) return 0;
    for (let j = 0; j < total; j++) emitClip((360 * j) / total);
  } else {
    const start = firstAbove;
    emit(sampleAz[start] ?? Number.NaN, sampleAlt[start] ?? Number.NaN);
    let run = 0;
    let azExit = Number.NaN;
    for (let k = 1; k <= total; k++) {
      const prev = (start + k - 1) % total;
      const cur = (start + k) % total;
      const prevAbove = sampleAbove[prev] === 1;
      const curAbove = sampleAbove[cur] === 1;
      if (prevAbove && curAbove) {
        if (k < total) emit(sampleAz[cur] ?? Number.NaN, sampleAlt[cur] ?? Number.NaN);
      } else if (prevAbove) {
        // above → below: the last position that is above is the exit crossing.
        let lo = start + k - 1;
        let hi = start + k;
        let loAz = sampleAz[prev] ?? Number.NaN;
        for (let b = 0; b < BISECT_STEPS; b++) {
          const mid = (lo + hi) / 2;
          if (evaluate(mid)) {
            lo = mid;
            loAz = lastAz;
          } else {
            hi = mid;
          }
        }
        azExit = loAz;
        emitClip(azExit);
        run = 1;
      } else if (!curAbove) {
        run += 1;
      } else {
        // below → above: the first position that is above is the entry crossing.
        let lo = start + k - 1;
        let hi = start + k;
        let hiAz = sampleAz[cur] ?? Number.NaN;
        for (let b = 0; b < BISECT_STEPS; b++) {
          const mid = (lo + hi) / 2;
          if (evaluate(mid)) {
            hi = mid;
            hiAz = lastAz;
          } else {
            lo = mid;
          }
        }
        const azEntry = hiAz;
        // Δ: the signed arc from exit to entry whose midpoint lies inside the frame; the shorter one if both or
        // neither do.
        let d1 = (azEntry - azExit) % 360;
        if (d1 < 0) d1 += 360;
        const d2 = d1 - 360;
        const in1 = clipPointInside(azExit + d1 / 2);
        const in2 = clipPointInside(azExit + d2 / 2);
        const delta = in1 !== in2 ? (in1 ? d1 : d2) : Math.abs(d1) <= Math.abs(d2) ? d1 : d2;
        for (let q = 1; q <= run; q++) emitClip(azExit + (delta * q) / (run + 1));
        emitClip(azEntry);
        if (k < total) emit(sampleAz[cur] ?? Number.NaN, sampleAlt[cur] ?? Number.NaN);
        run = 0;
      }
    }
  }

  // 5. Intersect each direction with the shell R + H.
  sphericalObserverKm(site.latDeg, site.lonDeg, site.heightM, observer, 0);
  enuToEcefMatrix(site.latDeg, site.lonDeg, enuToEcefM);
  const ox = observer[0] ?? 0;
  const oy = observer[1] ?? 0;
  const oz = observer[2] ?? 0;
  const shellKm = EARTH_MEAN_RADIUS_KM + heightKm;
  let pairs = 0;
  for (let i = 0; i < dirCount; i++) {
    azAltToEnuUnit(dirs[2 * i] ?? Number.NaN, dirs[2 * i + 1] ?? Number.NaN, enu, 0);
    enuToEcef(enuToEcefM, enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, ray, 0);
    const dx = ray[0] ?? Number.NaN;
    const dy = ray[1] ?? Number.NaN;
    const dz = ray[2] ?? Number.NaN;
    // Safety net: after the clip it never fires on valid input.
    if (raySphereEntryKm(ox, oy, oz, dx, dy, dz, EARTH_MEAN_RADIUS_KM) !== null) continue;
    const t = raySphereExitKm(ox, oy, oz, dx, dy, dz, shellKm);
    if (t === null) continue;
    sphericalLatLonDeg(ox + t * dx, oy + t * dy, oz + t * dz, vertex, 0);
    out[2 * pairs] = vertex[1] ?? Number.NaN;
    out[2 * pairs + 1] = vertex[0] ?? Number.NaN;
    pairs += 1;
  }

  // 6. Unwrap from the site's longitude (gotcha 11); a ring around a pole does not close (gotcha 12).
  if (pairs < 3) return 0;
  let prevLon = unwrapLonDeg(site.lonDeg, out[0] ?? Number.NaN);
  out[0] = prevLon;
  for (let i = 1; i < pairs; i++) {
    prevLon = unwrapLonDeg(prevLon, out[2 * i] ?? Number.NaN);
    out[2 * i] = prevLon;
  }
  const lon0 = out[0] ?? Number.NaN;
  if (Math.abs(unwrapLonDeg(prevLon, lon0) - lon0) > 180) return 0;
  return pairs;
}
