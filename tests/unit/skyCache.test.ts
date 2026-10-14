// tests/unit/skyCache.test.ts — the star and body cache outside the store, and loading stars.json (M2 step 7).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../../src/domain/astro";
import type { ObserverSite } from "../../src/domain/geo";
import { initialState } from "../../src/state/initialState";
import {
  createSkyCache,
  invalidateSky,
  loadStars,
  MAX_STAR_ROWS,
  type SkyCache,
  setStarLimit,
  setStars,
  skyCache,
  starCountForLimit,
  updateSky,
} from "../../src/state/skyCache";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { LoadStatus } from "../../src/state/types";
import { TEST_CAMERA_ID } from "../helpers/store";

const STARS_URL = new URL("../../public/data/stars.json", import.meta.url);
const STARS_TEXT = readFileSync(STARS_URL, "utf8");
const ROWS = JSON.parse(STARS_TEXT) as StarRow[];
const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const T = Date.parse("2026-10-10T08:00:00Z");

function cacheWithStars(vmagLimit = 4.5): SkyCache {
  const cache = createSkyCache();
  setStars(cache, ROWS, vmagLimit);
  return cache;
}

const newStore = (): AppStore => createAppStore(initialState(T, TEST_CAMERA_ID));

/** Records every data.stars status the store passes through. */
function starStatuses(store: AppStore): LoadStatus[] {
  const seen: LoadStatus[] = [];
  store.subscribe(
    (s) => s.data.stars,
    (status) => seen.push(status),
  );
  return seen;
}

/** A one-test fetch stub: answers every request with this body and status. Returns the call log. */
function stubFetch(body: string, status = 200): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    urls.push(input instanceof Request ? input.url : String(input));
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals(); // back to the throwing stub from setup.ts
  vi.restoreAllMocks();
});

describe("createSkyCache", () => {
  it("starts empty, with every body value NaN (not computed yet)", () => {
    const cache = createSkyCache();
    expect(cache.rows).toEqual([]);
    expect(cache.unitJ2000).toBeInstanceOf(Float64Array);
    expect(cache.unitJ2000).toHaveLength(0);
    expect(cache.starAzAltDeg).toBeInstanceOf(Float32Array);
    expect(cache.starAzAltDeg).toHaveLength(0);
    expect(cache.starCount).toBe(0);
    expect(cache.bodies).toBeInstanceOf(Float64Array);
    expect(cache.bodies).toHaveLength(BODY_IDS.length * BODY_STRIDE);
    expect(cache.bodies.every((v) => Number.isNaN(v))).toBe(true);
    expect(cache.lastSkyMs).toBeNull();
    expect(cache.site).toBeNull();
    expect(cache.observer).toBeNull();
  });

  it("each call returns a new cache; the singleton is one of them", () => {
    expect(createSkyCache()).not.toBe(createSkyCache());
    expect(skyCache.rows).toEqual([]);
  });
});

describe("starCountForLimit", () => {
  it("stars.json: 4 → 518, 4.5 → 904, 6.5 → 8,404", () => {
    expect(starCountForLimit(ROWS, 4)).toBe(518);
    expect(starCountForLimit(ROWS, 4.5)).toBe(904);
    expect(starCountForLimit(ROWS, 6.5)).toBe(8404);
  });

  it("counts the leading rows with vmag ≤ the limit, inclusive", () => {
    const rows: StarRow[] = [
      [0, 0, 1, 1, ""],
      [0, 0, 2, 2, ""],
      [0, 0, 2, 3, ""],
      [0, 0, 3, 4, ""],
    ];
    expect(starCountForLimit(rows, 0)).toBe(0);
    expect(starCountForLimit(rows, 1)).toBe(1);
    expect(starCountForLimit(rows, 1.99)).toBe(1);
    expect(starCountForLimit(rows, 2)).toBe(3);
    expect(starCountForLimit(rows, 3)).toBe(4);
    expect(starCountForLimit(rows, 7)).toBe(4);
    expect(starCountForLimit([], 6.5)).toBe(0);
  });

  it("agrees with a linear count at every slider step", () => {
    for (let limit = 1; limit <= 6.5; limit += 0.5) {
      const linear = ROWS.findIndex((row) => row[2] > limit);
      expect(starCountForLimit(ROWS, limit)).toBe(linear === -1 ? ROWS.length : linear);
    }
  });
});

describe("setStars and setStarLimit", () => {
  it("setStars sizes the arrays for every row, counts the prefix and clears lastSkyMs", () => {
    const cache = createSkyCache();
    cache.lastSkyMs = T;
    setStars(cache, ROWS, 4.5);
    expect(cache.rows).toBe(ROWS);
    expect(cache.unitJ2000).toHaveLength(3 * ROWS.length);
    expect(cache.starAzAltDeg).toHaveLength(2 * ROWS.length);
    expect(cache.starCount).toBe(904);
    expect(cache.lastSkyMs).toBeNull();
    // Sirius, the first row: RA 101.28854°, Dec −16.71314° (J2000).
    const ra = ((ROWS[0]?.[0] ?? Number.NaN) * Math.PI) / 180;
    const dec = ((ROWS[0]?.[1] ?? Number.NaN) * Math.PI) / 180;
    expect(cache.unitJ2000[0]).toBeCloseTo(Math.cos(dec) * Math.cos(ra), 12);
    expect(cache.unitJ2000[1]).toBeCloseTo(Math.cos(dec) * Math.sin(ra), 12);
    expect(cache.unitJ2000[2]).toBeCloseTo(Math.sin(dec), 12);
  });

  it("setStarLimit returns true and clears lastSkyMs only when the count changes", () => {
    const cache = cacheWithStars(4.5);
    cache.lastSkyMs = T;
    expect(setStarLimit(cache, 4.5)).toBe(false);
    expect(cache.lastSkyMs).toBe(T);
    expect(setStarLimit(cache, 6.5)).toBe(true);
    expect(cache.starCount).toBe(8404);
    expect(cache.lastSkyMs).toBeNull();
    cache.lastSkyMs = T;
    expect(setStarLimit(cache, 4)).toBe(true);
    expect(cache.starCount).toBe(518);
    expect(cache.lastSkyMs).toBeNull();
  });

  it("invalidateSky clears lastSkyMs", () => {
    const cache = cacheWithStars();
    cache.lastSkyMs = T;
    invalidateSky(cache);
    expect(cache.lastSkyMs).toBeNull();
  });
});

describe("updateSky", () => {
  it("recomputes on the first call, on ≥ 2 s either way, for a new site object, a new limit and after invalidateSky", () => {
    const cache = cacheWithStars(4.5);
    expect(updateSky(cache, T, SITE)).toBe(true);
    expect(cache.lastSkyMs).toBe(T);
    expect(updateSky(cache, T + 1_999, SITE)).toBe(false);
    expect(cache.lastSkyMs).toBe(T);
    expect(updateSky(cache, T + 2_000, SITE)).toBe(true);
    expect(cache.lastSkyMs).toBe(T + 2_000);
    expect(updateSky(cache, T, SITE)).toBe(true); // stepping back 2 s
    expect(updateSky(cache, T, SITE)).toBe(false);

    // A new site object (a camera switch), even with equal values, rebuilds the observer.
    const observer = cache.observer;
    const site2: ObserverSite = { ...SITE };
    expect(updateSky(cache, T, site2)).toBe(true);
    expect(cache.site).toBe(site2);
    expect(cache.observer).not.toBe(observer);
    expect(updateSky(cache, T, site2)).toBe(false);

    expect(setStarLimit(cache, 6.5)).toBe(true);
    expect(updateSky(cache, T, site2)).toBe(true);
    expect(setStarLimit(cache, 6.5)).toBe(false);
    expect(updateSky(cache, T, site2)).toBe(false);

    invalidateSky(cache);
    expect(updateSky(cache, T, site2)).toBe(true);
    expect(updateSky(cache, T, site2)).toBe(false);
  });

  it("keeps the observer for the same site object", () => {
    const cache = cacheWithStars();
    updateSky(cache, T, SITE);
    const observer = cache.observer;
    expect(observer).not.toBeNull();
    expect(cache.site).toBe(SITE);
    updateSky(cache, T + 10_000, SITE);
    expect(cache.observer).toBe(observer);
  });

  it("puts Polaris, from its stars.json row (BSC coordinates), at az 0.592°, alt 20.151° ± 0.01°", () => {
    const cache = cacheWithStars(4.5);
    expect(updateSky(cache, T, SITE)).toBe(true);
    const i = ROWS.findIndex((row) => row[3] === 424);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(cache.starCount);
    const az = cache.starAzAltDeg[2 * i] ?? Number.NaN;
    const alt = cache.starAzAltDeg[2 * i + 1] ?? Number.NaN;
    expect(Math.abs(az - 0.592)).toBeLessThan(0.01);
    expect(Math.abs(alt - 20.151)).toBeLessThan(0.01);
  });

  it("rotates only the magnitude prefix and fills every body value", () => {
    const cache = cacheWithStars(4.5);
    updateSky(cache, T, SITE);
    const last = cache.starCount - 1;
    expect(Number.isFinite(cache.starAzAltDeg[2 * last + 1])).toBe(true);
    expect(cache.starAzAltDeg[2 * last + 1]).not.toBe(0);
    // Past the prefix the array is untouched (still the zeros setStars allocated).
    expect(cache.starAzAltDeg.subarray(2 * cache.starCount).every((v) => v === 0)).toBe(true);
    expect(cache.bodies.every((v) => Number.isFinite(v))).toBe(true);
    // Saturn at 08:00Z (README e2e fixture): az 120.4°, alt 57.60°.
    const saturn = BODY_IDS.indexOf("planet:Saturn") * BODY_STRIDE;
    expect(Math.abs((cache.bodies[saturn] ?? Number.NaN) - 120.4)).toBeLessThan(0.05);
    expect(Math.abs((cache.bodies[saturn + 1] ?? Number.NaN) - 57.6)).toBeLessThan(0.01);
  });

  it("with no catalogue still computes the bodies", () => {
    const cache = createSkyCache();
    expect(updateSky(cache, T, SITE)).toBe(true);
    expect(cache.bodies.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("loadStars", () => {
  it("with the throwing fetch stub from setup.ts: loading → error, logged, no retry", async () => {
    const store = newStore();
    const seen = starStatuses(store);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadStars(store);
    expect(seen).toEqual(["loading", "error"]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("with stars.json: loading → ready, and the singleton holds the V ≤ 4.5 prefix", async () => {
    const urls = stubFetch(STARS_TEXT);
    const store = newStore();
    const seen = starStatuses(store);
    await loadStars(store);
    expect(seen).toEqual(["loading", "ready"]);
    expect(urls).toEqual([`${import.meta.env.BASE_URL}data/stars.json`]);
    expect(skyCache.rows).toHaveLength(8404);
    expect(skyCache.unitJ2000).toHaveLength(3 * 8404);
    expect(skyCache.starAzAltDeg).toHaveLength(2 * 8404);
    expect(skyCache.starCount).toBe(904);
    expect(skyCache.lastSkyMs).toBeNull();
  });

  it("uses selectStarMagLimit: V ≤ 4 while the Calibration panel is open", async () => {
    stubFetch(STARS_TEXT);
    const store = newStore();
    // The panel lands in M4; build the state directly.
    store.setState((s) => ({ ui: { ...s.ui, panel: "calibration" } }));
    await loadStars(store);
    expect(store.getState().data.stars).toBe("ready");
    expect(skyCache.starCount).toBe(518);
  });

  const invalid: ReadonlyArray<readonly [string, string, number?]> = [
    ["HTTP 404", "[]", 404],
    ["not JSON", "<!doctype html>"],
    ["not an array", '{"rows":[]}'],
    ["an empty array", "[]"],
    [
      "more rows than the stars layer holds",
      `[${Array(MAX_STAR_ROWS + 1)
        .fill('[0,0,1,1,""]')
        .join(",")}]`,
    ],
    ["a 4-element row", "[[0,0,1,1]]"],
    ["a 6-element row", '[[0,0,1,1,"",0]]'],
    ["a row that is not an array", '[{"ra":0}]'],
    ["a null coordinate", '[[null,0,1,1,""]]'],
    ["a string magnitude", '[[0,0,"1",1,""]]'],
    ["a numeric name", "[[0,0,1,1,0]]"],
    ["a decreasing vmag", '[[0,0,2,1,""],[0,0,1,2,""]]'],
  ];
  for (const [what, body, status] of invalid) {
    it(`rejects ${what}: error, logged, no retry`, async () => {
      const urls = stubFetch(body, status);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const store = newStore();
      const seen = starStatuses(store);
      await loadStars(store);
      expect(seen).toEqual(["loading", "error"]);
      expect(urls).toHaveLength(1);
      expect(error).toHaveBeenCalledTimes(1);
    });
  }

  it("caps the rows at the committed catalogue's length, the stars layer's capacity", () => {
    expect(MAX_STAR_ROWS).toBe(8404);
    expect(ROWS).toHaveLength(MAX_STAR_ROWS);
  });

  it("accepts the largest valid file, MAX_STAR_ROWS rows, with equal magnitudes", async () => {
    stubFetch(`[${Array(MAX_STAR_ROWS).fill('[0,0,1,1,""]').join(",")}]`);
    const store = newStore();
    await loadStars(store);
    expect(store.getState().data.stars).toBe("ready");
    expect(skyCache.starCount).toBe(MAX_STAR_ROWS);
  });
});
