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
/** [M6] Footprint and destination sphere radius. Never mix with WGS-84 positions. */
export const EARTH_MEAN_RADIUS_KM = 6371.0088;
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
  // [M9] sin θ and cos θ of θ = atan2(z·a, p·b) without the atan2, sin and cos: the same values to a few ulps, and
  // this runs for every Starlink row on the ground map (M9 step 4).
  const za = zKm * WGS84_A_KM;
  const pb = p * WGS84_B_KM;
  const r = Math.sqrt(za * za + pb * pb);
  const sinT = r > 0 ? za / r : 0;
  const cosT = r > 0 ? pb / r : 1;
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

/**
 * [M6] Spherical destination point (great circle, EARTH_MEAN_RADIUS_KM), out = [latDeg, lonDeg in [−180, 180)].
 * δ = d/R, φ₂ = asin(sin φ₁ cos δ + cos φ₁ sin δ cos θ), λ₂ = λ₁ + atan2(sin θ sin δ cos φ₁, cos δ − sin φ₁ sin φ₂).
 * The horizon march calls it about 200,000 times per profile, so it allocates nothing. Never step in EPSG:3857
 * metres instead: that overstates ground distance by 1/cos(lat) (M6 gotcha 7).
 */
export function destinationLatLonDeg(
  latDeg: number,
  lonDeg: number,
  azDeg: number,
  distanceM: number,
  out: Float64Array,
  offset: number,
): void {
  const delta = distanceM / (EARTH_MEAN_RADIUS_KM * 1000);
  const phi1 = latDeg * D2R;
  const theta = azDeg * D2R;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);
  const sinPhi2 = Math.min(
    1,
    Math.max(-1, sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta)),
  );
  const dLambda = Math.atan2(Math.sin(theta) * sinDelta * cosPhi1, cosDelta - sinPhi1 * sinPhi2);
  out[offset] = Math.asin(sinPhi2) * R2D;
  out[offset + 1] = wrap180(lonDeg + dLambda * R2D);
}

// ---- [M8] Rays on the footprint sphere and the geodetic height (M8 steps 1 and 2)
// One sphere, R = EARTH_MEAN_RADIUS_KM, with O = (R + h)·û. Never use the WGS-84 position of geodeticToEcefKm as O:
// the straight-up hit would land 0.115° (about 13 km) from the site (M8 gotcha 2).

/** [M8] Footprint model: O = (R + h)·û with R = EARTH_MEAN_RADIUS_KM. Never a WGS-84 position. */
export function sphericalObserverKm(
  latDeg: number,
  lonDeg: number,
  heightM: number,
  out: Float64Array,
  offset: number,
): void {
  const r = EARTH_MEAN_RADIUS_KM + heightM / 1000;
  const cosLat = Math.cos(latDeg * D2R);
  out[offset] = r * cosLat * Math.cos(lonDeg * D2R);
  out[offset + 1] = r * cosLat * Math.sin(lonDeg * D2R);
  out[offset + 2] = r * Math.sin(latDeg * D2R);
}

/**
 * [M8] Forward (+) root t of |O + t·d| = radiusKm for a unit d; null if there is no real root or t ≤ 0.
 * It is positive even for a ray that hits the Earth first (the far side): reject those with raySphereEntryKm.
 */
export function raySphereExitKm(
  oxKm: number,
  oyKm: number,
  ozKm: number,
  dx: number,
  dy: number,
  dz: number,
  radiusKm: number,
): number | null {
  const b = oxKm * dx + oyKm * dy + ozKm * dz; // O·d
  const c = oxKm * oxKm + oyKm * oyKm + ozKm * ozKm - radiusKm * radiusKm; // |O|² − r²
  const disc = b * b - c;
  if (!(disc >= 0)) return null; // also rejects NaN
  const t = -b + Math.sqrt(disc);
  return t > 0 ? t : null;
}

/**
 * [M8] Distance to the first hit of the sphere radiusKm in front of O, or null if the ray misses it. A tangent
 * counts as a hit. From outside it uses c/(−b + q), which equals −b − q without the cancellation near the tangent.
 */
export function raySphereEntryKm(
  oxKm: number,
  oyKm: number,
  ozKm: number,
  dx: number,
  dy: number,
  dz: number,
  radiusKm: number,
): number | null {
  const b = oxKm * dx + oyKm * dy + ozKm * dz;
  const c = oxKm * oxKm + oyKm * oyKm + ozKm * ozKm - radiusKm * radiusKm;
  const disc = b * b - c;
  if (!(disc >= 0)) return null;
  const q = Math.sqrt(disc);
  if (c <= 0) return -b + q; // O inside or on the sphere: the exit is the first hit
  if (b >= 0) return null; // O outside and pointing away
  return c / (-b + q);
}

/**
 * [M8] Spherical: out = [atan2(z, hypot(x, y)), atan2(y, x)] in degrees (= asin(z/|P|)). Footprint vertices only:
 * the model puts the site at spherical latitude = geodetic latitude, so the Bowring latitude of ecefToLatLonDeg
 * would move the straight-up hit 0.1155° north at Maunakea (M8 gotcha 9).
 */
export function sphericalLatLonDeg(
  xKm: number,
  yKm: number,
  zKm: number,
  out: Float64Array,
  offset: number,
): void {
  out[offset] = Math.atan2(zKm, Math.sqrt(xKm * xKm + yKm * yKm)) * R2D;
  out[offset + 1] = Math.atan2(yKm, xKm) * R2D;
}

/** [M8] −acos(R / (R + h)) in degrees: −2.0809° at 4,204 m. */
export function geometricDipDeg(heightM: number): number {
  return -Math.acos(EARTH_MEAN_RADIUS_KM / (EARTH_MEAN_RADIUS_KM + heightM / 1000)) * R2D;
}

/**
 * [M8] WGS-84 geodetic height (km) of an ECEF point: the one-step Bowring φ of ecefToLatLonDeg, then
 * h = p·cos φ + z·sin φ − a·√(1 − e²·sin²φ). Valid at every latitude (never divides by cos φ); h is stationary in
 * φ, so the Bowring error enters only to second order (6.4e-12 km against eciToGeodetic over the snapshot).
 */
export function geodeticHeightKm(xKm: number, yKm: number, zKm: number): number {
  const p = Math.sqrt(xKm * xKm + yKm * yKm);
  const theta = Math.atan2(zKm * WGS84_A_KM, p * WGS84_B_KM);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const phi = Math.atan2(
    zKm + WGS84_EP2 * WGS84_B_KM * sinT * sinT * sinT,
    p - WGS84_E2 * WGS84_A_KM * cosT * cosT * cosT,
  );
  const sinPhi = Math.sin(phi);
  return p * Math.cos(phi) + zKm * sinPhi - WGS84_A_KM * Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
}
