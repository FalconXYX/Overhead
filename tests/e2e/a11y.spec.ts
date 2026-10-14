// tests/e2e/a11y.spec.ts — the accessibility pass (M9 step 11; section 5): a visible focus ring and a real box on every
// Tab stop, OpenLayers' controls at 24 × 24, reduced motion, one polite live region per announcing section, and the
// same checks with the popovers and the alignment drawer open (Lighthouse cannot open panels, gotcha 13). No axe: an
// axe dependency is Parth's call (gotcha 13), and Lighthouse covers the page as loaded. [Redesign] On the recorded
// clip, paused (reduced motion), so nothing on the page moves while the focus walks it.
import type { Locator, Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { clipReady, expect, objectCard, openInView, openLayers, test } from "./fixtures";

const MAX_STOPS = 120;

interface TabStop {
  readonly name: string; // tag, role and text, for the failure message
  readonly ring: boolean; // outline-style or box-shadow other than none
  readonly boxed: boolean; // a non-empty bounding box
}

/**
 * Tab from where the focus is (the top of a fresh page, or `from`) until the focus returns to a stop already seen or
 * leaves the page, at most MAX_STOPS times; each stop's ring and box are read while it holds the focus.
 */
async function walkTabStops(page: Page, from?: Locator): Promise<TabStop[]> {
  if (from !== undefined) await from.focus();
  const stops: TabStop[] = [];
  for (let i = 0; i < MAX_STOPS; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return "left the page";
      if (el.dataset.a11yStop === "seen") return "seen";
      el.dataset.a11yStop = "seen";
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
      return {
        name: `${el.tagName.toLowerCase()}[${el.getAttribute("role") ?? el.getAttribute("type") ?? ""}] "${text}"`,
        ring: style.outlineStyle !== "none" || style.boxShadow !== "none",
        boxed: box.width > 0 && box.height > 0,
      };
    });
    if (typeof stop === "string") break;
    stops.push(stop);
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-a11y-stop]")) {
      delete el.dataset.a11yStop;
    }
  });
  return stops;
}

function expectRingsAndBoxes(stops: readonly TabStop[], atLeast = 10): void {
  expect(stops.length).toBeGreaterThanOrEqual(atLeast);
  expect(
    stops.filter((s) => !s.ring).map((s) => s.name),
    "stops without a focus ring",
  ).toEqual([]);
  expect(
    stops.filter((s) => !s.boxed).map((s) => s.name),
    "stops without a box",
  ).toEqual([]);
}

/** Width and height of every OpenLayers control button (the ground map's zoom and rotate). */
async function expectControlSize(page: Page): Promise<void> {
  const buttons = page.locator(".ol-control button");
  await expect(buttons.first()).toBeAttached();
  const sizes = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return { title: el.getAttribute("title") ?? el.className, w: box.width, h: box.height };
    }),
  );
  expect(sizes.length).toBeGreaterThanOrEqual(2);
  for (const { title, w, h } of sizes) {
    expect(w, `${title} width`).toBeGreaterThanOrEqual(24);
    expect(h, `${title} height`).toBeGreaterThanOrEqual(24);
  }
}

/** The page has loaded its clip and its satellites. */
async function ready(page: Page): Promise<void> {
  await clipReady(page, "paused");
  await expect
    .poll(() => page.evaluate(() => window.__overhead?.readyFrame() ?? null))
    .not.toBeNull();
}

test.use({ reducedMotion: "reduce" });

test("focus ring: every Tab stop shows a ring and has a box", async ({ page }) => {
  await page.goto("./?sel=sat:25544"); // the object card's buttons too
  await ready(page);
  // "Show on map" is enabled (a Tab stop) once the card's 4 Hz render has the ISS's position.
  await expect(objectCard(page).getByRole("button", { name: "Show on map" })).toBeEnabled();
  const stops = await walkTabStops(page);
  expectRingsAndBoxes(stops);
  for (const name of ["Watch live", "Layers", "Play", "Copy link", "Show on map", "More details"]) {
    expect(
      stops.some((s) => s.name.includes(`"${name}`)),
      `${name} is a Tab stop`,
    ).toBe(true);
  }
});

test("control size: every OpenLayers control button is at least 24 × 24 CSS px", async ({
  page,
}) => {
  await page.goto("./");
  await expectControlSize(page);
});

test("panels: Layers, In view and the alignment drawer, each opened, meet the focus and size checks", async ({
  page,
}) => {
  await page.goto("./");
  await ready(page);
  const layersToggle = page.getByRole("button", { name: "Layers", exact: true });
  await page.keyboard.press("l");
  await expect(layersToggle).toHaveAttribute("aria-expanded", "true");
  const layers = await walkTabStops(page, layersToggle);
  expectRingsAndBoxes(layers);
  expect(layers.some((s) => s.name.includes("checkbox"))).toBe(true);
  await expectControlSize(page);

  // From the Layers popover's footer, as a visitor finds it.
  const panel = await openLayers(page);
  await panel.getByRole("button", { name: "Camera alignment (advanced)" }).click();
  const drawer = page.getByRole("region", { name: "Camera alignment (advanced)" });
  await expect(drawer).toBeVisible();
  const close = drawer.getByRole("button", { name: "Close camera alignment" });
  await expect(close).toBeFocused(); // focus moves into the drawer
  const alignment = await walkTabStops(page, close);
  expectRingsAndBoxes(alignment);
  expect(alignment.some((s) => s.name.includes("number"))).toBe(true); // the pointing fields
  await expectControlSize(page);
  await close.click();
  await expect(drawer).toBeHidden();

  const inViewToggle = page.getByRole("button", { name: /^In view/ });
  await openInView(page);
  const inView = await walkTabStops(page, inViewToggle);
  expectRingsAndBoxes(inView, 3);
  expect(inView.some((s) => s.name.includes("Uranus (planet)"))).toBe(true);
});

test("reduced motion: the Trails switch says it is off, and CSS transitions are off", async ({
  page,
}) => {
  await page.goto("./");
  await clipReady(page, "paused");
  await expect(page.locator('[data-map="ground"] .ol-viewport')).toHaveCount(1); // the ground map, with its controls
  await page.keyboard.press("l");
  const layers = page.getByRole("region", { name: "Layers" });
  await expect(layers.getByRole("checkbox", { name: "Trails" })).toHaveAccessibleDescription(
    "Off while reduced motion is on",
  );
  // ol/ol.css gives the rotate control a 0.25 s opacity transition; reduced motion turns it off.
  const rotate = page.locator(".ol-rotate").first();
  await expect(rotate).toBeAttached();
  expect(await rotate.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
});

test("live regions: the incoming chip and the Tour region each hold one polite element and are not live themselves", async ({
  page,
}) => {
  await page.goto("./?demo=1");
  const tour = page.getByRole("region", { name: "Tour" });
  await expect(tour).toBeVisible();
  for (const name of ["Incoming satellites", "Tour"]) {
    const region = page.getByRole("region", { name });
    await expect(region.locator("[aria-live]"), name).toHaveCount(1);
    await expect(region.locator('[aria-live="polite"]'), name).toHaveCount(1);
    await expect(region.locator('[role="status"], [role="alert"], [role="log"]'), name).toHaveCount(
      0,
    );
    await expect(region, name).not.toHaveAttribute("aria-live");
    await expect(region, name).not.toHaveAttribute("role", /^(status|alert|log)$/);
  }
});
