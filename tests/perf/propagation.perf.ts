// tests/perf/propagation.perf.ts — propagation worker cost per sample (M3 step 16.3; README section 9). Run by hand with
// `npm run perf`, never in CI. Budget: ISS + visual p95 ≤ 4 ms. [M9] With Starlink (culled, step 2) p95 ≤ 10 ms at 1×,
// 60× and 600×: gated from M9 (measured 2.1–2.6 ms at 1× to 60×, 4.1–5.1 ms at 600×). [Redesign] On the live Subaru
// StarCam, its rates set through the perf test hook (no control offers 60× or 600× any more, and a live camera has no
// time controls); the worker's work does not depend on the camera's lens.
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, test } from "../e2e/fixtures";

const SAMPLES = 600; // 60 s at 1× (D = 100 ms)
const WARMUP = 5; // JIT warm-up: the first replies took 1.0–3.1 ms
const BUDGET_P95_MS = 4;
const STARLINK_BUDGET_P95_MS = 10; // [M9]
/** The e2e instant: 2026-10-11T15:09:50Z, the ISS pass. */
const START = Date.parse("2026-10-11T15:09:50Z");

// Collects every "overhead:propagate" duration (the worker's computeMs). The app clears its measures at once; an
// observer still receives each one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __propagate: number[] };
    w.__propagate = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntriesByName("overhead:propagate"))
        w.__propagate.push(entry.duration);
    }).observe({ type: "measure" });
  });
});

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

const durations = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __propagate: number[] }).__propagate);
const resetDurations = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __propagate: number[] }).__propagate = [];
  });

/**
 * Waits for WARMUP + SAMPLES replies, drops the warm-up, and returns p50/p95/max of the rest. [M9] The warm-up also
 * drops the full passes that follow a flush (a rate change or a seek).
 */
async function collect(
  page: Page,
  label: string,
  rate = "1x",
): Promise<{ p95: number; text: string }> {
  await resetDurations(page);
  await expect
    .poll(async () => (await durations(page)).length, { timeout: 120_000, intervals: [1_000] })
    .toBeGreaterThanOrEqual(WARMUP + SAMPLES);
  const all = await durations(page);
  const kept = all.slice(WARMUP, WARMUP + SAMPLES);
  const sorted = [...kept].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? Number.NaN;
  const warm = all
    .slice(0, WARMUP)
    .map((d) => d.toFixed(1))
    .join(", ");
  return {
    p95,
    text:
      `${label}: ${kept.length} samples at ${rate} (first ${WARMUP} dropped: ${warm} ms), ` +
      `p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms`,
  };
}

test("propagation worker per tick: ISS + visual, then with Starlink", async ({ page, browser }) => {
  test.setTimeout(600_000);
  await page.goto("./?cam=subaru-starcam");
  await expect
    .poll(() => page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null))
    .toBe(true);
  const playAt = async (rate: 1 | 60 | 600) => {
    await page.evaluate(([r, from]) => window.__overhead?.playReplay(r, from), [
      rate,
      START,
    ] as const);
    await expect
      .poll(() => page.evaluate(() => window.__overhead?.clock() ?? null))
      .toMatchObject({ mode: "replay", playing: true, rate });
  };
  await playAt(1);
  const base = await collect(page, "ISS + visual (175 objects)");

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const starlink = page
    .getByRole("region", { name: "Layers" })
    .getByRole("checkbox", { name: "Starlink", exact: true });
  // The switch reads "Also on the map" as soon as it is on: wait for the group's file too, then its parse.
  const loaded = page.waitForResponse("**/data/gp/starlink.json", { timeout: 60_000 });
  await starlink.check();
  await loaded;
  await expect(starlink).toHaveAccessibleDescription("Also on the map", { timeout: 30_000 });
  await page.waitForTimeout(1_000); // the worker parses 11,102 elements
  const starlinkRows = [await collect(page, "with Starlink (11,277 objects)")];
  // [M9] 60× and 600×: each from the start of its ±12 h range (playReplay), so 600× (10 h of sim time per minute)
  // never reaches the edge, where the clock pauses.
  for (const rate of [60, 600] as const) {
    await playAt(rate);
    starlinkRows.push(await collect(page, "with Starlink (11,277 objects)", `${rate}x`));
  }

  // navigator.userAgentData is no use here: the Desktop Chrome descriptor's Windows x64 user agent overrides it.
  console.log(
    `Chromium ${browser.version()} headless, launched from Node ${process.version} ${process.arch}`,
  );
  console.log(`overhead:propagate ${base.text}; budget p95 <= ${BUDGET_P95_MS} ms`);
  for (const row of starlinkRows) {
    console.log(`overhead:propagate ${row.text}; budget p95 <= ${STARLINK_BUDGET_P95_MS} ms`);
  }
  expect(base.p95, "ISS + visual worker p95 (ms)").toBeLessThanOrEqual(BUDGET_P95_MS);
  for (const row of starlinkRows) {
    expect.soft(row.p95, `${row.text}: p95 (ms)`).toBeLessThanOrEqual(STARLINK_BUDGET_P95_MS);
  }
});
