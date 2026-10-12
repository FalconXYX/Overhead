// tests/unit/horizon.test.ts — M6 terrain domain: Terrarium decode, spherical destination, the apparent-angle
// formula (κ 0.13), tile plan and bilinear sampler, the horizon march, and the committed real-tile fixtures.
import { describe, expect, it } from "vitest";
import { destinationLatLonDeg, EARTH_MEAN_RADIUS_KM } from "../../src/domain/geo";
import {
  apparentElevationDeg,
  createTileSampler,
  decodeTerrariumM,
  decodeTerrariumTile,
  EARTH_RADIUS_M,
  type ElevationSampler,
  horizonAltAtAzDeg,
  horizonProfileDeg,
  lonLatToWorldPx,
  marchLimitM,
  marchRay,
  REFRACTION_KAPPA,
  TERRARIUM_MAX_ZOOM,
  TERRARIUM_URL,
  TILE_SIZE_PX,
  type TileKey,
  type TileZoom,
  texelGroundM,
  tileId,
  tilesForSite,
  zoomForDistanceM,
} from "../../src/domain/terrain";
import { fixtureSampler } from "../helpers/terrainFixtures";

const WALENSTADT = { latDeg: 47.1236, lonDeg: 9.3242 } as const;
const SUBARU = { latDeg: 19.82552, lonDeg: -155.47587 } as const;

const keyString = (k: TileKey): string => `${k.z}/${k.x}/${k.y}`;

/** Every d the march visits on one ray. */
function marchDistances(limitM: number): number[] {
  const ds: number[] = [];
  marchRay(0, 0, 0, limitM, (_la, _lo, d) => ds.push(d));
  return ds;
}

/** Profile maximum and minimum with their azimuths. */
function extremes(profile: Float32Array): {
  max: number;
  maxAz: number;
  min: number;
  minAz: number;
} {
  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  let maxAz = -1;
  let minAz = -1;
  profile.forEach((v, az) => {
    if (v > max) [max, maxAz] = [v, az];
    if (v < min) [min, minAz] = [v, az];
  });
  return { max, maxAz, min, minAz };
}

/** Circular distance between two whole-degree azimuths. */
const azGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("constants", () => {
  it("match the README section 6 declarations", () => {
    expect(TERRARIUM_URL).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    );
    expect(TERRARIUM_MAX_ZOOM).toBe(15);
    expect(TILE_SIZE_PX).toBe(256);
    expect(REFRACTION_KAPPA).toBe(0.13);
    expect(EARTH_RADIUS_M).toBe(6_371_000);
    expect(EARTH_MEAN_RADIUS_KM).toBe(6371.0088);
  });
});

describe("Terrarium decode", () => {
  it("decodeTerrariumM: (128, 0, 0) is exactly 0 m; (137, 219, 68) is 2523.2656 m", () => {
    expect(decodeTerrariumM(128, 0, 0)).toBe(0);
    expect(decodeTerrariumM(137, 219, 68)).toBeCloseTo(2523.2656, 4);
    expect(decodeTerrariumM(0, 0, 0)).toBe(-32768);
  });

  it("decodeTerrariumTile reads R, G, B per pixel, ignores alpha, row-major from the north-west corner", () => {
    const rgba = new Uint8ClampedArray(65536 * 4);
    for (let i = 0; i < 65536; i++) {
      rgba[i * 4] = 128; // 0 m everywhere, alpha left at 0
    }
    const set = (row: number, col: number, r: number, g: number, b: number, a: number): void => {
      const o = (row * 256 + col) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    };
    set(0, 0, 137, 219, 68, 255);
    set(1, 2, 129, 0, 128, 0);
    set(255, 255, 127, 255, 0, 17);
    const out = new Float32Array(65536).fill(Number.NaN);
    decodeTerrariumTile(rgba, out);
    expect(out[0]).toBeCloseTo(2523.2656, 3);
    expect(out[1 * 256 + 2]).toBe(256.5);
    expect(out[65535]).toBe(-1);
    expect(out[5]).toBe(0);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("apparentElevationDeg", () => {
  it("wall formula: 1,000 m at 10 km from sea level is 5.672°, not the no-curvature 5.7106°", () => {
    const deg = apparentElevationDeg(1000, 0, 10_000);
    expect(Math.abs(deg - 5.672)).toBeLessThanOrEqual(0.001);
    expect(deg).toBeCloseTo(5.67186, 4);
    expect(Math.abs(deg - 5.7106)).toBeGreaterThan(0.001); // a formula without curvature fails
  });

  it("sea from 4,204 m at the tangent distance is −1.9407°, without clamping", () => {
    expect(apparentElevationDeg(0, 4204, 248_136)).toBeCloseTo(-1.9407, 3);
    expect(apparentElevationDeg(-4000, 4204, 248_136)).toBeLessThan(-2.8); // no clamp here
  });
});

describe("zoomForDistanceM, marchLimitM, texelGroundM", () => {
  it("zoomForDistanceM puts each boundary in the coarser zoom", () => {
    const ds = [0, 20, 1499, 1500, 7999, 8000, 29_999, 30_000, 59_999, 60_000, 300_000];
    expect(ds.map(zoomForDistanceM)).toEqual([14, 14, 14, 12, 12, 10, 10, 9, 9, 8, 8]);
  });

  it("marchLimitM is at least 100 km, clamps z0 at 0, and is 260,543 m from 4,204 m", () => {
    expect(marchLimitM(467.6)).toBe(100_000);
    expect(marchLimitM(-30)).toBe(100_000);
    expect(marchLimitM(0)).toBe(100_000);
    expect(Math.abs(marchLimitM(4204) - 260_543)).toBeLessThanOrEqual(1);
    expect(Math.abs(marchLimitM(4147.6) - 258_789.7)).toBeLessThanOrEqual(1);
  });

  it("texelGroundM is 26.0 m at z12 at Walenstadt", () => {
    expect(Math.abs(texelGroundM(12, 47.1236) - 26.0)).toBeLessThanOrEqual(0.05);
    expect(texelGroundM(0, 0)).toBeCloseTo(40_075_016.686 / 256, 6);
  });
});

describe("lonLatToWorldPx and destinationLatLonDeg", () => {
  it("lonLatToWorldPx(0, 0, 0) is [127.5, 127.5]: pixel centres on integers", () => {
    const out = new Float64Array(4);
    lonLatToWorldPx(0, 0, 0, out, 2);
    expect(out[2]).toBeCloseTo(127.5, 9);
    expect(out[3]).toBeCloseTo(127.5, 9);
    expect(out[0]).toBe(0);
    lonLatToWorldPx(-180, 0, 1, out, 0);
    expect(out[0]).toBeCloseTo(-0.5, 9);
    expect(out[1]).toBeCloseTo(255.5, 9);
  });

  it("111,195.08 m north of 47.1236° is 48.1236° at the same longitude", () => {
    const out = new Float64Array(3);
    destinationLatLonDeg(47.1236, 9.3242, 0, 111_195.08, out, 1);
    expect(out[1]).toBeCloseTo(48.1236, 6);
    expect(out[2]).toBeCloseTo(9.3242, 6);
    expect(out[0]).toBe(0);
  });

  it("1° east of 179.9° on the equator is −179.1° (wrapped into [−180, 180))", () => {
    const out = new Float64Array(2);
    destinationLatLonDeg(0, 179.9, 90, 111_195.08, out, 0);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(-179.1, 6);
    destinationLatLonDeg(10, 20, 33, 0, out, 0);
    expect(out[0]).toBeCloseTo(10, 12);
    expect(out[1]).toBeCloseTo(20, 12);
  });
});

describe("horizonAltAtAzDeg", () => {
  const profile = Float32Array.from({ length: 360 }, (_, i) => i / 10);

  it("is 0 (the geometric horizon) for a null profile", () => {
    expect(horizonAltAtAzDeg(null, 123.4)).toBe(0);
  });

  it("interpolates linearly between whole degrees and wraps 359 → 0", () => {
    expect(horizonAltAtAzDeg(profile, 12.5)).toBeCloseTo(1.25, 5);
    expect(horizonAltAtAzDeg(profile, 359.5)).toBeCloseTo(17.95, 5);
    expect(horizonAltAtAzDeg(profile, -0.5)).toBeCloseTo(17.95, 5);
    expect(horizonAltAtAzDeg(profile, 0)).toBeCloseTo(0, 5);
    expect(horizonAltAtAzDeg(profile, 359)).toBeCloseTo(35.9, 5);
    expect(horizonAltAtAzDeg(profile, 360)).toBeCloseTo(0, 5);
    expect(horizonAltAtAzDeg(profile, 720.25)).toBeCloseTo(0.025, 5);
  });
});

describe("marchRay", () => {
  it("starts at 20 m, steps max(10 m, 1 %) and stops at the limit", () => {
    const ds = marchDistances(100_000);
    expect(ds.slice(0, 3)).toEqual([20, 30, 40]);
    expect(ds).toHaveLength(561);
    expect(ds.at(-1)).toBeLessThanOrEqual(100_000);
    expect(marchDistances(marchLimitM(4147.6))).toHaveLength(657);
    const firstPast = ds.findIndex((d) => d > 10_000);
    expect(ds[firstPast]).toBeCloseTo(10_059.09, 2);
    expect(ds[firstPast - 1]).toBeCloseTo(9959.5, 2);
  });

  it("passes zoomForDistanceM(d) and the spherical destination point", () => {
    const seen: { la: number; lo: number; d: number; zoom: TileZoom }[] = [];
    marchRay(WALENSTADT.latDeg, WALENSTADT.lonDeg, 90, 2000, (la, lo, d, zoom) =>
      seen.push({ la, lo, d, zoom }),
    );
    const expected = new Float64Array(2);
    for (const s of seen) {
      expect(s.zoom).toBe(zoomForDistanceM(s.d));
      destinationLatLonDeg(WALENSTADT.latDeg, WALENSTADT.lonDeg, 90, s.d, expected, 0);
      expect(s.la).toBe(expected[0]);
      expect(s.lo).toBe(expected[1]);
    }
    expect(seen.some((s) => s.zoom === 12)).toBe(true);
  });

  it("visits nothing when the limit is below the first step", () => {
    expect(marchDistances(0)).toEqual([]);
    expect(marchDistances(19.9)).toEqual([]);
  });
});

describe("tileId and createTileSampler", () => {
  it("tileId is the numeric key (z·2^15 + x)·2^15 + y", () => {
    expect(tileId(14, 1116, 7271)).toBe((14 * 32_768 + 1116) * 32_768 + 7271);
    expect(tileId(8, 0, 1)).not.toBe(tileId(8, 1, 0));
    expect(tileId(9, 0, 0)).not.toBe(tileId(8, 0, 0));
  });

  /** z8 tiles whose value is the global pixel column (or row) of each texel. */
  function rampTiles(z: TileZoom, along: "x" | "y", xs: number[], ys: number[]) {
    const tiles = new Map<number, Float32Array>();
    for (const tx of xs) {
      for (const ty of ys) {
        const t = new Float32Array(65536);
        for (let row = 0; row < 256; row++) {
          for (let col = 0; col < 256; col++) {
            t[row * 256 + col] = along === "x" ? tx * 256 + col : ty * 256 + row;
          }
        }
        tiles.set(tileId(z, tx, ty), t);
      }
    }
    return tiles;
  }

  /** Inverse of lonLatToWorldPx for a global pixel at zoom z. */
  const lonAt = (X: number, z: number): number => ((X + 0.5) / (256 * 2 ** z)) * 360 - 180;
  const latAt = (Y: number, z: number): number =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (Y + 0.5)) / (256 * 2 ** z)))) * 180) / Math.PI;

  it("is bilinear across tile edges in x and in y", () => {
    const sx = createTileSampler(rampTiles(8, "x", [133, 134], [90]));
    for (const X of [133 * 256 + 10.25, 133 * 256 + 255.5, 133 * 256 + 255.9]) {
      expect(sx(latAt(90 * 256 + 100, 8), lonAt(X, 8), 0, 8)).toBeCloseTo(X, 4);
    }
    const sy = createTileSampler(rampTiles(8, "y", [133], [90, 91]));
    for (const Y of [90 * 256 + 3.75, 90 * 256 + 255.25]) {
      expect(sy(latAt(Y, 8), lonAt(133 * 256 + 100, 8), 0, 8)).toBeCloseTo(Y, 3);
    }
  });

  it("returns NaN when one of the four texel tiles is missing", () => {
    const s = createTileSampler(rampTiles(8, "x", [133], [90]));
    expect(s(latAt(90 * 256 + 100, 8), lonAt(133 * 256 + 100.5, 8), 0, 8)).toBeCloseTo(34148.5, 4);
    expect(Number.isNaN(s(latAt(90 * 256 + 100, 8), lonAt(133 * 256 + 255.5, 8), 0, 8))).toBe(true);
    expect(Number.isNaN(s(latAt(90 * 256 + 100, 8), lonAt(133 * 256 + 100, 8), 0, 9))).toBe(true);
  });

  it("wraps x at the antimeridian and clamps y at the poles", () => {
    const tiles = new Map<number, Float32Array>([
      [tileId(8, 255, 100), new Float32Array(65536).fill(100)],
      [tileId(8, 0, 100), new Float32Array(65536).fill(200)],
    ]);
    const s = createTileSampler(tiles);
    // X = 65535.25 (lon 179.9986°): a quarter of the way from the last column of tile 255 to column 0
    // of tile 0. X = −0.25 (lon −179.9986°): x0 = −1 wraps to the last column of tile 255.
    expect(s(latAt(100 * 256 + 50, 8), lonAt(65_535.25, 8), 0, 8)).toBeCloseTo(125, 3);
    expect(s(latAt(100 * 256 + 50, 8), lonAt(-0.25, 8), 0, 8)).toBeCloseTo(175, 3);
    const polar = new Map<number, Float32Array>([
      [tileId(8, 10, 0), new Float32Array(65536).fill(7)],
    ]);
    expect(createTileSampler(polar)(89.9, lonAt(10 * 256 + 20, 8), 0, 8)).toBeCloseTo(7, 6);
  });
});

describe("tilesForSite", () => {
  it("with limit 0 returns only the site's z14 tiles", () => {
    const keys = tilesForSite(WALENSTADT.latDeg, WALENSTADT.lonDeg, 0);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.length).toBeLessThanOrEqual(4);
    expect(keys.every((k) => k.z === 14)).toBe(true);
    const px = new Float64Array(2);
    lonLatToWorldPx(WALENSTADT.lonDeg, WALENSTADT.latDeg, 14, px, 0);
    const own = `14/${Math.floor((px[0] ?? 0) / 256)}/${Math.floor((px[1] ?? 0) / 256)}`;
    expect(keys.map(keyString)).toContain(own);
  });

  it("Walenstadt to 100 km: 45 unique tiles, 7/9/9/11/9 at z8/z9/z10/z12/z14", () => {
    const keys = tilesForSite(WALENSTADT.latDeg, WALENSTADT.lonDeg, 100_000);
    expect(keys).toHaveLength(45);
    expect(new Set(keys.map(keyString)).size).toBe(45);
    const byZoom = [8, 9, 10, 12, 14].map((z) => keys.filter((k) => k.z === z).length);
    expect(byZoom).toEqual([7, 9, 9, 11, 9]);
    expect(
      tilesForSite(
        WALENSTADT.latDeg,
        WALENSTADT.lonDeg,
        100_000,
        Array.from({ length: 360 }, (_, i) => i),
      ).map(keyString),
    ).toEqual(keys.map(keyString));
  });

  it("Subaru StarCam azimuth 0 needs the 10 tiles of the maunakea fixture", () => {
    const expected = [
      "14/1116/7270",
      "14/1116/7271",
      "12/279/1816",
      "12/279/1817",
      "10/69/453",
      "10/69/454",
      "9/34/226",
      "8/17/111",
      "8/17/112",
      "8/17/113",
    ].sort();
    for (const z0 of [4148, 4147.6]) {
      const keys = tilesForSite(SUBARU.latDeg, SUBARU.lonDeg, marchLimitM(z0), [0]);
      expect(keys.map(keyString).sort()).toEqual(expected);
    }
  });
});

describe("horizonProfileDeg (analytic samplers)", () => {
  it("plateau: 1,000 m from 10 km on, seen from sea level, is 5.67 ± 0.05° at every azimuth", () => {
    const plateau: ElevationSampler = (_la, _lo, d) => (d >= 10_000 ? 1000 : 0);
    const out = new Float32Array(360);
    horizonProfileDeg(plateau, WALENSTADT.latDeg, WALENSTADT.lonDeg, 0, 100_000, out);
    for (const v of out) {
      expect(Math.abs(v - 5.67)).toBeLessThanOrEqual(0.05);
      expect(v).toBeCloseTo(5.6383, 3);
    }
  });

  it("flat sea (seabed −4,000 m, clamped to 0) from 4,204 m is −1.9407° with the tangent at 248 km", () => {
    const azZeroD: number[] = [];
    let rayDone = false;
    const seabed: ElevationSampler = (_la, _lo, d) => {
      if (!rayDone) {
        if (azZeroD.length > 0 && d < (azZeroD.at(-1) ?? 0)) rayDone = true;
        else azZeroD.push(d);
      }
      return -4000;
    };
    const limit = marchLimitM(4204);
    const out = new Float32Array(360);
    horizonProfileDeg(seabed, 19.8253, -155.4689, 4204, limit, out);
    for (const v of out) expect(Math.abs(v - -1.9407)).toBeLessThanOrEqual(0.01);
    let bestD = 0;
    let best = Number.NEGATIVE_INFINITY;
    for (const d of azZeroD) {
      const a = apparentElevationDeg(0, 4204, d);
      if (a > best) [best, bestD] = [a, d];
    }
    expect(bestD).toBeCloseTo(247_770, -1);
    expect(Math.abs(bestD - 248_100)).toBeLessThanOrEqual(2000);
    expect(azZeroD.at(-1)).toBeLessThanOrEqual(limit);
  });

  it("skips NaN samples and gives NaN for a ray with no valid sample", () => {
    const out = new Float32Array(360);
    horizonProfileDeg(() => Number.NaN, 0, 0, 0, 100_000, out);
    expect(out.every((v) => Number.isNaN(v))).toBe(true);
    // Valid to 50 km, missing beyond: the result is the best of the valid samples only.
    const nearOnly: ElevationSampler = (_la, _lo, d) => (d <= 50_000 ? 0 : Number.NaN);
    horizonProfileDeg(nearOnly, 0, 0, 100, 100_000, out);
    const expected = Math.max(
      ...marchDistances(100_000)
        .filter((d) => d <= 50_000)
        .map((d) => apparentElevationDeg(0, 100, d)),
    );
    for (const v of out) expect(v).toBeCloseTo(expected, 5);
  });
});

describe("real tiles (committed fixtures)", () => {
  it("Walenstadt: ground 467.6 m; az 0° 32.7°, az 270° 2.0°; max at az 2°, min at az 276°", () => {
    const keys = tilesForSite(WALENSTADT.latDeg, WALENSTADT.lonDeg, 100_000);
    const sample = fixtureSampler("walenstadt", keys);
    const ground = sample(WALENSTADT.latDeg, WALENSTADT.lonDeg, 0, 14);
    expect(Math.abs(ground - 467.6)).toBeLessThanOrEqual(3);
    let nanSamples = 0;
    const counting: ElevationSampler = (la, lo, d, zoom) => {
      const z = sample(la, lo, d, zoom);
      if (Number.isNaN(z)) nanSamples += 1;
      return z;
    };
    const profile = new Float32Array(360);
    horizonProfileDeg(counting, WALENSTADT.latDeg, WALENSTADT.lonDeg, ground, 100_000, profile);
    expect(nanSamples).toBe(0); // the plan covers every texel the march reads
    expect(Math.abs((profile[0] ?? 0) - 32.7)).toBeLessThanOrEqual(0.3);
    expect(Math.abs((profile[270] ?? 0) - 2.0)).toBeLessThanOrEqual(0.3);
    const { max, maxAz, min, minAz } = extremes(profile);
    expect(Math.abs(max - 32.93)).toBeLessThanOrEqual(0.3);
    expect(azGap(maxAz, 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(min - 1.76)).toBeLessThanOrEqual(0.3);
    expect(azGap(minAz, 276)).toBeLessThanOrEqual(2);
    expect(horizonAltAtAzDeg(profile, 0)).toBe(profile[0]);
  });

  it("Maunakea open ocean from the Subaru StarCam (z0 4,147.6 m): az 0° is −1.93°, sea tangent near 245 km", () => {
    const limit = marchLimitM(4147.6);
    const keys = tilesForSite(SUBARU.latDeg, SUBARU.lonDeg, limit, [0]);
    const sample = fixtureSampler("maunakea", keys);
    const ground = sample(SUBARU.latDeg, SUBARU.lonDeg, 0, 14);
    const z0 = ground + 13;
    expect(Math.abs(z0 - 4147.6)).toBeLessThanOrEqual(3);
    const profile = new Float32Array(360);
    horizonProfileDeg(sample, SUBARU.latDeg, SUBARU.lonDeg, z0, limit, profile);
    expect(Math.abs((profile[0] ?? 0) - -1.93)).toBeLessThanOrEqual(0.02);
    let bestD = 0;
    let best = Number.NEGATIVE_INFINITY;
    marchRay(SUBARU.latDeg, SUBARU.lonDeg, 0, limit, (la, lo, d, zoom) => {
      const a = apparentElevationDeg(Math.max(sample(la, lo, d, zoom), 0), z0, d);
      if (a > best) [best, bestD] = [a, d];
    });
    expect(best).toBeCloseTo(profile[0] ?? 0, 4);
    expect(Math.abs(bestD - 245_300)).toBeLessThanOrEqual(2000);
  });
});
