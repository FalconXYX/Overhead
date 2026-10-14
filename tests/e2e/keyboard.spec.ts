// tests/e2e/keyboard.spec.ts — the key map (M9 step 9; section 5): each key, pressed once with focus on body, has its
// on-screen effect; Esc ends the tour; the on-screen list has one row per KEY_MAP entry. [Redesign] The time keys
// (Space, ← / →, [ / ]) work on the recorded clip only: a live camera has no time controls, so they do nothing there.
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import {
  CLIP_START_ISO,
  cameraButton,
  cameraOption,
  chooseCamera,
  clipReady,
  expect,
  expectCamera,
  expectSimTime,
  focusBody,
  objectCard,
  test,
} from "./fixtures";

const clock = (page: Page) => page.evaluate(() => window.__overhead?.clock() ?? null);

test.describe("on the recorded clip (paused: reduced motion)", () => {
  test.use({ reducedMotion: "reduce" });

  test("each key on body: time, rate, panels, the alignment nudge, the selection and play", async ({
    page,
  }) => {
    await page.goto("./?sel=sat:25544");
    await clipReady(page, "paused");
    const controls = page.getByRole("region", { name: "Video controls" });
    await expectSimTime(page, CLIP_START_ISO);
    await expect(objectCard(page)).toContainText("International Space Station");
    await focusBody(page);

    // ← / →, with Shift a minute (the 7 s clip clamps it at its ends)
    await page.keyboard.press("ArrowRight");
    await expectSimTime(page, "2026-10-11T08:00:01Z");
    await page.keyboard.press("ArrowLeft");
    await expectSimTime(page, CLIP_START_ISO);
    await page.keyboard.press("Shift+ArrowRight");
    await expectSimTime(page, "2026-10-11T08:00:07Z");
    await page.keyboard.press("Shift+ArrowLeft");
    await expectSimTime(page, CLIP_START_ISO);

    // [ / ]: normal speed or 10 times faster, keyboard only
    expect(await clock(page)).toMatchObject({ rate: 1 });
    await page.keyboard.press("]");
    await expect.poll(async () => (await clock(page))?.rate).toBe(10);
    await page.keyboard.press("]"); // clamped: there is no faster rate
    await expect.poll(async () => (await clock(page))?.rate).toBe(10);
    await page.keyboard.press("[");
    await expect.poll(async () => (await clock(page))?.rate).toBe(1);

    // L
    const layers = page.getByRole("button", { name: "Layers", exact: true });
    await page.keyboard.press("l");
    await expect(layers).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("l");
    await expect(layers).toHaveAttribute("aria-expanded", "false");

    // C, then the arrows nudge the pointing instead of stepping time
    const drawer = page.getByRole("region", { name: "Camera alignment (advanced)" });
    await page.keyboard.press("c");
    await expect(drawer).toBeVisible();
    await focusBody(page);
    await page.keyboard.press("ArrowRight");
    await expect(drawer.getByRole("spinbutton", { name: "Azimuth (°)" })).toHaveValue("81.28");
    await page.keyboard.press("ArrowDown");
    await expect(drawer.getByRole("spinbutton", { name: "Altitude (°)" })).toHaveValue("19.57");
    await expectSimTime(page, CLIP_START_ISO);
    await page.keyboard.press("c");
    await expect(drawer).toBeHidden();

    // Esc closes the object card
    await focusBody(page);
    await page.keyboard.press("Escape");
    await expect(objectCard(page)).toHaveCount(0);

    // Space
    await page.keyboard.press(" ");
    await expect(controls.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.keyboard.press(" ");
    await expect(controls.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });
});

test("on a live camera Space, ← / → and [ / ] do nothing; L and C still work", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T08:00:00Z"));
  await page.goto("./?cam=subaru-starcam");
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "playing");
  await expectSimTime(page, "2026-10-11T07:59:10Z");
  const controls = page.getByRole("region", { name: "Video controls" });
  // No time controls on screen.
  for (const name of ["Play", "Pause"]) {
    await expect(controls.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(controls.getByRole("slider")).toHaveCount(0);
  await expect(controls.getByRole("radio")).toHaveCount(0);

  await page.getByRole("heading", { name: "Overhead", level: 1 }).click(); // out of the player (G4)
  for (const key of [" ", "ArrowRight", "Shift+ArrowLeft", "]", "["])
    await page.keyboard.press(key);
  await page.waitForTimeout(300); // the 4 Hz readout would have caught up
  await expectSimTime(page, "2026-10-11T07:59:10Z");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  expect(await clock(page)).toMatchObject({ mode: "live", playing: true, rate: 1 });
  const pauses = await page.evaluate(
    () =>
      (window as unknown as { __ytStub?: { calls: { fn: string }[] } }).__ytStub?.calls.filter(
        (c) => c.fn === "pauseVideo",
      ).length ?? -1,
  );
  expect(pauses).toBe(0);

  await page.keyboard.press("l");
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("c");
  await expect(page.getByRole("region", { name: "Camera alignment (advanced)" })).toBeVisible();
});

test("[Polish] the camera menu: ↓ opens it on the active camera, ↑ ↓ Home End move, Enter chooses, Esc closes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./?sel=sat:25544");
  await clipReady(page, "paused");
  const button = cameraButton(page);
  const menu = page.getByRole("menu", { name: "Cameras" });
  await expect(menu).toBeHidden();
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
  // Grouped: the recording, then the live cameras; focus on the active row.
  await expect(
    menu.getByRole("group", { name: "Recorded" }).getByRole("menuitemradio"),
  ).toHaveCount(1);
  await expect(menu.getByRole("group", { name: "Live" }).getByRole("menuitemradio")).toHaveCount(2);
  await expect(cameraOption(page, "ISS pass (recorded)")).toBeFocused();
  await expect(cameraOption(page, "ISS pass (recorded)")).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(cameraOption(page, "Subaru live")).toBeFocused();
  await page.keyboard.press("End");
  await expect(cameraOption(page, "CFHT live")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // wraps
  await expect(cameraOption(page, "ISS pass (recorded)")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(cameraOption(page, "CFHT live")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(cameraOption(page, "ISS pass (recorded)")).toBeFocused();
  // The arrows moved focus, not time, and Esc closes the menu (back to its button) without clearing the selection.
  await expectSimTime(page, CLIP_START_ISO);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await expect(objectCard(page)).toBeVisible();
  // Enter on a row chooses it and closes the menu.
  await page.keyboard.press("Enter");
  await expect(cameraOption(page, "ISS pass (recorded)")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expectCamera(page, "Subaru live");
  await expect(page).toHaveURL(/[?&]cam=subaru-starcam(&|$)/);
  await expect(button).toBeFocused();
  // A pointer choice; a press outside closes the menu.
  await chooseCamera(page, "CFHT live");
  await button.click();
  await expect(menu).toBeVisible();
  await page.getByRole("heading", { name: "Overhead", level: 1 }).click();
  await expect(menu).toBeHidden();
});

test("Esc exits the tour: the Tour region goes and the URL loses demo", async ({ page }) => {
  await page.goto("./?demo=1");
  const tour = page.getByRole("region", { name: "Tour" });
  await expect(tour).toBeVisible();
  // The intro moves focus to "Start the tour" once it is enabled (the routed test-pattern clip has loaded).
  await expect(tour.getByRole("button", { name: "Start the tour" })).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get("demo")).toBe("1");
  await focusBody(page);
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("demo")).toBe(false);
});

test("the on-screen list has one row per shortcut", async ({ page }) => {
  await page.goto("./");
  const panel = page.getByRole("region", { name: "Keyboard shortcuts" });
  await expect(panel).toBeHidden(); // the [?] popover, closed
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(panel).toBeVisible();
  const table = panel.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(8); // KEY_MAP's 8 rows
  await expect(table.getByRole("rowheader")).toHaveText([
    "Space",
    "← / →",
    "[ / ]",
    "L",
    "C",
    "← → ↑ ↓ with Camera alignment open",
    "Esc",
    "Arrows, + and − on a focused map",
  ]);
  // Esc closes the popover and gives the focus back to its button.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});
