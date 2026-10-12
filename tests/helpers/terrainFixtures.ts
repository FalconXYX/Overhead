// tests/helpers/terrainFixtures.ts — the committed Terrarium tiles (M6 step 5) as an ElevationSampler.
// Every read goes through node:fs; a missing file throws, so a fixture test never passes on NaN-skipped samples.
import { readFileSync } from "node:fs";
import {
  createTileSampler,
  decodeTerrariumTile,
  type ElevationSampler,
  type TileKey,
  tileId,
} from "../../src/domain/terrain";
import { decodePng } from "./decodePng";

export type TerrainFixtureSite = "walenstadt" | "maunakea";

const FIXTURE_DIR = new URL("../fixtures/terrain/", import.meta.url);

/** File URL of one committed tile: tests/fixtures/terrain/<site>/<z>/<x>/<y>.png. */
export function fixtureTileUrl(site: TerrainFixtureSite, k: TileKey): URL {
  return new URL(`${site}/${k.z}/${k.x}/${k.y}.png`, FIXTURE_DIR);
}

/** The committed PNG bytes of one tile; throws when the fixture does not hold it. */
export function readFixtureTileBytes(site: TerrainFixtureSite, k: TileKey): Uint8Array {
  try {
    return new Uint8Array(readFileSync(fixtureTileUrl(site, k)));
  } catch (err) {
    throw new Error(`terrain fixture ${site} has no tile ${k.z}/${k.x}/${k.y}`, { cause: err });
  }
}

/** One committed tile decoded to Float32Array(65536) of metres. */
export function readFixtureTile(site: TerrainFixtureSite, k: TileKey): Float32Array {
  const { width, height, rgba } = decodePng(readFixtureTileBytes(site, k));
  if (width !== 256 || height !== 256) {
    throw new Error(
      `terrain fixture ${site} ${k.z}/${k.x}/${k.y}: ${width}×${height}, need 256×256`,
    );
  }
  const elevationM = new Float32Array(65536);
  decodeTerrariumTile(rgba, elevationM);
  return elevationM;
}

/** The site's sources.json: "z/x/y" → that tile's x-amz-meta-x-imagery-sources header. */
export function fixtureSources(site: TerrainFixtureSite): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`${site}/sources.json`, FIXTURE_DIR), "utf8")) as Record<
    string,
    string
  >;
}

/** The bytes of flat.png: a 256 × 256 RGB tile of (128, 0, 0), 0 m everywhere. */
export function flatPngBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL("flat.png", FIXTURE_DIR)));
}

/** Bilinear sampler over the given committed tiles. Throws on the first missing file. */
export function fixtureSampler(
  site: TerrainFixtureSite,
  keys: readonly TileKey[],
): ElevationSampler {
  const tiles = new Map<number, Float32Array>();
  for (const k of keys) tiles.set(tileId(k.z, k.x, k.y), readFixtureTile(site, k));
  return createTileSampler(tiles);
}
