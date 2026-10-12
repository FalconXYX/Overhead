// tests/unit/clipControls.test.ts — M5 steps 10 and 12: ClipControlsView's status line, offers and clip information
// (renderToStaticMarkup; no DOM), and the clip's rates through the keyboard's [ and ]. The handlers and the Timeline
// are driven in Chromium by tests/e2e/clip.spec.ts.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import {
  CLIP_TEXT,
  type ClipLoadState,
  cannotPlayText,
  clipCamera,
  type LoadedClip,
  parseClipSidecar,
} from "../../src/app/clip";
import { handleKeyDown, type KeyLike } from "../../src/app/keyboard";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { createAppStore } from "../../src/state/store";
import type { CameraConfig, LocalVideoCamera, VideoState } from "../../src/state/types";
import { ClipControlsView, clipStatusText } from "../../src/ui/ClipControls";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
const registry: Record<string, CameraConfig> = parseCameraRegistry(withM5CameraEntries(committed));
const E2E: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url), "utf8"),
);
const T = Date.parse("2026-10-11T16:00:00Z");
const START = 1_791_705_600_000;
const parsed = parseClipSidecar(E2E, registry, T);
if (!parsed.ok) throw new Error(parsed.errors.join("; "));
const SIDECAR = parsed.sidecar;
const CLIP_ENTRY = registry["subaru-2026-10-11-iss"] as LocalVideoCamera;
const REPLAY = registry["local-replay"] as LocalVideoCamera;
const LOADED_CAMERA = clipCamera(CLIP_ENTRY, SIDECAR, "blob:x", registry) as LocalVideoCamera;
const LOADED_REPLAY = clipCamera(REPLAY, SIDECAR, "blob:y", registry) as LocalVideoCamera;
const CLIP: LoadedClip = {
  sidecar: SIDECAR,
  sidecarJson: E2E,
  fileName: "test-pattern.webm",
  probe: { durationS: 7, widthPx: 320, heightPx: 180 },
  notes: ["The clip is 320 × 180; it is drawn at 3840 × 2160."],
};
const LOADED: ClipLoadState = { loading: false, clip: CLIP, failure: null };

function render(
  camera: LocalVideoCamera,
  load: ClipLoadState | undefined,
  videoStatus: VideoState["status"] = "paused",
  simTimeMs = START + 2_250,
): string {
  return renderToStaticMarkup(
    createElement(ClipControlsView, {
      camera,
      videoStatus,
      load,
      simTimeMs,
      localReplayAvailable: true,
      onPickFiles: () => {},
      onReplayLocal: () => {},
      onSaveSidecar: () => {},
    }),
  );
}

/** The text of the element with data-testid, tags removed. */
function testIdText(html: string, testId: string): string {
  const m = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`).exec(html);
  return m?.[1] ?? "";
}

describe("clipStatusText", () => {
  it("prompts for files on local-replay, says loading on a clip camera, and gives a failure's message", () => {
    expect(clipStatusText(REPLAY, "idle", undefined)).toBe(
      "Pick a clip and its .json sidecar together.",
    );
    expect(clipStatusText(CLIP_ENTRY, "idle", undefined)).toBe(CLIP_TEXT.loading);
    expect(
      clipStatusText(CLIP_ENTRY, "loading", { loading: true, clip: null, failure: null }),
    ).toBe(CLIP_TEXT.loading);
    const failed: ClipLoadState = {
      loading: false,
      clip: null,
      failure: { message: CLIP_TEXT.notInBuild, problems: [] },
    };
    expect(clipStatusText(CLIP_ENTRY, "error", failed)).toBe(
      "This clip is not part of this build.",
    );
  });

  it("follows video.status once the clip is loaded; an error names the remux command", () => {
    expect(clipStatusText(LOADED_CAMERA, "paused", LOADED)).toBe(
      "Paused. The sky shows the frame on screen.",
    );
    expect(clipStatusText(LOADED_CAMERA, "playing", LOADED)).toBe(
      "Playing. The sky follows the clip.",
    );
    expect(clipStatusText(LOADED_CAMERA, "buffering", LOADED)).toBe(
      "Buffering. The sky waits for the clip.",
    );
    expect(clipStatusText(LOADED_CAMERA, "ended", LOADED)).toBe(
      "The clip ended. Play starts it again.",
    );
    expect(clipStatusText(LOADED_CAMERA, "error", LOADED)).toBe(
      cannotPlayText("test-pattern.webm"),
    );
  });

  it("a clip state left from before a reload of the registry (no videoUrl) does not count as loaded", () => {
    expect(clipStatusText(CLIP_ENTRY, "paused", LOADED)).toBe(CLIP_TEXT.loading);
  });
});

describe("ClipControlsView", () => {
  it("one status element with video.status in data-status, as the e2e tests and check-clip-pass wait on", () => {
    const html = render(LOADED_CAMERA, LOADED, "paused");
    expect(html.match(/data-testid="video-status"/g)).toHaveLength(1);
    expect(html).toMatch(/<p role="status" data-testid="video-status" data-status="paused">/);
  });

  it("shows the clip information: file, duration, position, size, start and end in UTC and HST, timing, credit", () => {
    const html = render(LOADED_CAMERA, LOADED);
    expect(html).toContain("Clip information");
    expect(html).toContain("<dd>test-pattern.webm</dd>");
    expect(html).toContain("<dd>0:07.0</dd>");
    expect(html).toContain("<dd>0:02.3</dd>"); // position at media 2.25 s
    expect(html).toContain("<dd>320 × 180 px</dd>");
    expect(testIdText(html, "clip-start")).toBe(
      "2026-10-11T08:00:00Z (2026-10-10 22:00:00 Pacific/Honolulu)",
    );
    expect(testIdText(html, "clip-end")).toMatch(/^2026-10-11T08:00:07Z /);
    expect(html).toContain("± 0 s, set by hand (manual)");
    expect(html).toContain("Test pattern generated for the Overhead e2e tests (CC0-1.0)");
    expect(html).toContain("The clip is 320 × 180; it is drawn at 3840 × 2160.");
    expect(html).toContain(">Save sidecar</button>");
    expect(html).toContain("Saves test-pattern.json with the current calibration.");
  });

  it("local-replay has the file picker for a video and its .json, picked together", () => {
    const html = render(REPLAY, undefined, "idle");
    expect(html).toMatch(
      /<input[^>]*type="file"[^>]*accept="video\/\*,\.json,application\/json"[^>]*multiple=""/,
    );
    expect(html).toContain("Clip and its .json sidecar");
    expect(html).not.toContain("Clip information");
    expect(render(LOADED_CAMERA, LOADED)).not.toContain('type="file"');
    expect(render(LOADED_REPLAY, LOADED)).toContain('type="file"'); // pick another clip
  });

  it("a failed sidecar load offers 'Replay a local clip' and lists the problems", () => {
    const failed: ClipLoadState = {
      loading: false,
      clip: null,
      failure: {
        message: CLIP_TEXT.problems,
        problems: ["videoFile must be a file name with no / or \\"],
      },
    };
    const html = render(CLIP_ENTRY, failed, "error");
    expect(testIdText(html, "video-status")).toBe("The sidecar has problems:");
    expect(html).toContain('aria-label="Sidecar problems"');
    expect(html).toContain("<li>videoFile must be a file name with no / or \\</li>");
    expect(html).toContain(">Replay a local clip</button>");
    // local-replay itself never offers itself.
    expect(render(REPLAY, failed, "error")).not.toContain("Replay a local clip");
  });
});

describe("the clip's rates through [ and ] (M5 step 12.1)", () => {
  const key = (k: string): KeyLike => ({
    key: k,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    target: null,
  });

  it("cycle 1× and 10× only on a local-video camera, and all four elsewhere", () => {
    const store = createAppStore(initialState(T, DEFAULT_CAMERA_ID));
    store.getState().actions.setRegistry({ ...registry });
    store.getState().actions.setActiveCamera("local-replay");
    const rates: number[] = [];
    for (const k of ["]", "]", "]", "[", "["]) {
      handleKeyDown(store, key(k));
      rates.push(store.getState().clock.rate);
    }
    expect(rates).toEqual([10, 10, 10, 1, 1]);
    store.getState().actions.setActiveCamera(DEFAULT_CAMERA_ID);
    handleKeyDown(store, key("]"));
    handleKeyDown(store, key("]"));
    expect(store.getState().clock.rate).toBe(60);
  });
});
