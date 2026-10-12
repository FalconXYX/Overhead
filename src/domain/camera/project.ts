// src/domain/camera/project.ts — sky → pixel, closed form, no allocation.
// M2: the zenith equidistant fisheye. M4: one oblique-azimuthal code path for all five lenses around the
// optical axis (A₀, h₀), then the shared tail (roll, distortion, focal length, principal point, flip).

import { type CameraModel, lensRadiusUnit, type ModelGeometry, modelGeometry } from "./lens";

const D2R = Math.PI / 180;

/**
 * [M2, M4] Sky → pixel, closed form, no allocation. Writes [uPx, vPx] (v down) at offset and returns true;
 * returns false (out untouched) when culled: non-finite input or |alt| > 90, cos c ≤ 0 (rectilinear),
 * θ > thetaMaxRad (fisheye; a zenith fisheye culls alt < 0, a tilted one points more than 90° from its axis),
 * or r_u > 1.05·rMaxUnit. At A₀ = 0, h₀ = 90 this is M2's polar form.
 */
export function projectAzAltDeg(
  model: CameraModel,
  azDeg: number,
  altDeg: number,
  out: Float64Array,
  offset: number,
): boolean {
  return projectWith(model, modelGeometry(model), azDeg, altDeg, out, offset);
}

function projectWith(
  model: CameraModel,
  g: ModelGeometry,
  azDeg: number,
  altDeg: number,
  out: Float32Array | Float64Array,
  offset: number,
): boolean {
  // The first test also rejects a NaN altitude.
  if (!(altDeg >= -90 && altDeg <= 90) || !Number.isFinite(azDeg)) return false;
  // [M9] Surely culled below (c ≥ |h − h₀|): skip the trigonometry, as for every star below a zenith fisheye's horizon.
  if (Math.abs(altDeg - g.axisAltDeg) > g.preCullDeg) return false;
  const h = altDeg * D2R;
  const dA = (azDeg - g.axisAzDeg) * D2R; // exactly M2's azimuth when A₀ = 0
  const sinH = Math.sin(h);
  const cosH = Math.cos(h);
  const cosDA = Math.cos(dA);
  // c is the angle from the optical axis; (X, Y) the direction's components along image-right and image-up.
  const cosC = g.sinAxisAlt * sinH + g.cosAxisAlt * cosH * cosDA;
  const X = cosH * Math.sin(dA);
  const Y = g.cosAxisAlt * sinH - g.sinAxisAlt * cosH * cosDA;
  let x: number;
  let y: number;
  if (g.fisheye) {
    const q = Math.sqrt(X * X + Y * Y); // sin c; [M9] sqrt: |X|, |Y| ≤ 1 cannot overflow, and Math.hypot is slower
    const theta = Math.atan2(q, cosC);
    if (!(theta <= model.thetaMaxRad)) return false; // before projecting: orthographic would fold it back
    if (q === 0) {
      x = 0; // on the axis
      y = 0;
    } else {
      const k = lensRadiusUnit(model.lens, theta) / q; // unit focal: do not multiply by f before the tail
      x = k * X;
      y = k * Y;
    }
  } else {
    if (!(cosC > 0)) return false; // behind the camera or 90° from its axis
    x = X / cosC;
    y = Y / cosC;
  }
  // Shared tail: roll, frame cull, radial distortion, focal length, principal point, flip.
  const xr = x * g.cosRoll - y * g.sinRoll;
  const yr = x * g.sinRoll + y * g.cosRoll;
  const r2 = xr * xr + yr * yr;
  if (!(r2 <= g.cullRadius2)) return false; // also culls everything when rMaxUnit is NaN
  const c = model.calibration;
  const s = 1 + c.k1 * r2 + c.k2 * r2 * r2;
  out[offset] = c.cxPx + g.sx * c.focalPx * s * xr;
  out[offset + 1] = c.cyPx - c.focalPx * s * yr;
  return true;
}

const scratch = new Float64Array(2);

/**
 * [M2] Batch form for stars and satellites. azAltDeg holds [az, alt] pairs; writes [u, v] pairs to outUvPx and
 * 1/0 to outVisible for the first count pairs; returns the number projected. A culled pair's [u, v] is left as
 * it was. Arrays are allocated once by the caller and reused. Same arithmetic as projectAzAltDeg.
 */
export function projectBatch(
  model: CameraModel,
  azAltDeg: Float32Array | Float64Array,
  count: number,
  outUvPx: Float32Array | Float64Array,
  outVisible: Uint8Array,
): number {
  const g = modelGeometry(model);
  let visible = 0;
  for (let i = 0; i < count; i++) {
    const az = azAltDeg[2 * i] ?? Number.NaN;
    const alt = azAltDeg[2 * i + 1] ?? Number.NaN;
    if (projectWith(model, g, az, alt, scratch, 0)) {
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
