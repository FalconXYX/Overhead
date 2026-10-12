// tests/e2e/incoming.spec.ts — the incoming chip and the footprint (M8 section 5, end-to-end): the chip's entries on the
// synthetic fisheye at 15:05:07Z, a step forward, selecting from the chip, the pause at 60×, and the footprint's height
// sources. Data comes from the committed snapshot through the fixtures' data/gp route. With M6's mastM 33 the terrain
// route gives synthetic-maunakea a profile ≤ −0.49°, which changes none of the values below.
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, test } from "./fixtures";

const T_ISO = "2026-10-11T15:05:07Z";
const T = Date.parse(T_ISO);
const START = `./?cam=synthetic-maunakea&t=${T_ISO}`;
const DOCKED_WITH_ISS = [36086, 49044, 68837, 100057, 100712, 100882] as const;

const incoming = (page: Page) => page.evaluate(() => window.__overhead?.incoming() ?? null);
const footprint = (page: Page) => page.evaluate(() => window.__overhead?.footprint() ?? null);
const chip = (page: Page) => page.getByTestId("incoming-chip");
/** The accessible names of the chip's buttons, in order. */
const buttonNames = (page: Page) =>
  chip(page)
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? ""));

test("the chip lists who enters the view, counts from the reply, selects, and pauses at 60×", async ({
  page,
}) => {
  await page.goto(START);
  await expect.poll(async () => (await incoming(page))?.timeMs).toBe(T);
  // Both groups loaded: the entries settle on the e2e values.
  await expect
    .poll(async () => (await incoming(page))?.entries)
    .toEqual([
      { noradId: 25544, etaSec: 35 },
      { noradId: 19046, etaSec: 55 },
    ]);
  await expect
    .poll(() => buttonNames(page))
    .toEqual([
      "ISS (ZARYA), NORAD 25544, enters the view within 35 seconds",
      "SL-3 R/B, NORAD 19046, enters the view within 55 seconds",
    ]);
  await expect(chip(page).getByRole("button").first()).toHaveText("ISS (ZARYA) · 35 s");
  const names = (await buttonNames(page)).join("\n");
  for (const id of DOCKED_WITH_ISS) expect(names).not.toContain(`NORAD ${id},`);
  await expect(chip(page).locator('[aria-live="polite"]')).toContainText("ISS (ZARYA)");

  // One minute on: the ISS is in the view now, SL-3 R/B 10114 is next.
  await page.getByRole("button", { name: "Forward 1 minute" }).click();
  await expect.poll(async () => (await incoming(page))?.timeMs).toBe(T + 60_000);
  await expect
    .poll(() => buttonNames(page))
    .toEqual(["SL-3 R/B, NORAD 10114, enters the view within 50 seconds"]);
  await chip(page)
    .getByRole("button", { name: /NORAD 10114/ })
    .click();
  await expect(chip(page).getByRole("button", { name: /NORAD 10114/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText(
    "Enters the view within 50 s",
  );
  await expect(page).toHaveURL(/[?&]sel=sat:10114(&|$)/);

  // 60× while playing: the look-ahead would last a second of wall time.
  const timeline = page.getByRole("region", { name: "Timeline" });
  await timeline.getByRole("radio", { name: "60×" }).check();
  await timeline.getByRole("button", { name: "Play" }).click();
  await expect(chip(page)).toContainText("Incoming alerts pause at 60× and 600×");
  await expect.poll(() => incoming(page)).toBeNull();
  await timeline.getByRole("button", { name: "Pause" }).click();
});

test("the footprint follows the selected satellite, a preset, or 420 km", async ({ page }) => {
  await page.goto(`${START}&sel=sat:25544`);
  await page.getByRole("button", { name: "Layers" }).click();
  await page.getByRole("checkbox", { name: "Camera view at orbit height" }).check();
  // The ISS's geodetic height at 15:05:07Z is 422.400 km.
  await expect
    .poll(async () => {
      const f = await footprint(page);
      return f === null ? null : { source: f.source, pairCount: f.pairCount };
    })
    .toEqual({ source: "selected", pairCount: 64 });
  const followed = await footprint(page);
  expect(Math.abs((followed?.heightKm ?? Number.NaN) - 422.4)).toBeLessThanOrEqual(0.5);
  const select = page.getByRole("combobox", { name: "Orbit height for the camera view" });
  await expect(select.locator("option").first()).toContainText("422 km");

  await select.selectOption({ label: "Starlink shell (480 km)" });
  await expect
    .poll(() => footprint(page))
    .toEqual({ source: "preset", heightKm: 480, pairCount: 64 });

  await select.selectOption({ value: "selected" });
  // keyboard.ts ignores keys typed into inputs and selects: blur whatever has focus, so Esc clears the selection.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect
    .poll(() => footprint(page))
    .toEqual({ source: "fallback", heightKm: 420, pairCount: 64 });
  await expect(select.locator("option").first()).toHaveText("Selected satellite (none: 420 km)");
  await page
    .getByRole("region", { name: "Ground map" })
    .screenshot({ path: test.info().outputPath("footprint-synthetic-maunakea.png") });
});
