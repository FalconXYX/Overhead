// src/domain/geo/index.ts — WGS-84, ECEF, ENU, spherical rays. Hot-path functions write into `out` at `offset`.
// M2: ObserverSite and the angle helpers. M3: ECEF/ENU, Bowring latitude, longitude unwrapping. Destination points
// land in M6, rays in M8.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** [M2] Observer for astronomy and propagation. heightM = lens height above mean sea level. */
export interface ObserverSite {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM: number;
}

/** [M3] Row-major 3×3 matrix, length 9. */
export type Mat3 = Float64Array;

export const WGS84_A_KM = 6378.137; // [M3]
export const WGS84_B_KM = 6356.7523142; // [M3]
export const EARTH_ROTATION_RAD_S = 7.292115e-5; // [M3]

// WGS-84 derived constants, computed exactly as satellite.js geodeticToEcf and eciToGeodetic do.
const WGS84_F = (WGS84_A_KM - WGS84_B_KM) / WGS84_A_KM;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
/** Second eccentricity squared, (a² − b²)/b². */
const WGS84_EP2 = (WGS84_A_KM * WGS84_A_KM - WGS84_B_KM * WGS84_B_KM) / (WGS84_B_KM * WGS84_B_KM);

/** [M2] Result in [0, 360). */
export function wrap360(deg: number): number {
  const r = deg % 360;
  const w = r < 0 ? r + 360 : r; // r + 360 rounds to 360 for r just below 0
  return w >= 360 ? 0 : w + 0; // + 0 turns −0 into 0
}

/** [M2] Result in [−180, 180). Compare results with a tolerance: wrap180(44.8) is 44.799999999999955. */
export function wrap180(deg: number): number {
  return wrap360(deg + 180) - 180;
}

/**
 * [M2] Great-circle separation between two horizontal directions (haversine form, accurate for tiny
 * separations and near the zenith): a = sin²(Δh/2) + cos h1 cos h2 sin²(ΔA/2), result 2 asin(min(1, √a)).
 */
export function angularSeparationDeg(
  az1Deg: number,
  alt1Deg: number,
  az2Deg: number,
  alt2Deg: number,
): number {
  const h1 = alt1Deg * D2R;
  const h2 = alt2Deg * D2R;
  const sinDh = Math.sin((h2 - h1) / 2);
  const sinDa = Math.sin(((az2Deg - az1Deg) * D2R) / 2);
  const a = sinDh * sinDh + Math.cos(h1) * Math.cos(h2) * sinDa * sinDa;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * R2D;
}

/** [M3] Columns are East, North, Up in ECEF for geodetic latDeg/lonDeg (brief matrix). */
export function enuToEcefMatrix(
  latDeg: number,
  lonDeg: number,
  out: Mat3 = new Float64Array(9),
): Mat3 {
  const sinLat = Math.sin(latDeg * D2R);
  const cosLat = Math.cos(latDeg * D2R);
  const sinLon = Math.sin(lonDeg * D2R);
  const cosLon = Math.cos(lonDeg * D2R);
  // Row 0: x components of E, N, U.
  out[0] = -sinLon;
  out[1] = -sinLat * cosLon;
  out[2] = cosLat * cosLon;
  // Row 1: y components.
  out[3] = cosLon;
  out[4] = -sinLat * sinLon;
  out[5] = cosLat * sinLon;
  // Row 2: z components.
  out[6] = 0;
  out[7] = cosLat;
  out[8] = sinLat;
  return out;
}

/** [M3] out[offset..+2] = M · (eKm, nKm, uKm). */
export function enuToEcef(
  m: Mat3,
  eKm: number,
  nKm: number,
  uKm: number,
  out: Float64Array,
  offset: number,
): void {
  out[offset] = (m[0] ?? 0) * eKm + (m[1] ?? 0) * nKm + (m[2] ?? 0) * uKm;
  out[offset + 1] = (m[3] ?? 0) * eKm + (m[4] ?? 0) * nKm + (m[5] ?? 0) * uKm;
  out[offset + 2] = (m[6] ?? 0) * eKm + (m[7] ?? 0) * nKm + (m[8] ?? 0) * uKm;
}

/** [M3] out[offset..+2] = Mᵀ · (dxKm, dyKm, dzKm). */
export function ecefToEnu(
  m: Mat3,
  dxKm: number,
  dyKm: number,
  dzKm: number,
  out: Float64Array,
  offset: number,
): void {
  out[offset] = (m[0] ?? 0) * dxKm + (m[3] ?? 0) * dyKm + (m[6] ?? 0) * dzKm;
  out[offset + 1] = (m[1] ?? 0) * dxKm + (m[4] ?? 0) * dyKm + (m[7] ?? 0) * dzKm;
  out[offset + 2] = (m[2] ?? 0) * dxKm + (m[5] ?? 0) * dyKm + (m[8] ?? 0) * dzKm;
}

/** [M3] WGS-84 geodetic → ECEF km (same model as satellite.js geodeticToEcf). */
export function geodeticToEcefKm(
  latDeg: number,
  lonDeg: number,
  heightM: number,
  out: Float64Array,
  offset: number,
): void {
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const heightKm = heightM / 1000;
  const normal = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * (sinLat * sinLat));
  out[offset] = (normal + heightKm) * cosLat * Math.cos(lon);
  out[offset + 1] = (normal + heightKm) * cosLat * Math.sin(lon);
  out[offset + 2] = (normal * (1 - WGS84_E2) + heightKm) * sinLat;
}

/** [M3] Unit ENU vector (cos alt sin az, cos alt cos az, sin alt). */
export function azAltToEnuUnit(
  azDeg: number,
  altDeg: number,
  out: Float64Array,
  offset: number,
): void {
  const az = azDeg * D2R;
  const alt = altDeg * D2R;
  const cosAlt = Math.cos(alt);
  out[offset] = cosAlt * Math.sin(az);
  out[offset + 1] = cosAlt * Math.cos(az);
  out[offset + 2] = Math.sin(alt);
}

/** [M3] out = [azDeg in [0, 360), altDeg] (geometric); az = atan2(E, N). */
export function enuToAzAltDeg(
  eKm: number,
  nKm: number,
  uKm: number,
  out: Float64Array,
  offset: number,
): void {
  out[offset] = wrap360(Math.atan2(eKm, nKm) * R2D);
  out[offset + 1] = Math.atan2(uKm, Math.sqrt(eKm * eKm + nKm * nKm)) * R2D;
}

/**
 * [M3] One-step Bowring latitude, lon = atan2(y, x): out = [latDeg, lonDeg]. Max error ≈ 1e-7° vs eciToGeodetic.
 * p = hypot(x, y), θ = atan2(z·a, p·b), lat = atan2(z + e′²·b·sin³θ, p − e²·a·cos³θ). Closed form: never call
 * satellite.js eciToGeodetic (a fixed 20-iteration loop) per tick or per frame.
 */
export function ecefToLatLonDeg(
  xKm: number,
  yKm: number,
  zKm: number,
  out: Float64Array,
  offset: number,
): void {
  const p = Math.sqrt(xKm * xKm + yKm * yKm);
  const theta = Math.atan2(zKm * WGS84_A_KM, p * WGS84_B_KM);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  out[offset] =
    Math.atan2(
      zKm + WGS84_EP2 * WGS84_B_KM * sinT * sinT * sinT,
      p - WGS84_E2 * WGS84_A_KM * cosT * cosT * cosT,
    ) * R2D;
  out[offset + 1] = Math.atan2(yKm, xKm) * R2D;
}

/** [M3] lonDeg + k·360 such that |result − prevLonDeg| ≤ 180. */
export function unwrapLonDeg(prevLonDeg: number, lonDeg: number): number {
  return lonDeg + 360 * Math.round((prevLonDeg - lonDeg) / 360);
}

/** [M3] Unwraps interleaved [lon, lat, lon, lat, ...] pairs in place, starting from a lon in [−180, 180). */
export function unwrapLonLatPairsInPlace(lonLatDeg: Float64Array, pairCount: number): void {
  if (pairCount <= 0) return;
  let prev = wrap180(lonLatDeg[0] ?? 0);
  lonLatDeg[0] = prev;
  for (let i = 1; i < pairCount; i++) {
    prev = unwrapLonDeg(prev, lonLatDeg[2 * i] ?? 0);
    lonLatDeg[2 * i] = prev;
  }
}
