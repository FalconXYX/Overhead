// src/domain/camera/coverage.ts — the azimuth range a frame covers (M4 step 4), for the site wedge (DECISIONS
// "Ground map": HFOV is not the azimuth span of a tilted camera; verification/architecture.md claim 17).

import { unprojectPixel } from "./inverse";
import type { CameraModel } from "./lens";
import { projectAzAltDeg } from "./project";

/** [M4] Azimuth range the frame covers, from the inverse-projected boundary; "full" when the zenith is in frame. */
export type AzimuthCoverage =
  | { readonly kind: "full" }
  | { readonly kind: "range"; readonly fromAzDeg: number; readonly toAzDeg: number };

const FULL: AzimuthCoverage = Object.freeze({ kind: "full" });
const scratch = new Float64Array(2);

/**
 * [M4] Callers pass samplesPerEdge 16.
 * 1. The zenith projecting inside [0, W] × [0, H] gives "full": every zenith or slightly tilted fisheye, and the
 *    2742 px StarCam from alt₀ 68.502° up.
 * 2. Otherwise the 4·samplesPerEdge boundary positions (clockwise from the top-left corner, each corner once) are
 *    unprojected and their azimuths sorted. The range runs clockwise from the azimuth after the largest circular
 *    gap to the one before it, so fromAzDeg > toAzDeg when it crosses north.
 * 3. Fewer than 2 unprojected samples (no sky geometry to speak of) gives "full".
 */
export function frameAzimuthCoverage(model: CameraModel, samplesPerEdge: number): AzimuthCoverage {
  const w = model.widthPx;
  const h = model.heightPx;
  if (projectAzAltDeg(model, 0, 90, scratch, 0)) {
    const u = scratch[0] ?? Number.NaN;
    const v = scratch[1] ?? Number.NaN;
    if (u >= 0 && u <= w && v >= 0 && v <= h) return FULL;
  }
  const n = Math.max(1, Math.floor(samplesPerEdge));
  const azimuths: number[] = [];
  for (let edge = 0; edge < 4; edge++) {
    for (let j = 0; j < n; j++) {
      const t = j / n;
      let u: number;
      let v: number;
      if (edge === 0) {
        u = w * t; // top, left to right
        v = 0;
      } else if (edge === 1) {
        u = w; // right, top to bottom
        v = h * t;
      } else if (edge === 2) {
        u = w - w * t; // bottom, right to left
        v = h;
      } else {
        u = 0; // left, bottom to top
        v = h - h * t;
      }
      if (unprojectPixel(model, u, v, scratch, 0)) azimuths.push(scratch[0] ?? Number.NaN);
    }
  }
  if (azimuths.length < 2) return FULL;
  azimuths.sort((a, b) => a - b);
  const count = azimuths.length;
  const first = azimuths[0] ?? 0;
  const last = azimuths[count - 1] ?? 0;
  // The wrap gap (last → first through north) is the default; a larger inner gap moves the range across north.
  let bestGap = first + 360 - last;
  let fromAzDeg = first;
  let toAzDeg = last;
  for (let i = 0; i + 1 < count; i++) {
    const a = azimuths[i] ?? 0;
    const b = azimuths[i + 1] ?? 0;
    if (b - a > bestGap) {
      bestGap = b - a;
      fromAzDeg = b;
      toAzDeg = a;
    }
  }
  return { kind: "range", fromAzDeg, toAzDeg };
}
