// src/domain/camera/project.ts — sky → pixel, closed form, no allocation.
// M2: the zenith equidistant fisheye only. M4 adds every lens and tilt to projectAzAltDeg.

import type { CameraModel } from "./lens";

const D2R = Math.PI / 180;

/**
 * [M2] Sky → pixel for the zenith equidistant fisheye. Writes [uPx, vPx] (v down) at offset and returns true;
 * returns false (out untouched) when culled: non-finite input, alt < 0 or > 90 (θ outside [0, thetaMaxRad]),
 * or r_u > 1.05·rMaxUnit.
 */
export function projectAzAltDeg(
  model: CameraModel,
  azDeg: number,
  altDeg: number,
  out: Float64Array,
  offset: number,
): boolean {
  const theta = (90 - altDeg) * D2R; // angle from the zenith
  // The first test also rejects a NaN altitude. At alt 0, theta is exactly π/2, so the horizon projects.
  if (!(theta <= model.thetaMaxRad) || theta < 0 || !Number.isFinite(azDeg)) return false;
  const a = azDeg * D2R;
  // Polar azimuthal equidistant, unit focal (do not multiply by f before the tail): north at the bottom, east on the right.
  const x = theta * Math.sin(a);
  const y = -theta * Math.cos(a);
  // Shared tail: roll, radial distortion, focal length, principal point, flip.
  const c = model.calibration;
  const rho = c.rollDeg * D2R;
  const cr = Math.cos(rho);
  const sr = Math.sin(rho);
  const xr = x * cr - y * sr;
  const yr = x * sr + y * cr;
  const r2 = xr * xr + yr * yr;
  if (r2 > (1.05 * model.rMaxUnit) ** 2) return false;
  const s = 1 + c.k1 * r2 + c.k2 * r2 * r2;
  out[offset] = c.cxPx + (c.flipX ? -1 : 1) * c.focalPx * s * xr;
  out[offset + 1] = c.cyPx - c.focalPx * s * yr;
  return true;
}

const scratch = new Float64Array(2);

/**
 * [M2] Batch form for stars and satellites. azAltDeg holds [az, alt] pairs; writes [u, v] pairs to outUvPx and
 * 1/0 to outVisible for the first count pairs; returns the number projected. A culled pair's [u, v] is left as
 * it was. Arrays are allocated once by the caller and reused.
 */
export function projectBatch(
  model: CameraModel,
  azAltDeg: Float32Array | Float64Array,
  count: number,
  outUvPx: Float32Array | Float64Array,
  outVisible: Uint8Array,
): number {
  let visible = 0;
  for (let i = 0; i < count; i++) {
    const az = azAltDeg[2 * i] ?? Number.NaN;
    const alt = azAltDeg[2 * i + 1] ?? Number.NaN;
    if (projectAzAltDeg(model, az, alt, scratch, 0)) {
      outUvPx[2 * i] = scratch[0] ?? 0;
      outUvPx[2 * i + 1] = scratch[1] ?? 0;
      outVisible[i] = 1;
      visible++;
    } else {
      outVisible[i] = 0;
    }
  }
  return visible;
}

/** [M2] OpenLayers pixel-projection coordinate of a pixel: [uPx, heightPx − vPx]. */
export function toSkyMapCoord(
  model: CameraModel,
  uPx: number,
  vPx: number,
  out: Float64Array | number[],
  offset: number,
): void {
  out[offset] = uPx;
  out[offset + 1] = model.heightPx - vPx;
}
