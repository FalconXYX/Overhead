// tests/perf/screens.perf.ts — [M9] the visual design pass's screenshots; [Redesign] the twilight-blue, video-first
// layout's states (redesign spec sections 2–4): 4 viewports × 9 states, full page, saved to
// test-results/screens/<viewport>/<state>.png (the tour saves its intro and its first step). Run by hand with
// `npm run build && CI=1 npm run perf -- screens`, never in CI; no gate. Tile the set into one contact sheet per viewport
// with `npx tsx scripts/contact-sheet.ts --ffmpeg <path to ffmpeg>`.
//
// It uses the shared e2e fixtures, so tiles, element sets and the YouTube stub are the committed fixtures, and every
// state also passes the guard: no third-party request, no console error. The recorded clip is the real web copy in
// recordings/web/ (with its element sets in recordings/<clip>.gp/) when this machine has it, so the review sees the
// real ISS pass; else the fixtures' routed test pattern. The live state fixes Date the way its e2e spec does.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page, Route } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { APP_ORIGIN, expect, recordGibsRequests, test } from "../e2e/fixtures";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "390x844", width: 390, height: 844 },
] as const;

const CLIP = "subaru-2026-10-11-iss";
const RECORDINGS = fileURLToPath(new URL("../../recordings/", import.meta.url));
/** The real clip, when this machine has it (recordings/ never enters git). */
const REAL_CLIP =
  existsSync(`${RECORDINGS}web/${CLIP}.json`) && existsSync(`${RECORDINGS}web/${CLIP}.mp4`);
/** Media 80 s of the real clip: the ISS is in the frame (az 123.8°, alt 28.9°, sunlit). */
const ISS_IN_FRAME = "2026-10-11T15:09:50Z";
/** Live state: 22:00 HST, the StarCam sky is dark (video.spec.ts). A flowing clock: setFixedTime froze tile fades. */
const NIGHT_MS = Date.parse("2026-10-11T08:00:00Z");

/** The hit targets over the player are invisible by design (hitTargets.ts); outlined here so the review sees them. */
const SHOW_HIT_TARGETS = "[data-hit-target] { outline: 2px dashed #ff00ff !important; }";

/** Serves the real clip, its sidecar and its element sets from recordings/ (before the fixtures' test pattern). */
async function routeRealClip(page: Page): Promise<void> {
  if (!REAL_CLIP) return;
  await page.route("**/recordings/**", (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin !== APP_ORIGIN) return route.fallback();
    const rest = decodeURIComponent(url.pathname.slice(url.pathname.indexOf("/recordings/") + 12));
    if (rest === `${CLIP}.json`) {
      return route.fulfill({ path: `${RECORDINGS}web/${rest}`, contentType: "application/json" });
    }
    if (rest === `${CLIP}.mp4`) {
      return route.fulfill({ path: `${RECORDINGS}web/${rest}`, contentType: "video/mp4" });
    }
    const gp = /^([a-z0-9-]+)\.gp\/([a-z]+\.json)$/.exec(rest);
    if (gp !== null && gp[1] === CLIP && existsSync(`${RECORDINGS}${rest}`)) {
      return route.fulfill({ path: `${RECORDINGS}${rest}`, contentType: "application/json" });
    }
    return route.fallback();
  });
}

/** Satellites have drawn once, every GIBS request has settled, and the fonts are in. */
async function settle(page: Page, quiet: () => Promise<void>): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null), {
      timeout: 30_000,
    })
    .toBe(true);
  await quiet();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Two more frames, so the last store change is on both maps.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** The recorded clip has loaded: the control bar shows its length. */
async function clipLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId("clip-position")).toHaveText(/^\d+:\d\d \/ \d+:\d\d$/, {
    timeout: 60_000,
  });
}

/**
 * The recorded clip plays on its own once loaded (muted): hold it where the URL put it, so the states that need the
 * ISS in the frame keep it there while the page settles.
 */
async function holdClip(page: Page): Promise<void> {
  const pause = page
    .getByRole("region", { name: "Video controls" })
    .getByRole("button", { name: "Pause", exact: true });
  if ((await pause.count()) > 0) await pause.click();
}

async function shoot(page: Page, viewport: string, state: string): Promise<void> {
  const dir = `test-results/screens/${viewport}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${state}.png`, fullPage: true, animations: "disabled" });
}

/** Opens a header or control-bar popover by its button and returns its region. */
async function openPopover(page: Page, button: string, region: string): Promise<Locator> {
  const toggle = page.getByRole("button", { name: button }).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = page.getByRole("region", { name: region, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

for (const viewport of VIEWPORTS) {
  test.describe(`screens at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("01 default: the recorded ISS pass", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto("./");
      await clipLoaded(page);
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "01-default");
    });

    test("02 the ISS selected, in the frame", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto(`./?t=${REAL_CLIP ? ISS_IN_FRAME : "2026-10-11T08:00:03Z"}&sel=sat:25544`);
      await clipLoaded(page);
      await holdClip(page);
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "02-selected");
    });

    test("03 Layers open", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto("./");
      await clipLoaded(page);
      await settle(page, gibs.quiet);
      await openPopover(page, "Layers", "Layers");
      await shoot(page, viewport.name, "03-layers-open");
    });

    test("04 In view open", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto(`./?t=${REAL_CLIP ? ISS_IN_FRAME : "2026-10-11T08:00:03Z"}`);
      await clipLoaded(page);
      await holdClip(page);
      await settle(page, gibs.quiet);
      await openPopover(page, "In view", "In view");
      await shoot(page, viewport.name, "04-in-view-open");
    });

    test("05 Credits open", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto("./");
      await clipLoaded(page);
      await settle(page, gibs.quiet);
      await openPopover(page, "Credits", "Credits");
      await shoot(page, viewport.name, "05-credits-open");
    });

    test("06 Subaru live: the sky over the stub player, hit targets outlined", async ({ page }) => {
      await page.clock.install({ time: NIGHT_MS }); // flowing, unlike setFixedTime
      const gibs = recordGibsRequests(page);
      await page.goto("./?cam=subaru-starcam");
      // The player starts only once the stage is more than half visible (M5), which a narrow layout may not give.
      await page.getByTestId("sky-stage").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("time-mode")).toContainText(/live/i);
      await settle(page, gibs.quiet);
      await page.addStyleTag({ content: SHOW_HIT_TARGETS });
      await page.evaluate(() => window.scrollTo(0, 0));
      await shoot(page, viewport.name, "06-subaru-live");
    });

    test("07 the tour: intro and step 1", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto("./?demo=1");
      const tour = page.getByRole("region", { name: "Tour" });
      await expect(tour).toBeVisible({ timeout: 30_000 });
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "07-tour-intro");
      const start = tour.getByRole("button", { name: /start/i });
      if ((await start.count()) > 0) {
        await expect(start.first()).toBeEnabled({ timeout: 30_000 });
        await start.first().click();
        await expect(tour).toContainText(/Step \d+ of/);
      }
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "07-tour-step1");
    });

    test("08 Camera alignment (advanced) open", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto("./");
      await clipLoaded(page);
      await settle(page, gibs.quiet);
      const layers = await openPopover(page, "Layers", "Layers");
      await layers.getByRole("button", { name: "Camera alignment (advanced)" }).click();
      await expect(page.getByRole("region", { name: "Camera alignment (advanced)" })).toBeVisible();
      await shoot(page, viewport.name, "08-alignment-open");
    });

    test("09 Starlink on", async ({ page }) => {
      await routeRealClip(page);
      const gibs = recordGibsRequests(page);
      await page.goto(`./?t=${REAL_CLIP ? ISS_IN_FRAME : "2026-10-11T08:00:03Z"}`);
      await clipLoaded(page);
      await holdClip(page);
      await settle(page, gibs.quiet);
      const layers = await openPopover(page, "Layers", "Layers");
      const starlink = layers.getByRole("checkbox", { name: "Starlink", exact: true });
      await starlink.check();
      await expect(starlink).toHaveAccessibleDescription("Also on the map", { timeout: 30_000 });
      await page.keyboard.press("Escape");
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "09-starlink");
    });
  });
}
