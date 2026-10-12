// tests/perf/commits.perf.ts — React commits while playing with no input (M9 step 5; README section 9). Run by hand,
// never in CI, on the development build (React's Profiler counts nothing in a production build, gotcha 3):
//   npm run build:dev && PERF_OUTDIR=dist-dev npm run perf -- commits
// Gate: 31–41 commits in 10 s at 60× (≤ 4 per second from the shared 4 Hz ticker, plus one window edge; more than
// 30 proves the Profiler is live).
import { mkdirSync, writeFileSync } from "node:fs";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, test } from "../e2e/fixtures";

const SETTLE_MS = 2_000;
const WINDOW_MS = 10_000;
const MIN_COMMITS = 31;
const MAX_COMMITS = 41;

test("React commits while playing at 60x with no input", async ({ page }) => {
  await page.goto("./?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z");
  await expect
    .poll(() => page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null), {
      timeout: 30_000,
    })
    .toBe(true);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("radio", { name: "60×" })).toBeChecked();
  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Pause" })).toBeVisible();
  // No input from here on: the mouse stays where it is and no key is pressed.
  await page.waitForTimeout(SETTLE_MS);
  const before = await page.evaluate(() => window.__overhead?.commits() ?? Number.NaN);
  await page.waitForTimeout(WINDOW_MS);
  const after = await page.evaluate(() => window.__overhead?.commits() ?? Number.NaN);
  const commits = after - before;
  const result = { commits, perSecond: commits / (WINDOW_MS / 1000), before, after };
  mkdirSync("test-results/perf", { recursive: true });
  writeFileSync("test-results/perf/commits.json", JSON.stringify(result, null, 2));
  console.log(
    `React commits while playing at 60x: ${commits} in ${WINDOW_MS / 1000} s ` +
      `(${result.perSecond.toFixed(1)}/s); gate ${MIN_COMMITS}–${MAX_COMMITS}`,
  );
  expect(
    commits,
    "0 commits: this is a production build; serve dist-dev (PERF_OUTDIR=dist-dev)",
  ).toBeGreaterThanOrEqual(MIN_COMMITS);
  expect(commits).toBeLessThanOrEqual(MAX_COMMITS);
});
