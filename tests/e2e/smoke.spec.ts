// tests/e2e/smoke.spec.ts — the shell and the replay clock. Both tests run under the guard fixture.
import { expect, test } from "./fixtures";

const ISO_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

test("the shell loads with every pane", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Overhead");
  for (const name of ["Sky view", "Ground map", "Timeline"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  const time = page.getByRole("region", { name: "Timeline" }).locator("time");
  await expect(time).toHaveText(ISO_UTC_SECONDS);
});

test("Play advances the replay clock and Pause stops it", async ({ page }) => {
  // Without `t` the app starts live and playing (M1), so start in paused replay.
  await page.goto("./?t=2026-10-10T03:30:00Z");
  const timeline = page.getByRole("region", { name: "Timeline" });
  const readout = timeline.locator("time");
  await expect(readout).toHaveText(ISO_UTC_SECONDS);
  const before = await readout.innerText();

  await timeline.getByRole("button", { name: "Play" }).click();
  await expect(readout).not.toHaveText(before, { timeout: 3_000 });

  await timeline.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(300); // the 4 Hz readout catches up
  const paused = await readout.innerText();
  await page.waitForTimeout(1_100);
  await expect(readout).toHaveText(paused);
});
