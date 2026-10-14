// tests/e2e/sky.spec.ts — the sky drawn over the video (M2): Horizons-verified planet positions, the ≥ 2 s recompute
// rule, the star catalogue's loading and failure states, and keyboard access to the sky toggles. [Redesign] The
// computed fisheye is gone: the positions are read from the object card's "More details" on the live Subaru StarCam
// at a fixed time (Date fixed, the stub player playing), and the sky passes are counted on the recorded clip.
import type { Page } from "@playwright/test";
import {
  clipReady,
  creditLink,
  expect,
  expectSimTime,
  focusBody,
  moreDetails,
  objectCard,
  openInView,
  openLayers,
  test,
} from "./fixtures";

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
/** The sky view's region over the recorded clip. */
const skyRegion = (page: Page) => page.getByRole("region", { name: /^Recorded video from / });

/** The recorded clip, paused, once the catalogue has arrived and its pass has run. */
async function loadSky(page: Page): Promise<void> {
  await page.goto("./");
  await clipReady(page, "paused");
  // Wait for the catalogue: its arrival triggers one more pass.
  await expect(skyRegion(page)).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => skyPasses(page)).toBeGreaterThan(0);
  await page.waitForTimeout(500);
}

/** "Direction: az A°, alt B°" from the card's More details, as numbers. */
async function cardDirection(page: Page): Promise<{ az: number; alt: number }> {
  const details = await moreDetails(page);
  const text = await details.getByText(/^Direction: az /).innerText();
  const m = /^Direction: az ([\d.]+)°, alt ([−+-]?[\d.]+)°$/.exec(text.trim());
  if (m === null) throw new Error(`unexpected direction line: ${text}`);
  return { az: Number(m[1]), alt: Number((m[2] ?? "").replace("−", "-")) };
}

test("the planets' positions match Horizons-verified values", async ({ page }) => {
  // 08:00:50Z less the live StarCam's 50 s delay: the sky at 2026-10-10T08:00:00Z.
  await page.clock.setFixedTime(new Date("2026-10-10T08:00:50Z"));
  await page.goto("./?cam=subaru-starcam&sel=planet:Saturn");
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "playing");
  await expectSimTime(page, "2026-10-10T08:00:00Z");
  // Computed (and checked against JPL Horizons): Saturn az 120.4°, alt 57.60°; Uranus az 72.9°, alt 16.00°.
  await expect(objectCard(page)).toContainText("Saturn (planet)");
  await expect(objectCard(page)).toContainText("High in the south-east");
  const saturn = await cardDirection(page);
  expect(Math.abs(saturn.az - 120.4)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(saturn.alt - 57.6)).toBeLessThanOrEqual(0.1);

  // Saturn is above the frame; Uranus is the one body in it, and In view selects it.
  const inView = await openInView(page);
  const bodies = inView.getByRole("list", { name: "Planets, Moon and Sun" }).getByRole("button");
  await expect(bodies).toHaveCount(1);
  await expect(bodies).toHaveAttribute("aria-label", "Uranus (planet), low in the east");
  await bodies.click();
  await expect(objectCard(page)).toContainText("Uranus (planet)");
  const uranus = await cardDirection(page);
  expect(Math.abs(uranus.az - 72.9)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(uranus.alt - 16.0)).toBeLessThanOrEqual(0.1);
});

test.describe("on the recorded clip (paused: reduced motion)", () => {
  test.use({ reducedMotion: "reduce" });

  test("the sky recomputes on >= 2 s of sim time", async ({ page }) => {
    await loadSky(page);
    await focusBody(page);
    const c0 = await skyPasses(page);
    // Paused: nothing to recompute.
    await page.waitForTimeout(500);
    expect(await skyPasses(page)).toBe(c0);
    await page.keyboard.press("ArrowRight"); // +1 s: below the threshold
    await expectSimTime(page, "2026-10-11T08:00:01Z");
    await twoFrames(page);
    await page.waitForTimeout(200);
    expect(await skyPasses(page)).toBe(c0);
    await page.keyboard.press("ArrowRight"); // +2 s in total
    await expect.poll(() => skyPasses(page)).toBe(c0 + 1);
    await page.keyboard.press("ArrowRight"); // 08:00:03: 1 s after the last pass
    await expectSimTime(page, "2026-10-11T08:00:03Z");
    await twoFrames(page);
    await page.waitForTimeout(200);
    expect(await skyPasses(page)).toBe(c0 + 1);
    await page.keyboard.press("ArrowRight"); // 08:00:04: 2 s after it
    await expect.poll(() => skyPasses(page)).toBe(c0 + 2);
    await page.keyboard.press("ArrowLeft"); // −1 s from the last pass: below the threshold
    await expectSimTime(page, "2026-10-11T08:00:03Z");
    await twoFrames(page);
    await page.waitForTimeout(200);
    expect(await skyPasses(page)).toBe(c0 + 2);
    await page.keyboard.press("ArrowLeft"); // −2 s in total
    await expect.poll(() => skyPasses(page)).toBe(c0 + 3);
  });

  test("playing at 1× recomputes only every 2 s of sim time, not every frame", async ({ page }) => {
    await loadSky(page);
    await focusBody(page);
    await twoFrames(page);
    const c0 = await skyPasses(page);
    // The whole 7 s clip, from 0:00 to its end: counted in sim time, whatever the wall clock does meanwhile.
    await page.keyboard.press(" ");
    await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "ended", {
      timeout: 20_000,
    });
    await expectSimTime(page, "2026-10-11T08:00:07Z");
    await twoFrames(page);
    // One pass at each 2 s of sim time: 2, 4 and 6 s (a wall-clock 1 Hz timer would give 7, every frame about 420).
    expect((await skyPasses(page)) - c0, "passes over the 7 s clip at 1×").toBe(3);
  });

  test("catalogue loading and failure states; the planets still draw", async ({ page, guard }) => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A 200 with an empty array: loadStars rejects it without a failed resource load (which Chromium would log).
    await page.route("**/data/stars.json", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("./");
    const region = skyRegion(page);
    await expect(region.getByRole("status").first()).toHaveText("Loading stars…");
    await expect(region).toHaveAttribute("aria-busy", "true");
    release();
    await expect(region.getByRole("status").first()).toHaveText("The stars failed to load");
    await expect(region).toHaveAttribute("aria-busy", "false");
    await clipReady(page, "paused");
    const inView = await openInView(page);
    await expect(
      inView.getByRole("list", { name: "Planets, Moon and Sun" }).getByRole("button"),
    ).toHaveAttribute("aria-label", "Uranus (planet), low in the east");
    await expect.poll(() => skyPasses(page)).toBeGreaterThan(0);
    // The one expected console error: loadStars logs its failure. The guard still fails on any other (or a second).
    const logged = guard.consoleErrors.findIndex((m) =>
      m.startsWith("Star catalogue failed to load"),
    );
    expect(logged, "loadStars logs its failure").toBeGreaterThanOrEqual(0);
    guard.consoleErrors.splice(logged, 1);
  });

  test("the sky toggles work from the keyboard, and the star credits follow the Stars toggle", async ({
    page,
  }) => {
    await loadSky(page);
    const bsc5 = creditLink(
      page,
      "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR",
    );
    const wgsn = creditLink(page, "Star names: IAU WGSN");
    await expect(bsc5).toHaveCount(1); // in the Credits popover, closed
    await expect(wgsn).toHaveCount(1);

    const layers = await openLayers(page);
    const starsBox = layers.getByRole("checkbox", { name: "Stars", exact: true });
    await starsBox.focus();
    await page.keyboard.press(" ");
    await expect(starsBox).not.toBeChecked();
    await expect(bsc5).toHaveCount(0);
    await page.keyboard.press(" ");
    await expect(starsBox).toBeChecked();
    await expect(bsc5).toHaveCount(1);
    for (const [name, on] of [
      ["Planets and Moon", true],
      ["Grid lines", false],
      ["Horizon line", true],
    ] as const) {
      const box = layers.getByRole("checkbox", { name, exact: true });
      await box.focus();
      await page.keyboard.press(" ");
      await expect(box).toBeChecked({ checked: !on });
      await page.keyboard.press(" ");
      await expect(box).toBeChecked({ checked: on });
    }
  });
});
