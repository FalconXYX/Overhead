// tests/perf/propagation.perf.ts — propagation worker cost per sample (M3 step 16.3; README section 9). Run by hand with
// `npm run perf`, never in CI. Budget: ISS + visual p95 ≤ 4 ms. Starlink is recorded, not gated (M9 gates it).
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, test } from "../e2e/fixtures";

const SAMPLES = 600; // 60 s at 1× (D = 100 ms)
const WARMUP = 5; // JIT warm-up: the first replies took 1.0–3.1 ms
const BUDGET_P95_MS = 4;

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

/** Waits for WARMUP + SAMPLES replies, drops the warm-up, and returns p50/p95/max of the rest. */
async function collect(page: Page, label: string): Promise<{ p95: number; text: string }> {
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
      `${label}: ${kept.length} samples at 1x (first ${WARMUP} dropped: ${warm} ms), ` +
      `p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms`,
  };
}

test("propagation worker per tick: ISS + visual, then with Starlink", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await page.goto("./?t=2026-10-11T15:09:50Z");
  await expect
    .poll(() => page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null))
    .toBe(true);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("radio", { name: "1×" })).toBeChecked();
  await page.keyboard.press(" "); // play at 1×; from here on only the mouse is used, so Space never hits a control
  await expect(timeline.getByRole("button", { name: "Pause" })).toBeVisible();
  const base = await collect(page, "ISS + visual (175 objects)");

  await page.getByRole("button", { name: "Layers" }).click();
  const starlink = page.getByRole("checkbox", { name: "Starlink (about 11,100; loads 4.7 MB)" });
  await starlink.check();
  await expect(starlink).toHaveAccessibleDescription(/^11,102 objects/, { timeout: 30_000 });
  const withStarlink = await collect(page, "with Starlink (11,277 objects)");

  // navigator.userAgentData is no use here: the Desktop Chrome descriptor's Windows x64 user agent overrides it.
  console.log(
    `Chromium ${browser.version()} headless, launched from Node ${process.version} ${process.arch}`,
  );
  console.log(`overhead:propagate ${base.text}; budget p95 <= ${BUDGET_P95_MS} ms`);
  console.log(`overhead:propagate ${withStarlink.text}; recorded, not gated until M9`);
  expect(base.p95, "ISS + visual worker p95 (ms)").toBeLessThanOrEqual(BUDGET_P95_MS);
});
