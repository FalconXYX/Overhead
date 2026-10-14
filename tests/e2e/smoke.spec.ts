// tests/e2e/smoke.spec.ts — the shell and the recorded clip's transport. [Redesign] The site opens on the recorded ISS
// pass (the fixtures' routed test pattern): every pane, then Play and Pause. Both tests run under the guard fixture.
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import {
  CLIP_START_ISO,
  cameraRadio,
  clipReady,
  clockTime,
  expect,
  expectSimTime,
  test,
} from "./fixtures";

const ISO_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The store's sim time in ms (the test hook), not the 4 Hz readout. */
const simClockMs = (page: Page): Promise<number> =>
  page.evaluate(() => window.__overhead?.clock().simTimeMs ?? Number.NaN);
const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

test("the shell loads with every pane, on the recorded ISS pass", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Overhead");
  for (const name of ["Sky view", "Ground map", "Video controls"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  for (const name of ["Layers", "Credits", "Keyboard shortcuts"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(cameraRadio(page, "ISS pass (recorded)")).toBeChecked();
  await expect(page.getByTestId("clip-position")).toHaveText(/^0:0\d \/ 0:07$/);
  // The local time in words; UTC only in the dateTime and the tooltip.
  await expect(clockTime(page)).toHaveText(/^\d\d:\d\d in Hawaii$/);
  await expect(clockTime(page)).toHaveAttribute("datetime", ISO_UTC_SECONDS);
  await expect(clockTime(page)).toHaveAttribute("title", /^2026-10-11 08:00:0\d UTC$/);
});

test.describe("reduced motion: the clip opens paused", () => {
  test.use({ reducedMotion: "reduce" });

  test("Play advances the recording and Pause stops it", async ({ page }) => {
    await page.goto("./");
    await clipReady(page, "paused");
    await expectSimTime(page, CLIP_START_ISO);
    const controls = page.getByRole("region", { name: "Video controls" });
    await expect(page.getByTestId("clip-position")).toHaveText("0:00 / 0:07");

    await controls.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "playing");
    // The recording moves on: its position and the clock leave the start.
    await expect(page.getByTestId("clip-position")).not.toHaveText("0:00 / 0:07");
    await expect(clockTime(page)).not.toHaveAttribute("datetime", CLIP_START_ISO);

    await controls.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "paused");
    await expect(controls.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    // Paused, the clock holds: two frames after the pause it reads the paused video, and the readout shows it.
    await twoFrames(page);
    const pausedMs = await simClockMs(page);
    await expectSimTime(page, `${new Date(pausedMs).toISOString().slice(0, 19)}Z`);
    await page.waitForTimeout(1_100); // a negative check: nothing may move while paused
    expect(await simClockMs(page)).toBe(pausedMs);
  });
});
