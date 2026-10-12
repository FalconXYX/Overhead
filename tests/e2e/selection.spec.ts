// tests/e2e/selection.spec.ts — satellites in both views, linked (M3 section 5): the sky list at the e2e instant, a
// click in the sky highlighting on the ground map within one frame, ?sel= on load, Esc, the hover card, keyboard
// selection from the list, and Starlink loading once, on demand. Data comes from the committed snapshot through the
// fixtures' data/gp route, so positions never move when fetch-gp.yml commits new elements.
import type { Page } from "@playwright/test";
import type { ViewId } from "../../src/app/testHooks";
import type { ObjectId } from "../../src/state/types";
import { expect, test } from "./fixtures";

const T = "2026-10-11T15:09:50Z"; // ISS at az 123.8°, apparent alt 28.9°, sunlit, Sun at −16.2°
const START = `./?cam=synthetic-maunakea&t=${T}`;

const hooksReady = (page: Page) =>
  page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null);
const readyFrame = (page: Page) => page.evaluate(() => window.__overhead?.readyFrame() ?? null);
const highlight = (page: Page, view: ViewId) =>
  page.evaluate((v) => window.__overhead?.highlight(v) ?? null, view);
const clientPoint = (page: Page, view: ViewId, id: ObjectId) =>
  page.evaluate(([v, i]) => window.__overhead?.clientPoint(v, i) ?? null, [view, id] as const);
/** Exact name: M2's "Above the horizon" list would also match a substring locator. */
const satelliteList = (page: Page) =>
  page.getByRole("list", { name: "Satellites above the horizon", exact: true });

test("the satellite list holds the drawn stations and visual satellites, highest first, no docked vehicle", async ({
  page,
}) => {
  await page.goto(START);
  await expect.poll(() => hooksReady(page)).toBe(true);
  const list = satelliteList(page);
  // Two "SL-3 R/B" are up at once (gotcha 14): names carry the NORAD id.
  await expect(list.getByRole("button")).toHaveText([
    "ISS (ZARYA), NORAD 25544, az 124°, alt 29°, sunlit",
    /^SL-3 R\/B, NORAD 19046, az \d+°, alt \d+°, (sunlit|in shadow)$/,
    /^CYGNUS NG-24, NORAD 68689, /,
    /^ORBVIEW 2 \(SEASTAR\), NORAD 24883, /,
    /^SL-3 R\/B, NORAD 10114, /,
    /^DUPLEX, NORAD 66906, /,
    /^SPACEMOBILE-010, NORAD 69591, /,
    /^CZ-8A R\/B, NORAD 66004, /,
  ]);
  await expect(list).not.toContainText("POISK");
  await expect(list.getByRole("button", { pressed: true })).toHaveCount(0);
});

test("clicking the ISS in the sky view highlights it on the ground map on the next frame", async ({
  page,
}) => {
  await page.goto(START);
  await expect.poll(() => hooksReady(page)).toBe(true);
  const p = await clientPoint(page, "sky", "sat:25544");
  expect(p).not.toBeNull();
  await page.mouse.click(p?.x ?? 0, p?.y ?? 0);
  await expect.poll(async () => (await highlight(page, "ground"))?.id).toBe("sat:25544");
  const sel = await page.evaluate(() => window.__overhead?.selectionFrame() ?? null);
  const ground = await highlight(page, "ground");
  console.log(`click: selection frame ${sel}, ground highlight frame ${ground?.frame}`);
  expect((ground?.frame ?? Number.POSITIVE_INFINITY) - (sel ?? 0)).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await highlight(page, "sky"))?.id).toBe("sat:25544");
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector).toContainText("ISS (ZARYA)");
  await expect(inspector).toContainText("25544");
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);
});

test("?sel= highlights in both views within one frame of the first positions; Esc clears both", async ({
  page,
}) => {
  await page.goto(`${START}&sel=sat:25544`);
  await expect.poll(() => hooksReady(page)).toBe(true);
  await expect.poll(async () => (await highlight(page, "ground"))?.id).toBe("sat:25544");
  await expect.poll(async () => (await highlight(page, "sky"))?.id).toBe("sat:25544");
  const ready = (await readyFrame(page)) ?? Number.NaN;
  for (const view of ["ground", "sky"] as const) {
    const h = await highlight(page, view);
    console.log(`?sel=: readyFrame ${ready}, ${view} highlight frame ${h?.frame}`);
    expect(h?.frame ?? Number.POSITIVE_INFINITY, `${view} highlight frame`).toBeLessThanOrEqual(
      ready + 1,
    );
  }
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector.getByRole("heading", { name: "ISS (ZARYA)" })).toBeVisible();
  await expect(inspector).toContainText("NORAD 25544");
  await expect(inspector).toContainText("Space stations");
  await expect(inspector).toContainText("Sunlit");
  await expect(inspector).toContainText("Visible to the eye");
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);

  await page.keyboard.press("Escape");
  await expect.poll(async () => (await highlight(page, "ground"))?.id).toBeNull();
  await expect.poll(async () => (await highlight(page, "sky"))?.id).toBeNull();
  await expect(inspector).toContainText("Nothing selected.");
  await expect(page).not.toHaveURL(/[?&]sel=/);
});

test("hovering the ISS shows its hover card", async ({ page }) => {
  await page.goto(START);
  await expect.poll(() => hooksReady(page)).toBe(true);
  const p = await clientPoint(page, "sky", "sat:25544");
  expect(p).not.toBeNull();
  await page.mouse.move(p?.x ?? 0, p?.y ?? 0);
  const card = page.getByRole("tooltip");
  await expect(card).toBeVisible();
  // satellite.js at 15:09:50Z: az 123.812°, alt 28.841° + 0.030° refraction, range 794.522 km (0.02 km above the
  // rounding edge, so this string must come from the app's own propagation).
  for (const line of ["ISS (ZARYA)", "NORAD 25544", "az 123.8°", "alt 28.9°", "795 km", "Sunlit"]) {
    await expect(card.getByText(line, { exact: true })).toBeVisible();
  }
  // Leaving the sky view hovers nothing.
  await page.mouse.move(1, 1);
  await expect(card).toHaveCount(0);
});

test("Tab and Enter select the ISS from the list; Starlink loads once, only when turned on", async ({
  page,
}) => {
  let starlinkRequests = 0;
  // page.route runs before the fixtures' context route and also sees the worker's fetches.
  await page.route("**/data/gp/starlink.json", (route) => {
    starlinkRequests += 1;
    return route.fallback();
  });
  await page.goto(START);
  await expect.poll(() => hooksReady(page)).toBe(true);
  const iss = satelliteList(page).getByRole("button", { name: /^ISS \(ZARYA\), NORAD 25544,/ });
  await expect(iss).toBeVisible();
  let focused = false;
  for (let i = 0; i < 60 && !focused; i += 1) {
    await page.keyboard.press("Tab");
    focused = await iss.evaluate((el) => el === document.activeElement);
  }
  expect(focused, "the ISS button is reachable with Tab").toBe(true);
  await page.keyboard.press("Enter");
  await expect(iss).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("ISS (ZARYA)");
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);

  expect(starlinkRequests, "Starlink requests before its toggle").toBe(0);
  await page.getByRole("button", { name: "Layers" }).click();
  const satellites = page.getByRole("checkbox", { name: "Satellites (ISS and brightest)" });
  await expect(satellites).toHaveAccessibleDescription(
    "165 objects, elements fetched 2026-10-11 03:50 UTC",
  );
  const starlink = page.getByRole("checkbox", { name: "Starlink (about 11,100; loads 4.7 MB)" });
  await starlink.check();
  await expect(starlink).toHaveAccessibleDescription(
    "11,102 objects, elements fetched 2026-10-11 03:50 UTC",
    { timeout: 15_000 },
  );
  expect(starlinkRequests, "Starlink requests after turning it on").toBe(1);
  await expect(page.getByText(/^and [\d,]+ Starlink satellites?$/)).toBeVisible();
  // Off and on again: the group is already loaded.
  await starlink.uncheck();
  await starlink.check();
  await expect(page.getByText(/^and [\d,]+ Starlink satellites?$/)).toBeVisible();
  expect(starlinkRequests, "Starlink requests after a second turn-on").toBe(1);
});
