// src/domain/terrain/horizon.ts — the terrain horizon (M6 steps 1 and 4): apparent elevation with refraction
// κ 0.13, the zoom-by-distance plan, the one spherical march, the 360° profile and its lookup.
// Imports only types from tiles.ts, so tiles.ts can call marchRay without a runtime import cycle.
import { destinationLatLonDeg, wrap360 } from "../geo";
import { TILE_SIZE_PX } from "./terrarium";
import type { ElevationSampler, TileZoom } from "./tiles";

/** Terrestrial refraction coefficient: light curves with 0.13 of the Earth's curvature. */
export const REFRACTION_KAPPA = 0.13;
export const EARTH_RADIUS_M = 6_371_000;

/** (1 − κ)/(2R) = 6.828e-8 m⁻¹: the drop of a distant point below the eye's tangent plane, per d². */
const CURVATURE_PER_M = (1 - REFRACTION_KAPPA) / (2 * EARTH_RADIUS_M);
const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
/** Equatorial circumference of the Web-Mercator sphere, metres. */
const MERCATOR_CIRCUMFERENCE_M = 40_075_016.686;
const PROFILE_LENGTH = 360;

/**
 * α = atan((zM − z0M − dM²(1 − κ)/(2R)) / dM) in degrees. No clamping here. The result is already apparent
 * (the κ term carries the refraction).
 */
export function apparentElevationDeg(zM: number, z0M: number, dM: number): number {
  return Math.atan((zM - z0M - dM * dM * CURVATURE_PER_M) / dM) * R2D;
}

/** z14 < 1.5 km, z12 < 8 km, z10 < 30 km, z9 < 60 km, z8 beyond; each boundary belongs to the coarser zoom. */
export function zoomForDistanceM(dM: number): TileZoom {
  if (dM < 1500) return 14;
  if (dM < 8000) return 12;
  if (dM < 30_000) return 10;
  if (dM < 60_000) return 9;
  return 8;
}

/**
 * max(100 km, 1.05·sqrt(2R·max(z0M, 0)/(1 − κ))): 5 % past the refracted sea-horizon distance. z0 is clamped
 * first, or a site below sea level gets sqrt(negative) = NaN and an empty march (M6 gotcha 15).
 */
export function marchLimitM(z0M: number): number {
  return Math.max(
    100_000,
    1.05 * Math.sqrt((2 * EARTH_RADIUS_M * Math.max(z0M, 0)) / (1 - REFRACTION_KAPPA)),
  );
}

/** Ground size of one texel at tile zoom z: 40075016.686/(256·2^z)·cos(lat). The hillshade divides central differences by 2 × this. */
export function texelGroundM(tileZ: number, latDeg: number): number {
  return (MERCATOR_CIRCUMFERENCE_M / (TILE_SIZE_PX * 2 ** tileZ)) * Math.cos(latDeg * D2R);
}

const point = new Float64Array(2);

/**
 * The one march: d = 20 m, then d += max(10 m, 0.01·d) while d ≤ limitM, spherical destination points.
 * Shared by the profile and the tile plan; never write a second loop. 561 samples to 100 km, 657 to 258.8 km.
 */
export function marchRay(
  latDeg: number,
  lonDeg: number,
  azDeg: number,
  limitM: number,
  visit: (latDeg: number, lonDeg: number, dM: number, zoom: TileZoom) => void,
): void {
  for (let d = 20; d <= limitM; d += Math.max(10, 0.01 * d)) {
    destinationLatLonDeg(latDeg, lonDeg, azDeg, d, point, 0);
    visit(point[0] ?? 0, point[1] ?? 0, d, zoomForDistanceM(d));
  }
}

/**
 * For az = 0..359: marchRay, z = max(z, 0) (Terrarium oceans are seabed), keep the largest apparentElevationDeg.
 * NaN samples are skipped; a ray with no valid sample gives NaN. Writes 360 values in degrees.
 */
export function horizonProfileDeg(
  sample: ElevationSampler,
  latDeg: number,
  lonDeg: number,
  z0M: number,
  limitM: number,
  out: Float32Array,
): void {
  for (let az = 0; az < PROFILE_LENGTH; az++) {
    let bestTan = Number.NEGATIVE_INFINITY; // atan is monotonic: keep the largest tangent, one atan per ray
    marchRay(latDeg, lonDeg, az, limitM, (la, lo, d, zoom) => {
      const z = sample(la, lo, d, zoom);
      if (Number.isNaN(z)) return; // missing tile (tests only; the worker never marches with gaps)
      const t = (Math.max(z, 0) - z0M - d * d * CURVATURE_PER_M) / d; // max(z, 0): ocean pixels are seabed
      if (t > bestTan) bestTan = t;
    });
    out[az] = bestTan === Number.NEGATIVE_INFINITY ? Number.NaN : Math.atan(bestTan) * R2D;
  }
}

/** Linear interpolation between the two neighbouring whole degrees (359 wraps to 0); 0 (geometric horizon) when profileDeg is null. */
export function horizonAltAtAzDeg(profileDeg: Float32Array | null, azDeg: number): number {
  if (profileDeg === null) return 0;
  const a = wrap360(azDeg);
  const i0 = Math.floor(a);
  const f = a - i0;
  const v0 = profileDeg[i0] ?? 0;
  if (f === 0) return v0;
  const v1 = profileDeg[i0 + 1 === PROFILE_LENGTH ? 0 : i0 + 1] ?? 0;
  return v0 + (v1 - v0) * f;
}
