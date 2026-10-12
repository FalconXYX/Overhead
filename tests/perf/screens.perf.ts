// tests/perf/screens.perf.ts — [M9] the visual design pass's screenshots (M9 step 12): 4 viewports × 12 states, full
// page, saved to test-results/screens/<viewport>/<state>.png (52 images: state 7 saves the tour's intro and its
// step 1). Run by hand with `npm run build && npm run perf -- screens`, never in CI; no gate. Tile the set into one
// contact sheet per viewport with `npx tsx scripts/contact-sheet.ts --ffmpeg <path to ffmpeg>`.
//
// It uses the shared e2e fixtures, so tiles, element sets, the YouTube stub and the recorded clip (the routed test
// pattern) are the committed fixtures, and every state also passes the guard: no third-party request, no console
// error. Sim times are fixed with ?t= inside the fixtures' windows; the two states whose time comes from the wall
// clock (the still image's live time, the live player's) fix Date the way their e2e specs do.
//
// State 7 (?demo=1) is written against M9 step 10 (region "Tour", "Start the tour", "Step 1 of 8"), built in parallel
// with this file: check it first if this spec fails.
import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import { expect, type Guard, recordGibsRequests, test } from "../e2e/fixtures";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "390x844", width: 390, height: 844 },
] as const;

/** The e2e instant (DECISIONS M3): ISS at az 123.8°, alt 28.9°, sunlit, Sun at −16.2°; 8 satellites listed. */
const DEFAULT = "./?t=2026-10-11T15:09:50Z";
/** M7's e2e time: GOES shows the 09:50 UTC step of the committed DescribeDomains window. */
const GOES_TIME = "./?t=2026-10-10T09:58:00Z";
/**
 * 22:00 HST: the Nānā ao hatch is open (calibration-export.spec.ts), and the StarCam sky is dark (video.spec.ts).
 * NIGHT_CLOCK: states 4 and 8 install a clock that starts here and flows. setFixedTime froze Date.now, which
 * OpenLayers' tile fade-in reads (Tile.getAlpha), so every imagery tile stayed at alpha ≈ 0 and the ground map was blank.
 */
const NIGHT_MS = Date.parse("2026-10-11T08:00:00Z");

const STARLINK = "Starlink (about 11,100; loads 4.7 MB)";
const GOES = "GOES-West infrared (Band 13, 10 minute)";
const NANAAO = "CFHT Nānā ao all-sky (visible)";

/** The hit targets over the player are invisible by design (hitTargets.ts); outlined here so the review sees them. */
const SHOW_HIT_TARGETS = "[data-hit-target] { outline: 2px dashed #ff00ff !important; }";
const GRAYSCALE = "html { filter: grayscale(1) !important; }";

/** Drops exactly the expected console errors before the shared guard checks them (M4's e2e test 2 pattern). */
function allowConsoleErrors(guard: Guard, allowed: readonly RegExp[]): void {
  const rest = guard.consoleErrors.filter((m) => !allowed.some((re) => re.test(m)));
  guard.consoleErrors.splice(0, guard.consoleErrors.length, ...rest);
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

async function shoot(page: Page, viewport: string, state: string): Promise<void> {
  const dir = `test-results/screens/${viewport}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${state}.png`, fullPage: true, animations: "disabled" });
}

/** Opens the Layers panel with its button (L would go to a focused input). */
async function layers(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: "Layers", exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const panel = page.getByRole("region", { name: "Layers" });
  await expect(panel).toBeVisible();
  return panel;
}

async function closeLayers(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("region", { name: "Layers" })).toBeHidden();
}

for (const viewport of VIEWPORTS) {
  test.describe(`screens at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("01 default", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto(DEFAULT);
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "01-default");
    });

    test("02 ISS selected", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto(`${DEFAULT}&sel=sat:25544`);
      await expect(page.getByRole("region", { name: "Inspector" })).toContainText("ISS (ZARYA)");
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "02-selected-iss");
    });

    test("03 Layers open", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto(DEFAULT);
      await settle(page, gibs.quiet);
      const panel = await layers(page);
      await expect(
        panel.getByRole("checkbox", { name: "Satellites (ISS and brightest)" }),
      ).toHaveAccessibleDescription(/objects, elements fetched/);
      await shoot(page, viewport.name, "03-layers-open");
    });

    test("04 Calibration open on cfht-nanaao", async ({ page }) => {
      await page.clock.install({ time: NIGHT_MS }); // flowing, unlike setFixedTime: see NIGHT_CLOCK
      const gibs = recordGibsRequests(page);
      await page.goto("./?cam=cfht-nanaao");
      await expect(page.getByRole("radio", { name: NANAAO })).toHaveAccessibleDescription(/Live/);
      await settle(page, gibs.quiet);
      const toggle = page.getByRole("button", { name: "Calibration", exact: true });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(page.getByRole("region", { name: "Calibration" })).toBeVisible();
      await shoot(page, viewport.name, "04-calibration-nanaao");
    });

    test("05 Starlink on", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto(DEFAULT);
      await settle(page, gibs.quiet);
      const starlink = (await layers(page)).getByRole("checkbox", { name: STARLINK, exact: true });
      await starlink.check();
      await expect(starlink).toHaveAccessibleDescription(/^11,102 objects, elements fetched/, {
        timeout: 30_000,
      });
      await closeLayers(page);
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "05-starlink");
    });

    test("06 GOES on at M7's e2e time", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto(GOES_TIME);
      await settle(page, gibs.quiet);
      await (await layers(page)).getByRole("checkbox", { name: GOES }).check();
      await expect(page.getByTestId("goes-asof")).toHaveText("Imagery as of 09:50 UTC");
      await closeLayers(page);
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "06-goes");
    });

    // Check this state first if the spec fails: it follows M9 step 10, built in parallel with this file.
    test("07 ?demo=1 intro and step 1, on the routed test-pattern clip", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto("./?demo=1");
      const tour = page.getByRole("region", { name: "Tour" });
      await expect(tour).toBeVisible({ timeout: 30_000 });
      const start = tour.getByRole("button", { name: "Start the tour" });
      await expect(start).toBeEnabled({ timeout: 30_000 });
      await expect(start).toBeFocused();
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "07-demo-intro");
      await start.click();
      await expect(tour).toContainText("Step 1 of 8");
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "07-demo-step1");
    });

    test("08 subaru-starcam: the sky map over the stub player, hit targets on", async ({
      page,
    }) => {
      await page.clock.install({ time: NIGHT_MS }); // flowing, unlike setFixedTime: see NIGHT_CLOCK
      const gibs = recordGibsRequests(page);
      await page.goto("./?cam=subaru-starcam");
      // The player starts only once the stage is more than half visible (M5), which a narrow layout may not give.
      await page.getByTestId("sky-stage").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "playing");
      await settle(page, gibs.quiet);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              [...document.querySelectorAll<HTMLElement>("[data-hit-target]")].filter((b) => {
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              }).length,
          ),
        )
        .toBeGreaterThan(0);
      await page.addStyleTag({ content: SHOW_HIT_TARGETS });
      await shoot(page, viewport.name, "08-starcam-overlay");
    });

    test("09 subaru-2026-10-11-iss on the routed test pattern, light overlay", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto("./?cam=subaru-2026-10-11-iss");
      await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "paused");
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "09-recorded-clip");
    });

    test("10 an error state: Starlink fails to load", async ({ page, guard }) => {
      // page.route runs before the fixtures' context route, and also sees the worker's fetch.
      await page.route("**/data/gp/starlink.json", (route) =>
        route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }),
      );
      const gibs = recordGibsRequests(page);
      await page.goto(DEFAULT);
      await settle(page, gibs.quiet);
      const starlink = (await layers(page)).getByRole("checkbox", { name: STARLINK, exact: true });
      await starlink.check();
      await expect(starlink).toHaveAccessibleDescription(/Failed to load/, { timeout: 30_000 });
      await shoot(page, viewport.name, "10-error-starlink");
      // Chromium logs the failed load as a console error; remove exactly that one.
      allowConsoleErrors(guard, [
        /^Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)$/,
      ]);
    });

    test("11 reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const gibs = recordGibsRequests(page);
      await page.goto(DEFAULT);
      await settle(page, gibs.quiet);
      await shoot(page, viewport.name, "11-reduced-motion");
    });

    test("12 grayscale", async ({ page }) => {
      const gibs = recordGibsRequests(page);
      await page.goto(DEFAULT);
      await settle(page, gibs.quiet);
      await page.addStyleTag({ content: GRAYSCALE });
      await shoot(page, viewport.name, "12-grayscale");
    });
  });
}
