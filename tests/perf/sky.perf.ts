// tests/perf/sky.perf.ts — sky pass cost at limit 6.5 and 600× (M2 step 11; README section 9). Run by hand with
// `npm run perf`, never in CI. Budget: overhead:sky p95 ≤ 2 ms, first pass of the window dropped.
import { expect, test } from "../e2e/fixtures";

const COLLECT_MS = 10_000;
const BUDGET_P95_MS = 2;

// Collects every "overhead:sky" duration. The app clears its measures at once; an observer still receives each one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __skyDurations: number[] };
    w.__skyDurations = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntriesByName("overhead:sky"))
        w.__skyDurations.push(entry.duration);
    }).observe({ type: "measure" });
  });
});

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

test("overhead:sky p95 at limit 6.5 and 600×", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("./?t=2026-10-10T08:00:00Z");
  await expect(page.getByRole("region", { name: /Computed sky/ })).toHaveAttribute(
    "aria-busy",
    "false",
  );

  await page.keyboard.press("l");
  const slider = page.getByRole("slider", { name: "Star magnitude limit" });
  await slider.fill("6.5");
  await expect(slider).toHaveAttribute("aria-valuetext", "V ≤ 6.5 (8404 stars)");
  // While the slider has focus, ] and Space go to it, not to the clock.
  await slider.blur();

  for (let i = 0; i < 3; i += 1) await page.keyboard.press("]");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("radio", { name: "600×" })).toBeChecked();
  // Start the window at play: the limit change's own pass is not part of it.
  await page.evaluate(() => {
    (window as unknown as { __skyDurations: number[] }).__skyDurations = [];
  });
  await page.keyboard.press(" ");
  await page.waitForTimeout(COLLECT_MS);
  await page.keyboard.press(" ");
  const durations = await page.evaluate(
    () => (window as unknown as { __skyDurations: number[] }).__skyDurations,
  );

  const kept = durations.slice(1); // drop the first pass of the window
  const sorted = [...kept].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? Number.NaN;
  console.log(
    `overhead:sky at V <= 6.5, 600x, ${COLLECT_MS / 1000} s: ${kept.length} passes (first dropped: ` +
      `${(durations[0] ?? Number.NaN).toFixed(2)} ms), p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, ` +
      `max ${max.toFixed(2)} ms; budget p95 <= ${BUDGET_P95_MS} ms`,
  );
  expect(kept.length, "passes collected").toBeGreaterThan(0);
  expect(p95, "overhead:sky p95 (ms)").toBeLessThanOrEqual(BUDGET_P95_MS);
});
