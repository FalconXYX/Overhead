// tests/e2e/incoming.spec.ts — the incoming chip and the footprint (M8 section 5, end-to-end). [Redesign] On the
// recorded clip, served as starting 40 s before the ISS enters the Subaru StarCam's frame (paused: reduced motion): the
// chip in plain words ("ISS appears in 40 s"), its countdown, selecting from it, and the footprint's height sources.
// Data comes from the committed snapshot through the fixtures' data/gp route. The pause at 60× and 600× has no user
// path any more (those rates are gone); its rule is unit-tested.
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import {
  clipReady,
  clipStartingAt,
  expect,
  focusBody,
  moreDetails,
  objectCard,
  openLayers,
  test,
} from "./fixtures";

const T_ISO = "2026-10-11T15:09:13Z";
const T = Date.parse(T_ISO);
const DOCKED_WITH_ISS = [36086, 49044, 68837, 100057, 100712, 100882] as const;

test.use({ reducedMotion: "reduce" });

const incoming = (page: Page) => page.evaluate(() => window.__overhead?.incoming() ?? null);
const footprint = (page: Page) => page.evaluate(() => window.__overhead?.footprint() ?? null);
const chip = (page: Page) => page.getByTestId("incoming-chip");
/** The chip's buttons: [accessible name, object id], in order. */
const chipButtons = (page: Page) =>
  chip(page)
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((b) => [b.getAttribute("aria-label") ?? "", b.getAttribute("data-object-id")]),
    );

async function openClip(page: Page, query = ""): Promise<void> {
  await clipStartingAt(page, T_ISO);
  await page.goto(`./${query}`);
  await clipReady(page, "paused");
}

test("the chip says who enters the camera view and when, counts down, and selects", async ({
  page,
}) => {
  await openClip(page);
  await expect.poll(async () => (await incoming(page))?.timeMs).toBe(T);
  // Both groups loaded: the entries settle on the e2e values.
  await expect
    .poll(async () => (await incoming(page))?.entries)
    .toEqual([{ noradId: 25544, etaSec: 40 }]);
  await expect.poll(() => chipButtons(page)).toEqual([["ISS appears in 40 seconds", "sat:25544"]]);
  await expect(chip(page).getByRole("button").first()).toHaveText("ISS appears in 40 s");
  const ids = (await chipButtons(page)).map(([, id]) => id).join("\n");
  for (const id of DOCKED_WITH_ISS) expect(ids).not.toContain(`sat:${id}`);
  await expect(chip(page).locator('[aria-live="polite"]')).toHaveText(
    "International Space Station will appear in the camera view in about 40 seconds.",
  );

  // Five seconds on: a new reply, a smaller count.
  await focusBody(page);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await incoming(page))?.timeMs).toBe(T + 5_000);
  const later = (await incoming(page))?.entries.find((e) => e.noradId === 25544)?.etaSec ?? 0;
  expect(later).toBeGreaterThan(30);
  expect(later).toBeLessThanOrEqual(35);
  await expect(chip(page).getByRole("button").first()).toHaveText(`ISS appears in ${later} s`);

  await chip(page)
    .getByRole("button", { name: /^ISS appears in/ })
    .click();
  await expect(chip(page).getByRole("button", { name: /^ISS appears in/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(objectCard(page)).toContainText("International Space Station");
  await expect(await moreDetails(page)).toContainText(`Comes into the camera view in ${later} s`);
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);
});

test("the chip is empty with both satellite switches off", async ({ page }) => {
  await openClip(page);
  await expect.poll(() => chipButtons(page)).toHaveLength(1);
  const layers = await openLayers(page);
  await layers.getByRole("checkbox", { name: "Satellites", exact: true }).uncheck();
  await expect(chip(page).getByRole("button")).toHaveCount(0);
  await layers.getByRole("checkbox", { name: "Satellites", exact: true }).check();
  await expect.poll(() => chipButtons(page)).toHaveLength(1);
});

test("the footprint follows the selected satellite, a preset, or 420 km", async ({ page }) => {
  await openClip(page, "?sel=sat:25544");
  const layers = await openLayers(page);
  await layers.getByRole("checkbox", { name: "Camera view at orbit height" }).check();
  // The ISS's height above the ellipsoid at 15:09:13Z is about 423 km.
  await expect
    .poll(async () => {
      const f = await footprint(page);
      return f === null ? null : { source: f.source, drawn: f.pairCount > 0 };
    })
    .toEqual({ source: "selected", drawn: true });
  const followed = await footprint(page);
  expect(Math.abs((followed?.heightKm ?? Number.NaN) - 423)).toBeLessThanOrEqual(2);
  const select = layers.getByRole("combobox", { name: "Orbit height for the camera view" });
  await expect(select.locator("option").first()).toHaveText(/^Selected satellite \(42\d km\)$/);
  await expect(layers).toContainText("Exact only for satellites at this height");

  await select.selectOption({ label: "Starlink height (480 km)" });
  await expect
    .poll(async () => {
      const f = await footprint(page);
      return f === null ? null : { source: f.source, heightKm: f.heightKm };
    })
    .toEqual({ source: "preset", heightKm: 480 });

  await select.selectOption({ value: "selected" });
  // keyboard.ts ignores keys typed into inputs and selects, and Esc in the popover closes it: blur first, so Esc
  // clears the selection.
  await focusBody(page);
  await page.keyboard.press("Escape");
  await expect(objectCard(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const f = await footprint(page);
      return f === null ? null : { source: f.source, heightKm: f.heightKm };
    })
    .toEqual({ source: "fallback", heightKm: 420 });
  await openLayers(page);
  await expect(select.locator("option").first()).toHaveText("Selected satellite (none: 420 km)");
  await page.keyboard.press("Escape");
  await page
    .getByRole("region", { name: "Ground map" })
    .screenshot({ path: test.info().outputPath("footprint-subaru.png") });
});
