// tests/e2e/ground-map.spec.ts — credits, the focused map's keys, the default camera and live, URL fallbacks, and the
// map's name. [Redesign] The site opens on the recorded ISS pass (paused here: reduced motion); a live camera has no t.
import type {} from "../../src/app/testHooks"; // window.__overhead
import {
  CLIP_ID,
  CLIP_START_ISO,
  cameraRadio,
  clipReady,
  creditsList,
  expect,
  expectSimTime,
  openLayers,
  openPopover,
  test,
} from "./fixtures";

const GIBS_TEXT =
  "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).";

test.use({ reducedMotion: "reduce" });

test("credits: the camera's, the imagery's and the map's, following the layers", async ({
  page,
}) => {
  await page.goto("./");
  await clipReady(page, "paused");
  await openPopover(page, "Credits", "Credits");
  const credits = creditsList(page); // also while Layers, opened below, closes it
  await expect(credits).toContainText(
    "Test pattern generated for the Overhead e2e tests (CC0-1.0) — Non-commercial use only",
  );
  await expect(credits).toContainText(GIBS_TEXT);
  await expect(credits).toContainText("Imagery: NOAA-20 / VIIRS, 2026-10-10");
  await expect(
    credits.getByRole("link", { name: "© OpenStreetMap contributors, Natural Earth" }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect(credits.getByRole("link", { name: "Orbital elements: CelesTrak" })).toBeVisible();
  await expect(credits).not.toContainText("GOES-West");

  const layers = await openLayers(page);
  await layers.getByRole("checkbox", { name: "Cloud imagery (10 min)" }).check();
  await expect(credits).toContainText("Imagery: GOES-West/ABI, Band 13 Clean Infrared");
  for (const name of ["Satellites", "Satellite paths"]) {
    await layers.getByRole("checkbox", { name, exact: true }).uncheck();
  }
  await expect(credits).not.toContainText("CelesTrak");
  await layers.getByRole("checkbox", { name: "Satellites", exact: true }).check();
  await expect(credits).toContainText("CelesTrak");
});

test("arrow keys pan a focused map and leave the clock alone", async ({ page }) => {
  await page.goto("./");
  await clipReady(page, "paused");
  await expect(page.locator('[data-map="ground"] .ol-viewport')).toHaveCount(1);
  // On document, in the bubble phase: after OpenLayers' listener on the map target, before the app's window listener.
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: string[] };
    w.__prevented = [];
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Shift") w.__prevented.push(`${e.key} ${e.defaultPrevented}`);
    });
  });
  const prevented = () =>
    page.evaluate(() => (window as unknown as { __prevented: string[] }).__prevented);
  const map = page.getByRole("application", { name: /^Ground map around the camera site/ });
  const controls = page.getByRole("region", { name: "Video controls" });
  await map.focus();
  await page.keyboard.press("ArrowRight"); // KeyboardPan pans and prevents it
  // KeyboardPan ignores modifier chords, so these reach window unprevented: the app must still leave them alone.
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press(" ");
  await page.keyboard.press("]");
  await page.keyboard.press("l");
  await page.waitForTimeout(300); // the 4 Hz readout would have caught up
  await expectSimTime(page, CLIP_START_ISO);
  await expect(controls.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__overhead?.clock().rate)).toBe(1);
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const onMap = ["ArrowRight true", "ArrowRight false", "  false", "] false", "l false"];
  expect(await prevented()).toEqual(onMap);

  await map.blur();
  await page.keyboard.press("ArrowRight");
  await expectSimTime(page, "2026-10-11T08:00:01Z");
  expect(await prevented()).toEqual([...onMap, "ArrowRight false"]);
});

test("the site opens on the recorded ISS pass; a live camera ignores ?t= and never writes it", async ({
  page,
}) => {
  await page.goto("./");
  await clipReady(page, "paused");
  await expect(cameraRadio(page, "ISS pass (recorded)")).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`\\?cam=${CLIP_ID}&t=${CLIP_START_ISO}$`));
  // "Watch live" switches to the live Subaru StarCam: live, and no t in the URL.
  await page.getByRole("button", { name: "Watch live" }).click();
  await expect(cameraRadio(page, "Subaru live")).toBeChecked();
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  await expect(page).toHaveURL(/\?cam=subaru-starcam$/);

  // A ?t= on a live camera is ignored (a console.warn is allowed), and the URL loses it.
  await page.goto("./?cam=subaru-starcam&t=2026-10-10T03:30:00Z");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  await expect(page).toHaveURL(/\?cam=subaru-starcam$/);
  const shown = Date.parse((await page.getByTestId("time-local").getAttribute("datetime")) ?? "");
  expect(Math.abs(shown - Date.now())).toBeLessThan(120_000); // now, less the stream delay
});

test("URL fallbacks: an unknown or retired camera, and a zone-less t, open the recorded pass", async ({
  page,
}) => {
  // Unknown, and the retired computed sky (a console.warn each is allowed).
  for (const cam of ["nope", "synthetic-maunakea", "cfht-nanaao"]) {
    await page.goto(`./?cam=${cam}&t=2026-10-11T08:00:03Z`);
    await clipReady(page, "paused");
    await expect(cameraRadio(page, "ISS pass (recorded)")).toBeChecked();
    await expect(page).toHaveURL(new RegExp(`\\?cam=${CLIP_ID}&t=2026-10-11T08:00:0[03]Z$`));
  }
  // A ?t= inside the clip is kept when ?cam= names the clip, or nothing.
  await page.goto("./?t=2026-10-11T08:00:03Z");
  await clipReady(page, "paused");
  await expectSimTime(page, "2026-10-11T08:00:03Z");
  // A zone-less t is rejected, never guessed: the clip opens at its opening time.
  await page.goto("./?t=2026-10-11T08:00:03");
  await clipReady(page, "paused");
  await expectSimTime(page, CLIP_START_ISO);
  await expect(page).toHaveURL(new RegExp(`\\?cam=${CLIP_ID}&t=${CLIP_START_ISO}$`));
});

test("map container is named", async ({ page }) => {
  await page.goto("./");
  await expect(
    page.getByRole("application", {
      name: "Ground map around the camera site: Subaru StarCam: ISS pass, 2026-10-11 (recorded)",
    }),
  ).toBeVisible();
});
