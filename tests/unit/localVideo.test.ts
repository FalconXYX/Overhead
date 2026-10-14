// tests/unit/localVideo.test.ts — M5 step 11: the local-video background in Node. createVideoSource's canvas function
// with a stubbed canvas, onVideoFrames with a fake requestVideoFrameCallback, and startLocalVideo and bindBackground's
// local-video branch with a fake <video> (an EventTarget) and a store from createAppStore. Pixels are checked in
// Chromium by tests/e2e/clip.spec.ts.

import { readFileSync } from "node:fs";
import ImageLayer from "ol/layer/Image";
import ImageSource from "ol/source/Image";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import { clipCamera, parseClipSidecar } from "../../src/app/clip";
import { skyPixelProjection } from "../../src/map/sky/createSkyMap";
import { createVideoSource, onVideoFrames } from "../../src/map/sky/layers/background";
import {
  bindBackground,
  type LocalVideoDeps,
  type StartLocalVideo,
  startLocalVideo,
} from "../../src/map/sync/bindBackground";
import { getMediaClock, type LocalMediaClock, setMediaClock } from "../../src/state/clockLoop";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig, LocalVideoCamera } from "../../src/state/types";
import { withM5CameraEntries } from "../helpers/m5Cameras";
import { TEST_CAMERA_ID } from "../helpers/store";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
const registry: Record<string, CameraConfig> = parseCameraRegistry(withM5CameraEntries(committed));
const E2E: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url), "utf8"),
);
const T = Date.parse("2026-10-11T16:00:00Z");
const START = 1_791_705_600_000; // 2026-10-11T08:00:00Z
const CLIP_ID = "subaru-2026-10-11-iss";

/** The clip camera as loadClipFromSidecarUrl leaves it, playing from `videoUrl`. */
function loadedCamera(videoUrl = "blob:http://localhost:4173/1"): LocalVideoCamera {
  const parsed = parseClipSidecar(E2E, registry, T);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  const camera = clipCamera(
    registry[CLIP_ID] as LocalVideoCamera,
    parsed.sidecar,
    videoUrl,
    registry,
  );
  if (camera === null) throw new Error("clipCamera refused the e2e sidecar");
  return camera;
}

/** A <video> stand-in: the properties and events startLocalVideo uses, with Chromium's rules where they matter. */
class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  preload = "";
  src = "";
  paused = true;
  seeking = false;
  ended = false;
  duration = 7;
  readyState = 0;
  loads = 0;
  plays = 0;
  pauses = 0;
  playResult: Promise<void> = Promise.resolve();
  seeks: number[] = [];
  private time = 0;
  private rate = 1;
  get currentTime(): number {
    return this.time;
  }
  set currentTime(value: number) {
    this.seeks.push(value);
    this.time = value;
    this.seeking = true; // reads back at once, with seeking true
  }
  get playbackRate(): number {
    return this.rate;
  }
  set playbackRate(value: number) {
    if (value < 0.0625 || value > 16) throw new DOMException("rate", "NotSupportedError");
    this.rate = value;
  }
  play(): Promise<void> {
    this.plays += 1;
    if (this.paused) {
      this.paused = false;
      this.dispatchEvent(new Event("play"));
    }
    return this.playResult;
  }
  pause(): void {
    this.pauses += 1;
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  load(): void {
    this.loads += 1;
  }
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  /** Data for the first frame: as Chromium fires it, paused at media 0. */
  loaded(): void {
    this.readyState = 2;
    this.dispatchEvent(new Event("loadeddata"));
  }
  /** A seek completes. */
  seeked(): void {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
  fire(type: string): void {
    this.dispatchEvent(new Event(type));
  }
  /** Playback reached the end: Chromium sets paused, fires pause, then ended. */
  end(): void {
    this.time = this.duration;
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }
}

interface Harness {
  readonly video: FakeVideo;
  readonly sources: ImageSource[];
  readonly changed: () => number;
  readonly frame: (mediaTimeSec: number) => void;
  readonly framesStopped: () => boolean;
  readonly projections: string[];
}

function videoDeps(): { deps: LocalVideoDeps; harness: Harness } {
  const video = new FakeVideo();
  const sources: ImageSource[] = [];
  const projections: string[] = [];
  let changes = 0;
  let onFrame: ((t: number) => void) | null = null;
  let stopped = false;
  const deps: LocalVideoDeps = {
    createVideo: () => video as unknown as HTMLVideoElement,
    createSource: (_video, widthPx, heightPx, projection) => {
      projections.push(`${projection.getCode()} ${widthPx}x${heightPx}`);
      const source = new ImageSource({ projection });
      source.on("change", () => {
        changes += 1;
      });
      sources.push(source);
      return source;
    },
    onFrames: (_video, fn) => {
      onFrame = fn;
      return () => {
        stopped = true;
      };
    },
  };
  return {
    deps,
    harness: {
      video,
      sources,
      projections,
      changed: () => changes,
      frame: (t) => onFrame?.(t),
      framesStopped: () => stopped,
    },
  };
}

function setup() {
  const store: AppStore = createAppStore(initialState(T, TEST_CAMERA_ID));
  const camera = loadedCamera();
  store.getState().actions.setRegistry({ ...registry, [CLIP_ID]: camera });
  store.getState().actions.setActiveCamera(CLIP_ID);
  store.getState().actions.recenter(START); // as the loader leaves it
  const layer = new ImageLayer<ImageSource>();
  const { deps, harness } = videoDeps();
  const stop = startLocalVideo(store, layer, camera, deps);
  return { store, layer, camera, stop, ...harness };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T);
});
afterEach(() => {
  setMediaClock(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const clip = (): LocalMediaClock => {
  const c = getMediaClock();
  if (c?.kind !== "local-video") throw new Error("no local media clock");
  return c;
};

describe("createVideoSource", () => {
  function stubCanvas() {
    const draws: number[][] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_image: unknown, ...args: number[]) => draws.push(args),
      }),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
    return { canvas, draws };
  }

  it("draws the frame into the camera's pixel extent, at ratio 1, for the fitted view and a zoomed one", () => {
    const { canvas, draws } = stubCanvas();
    const projection = skyPixelProjection(3840, 2160);
    const video = { readyState: 4 } as HTMLVideoElement;
    const source = createVideoSource(video, 3840, 2160, projection);
    source.getImage([0, 0, 3840, 2160], 6, 1, projection);
    expect([canvas.width, canvas.height]).toEqual([640, 360]); // ratio 1: not 1.5 × the viewport
    expect(draws[0]?.map((n) => n + 0)).toEqual([0, 0, 640, 360]); // + 0 turns −0 into 0
    source.changed();
    source.getImage([960, 540, 2880, 1620], 3, 2, projection); // zoomed in 2×, at DPR 2
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
    const [x, y, w, h] = draws[1] ?? [];
    expect(x).toBeCloseTo(-640, 9);
    expect(y).toBeCloseTo(-360, 9);
    expect(w).toBeCloseTo(2560, 9);
    expect(h).toBeCloseTo(1440, 9);
  });

  it("draws nothing before the video has a frame, and redraws only after changed()", () => {
    const { draws } = stubCanvas();
    const projection = skyPixelProjection(3840, 2160);
    const video = { readyState: 1 } as { readyState: number };
    const source = createVideoSource(video as HTMLVideoElement, 3840, 2160, projection);
    source.getImage([0, 0, 3840, 2160], 6, 1, projection);
    expect(draws).toHaveLength(0);
    video.readyState = 2;
    source.getImage([0, 0, 3840, 2160], 6, 1, projection);
    expect(draws).toHaveLength(0); // cached (gotcha G18)
    source.changed();
    source.getImage([0, 0, 3840, 2160], 6, 1, projection);
    expect(draws).toHaveLength(1);
  });
});

describe("onVideoFrames", () => {
  it("calls onFrame with each frame's mediaTime, re-registering every time, until stop()", () => {
    const callbacks: VideoFrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const video = {
      requestVideoFrameCallback: (cb: VideoFrameRequestCallback) => callbacks.push(cb),
      cancelVideoFrameCallback: (handle: number) => cancelled.push(handle),
    } as unknown as HTMLVideoElement;
    const seen: number[] = [];
    const stop = onVideoFrames(video, (t) => seen.push(t));
    const present = (i: number, mediaTime: number): void =>
      callbacks[i]?.(0, { mediaTime } as VideoFrameCallbackMetadata);
    present(0, 0.8);
    present(1, 0.833333);
    expect(seen).toEqual([0.8, 0.833333]);
    expect(callbacks).toHaveLength(3);
    stop();
    expect(cancelled).toEqual([3]);
    present(2, 0.866667); // a callback already queued when stop() ran
    expect(seen).toEqual([0.8, 0.833333]);
    expect(callbacks).toHaveLength(3);
  });
});

describe("startLocalVideo", () => {
  it("does nothing for a clip camera whose clip has not loaded", () => {
    const store = createAppStore(initialState(T, TEST_CAMERA_ID));
    const { deps, harness } = videoDeps();
    const create = vi.spyOn(deps, "createVideo");
    const stop = startLocalVideo(
      store,
      new ImageLayer<ImageSource>(),
      registry[CLIP_ID] as LocalVideoCamera,
      deps,
    );
    expect(create).not.toHaveBeenCalled();
    stop();
    expect(harness.sources).toHaveLength(0);
  });

  it("plays the clip in a muted, inline <video>; on loadeddata: the canvas source, the clock and the frame time", () => {
    const { video, layer, sources, projections, store } = setup();
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe("auto");
    expect(video.src).toBe("blob:http://localhost:4173/1");
    expect(layer.getSource()).toBeNull();
    expect(getMediaClock()).toBeNull();
    video.loaded();
    expect(projections).toEqual(["sky-px-3840x2160 3840x2160"]);
    expect(layer.getSource()).toBe(sources[0]);
    expect(clip().startUtcMs).toBe(START);
    expect(video.seeks).toEqual([]); // the store is at media 0 already
    expect(store.getState().camera.frameTimeMs).toBe(START);
  });

  it("mediaSec is the frame callback's time while playing, currentTime while paused or seeking", () => {
    const { video, frame, changed, store } = setup();
    video.loaded();
    store.getState().actions.play();
    expect(video.plays).toBe(1);
    const before = changed();
    frame(1.04);
    expect(changed()).toBe(before + 1);
    expect(clip().mediaSec()).toBe(1.04);
    video.currentTime = 3; // a seek while playing
    expect(clip().mediaSec()).toBe(3);
    video.seeked();
    expect(clip().mediaSec()).toBe(3); // seeked resets lastMediaSec
    store.getState().actions.pause();
    expect(video.paused).toBe(true);
    expect(clip().mediaSec()).toBe(3);
  });

  it("seekToSec clamps to [0, duration]", () => {
    const { video } = setup();
    video.loaded();
    clip().seekToSec(9);
    clip().seekToSec(-2);
    clip().seekToSec(Number.NaN);
    clip().seekToSec(2.5);
    expect(video.seeks).toEqual([7, 0, 2.5]);
  });

  it("seeks to the store's time on loadeddata (a kept ?t= or a re-activation)", () => {
    const store: AppStore = createAppStore(initialState(T, TEST_CAMERA_ID));
    const camera = loadedCamera();
    store.getState().actions.setRegistry({ ...registry, [CLIP_ID]: camera });
    store.getState().actions.setActiveCamera(CLIP_ID);
    store.getState().actions.recenter(START + 3_000);
    const { deps, harness } = videoDeps();
    startLocalVideo(store, new ImageLayer<ImageSource>(), camera, deps);
    harness.video.loaded();
    expect(harness.video.seeks).toEqual([3]);
  });

  it("store → video: play, pause and the rate; a rate the video refuses is caught", () => {
    const { video, store } = setup();
    const { actions } = store.getState();
    actions.setRate(10);
    expect(video.playbackRate).toBe(10);
    actions.play();
    expect(video.paused).toBe(false);
    actions.setRate(60); // never offered with a clip; Chromium throws NotSupportedError
    expect(video.playbackRate).toBe(10);
    actions.pause();
    expect(video.paused).toBe(true);
  });

  it("a rejected play() pauses the clock and reports paused", async () => {
    const { video, store } = setup();
    video.playResult = Promise.reject(new DOMException("blocked", "NotAllowedError"));
    store.getState().actions.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().clock.playing).toBe(false);
    expect(store.getState().video.status).toBe("paused");
  });

  it("video → store: play, pause, seeked, waiting, playing, ended and error", () => {
    const { video, store } = setup();
    video.loaded();
    const { actions } = store.getState();
    actions.addImagePoint(10, 10);
    actions.play();
    expect(store.getState().video.status).toBe("playing");
    expect(store.getState().camera.frameTimeMs).toBeNull();
    video.fire("waiting");
    expect(store.getState().video.status).toBe("buffering");
    video.fire("playing");
    expect(store.getState().video.status).toBe("playing");
    actions.pause();
    expect(store.getState().video.status).toBe("paused");
    expect(store.getState().camera.frameTimeMs).toBe(START);
    video.currentTime = 2;
    video.seeked();
    expect(store.getState().camera.frameTimeMs).toBe(START + 2_000);
    expect(store.getState().calibrationUi.pendingPx).toBeNull(); // pairs belong to one frame
    actions.play();
    video.end();
    expect(store.getState().clock.playing).toBe(false);
    expect(store.getState().video.status).toBe("ended");
    expect(store.getState().camera.frameTimeMs).toBe(START + 7_000);
    video.fire("error");
    expect(store.getState().video.status).toBe("error");
  });

  it("opening the Calibration panel pauses the clip, after the listener returns", async () => {
    const { video, store } = setup();
    video.loaded();
    store.getState().actions.play();
    store.getState().actions.togglePanel("calibration");
    expect(store.getState().clock.playing).toBe(true); // no write inside the store listener
    await Promise.resolve();
    expect(store.getState().clock.playing).toBe(false);
    expect(video.paused).toBe(true);
  });

  it("stop(): frames off, its clock unregistered, the video released, the layer emptied, and no more events", async () => {
    const { video, layer, store, stop, framesStopped } = setup();
    video.loaded();
    store.getState().actions.play();
    store.getState().actions.addImagePoint(5, 5);
    stop();
    expect(framesStopped()).toBe(true);
    expect(getMediaClock()).toBeNull();
    expect(video.paused).toBe(true);
    expect(video.src).toBe("");
    expect(video.loads).toBe(1);
    expect(layer.getSource()).toBeNull();
    // The camera is still active (a new clip): its frame time and pairs belonged to the old clip. Reset in a microtask.
    await Promise.resolve();
    expect(store.getState().camera.frameTimeMs).toBeNull();
    expect(store.getState().calibrationUi.pendingPx).toBeNull();
    const status = store.getState().video.status;
    video.fire("error");
    expect(store.getState().video.status).toBe(status);
    store.getState().actions.play();
    expect(video.plays).toBe(1);
    stop(); // idempotent
    expect(video.loads).toBe(1);
  });

  it("stop() leaves another clock registered", () => {
    const { video, stop } = setup();
    video.loaded();
    const other: LocalMediaClock = {
      kind: "local-video",
      startUtcMs: 0,
      mediaSec: () => 0,
      seekToSec: () => {},
    };
    setMediaClock(other);
    stop();
    expect(getMediaClock()).toBe(other);
  });
});

describe("bindBackground, local-video branch", () => {
  it("starts the clip of the active local-video camera, and restarts it for a new clip; a camera change stops it", () => {
    const store: AppStore = createAppStore(initialState(T, TEST_CAMERA_ID));
    store.getState().actions.setRegistry({ ...registry });
    const runs: { camera: LocalVideoCamera; stopped: boolean }[] = [];
    const startVideo: StartLocalVideo = (_store, _layer, camera) => {
      const run = { camera, stopped: false };
      runs.push(run);
      return () => {
        run.stopped = true;
      };
    };
    const stills = vi.fn(() => () => {});
    const layer = new ImageLayer<ImageSource>();
    const unbind = bindBackground(store, layer, stills, startVideo);
    expect(runs).toHaveLength(0);
    store.getState().actions.setActiveCamera(CLIP_ID);
    expect(runs.map((r) => r.camera.source.videoUrl)).toEqual([null]); // not loaded: startLocalVideo does nothing
    store.getState().actions.setFrameTimeMs(START); // other subscribed changes start nothing new
    expect(runs).toHaveLength(1);
    const camera = loadedCamera();
    store
      .getState()
      .actions.setRegistry({ ...store.getState().camera.registry, [CLIP_ID]: camera });
    expect(runs.map((r) => r.stopped)).toEqual([true, false]);
    expect(runs[1]?.camera).toBe(camera);
    store.getState().actions.setActiveCamera(TEST_CAMERA_ID);
    expect(runs[1]?.stopped).toBe(true);
    expect(stills).not.toHaveBeenCalled();
    store.getState().actions.setActiveCamera(CLIP_ID);
    expect(runs).toHaveLength(3);
    unbind();
    expect(runs[2]?.stopped).toBe(true);
  });
});
