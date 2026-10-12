// tests/e2e/demo.spec.ts — the ?demo=1 tour (M9 step 10; section 5). The clip path runs on M5's routed test pattern,
// served as subaru-2026-10-11-iss by the fixtures' **/recordings/** route (200 without ranges, so the Blob path); the
// computed-sky path answers the sidecar with text/html, as vite preview does for a missing file.
import { fileURLToPath } from "node:url";
import type { Page, Request, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

const CLIP_CAMERA = "Subaru StarCam: ISS pass, 2026-10-11 (recorded)";
const LIVE_CAMERA = "Subaru-Asahi StarCam (east, live)";
const MAUNAKEA = "Computed sky, Maunakea";
const INTRO =
  "A guided tour of Overhead: satellites, the ISS, the Moon, planets and bright stars, computed and drawn over a sky camera, with the same moment on a ground map.";
const NO_CLIP =
  "The recorded clip is not part of this build, so the tour runs on the computed sky.";
const GP_FILES = new Set(["stations.json", "visual.json", "starlink.json", "meta.json"]);

const tour = (page: Page) => page.getByRole("region", { name: "Tour" });
const caption = (page: Page) => tour(page).locator('[aria-live="polite"]');
const startButton = (page: Page) => tour(page).getByRole("button", { name: "Start the tour" });
const nextButton = (page: Page) => tour(page).getByRole("button", { name: "Next", exact: true });
const focusBody = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** The UTC readout as epoch ms. */
const utcMs = async (page: Page): Promise<number> =>
  Date.parse((await page.getByTestId("time-utc").innerText()).trim());

/** Polls the readout for up to 3 s until it lies in [fromIso, toIso]. */
const expectTimeWithin = (page: Page, fromIso: string, toIso: string) =>
  expect
    .poll(
      async () => {
        const t = await utcMs(page);
        return t >= Date.parse(fromIso) && t <= Date.parse(toIso)
          ? "in range"
          : new Date(t).toISOString();
      },
      { timeout: 3_000 },
    )
    .toBe("in range");

/** "Next" until the region reads "Step <to> of 8", checking each step on the way. */
async function nextUntil(page: Page, from: number, to: number): Promise<void> {
  for (let n = from + 1; n <= to; n++) {
    await nextButton(page).click();
    await expect(tour(page)).toContainText(`Step ${n} of 8`);
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

test("clip path: the intro on the recorded clip, step 1 at media 60 s, then on to the live StarCam and the end", async ({
  page,
}) => {
  await page.goto("./?demo=1");
  await expect(tour(page)).toBeVisible();
  await expect(caption(page)).toHaveText(INTRO);
  await expect(page.getByRole("radio", { name: CLIP_CAMERA })).toBeChecked();
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toBeFocused();
  await expect(tour(page)).not.toContainText(NO_CLIP);

  await startButton(page).click();
  await expect(tour(page)).toContainText("Step 1 of 8");
  await expect(page.getByRole("radio", { name: CLIP_CAMERA })).toBeChecked();
  // The 60 s seek stops at the 7 s test pattern's end.
  await expectTimeWithin(page, "2026-10-11T08:00:00Z", "2026-10-11T08:00:07Z");

  await nextUntil(page, 1, 8);
  await expect(page.getByRole("radio", { name: LIVE_CAMERA })).toBeChecked();
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

  await nextButton(page).click();
  await expect(caption(page)).toHaveText("End of the tour.");
  await expect(tour(page).getByRole("button", { name: "Restart tour" })).toBeVisible();
  await expect(tour(page)).not.toContainText("Step ");

  await focusBody(page);
  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("demo")).toBe(false);
});

// [M9 step 14f] Needs the clip's own element sets (ephemeris.ts with clip.ts's clipGpBaseUrl).
test("clip path: the clip's own element sets, and data/gp/ again from the Walenstadt step", async ({
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
  await expect(tour(page)).toContainText("Step 1 of 8");
  await nextUntil(page, 1, 6);
  const mark = gpRequests.length;
  await nextUntil(page, 6, 7); // Walenstadt
  await expect
    .poll(() => gpRequests.slice(mark).find((u) => u.endsWith("/stations.json")) ?? "none")
    .toMatch(/\/data\/gp\/stations\.json$/);
});

test("computed-sky path: without the clip the tour starts from the ISS pass in the element sets", async ({
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
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toBeFocused();

  await startButton(page).click();
  await expect(tour(page)).toContainText("Step 1 of 8");
  await expect(page.getByRole("radio", { name: MAUNAKEA })).toBeChecked();
  // The anchor is the 2026-10-10T15:56:58Z culmination − 180 s, played at 10×.
  await expectTimeWithin(page, "2026-10-10T15:53:58Z", "2026-10-10T15:54:30Z");
  // The linked step selects the ISS when it is up: wait until the sky lists it, so the frame holds its position.
  await expect(
    page
      .getByRole("list", { name: "Satellites above the horizon" })
      .getByRole("button", { name: /^ISS \(ZARYA\)/ }),
  ).toBeVisible();

  await nextButton(page).click();
  await expect(tour(page)).toContainText("Step 2 of 8");
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("ISS (ZARYA)");
  await expect
    .poll(() => {
      const params = new URL(page.url()).searchParams;
      return [params.get("sel"), params.get("demo")];
    })
    .toEqual(["sat:25544", "1"]);

  const pause = tour(page).getByRole("button", { name: "Pause tour" });
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(pause).toHaveAccessibleName("Pause tour");
});
