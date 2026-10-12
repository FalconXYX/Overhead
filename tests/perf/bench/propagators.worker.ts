// tests/perf/bench/propagators.worker.ts — M9 step 3's measurement, in a Chromium worker: the Starlink sample by the
// plain loop (M3), by culling (cull.ts, shipped) and by BulkPropagator (src/workers/bulk.ts, not shipped). Built at
// test time by tests/perf/bulk.perf.ts (Vite library mode) and served from a route, so nothing here reaches dist/.
// Each 100 ms tick runs the three for the same k back to back, each into its own buffer: same load, same pacing.
import { json2satrec } from "satellite.js";
import type { ObserverSite } from "../../../src/domain/geo";
import {
  appendGroup,
  type CatalogEntry,
  createCullState,
  createPropagationContext,
  GP_GROUPS,
  parseGpFile,
  SAMPLE_STRIDE,
  writeCulledSample,
  writeSample,
} from "../../../src/domain/orbits";
import { createStarlinkBulk, writeBulkSample } from "../../../src/workers/bulk";

export interface BenchRequest {
  readonly gpBaseUrl: string; // absolute, ending in "/"
  readonly site: ObserverSite;
  readonly startMs: number;
  readonly rates: readonly number[];
  readonly samples: number; // per rate, after WARMUP
  readonly tickMs: number; // pacing, 100 ms (the app's 10 Hz)
}
export interface BenchTimes {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}
export interface BenchRow {
  readonly rate: number;
  readonly plain: BenchTimes;
  readonly culled: BenchTimes;
  readonly bulk: BenchTimes;
  readonly culledPropagatedP50: number;
  /** Bulk against writeSample, every object above −5° in each sample. */
  readonly bulkChecks: number;
  readonly bulkMaxPosKm: number;
  readonly bulkMaxVelKmS: number;
  readonly bulkFlagMismatches: number;
}
export interface BenchResult {
  readonly objects: number;
  readonly starlink: number;
  readonly bulkSetupMs: number;
  readonly rows: readonly BenchRow[];
}

const WARMUP = 5;
const R2D = 180 / Math.PI;

function times(xs: number[]): BenchTimes {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
  return { p50: at(50), p95: at(95), max: sorted[sorted.length - 1] ?? Number.NaN };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function run(req: BenchRequest): Promise<BenchResult> {
  const seen = new Set<number>();
  const entries: CatalogEntry[] = [];
  for (const group of GP_GROUPS) {
    const res = await fetch(new URL(`${group}.json`, req.gpBaseUrl).href);
    if (!res.ok) throw new Error(`${group}.json: HTTP ${res.status}`);
    entries.push(...appendGroup(seen, group, parseGpFile(await res.json())));
  }
  const n = entries.length;
  const recs = entries.map((e) => json2satrec(e.omm));
  const skip = Uint8Array.from(entries, (e) => (e.dockedWith === null ? 0 : 1));
  const cull = Uint8Array.from(entries, (e) => (e.group === "starlink" ? 1 : 0));
  const starlinkRows = Int32Array.from(
    entries.flatMap((e, i) => (e.group === "starlink" && e.dockedWith === null ? [i] : [])),
  );
  const starlinkRecs = [...starlinkRows].flatMap((i) => {
    const rec = recs[i];
    return rec === undefined ? [] : [rec];
  });
  if (starlinkRecs.length !== starlinkRows.length) throw new Error("a Starlink row has no satrec");
  const t0 = performance.now();
  const bulk = await createStarlinkBulk(starlinkRecs); // once per group load in a real worker
  const bulkSetupMs = performance.now() - t0;
  const plainOut = new Float32Array(n * SAMPLE_STRIDE);
  const culledOut = new Float32Array(n * SAMPLE_STRIDE);
  const bulkOut = new Float32Array(n * SAMPLE_STRIDE);
  const rows: BenchRow[] = [];
  try {
    for (const rate of req.rates) {
      const stepMs = 100 * rate;
      const k0 = Math.floor(req.startMs / stepMs);
      const state = createCullState(n);
      const plain: number[] = [];
      const culled: number[] = [];
      const bulkMs: number[] = [];
      const propagated: number[] = [];
      let bulkChecks = 0;
      let bulkMaxPosKm = 0;
      let bulkMaxVelKmS = 0;
      let bulkFlagMismatches = 0;
      for (let s = 0; s < WARMUP + req.samples; s++) {
        const tickStart = performance.now();
        const k = k0 + s;
        const ctx = createPropagationContext(k * stepMs, req.site);
        // Plain loop (M3): every undocked object.
        let a = performance.now();
        for (let i = 0; i < n; i++) {
          const rec = recs[i];
          if (rec === undefined || skip[i] === 1)
            plainOut.fill(0, i * SAMPLE_STRIDE, (i + 1) * SAMPLE_STRIDE);
          else writeSample(rec, ctx, plainOut, i);
        }
        const plainMs = performance.now() - a;
        // Culling (shipped).
        a = performance.now();
        const count = writeCulledSample(state, recs, skip, cull, ctx, culledOut, k, stepMs, 1);
        const culledMs = performance.now() - a;
        // BulkPropagator for Starlink, the plain loop for the rest.
        a = performance.now();
        for (let i = 0; i < n; i++) {
          const rec = recs[i];
          if (cull[i] === 1) continue;
          if (rec === undefined || skip[i] === 1)
            bulkOut.fill(0, i * SAMPLE_STRIDE, (i + 1) * SAMPLE_STRIDE);
          else writeSample(rec, ctx, bulkOut, i);
        }
        writeBulkSample(bulk, starlinkRows, ctx, bulkOut);
        const bulkRunMs = performance.now() - a;
        if (s >= WARMUP) {
          plain.push(plainMs);
          culled.push(culledMs);
          bulkMs.push(bulkRunMs);
          propagated.push(count);
          for (const i of starlinkRows) {
            const o = i * SAMPLE_STRIDE;
            if (plainOut[o + 7] !== 1) continue;
            const e = plainOut[o] ?? 0;
            const nn = plainOut[o + 1] ?? 0;
            if (!(Math.atan2(plainOut[o + 2] ?? 0, Math.hypot(e, nn)) * R2D > -5)) continue;
            bulkChecks++;
            for (let q = 0; q < 3; q++) {
              bulkMaxPosKm = Math.max(
                bulkMaxPosKm,
                Math.abs((bulkOut[o + q] ?? 0) - (plainOut[o + q] ?? 0)),
              );
              bulkMaxVelKmS = Math.max(
                bulkMaxVelKmS,
                Math.abs((bulkOut[o + 3 + q] ?? 0) - (plainOut[o + 3 + q] ?? 0)),
              );
            }
            if (bulkOut[o + 6] !== plainOut[o + 6] || bulkOut[o + 7] !== plainOut[o + 7])
              bulkFlagMismatches++;
          }
        }
        await sleep(Math.max(0, req.tickMs - (performance.now() - tickStart)));
      }
      rows.push({
        rate,
        plain: times(plain),
        culled: times(culled),
        bulk: times(bulkMs),
        culledPropagatedP50: times(propagated).p50,
        bulkChecks,
        bulkMaxPosKm,
        bulkMaxVelKmS,
        bulkFlagMismatches,
      });
    }
  } finally {
    bulk.dispose();
  }
  return { objects: n, starlink: starlinkRows.length, bulkSetupMs, rows };
}

addEventListener("message", (e: MessageEvent<BenchRequest>) => {
  run(e.data).then(
    (result) => postMessage({ ok: true, result }),
    (error: unknown) =>
      postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }),
  );
});
