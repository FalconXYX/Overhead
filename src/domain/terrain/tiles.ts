// src/domain/terrain/tiles.ts — Web-Mercator tile addressing, the bilinear elevation sampler and the tile plan
// (M6 step 3). The sampler runs about 200,000 times per profile, so tile keys are numbers, never strings.
import { marchRay } from "./horizon";
import { TILE_SIZE_PX } from "./terrarium";

export type TileZoom = 8 | 9 | 10 | 12 | 14;
export interface TileKey {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** Bilinear elevation in metres at a point; NaN when a needed tile is missing. dM is the ground distance from the site. */
export type ElevationSampler = (
  latDeg: number,
  lonDeg: number,
  dM: number,
  zoom: TileZoom,
) => number;

const D2R = Math.PI / 180;
const SITE_ZOOM: TileZoom = 14;
const ALL_AZIMUTHS_DEG: readonly number[] = Array.from({ length: 360 }, (_, az) => az);

/** Numeric Map key, no string allocation per sample: (z·2^15 + x)·2^15 + y. */
export function tileId(z: number, x: number, y: number): number {
  return (z * 32_768 + x) * 32_768 + y;
}

/** Tile column of global texel column x at a zoom with n tiles per side; wraps the antimeridian. */
const tileXOf = (x: number, n: number): number => (((x >> 8) % n) + n) % n;
/** Tile row of global texel row y; clamps at the poles. */
const tileYOf = (y: number, n: number): number => Math.min(Math.max(y >> 8, 0), n - 1);

/**
 * Web-Mercator global pixel at zoom z: X = (lon + 180)/360·256·2^z − 0.5, Y = (1 − asinh(tan φ)/π)/2·256·2^z − 0.5.
 * The −0.5 puts pixel centres on integers, which is what bilinear sampling needs.
 */
export function lonLatToWorldPx(
  lonDeg: number,
  latDeg: number,
  z: number,
  out: Float64Array,
  offset: number,
): void {
  const size = TILE_SIZE_PX * 2 ** z;
  out[offset] = ((lonDeg + 180) / 360) * size - 0.5;
  out[offset + 1] = ((1 - Math.asinh(Math.tan(latDeg * D2R)) / Math.PI) / 2) * size - 0.5;
}

/** Bilinear sampler over decoded tiles (Float32Array(65536) each, keyed by tileId); NaN when a needed tile is missing. */
export function createTileSampler(tiles: ReadonlyMap<number, Float32Array>): ElevationSampler {
  const px = new Float64Array(2);
  const texel = (z: number, x: number, y: number): number => {
    const n = 2 ** z;
    const tx = tileXOf(x, n);
    const ty = tileYOf(y, n);
    const tile = tiles.get(tileId(z, tx, ty));
    if (tile === undefined) return Number.NaN;
    const row = Math.min(Math.max(y - ty * 256, 0), 255);
    return tile[row * 256 + (x & 255)] ?? Number.NaN;
  };
  return (latDeg, lonDeg, _dM, zoom) => {
    lonLatToWorldPx(lonDeg, latDeg, zoom, px, 0);
    const X = px[0] ?? 0;
    const Y = px[1] ?? 0;
    const x0 = Math.floor(X);
    const y0 = Math.floor(Y);
    const fx = X - x0;
    const fy = Y - y0;
    // The four texels may lie in up to four different tiles.
    const top = texel(zoom, x0, y0) * (1 - fx) + texel(zoom, x0 + 1, y0) * fx;
    const bottom = texel(zoom, x0, y0 + 1) * (1 - fx) + texel(zoom, x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/**
 * Every tile the march touches (four bilinear texels per sample, zoomForDistanceM) plus the site's z14 tiles.
 * azimuthsDeg defaults to 0…359. Walks marchRay itself, so the plan and the profile can never disagree.
 * The site's tiles come first; limitM 0 returns only them.
 */
export function tilesForSite(
  latDeg: number,
  lonDeg: number,
  limitM: number,
  azimuthsDeg: readonly number[] = ALL_AZIMUTHS_DEG,
): TileKey[] {
  const keys = new Map<number, TileKey>();
  const px = new Float64Array(2);
  const addTexel = (z: TileZoom, x: number, y: number): void => {
    const n = 2 ** z;
    const tx = tileXOf(x, n);
    const ty = tileYOf(y, n);
    const id = tileId(z, tx, ty);
    if (!keys.has(id)) keys.set(id, { z, x: tx, y: ty });
  };
  const addSample = (la: number, lo: number, zoom: TileZoom): void => {
    lonLatToWorldPx(lo, la, zoom, px, 0);
    const x0 = Math.floor(px[0] ?? 0);
    const y0 = Math.floor(px[1] ?? 0);
    addTexel(zoom, x0, y0);
    addTexel(zoom, x0 + 1, y0);
    addTexel(zoom, x0, y0 + 1);
    addTexel(zoom, x0 + 1, y0 + 1);
  };
  addSample(latDeg, lonDeg, SITE_ZOOM);
  for (const az of azimuthsDeg) {
    marchRay(latDeg, lonDeg, az, limitM, (la, lo, _d, zoom) => addSample(la, lo, zoom));
  }
  return [...keys.values()];
}
