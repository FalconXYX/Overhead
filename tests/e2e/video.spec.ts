// tests/e2e/video.spec.ts — M5 section 5, the YouTube tests (1–15): the sky drawn over the stub player
// (tests/fixtures/youtube/iframe_api.js), pass-through and hit targets, stage fullscreen and its guard, the live clock
// from the player's media time, the stream delay, the embed-blocked fallback and the resolver. The clip tests (16–21)
// are appended after these. The fixtures' routes serve the stub, the resolver page (Fixture0001) and the recordings.
import type { Page } from "@playwright/test";
import type { ObjectId } from "../../src/state/types";
import { expect, test } from "./fixtures";

/** The stub's hooks (tests/fixtures/youtube/iframe_api.js). */
interface YtStubPlayer {
  readonly options: { videoId: string; playerVars?: Record<string, number> };
  readonly destroyed: boolean;
}
interface YtStub {
  readonly players: YtStubPlayer[];
  readonly options: { videoId: string; playerVars?: Record<string, number> }[];
  readonly calls: {
    fn: string;
    visibleFraction?: number;
    muted?: boolean;
    w?: number;
    h?: number;
  }[];
  readonly clicks: [number, number][];
  mediaSec: number;
  mediaReferenceSec: number | null;
  autoplayBlocked: boolean;
  live(): YtStubPlayer[];
  setMedia(sec: number): void;
  emitState(code: number): void;
  emitError(code: number): void;
}
declare global {
  interface Window {
    __ytStub?: YtStub;
  }
}

/** 2026-10-11T08:00:00Z, 22:00 HST: after PLAYING the sky time is 07:59:10Z (delay 50 s). */
const T = Date.parse("2026-10-11T08:00:00Z");
/** The stub's media time at PLAYING. */
const MEDIA_0 = 4_399_105.5;
const SUBARU = "./?cam=subaru-starcam";
const SUBARU_CLIP_NAME = "Subaru StarCam: ISS pass, 2026-10-11 (recorded)";

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 1280 × 720, Date fixed at `atMs` (timers and frames keep running), then the page. */
async function openAt(page: Page, url: string, atMs = T): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.setFixedTime(new Date(atMs));
  await page.goto(url);
}

const videoStatus = (page: Page) => page.getByTestId("video-status");
const waitForStatus = (page: Page, status: string) =>
  expect(videoStatus(page)).toHaveAttribute("data-status", status);
const stubCalls = (page: Page) => page.evaluate(() => window.__ytStub?.calls ?? []);
const stubClicks = (page: Page) => page.evaluate(() => window.__ytStub?.clicks.length ?? 0);
const playCalls = (page: Page) =>
  page.evaluate(() => window.__ytStub?.calls.filter((c) => c.fn === "playVideo").length ?? 0);
const liveVideoIds = (page: Page) =>
  page.evaluate(() => window.__ytStub?.live().map((p) => p.options.videoId) ?? []);
const clientPoint = (page: Page, id: ObjectId) =>
  page.evaluate((i) => window.__overhead?.clientPoint("sky", i) ?? null, id);
const playerIframes = (page: Page) => page.getByTestId("video-player").locator("iframe");
const pickerRadio = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** The boxes of the hit targets on screen (parked ones are display: none). */
const hitTargetBoxes = (page: Page): Promise<Box[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-hit-target]")]
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
  );

/** Distance from (x, y) to a box, 0 inside it. */
function distanceToBox(x: number, y: number, b: Box): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** A point of the stage at least `marginPx` from every hit target (README step 15: an "empty point"). */
async function emptyStagePoint(page: Page, marginPx = 30): Promise<{ x: number; y: number }> {
  const stage = await boxOf(page, "[data-testid=sky-stage]");
  const targets = await hitTargetBoxes(page);
  for (let y = stage.y + stage.h * 0.3; y < stage.y + stage.h * 0.8; y += 15) {
    for (let x = stage.x + stage.w * 0.1; x < stage.x + stage.w * 0.9; x += 15) {
      if (targets.every((b) => distanceToBox(x, y, b) >= marginPx)) return { x, y };
    }
  }
  throw new Error("no empty point in the stage");
}

const elementAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el === null ? null : { tag: el.tagName, label: el.getAttribute("aria-label") };
    },
    [x, y] as const,
  );

/** Viewport CSS px → camera image px for a map that shows the whole W × H frame, contained (as check-clip-pass.ts). */
function clientToImagePx(x: number, y: number, rect: Box, widthPx: number, heightPx: number) {
  const s = Math.min(rect.w / widthPx, rect.h / heightPx);
  const ox = (rect.w - widthPx * s) / 2;
  const oy = (rect.h - heightPx * s) / 2;
  return [(x - rect.x - ox) / s, (y - rect.y - oy) / s] as const;
}

/** Moves focus out of the player (G4): app keys then reach the page's handler. */
async function focusPage(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Overhead", level: 1 }).click();
}

/** The Uranus hit target is on screen (the sky pass and the frame updater have run). */
async function uranusPoint(page: Page): Promise<{ x: number; y: number }> {
  await expect
    .poll(async () => {
      const p = await clientPoint(page, "planet:Uranus");
      return p === null ? null : (await elementAt(page, p.x, p.y))?.label;
    })
    .toBe("Uranus");
  const p = await clientPoint(page, "planet:Uranus");
  if (p === null) throw new Error("Uranus is not drawn");
  return p;
}

test.describe("YouTube StarCam", () => {
  test("1. resolves the id and embeds one muted player that starts once more than half visible", async ({
    page,
  }) => {
    const resolverRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("astroasahi.github.io/maunakea_east/")) resolverRequests.push(r.url());
    });
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    expect(resolverRequests).toHaveLength(1);
    const options = await page.evaluate(() => window.__ytStub?.options ?? []);
    expect(options[0]?.videoId).toBe("Fixture0001");
    expect(options[0]?.playerVars).toEqual({ autoplay: 0, playsinline: 1, rel: 0, fs: 0 });
    await expect(playerIframes(page)).toHaveCount(1);
    const calls = await stubCalls(page);
    const plays = calls.filter((c) => c.fn === "playVideo");
    expect(plays).toHaveLength(1);
    expect(calls.findIndex((c) => c.fn === "mute")).toBeGreaterThanOrEqual(0);
    expect(calls.findIndex((c) => c.fn === "mute")).toBeLessThan(
      calls.findIndex((c) => c.fn === "playVideo"),
    );
    expect(plays[0]?.visibleFraction ?? 0).toBeGreaterThan(0.5);
    expect(plays[0]?.muted).toBe(true);
    const credits = page.getByRole("region", { name: "Credits" });
    await expect(credits).toContainText("NAOJ & Asahi Shimbun");
    await expect(credits).toContainText("Non-commercial use only");
    await expect(
      pickerRadio(page, "Subaru-Asahi StarCam (east, live)"),
    ).toHaveAccessibleDescription(/Live$/);
  });

  test("2. the transparent sky map sits on the player, and only hit targets take the pointer", async ({
    page,
  }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    const map = await boxOf(page, "[data-testid=sky-map]");
    const iframe = await boxOf(page, "[data-testid=video-player] iframe");
    for (const k of ["x", "y", "w", "h"] as const)
      expect(Math.abs(map[k] - iframe[k])).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("sky-stage").getByTestId("sky-map")).toHaveCount(1);
    await expect(page.getByTestId("sky-stage").getByTestId("video-player")).toHaveCount(1);
    const pointerEvents = await page
      .getByTestId("sky-map")
      .evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe("none");
    const uranus = await uranusPoint(page);
    expect(await elementAt(page, uranus.x, uranus.y)).toEqual({ tag: "BUTTON", label: "Uranus" });
    // The "On the video" group, unchecked by default.
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    const group = page.getByRole("group", { name: "On the video" });
    await expect(group).toBeVisible();
    await expect(group.getByRole("checkbox")).toHaveCount(3);
    for (const box of await group.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
    await page.goto("./?cam=synthetic-maunakea");
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByRole("group", { name: "On the video" })).toHaveCount(0);
  });

  test("3. a click on an empty point of the overlay reaches the player", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await uranusPoint(page);
    const p = await emptyStagePoint(page);
    expect((await elementAt(page, p.x, p.y))?.tag).toBe("IFRAME");
    const before = await stubClicks(page);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => stubClicks(page)).toBe(before + 1);
    // The click reached the player, not the map: nothing was selected (the URL write is debounced, the Inspector is not).
    await expect(page.getByRole("region", { name: "Inspector" })).toContainText(
      "Nothing selected.",
    );
  });

  test("4. hit targets hover and select; the hover card lets clicks through", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    const uranus = await uranusPoint(page);
    await page.mouse.move(uranus.x, uranus.y);
    const card = page.getByRole("tooltip");
    await expect(card).toContainText("Uranus");
    const cardBox = await boxOf(page, '[role="tooltip"]');
    const targets = await hitTargetBoxes(page);
    const inside = [
      [cardBox.x + cardBox.w - 3, cardBox.y + cardBox.h - 3],
      [cardBox.x + cardBox.w - 3, cardBox.y + 3],
      [cardBox.x + cardBox.w / 2, cardBox.y + cardBox.h / 2],
    ].find(([x = 0, y = 0]) => targets.every((b) => distanceToBox(x, y, b) > 0));
    expect(inside).toBeDefined();
    const [ix = 0, iy = 0] = inside ?? [];
    expect((await elementAt(page, ix, iy))?.tag).toBe("IFRAME");
    const before = await stubClicks(page);
    await page.mouse.click(uranus.x, uranus.y);
    await expect(page).toHaveURL(/[?&]sel=planet:Uranus(&|$)/);
    await expect(page.getByRole("region", { name: "Inspector" })).toContainText("Uranus");
    expect(await stubClicks(page)).toBe(before);
  });

  test("5. stage fullscreen keeps the overlay on the player's content box", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    const before = await uranusPoint(page);
    const beforePx = clientToImagePx(
      before.x,
      before.y,
      await boxOf(page, "[data-testid=sky-map]"),
      3840,
      2160,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid")))
      .toBe("sky-stage");
    await expect
      .poll(async () =>
        (await stubCalls(page)).some((c) => c.fn === "setSize" && c.w === 1440 && c.h === 900),
      )
      .toBe(true);
    for (const selector of ["[data-testid=video-player] iframe", "[data-testid=sky-map]"]) {
      await expect
        .poll(async () => {
          const b = await boxOf(page, selector);
          return [Math.round(b.w), Math.round(b.h)];
        })
        .toEqual([1440, 900]);
    }
    // The frame is contained: a 1440 × 810 box 45 px from the top, as the player letterboxes the video.
    await expect
      .poll(async () => {
        const p = await clientPoint(page, "planet:Uranus");
        if (p === null) return Number.POSITIVE_INFINITY;
        const [u, v] = clientToImagePx(
          p.x,
          p.y,
          await boxOf(page, "[data-testid=sky-map]"),
          3840,
          2160,
        );
        return Math.hypot(u - beforePx[0], v - beforePx[1]);
      })
      .toBeLessThanOrEqual(1);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });

  test("6. the player's own fullscreen (the f key) is undone with a note", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await uranusPoint(page);
    const p = await emptyStagePoint(page);
    const before = await stubClicks(page);
    await page.mouse.click(p.x, p.y); // focuses the player's iframe
    await expect.poll(() => stubClicks(page)).toBe(before + 1);
    await page.keyboard.press("f");
    await expect(
      page.getByText("Use this Fullscreen button to keep the sky on the video."),
    ).toBeVisible({
      timeout: 1000,
    });
    // exitFullscreen() is asynchronous: the iframe leaves fullscreen just after the note renders.
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null), { timeout: 1000 })
      .toBe(true);
  });

  test("7. live time follows the player's media clock and the stream delay", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T07:59:10Z");
    await expect(page.getByTestId("time-mode")).toHaveText("Live");
    await page.clock.setFixedTime(new Date(T + 30_000));
    await page.evaluate((sec) => window.__ytStub?.setMedia(sec), MEDIA_0 + 20);
    await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T07:59:30Z");
    await focusPage(page);
    await page.keyboard.press("c");
    const panel = page.getByRole("region", { name: "Calibration" });
    await expect(panel).toContainText("Behind real time now: 60.0 s");
    await panel.getByLabel("Stream delay (exact), seconds", { exact: true }).fill("30");
    await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T07:59:50Z");
  });

  test("8. the Timeline's pause leaves the player alone, and Live follows it again", async ({
    page,
  }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await focusPage(page);
    await page.keyboard.press(" ");
    await expect(page.getByTestId("time-mode")).toHaveText("Replay");
    await expect(videoStatus(page)).toContainText("Replay: the sky does not follow the video.");
    expect((await stubCalls(page)).filter((c) => c.fn === "pauseVideo")).toHaveLength(0);
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.getByTestId("time-mode")).toHaveText("Live");
  });

  test("9. a rebuffer of 2 s asks to check the delay", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await page.evaluate(() => window.__ytStub?.emitState(3));
    await waitForStatus(page, "buffering");
    await page.clock.setFixedTime(new Date(T + 2_000));
    await page.evaluate(() => window.__ytStub?.emitState(1));
    await expect(videoStatus(page)).toContainText(
      "The video rebuffered for 2 s. Check the delay on the next satellite.",
    );
  });

  for (const code of [101, 150, 153] as const) {
    test(`10. YouTube error ${code} falls back to replay`, async ({ page }) => {
      const resolverRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("astroasahi.github.io/maunakea_east/")) resolverRequests.push(r.url());
      });
      await openAt(page, SUBARU);
      await waitForStatus(page, "playing");
      await page.evaluate((c) => window.__ytStub?.emitError(c), code);
      await waitForStatus(page, "embed-blocked");
      expect(resolverRequests).toHaveLength(code === 153 ? 1 : 2);
      await expect(videoStatus(page)).toContainText(
        `cannot be played here (YouTube error ${code})`,
      );
      await expect(page.getByRole("link", { name: "Watch on YouTube" })).toHaveAttribute(
        "href",
        "https://www.youtube.com/watch?v=Fixture0001",
      );
      await expect(playerIframes(page)).toHaveCount(0);
      await expect(page.getByTestId("sky-stage").getByTestId("sky-map")).toHaveCount(1);
      await expect(
        pickerRadio(page, "Subaru-Asahi StarCam (east, live)"),
      ).toHaveAccessibleDescription(/Offline$/);
      await expect(page.getByTestId("time-mode")).toHaveText("Replay");
      if (code !== 153) return;
      await page
        .getByRole("button", { name: `Replay the recorded clip: ${SUBARU_CLIP_NAME}` })
        .click();
      await expect(page).toHaveURL(/[?&]cam=subaru-2026-10-11-iss(&|$)/);
      await waitForStatus(page, "paused");
      await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T08:00:00Z");
    });
  }

  test("11. error 150 with a new id from the resolver restarts the player with it", async ({
    page,
  }) => {
    let requests = 0;
    await page.route("**/astroasahi.github.io/**", (route) => {
      requests += 1;
      const id = requests === 1 ? "Fixture0001" : "Fixture0002";
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: { "access-control-allow-origin": "*" },
        body: `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=https://youtu.be/${id}"><title>Redirecting...</title></head><body>Redirecting...</body></html>`,
      });
    });
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await page.evaluate(() => window.__ytStub?.emitError(150));
    await expect(videoStatus(page)).toContainText(
      "The stream restarted with a new id. Check the delay.",
    );
    await expect.poll(() => liveVideoIds(page)).toEqual(["Fixture0002"]);
    await expect(playerIframes(page)).toHaveCount(1);
  });

  test("12. a resolver page without an id falls back to the last known id", async ({ page }) => {
    await page.route("**/astroasahi.github.io/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: { "access-control-allow-origin": "*" },
        body: "<!DOCTYPE html><html><head><title>Moved</title></head><body>No stream today</body></html>",
      }),
    );
    await openAt(page, SUBARU);
    await expect(videoStatus(page)).toContainText("Using the last known video id");
    await expect.poll(() => liveVideoIds(page)).toEqual(["Kj5DjRYkzD8"]);
  });

  test("13. one player across camera switches", async ({ page }) => {
    const westRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("astroasahi.github.io/maunakea_west/")) westRequests.push(r.url());
    });
    await openAt(page, SUBARU);
    // [M9] Below 900 px the panes stack (layout.css) and the picker sits below the sky view; at 1280 px the split view
    // keeps the stage in view beside the sidebar, and the autoplay gate (step 5.5) would have nothing to hold.
    await page.setViewportSize({ width: 820, height: 720 });
    await waitForStatus(page, "playing");
    await expect(playerIframes(page)).toHaveCount(1);
    expect(await liveVideoIds(page)).toHaveLength(1);
    for (const name of ["CFHT-Asahi StarCam (west, live)", "Subaru-Asahi StarCam (east, live)"]) {
      const created = await page.evaluate(() => window.__ytStub?.players.length ?? 0);
      const plays = await playCalls(page);
      await pickerRadio(page, name).check();
      await expect
        .poll(() => page.evaluate(() => window.__ytStub?.players.length ?? 0))
        .toBe(created + 1);
      // The picker sits below the sky view: choosing a camera scrolled the stage out of view, so the autoplay gate
      // holds the new player (step 5.5) until the stage is more than half visible again.
      await expect(page.getByTestId("video-player")).not.toBeInViewport({ ratio: 0.5 });
      expect(await playCalls(page)).toBe(plays);
      await page.getByTestId("sky-stage").scrollIntoViewIfNeeded();
      await waitForStatus(page, "playing");
      expect(await playCalls(page)).toBe(plays + 1);
      await expect(playerIframes(page)).toHaveCount(1);
      expect(await liveVideoIds(page)).toHaveLength(1);
    }
    expect(westRequests.length).toBeGreaterThanOrEqual(1);
  });

  test("14. the player's undocumented reference time suggests a delay", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await page.evaluate(
      (sec) => {
        if (window.__ytStub !== undefined) window.__ytStub.mediaReferenceSec = sec;
      },
      (T - 21_000) / 1000,
    );
    await focusPage(page);
    await page.keyboard.press("c");
    const panel = page.getByRole("region", { name: "Calibration" });
    await expect(panel).toContainText("The player suggests 21.0 s (undocumented API)");
    await panel.getByRole("button", { name: "Apply suggestion" }).click();
    await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T07:59:39Z");
  });

  test("15. the video's burned-in clock sets the delay", async ({ page }) => {
    await openAt(page, SUBARU);
    await waitForStatus(page, "playing");
    await focusPage(page);
    await page.keyboard.press("c");
    const panel = page.getByRole("region", { name: "Calibration" });
    await panel.getByLabel("Video clock (Pacific/Honolulu)").fill("2026-10-10T21:59:20");
    await panel.getByRole("button", { name: "Apply video clock" }).click();
    await expect(panel).toContainText("Delay at start of playback: 39.5 s");
    await expect(page.getByTestId("time-utc")).toHaveText("2026-10-11T07:59:20Z");
  });
});
