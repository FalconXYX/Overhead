// src/domain/geo/index.ts — WGS-84, ECEF, ENU, spherical rays. Hot-path functions write into `out` at `offset`.
// M2 subset: ObserverSite and the angle helpers. ECEF/ENU land in M3, destination points in M6, rays in M8.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** [M2] Observer for astronomy and propagation. heightM = lens height above mean sea level. */
export interface ObserverSite {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM: number;
}

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
