// tests/e2e/selection.spec.ts — satellites in both views, linked (M3 section 5): what is in view, a click in the sky
// highlighting on the ground map within one frame, ?sel= on load, Esc, the hover card, keyboard selection from the
// list, and Starlink loading once, on demand. [Redesign] On the recorded clip during the ISS pass (the fixtures' test
// pattern, served as starting at 15:09:50Z or 15:10:10Z, paused under reduced motion): the object card ("Selected
// object") in plain words, the technical facts in its "More details", and the [In view] popover's lists. Data comes
// from the committed snapshot through the fixtures' data/gp route, so positions never move when fetch-gp.yml commits
// new elements.
import type { Locator, Page } from "@playwright/test";
import type { ViewId } from "../../src/app/testHooks";
import type { ObjectId } from "../../src/state/types";
import {
  clipReady,
  clipStartingAt,
  expect,
  moreDetails,
  objectCard,
  openInView,
  openLayers,
  test,
} from "./fixtures";

/** satellite.js at 15:09:50Z from the Subaru StarCam: the ISS at az 123.8°, alt 28.8° (apparent), 795 km, sunlit. */
const ISS_ENTERS = "2026-10-11T15:09:50Z";
/** 20 s later the ISS is well inside the frame (az 111.9°, alt 28.0°). */
const ISS_INSIDE = "2026-10-11T15:10:10Z";

test.use({ reducedMotion: "reduce" });

const hooksReady = (page: Page) =>
  page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null);
const readyFrame = (page: Page) => page.evaluate(() => window.__overhead?.readyFrame() ?? null);
const highlight = (page: Page, view: ViewId) =>
  page.evaluate((v) => window.__overhead?.highlight(v) ?? null, view);
const clientPoint = (page: Page, view: ViewId, id: ObjectId) =>
  page.evaluate(([v, i]) => window.__overhead?.clientPoint(v, i) ?? null, [view, id] as const);

/** The accessible names (aria-label) of the matched elements, in order. */
const labels = (locator: Locator) =>
  locator.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));

/**
 * The ISS's point in the sky view once it is drawn there: the hover card names it at that point (the drawn positions
 * follow the clip's calibration a frame after it loads; a visitor clicks what is drawn).
 */
async function drawnIssPoint(page: Page): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      point = await clientPoint(page, "sky", "sat:25544");
      if (point === null) return "not in the frame";
      await page.mouse.move(point.x, point.y);
      const tip = page.getByRole("tooltip");
      return (await tip.count()) > 0 ? await tip.locator("strong").innerText() : "no hover card";
    })
    .toBe("International Space Station");
  if (point === null) throw new Error("the ISS is not drawn");
  return point;
}

/**
 * The clip from `startIso`, loaded and paused, with the satellites' first positions drawn. The URL's t (as a shared
 * link has it) sets the clock before the first frame, so the first positions are the clip's.
 */
async function openClipAt(page: Page, startIso: string, sel = ""): Promise<void> {
  await clipStartingAt(page, startIso);
  await page.goto(`./?t=${startIso}${sel}`);
  await clipReady(page, "paused");
  await expect.poll(() => hooksReady(page)).toBe(true);
}

test("In view lists what the camera frame holds: satellites highest first, then the planets, in plain words", async ({
  page,
}) => {
  await openClipAt(page, ISS_INSIDE);
  const inView = await openInView(page);
  await expect(page.getByRole("button", { name: /^In view/ })).toHaveText("In view (4)");
  const satellites = inView.getByRole("list", { name: "Satellites", exact: true });
  await expect
    .poll(() => labels(satellites.getByRole("button")))
    .toEqual([
      "International Space Station, halfway up in the east",
      "Spent rocket stage (SL-3), low in the east",
      "AST SpaceMobile satellite, low in the east",
    ]);
  await expect(satellites.getByRole("button").first()).toHaveAttribute(
    "data-object-id",
    "sat:25544",
  );
  // The modules and ships docked to the ISS are drawn and listed as the station itself; no NORAD id or "R/B" shown.
  await expect(inView).not.toContainText(/Poisk|POISK|NORAD|R\/B/);
  await expect(satellites.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect
    .poll(() =>
      labels(inView.getByRole("list", { name: "Planets, Moon and Sun" }).getByRole("button")),
    )
    .toEqual(["Jupiter (planet), halfway up in the east"]);
});

test("clicking the ISS in the sky view highlights it on the ground map on the next frame", async ({
  page,
}) => {
  await openClipAt(page, ISS_INSIDE);
  const p = await drawnIssPoint(page);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await highlight(page, "ground"))?.id).toBe("sat:25544");
  const sel = await page.evaluate(() => window.__overhead?.selectionFrame() ?? null);
  const ground = await highlight(page, "ground");
  console.log(`click: selection frame ${sel}, ground highlight frame ${ground?.frame}`);
  expect((ground?.frame ?? Number.POSITIVE_INFINITY) - (sel ?? 0)).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await highlight(page, "sky"))?.id).toBe("sat:25544");
  await expect(objectCard(page)).toContainText("International Space Station");
  await expect(objectCard(page)).toHaveAttribute("data-object-id", "sat:25544");
  await expect(await moreDetails(page)).toContainText("NORAD id: 25544");
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);
});

test("?sel= highlights in both views within one frame of the first positions; Esc clears both", async ({
  page,
}) => {
  await openClipAt(page, ISS_ENTERS, "&sel=sat:25544");
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
  const card = objectCard(page);
  await expect(card.getByRole("heading", { name: "International Space Station" })).toBeVisible();
  await expect(card).toContainText("A crewed space station, about 420 km up.");
  await expect(card).toContainText("Halfway up in the south-east");
  await expect(card).toContainText("Lit by the Sun, visible to the eye");
  // The technical facts only behind "More details" (closed: not rendered, so not in innerText).
  await expect(card).not.toContainText("NORAD", { useInnerText: true });
  // satellite.js at 15:09:50Z: az 123.812°, alt 28.8° apparent, range 794.5 km: the app's own propagation.
  const details = await moreDetails(page);
  for (const line of [
    "Catalogue name: ISS (ZARYA)",
    "NORAD id: 25544",
    "Distance from the camera: 795 km",
    "Direction: az 123.8°, alt 28.8° (apparent)",
    "CelesTrak list: Space stations",
  ]) {
    await expect(details.getByText(line, { exact: true })).toBeVisible();
  }
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await highlight(page, "ground"))?.id).toBeNull();
  await expect.poll(async () => (await highlight(page, "sky"))?.id).toBeNull();
  await expect(objectCard(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]sel=/);
});

test("the card's close button clears the selection, and Show on map centres the ground map", async ({
  page,
}) => {
  await openClipAt(page, ISS_INSIDE, "&sel=sat:25544");
  const card = objectCard(page);
  const centre = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-map="ground"]');
      const box = el?.getBoundingClientRect();
      return box === undefined ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  await card.getByRole("button", { name: "Show on map" }).click();
  await expect
    .poll(async () => {
      const p = await clientPoint(page, "ground", "sat:25544");
      const c = await centre();
      return p === null || c === null ? Number.POSITIVE_INFINITY : Math.hypot(p.x - c.x, p.y - c.y);
    })
    .toBeLessThanOrEqual(2);
  await card.getByRole("button", { name: "Close" }).click();
  await expect(objectCard(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]sel=/);
});

test("hovering the ISS shows its hover card", async ({ page }) => {
  await openClipAt(page, ISS_INSIDE);
  await drawnIssPoint(page);
  const card = page.getByRole("tooltip");
  await expect(card).toBeVisible();
  for (const line of [
    "International Space Station",
    "Halfway up in the east",
    "Lit by the Sun, visible to the eye",
  ]) {
    await expect(card.getByText(line, { exact: true })).toBeVisible();
  }
  await expect(card).not.toContainText(/NORAD|az |alt /);
  // Leaving the sky view hovers nothing.
  await page.mouse.move(1, 1);
  await expect(card).toHaveCount(0);
});

test("Tab and Enter select the ISS from In view; Starlink loads once, only when turned on", async ({
  page,
}) => {
  let starlinkRequests = 0;
  // page.route runs before the fixtures' context route and also sees the worker's fetches.
  await page.route("**/data/gp/starlink.json", (route) => {
    starlinkRequests += 1;
    return route.fallback();
  });
  await openClipAt(page, ISS_INSIDE);
  const inView = await openInView(page);
  const iss = inView.getByRole("button", {
    name: "International Space Station, halfway up in the east",
  });
  await expect(iss).toBeVisible();
  let focused = false;
  for (let i = 0; i < 10 && !focused; i += 1) {
    await page.keyboard.press("Tab");
    focused = await iss.evaluate((el) => el === document.activeElement);
  }
  expect(focused, "the ISS button is reachable with Tab from the In view button").toBe(true);
  await page.keyboard.press("Enter");
  await expect(iss).toHaveAttribute("aria-pressed", "true");
  await expect(objectCard(page)).toContainText("International Space Station");
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);

  expect(starlinkRequests, "Starlink requests before its toggle").toBe(0);
  const layers = await openLayers(page);
  const starlink = layers.getByRole("checkbox", { name: "Starlink", exact: true });
  await expect(starlink).toHaveAccessibleDescription("A 4.7 MB download");
  await starlink.check();
  await expect(starlink).toHaveAccessibleDescription("Also on the map", { timeout: 15_000 });
  expect(starlinkRequests, "Starlink requests after turning it on").toBe(1);
  await openInView(page);
  await expect(page.getByText(/^and [\d,]+ Starlink satellites?$/)).toBeVisible();
  // Off and on again: the group is already loaded.
  await openLayers(page);
  await starlink.uncheck();
  await starlink.check();
  await expect(starlink).toHaveAccessibleDescription("Also on the map");
  expect(starlinkRequests, "Starlink requests after a second turn-on").toBe(1);
});
