// src/domain/astro/stars.ts — J2000 star catalogue rows to apparent az/alt, one rotation matrix per pass.
import {
  type AstroTime,
  InverseRefraction,
  type Observer,
  Refraction,
  Rotation_EQJ_HOR,
} from "astronomy-engine";
import { SKY_RECOMPUTE_MS } from "../time";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** [M9] Refraction("normal", −1): the clamp value astronomy-engine scales toward the nadir below −1°. */
const REFRACTION_AT_MINUS_1_DEG = Refraction("normal", -1);

/**
 * stars.json row. Rows are sorted by vmag, then HR, so a magnitude limit is a prefix. name: the IAU-CSN proper
 * name, else the Bayer designation ("ι Tel", "ψ6 Aur"), else the Flamsteed one ("61 Cyg"), else "" (shown as "HR n").
 */
export type StarRow = readonly [
  raDegJ2000: number,
  decDegJ2000: number,
  vmag: number,
  hr: number,
  name: string,
];

/** J2000 unit vectors (cos δ cos α, cos δ sin α, sin δ), Float64Array(3 × rows.length). */
export function starUnitVectors(rows: readonly StarRow[]): Float64Array {
  const out = new Float64Array(3 * rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const ra = row[0] * D2R;
    const dec = row[1] * D2R;
    const cd = Math.cos(dec);
    out[3 * i] = cd * Math.cos(ra);
    out[3 * i + 1] = cd * Math.sin(ra);
    out[3 * i + 2] = Math.sin(dec);
  }
  return out;
}

/**
 * One Rotation_EQJ_HOR per call, inlined over the first `count` stars; az = (360 − atan2(w, n)) mod 360,
 * alt = atan2(u, √(n² + w²)) + Refraction('normal', alt). Writes [azDeg, altDeg] pairs. Allocates nothing per star.
 */
export function rotateStarsAzAltDeg(
  time: AstroTime,
  observer: Observer,
  unitJ2000: Float64Array,
  count: number,
  outAzAltDeg: Float32Array,
): void {
  // Rotation_EQJ_HOR output frame: x = north, y = west, z = up. Same index order as RotateVector.
  const r = Rotation_EQJ_HOR(time, observer).rot;
  const a00 = r[0]?.[0] ?? 0;
  const a01 = r[0]?.[1] ?? 0;
  const a02 = r[0]?.[2] ?? 0;
  const a10 = r[1]?.[0] ?? 0;
  const a11 = r[1]?.[1] ?? 0;
  const a12 = r[1]?.[2] ?? 0;
  const a20 = r[2]?.[0] ?? 0;
  const a21 = r[2]?.[1] ?? 0;
  const a22 = r[2]?.[2] ?? 0;
  for (let i = 0; i < count; i++) {
    const vx = unitJ2000[3 * i] ?? 0;
    const vy = unitJ2000[3 * i + 1] ?? 0;
    const vz = unitJ2000[3 * i + 2] ?? 0;
    const n = a00 * vx + a10 * vy + a20 * vz;
    const w = a01 * vx + a11 * vy + a21 * vz;
    const u = a02 * vx + a12 * vy + a22 * vz;
    let az = -Math.atan2(w, n) * R2D;
    if (az < 0) az += 360;
    if (az >= 360) az -= 360;
    // [M9] sqrt rather than Math.hypot (a unit vector cannot overflow; hypot cost about 10 ns a star).
    const alt = Math.atan2(u, Math.sqrt(n * n + w * w)) * R2D;
    outAzAltDeg[2 * i] = az;
    // [M9] Below −1° astronomy-engine's 'normal' refraction is its −1° value scaled by (alt + 90) / 89: the same
    // arithmetic without a tan per star (about half the catalogue is below the horizon).
    outAzAltDeg[2 * i + 1] =
      alt +
      (alt < -1 ? REFRACTION_AT_MINUS_1_DEG * ((alt + 90.0) / 89.0) : Refraction("normal", alt));
  }
}

/** geometricAltDeg + Refraction('normal', geometricAltDeg). Used for satellites at every altitude. */
export function apparentAltDeg(geometricAltDeg: number): number {
  return geometricAltDeg + Refraction("normal", geometricAltDeg);
}

/** apparentAltDeg + InverseRefraction('normal', apparentAltDeg). Footprint rays use geometric altitude. */
export function geometricAltDeg(apparentAltDeg: number): number {
  return apparentAltDeg + InverseRefraction("normal", apparentAltDeg);
}

/** true when lastSkyMs is null or |simTimeMs − lastSkyMs| ≥ SKY_RECOMPUTE_MS. */
export function needsSkyRecompute(simTimeMs: number, lastSkyMs: number | null): boolean {
  return lastSkyMs === null || Math.abs(simTimeMs - lastSkyMs) >= SKY_RECOMPUTE_MS;
}
