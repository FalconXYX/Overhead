// src/domain/orbits/passes.ts — [M5] passes over a site and the spans an object spends inside a camera's frame
// (M5 step 16): scripts/find-passes.ts and record-clip.ts (M5) and the tour (M9). Not a hot path: it allocates per
// call and builds one PropagationContext per sample.
import type { SatRec } from "satellite.js";
import { apparentAltDeg } from "../astro";
import { type CameraModel, projectAzAltDeg } from "../camera";
import { enuToAzAltDeg, type ObserverSite } from "../geo";
import type { GpGroup } from "./omm";
import { createPropagationContext, SAMPLE_STRIDE, SampleField, writeSample } from "./sample";
import { isVisible } from "./visibility";

const R2D = 180 / Math.PI;

export interface Pass {
  readonly riseMs: number; // geometric altitude crosses minAltDeg upward, ±1 s
  readonly culminationMs: number; // ±1 s
  readonly setMs: number;
  readonly maxAltDeg: number; // geometric
  readonly sunlitAtCulmination: boolean;
  readonly sunAltDegAtCulmination: number; // geometric
}

/** A stretch of time during which an object is visible inside a camera's frame. */
export interface FrameSpan {
  readonly enterMs: number; // first sample inside the frame and visible
  readonly exitMs: number; // last such sample
  readonly enterAzAltDeg: readonly [azDeg: number, altDeg: number]; // apparent
  readonly exitAzAltDeg: readonly [azDeg: number, altDeg: number];
  readonly maxAltDeg: number; // apparent, over the span's samples
}

/** One propagated instant: geometric altitude (NaN when propagation fails), the sunlit flag and the Sun's altitude. */
interface Instant {
  altDeg: number;
  sunlit: boolean;
  sunAltDeg: number;
}

/** Propagates satrec at timeMs into `sample` (one slot) and returns the instant. */
function instantAt(
  satrec: SatRec,
  site: ObserverSite,
  timeMs: number,
  sample: Float32Array,
): Instant {
  const ctx = createPropagationContext(timeMs, site);
  if (!writeSample(satrec, ctx, sample, 0)) {
    return { altDeg: Number.NaN, sunlit: false, sunAltDeg: ctx.sunAltDeg };
  }
  const e = sample[SampleField.eKm] ?? 0;
  const n = sample[SampleField.nKm] ?? 0;
  const u = sample[SampleField.uKm] ?? 0;
  return {
    altDeg: Math.atan2(u, Math.hypot(e, n)) * R2D,
    sunlit: sample[SampleField.sunlit] === 1,
    sunAltDeg: ctx.sunAltDeg,
  };
}

/**
 * The boundary between lo and hi, where isUp(lo) !== isUp(hi), to 1 ms: returns the up end of the final interval
 * (the first up instant for a rise, the last up instant for a set). Integer inputs give integer results.
 */
function bisectMs(lo: number, hi: number, isUp: (timeMs: number) => boolean): number {
  const loUp = isUp(lo);
  let a = lo;
  let b = hi;
  while (b - a > 1) {
    let mid = Math.floor((a + b) / 2);
    if (mid <= a || mid >= b) mid = (a + b) / 2; // non-integer ends
    if (isUp(mid) === loUp) a = mid;
    else b = mid;
  }
  return loUp ? a : b;
}

/**
 * [M5] Scans [fromMs, toMs] every stepMs with writeSample, then bisects rise and set to 1 ms and finds the
 * culmination on the whole-second grid (rise and set included). Geometric altitudes throughout. A pass already up at
 * fromMs starts there, and one still up at toMs ends there. A pass shorter than stepMs can fall between two samples.
 */
export function findPasses(
  satrec: SatRec,
  site: ObserverSite,
  fromMs: number,
  toMs: number,
  stepMs: number,
  minAltDeg: number,
): Pass[] {
  const passes: Pass[] = [];
  if (!(toMs >= fromMs) || !(stepMs > 0)) return passes;
  const sample = new Float32Array(SAMPLE_STRIDE);
  const at = (timeMs: number): Instant => instantAt(satrec, site, timeMs, sample);
  const isUp = (timeMs: number): boolean => at(timeMs).altDeg >= minAltDeg; // NaN is never up

  const build = (riseMs: number, setMs: number): Pass => {
    let culminationMs = riseMs;
    let best = at(riseMs);
    const consider = (timeMs: number): void => {
      const instant = at(timeMs);
      if (instant.altDeg > best.altDeg || Number.isNaN(best.altDeg)) {
        best = instant;
        culminationMs = timeMs;
      }
    };
    for (let t = Math.ceil(riseMs / 1000) * 1000; t <= setMs; t += 1000) consider(t);
    consider(setMs);
    return {
      riseMs,
      culminationMs,
      setMs,
      maxAltDeg: best.altDeg,
      sunlitAtCulmination: best.sunlit,
      sunAltDegAtCulmination: best.sunAltDeg,
    };
  };

  let prevMs = fromMs;
  let prevUp = isUp(fromMs);
  let riseMs: number | null = prevUp ? fromMs : null;
  for (let k = 1; prevMs < toMs; k++) {
    const t = Math.min(fromMs + k * stepMs, toMs);
    const up = isUp(t);
    if (up && !prevUp) {
      riseMs = bisectMs(prevMs, t, isUp);
    } else if (!up && prevUp && riseMs !== null) {
      passes.push(build(riseMs, bisectMs(prevMs, t, isUp)));
      riseMs = null;
    }
    prevMs = t;
    prevUp = up;
  }
  if (riseMs !== null) passes.push(build(riseMs, toMs));
  return passes;
}

/**
 * [M5] Spans in [fromMs, toMs], sampled every stepMs (1,000 in find-passes), where the object is visible
 * (isVisible with SUN_CUTOFF_DEG[group] and the geometric horizon, 0°) and projectAzAltDeg puts it inside
 * [0, W] × [0, H]. Ascending; a span still open at toMs ends there. Terrain can end a real span earlier.
 * Samples fall on fromMs + k × stepMs; az/alt are apparent (refracted), as the sky view draws them. Every point goes
 * through projectAzAltDeg's cull, so a far off-axis point cannot fold back into the frame (M5 gotcha G13).
 */
export function frameSpans(
  satrec: SatRec,
  group: GpGroup,
  site: ObserverSite,
  camera: CameraModel,
  fromMs: number,
  toMs: number,
  stepMs: number,
): FrameSpan[] {
  const spans: FrameSpan[] = [];
  if (!(toMs >= fromMs) || !(stepMs > 0)) return spans;
  const sample = new Float32Array(SAMPLE_STRIDE);
  const azAlt = new Float64Array(2);
  const uv = new Float64Array(2);
  let open: {
    enterMs: number;
    enterAzAltDeg: readonly [number, number];
    maxAltDeg: number;
  } | null = null;
  let lastMs = fromMs;
  let lastAzAltDeg: readonly [number, number] = [Number.NaN, Number.NaN];

  const close = (): void => {
    if (open === null) return;
    spans.push({
      enterMs: open.enterMs,
      exitMs: lastMs,
      enterAzAltDeg: open.enterAzAltDeg,
      exitAzAltDeg: lastAzAltDeg,
      maxAltDeg: open.maxAltDeg,
    });
    open = null;
  };

  for (let k = 0; ; k++) {
    const t = fromMs + k * stepMs;
    if (t > toMs) break;
    const ctx = createPropagationContext(t, site);
    let inside = false;
    if (writeSample(satrec, ctx, sample, 0)) {
      enuToAzAltDeg(
        sample[SampleField.eKm] ?? 0,
        sample[SampleField.nKm] ?? 0,
        sample[SampleField.uKm] ?? 0,
        azAlt,
        0,
      );
      const azDeg = azAlt[0] ?? Number.NaN;
      const altDeg = apparentAltDeg(azAlt[1] ?? Number.NaN);
      inside =
        isVisible(sample[SampleField.sunlit] === 1, ctx.sunAltDeg, group, altDeg, 0) &&
        projectAzAltDeg(camera, azDeg, altDeg, uv, 0) &&
        (uv[0] ?? -1) >= 0 &&
        (uv[0] ?? -1) <= camera.widthPx &&
        (uv[1] ?? -1) >= 0 &&
        (uv[1] ?? -1) <= camera.heightPx;
      if (inside) {
        const here = [azDeg, altDeg] as const;
        if (open === null) open = { enterMs: t, enterAzAltDeg: here, maxAltDeg: altDeg };
        else open.maxAltDeg = Math.max(open.maxAltDeg, altDeg);
        lastMs = t;
        lastAzAltDeg = here;
      }
    }
    if (!inside) close();
  }
  close();
  return spans;
}
