// tests/unit/fetchTerrainFixture.test.ts — scripts/fetch-terrain-fixture.ts (M6 step 5) against a fake fetch and a
// temp directory, and the committed tests/fixtures/terrain tree against the script's plans. No network.
import { readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FetchLike,
  fetchTerrainFixture,
  flatTerrariumPng,
  terrainFixturePlans,
} from "../../scripts/fetch-terrain-fixture";
import { decodeTerrariumM, type TileKey } from "../../src/domain/terrain";
import { decodePng } from "../helpers/decodePng";
import { fixtureSources, flatPngBytes } from "../helpers/terrainFixtures";

const FIXTURE_DIR = new URL("../fixtures/terrain/", import.meta.url);
const keyString = (k: TileKey): string => `${k.z}/${k.x}/${k.y}`;

/** Every z/x/y.png under one site directory. */
function committedTiles(site: string): string[] {
  const root = new URL(`${site}/`, FIXTURE_DIR);
  const out: string[] = [];
  for (const z of readdirSync(root)) {
    if (!statSync(new URL(z, root)).isDirectory()) continue;
    for (const x of readdirSync(new URL(`${z}/`, root))) {
      for (const file of readdirSync(new URL(`${z}/${x}/`, root))) {
        out.push(`${z}/${x}/${file.replace(/\.png$/, "")}`);
      }
    }
  }
  return out.sort();
}

describe("flat.png", () => {
  it("is 564 bytes of 256 × 256 (128, 0, 0) with valid chunk CRCs, identical to the committed file", () => {
    const png = flatTerrariumPng();
    expect(png.length).toBe(564);
    expect(new Uint8Array(png)).toEqual(flatPngBytes());
    for (let pos = 8; pos < png.length; ) {
      const length = png.readUInt32BE(pos);
      const typeAndData = png.subarray(pos + 4, pos + 8 + length);
      expect(png.readUInt32BE(pos + 8 + length)).toBe(crc32(typeAndData));
      pos += 12 + length;
    }
    const { width, height, rgba } = decodePng(new Uint8Array(png));
    expect([width, height]).toEqual([256, 256]);
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] !== 128 || rgba[i + 1] !== 0 || rgba[i + 2] !== 0 || rgba[i + 3] !== 255) {
        throw new Error(`pixel ${i / 4} is not (128, 0, 0, 255)`);
      }
    }
    expect(decodeTerrariumM(128, 0, 0)).toBe(0);
  });
});

describe("committed fixture tree", () => {
  it("holds exactly the planned tiles of each site, each with a sources.json entry", () => {
    const plans = terrainFixturePlans();
    expect(plans.map((p) => [p.site, p.keys.length])).toEqual([
      ["walenstadt", 45],
      ["maunakea", 10],
    ]);
    for (const { site, keys } of plans) {
      const planned = keys.map(keyString).sort();
      expect(committedTiles(site)).toEqual(planned);
      expect(Object.keys(fixtureSources(site)).sort()).toEqual(planned);
    }
  });
});

describe("fetchTerrainFixture", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "terrain-fixture-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const plans = [
    {
      site: "walenstadt" as const,
      keys: [
        { z: 14, x: 8616, y: 5754 },
        { z: 8, x: 134, y: 89 },
      ],
    },
    { site: "maunakea" as const, keys: [{ z: 14, x: 1116, y: 7271 }] },
  ];

  it("writes each tile byte for byte, sources.json and flat.png, with one summary line per site", async () => {
    const urls: string[] = [];
    const fake: FetchLike = async (url) => {
      urls.push(url);
      return new Response(new Uint8Array([1, 2, 3, url.length % 256]), {
        status: 200,
        headers: { "x-amz-meta-x-imagery-sources": `srtm/${url.slice(-12)}` },
      });
    };
    const lines = await fetchTerrainFixture(dir, plans, fake);
    expect(urls).toEqual([
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/8616/5754.png",
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/134/89.png",
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/1116/7271.png",
    ]);
    expect(lines).toEqual(["walenstadt: 2 tiles, 0.00 MB", "maunakea: 1 tiles, 0.00 MB"]);
    const tile = await readFile(join(dir, "walenstadt", "8", "134", "89.png"));
    expect([...tile]).toEqual([1, 2, 3, (urls[1] ?? "").length % 256]);
    const sources = JSON.parse(await readFile(join(dir, "maunakea", "sources.json"), "utf8"));
    expect(sources).toEqual({ "14/1116/7271": "srtm/116/7271.png" });
    expect((await readFile(join(dir, "flat.png"))).length).toBe(564);
  });

  it("stops at the first non-200 answer", async () => {
    const urls: string[] = [];
    const fake: FetchLike = async (url) => {
      urls.push(url);
      return new Response("missing", { status: urls.length === 2 ? 404 : 200 });
    };
    await expect(fetchTerrainFixture(dir, plans, fake)).rejects.toThrow(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/134/89.png: HTTP 404",
    );
    expect(urls).toHaveLength(2);
  });
});
