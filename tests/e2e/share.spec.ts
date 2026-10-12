// tests/e2e/share.spec.ts — "Copy link" (M9 step 8; section 5): the link comes from the store, so while playing it
// carries the current t, not the address bar's stale one; without a clipboard the link shows in a read-only field.
import { APP_ORIGIN, expect, test } from "./fixtures";

const VIEW = "./?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544";
const MAUNAKEA = "Computed sky, Maunakea";

test("Copy link while playing: the current t, cam and sel, and the link opens the same view", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
  await page.goto(VIEW);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("ISS (ZARYA)");
  await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T15:09:50Z");

  await timeline.getByRole("button", { name: "Play", exact: true }).click(); // 1×
  await page.waitForTimeout(2_000);
  await timeline.getByRole("button", { name: "Copy link" }).click();
  await expect(timeline.getByRole("status")).toHaveText("Link copied");

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link.startsWith("http://localhost:4173/Overhead/?"), link).toBe(true);
  const params = new URL(link).searchParams;
  const t = params.get("t") ?? "";
  expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(Date.parse(t)).toBeGreaterThanOrEqual(Date.parse("2026-10-11T15:09:51Z"));
  expect(Date.parse(t)).toBeLessThanOrEqual(Date.parse("2026-10-11T15:09:54Z"));
  expect(params.get("cam")).toBe("synthetic-maunakea");
  expect(params.get("sel")).toBe("sat:25544");
  expect(params.has("demo")).toBe(false);

  const opened = await context.newPage();
  const openedErrors: string[] = [];
  opened.on("console", (m) => {
    if (m.type() === "error") openedErrors.push(m.text());
  });
  await opened.goto(link);
  await expect(opened.getByRole("radio", { name: MAUNAKEA })).toBeChecked();
  await expect(opened.getByTestId("time-utc")).toHaveText(t);
  await expect(opened.getByTestId("time-mode")).toHaveText("Replay");
  await expect(opened.getByRole("region", { name: "Inspector" })).toContainText("ISS (ZARYA)");
  expect(openedErrors).toEqual([]);
  await opened.close();
});

test("without a clipboard (as on the http URL) the link shows in a read-only, selected field", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }),
  );
  await page.goto(VIEW);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T15:09:50Z");
  expect(await page.evaluate(() => navigator.clipboard === undefined)).toBe(true);

  await timeline.getByRole("button", { name: "Copy link" }).click();
  const field = timeline.getByRole("textbox", { name: "Link to this view" });
  await expect(field).toHaveValue(
    "http://localhost:4173/Overhead/?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544",
  );
  await expect(field).toHaveAttribute("readonly", "");
  await expect(field).toBeFocused();
  const selection = await field.evaluate((el) => {
    const input = el as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd, input.value.length];
  });
  expect(selection).toEqual([0, selection[2], selection[2]]);
  await expect(timeline.getByRole("status")).toHaveText("");
});
