// tests/unit/videoPanel.test.ts — VideoPanel's YouTube status line (M5 step 7; [Redesign] plain words, no error codes,
// no replay line) and the stream-delay section's arithmetic and readouts (step 9), plus VideoPanel rendered with
// renderToStaticMarkup against the app store (no DOM, so its effects do not run; the e2e spec drives them).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import { youtubeLiveTimeMs } from "../../src/domain/time";
import { store } from "../../src/state/store";
import {
  behindRealTimeText,
  delayFromClockEntry,
  secondsText,
  secondsValueText,
  skyTimeText,
  stallSinceAnchorMs,
  suggestedDelayMs,
  zonedInputValue,
} from "../../src/ui/streamDelayText";
import { VideoPanel, type VideoResolution } from "../../src/ui/VideoPanel";
import {
  behindRealTimeSec,
  liveDelayText,
  rebufferText,
  type YoutubeStatusInput,
  youtubeStatusLines,
} from "../../src/ui/videoPanelText";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const T = Date.parse("2026-10-11T08:00:00Z");
const A_MEDIA = 4_399_105.5;
const HST = "Pacific/Honolulu";

const base: YoutubeStatusInput = {
  resolving: false,
  fallbackReason: null,
  restarted: false,
  status: "idle",
  cameraOffline: false,
  behindSec: null,
  daytime: false,
};

describe("youtubeStatusLines", () => {
  it("says only that it is finding the stream while App resolves the id", () => {
    expect(youtubeStatusLines({ ...base, resolving: true, status: "playing" })).toEqual([
      "Finding the live stream…",
    ]);
  });

  it("gives one line per player status", () => {
    const line = (patch: Partial<YoutubeStatusInput>) =>
      youtubeStatusLines({ ...base, ...patch }).join(" | ");
    expect(line({ status: "idle" })).toBe(
      "Loading the live video. It starts once it is on screen.",
    );
    expect(line({ status: "loading" })).toBe(line({ status: "idle" }));
    expect(line({ status: "paused" })).toBe(
      "Paused. Press play on the video; the labels wait for it.",
    );
    expect(line({ status: "playing", behindSec: 50 })).toBe(
      "Live, about 50 s behind real time. The labels follow the video.",
    );
    expect(line({ status: "buffering" })).toBe("Buffering…");
    expect(line({ status: "ended" })).toBe("The live stream ended. Looking for a new one…");
    expect(line({ status: "ended", cameraOffline: true })).toBe(
      "The live stream has ended, and no new one was found.",
    );
    expect(line({ status: "embed-blocked" })).toBe(
      "This live stream cannot be played on this site.",
    );
    expect(line({ status: "error" })).toBe("The live video could not start.");
  });

  it("adds the fallback, restart and daytime lines around it, in plain words", () => {
    expect(
      youtubeStatusLines({
        ...base,
        status: "playing",
        behindSec: 60,
        fallbackReason: "no video id in resolver page",
        restarted: true,
        daytime: true,
      }),
    ).toEqual([
      "Showing the last known stream.",
      "The stream restarted.",
      "Live, about 60 s behind real time. The labels follow the video.",
      "It is daytime at the camera, so the sky is bright.",
    ]);
    expect(rebufferText(2)).toBe("The video stalled for 2 s, so the labels may be slightly off.");
    expect(liveDelayText(50)).toBe("about 50 s behind real time");
  });

  it("behindRealTimeSec: the delay in whole seconds without a player clock", () => {
    expect(behindRealTimeSec(50_000)).toBe(50);
    expect(behindRealTimeSec(39_500)).toBe(40);
  });
});

describe("stream delay helpers", () => {
  const anchor = { wallMs: T, mediaSec: A_MEDIA };

  it("formats seconds with one decimal", () => {
    expect(secondsText(50_000)).toBe("50.0");
    expect(secondsText(39_500)).toBe("39.5");
    expect(secondsValueText(50_000)).toBe("50.0 seconds");
  });

  it("measures the stall since the anchor: e2e test 7 is 60.0 s behind, 10.0 s of it stalls", () => {
    const stall = stallSinceAnchorMs(anchor, A_MEDIA + 20, T + 30_000);
    expect(stall).toBe(10_000);
    expect(behindRealTimeText(50_000, stall)).toBe(
      "Behind real time now: 60.0 s (10.0 s of pauses and buffering)",
    );
    expect(stallSinceAnchorMs(null, A_MEDIA, T)).toBe(0);
    expect(stallSinceAnchorMs(anchor, null, T)).toBe(0);
  });

  it("shows the sky time in the site's zone, and the clock input's value", () => {
    expect(skyTimeText(T - 50_000, HST)).toBe("Sky time: 21:59:10 HST");
    expect(zonedInputValue(T - 50_000, HST)).toBe("2026-10-10T21:59:10");
  });

  it("a burned-in clock reading of 21:59:20 HST gives 39.5 s (+ 500 ms), and the sky then shows 07:59:20.5Z", () => {
    const result = delayFromClockEntry("2026-10-10T21:59:20", HST, anchor, A_MEDIA);
    expect(result).toEqual({ kind: "ok", delayMs: 39_500 });
    if (result.kind !== "ok") return;
    expect(youtubeLiveTimeMs(T, A_MEDIA, A_MEDIA, result.delayMs)).toBe(
      Date.parse("2026-10-11T07:59:20.500Z"),
    );
    // Seconds may be dropped by the input when they are :00.
    expect(delayFromClockEntry("2026-10-10T21:59", HST, anchor, A_MEDIA)).toEqual({
      kind: "ok",
      delayMs: 59_500,
    });
  });

  it("refuses an invalid reading and a delay outside [0, 120 s]", () => {
    expect(delayFromClockEntry("2026-02-30T21:59:20", HST, anchor, A_MEDIA)).toEqual({
      kind: "invalid",
      message: "Enter a valid date and time",
    });
    expect(delayFromClockEntry("", HST, anchor, A_MEDIA).kind).toBe("invalid");
    expect(delayFromClockEntry("2026-10-10T22:01:00", HST, anchor, A_MEDIA)).toEqual({
      kind: "out-of-range",
      message: "That gives a delay of -60.5 s; check the time",
    });
    expect(delayFromClockEntry("2026-10-10T21:57:00", HST, anchor, A_MEDIA).kind).toBe(
      "out-of-range",
    );
  });

  it("suggests (now − mrt) − stall, rounded to 0.1 s; null without its inputs", () => {
    expect(suggestedDelayMs(anchor, A_MEDIA, T - 21_000)).toBe(21_000);
    expect(suggestedDelayMs(anchor, A_MEDIA + 10, T - 21_040)).toBe(31_000);
    expect(suggestedDelayMs(null, A_MEDIA, T)).toBeNull();
    expect(suggestedDelayMs(anchor, null, T)).toBeNull();
    expect(suggestedDelayMs(anchor, A_MEDIA, null)).toBeNull();
  });
});

describe("VideoPanel", () => {
  const render = (resolution: VideoResolution | null = null): string =>
    renderToStaticMarkup(createElement(VideoPanel, { resolution, onRetry: () => {} }));
  const resolved: VideoResolution = {
    cameraId: "subaru-starcam",
    videoId: "Fixture0001",
    source: "resolver",
    reason: null,
    restarted: false,
  };

  beforeEach(() => {
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T); // 22:00 HST: night at the camera
    const json: unknown = JSON.parse(
      readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
    );
    const { actions } = store.getState();
    actions.setRegistry(parseCameraRegistry(withM5CameraEntries(json)));
    actions.setActiveCamera("subaru-starcam");
    actions.setMode("live");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders nothing for synthetic and still-image cameras", () => {
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expect(render()).toBe("");
    store.getState().actions.setActiveCamera("cfht-nanaao");
    expect(render()).toBe("");
  });

  it("is the region 'Video: <name>' with a status element carrying video.status", () => {
    const html = render();
    expect(html).toContain('aria-label="Video: Subaru-Asahi StarCam (east, live)"');
    expect(html).toContain('role="status" data-testid="video-status" data-status="idle"');
    expect(html).toContain("Finding the live stream…");
    store.getState().actions.setVideoStatus("loading");
    expect(render(resolved)).toContain("Loading the live video.");
  });

  it("offers Watch on YouTube and Watch the recorded ISS pass when the embed is blocked, never a local clip", () => {
    store.getState().actions.setVideoStatus("embed-blocked", 153);
    const html = render(resolved);
    expect(html).toContain("This live stream cannot be played on this site.");
    expect(html).toContain('data-error-code="153"'); // for tests and debugging, never on screen
    expect(html).not.toContain("error 153");
    expect(html).toContain(
      'href="https://www.youtube.com/watch?v=Fixture0001" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toMatch(/<button[^>]*>Watch the recorded ISS pass<\/button>/);
    expect(html).not.toContain("Replay a local clip");
    expect(html).not.toContain("Retry");
    // On CFHT too: the recorded pass is offered from any live camera.
    store.getState().actions.setActiveCamera("cfht-starcam");
    store.getState().actions.setVideoStatus("embed-blocked", 150);
    expect(render({ ...resolved, cameraId: "cfht-starcam" })).toContain(
      "Watch the recorded ISS pass",
    );
  });

  it("offers Retry and the recorded pass after an error, and not for another camera's resolution", () => {
    store.getState().actions.setVideoStatus("error", 5);
    expect(render(resolved)).toContain("The live video could not start.");
    expect(render(resolved)).toContain("Retry");
    expect(render(resolved)).toContain("Watch the recorded ISS pass");
    expect(render(resolved)).not.toContain("Watch on YouTube");
    expect(render({ ...resolved, cameraId: "cfht-starcam" })).toContain("Finding the live stream…");
    store.getState().actions.setVideoStatus("playing");
    expect(render(resolved)).not.toContain("Watch the recorded ISS pass");
  });

  it("a clip camera shows the clip's status (ClipControls) in the same region", () => {
    store.getState().actions.setActiveCamera("subaru-2026-10-11-iss");
    const html = render();
    expect(html).toContain('aria-label="Video: Subaru StarCam: ISS pass, 2026-10-11 (recorded)"');
    expect(html).toContain("Loading the recorded video…");
  });
});
