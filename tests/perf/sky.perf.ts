// tests/perf/sky.perf.ts — sky pass cost (M2 step 11; README section 9). Run by hand with `npm run perf`, never in CI.
// Budget: overhead:sky p95 ≤ 2 ms, first pass of the window dropped. [Redesign] The computed fisheye and its V ≤ 6.5
// magnitude slider are gone: this measures the pass on the live Subaru StarCam's rectilinear frame with the alignment
// drawer open (its largest star set, V ≤ 4: VIDEO_STAR_MAG_LIMIT is 2 otherwise), at 600× from the perf test hook
// (no control offers 600× any more), so a pass runs on every frame. A new baseline: the M2 figure was for 8,404 stars
// on the fisheye.
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, test } from "../e2e/fixtures";

const COLLECT_MS = 10_000;
const BUDGET_P95_MS = 2;
/** The M2 instant: 2026-10-10T08:00:00Z, 22:00 HST. */
const FROM_MS = Date.parse("2026-10-10T08:00:00Z");

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

test("overhead:sky p95 on the Subaru StarCam's frame, aligning (V ≤ 4), at 600×", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("./?cam=subaru-starcam");
  await expect(page.getByRole("region", { name: /^Live video from / })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  // C opens "Camera alignment (advanced)": stars to V ≤ 4, the planets drawn.
  await page.getByRole("heading", { name: "Overhead", level: 1 }).click();
  await page.keyboard.press("c");
  await expect(page.getByRole("region", { name: "Camera alignment (advanced)" })).toBeVisible();

  await page.evaluate((from) => window.__overhead?.playReplay(600, from), FROM_MS);
  await expect
    .poll(() => page.evaluate(() => window.__overhead?.clock() ?? null))
    .toMatchObject({ mode: "replay", playing: true, rate: 600 });
  // Start the window now: the drawer's and the seek's own passes are not part of it.
  await page.evaluate(() => {
    (window as unknown as { __skyDurations: number[] }).__skyDurations = [];
  });
  await page.waitForTimeout(COLLECT_MS);
  const durations = await page.evaluate(
    () => (window as unknown as { __skyDurations: number[] }).__skyDurations,
  );

  const kept = durations.slice(1); // drop the first pass of the window
  const sorted = [...kept].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? Number.NaN;
  console.log(
    `overhead:sky on subaru-starcam, V <= 4 (aligning), 600x, ${COLLECT_MS / 1000} s: ${kept.length} passes ` +
      `(first dropped: ${(durations[0] ?? Number.NaN).toFixed(2)} ms), p50 ${p50.toFixed(2)} ms, ` +
      `p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms; budget p95 <= ${BUDGET_P95_MS} ms`,
  );
  expect(kept.length, "passes collected").toBeGreaterThan(0);
  expect(p95, "overhead:sky p95 (ms)").toBeLessThanOrEqual(BUDGET_P95_MS);
});
