// scripts/fetch-terrain-fixture.ts — the committed Terrarium tiles for the M6 unit and e2e tests (M6 step 5).
// Run by hand, once: npx tsx scripts/fetch-terrain-fixture.ts [outDir]   (default tests/fixtures/terrain)
// CI never runs it. Writes:
//   walenstadt/<z>/<x>/<y>.png  every tile of tilesForSite(47.1236, 9.3242, 100_000)          45 tiles, 5.58 MB
//   maunakea/<z>/<x>/<y>.png    [Redesign] every tile of the Subaru StarCam's horizon (all azimuths,
//                               marchLimitM(4148)), then the CFHT StarCam's two others                46 tiles, 5.5 MB
//                               (M6 fetched only the open-ocean azimuth 0°: 10 tiles, all kept unchanged)
//   <site>/sources.json         "z/x/y" → the tile's x-amz-meta-x-imagery-sources header
//   flat.png                    256 × 256 RGB (128, 0, 0): 0 m everywhere, 564 bytes
// Plain GET per tile (no custom headers: S3's CORS rules), stopping at the first non-200.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { marchLimitM, type TileKey, tilesForSite } from "../src/domain/terrain";
import { IMAGERY_SOURCES_HEADER, terrariumTileUrl } from "../src/workers/horizonCompute";

const DEFAULT_OUT_DIR = "tests/fixtures/terrain";

export interface TerrainFixturePlan {
  readonly site: "walenstadt" | "maunakea";
  readonly keys: readonly TileKey[];
}

/**
 * [Redesign] The e2e cameras are the Subaru and CFHT StarCams: their whole horizons, so the terrain route serves real
 * Maunakea relief (the summit cones at az 75–145° from Subaru) instead of flat.png. Subaru's tiles first, then CFHT's
 * others, each in tilesForSite order.
 */
function maunakeaTiles(): TileKey[] {
  const keys = tilesForSite(19.82552, -155.47587, marchLimitM(4148));
  const seen = new Set(keys.map((k) => `${k.z}/${k.x}/${k.y}`));
  for (const k of tilesForSite(19.8253, -155.4689, marchLimitM(4204))) {
    if (!seen.has(`${k.z}/${k.x}/${k.y}`)) keys.push(k);
  }
  return keys;
}

/** The two fixture plans of M6 step 5 ([Redesign] Maunakea's widened to the two StarCams' horizons). */
export function terrainFixturePlans(): TerrainFixturePlan[] {
  return [
    { site: "walenstadt", keys: tilesForSite(47.1236, 9.3242, 100_000) },
    { site: "maunakea", keys: maunakeaTiles() },
  ];
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return out;
}

/** 256 × 256 8-bit RGB PNG of (128, 0, 0): filter byte 0 on every row, deflate level 9, zlib.crc32 CRCs. */
export function flatTerrariumPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  // compression 0, filter 0, interlace 0
  const raw = Buffer.alloc(256 * (1 + 256 * 3));
  for (let row = 0; row < 256; row++) {
    const start = row * (1 + 256 * 3);
    raw[start] = 0; // filter: None
    for (let px = 0; px < 256; px++) raw[start + 1 + px * 3] = 128;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

export type FetchLike = (url: string) => Promise<Response>;

/** Downloads every planned tile and writes the fixture tree. Returns one summary line per site. */
export async function fetchTerrainFixture(
  outDir: string,
  plans: readonly TerrainFixturePlan[],
  fetchImpl: FetchLike = (url) => fetch(url),
): Promise<string[]> {
  const lines: string[] = [];
  for (const { site, keys } of plans) {
    const sources: Record<string, string> = {};
    let bytes = 0;
    for (const k of keys) {
      const url = terrariumTileUrl(k);
      const res = await fetchImpl(url);
      if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      const dir = join(outDir, site, String(k.z), String(k.x));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${k.y}.png`), body);
      sources[`${k.z}/${k.x}/${k.y}`] = res.headers.get(IMAGERY_SOURCES_HEADER) ?? "";
      bytes += body.length;
    }
    await writeFile(join(outDir, site, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
    lines.push(`${site}: ${keys.length} tiles, ${(bytes / 1e6).toFixed(2)} MB`);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "flat.png"), flatTerrariumPng());
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const lines = await fetchTerrainFixture(
    process.argv[2] ?? DEFAULT_OUT_DIR,
    terrainFixturePlans(),
  );
  for (const line of lines) console.log(line);
}
