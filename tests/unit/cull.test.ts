// tests/unit/cull.test.ts — Starlink culling for the 10 Hz sample (M9 step 2, section 5): the culled sample matches a
// full writeSample pass for every object that could be drawn, propagates a fraction of Starlink on consecutive
// samples, and moves far rows along their held velocity.
import { readFileSync } from "node:fs";
import { json2satrec, type SatRec } from "satellite.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ObserverSite } from "../../src/domain/geo";
import {
  appendGroup,
  type CatalogEntry,
  CULL_SLICES,
  createCullState,
  createPropagationContext,
  cullLimitKm,
  GP_GROUPS,
  parseGpFile,
  resetCullState,
  SAMPLE_STRIDE,
  writeCulledSample,
  writeSample,
} from "../../src/domain/orbits";

const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const T0 = Date.parse("2026-10-11T15:09:50Z");
const SAMPLES = 30;
const DRAWABLE_MIN_ALT_DEG = -5; // compared in geometric altitude, below the −3° sky cut-off
const R2D = 180 / Math.PI;

interface Catalog {
  satrecs: SatRec[];
  skip: Uint8Array; // docked
  cull: Uint8Array; // starlink
}

function fixture(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8"));
}

/** The committed snapshot loaded as the worker loads it: stations, visual, starlink, one dedupe set. */
function loadCatalog(): Catalog {
  const seen = new Set<number>();
  const entries: CatalogEntry[] = [];
  for (const group of GP_GROUPS)
    entries.push(...appendGroup(seen, group, parseGpFile(fixture(`${group}.json`))));
  const n = entries.length;
  const skip = new Uint8Array(n);
  const cull = new Uint8Array(n);
  entries.forEach((e, i) => {
    skip[i] = e.dockedWith === null ? 0 : 1;
    cull[i] = e.group === "starlink" ? 1 : 0;
  });
  return { satrecs: entries.map((e) => json2satrec(e.omm)), skip, cull };
}

/** A full pass, as M3's worker loop wrote it. */
function fullPass(c: Catalog, timeMs: number, out: Float32Array): void {
  const ctx = createPropagationContext(timeMs, SITE);
  for (let i = 0; i < c.satrecs.length; i++) {
    const rec = c.satrecs[i];
    if (rec === undefined || c.skip[i] === 1)
      out.fill(0, i * SAMPLE_STRIDE, (i + 1) * SAMPLE_STRIDE);
    else writeSample(rec, ctx, out, i);
  }
}

const geometricAltDeg = (row: Float32Array, i: number): number => {
  const o = i * SAMPLE_STRIDE;
  const e = row[o] ?? 0;
  const n = row[o + 1] ?? 0;
  return Math.atan2(row[o + 2] ?? 0, Math.hypot(e, n)) * R2D;
};

let catalog: Catalog;
beforeAll(() => {
  catalog = loadCatalog();
});

describe("cullLimitKm", () => {
  it("is 4,150 km plus 8 km/s over 12 samples", () => {
    const cases: [number, number][] = [
      [100, 4159.6],
      [1_000, 4246],
      [6_000, 4726],
      [60_000, 9910],
    ];
    for (const [stepMs, km] of cases)
      expect(Math.abs(cullLimitKm(stepMs) - km)).toBeLessThanOrEqual(1e-9);
  });
});

describe("writeCulledSample on the committed snapshot", () => {
  it("loads 11,277 objects, 11,102 of them Starlink, 10 docked", () => {
    expect(catalog.satrecs.length).toBe(11_277);
    expect(catalog.cull.reduce((a, b) => a + b, 0)).toBe(11_102);
    expect(catalog.skip.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it.each([100, 1_000, 6_000, 60_000])(
    "matches a full pass exactly for every object above −5° over 30 samples at stepMs %i",
    (stepMs) => {
      const n = catalog.satrecs.length;
      const state = createCullState(n);
      const culled = new Float32Array(n * SAMPLE_STRIDE);
      const full = new Float32Array(n * SAMPLE_STRIDE);
      const k0 = Math.floor(T0 / stepMs);
      let checks = 0;
      let mismatches = 0;
      for (let s = 0; s < SAMPLES; s++) {
        const k = k0 + s;
        const timeMs = k * stepMs;
        const ctx = createPropagationContext(timeMs, SITE);
        writeCulledSample(
          state,
          catalog.satrecs,
          catalog.skip,
          catalog.cull,
          ctx,
          culled,
          k,
          stepMs,
          1,
        );
        fullPass(catalog, timeMs, full);
        for (let i = 0; i < n; i++) {
          if (
            full[i * SAMPLE_STRIDE + 7] !== 1 ||
            !(geometricAltDeg(full, i) > DRAWABLE_MIN_ALT_DEG)
          )
            continue;
          checks++;
          for (let q = 0; q < SAMPLE_STRIDE; q++) {
            if (culled[i * SAMPLE_STRIDE + q] !== full[i * SAMPLE_STRIDE + q]) {
              mismatches++;
              break;
            }
          }
        }
      }
      expect(checks).toBeGreaterThan(10_000); // measured about 17,000 per step size
      expect(mismatches).toBe(0);
    },
  );

  it("propagates all 11,267 undocked objects on a first sample, after a skipped k and after a new generation", () => {
    const n = catalog.satrecs.length;
    const state = createCullState(n);
    const out = new Float32Array(n * SAMPLE_STRIDE);
    const stepMs = 100;
    const k0 = Math.floor(T0 / stepMs);
    const run = (k: number, generation: number): number =>
      writeCulledSample(
        state,
        catalog.satrecs,
        catalog.skip,
        catalog.cull,
        createPropagationContext(k * stepMs, SITE),
        out,
        k,
        stepMs,
        generation,
      );
    expect(run(k0, 1)).toBe(11_267); // first sample
    const consecutive = run(k0 + 1, 1);
    expect(consecutive).toBeLessThan(3_000); // measured 2,247
    expect(consecutive).toBeGreaterThan(175 + 11_102 / CULL_SLICES - 1); // every non-Starlink and one slice at least
    expect(run(k0 + 3, 1)).toBe(11_267); // k0 + 2 was skipped
    expect(run(k0 + 4, 1)).toBeLessThan(3_000);
    expect(run(k0 + 5, 2)).toBe(11_267); // a new generation (a flush)
    expect(run(k0 + 6, 2)).toBeLessThan(3_000);
    resetCullState(state); // the observer moved
    expect(run(k0 + 7, 2)).toBe(11_267);
  });

  it.each([
    [1_000, 1],
    [6_000, 20],
  ])(
    "moves far rows along their held velocity: max position error at stepMs %i ≤ %f km",
    (stepMs, maxKm) => {
      const n = catalog.satrecs.length;
      const state = createCullState(n);
      const culled = new Float32Array(n * SAMPLE_STRIDE);
      const full = new Float32Array(n * SAMPLE_STRIDE);
      const k0 = Math.floor(T0 / stepMs);
      let worstKm = 0;
      let extrapolated = 0;
      for (let s = 0; s < SAMPLES; s++) {
        const k = k0 + s;
        const timeMs = k * stepMs;
        writeCulledSample(
          state,
          catalog.satrecs,
          catalog.skip,
          catalog.cull,
          createPropagationContext(timeMs, SITE),
          culled,
          k,
          stepMs,
          1,
        );
        if (s === 0) continue; // a full pass: nothing extrapolated
        fullPass(catalog, timeMs, full);
        const slice = k % CULL_SLICES;
        for (let i = 0; i < n; i++) {
          const o = i * SAMPLE_STRIDE;
          // Extrapolated: culled, valid, not on this sample's slice and not a candidate.
          if (catalog.cull[i] !== 1 || catalog.skip[i] === 1 || i % CULL_SLICES === slice) continue;
          if (state.candidate[i] === 1 || full[o + 7] !== 1) continue;
          extrapolated++;
          const errKm = Math.hypot(
            (culled[o] ?? 0) - (full[o] ?? 0),
            (culled[o + 1] ?? 0) - (full[o + 1] ?? 0),
            (culled[o + 2] ?? 0) - (full[o + 2] ?? 0),
          );
          worstKm = Math.max(worstKm, errKm);
        }
      }
      expect(extrapolated).toBeGreaterThan(100_000);
      expect(worstKm).toBeLessThanOrEqual(maxKm); // measured 0.39 and 13.89 km
    },
  );

  it("zeroes skipped rows, keeps rows past the state untouched, and reports failed propagations", () => {
    const n = catalog.satrecs.length;
    const state = createCullState(n);
    const out = new Float32Array((n + 1) * SAMPLE_STRIDE).fill(7);
    const skip = Uint8Array.from(catalog.skip);
    skip[0] = 1; // the ISS, as if its group were off
    const failed: number[] = [];
    // 2027-01-01: four station objects have decayed (M3's worker test), each reported once per call.
    const k = Math.floor(Date.parse("2027-01-01T00:00:00Z") / 100);
    writeCulledSample(
      state,
      catalog.satrecs,
      skip,
      catalog.cull,
      createPropagationContext(k * 100, SITE),
      out,
      k,
      100,
      1,
      (i) => failed.push(i),
    );
    expect([...out.subarray(0, SAMPLE_STRIDE)]).toEqual(new Array(SAMPLE_STRIDE).fill(0));
    expect([...out.subarray(n * SAMPLE_STRIDE)]).toEqual(new Array(SAMPLE_STRIDE).fill(7));
    expect(failed.length).toBeGreaterThanOrEqual(4);
    for (const i of failed) expect(out[i * SAMPLE_STRIDE + 7]).toBe(0);
  });
});
