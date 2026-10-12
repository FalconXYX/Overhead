// tests/e2e/keyboard.spec.ts — the key map (M9 step 9; section 5): each key, pressed once with focus on body, has its
// on-screen effect; Esc ends the tour; the on-screen list has one row per KEY_MAP entry.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const START = "./?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z";

/** Focus back on body: keys pressed in an input or on a focused map are not the app's. */
const focusBody = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("each key on body: time, rate, panels, the calibration nudge, the selection and play", async ({
  page,
}) => {
  await page.goto(`${START}&sel=sat:25544`);
  const timeline = page.getByRole("region", { name: "Timeline" });
  const utc = page.getByTestId("time-utc");
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(utc).toHaveText("2026-10-11T15:09:50Z");
  await expect(inspector).toContainText("ISS (ZARYA)");
  await focusBody(page);

  // ← / →, with Shift a minute
  await page.keyboard.press("ArrowRight");
  await expect(utc).toHaveText("2026-10-11T15:09:51Z");
  await page.keyboard.press("ArrowLeft");
  await expect(utc).toHaveText("2026-10-11T15:09:50Z");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(utc).toHaveText("2026-10-11T15:10:50Z");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(utc).toHaveText("2026-10-11T15:09:50Z");

  // [ / ]
  await page.keyboard.press("]");
  await expect(timeline.getByRole("radio", { name: "10×", exact: true })).toBeChecked();
  await page.keyboard.press("[");
  await expect(timeline.getByRole("radio", { name: "1×", exact: true })).toBeChecked();

  // L
  const layers = page.getByRole("button", { name: "Layers", exact: true });
  await page.keyboard.press("l");
  await expect(layers).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("l");
  await expect(layers).toHaveAttribute("aria-expanded", "false");

  // C, then the arrows nudge the pointing instead of stepping time (a zenith-locked fisheye turns its roll)
  const calibration = page.getByRole("button", { name: "Calibration", exact: true });
  await page.keyboard.press("c");
  await expect(calibration).toHaveAttribute("aria-expanded", "true");
  await focusBody(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "Roll (°)" })).toHaveValue("-179.95");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("spinbutton", { name: "Altitude (°)" })).toHaveValue("89.95");
  await expect(utc).toHaveText("2026-10-11T15:09:50Z");
  await page.keyboard.press("c");
  await expect(calibration).toHaveAttribute("aria-expanded", "false");

  // Esc clears the selection
  await focusBody(page);
  await page.keyboard.press("Escape");
  await expect(inspector).toContainText("Nothing selected.");

  // Space
  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.keyboard.press(" ");
  await expect(timeline.getByRole("button", { name: "Play", exact: true })).toBeVisible();
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
  await page.goto(START);
  const table = page.getByRole("table", { name: "Keyboard shortcuts" });
  await expect(table).toBeHidden(); // inside a closed <details>
  await page.getByText("Keyboard shortcuts", { exact: true }).click(); // its <summary>
  await expect(table.getByRole("row")).toHaveCount(9); // the header and KEY_MAP's 8 rows
  await expect(table.getByRole("rowheader")).toHaveText([
    "Space",
    "← / →",
    "[ / ]",
    "L",
    "C",
    "← → ↑ ↓ with the Calibration panel open",
    "Esc",
    "Arrows, + and − on a focused map",
  ]);
});
