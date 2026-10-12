// tests/perf/incoming.perf.ts — the worker's incoming pass with Starlink (M8 section 5; README section 9). Run by hand
// with `npm run perf`, never in CI. Budget: computeMs p95 ≤ 20 ms over 60 consecutive replies (acceptance 5; measured
// 9.6 ms in Chromium 156 on an M2). Re-run tests/perf/propagation.perf.ts on the same branch afterwards (M3's gate).
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, test } from "../e2e/fixtures";

const REPLIES = 60;
const BUDGET_P95_MS = 20;

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

const latest = (page: Page) =>
  page.evaluate(() => {
    const reply = window.__overhead?.incoming() ?? null;
    return reply === null ? null : { timeMs: reply.timeMs, computeMs: reply.computeMs };
  });

test("incoming pass with Starlink on synthetic-maunakea, 1× from 06:00Z", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.goto("./?cam=synthetic-maunakea&t=2026-10-11T06:00:00Z");
  await expect
    .poll(() => page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null))
    .toBe(true);
  await page.getByRole("button", { name: "Layers" }).click();
  const starlink = page.getByRole("checkbox", { name: "Starlink (about 11,100; loads 4.7 MB)" });
  await starlink.check();
  await expect(starlink).toHaveAccessibleDescription(/^11,102 objects/, { timeout: 30_000 });
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("radio", { name: "1×" })).toBeChecked();
  await timeline.getByRole("button", { name: "Play" }).click();

  // One computeMs per new timeMs: the hook keeps only the latest reply, polled faster than the 1 Hz requests.
  const byTime = new Map<number, number>();
  await expect
    .poll(
      async () => {
        const reply = await latest(page);
        if (reply !== null && !byTime.has(reply.timeMs)) byTime.set(reply.timeMs, reply.computeMs);
        return byTime.size;
      },
      { timeout: 180_000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(REPLIES);
  const kept = [...byTime.values()].slice(0, REPLIES);
  const sorted = [...kept].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? Number.NaN;
  console.log(
    `Chromium ${browser.version()} headless, launched from Node ${process.version} ${process.arch}`,
  );
  console.log(
    `incoming computeMs with Starlink: ${kept.length} replies at 1x, p50 ${p50.toFixed(2)} ms, ` +
      `p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms; budget p95 <= ${BUDGET_P95_MS} ms`,
  );
  expect(p95, "incoming pass p95 (ms)").toBeLessThanOrEqual(BUDGET_P95_MS);
});
