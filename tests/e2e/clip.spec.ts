// tests/e2e/clip.spec.ts — the recorded ISS pass (M5 section 5, the clip tests; [Redesign] the site's default camera):
// it loads from its sidecar URL and plays on its own, muted (paused under reduced motion); the frame in the camera's
// pixel extent; the video as the master clock (keys, 10×, the scrubber); its credit and details; sidecar errors and a
// build without the clip, in plain words with "Watch live". No fake clock. The clip is the generated test pattern
// (scripts/fixtures/make-test-clip.ts), served as the 2026-10-11 clip camera's files by the fixtures' **/recordings/**
// route. The YouTube tests are in video.spec.ts; the picked-files camera (local-replay) is gone from the site.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import {
  CLIP_ID,
  CLIP_START_ISO,
  cameraRadio,
  clipReady,
  clockTime,
  creditsList,
  expect,
  expectSimTime,
  focusBody,
  openAlignment,
  openLayers,
  test,
} from "./fixtures";

const SIDECAR = fileURLToPath(
  new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url),
);
const SIDECAR_JSON = JSON.parse(readFileSync(SIDECAR, "utf8")) as Record<string, unknown>;
const W = 3840;
const H = 2160;

const controls = (page: Page) => page.getByRole("region", { name: "Video controls" });
const position = (page: Page) => page.getByTestId("clip-position");

/** RGB at the image pixels of the 3840 × 2160 frame, read from the sky view's first canvas (M5 section 5, test 17). */
function framePixels(page: Page, points: readonly (readonly [number, number])[]) {
  return page.evaluate(
    ({ points, w, h }) => {
      const target = document.querySelector<HTMLElement>('[data-testid="sky-map"]');
      const canvas = target?.querySelector("canvas");
      const ctx = canvas?.getContext("2d");
      if (target == null || canvas == null || ctx == null) return null;
      const box = target.getBoundingClientRect();
      const s = Math.min(box.width / w, box.height / h); // the fitted frame is contained
      const ox = (box.width - w * s) / 2;
      const oy = (box.height - h * s) / 2;
      const k = canvas.width / canvas.getBoundingClientRect().width; // CSS-scaled at DPR ≠ 1 (G20)
      return points.map(([u, v]) =>
        Array.from(
          ctx.getImageData(Math.round((ox + u * s) * k), Math.round((oy + v * s) * k), 1, 1).data,
        ).slice(0, 3),
      );
    },
    { points, w: W, h: H },
  );
}

test("the recorded clip loads from its sidecar URL and plays on its own, muted", async ({
  page,
}) => {
  // Every play() of a media element, with its muted flag (the clip's <video> is detached from the page).
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: boolean[] };
    w.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push(this.muted);
      return play.call(this);
    };
  });
  await page.goto("./");
  await expect(cameraRadio(page, "ISS pass (recorded)")).toBeChecked();
  await expect(page.getByTestId("video-status")).toHaveAttribute(
    "data-status",
    /^(playing|ended)$/,
  );
  await expect(controls(page).getByRole("button", { name: /^(Pause|Play)$/ })).toBeVisible();
  const plays = await page.evaluate(() => (window as unknown as { __plays: boolean[] }).__plays);
  expect(plays.length).toBeGreaterThanOrEqual(1);
  expect(plays.every((muted) => muted)).toBe(true);
  // It plays from its opening time (media 0 for a clip without a pass) to its end.
  await expect(position(page)).toHaveText("0:07 / 0:07", { timeout: 15_000 });
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "ended");
  await expect(page.getByTestId("video-status")).toHaveText(
    "The video ended. Press play to watch it again.",
  );
});

test.describe("reduced motion: the clip opens paused", () => {
  test.use({ reducedMotion: "reduce" });

  test("paused at its start, 1× and 10× from the keyboard only, the clip's credit and details", async ({
    page,
  }) => {
    await page.goto("./");
    await clipReady(page, "paused");
    await expectSimTime(page, CLIP_START_ISO);
    await expect(position(page)).toHaveText("0:00 / 0:07");
    await expect(page.getByTestId("video-status")).toHaveText(
      "Paused. Press play to start the video.",
    );
    await expect(page).toHaveURL(new RegExp(`\\?cam=${CLIP_ID}&t=${CLIP_START_ISO}$`));
    // No rate buttons and no "Live" on a clip; [ and ] pick 1× or 10×.
    await expect(controls(page).getByRole("radio")).toHaveCount(0);
    await expect(page.getByTestId("time-mode")).toHaveCount(0);
    await focusBody(page);
    await page.keyboard.press("]");
    await expect.poll(() => page.evaluate(() => window.__overhead?.clock().rate)).toBe(10);
    await page.keyboard.press("[");
    await expect.poll(() => page.evaluate(() => window.__overhead?.clock().rate)).toBe(1);

    const credits = creditsList(page);
    await expect(credits).toContainText("Test pattern generated for the Overhead e2e tests");
    await expect(credits).toContainText("CC0-1.0");
    const panel = page.getByRole("region", {
      name: "Video: Subaru StarCam: ISS pass, 2026-10-11 (recorded)",
    });
    await panel.getByText("About this recording").click();
    const about = panel.getByRole("definition");
    await expect(about).toHaveText([
      "2026-10-10 22:00:00 Pacific/Honolulu (2026-10-11T08:00:00Z)",
      "0:07",
      "set by hand, to within 0 s",
      "test-pattern.webm, 320 × 180 px",
    ]);
  });

  test("the frame fills the camera's pixel extent: each quadrant's colour at its centre", async ({
    page,
  }) => {
    await page.goto("./");
    await clipReady(page, "paused");
    const layers = await openLayers(page);
    // [M6] The terrain skyline is drawn over the lower part of the frame too.
    for (const name of ["Stars", "Planets and Moon", "Satellites", "Horizon line"]) {
      await layers.getByRole("checkbox", { name, exact: true }).uncheck();
    }
    await expect(
      layers.getByRole("checkbox", { name: "Grid lines", exact: true }),
    ).not.toBeChecked();
    await page.keyboard.press("Escape");
    const centres = [
      [960, 540],
      [2880, 540],
      [960, 1620],
      [2880, 1620],
    ] as const;
    const expected = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ];
    await expect
      .poll(async () => {
        const got = await framePixels(page, centres);
        if (got === null) return "no canvas";
        const worst = Math.max(
          ...got.flatMap((rgb, i) => rgb.map((c, j) => Math.abs(c - (expected[i]?.[j] ?? 0)))),
        );
        return worst <= 40 ? "ok" : JSON.stringify(got); // measured worst 2
      })
      .toBe("ok");
  });

  test("the video is the master clock: the arrow keys seek it, and 10× plays it to its end", async ({
    page,
  }) => {
    await page.goto("./");
    await clipReady(page, "paused");
    await focusBody(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expectSimTime(page, "2026-10-11T08:00:02Z");
    await expect(position(page)).toHaveText("0:02 / 0:07");
    await page.keyboard.press("]"); // 10×
    await controls(page).getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "ended");
    await expectSimTime(page, "2026-10-11T08:00:07Z"); // the committed 7.00 s clip
    await expect(position(page)).toHaveText("0:07 / 0:07");
    await expect(controls(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });

  test("the scrubber seeks the recording, by value and from the keyboard", async ({ page }) => {
    await page.goto("./");
    await clipReady(page, "paused");
    const scrubber = controls(page).getByRole("slider", { name: "Position in the recording" });
    await expect(scrubber).toHaveAttribute("aria-valuetext", "0:00 of 0:07");
    // By value, as a drag sets it, at once after the clip opens (the step race of setMediaClock, fixed).
    await scrubber.fill("4");
    await expectSimTime(page, "2026-10-11T08:00:04Z");
    await expect(position(page)).toHaveText("0:04 / 0:07");
    await expect(scrubber).toHaveAttribute("aria-valuetext", "0:04 of 0:07");
    await scrubber.focus();
    await page.keyboard.press("ArrowRight"); // the slider's own key: the clock stays paused
    await expectSimTime(page, "2026-10-11T08:00:05Z");
    await page.keyboard.press("End");
    await expectSimTime(page, "2026-10-11T08:00:07Z");
    await page.keyboard.press("Home");
    await expectSimTime(page, CLIP_START_ISO);
    await expect(controls(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
    // The UTC time is only in the tooltip.
    await expect(clockTime(page)).toHaveAttribute("title", "2026-10-11 08:00:00 UTC");
  });

  test("sidecar errors: plain words, the problems behind Details, and Watch live", async ({
    page,
  }) => {
    await page.route(`**/recordings/${CLIP_ID}.json`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...SIDECAR_JSON, videoFile: "a/test-pattern.webm" }),
      }),
    );
    await page.goto("./");
    const panel = page.getByRole("region", { name: /^Video: / });
    await expect(page.getByTestId("video-status")).toHaveText(
      "The recorded video could not be loaded.",
    );
    await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "error");
    await panel.getByText("Details").click();
    await expect(
      panel.getByRole("list", { name: "Sidecar problems" }).getByRole("listitem"),
    ).toHaveText(["videoFile must be a file name with no / or \\"]);
    await expect(panel.getByText("About this recording")).toHaveCount(0);
    // Never a black box with no explanation.
    await expect(page.getByTestId("sky-stage")).toContainText(
      "The recorded video can't be shown here.",
    );
    await expect(position(page)).toHaveText("–:–– / –:––");
    await panel.getByRole("button", { name: "Watch live" }).click();
    await expect(cameraRadio(page, "Subaru live")).toBeChecked();
  });

  test("the clip camera offers its pointing to its source camera", async ({ page }) => {
    await page.goto("./");
    await clipReady(page, "paused");
    const drawer = await openAlignment(page);
    await expect(drawer).toContainText(
      "Camera: Subaru StarCam: ISS pass, 2026-10-11 (recorded). Lens: Rectilinear.",
    );
    await drawer
      .getByRole("button", { name: "Copy pointing to Subaru-Asahi StarCam (east, live)" })
      .click();
    // Same geometry as the live camera's own: nothing changes, and the panel says so.
    await expect(drawer.locator('p[aria-live="polite"]')).toHaveText(
      /^(Pointing copied to Subaru-Asahi StarCam \(east, live\); its stream delay is unchanged\.|Subaru-Asahi StarCam \(east, live\) kept its pointing\.)$/,
    );
  });

  test("a build without the clip says so in plain words and offers Watch live", async ({
    page,
  }) => {
    await page.route("**/recordings/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Overhead</title>",
      }),
    );
    await page.goto("./");
    await expect(page.getByTestId("video-status")).toHaveText(
      "The recorded video is not included in this copy of the site.",
    );
    await expect(page.getByTestId("sky-stage")).toContainText(
      "The recorded video can't be shown here.",
    );
    await expect(page.getByRole("region", { name: /^Video: / }).getByText("Details")).toHaveCount(
      0,
    );
    await page
      .getByRole("region", { name: /^Video: / })
      .getByRole("button", { name: "Watch live" })
      .click();
    await expect(cameraRadio(page, "Subaru live")).toBeChecked();
    await expect(page.getByTestId("time-mode")).toHaveText("Live");
  });
});
