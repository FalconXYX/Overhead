// src/domain/orbits/interpolate.ts — an object's position between two worker samples (README section 7, Interpolation).
// Only Cartesian ENU is interpolated, never az, alt, longitude or the sunlit flag: callers recover az/alt with
// enuToAzAltDeg and refract with apparentAltDeg (every altitude), and the ground map goes O + M·ENU → Bowring.
import type { ClockRate } from "../time";
import { SAMPLE_STRIDE, SampleField } from "./sample";

export type InterpMode = "linear" | "hermite";

/**
 * "linear" up to 60×, "hermite" at 600×. Measured on the ISS (M3 step 6): linear 0.0024° at 60× but 0.22° at 600×,
 * Hermite with the Earth-fixed velocity 4.1e-5° at 600×.
 */
export function interpModeForRate(rate: ClockRate): InterpMode {
  return rate >= 600 ? "hermite" : "linear";
}

const E = SampleField.eKm;
const VE = SampleField.veKmS;
const VALID = SampleField.valid;

/**
 * ENU position of object `index` at timeMs between samples a (tAMs) and b (tBMs), s clamped to [0, 1].
 * Writes [eKm, nKm, uKm] to out; returns false if either sample is invalid.
 *
 * Never extrapolates: outside [tAMs, tBMs] the nearer end sample's position is held. `b === a` (the next sample is
 * late), a span ≤ 0 and a non-finite time all hold a's position. Allocates nothing.
 */
export function interpolateEnuKm(
  a: Float32Array,
  tAMs: number,
  b: Float32Array,
  tBMs: number,
  index: number,
  timeMs: number,
  mode: InterpMode,
  out: Float64Array,
  offset: number,
): boolean {
  const o = index * SAMPLE_STRIDE;
  if (a[o + VALID] !== 1 || b[o + VALID] !== 1) return false;
  const span = tBMs - tAMs;
  // s = (t − tA) / span clamped to [0, 1]; NaN (a non-finite time or span) falls to 0, so a is held.
  const raw = b === a || !(span > 0) ? 0 : (timeMs - tAMs) / span;
  const s = raw > 0 ? (raw < 1 ? raw : 1) : 0;
  // At s = 0 or 1 both modes give the end position exactly; routing them here also keeps a non-finite span
  // (s forced to 0) out of the Hermite tangents, where 0 × NaN would be NaN.
  if (mode === "linear" || s === 0 || s === 1) {
    const r = 1 - s;
    for (let k = 0; k < 3; k++) {
      out[offset + k] = r * (a[o + E + k] ?? 0) + s * (b[o + E + k] ?? 0);
    }
    return true;
  }
  // Cubic Hermite: positions in km, velocities in km/s, so scale the tangents by the span in seconds.
  const hSec = span / 1000;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  for (let k = 0; k < 3; k++) {
    out[offset + k] =
      h00 * (a[o + E + k] ?? 0) +
      h10 * hSec * (a[o + VE + k] ?? 0) +
      h01 * (b[o + E + k] ?? 0) +
      h11 * hSec * (b[o + VE + k] ?? 0);
  }
  return true;
}

/**
 * Sunlit flag of object `index` from the sample nearer in time: a step value, never blended. A tie or a non-finite
 * time takes a. The caller takes the Sun's altitude from the same sample.
 */
export function sunlitAt(
  a: Float32Array,
  tAMs: number,
  b: Float32Array,
  tBMs: number,
  index: number,
  timeMs: number,
): boolean {
  const nearer = timeMs - tAMs > tBMs - timeMs ? b : a;
  return nearer[index * SAMPLE_STRIDE + SampleField.sunlit] === 1;
}
