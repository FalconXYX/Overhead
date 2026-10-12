// src/workers/horizonCompute.ts — the browser-free core of horizon.worker.ts (M6 step 6): tile URL, imagery
// dataset prefixes, the plain-GET tile loader, the 6-lane tile queue and the compute itself. No worker globals,
// so it runs in Vitest on the committed fixtures. The worker adds only the createImageBitmap + OffscreenCanvas
// decode, postMessage and the one-at-a-time queue.
import {
  createTileSampler,
  decodeTerrariumTile,
  horizonProfileDeg,
  marchLimitM,
  TERRARIUM_URL,
  type TileKey,
  tileId,
  tilesForSite,
} from "../domain/terrain";

/** Tiles fetched at once. */
export const TILE_FETCH_LANES = 6;
/** S3 metadata header naming the source rasters of a tile: "srtm/N19W156.tif, gmted/…, etopo1/…". */
export const IMAGERY_SOURCES_HEADER = "x-amz-meta-x-imagery-sources";

/** What the compute needs from HorizonIn. */
export interface HorizonSite {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly mastM: number; // z0 = DEM ground at the site (z14) + mastM
}

/** The payload of HorizonOut "done", without the message fields. */
export interface HorizonResult {
  profileDeg: Float32Array; // 360 values
  groundM: number;
  z0M: number;
  limitM: number;
  imagerySources: string[]; // dataset prefixes, sorted
}

/** One decoded tile and its imagery-sources header (null when absent). */
export interface LoadedTerrainTile {
  elevationM: Float32Array;
  imagerySources: string | null;
}
export type TerrainTileLoader = (key: TileKey) => Promise<LoadedTerrainTile>;
/** Plain GET: called with the URL only. */
export type TerrainFetch = (url: string) => Promise<Response>;
/** PNG body → 256×256 RGBA bytes. The worker uses createImageBitmap and an OffscreenCanvas 2D context. */
export type RgbaDecoder = (blob: Blob) => Promise<Uint8ClampedArray>;

export function terrariumTileUrl(k: TileKey): string {
  return TERRARIUM_URL.replace("{z}", String(k.z))
    .replace("{x}", String(k.x))
    .replace("{y}", String(k.y));
}

/** "srtm/N19W156.tif, gmted/…, etopo1/ETOPO1_Bed_g.tif" → adds "srtm", "gmted", "etopo1". */
export function addImageryDatasets(header: string | null, datasets: Set<string>): void {
  for (const file of (header ?? "").split(",")) {
    const dataset = file.trim().split("/")[0];
    if (dataset) datasets.add(dataset);
  }
}

/**
 * Loader for live Terrarium tiles. fetchImpl gets the URL only: no custom headers and never HEAD, which S3's
 * CORS rejects (M6 gotcha 2). A non-2xx answer rejects with the tile and the status.
 */
export function createTerrariumTileLoader(
  fetchImpl: TerrainFetch,
  decodeRgba: RgbaDecoder,
): TerrainTileLoader {
  return async (k) => {
    const res = await fetchImpl(terrariumTileUrl(k));
    if (!res.ok) throw new Error(`terrain tile ${k.z}/${k.x}/${k.y}: HTTP ${res.status}`);
    const imagerySources = res.headers.get(IMAGERY_SOURCES_HEADER);
    const rgba = await decodeRgba(await res.blob());
    const elevationM = new Float32Array(65536);
    decodeTerrariumTile(rgba, elevationM);
    return { elevationM, imagerySources };
  };
}

/**
 * Loads the keys missing from tiles, TILE_FETCH_LANES at a time, adding each tile's dataset prefixes.
 * Rejects on the first failure; after it no lane starts another load.
 */
export async function loadTiles(
  keys: readonly TileKey[],
  tiles: Map<number, Float32Array>,
  datasets: Set<string>,
  load: TerrainTileLoader,
  onTile: () => void,
): Promise<void> {
  const queue = keys.filter((k) => !tiles.has(tileId(k.z, k.x, k.y)));
  let failed = false;
  const lane = async (): Promise<void> => {
    for (let k = queue.shift(); k !== undefined && !failed; k = queue.shift()) {
      try {
        const tile = await load(k);
        if (failed) return;
        addImageryDatasets(tile.imagerySources, datasets);
        tiles.set(tileId(k.z, k.x, k.y), tile.elevationM);
        onTile();
      } catch (err) {
        failed = true;
        queue.length = 0;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: TILE_FETCH_LANES }, lane));
}

/**
 * The whole compute: the site's z14 tiles first (the limit depends on z0), then the plan, then the march.
 * z0 = max(ground, 0) + mastM. Any failed tile rejects: there is no partial profile. Decoded tiles are dropped
 * when it returns. onProgress(tilesDone, tilesTotal) fires once per plan tile loaded.
 */
export async function computeHorizon(
  site: HorizonSite,
  load: TerrainTileLoader,
  onProgress: (tilesDone: number, tilesTotal: number) => void = () => {},
): Promise<HorizonResult> {
  const { latDeg, lonDeg, mastM } = site;
  const tiles = new Map<number, Float32Array>();
  const datasets = new Set<string>();
  await loadTiles(tilesForSite(latDeg, lonDeg, 0), tiles, datasets, load, () => {});
  const groundM = createTileSampler(tiles)(latDeg, lonDeg, 0, 14);
  if (!Number.isFinite(groundM)) throw new Error("no DEM value at the site");
  const z0M = Math.max(groundM, 0) + mastM;
  const limitM = marchLimitM(z0M);
  const plan = tilesForSite(latDeg, lonDeg, limitM);
  let tilesDone = plan.filter((k) => tiles.has(tileId(k.z, k.x, k.y))).length;
  await loadTiles(plan, tiles, datasets, load, () => {
    tilesDone += 1;
    onProgress(tilesDone, plan.length);
  });
  const profileDeg = new Float32Array(360);
  horizonProfileDeg(createTileSampler(tiles), latDeg, lonDeg, z0M, limitM, profileDeg);
  return { profileDeg, groundM, z0M, limitM, imagerySources: [...datasets].sort() };
}
