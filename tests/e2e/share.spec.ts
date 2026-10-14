// tests/e2e/share.spec.ts — "Copy link" (M9 step 8; section 5): the link comes from the store, so while playing it
// carries the current t, not the address bar's stale one; without a clipboard the link shows in a read-only field.
// [Redesign] On the recorded clip (paused at first: reduced motion), and on a live camera, whose link never has a t.
import {
  APP_ORIGIN,
  CLIP_ID,
  clipReady,
  expect,
  expectCamera,
  expectSimTime,
  objectCard,
  test,
} from "./fixtures";

test.use({ reducedMotion: "reduce" });

const VIEW = "./?t=2026-10-11T08:00:01Z&sel=sat:25544";
const controls = (page: Parameters<typeof expectCamera>[0]) =>
  page.getByRole("region", { name: "Video controls" });

test("Copy link while the clip plays: the current t, cam and sel, and the link opens the same view", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
  await page.goto(VIEW);
  await clipReady(page, "paused");
  await expectSimTime(page, "2026-10-11T08:00:01Z");
  await expect(objectCard(page)).toContainText("International Space Station");

  await controls(page).getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(2_000);
  await controls(page).getByRole("button", { name: "Copy link" }).click();
  await expect(controls(page).getByRole("status")).toHaveText("Link copied");

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link.startsWith("http://localhost:4173/Overhead/?"), link).toBe(true);
  const params = new URL(link).searchParams;
  const t = params.get("t") ?? "";
  expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(Date.parse(t)).toBeGreaterThanOrEqual(Date.parse("2026-10-11T08:00:02Z"));
  expect(Date.parse(t)).toBeLessThanOrEqual(Date.parse("2026-10-11T08:00:05Z"));
  expect(params.get("cam")).toBe(CLIP_ID);
  expect(params.get("sel")).toBe("sat:25544");
  expect(params.has("demo")).toBe(false);

  const opened = await context.newPage();
  const openedErrors: string[] = [];
  opened.on("console", (m) => {
    if (m.type() === "error") openedErrors.push(m.text());
  });
  await opened.goto(link);
  await expectCamera(opened, "ISS pass (recorded)");
  await clipReady(opened, "paused");
  await expectSimTime(opened, t);
  await expect(objectCard(opened)).toContainText("International Space Station");
  expect(openedErrors).toEqual([]);
  await opened.close();
});

test("on a live camera the link has no t: a live link always opens now", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
  await page.clock.setFixedTime(new Date("2026-10-11T08:00:00Z"));
  await page.goto("./?cam=subaru-starcam&sel=planet:Uranus");
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "playing");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  await controls(page).getByRole("button", { name: "Copy link" }).click();
  await expect(controls(page).getByRole("status")).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "http://localhost:4173/Overhead/?cam=subaru-starcam&sel=planet:Uranus",
  );
  await expect.poll(() => new URL(page.url()).search).toBe("?cam=subaru-starcam&sel=planet:Uranus");
});

test("without a clipboard (as on the http URL) the link shows in a read-only, selected field", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }),
  );
  await page.goto("./?t=2026-10-11T08:00:03Z&sel=sat:25544");
  await clipReady(page, "paused");
  await expectSimTime(page, "2026-10-11T08:00:03Z");
  expect(await page.evaluate(() => navigator.clipboard === undefined)).toBe(true);

  await controls(page).getByRole("button", { name: "Copy link" }).click();
  const field = controls(page).getByRole("textbox", { name: "Link to this view" });
  await expect(field).toHaveValue(
    `http://localhost:4173/Overhead/?cam=${CLIP_ID}&t=2026-10-11T08:00:03Z&sel=sat:25544`,
  );
  await expect(field).toHaveAttribute("readonly", "");
  await expect(field).toBeFocused();
  const selection = await field.evaluate((el) => {
    const input = el as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd, input.value.length];
  });
  expect(selection).toEqual([0, selection[2], selection[2]]);
  await expect(controls(page).getByRole("status")).toHaveText("");
});
