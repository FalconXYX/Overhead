// tests/e2e/ground-map.spec.ts — credits, timeline controls and keys, the focused map, live start, URL fallbacks.
import { expect, test } from "./fixtures";

const START = "./?t=2026-10-10T03:30:00Z";
const GIBS_TEXT =
  "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).";

test("credits follow the layers", async ({ page }) => {
  await page.goto(START);
  const credits = page.getByRole("region", { name: "Credits" });
  await expect(credits).toContainText("Computed sky (no camera image)");
  await expect(credits).toContainText(GIBS_TEXT);
  await expect(credits).toContainText("Imagery: NOAA-20 / VIIRS, 2026-10-08");
  await expect(
    credits.getByRole("link", { name: "© OpenStreetMap contributors, Natural Earth" }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");

  await page.keyboard.press("l");
  const layers = page.getByRole("region", { name: "Layers" });
  await layers.getByRole("checkbox", { name: "Coastlines and place labels" }).uncheck();
  await expect(credits).not.toContainText("OpenStreetMap");
  await expect(credits).toContainText("GIBS");
  await layers.getByRole("checkbox", { name: /^True colour/ }).uncheck();
  await expect(credits).not.toContainText("GIBS");
  await expect(credits).not.toContainText("Imagery:");
  await expect(credits).toContainText("Computed sky (no camera image)");
});

test("timeline controls and keys", async ({ page }) => {
  await page.goto(START);
  const timeline = page.getByRole("region", { name: "Timeline" });
  const utc = page.getByTestId("time-utc");
  await expect(page.getByTestId("time-mode")).toHaveText("Replay");

  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Play" })).toBeVisible();

  await page.keyboard.press("]");
  await expect(timeline.getByRole("radio", { name: "10×" })).toBeChecked();

  // Space on a focused button presses it instead of toggling play.
  const forward = timeline.getByRole("button", { name: "Forward 1 minute" });
  await forward.focus();
  await page.keyboard.press(" ");
  await expect(utc).toHaveText("2026-10-10T03:31:00Z");
  await expect(timeline.getByRole("button", { name: "Play" })).toBeVisible();
  await forward.click();
  await expect(utc).toHaveText("2026-10-10T03:32:00Z");

  const slider = timeline.getByRole("slider", { name: "Simulation time" });
  await slider.fill("-3600");
  await expect(utc).toHaveText("2026-10-10T02:30:00Z");
  await slider.focus();
  for (let i = 0; i < 20; i += 1) await page.keyboard.press("ArrowRight");
  await expect(utc).toHaveText("2026-10-10T02:30:20Z");
});

test("arrow keys pan a focused map and leave the clock alone", async ({ page }) => {
  await page.goto(START);
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
  const timeline = page.getByRole("region", { name: "Timeline" });
  const utc = page.getByTestId("time-utc");
  await map.focus();
  await page.keyboard.press("ArrowRight"); // KeyboardPan pans and prevents it
  // KeyboardPan ignores modifier chords, so these reach window unprevented: the app must still leave them alone.
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press(" ");
  await page.keyboard.press("]");
  await page.keyboard.press("l");
  await page.waitForTimeout(300); // the 4 Hz readout would have caught up
  await expect(utc).toHaveText("2026-10-10T03:30:00Z");
  await expect(timeline.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(timeline.getByRole("radio", { name: "1×" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Layers" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const onMap = ["ArrowRight true", "ArrowRight false", "  false", "] false", "l false"];
  expect(await prevented()).toEqual(onMap);

  await map.blur();
  await page.keyboard.press("ArrowRight");
  await expect(utc).toHaveText("2026-10-10T03:30:01Z");
  expect(await prevented()).toEqual([...onMap, "ArrowRight false"]);
});

test("slider keys step from the clock, not from a thumb the 4 Hz render has not moved yet", async ({
  page,
}) => {
  await page.goto(START);
  const timeline = page.getByRole("region", { name: "Timeline" });
  const utc = page.getByTestId("time-utc");
  const slider = timeline.getByRole("slider", { name: "Simulation time" });
  await timeline.getByRole("button", { name: "Forward 1 minute" }).focus();
  await page.keyboard.press(" ");
  await page.keyboard.press("Tab"); // straight onto the slider, before the next 4 Hz render
  await expect(slider).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(utc).toHaveText("2026-10-10T03:31:01Z");
  await expect(slider).toHaveValue("61");
  await page.keyboard.press("PageUp"); // the native big step: a tenth of the range
  await expect(utc).toHaveText("2026-10-10T05:55:01Z");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("ArrowLeft");
  await expect(utc).toHaveText("2026-10-10T03:31:00Z");
  await page.keyboard.press("End");
  await expect(utc).toHaveText("2026-10-10T15:30:00Z");
  await page.keyboard.press("Home");
  await expect(utc).toHaveText("2026-10-09T15:30:00Z");
  await expect(slider).toHaveValue("-43200");
});

test("each ArrowRight on the slider adds exactly 1 s after play and pause (a sub-second offset)", async ({
  page,
}) => {
  await page.clock.install({ time: Date.parse("2026-10-11T12:00:00Z") });
  await page.goto(START);
  await page.clock.runFor(1000);
  const timeline = page.getByRole("region", { name: "Timeline" });
  const utc = page.getByTestId("time-utc");
  await expect(utc).toHaveText("2026-10-10T03:30:00Z");
  await timeline.getByRole("button", { name: "Play" }).click();
  await page.clock.runFor(1700); // requestAnimationFrame times are fractional: the clock stops between seconds
  await timeline.getByRole("button", { name: "Pause" }).click();
  await page.clock.runFor(500);
  // The readout truncates to whole seconds; a 1 s step moves it by exactly 1 s whatever the fraction.
  const simMs = async () => Date.parse((await utc.innerText()).trim());
  const before = await simMs();
  const slider = timeline.getByRole("slider", { name: "Simulation time" });
  await slider.focus();
  for (const [key, expected] of [
    ["ArrowRight", 1000],
    ["ArrowRight", 2000],
    ["ArrowLeft", 1000],
  ] as const) {
    await page.keyboard.press(key);
    await page.clock.runFor(500);
    expect(await simMs(), key).toBe(before + expected);
  }
});

test("live without t", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  const shown = Date.parse((await page.getByTestId("time-utc").innerText()).trim());
  expect(Math.abs(shown - Date.now())).toBeLessThan(5_000);
  await expect(page).toHaveURL(/\?cam=synthetic-maunakea$/);
});

test("URL fallbacks", async ({ page }) => {
  // An unknown id and a known but not-yet-enabled id both fall back (a console.warn is allowed).
  for (const cam of ["nope", "synthetic-walenstadt"]) {
    await page.goto(`./?cam=${cam}&t=2026-10-10T03:30:00Z`);
    await expect(page).toHaveURL(/\?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z$/);
  }
  // A zone-less t is rejected, never guessed: the app starts live.
  await page.goto("./?t=2026-10-10T03:30:00");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  await expect(page).toHaveURL(/\?cam=synthetic-maunakea$/);
});

test("map container is named", async ({ page }) => {
  await page.goto(START);
  await expect(
    page.getByRole("application", {
      name: "Ground map around the camera site: Computed sky, Maunakea",
    }),
  ).toBeVisible();
});
