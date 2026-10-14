// tests/e2e/demo.spec.ts — the ?demo=1 tour (M9 step 10; section 5). [Redesign] Five plain steps: the intro on the
// recorded clip, the ISS crossing it, the map, how the labels are made, then the live StarCam. The clip path runs on
// M5's routed test pattern, served as subaru-2026-10-11-iss by the fixtures' **/recordings/** route (200 without
// ranges, so the Blob path); the no-clip path answers the sidecar with text/html, as vite preview does for a missing
// file, and the tour goes straight to live (no computed-sky fallback any more).
import { fileURLToPath } from "node:url";
import type { Page, Request, Route } from "@playwright/test";
import { expect, expectCamera, focusBody, simTimeMs, test } from "./fixtures";

const INTRO =
  "This is a sky camera on Maunakea, Hawaii, filmed on the night the International Space Station flew over. The labels on the video are added by this site.";
const NO_CLIP =
  "The recorded video is not included in this copy of the site, so the tour goes straight to the live camera.";
const LIVE_CAPTION = /^This is the same camera, live\./;
const GP_FILES = new Set(["stations.json", "visual.json", "starlink.json", "meta.json"]);

const tour = (page: Page) => page.getByRole("region", { name: "Tour" });
const caption = (page: Page) => tour(page).locator('[aria-live="polite"]');
const startButton = (page: Page) => tour(page).getByRole("button", { name: "Start the tour" });
const nextButton = (page: Page) => tour(page).getByRole("button", { name: "Next", exact: true });

/** Polls the clock until it lies in [fromIso, toIso]. */
const expectTimeWithin = (page: Page, fromIso: string, toIso: string) =>
  expect
    .poll(async () => {
      const t = await simTimeMs(page);
      return t >= Date.parse(fromIso) && t <= Date.parse(toIso)
        ? "in range"
        : new Date(t).toISOString();
    })
    .toBe("in range");

/** "Next" until the region reads "Step <to> of 5", checking each step on the way. */
async function nextUntil(page: Page, from: number, to: number): Promise<void> {
  for (let n = from + 1; n <= to; n++) {
    await nextButton(page).click();
    await expect(tour(page)).toContainText(`Step ${n} of 5`);
  }
}

/** The YouTube stub's players and their options (tests/fixtures/youtube/iframe_api.js). */
interface StubView {
  readonly players: number;
  readonly fs: (number | undefined)[];
}
const ytStub = (page: Page): Promise<StubView> =>
  page.evaluate(() => {
    const stub = (
      window as unknown as {
        __ytStub?: { players: unknown[]; options: { playerVars?: { fs?: number } }[] };
      }
    ).__ytStub;
    return {
      players: stub?.players.length ?? 0,
      fs: stub?.options.map((o) => o.playerVars?.fs) ?? [],
    };
  });

test("clip path: the intro on the recorded clip, the ISS step at media 60 s, then the live StarCam", async ({
  page,
}) => {
  await page.goto("./?demo=1");
  await expect(tour(page)).toBeVisible();
  await expect(caption(page)).toHaveText(INTRO);
  await expect(tour(page)).toContainText("Step 1 of 5");
  await expectCamera(page, "ISS pass (recorded)");
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toBeFocused();
  await expect(tour(page)).not.toContainText(NO_CLIP);
  // The tour holds the clip: no autoplay under the intro.
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "paused");

  await startButton(page).click();
  await expect(tour(page)).toContainText("Step 2 of 5");
  await expectCamera(page, "ISS pass (recorded)");
  // The 60 s seek stops at the 7 s test pattern's end.
  await expectTimeWithin(page, "2026-10-11T08:00:00Z", "2026-10-11T08:00:07Z");
  await expect(page.getByRole("region", { name: "Selected object" })).toContainText(
    "International Space Station",
  );
  await expect
    .poll(() => {
      const params = new URL(page.url()).searchParams;
      return [params.get("sel"), params.get("demo")];
    })
    .toEqual(["sat:25544", "1"]);

  // Pause tour: a toggle whose name never changes.
  const pause = tour(page).getByRole("button", { name: "Pause tour" });
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(pause).toHaveAccessibleName("Pause tour");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "false");

  await nextUntil(page, 2, 5);
  await expect(caption(page)).toHaveText(LIVE_CAPTION);
  await expectCamera(page, "Subaru live");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  await expect.poll(async () => (await ytStub(page)).players).toBe(1);
  expect((await ytStub(page)).fs).toEqual([0]);
  await expect(page.getByTestId("sky-map")).toHaveCSS("pointer-events", "none");
  const region = await tour(page).boundingBox();
  const stage = await page.getByTestId("sky-stage").boundingBox();
  expect(region).not.toBeNull();
  expect(stage).not.toBeNull();
  if (region !== null && stage !== null) {
    const overlaps =
      region.x < stage.x + stage.width &&
      stage.x < region.x + region.width &&
      region.y < stage.y + stage.height &&
      stage.y < region.y + region.height;
    expect(overlaps, "the Tour region must not cover the sky stage").toBe(false);
  }
  // The last step: Restart and Exit, no Next.
  await expect(tour(page).getByRole("button", { name: "Restart tour" })).toBeVisible();
  await expect(nextButton(page)).toHaveCount(0);

  await focusBody(page);
  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("demo")).toBe(false);
});

// [M9 step 14f] Needs the clip's own element sets (ephemeris.ts with clip.ts's clipGpBaseUrl).
test("clip path: the clip's own element sets, and data/gp/ again on the live step", async ({
  page,
  context,
}) => {
  await context.route("**/recordings/subaru-2026-10-11-iss.gp/*.json", (route: Route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (!GP_FILES.has(file)) return route.fallback();
    return route.fulfill({
      status: 200,
      path: fileURLToPath(new URL(`../fixtures/gp/${file}`, import.meta.url)),
      contentType: "application/json",
    });
  });
  const gpRequests: string[] = [];
  page.on("request", (request: Request) => {
    // Both data/gp/ and the clip's own recordings/<clip>.gp/.
    if (/[/.]gp\//.test(request.url())) gpRequests.push(request.url());
  });
  const clipSet = (file: string) =>
    gpRequests.some((u) => u.endsWith(`/recordings/subaru-2026-10-11-iss.gp/${file}`));

  await page.goto("./?demo=1");
  await expect(startButton(page)).toBeEnabled();
  await expect
    .poll(() => clipSet("stations.json") && clipSet("visual.json"), { timeout: 5_000 })
    .toBe(true);

  await startButton(page).click();
  await expect(tour(page)).toContainText("Step 2 of 5");
  await nextUntil(page, 2, 4);
  const mark = gpRequests.length;
  await nextUntil(page, 4, 5); // live
  await expect
    .poll(() => gpRequests.slice(mark).find((u) => u.endsWith("/stations.json")) ?? "none")
    .toMatch(/\/data\/gp\/stations\.json$/);
});

test("no-clip path: without the clip the tour says so and goes straight to live", async ({
  page,
}) => {
  await page.route("**/recordings/subaru-2026-10-11-iss.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Overhead</title>",
    }),
  );
  await page.goto("./?demo=1");
  await expect(tour(page)).toContainText(NO_CLIP);
  await expect(tour(page)).toContainText("Step 1 of 2");
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toBeFocused();

  await startButton(page).click();
  await expect(tour(page)).toContainText("Step 2 of 2");
  await expect(caption(page)).toHaveText(LIVE_CAPTION);
  await expectCamera(page, "Subaru live");
  await expect(page.getByTestId("time-mode")).toHaveText("Live");
  await tour(page).getByRole("button", { name: "Previous" }).click();
  await expect(tour(page)).toContainText("Step 1 of 2");
  await expectCamera(page, "ISS pass (recorded)");
});
