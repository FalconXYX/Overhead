// tests/unit/horizonCompute.test.ts — the browser-free core of horizon.worker.ts (M6 step 6): tile URL, imagery
// dataset prefixes, the plain-GET tile loader, the 6-lane tile queue and the full compute, run on the committed
// fixtures through a fake fetch (setup.ts blocks the real one) and decodePng in place of createImageBitmap.
import { describe, expect, it, vi } from "vitest";
import { horizonAltAtAzDeg, type TileKey, tileId, tilesForSite } from "../../src/domain/terrain";
import {
  addImageryDatasets,
  computeHorizon,
  createTerrariumTileLoader,
  IMAGERY_SOURCES_HEADER,
  loadTiles,
  type RgbaDecoder,
  type TerrainFetch,
  type TerrainTileLoader,
  TILE_FETCH_LANES,
  terrariumTileUrl,
} from "../../src/workers/horizonCompute";
import { decodePng } from "../helpers/decodePng";
import {
  fixtureSources,
  fixtureTileUrl,
  flatPngBytes,
  readFixtureTile,
  readFixtureTileBytes,
  type TerrainFixtureSite,
} from "../helpers/terrainFixtures";

const URL_PREFIX = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/";
const keyString = (k: TileKey): string => `${k.z}/${k.x}/${k.y}`;

const decodeWithPng: RgbaDecoder = async (blob) =>
  decodePng(new Uint8Array(await blob.arrayBuffer())).rgba;

/** Answers like the e2e route: the site's fixture tile with its sources header, else flat.png with none. */
function fixtureFetch(site: TerrainFixtureSite, urls: string[] = []): TerrainFetch {
  const sources = fixtureSources(site);
  return async (url) => {
    urls.push(url);
    const [z, x, y] = url.slice(URL_PREFIX.length).replace(".png", "").split("/").map(Number);
    const k = { z: z ?? -1, x: x ?? -1, y: y ?? -1 };
    let bytes: Uint8Array;
    let header = "";
    try {
      bytes = readFixtureTileBytes(site, k);
      header = sources[keyString(k)] ?? "";
    } catch {
      bytes = flatPngBytes();
    }
    return new Response(new Blob([new Uint8Array(bytes)]), {
      status: 200,
      headers: { [IMAGERY_SOURCES_HEADER]: header },
    });
  };
}

/** A loader whose every tile is the same constant, with an optional failure and per-call bookkeeping. */
function constantLoader(
  valueM: number,
  opts: { failOn?: string; header?: string } = {},
): TerrainTileLoader & { calls: string[] } {
  const calls: string[] = [];
  const load = async (k: TileKey) => {
    calls.push(keyString(k));
    await Promise.resolve();
    if (keyString(k) === opts.failOn) throw new Error(`terrain tile ${keyString(k)}: HTTP 503`);
    return {
      elevationM: new Float32Array(65536).fill(valueM),
      imagerySources: opts.header ?? null,
    };
  };
  return Object.assign(load, { calls });
}

describe("tile URL and imagery datasets", () => {
  it("terrariumTileUrl fills the S3 template", () => {
    expect(terrariumTileUrl({ z: 14, x: 1116, y: 7271 })).toBe(`${URL_PREFIX}14/1116/7271.png`);
  });

  it("addImageryDatasets keeps dataset prefixes, not file names", () => {
    const set = new Set<string>();
    addImageryDatasets(
      "srtm/N19W156.tif, gmted/10N180W_20101117_gmted_mea075.tif, etopo1/ETOPO1_Bed_g.tif",
      set,
    );
    addImageryDatasets("srtm/N20W156.tif", set);
    addImageryDatasets(null, set);
    addImageryDatasets("", set);
    addImageryDatasets(" , ", set);
    expect([...set].sort()).toEqual(["etopo1", "gmted", "srtm"]);
  });
});

describe("createTerrariumTileLoader", () => {
  const k = { z: 14, x: 1116, y: 7271 };

  it("plain GET of the tile URL, decoded to metres, with the sources header", async () => {
    const fetchSpy = vi.fn(fixtureFetch("maunakea"));
    const load = createTerrariumTileLoader(fetchSpy, decodeWithPng);
    const tile = await load(k);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]).toEqual([`${URL_PREFIX}14/1116/7271.png`]); // no init: no headers, no HEAD
    expect(tile.imagerySources).toBe(fixtureSources("maunakea")["14/1116/7271"]);
    expect(tile.elevationM).toEqual(readFixtureTile("maunakea", k));
    expect(fixtureTileUrl("maunakea", k).pathname.endsWith("maunakea/14/1116/7271.png")).toBe(true);
  });

  it("rejects on a non-2xx answer with the tile and the status", async () => {
    const load = createTerrariumTileLoader(
      async () => new Response("no", { status: 404 }),
      decodeWithPng,
    );
    await expect(load(k)).rejects.toThrow("terrain tile 14/1116/7271: HTTP 404");
  });
});

describe("loadTiles", () => {
  const keys: TileKey[] = Array.from({ length: 20 }, (_, i) => ({ z: 8, x: i, y: 3 }));

  it("runs at most 6 loads at once, skips loaded tiles and calls onTile per new tile", async () => {
    expect(TILE_FETCH_LANES).toBe(6);
    let inFlight = 0;
    let maxInFlight = 0;
    const load: TerrainTileLoader = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { elevationM: new Float32Array(65536), imagerySources: "srtm/a.tif" };
    };
    const tiles = new Map<number, Float32Array>([[tileId(8, 0, 3), new Float32Array(65536)]]);
    const datasets = new Set<string>();
    let onTile = 0;
    await loadTiles(keys, tiles, datasets, load, () => {
      onTile += 1;
    });
    expect(maxInFlight).toBe(6);
    expect(onTile).toBe(19);
    expect(tiles.size).toBe(20);
    expect([...datasets]).toEqual(["srtm"]);
  });

  it("rejects on the first failure and starts no new load after it", async () => {
    const load = constantLoader(0, { failOn: "8/2/3" });
    const tiles = new Map<number, Float32Array>();
    await expect(loadTiles(keys, tiles, new Set(), load, () => {})).rejects.toThrow(
      "terrain tile 8/2/3: HTTP 503",
    );
    expect(load.calls.length).toBeLessThan(keys.length);
    expect(load.calls.length).toBeLessThanOrEqual(2 * TILE_FETCH_LANES);
  });
});

describe("computeHorizon", () => {
  it("Walenstadt end to end on the fixture: ground 467.6 m, limit 100 km, 45 tiles, az 0° 32.7°", async () => {
    const urls: string[] = [];
    const load = createTerrariumTileLoader(fixtureFetch("walenstadt", urls), decodeWithPng);
    const progress: [number, number][] = [];
    const r = await computeHorizon({ latDeg: 47.1236, lonDeg: 9.3242, mastM: 0 }, load, (d, t) =>
      progress.push([d, t]),
    );
    expect(Math.abs(r.groundM - 467.6)).toBeLessThanOrEqual(3);
    expect(r.z0M).toBe(r.groundM);
    expect(r.limitM).toBe(100_000);
    expect(r.profileDeg).toHaveLength(360);
    expect(Math.abs((r.profileDeg[0] ?? 0) - 32.7)).toBeLessThanOrEqual(0.3);
    expect(Math.abs((r.profileDeg[270] ?? 0) - 2.0)).toBeLessThanOrEqual(0.3);
    expect(r.imagerySources).toEqual(["eudem", "gmted", "srtm"]);
    // Every planned tile fetched once; the site's z14 tiles first.
    const plan = tilesForSite(47.1236, 9.3242, 100_000);
    expect(urls).toHaveLength(45);
    expect(new Set(urls).size).toBe(45);
    expect(urls.map((u) => u.slice(URL_PREFIX.length, -4)).sort()).toEqual(
      plan.map(keyString).sort(),
    );
    const siteTiles = tilesForSite(47.1236, 9.3242, 0).map(
      (k) => `${URL_PREFIX}${keyString(k)}.png`,
    );
    expect(urls.slice(0, siteTiles.length).sort()).toEqual([...siteTiles].sort());
    expect(progress.at(-1)).toEqual([45, 45]);
    expect(progress[0]).toEqual([siteTiles.length + 1, 45]);
    expect(progress).toHaveLength(45 - siteTiles.length);
  });

  it("synthetic-maunakea with mastM 33 on the e2e mix (fixture tiles, else flat): z0 4,203.9 m, 46 tiles, max −0.49°", async () => {
    const urls: string[] = [];
    const load = createTerrariumTileLoader(fixtureFetch("maunakea", urls), decodeWithPng);
    const r = await computeHorizon({ latDeg: 19.8253, lonDeg: -155.4689, mastM: 33 }, load);
    expect(Math.abs(r.groundM - 4170.9)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(r.z0M - 4203.9)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(r.limitM - 260_541)).toBeLessThanOrEqual(5);
    expect(urls).toHaveLength(46);
    expect(Math.max(...r.profileDeg)).toBeCloseTo(-0.49, 2);
    expect(r.imagerySources).toEqual(["etopo1", "gmted", "ned13", "srtm"]);
    expect(horizonAltAtAzDeg(r.profileDeg, 81.2)).toBeLessThan(0);
  });

  it("clamps a below-sea-level ground at 0 for z0 and keeps the 100 km floor", async () => {
    const r = await computeHorizon({ latDeg: 10, lonDeg: 20, mastM: 5 }, constantLoader(-20));
    expect(r.groundM).toBe(-20);
    expect(r.z0M).toBe(5);
    expect(r.limitM).toBe(100_000);
    expect(r.profileDeg.every((v) => Number.isFinite(v) && v < 0)).toBe(true);
    expect(r.imagerySources).toEqual([]);
  });

  it("fails the whole profile when any tile fails, or when the site has no DEM value", async () => {
    const plan = tilesForSite(10, 20, 100_000);
    const farTile = plan.find((k) => k.z === 8);
    expect(farTile).toBeDefined();
    const failing = constantLoader(100, { failOn: farTile ? keyString(farTile) : "" });
    await expect(computeHorizon({ latDeg: 10, lonDeg: 20, mastM: 0 }, failing)).rejects.toThrow(
      /HTTP 503/,
    );
    await expect(
      computeHorizon({ latDeg: 10, lonDeg: 20, mastM: 0 }, constantLoader(Number.NaN)),
    ).rejects.toThrow("no DEM value at the site");
  });
});
