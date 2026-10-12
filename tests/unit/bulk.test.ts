// tests/unit/bulk.test.ts — M9 step 3's BulkPropagator call shape (src/workers/bulk.ts, not shipped): its rows match
// writeSample's for every Starlink object. Node runs the single-thread WASM runtime; timings are for the browser
// (tests/perf/bulk.perf.ts), never this file.
import { readFileSync } from "node:fs";
import { json2satrec } from "satellite.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObserverSite } from "../../src/domain/geo";
import {
  appendGroup,
  createPropagationContext,
  parseGpFile,
  SAMPLE_STRIDE,
  writeSample,
} from "../../src/domain/orbits";
import { createStarlinkBulk, type StarlinkBulk, writeBulkSample } from "../../src/workers/bulk";

const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const TIMES = ["2026-10-11T15:09:50Z", "2026-10-11T20:00:00Z", "2026-10-12T03:50:21Z"];

const omms = parseGpFile(
  JSON.parse(readFileSync(new URL("../fixtures/gp/starlink.json", import.meta.url), "utf8")),
);
const entries = appendGroup(new Set<number>(), "starlink", omms);
const recs = entries.map((e) => json2satrec(e.omm));
let bulk: StarlinkBulk;

beforeAll(async () => {
  bulk = await createStarlinkBulk(recs);
});
afterAll(() => {
  bulk.dispose();
});

describe("writeBulkSample", () => {
  it.each(TIMES)("matches writeSample bit for bit for all 11,102 Starlink rows at %s", (iso) => {
    const n = recs.length;
    expect(n).toBe(11_102);
    const rows = Int32Array.from({ length: n }, (_, j) => j);
    const ctx = createPropagationContext(Date.parse(iso), SITE);
    const bulkOut = new Float32Array(n * SAMPLE_STRIDE);
    writeBulkSample(bulk, rows, ctx, bulkOut);
    const plain = new Float32Array(n * SAMPLE_STRIDE);
    for (let i = 0; i < n; i++) {
      const rec = recs[i];
      if (rec !== undefined) writeSample(rec, ctx, plain, i);
    }
    let maxPosKm = 0;
    let maxVelKmS = 0;
    let identical = 0;
    let flagMismatches = 0;
    for (let i = 0; i < n; i++) {
      const o = i * SAMPLE_STRIDE;
      let same = true;
      for (let q = 0; q < SAMPLE_STRIDE; q++) if (bulkOut[o + q] !== plain[o + q]) same = false;
      if (same) identical++;
      for (let q = 0; q < 3; q++) {
        maxPosKm = Math.max(maxPosKm, Math.abs((bulkOut[o + q] ?? 0) - (plain[o + q] ?? 0)));
        maxVelKmS = Math.max(
          maxVelKmS,
          Math.abs((bulkOut[o + 3 + q] ?? 0) - (plain[o + 3 + q] ?? 0)),
        );
      }
      if (bulkOut[o + 6] !== plain[o + 6] || bulkOut[o + 7] !== plain[o + 7]) flagMismatches++;
    }
    // Bit-identical in Node (M9 step 3); the browser check allows 1e-3 km and 1e-6 km/s.
    expect(identical).toBe(n);
    expect(maxPosKm).toBeLessThanOrEqual(1e-3);
    expect(maxVelKmS).toBeLessThanOrEqual(1e-6);
    expect(flagMismatches).toBe(0);
  });

  it("writes rows[j] of `out` only, and run() is synchronous", () => {
    const ctx = createPropagationContext(Date.parse(TIMES[0] ?? ""), SITE);
    const out = new Float32Array((recs.length + 2) * SAMPLE_STRIDE).fill(7);
    const rows = Int32Array.from({ length: recs.length }, (_, j) => j + 2); // shifted by two rows
    writeBulkSample(bulk, rows, ctx, out);
    expect([...out.subarray(0, 2 * SAMPLE_STRIDE)]).toEqual(new Array(2 * SAMPLE_STRIDE).fill(7));
    const first = new Float32Array(SAMPLE_STRIDE);
    const rec = recs[0];
    if (rec === undefined) throw new Error("no record");
    writeSample(rec, ctx, first, 0);
    for (let q = 0; q < 3; q++) {
      expect(Math.abs((out[2 * SAMPLE_STRIDE + q] ?? 0) - (first[q] ?? 0))).toBeLessThanOrEqual(
        1e-3,
      );
    }
  });
});
