// tests/unit/clipControls.test.ts — M5 steps 10 and 12, [Redesign] in plain words: ClipControlsView's status line,
// "Watch live" when the clip cannot load or play, the technical details behind a disclosure and "About this recording"
// (renderToStaticMarkup; no DOM), and the clip's rates through the keyboard's [ and ]. No file picker, no "Save
// sidecar" and no "Replay a local clip".
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import {
  CLIP_TEXT,
  type ClipLoadState,
  clipCamera,
  type LoadedClip,
  parseClipSidecar,
} from "../../src/app/clip";
import { handleKeyDown, type KeyLike } from "../../src/app/keyboard";
import { initialState } from "../../src/state/initialState";
import { createAppStore } from "../../src/state/store";
import type { CameraConfig, LocalVideoCamera, VideoState } from "../../src/state/types";
import { ClipControlsView, clipStatusText } from "../../src/ui/ClipControls";
import { withM5CameraEntries } from "../helpers/m5Cameras";
import { TEST_CAMERA_ID } from "../helpers/store";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
const registry: Record<string, CameraConfig> = parseCameraRegistry(withM5CameraEntries(committed));
const E2E: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url), "utf8"),
);
const T = Date.parse("2026-10-11T16:00:00Z");
const parsed = parseClipSidecar(E2E, registry, T);
if (!parsed.ok) throw new Error(parsed.errors.join("; "));
const SIDECAR = parsed.sidecar;
const CLIP_ENTRY = registry["subaru-2026-10-11-iss"] as LocalVideoCamera;
const LOADED_CAMERA = clipCamera(CLIP_ENTRY, SIDECAR, "blob:x", registry) as LocalVideoCamera;
const CLIP: LoadedClip = {
  sidecar: SIDECAR,
  sidecarJson: E2E,
  fileName: "test-pattern.webm",
  probe: { durationS: 7, widthPx: 320, heightPx: 180 },
  notes: ["The clip is 320 × 180; it is drawn at 3840 × 2160."],
};
const LOADED: ClipLoadState = { loading: false, clip: CLIP, failure: null };
const MISSING: ClipLoadState = {
  loading: false,
  clip: null,
  failure: { message: CLIP_TEXT.notInBuild, problems: [] },
};
const BROKEN: ClipLoadState = {
  loading: false,
  clip: null,
  failure: {
    message: CLIP_TEXT.problems,
    problems: ["videoFile must be a file name with no / or \\"],
  },
};

function render(
  camera: LocalVideoCamera,
  load: ClipLoadState | undefined,
  videoStatus: VideoState["status"] = "paused",
  liveAvailable = true,
): string {
  return renderToStaticMarkup(
    createElement(ClipControlsView, {
      camera,
      videoStatus,
      load,
      liveAvailable,
      onWatchLive: () => {},
    }),
  );
}

/** The text of the element with data-testid, tags removed. */
function testIdText(html: string, testId: string): string {
  const m = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`).exec(html);
  return m?.[1] ?? "";
}

describe("clipStatusText", () => {
  it("says loading, and a missing clip or any other failure in plain words", () => {
    expect(clipStatusText(CLIP_ENTRY, "idle", undefined)).toBe("Loading the recorded video…");
    expect(
      clipStatusText(CLIP_ENTRY, "loading", { loading: true, clip: null, failure: null }),
    ).toBe(CLIP_TEXT.loading);
    expect(clipStatusText(CLIP_ENTRY, "error", MISSING)).toBe(
      "The recorded video is not included in this copy of the site.",
    );
    expect(clipStatusText(CLIP_ENTRY, "error", BROKEN)).toBe(
      "The recorded video could not be loaded.",
    );
  });

  it("follows video.status once the clip is loaded, with no file names or commands", () => {
    expect(clipStatusText(LOADED_CAMERA, "paused", LOADED)).toBe(
      "Paused. Press play to start the video.",
    );
    expect(clipStatusText(LOADED_CAMERA, "playing", LOADED)).toBe(
      "Playing. The labels follow the video.",
    );
    expect(clipStatusText(LOADED_CAMERA, "buffering", LOADED)).toBe("Buffering…");
    expect(clipStatusText(LOADED_CAMERA, "ended", LOADED)).toBe(
      "The video ended. Press play to watch it again.",
    );
    expect(clipStatusText(LOADED_CAMERA, "error", LOADED)).toBe(
      "This browser cannot play the recorded video.",
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

  it("a missing clip: the plain message and Watch live, never a black box, a picker or a local clip", () => {
    const html = render(CLIP_ENTRY, MISSING, "error");
    expect(testIdText(html, "video-status")).toBe(CLIP_TEXT.notInBuild);
    expect(html).toContain(">Watch live</button>");
    expect(html).not.toContain("<details>"); // nothing technical to show
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Replay a local clip");
    expect(html).not.toContain("Save sidecar");
    // Without the live camera in the registry there is nothing to offer.
    expect(render(CLIP_ENTRY, MISSING, "error", false)).not.toContain("Watch live");
  });

  it("a broken sidecar: the plain line, Watch live, and the problems under Details", () => {
    const html = render(CLIP_ENTRY, BROKEN, "error");
    expect(testIdText(html, "video-status")).toBe(CLIP_TEXT.failed);
    expect(html).toContain(">Watch live</button>");
    expect(html).toContain("<summary>Details</summary><p>The sidecar has problems:</p>");
    expect(html).toContain('aria-label="Sidecar problems"');
    expect(html).toContain("<li>videoFile must be a file name with no / or \\</li>");
  });

  it("a loaded clip: no offers; About this recording, closed, in local time with UTC after it", () => {
    const html = render(LOADED_CAMERA, LOADED);
    expect(html).not.toContain("Watch live");
    expect(html).toMatch(/<details><summary id="[^"]+">About this recording<\/summary>/);
    expect(testIdText(html, "clip-start")).toBe(
      "2026-10-10 22:00:00 Pacific/Honolulu (2026-10-11T08:00:00Z)",
    );
    expect(html).toContain("<dd>0:07</dd>");
    expect(html).toContain("<dd>set by hand, to within 0 s</dd>");
    expect(html).toContain("<dd>test-pattern.webm, 320 × 180 px</dd>");
    expect(html).toContain("The clip is 320 × 180; it is drawn at 3840 × 2160.");
    expect(html).not.toContain("Save sidecar");
    // A loaded clip the browser cannot play offers live too.
    expect(render(LOADED_CAMERA, LOADED, "error")).toContain(">Watch live</button>");
  });
});

describe("the clip's rates through [ and ] (M5 step 12.1; [Redesign] 1× and 10× only)", () => {
  const key = (k: string): KeyLike => ({
    key: k,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    target: null,
  });

  it("cycle 1× and 10× on the clip and the test cameras, and are not handled on a live camera", () => {
    const store = createAppStore(initialState(T, TEST_CAMERA_ID));
    store.getState().actions.setRegistry({ ...registry });
    store.getState().actions.setActiveCamera("subaru-2026-10-11-iss");
    const rates: number[] = [];
    for (const k of ["]", "]", "]", "[", "["]) {
      handleKeyDown(store, key(k));
      rates.push(store.getState().clock.rate);
    }
    expect(rates).toEqual([10, 10, 10, 1, 1]);
    store.getState().actions.setActiveCamera(TEST_CAMERA_ID);
    handleKeyDown(store, key("]"));
    handleKeyDown(store, key("]"));
    expect(store.getState().clock.rate).toBe(10); // never 60×
    store.getState().actions.setActiveCamera("subaru-starcam");
    store.getState().actions.setMode("live");
    expect(handleKeyDown(store, key("]"))).toBe(false);
    expect(handleKeyDown(store, key("["))).toBe(false);
    expect(store.getState().clock).toMatchObject({ mode: "live", rate: 1 });
  });
});
