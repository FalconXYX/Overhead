// tests/e2e/clip.spec.ts — M5 section 5, the clip tests (16–21): picked files on local-replay, the frame in the camera's
// pixel extent, the video as the master clock, sidecar errors, a clip camera loaded from its sidecar URL, and a build
// without the clip. No fake clock. The clip is the generated test pattern (scripts/fixtures/make-test-clip.ts); the
// fixtures' **/recordings/** route serves it as the 2026-10-11 clip camera's files. The YouTube tests are in
// video.spec.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const WEBM = fileURLToPath(new URL("../fixtures/video/test-pattern.webm", import.meta.url));
const SIDECAR = fileURLToPath(
  new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url),
);
const SIDECAR_JSON = JSON.parse(readFileSync(SIDECAR, "utf8")) as Record<string, unknown>;
const START_ISO = "2026-10-11T08:00:00Z"; // the sidecar's startUtcMs
const CLIP_CAMERA = "Subaru StarCam: ISS pass, 2026-10-11 (recorded)";
const W = 3840;
const H = 2160;

/** local-replay, ready for files: the picker is on screen and the clock no longer ticks. */
async function openLocalReplay(page: Page) {
  await page.goto("./?cam=local-replay");
  const panel = page.getByRole("region", { name: "Video: Local clip (replay)" });
  const input = panel.getByLabel("Clip and its .json sidecar");
  await expect(input).toBeAttached();
  await expect(page.getByTestId("time-mode")).toHaveText("Replay");
  return { panel, input };
}

/** Picks the test pattern and its sidecar together, and waits for the paused clip at its start. */
async function pickTestPattern(page: Page): Promise<void> {
  const { input } = await openLocalReplay(page);
  await input.setInputFiles([WEBM, SIDECAR]);
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "paused");
  await expect(page.getByTestId("time-utc")).toHaveText(START_ISO);
}

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

test("16. picked files on local-replay: paused at the clip's start, replay only, 1× and 10×, the clip's credit", async ({
  page,
}) => {
  await pickTestPattern(page);
  await expect(page.getByTestId("time-mode")).toHaveText("Replay");
  const live = page.getByRole("button", { name: "Live", exact: true });
  await expect(live).toHaveAttribute("aria-disabled", "true");
  await expect(live).toHaveAccessibleDescription("A clip has no live mode.");
  const rates = page.getByRole("group", { name: "Rate" }).getByRole("radio");
  await expect(rates).toHaveCount(2);
  await expect(page.getByRole("radio", { name: "1×", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "10×", exact: true })).toBeVisible();
  const credits = page.getByRole("region", { name: "Credits" });
  await expect(credits).toContainText("Test pattern generated for the Overhead e2e tests");
  await expect(credits).toContainText("CC0-1.0");
  const info = page.getByRole("region", { name: "Clip information" });
  await expect(info).toContainText("set by hand (manual)");
  await expect(info).toContainText("test-pattern.webm");
  await expect(info).toContainText("320 × 180 px");
});

test("17. the frame fills the camera's pixel extent: each quadrant's colour at its centre", async ({
  page,
}) => {
  await pickTestPattern(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("l");
  const layers = page.getByRole("region", { name: "Layers" });
  // [M6] The terrain skyline is drawn over the lower part of the frame too.
  const overlays = [
    /^Stars$/,
    /^Sun, Moon and planets$/,
    /^Alt\/az grid$/,
    /^Satellites/,
    /^Terrain horizon/,
  ];
  for (const name of overlays) await layers.getByRole("checkbox", { name }).uncheck();
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

test("18. the video is the master clock: steps seek it, and 10× plays it to its end", async ({
  page,
}) => {
  await pickTestPattern(page);
  const time = page.getByTestId("time-utc");
  const forward = page.getByRole("button", { name: "Forward 1 second" });
  await forward.click();
  await forward.click();
  await expect(time).toHaveText("2026-10-11T08:00:02Z");
  await page.getByRole("radio", { name: "10×", exact: true }).check();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "ended");
  const end = (await page.getByTestId("clip-end").textContent()) ?? "";
  expect(end.slice(0, 20)).toBe("2026-10-11T08:00:07Z"); // the committed 7.00 s clip
  await expect(time).toHaveText(end.slice(0, 20));
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("19. sidecar errors are listed, and no clip loads", async ({ page }) => {
  const { panel, input } = await openLocalReplay(page);
  const time = page.getByTestId("time-utc");
  const before = await time.textContent();
  await input.setInputFiles([
    { name: "test-pattern.webm", mimeType: "video/webm", buffer: readFileSync(WEBM) },
    {
      name: "test-pattern.sidecar.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...SIDECAR_JSON, videoFile: "a/test-pattern.webm" })),
    },
  ]);
  await expect(page.getByTestId("video-status")).toHaveText("The sidecar has problems:");
  await expect(
    panel.getByRole("list", { name: "Sidecar problems" }).getByRole("listitem"),
  ).toHaveText(["videoFile must be a file name with no / or \\"]);
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "error");
  await expect(time).toHaveText(before ?? "");
  await expect(page.getByRole("region", { name: "Clip information" })).toHaveCount(0);
});

test("20. a clip camera loads from its sidecar URL, and offers its pointing to the source camera", async ({
  page,
}) => {
  await page.goto("./?cam=subaru-2026-10-11-iss");
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", "paused");
  await expect(page.getByTestId("time-utc")).toHaveText(START_ISO);
  await expect(page.getByRole("region", { name: "Credits" })).toContainText(
    "Test pattern generated for the Overhead e2e tests",
  );
  await expect(page.getByRole("radio", { name: CLIP_CAMERA })).toHaveAccessibleDescription(/Live$/);
  await page.keyboard.press("c");
  await expect(
    page
      .getByRole("region", { name: "Calibration" })
      .getByRole("button", { name: "Copy pointing to Subaru-Asahi StarCam (east, live)" }),
  ).toBeVisible();
});

test("21. a build without the clip: 'not part of this build', offline, and the local-clip offer", async ({
  page,
}) => {
  await page.route("**/recordings/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Overhead</title>",
    }),
  );
  await page.goto("./?cam=subaru-2026-10-11-iss");
  await expect(page.getByTestId("video-status")).toHaveText("This clip is not part of this build.");
  await expect(page.getByRole("radio", { name: CLIP_CAMERA })).toHaveAccessibleDescription(
    /Offline$/,
  );
  await page.getByRole("button", { name: "Replay a local clip" }).click();
  await expect(
    page
      .getByRole("region", { name: "Video: Local clip (replay)" })
      .getByLabel("Clip and its .json sidecar"),
  ).toBeAttached();
});
