// tests/e2e/sky.spec.ts — the synthetic sky (M2): Horizons-verified body list, the ≥ 2 s recompute rule, twilight
// markers that seek, 600× throughput, and keyboard access to the sky toggles, the limit slider and the markers.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const START = "./?cam=synthetic-maunakea&t=2026-10-10T08:00:00Z";
/** Civil dusk inside 08:00Z ± 12 h (astronomy-engine; Skyfield gives 04:24:59Z). */
const DUSK_MS = Date.parse("2026-10-10T04:24:58.9Z");

// Counts sky passes. The app clears its "overhead:sky" measures at once; an observer still receives each one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __skyPasses: number };
    w.__skyPasses = 0;
    new PerformanceObserver((list) => {
      w.__skyPasses += list.getEntriesByName("overhead:sky").length;
    }).observe({ type: "measure" });
  });
});
const skyPasses = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __skyPasses: number }).__skyPasses);
const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
/** Loads START and waits until the catalogue has arrived and its pass has run. */
async function loadSky(page: Page): Promise<void> {
  await page.goto(START);
  // Wait for the catalogue: its arrival triggers one more pass.
  await expect(page.getByRole("region", { name: /Computed sky/ })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect.poll(() => skyPasses(page)).toBeGreaterThan(0);
  await page.waitForTimeout(500);
}
/** Exact name: M3 adds a "Satellites above the horizon" list, which a substring match would also find. */
const aboveList = (page: Page) =>
  page.getByRole("list", { name: "Above the horizon", exact: true });
/** The URL's t in epoch ms (the URL is written 250 ms after the last discrete change). */
const urlTimeMs = (page: Page): number =>
  Date.parse(new URL(page.url()).searchParams.get("t") ?? "");

test("the body list matches Horizons-verified positions", async ({ page }) => {
  await loadSky(page);
  // Computed: Saturn az 120.4°, alt 57.60°; Uranus az 72.9°, alt 16.00°. Sun, Moon and the rest are below.
  await expect(aboveList(page).getByRole("listitem")).toHaveText([
    "Saturn, az 120°, alt 58°",
    "Uranus, az 73°, alt 16°",
  ]);
});

test("sky recomputes on >= 2 s of sim time", async ({ page }) => {
  await loadSky(page);
  const c0 = await skyPasses(page);
  // Paused: nothing to recompute.
  await page.waitForTimeout(500);
  expect(await skyPasses(page)).toBe(c0);
  await page.keyboard.press("ArrowRight"); // +1 s: below the threshold
  await twoFrames(page);
  await page.waitForTimeout(200);
  expect(await skyPasses(page)).toBe(c0);
  await page.keyboard.press("ArrowRight"); // +2 s in total
  await expect.poll(() => skyPasses(page)).toBe(c0 + 1);
  await page.keyboard.press("Shift+ArrowRight"); // +60 s
  await expect.poll(() => skyPasses(page)).toBe(c0 + 2);
  await page.keyboard.press("ArrowLeft"); // −1 s from the last pass: below the threshold
  await twoFrames(page);
  await page.waitForTimeout(200);
  expect(await skyPasses(page)).toBe(c0 + 2);
  await page.keyboard.press("ArrowLeft"); // −2 s in total
  await expect.poll(() => skyPasses(page)).toBe(c0 + 3);
});

test("the civil dusk marker seeks", async ({ page }) => {
  await loadSky(page);
  const dusk = page.getByRole("button", { name: /Civil dusk/ });
  const dawn = page.getByRole("button", { name: /Civil dawn/ });
  await expect(dusk).toHaveCount(1);
  await expect(dawn).toHaveCount(1);
  await expect(dusk).toHaveAccessibleName("Civil dusk 04:24 UTC (18:24 local)");
  await expect(dawn).toHaveAccessibleName("Civil dawn 15:53 UTC (05:53 local)");

  const c0 = await skyPasses(page);
  await dusk.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => Math.abs(urlTimeMs(page) - DUSK_MS)).toBeLessThanOrEqual(2_000);
  await expect.poll(() => skyPasses(page)).toBe(c0 + 1);
  // Computed: Mercury alt 10.77°, Venus 4.46°, Saturn 8.74°; the Sun is at −6°.
  await expect(aboveList(page).getByRole("listitem")).toHaveText([
    /^Mercury, az \d+°, alt 11°$/,
    /^Venus, az \d+°, alt 4°$/,
    /^Saturn, az \d+°, alt 9°$/,
  ]);
});

test("600× recomputes every frame; 1× only every 2 s of sim time", async ({ page }) => {
  await loadSky(page);
  const timeline = page.getByRole("region", { name: "Timeline" });
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("]");
  await expect(timeline.getByRole("radio", { name: "600×" })).toBeChecked();
  const c0 = await skyPasses(page);
  await page.keyboard.press(" ");
  await page.waitForTimeout(1_000);
  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Play" })).toBeVisible();
  const c1 = await skyPasses(page);
  expect(c1 - c0, "passes in 1 s of play at 600×").toBeGreaterThanOrEqual(20);

  for (let i = 0; i < 3; i += 1) await page.keyboard.press("[");
  await expect(timeline.getByRole("radio", { name: "1×" })).toBeChecked();
  await twoFrames(page);
  const c2 = await skyPasses(page);
  await page.keyboard.press(" ");
  await page.waitForTimeout(3_000);
  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Play" })).toBeVisible();
  await twoFrames(page);
  // A wall-clock 1 Hz timer would give 3.
  const passes = (await skyPasses(page)) - c2;
  expect(passes, "passes in 3 s of play at 1×").toBeGreaterThanOrEqual(1);
  expect(passes, "passes in 3 s of play at 1×").toBeLessThanOrEqual(2);
});

test("catalogue loading and failure states; the grid and bodies still draw", async ({
  page,
  guard,
}) => {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A 200 with an empty array: loadStars rejects it without a failed resource load (which Chromium would log).
  await page.route("**/data/stars.json", async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto(START);
  const region = page.getByRole("region", { name: /Computed sky/ });
  await expect(region.getByRole("status")).toHaveText("Loading star catalogue");
  await expect(region).toHaveAttribute("aria-busy", "true");
  release();
  await expect(region.getByRole("status")).toHaveText("Star catalogue failed to load");
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect(aboveList(page).getByRole("listitem")).toHaveText([
    "Saturn, az 120°, alt 58°",
    "Uranus, az 73°, alt 16°",
  ]);
  await expect.poll(() => skyPasses(page)).toBeGreaterThan(0);
  // The one expected console error: loadStars logs its failure. The guard still fails on any other (or a second).
  const logged = guard.consoleErrors.findIndex((m) =>
    m.startsWith("Star catalogue failed to load"),
  );
  expect(logged, "loadStars logs its failure").toBeGreaterThanOrEqual(0);
  guard.consoleErrors.splice(logged, 1);
});

test("sky toggles, the magnitude limit and the twilight markers work from the keyboard", async ({
  page,
}) => {
  await loadSky(page);
  const credits = page.getByRole("region", { name: "Credits" });
  const bsc5 = credits.getByRole("link", {
    name: "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR",
  });
  const wgsn = credits.getByRole("link", { name: "Star names: IAU WGSN" });
  await expect(bsc5).toBeVisible();
  await expect(wgsn).toBeVisible();

  await page.keyboard.press("l");
  const layers = page.getByRole("region", { name: "Layers" });
  const starsBox = layers.getByRole("checkbox", { name: "Stars" });
  await starsBox.focus();
  await page.keyboard.press(" ");
  await expect(starsBox).not.toBeChecked();
  await expect(bsc5).toHaveCount(0);
  await page.keyboard.press(" ");
  await expect(starsBox).toBeChecked();
  await expect(bsc5).toBeVisible();
  for (const name of ["Sun, Moon and planets", "Alt/az grid"]) {
    const box = layers.getByRole("checkbox", { name });
    await box.focus();
    await page.keyboard.press(" ");
    await expect(box).not.toBeChecked();
    await page.keyboard.press(" ");
    await expect(box).toBeChecked();
  }

  const slider = layers.getByRole("slider", { name: "Star magnitude limit" });
  await expect(slider).toHaveAttribute("aria-valuetext", "V ≤ 4.5 (904 stars)");
  const c0 = await skyPasses(page);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", /^V ≤ 5 \(\d+ stars\)$/);
  // A new star count reprojects at once, without any sim-time change.
  await expect.poll(() => skyPasses(page)).toBe(c0 + 1);

  // Tab order: scrubber, then the markers in time order. Space presses a focused marker (keyboard.ts skips it).
  const timeline = page.getByRole("region", { name: "Timeline" });
  await timeline.getByRole("slider", { name: "Simulation time" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Civil dusk/ })).toBeFocused();
  await page.keyboard.press("Tab");
  const dawn = page.getByRole("button", { name: /Civil dawn/ });
  await expect(dawn).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page.getByTestId("time-utc")).toHaveText(/^2026-10-10T15:53:0\dZ$/);
  await expect(timeline.getByRole("button", { name: "Play" })).toBeVisible();
});
