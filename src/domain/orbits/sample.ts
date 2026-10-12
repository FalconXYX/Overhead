// src/domain/orbits/sample.ts — the packed per-object sample and propagation into it (M3 step 5).
import { gstime, jday, propagate, type SatRec, shadowFraction, sunPos } from "satellite.js";
import {
  EARTH_ROTATION_RAD_S,
  enuToEcefMatrix,
  geodeticToEcefKm,
  type Mat3,
  type ObserverSite,
} from "../geo";

const R2D = 180 / Math.PI;
const KM_PER_AU = 149_597_870.7;

/** Packed per-object sample: Float32Array(count × SAMPLE_STRIDE), satrec-index order. */
export const SAMPLE_STRIDE = 8;
export const SampleField = {
  eKm: 0, // topocentric ENU position from the observer
  nKm: 1,
  uKm: 2,
  veKmS: 3, // Earth-fixed velocity in ENU: Mᵀ(eciToEcf(v) − ω × r_ecf)
  vnKmS: 4,
  vuKmS: 5,
  sunlit: 6, // 1 if shadowFraction < 0.5, else 0 (step value, never interpolated)
  valid: 7, // 1 if propagate succeeded and the object is active, else 0
} as const;

/** Per-tick constants shared by every object (built once per sample request). */
export interface PropagationContext {
  readonly timeMs: number;
  readonly date: Date;
  readonly gmstRad: number;
  readonly sunEciAu: { readonly x: number; readonly y: number; readonly z: number };
  readonly observerEcefKm: Float64Array; // WGS-84, from geodeticToEcf
  readonly enuToEcef: Mat3;
  /** Sun geometric altitude at the observer (no refraction), from sunPos → eciToEcf → look angles. */
  readonly sunAltDeg: number;
}

export function createPropagationContext(timeMs: number, site: ObserverSite): PropagationContext {
  const date = new Date(timeMs);
  const gmstRad = gstime(date);
  const sunEciAu = sunPos(jday(date)).rsun;
  const observerEcefKm = new Float64Array(3);
  geodeticToEcefKm(site.latDeg, site.lonDeg, site.heightM, observerEcefKm, 0);
  const m = enuToEcefMatrix(site.latDeg, site.lonDeg);
  // Sun geometric altitude (the twilight convention): AU -> km, rotate ECI -> ECEF by GMST, subtract the
  // observer, project on Up. Without the AU -> km scaling the topocentric vector is meaningless (gotcha 8).
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  const sx = sunEciAu.x * KM_PER_AU;
  const sy = sunEciAu.y * KM_PER_AU;
  const dx = sx * c + sy * s - (observerEcefKm[0] ?? 0);
  const dy = -sx * s + sy * c - (observerEcefKm[1] ?? 0);
  const dz = sunEciAu.z * KM_PER_AU - (observerEcefKm[2] ?? 0);
  const e = (m[0] ?? 0) * dx + (m[3] ?? 0) * dy + (m[6] ?? 0) * dz;
  const n = (m[1] ?? 0) * dx + (m[4] ?? 0) * dy + (m[7] ?? 0) * dz;
  const u = (m[2] ?? 0) * dx + (m[5] ?? 0) * dy + (m[8] ?? 0) * dz;
  const sunAltDeg = Math.atan2(u, Math.hypot(e, n)) * R2D;
  return { timeMs, date, gmstRad, sunEciAu, observerEcefKm, enuToEcef: m, sunAltDeg };
}

/**
 * propagate + ENU + Earth-fixed velocity + shadow, written at out[index × SAMPLE_STRIDE]. Returns false (valid = 0,
 * the whole slot zeroed) when propagate returns null (decayed or bad elements); the caller logs satrec.error.
 * Allocates nothing beyond what satellite.js propagate returns.
 */
export function writeSample(
  satrec: SatRec,
  ctx: PropagationContext,
  out: Float32Array,
  index: number,
): boolean {
  const o = index * SAMPLE_STRIDE;
  const pv = propagate(satrec, ctx.date);
  if (pv === null) {
    out.fill(0, o, o + SAMPLE_STRIDE); // valid = 0
    return false;
  }
  const { position: r, velocity: v } = pv;
  const c = Math.cos(ctx.gmstRad);
  const s = Math.sin(ctx.gmstRad);
  // ECI (TEME) -> ECEF: rotate about z by GMST (the same rotation as eciToEcf).
  const rx = r.x * c + r.y * s;
  const ry = -r.x * s + r.y * c;
  const rz = r.z;
  // Earth-fixed velocity: rotate, then subtract ω × r (ω along +z). Without it Hermite is worse than linear (gotcha 9).
  const vx = v.x * c + v.y * s + EARTH_ROTATION_RAD_S * ry;
  const vy = -v.x * s + v.y * c - EARTH_ROTATION_RAD_S * rx;
  const vz = v.z;
  const m = ctx.enuToEcef;
  const obs = ctx.observerEcefKm;
  const dx = rx - (obs[0] ?? 0);
  const dy = ry - (obs[1] ?? 0);
  const dz = rz - (obs[2] ?? 0);
  const m0 = m[0] ?? 0;
  const m1 = m[1] ?? 0;
  const m2 = m[2] ?? 0;
  const m3 = m[3] ?? 0;
  const m4 = m[4] ?? 0;
  const m5 = m[5] ?? 0;
  const m6 = m[6] ?? 0;
  const m7 = m[7] ?? 0;
  const m8 = m[8] ?? 0;
  out[o + SampleField.eKm] = m0 * dx + m3 * dy + m6 * dz; // ENU = Mᵀ d
  out[o + SampleField.nKm] = m1 * dx + m4 * dy + m7 * dz;
  out[o + SampleField.uKm] = m2 * dx + m5 * dy + m8 * dz;
  out[o + SampleField.veKmS] = m0 * vx + m3 * vy + m6 * vz;
  out[o + SampleField.vnKmS] = m1 * vx + m4 * vy + m7 * vz;
  out[o + SampleField.vuKmS] = m2 * vx + m5 * vy + m8 * vz;
  // Sun (AU) first, satellite (km, ECI) second: swapped arguments return NaN (gotcha 7).
  out[o + SampleField.sunlit] = shadowFraction(ctx.sunEciAu, r) < 0.5 ? 1 : 0;
  out[o + SampleField.valid] = 1;
  return true;
}
