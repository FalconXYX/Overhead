// src/state/skyCache.ts — star and body az/alt arrays, kept out of the store (M2 step 7). Recomputed when the sim
// time has moved ≥ 2 s either way since the last pass, the site object changes, or a caller clears lastSkyMs.
import type { Observer } from "astronomy-engine";
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
  needsSkyRecompute,
  rotateStarsAzAltDeg,
  type StarRow,
  starUnitVectors,
} from "../domain/astro";
import type { ObserverSite } from "../domain/geo";
import { selectStarMagLimit } from "./selectors";
import type { AppStore } from "./store";

/** Rows in the committed stars.json, and the stars layer's capacity (M2 step 8): loadStars rejects more. */
export const MAX_STAR_ROWS = 8404;

export interface SkyCache {
  rows: readonly StarRow[]; // stars.json, brightest first
  unitJ2000: Float64Array; // 3 × rows.length
  starCount: number; // prefix with vmag ≤ the current limit
  starAzAltDeg: Float32Array; // 2 × rows.length, apparent
  readonly bodies: Float64Array; // BODY_IDS.length × BODY_STRIDE; NaN until the first pass
  lastSkyMs: number | null;
  site: ObserverSite | null;
  observer: Observer | null;
}

/** No rows; bodies NaN ("not computed yet": zeros would read as eight bodies on the horizon at az 0). */
export function createSkyCache(): SkyCache {
  return {
    rows: [],
    unitJ2000: new Float64Array(0),
    starCount: 0,
    starAzAltDeg: new Float32Array(0),
    bodies: new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN),
    lastSkyMs: null,
    site: null,
    observer: null,
  };
}

/** The app's one cache. It outlives any one sky map (StrictMode mounts twice in development). */
export const skyCache: SkyCache = createSkyCache();

/** The number of leading rows with vmag ≤ the limit. Binary search: the rows are sorted by vmag. */
export function starCountForLimit(rows: readonly StarRow[], vmag: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((rows[mid]?.[2] ?? Number.POSITIVE_INFINITY) <= vmag) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A new catalogue: unit vectors and an az/alt array for every row, the prefix count, and a pass due. */
export function setStars(cache: SkyCache, rows: readonly StarRow[], vmagLimit: number): void {
  cache.rows = rows;
  cache.unitJ2000 = starUnitVectors(rows);
  cache.starAzAltDeg = new Float32Array(2 * rows.length);
  cache.starCount = starCountForLimit(rows, vmagLimit);
  cache.lastSkyMs = null;
}

/** true if starCount changed (then lastSkyMs is cleared). */
export function setStarLimit(cache: SkyCache, vmagLimit: number): boolean {
  const count = starCountForLimit(cache.rows, vmagLimit);
  if (count === cache.starCount) return false;
  cache.starCount = count;
  cache.lastSkyMs = null;
  return true;
}

export function invalidateSky(cache: SkyCache): void {
  cache.lastSkyMs = null;
}

/**
 * true if it recomputed: a new site object, or needsSkyRecompute. The registry hands out stable site objects, so
 * a camera switch changes the reference. One AstroTime per pass; the star loop allocates nothing per star.
 */
export function updateSky(cache: SkyCache, simTimeMs: number, site: ObserverSite): boolean {
  let observer = cache.observer;
  if (site !== cache.site || observer === null) {
    observer = makeObserver(site);
    cache.site = site;
    cache.observer = observer;
    cache.lastSkyMs = null;
  }
  if (!needsSkyRecompute(simTimeMs, cache.lastSkyMs)) return false;
  const time = astroTimeAt(simTimeMs);
  rotateStarsAzAltDeg(time, observer, cache.unitJ2000, cache.starCount, cache.starAzAltDeg);
  computeBodies(time, observer, cache.bodies);
  cache.lastSkyMs = simTimeMs;
  return true;
}

/**
 * Throws unless json is a non-empty array of at most MAX_STAR_ROWS rows, each [ra, dec, vmag, hr, name] with four
 * finite numbers and a string, and vmag never decreases (a magnitude limit must be a prefix).
 */
function parseStarRows(json: unknown): StarRow[] {
  if (!Array.isArray(json)) throw new Error("stars.json: not an array");
  if (json.length === 0 || json.length > MAX_STAR_ROWS) {
    throw new Error(`stars.json: ${json.length} rows (expected 1 to ${MAX_STAR_ROWS})`);
  }
  const rows: unknown[] = json;
  let prevVmag = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      !Array.isArray(row) ||
      row.length !== 5 ||
      !Number.isFinite(row[0]) ||
      !Number.isFinite(row[1]) ||
      !Number.isFinite(row[2]) ||
      !Number.isFinite(row[3]) ||
      typeof row[4] !== "string"
    ) {
      throw new Error(`stars.json: row ${i} is not [ra, dec, vmag, hr, name]`);
    }
    const vmag: number = row[2];
    if (vmag < prevVmag) throw new Error(`stars.json: vmag decreases at row ${i}`);
    prevVmag = vmag;
  }
  return rows as StarRow[];
}

/**
 * Fetches stars.json into the skyCache singleton at the store's current limit, setting data.stars to loading, then
 * ready or error. No retry (README Errors). main.tsx starts it once and does not await it.
 */
export async function loadStars(store: AppStore): Promise<void> {
  const { actions } = store.getState();
  actions.setLoadStatus("stars", "loading");
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/stars.json`);
    if (!res.ok) throw new Error(`stars.json: HTTP ${res.status}`);
    const rows = parseStarRows(await res.json());
    setStars(skyCache, rows, selectStarMagLimit(store.getState()));
    actions.setLoadStatus("stars", "ready");
  } catch (error) {
    console.error("Star catalogue failed to load", error);
    actions.setLoadStatus("stars", "error");
  }
}
