// src/domain/camera/inverse.ts — pixel → sky (M4). Closed form except the distortion, which Newton inverts.
// No proj4: its gnom inverse returns NaN at the principal point (verification/proj4-lens.md claim 5).

import { wrap360 } from "../geo";
import {
  type CameraModel,
  horizonRadiusUnit,
  lensAngleRad,
  modelGeometry,
  solveUndistortedRadius,
  UNDISTORT_MAX_ITERATIONS,
} from "./lens";

const R2D = 180 / Math.PI;
/** unprojectPixel rejects a Newton result whose distorted radius misses r_d by this many pixels or more. */
const UNDISTORT_RESIDUAL_PX = 1e-6;

/**
 * [M4] Newton solve of r(1 + k1 r² + k2 r⁴) = rd from r = rd; null on failure: g′ ≤ 0 at an iterate,
 * no convergence (|step| < 1e-9) in 10 iterations, r < 0, or a non-finite or negative input.
 */
export function undistortRadius(rd: number, k1: number, k2: number): number | null {
  return solveUndistortedRadius(rd, k1, k2, UNDISTORT_MAX_ITERATIONS);
}

/**
 * [M4] Pixel → sky. Undoes flip, principal point, focal length, Newton-undistorts (≤ 10 iterations, step < 1e-9),
 * un-rolls, then inverts the lens. Writes [azDeg in [0, 360), altDeg] at offset and returns true. Returns false
 * (out untouched) for non-finite input, when there is no preimage, Newton fails (g′ ≤ 0 or residual ≥ 1e-6 px)
 * or the pixel is outside a fisheye's horizon circle. r_d = 0 returns the optical axis exactly as the calibration
 * states it (wrap360(azDeg), altDeg), or (0, 90) when zenith-locked, without a degree → radian → degree trip.
 */
export function unprojectPixel(
  model: CameraModel,
  uPx: number,
  vPx: number,
  out: Float64Array,
  offset: number,
): boolean {
  if (!Number.isFinite(uPx) || !Number.isFinite(vPx)) return false;
  const g = modelGeometry(model);
  const c = model.calibration;
  const f = c.focalPx;
  const xd = (g.sx * (uPx - c.cxPx)) / f;
  const yd = -(vPx - c.cyPx) / f;
  const rd = Math.hypot(xd, yd);
  if (rd === 0) {
    out[offset] = model.zenithLocked ? 0 : wrap360(c.azDeg);
    out[offset + 1] = model.zenithLocked ? 90 : c.altDeg;
    return true;
  }
  const r = undistortRadius(rd, c.k1, c.k2);
  if (r === null) return false;
  const r2 = r * r;
  if (!(Math.abs(r * (1 + c.k1 * r2 + c.k2 * r2 * r2) - rd) * f < UNDISTORT_RESIDUAL_PX))
    return false;
  const scale = r / rd;
  const xr = xd * scale;
  const yr = yd * scale;
  // Un-roll: the transpose of x' = x cos ρ − y sin ρ, y' = x sin ρ + y cos ρ.
  const x = xr * g.cosRoll + yr * g.sinRoll;
  const y = -xr * g.sinRoll + yr * g.cosRoll;
  const p = Math.hypot(x, y);
  if (g.fisheye && p > horizonRadiusUnit(model.lens)) return false;
  // d = cos θ·F + (sin θ/p)(x·R̂ + y·Û) in ENU, with F, R̂ and Û of the axis (see ModelGeometry).
  const theta = lensAngleRad(model.lens, p);
  const a = Math.cos(theta);
  const b = p === 0 ? 0 : Math.sin(theta) / p;
  const { sinAxisAz: sA, cosAxisAz: cA, sinAxisAlt: sH, cosAxisAlt: cH } = g;
  const dE = a * cH * sA + b * (x * cA - y * sH * sA);
  const dN = a * cH * cA - b * (x * sA + y * sH * cA);
  const dU = a * sH + b * y * cH;
  out[offset] = wrap360(Math.atan2(dE, dN) * R2D);
  out[offset + 1] = Math.atan2(dU, Math.hypot(dE, dN)) * R2D;
  return true;
}
