// tests/perf/bulk.perf.ts — M9 step 3: BulkPropagator against culling and the plain loop, in a Chromium worker on the
// committed snapshot (11,277 objects). Run by hand, never in CI: `npm run perf -- bulk` (no app build needed: the
// bench worker is built here with Vite's library mode into test-results/perf/bench/ and served from a route, so
// src/workers/bulk.ts never reaches dist/).
// Rule (DECISIONS, "Satellites"): ship bulk.ts only if the culled p95 is over 10 ms on a target laptop and a bulk run
// beats it there. Gates: culled p95 ≤ 10 ms at every rate, and bulk rows within 1e-3 km and 1e-6 km/s of writeSample
// with equal flags for every Starlink above −5°.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "../e2e/fixtures";
import type { BenchRequest, BenchResult } from "./bench/propagators.worker";

const OUT_DIR = "test-results/perf";
const BENCH_DIR = join(OUT_DIR, "bench");
const ENTRY = fileURLToPath(new URL("./bench/propagators.worker.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CULLED_BUDGET_P95_MS = 10;

test("BulkPropagator against culling and the plain loop (step 3)", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(300_000);
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false, // the GP data comes through the shared fixture's route, not a copy
    logLevel: "warn",
    worker: { format: "es" }, // as vite.config.ts: satellite.js's WASM loaders use top-level await
    build: {
      outDir: BENCH_DIR,
      emptyOutDir: true,
      minify: true,
      lib: { entry: ENTRY, formats: ["es"], fileName: () => "propagators.worker.js" },
    },
  });
  // Later context routes win over the fixture's (Playwright tries them in reverse order); context routes also see
  // the dedicated worker's own requests.
  await context.route("**/Overhead/__bench/**", (route) => {
    const file = basename(new URL(route.request().url()).pathname);
    if (file === "index.html") {
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>bench</title>",
      });
    }
    return route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(join(BENCH_DIR, file)),
    });
  });
  await page.goto("./__bench/index.html");
  const request: BenchRequest = {
    gpBaseUrl: new URL("data/gp/", page.url().replace(/__bench\/index\.html$/, "")).href,
    site: { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 },
    startMs: Date.parse("2026-10-11T15:09:50Z"),
    rates: [1, 60, 600],
    samples: 300,
    tickMs: 100,
  };
  const reply = await page.evaluate(
    (req) =>
      new Promise<{ ok: true; result: BenchResult } | { ok: false; message: string }>(
        (resolve, reject) => {
          const worker = new Worker("./propagators.worker.js", { type: "module" });
          worker.onmessage = (e) => {
            worker.terminate();
            resolve(e.data);
          };
          worker.onerror = (e) => reject(new Error(e.message));
          worker.postMessage(req);
        },
      ),
    request,
  );
  if (!reply.ok) throw new Error(`bench worker: ${reply.message}`);
  const { result } = reply;
  const line = (label: string, t: { p50: number; p95: number; max: number }): string =>
    `${label} p50 ${t.p50.toFixed(2)} / p95 ${t.p95.toFixed(2)} / max ${t.max.toFixed(2)} ms`;
  console.log(
    `Chromium ${browser.version()}, launched from Node ${process.version} ${process.arch}; ` +
      `${result.objects} objects, ${result.starlink} Starlink; BulkPropagator setup ${result.bulkSetupMs.toFixed(1)} ms`,
  );
  for (const row of result.rows) {
    console.log(
      `${row.rate}x, ${request.samples} samples paced at 10 Hz: ${line("plain", row.plain)}; ` +
        `${line("culled", row.culled)} (${row.culledPropagatedP50} propagated, p50); ${line("bulk", row.bulk)}; ` +
        `bulk vs writeSample: ${row.bulkChecks} checks, max ${row.bulkMaxPosKm.toExponential(2)} km, ` +
        `${row.bulkMaxVelKmS.toExponential(2)} km/s, ${row.bulkFlagMismatches} flag mismatches`,
    );
  }
  const bulkWins = result.rows.filter(
    (r) => r.culled.p95 > CULLED_BUDGET_P95_MS && r.bulk.p95 < r.culled.p95,
  );
  console.log(
    bulkWins.length === 0
      ? `Outcome: do not ship bulk.ts (culled p95 <= ${CULLED_BUDGET_P95_MS} ms at every rate, or bulk is no faster)`
      : `Outcome: bulk.ts beats culling over budget at ${bulkWins.map((r) => `${r.rate}x`).join(", ")}: ship it`,
  );
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "bulk.json"), JSON.stringify({ request, result }, null, 2));
  for (const row of result.rows) {
    expect
      .soft(row.culled.p95, `culled p95 at ${row.rate}x (ms)`)
      .toBeLessThanOrEqual(CULLED_BUDGET_P95_MS);
    expect.soft(row.bulkChecks, `bulk checks at ${row.rate}x`).toBeGreaterThan(0);
    expect.soft(row.bulkMaxPosKm).toBeLessThanOrEqual(1e-3);
    expect.soft(row.bulkMaxVelKmS).toBeLessThanOrEqual(1e-6);
    expect.soft(row.bulkFlagMismatches).toBe(0);
  }
});
