// tests/e2e/a11y.spec.ts — the accessibility pass (M9 step 11; section 5): a visible focus ring and a real box on every
// Tab stop, OpenLayers' controls at 24 × 24, reduced motion, one polite live region per announcing section, and the
// same checks with the Layers and Calibration panels open (Lighthouse cannot open panels, gotcha 13). No axe: an axe
// dependency is Parth's call (gotcha 13), and Lighthouse covers the page as loaded.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Paused replay at the e2e instant: nothing on the page moves while the focus walks it. */
const START = "./?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z";
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
async function walkTabStops(page: Page, from?: ReturnType<Page["getByRole"]>): Promise<TabStop[]> {
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

function expectRingsAndBoxes(stops: readonly TabStop[]): void {
  expect(stops.length).toBeGreaterThan(10);
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

/** The page has loaded its satellites: the sky lists the ISS. */
const ready = (page: Page) =>
  expect(
    page
      .getByRole("list", { name: "Satellites above the horizon" })
      .getByRole("button", { name: /^ISS \(ZARYA\)/ }),
  ).toBeVisible();

test("focus ring: every Tab stop shows a ring and has a box", async ({ page }) => {
  await page.goto(START);
  await ready(page);
  expectRingsAndBoxes(await walkTabStops(page));
});

test("control size: every OpenLayers control button is at least 24 × 24 CSS px", async ({
  page,
}) => {
  await page.goto(START);
  await expectControlSize(page);
});

test("panels: the Layers and Calibration panels, each opened, meet the focus and size checks", async ({
  page,
}) => {
  await page.goto(START);
  await ready(page);
  const layersToggle = page.getByRole("button", { name: "Layers", exact: true });
  await page.keyboard.press("l");
  await expect(layersToggle).toHaveAttribute("aria-expanded", "true");
  const layers = await walkTabStops(page, layersToggle);
  expectRingsAndBoxes(layers);
  expect(layers.some((s) => s.name.includes("checkbox"))).toBe(true);
  await expectControlSize(page);

  const calibrationToggle = page.getByRole("button", { name: "Calibration", exact: true });
  await calibrationToggle.click(); // replaces Layers, as C does
  await expect(calibrationToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Calibration" })).toBeVisible();
  const calibration = await walkTabStops(page, calibrationToggle);
  expectRingsAndBoxes(calibration);
  expect(calibration.some((s) => s.name.includes("number"))).toBe(true); // the pointing fields
  await expectControlSize(page);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the Trails toggle reads '(off: reduced motion)' and CSS transitions are off", async ({
    page,
  }) => {
    await page.goto(START);
    await page.keyboard.press("l");
    const layers = page.getByRole("region", { name: "Layers" });
    await expect(
      layers.getByRole("checkbox", { name: "Trails (off: reduced motion)" }),
    ).toBeVisible();
    // ol/ol.css gives the rotate control a 0.25 s opacity transition; reduced motion turns it off.
    const rotate = page.locator(".ol-rotate").first();
    await expect(rotate).toBeAttached();
    expect(await rotate.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  });
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
