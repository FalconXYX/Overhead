// src/map/sync/bindBackground.ts — the still-image refresh loop of the active camera (M4 step 10), and [M5] a local
// clip's <video> (M5 step 11). At most one of them runs. The still-image loop is stopped while the Calibration panel is
// open with an image on screen (the frame is frozen while calibrating); a clip pauses instead. Every camera change,
// and every new clip, stops it and empties the layer.
import type ImageLayer from "ol/layer/Image";
import type Projection from "ol/proj/Projection";
import type ImageSource from "ol/source/Image";
import { shallow } from "zustand/vanilla/shallow";
import { estimatedFrameTimeMs, stillImageErrorStatusAt } from "../../app/stillImage";
import { localVideoTimeMs } from "../../domain/time";
import { getMediaClock, type LocalMediaClock, setMediaClock } from "../../state/clockLoop";
import { selectActiveCamera } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { CameraConfig, LocalVideoCamera, StillImageCamera } from "../../state/types";
import { skyPixelProjection } from "../sky/createSkyMap";
import {
  createVideoSource,
  onVideoFrames,
  type StillRefreshOptions,
  startStillImageRefresh,
} from "../sky/layers/background";

/** startStillImageRefresh's shape; unit tests inject a fake so they run without a DOM. */
export type StartStillImageRefresh = (
  layer: ImageLayer<ImageSource>,
  projection: Projection,
  options: StillRefreshOptions,
) => () => void;

/**
 * [M4] Natural size of the still image on screen, written in place on every load and reset to 0 × 0 on a camera
 * change. The sky view and the Calibration panel read it during render and pass it to imageSizeNotice.
 */
export const backgroundImageSize: { cameraId: string | null; widthPx: number; heightPx: number } = {
  cameraId: null,
  widthPx: 0,
  heightPx: 0,
};

// ---- [M5] A local clip (M5 step 11.3) ----

/** [M5] What startLocalVideo builds on: the DOM in the app, fakes in unit tests. */
export interface LocalVideoDeps {
  createVideo(): HTMLVideoElement;
  createSource(
    video: HTMLVideoElement,
    widthPx: number,
    heightPx: number,
    projection: Projection,
  ): ImageSource;
  onFrames(video: HTMLVideoElement, onFrame: (mediaTimeSec: number) => void): () => void;
}
const browserVideoDeps: LocalVideoDeps = {
  createVideo: () => document.createElement("video"),
  createSource: createVideoSource,
  onFrames: onVideoFrames,
};

/** [M5] startLocalVideo's shape; unit tests of bindBackground inject a fake. */
export type StartLocalVideo = (
  store: AppStore,
  layer: ImageLayer<ImageSource>,
  camera: LocalVideoCamera,
) => () => void;

/**
 * [M5] Plays a loaded clip (source.videoUrl and startUtcMs set) in a detached, muted <video> as the sky view's
 * background, and registers it as the master clock; a clip that has not loaded does nothing. Returns stop().
 * - loadeddata: an ImageCanvas source in the camera's pixel projection, redrawn on every frame callback and `seeked`;
 *   a seek to the store's time (a ?t= or the time on re-activation, clamped to the clip); then setMediaClock.
 * - Store to video, through one subscription to [clock.playing, clock.rate]: play() (a rejection pauses the clock),
 *   pause(), and playbackRate inside try/catch. Opening the Calibration panel pauses the clock.
 * - Video to store: play and playing → "playing" and frameTimeMs null; pause → "paused" and the frame's UTC as
 *   frameTimeMs; seeked while paused → that frameTimeMs and clearPairs(); waiting → "buffering"; ended → the clock's
 *   pause() and "ended"; error → "error".
 * - stop(): frame callbacks off, setMediaClock(null) if the clock is still this clip's, pause, drop the src, load(),
 *   and layer.setSource(null); while the camera stays active (a new clip), frameTimeMs null and clearPairs().
 */
export function startLocalVideo(
  store: AppStore,
  layer: ImageLayer<ImageSource>,
  camera: LocalVideoCamera,
  deps: LocalVideoDeps = browserVideoDeps,
): () => void {
  const { videoUrl, startUtcMs } = camera.source;
  if (videoUrl === null || startUtcMs === null) return () => {};
  const { widthPx, heightPx } = camera.imageSize;
  const actions = () => store.getState().actions;
  const video = deps.createVideo();
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  let source: ImageSource | null = null;
  let stopFrames: (() => void) | null = null;
  let lastMediaSec = 0; // the frame on screen while playing (rVFC metadata.mediaTime)
  let stopped = false;
  const frameUtcMs = (): number => localVideoTimeMs(startUtcMs, video.currentTime);

  const clock: LocalMediaClock = {
    kind: "local-video",
    startUtcMs,
    mediaSec: () => (video.paused || video.seeking ? video.currentTime : lastMediaSec),
    seekToSec: (mediaSec) => {
      if (!Number.isFinite(mediaSec)) return;
      const end = Number.isFinite(video.duration) ? Math.max(video.duration, 0) : 0;
      video.currentTime = Math.min(Math.max(mediaSec, 0), end); // reads back at once, with seeking true
    },
  };

  const listeners: Record<string, () => void> = {
    loadeddata: () => {
      lastMediaSec = video.currentTime;
      if (source !== null) return;
      const shown = deps.createSource(
        video,
        widthPx,
        heightPx,
        skyPixelProjection(widthPx, heightPx),
      );
      source = shown;
      layer.setSource(shown);
      stopFrames = deps.onFrames(video, (mediaTimeSec) => {
        lastMediaSec = mediaTimeSec;
        shown.changed();
      });
      // The store's time: recenter(startUtcMs) put it at media 0; a kept ?t= or a re-activation may not have.
      const offsetSec = (store.getState().clock.simTimeMs - startUtcMs) / 1000;
      if (offsetSec !== video.currentTime) clock.seekToSec(offsetSec);
      setMediaClock(clock);
      if (video.paused) actions().setFrameTimeMs(frameUtcMs());
    },
    seeked: () => {
      lastMediaSec = video.currentTime;
      source?.changed(); // no frame callback is promised for a paused seek (gotcha G17)
      if (!video.paused) return;
      actions().setFrameTimeMs(frameUtcMs());
      actions().clearPairs(); // pairs belong to one frame
    },
    play: () => {
      lastMediaSec = video.currentTime;
      actions().setVideoStatus("playing");
      actions().setFrameTimeMs(null);
    },
    playing: () => actions().setVideoStatus("playing"), // also after a rebuffer
    pause: () => {
      actions().setVideoStatus("paused");
      actions().setFrameTimeMs(frameUtcMs());
    },
    waiting: () => actions().setVideoStatus("buffering"),
    ended: () => {
      actions().pause();
      actions().setVideoStatus("ended");
    },
    error: () => actions().setVideoStatus("error"),
  };
  for (const [type, listener] of Object.entries(listeners)) video.addEventListener(type, listener);

  const unsubscribeClock = store.subscribe(
    (s) => [s.clock.playing, s.clock.rate] as const,
    ([playing, rate]) => {
      try {
        video.playbackRate = rate;
      } catch {
        // NotSupportedError outside 0.0625–16 (gotcha G16): the Timeline offers only 1× and 10× with a clip.
      }
      if (!playing) {
        video.pause();
      } else if (video.paused) {
        video.play().catch(() => {
          if (stopped) return;
          video.pause();
          actions().pause();
          actions().setVideoStatus("paused");
        });
      }
    },
    { equalityFn: shallow, fireImmediately: true },
  );
  // The frame is frozen while calibrating, as for stills (M5 step 11.3.7).
  // Deferred, like the reset in stop(): this runs inside bindBackground's own listener (README binding rule 4).
  const unsubscribePanel = store.subscribe(
    (s) => s.ui.panel === "calibration",
    (calibrating) => {
      if (!calibrating) return;
      queueMicrotask(() => {
        const state = store.getState();
        if (!stopped && state.ui.panel === "calibration" && state.clock.playing) actions().pause();
      });
    },
    { fireImmediately: true },
  );
  video.src = videoUrl;

  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribeClock();
    unsubscribePanel();
    for (const [type, listener] of Object.entries(listeners))
      video.removeEventListener(type, listener);
    stopFrames?.();
    if (getMediaClock() === clock) setMediaClock(null);
    video.pause();
    video.removeAttribute("src");
    video.load();
    layer.setSource(null);
    if (store.getState().camera.activeId === camera.id) {
      // A new clip on the same camera: its frame time and pairs belong to the old one. Deferred: stop() runs inside
      // bindBackground's listener, and a nested write would hand later listeners the older state (README binding rule 4).
      queueMicrotask(() => {
        if (store.getState().camera.activeId !== camera.id) return;
        actions().setFrameTimeMs(null);
        actions().clearPairs();
      });
    }
  };
}

/**
 * Runs startStillImageRefresh for a still-image camera, in that camera's pixel projection (built when it starts, never
 * captured at bind time: setCameraModel swaps the view's projection with the frame size). Subscribes to the active
 * camera's registry entry, `ui.panel === "calibration"` and `frameTimeMs !== null`:
 * - still-image camera, panel closed: the loop runs (started if it is not running);
 * - panel open with an image on screen: the loop stops and keeps the image; panel closed again: it starts at once;
 * - camera change (or a new registry entry): stop, `layer.setSource(null)`, then start for a still-image camera.
 * Each load: setFrameTimeMs(load time − captureLagMs), setCameraStatus(id, "live"), clearPairs(). Each error:
 * setCameraStatus(id, "daytime" while the Sun is up at the site, else "offline"); frameTimeMs and the image stay.
 * [M5] A local-video camera runs startVideo (startLocalVideo), which does nothing until the clip has a videoUrl.
 */
export function bindBackground(
  store: AppStore,
  layer: ImageLayer<ImageSource>,
  start: StartStillImageRefresh = startStillImageRefresh,
  startVideo: StartLocalVideo = startLocalVideo,
): () => void {
  let stopLoop: (() => void) | null = null;
  let stopVideo: (() => void) | null = null; // [M5]
  let bound: CameraConfig | undefined | null = null; // null: nothing bound yet

  const halt = (): void => {
    const stop = stopLoop;
    stopLoop = null;
    stop?.();
    const stopClip = stopVideo;
    stopVideo = null;
    stopClip?.();
  };

  const isCurrent = (camera: StillImageCamera): boolean =>
    selectActiveCamera(store.getState()) === camera;

  const options = (camera: StillImageCamera): StillRefreshOptions => ({
    imageUrl: camera.source.imageUrl,
    refreshSec: camera.source.refreshSec,
    corsEnabled: camera.source.corsEnabled,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
    onLoad: (loadedAtMs, naturalWidthPx, naturalHeightPx) => {
      if (!isCurrent(camera)) return; // a loop of a camera that is no longer active
      backgroundImageSize.cameraId = camera.id;
      backgroundImageSize.widthPx = naturalWidthPx;
      backgroundImageSize.heightPx = naturalHeightPx;
      const { actions } = store.getState();
      actions.setFrameTimeMs(estimatedFrameTimeMs(loadedAtMs, camera.source.captureLagMs));
      actions.setCameraStatus(camera.id, "live");
      actions.clearPairs(); // pairs belong to one frame
    },
    onError: () => {
      if (!isCurrent(camera)) return;
      const status = stillImageErrorStatusAt(camera.site, Date.now());
      store.getState().actions.setCameraStatus(camera.id, status);
    },
  });

  const unsubscribe = store.subscribe(
    (s) =>
      [selectActiveCamera(s), s.ui.panel === "calibration", s.camera.frameTimeMs !== null] as const,
    ([camera, calibrating, imageOnScreen]) => {
      if (camera !== bound) {
        halt();
        if (bound !== null) layer.setSource(null);
        backgroundImageSize.cameraId = camera?.id ?? null;
        backgroundImageSize.widthPx = 0;
        backgroundImageSize.heightPx = 0;
        bound = camera;
      }
      // [M5] A clip camera plays once its clip has loaded (a new clip is a new registry entry, so it restarts).
      if (camera?.kind === "local-video") {
        if (stopVideo === null) stopVideo = startVideo(store, layer, camera);
        return;
      }
      if (camera?.kind !== "still-image") return;
      if (calibrating && imageOnScreen) {
        halt(); // frozen while calibrating
        return;
      }
      if (stopLoop === null) {
        const { widthPx, heightPx } = camera.imageSize;
        stopLoop = start(layer, skyPixelProjection(widthPx, heightPx), options(camera));
      }
    },
    { equalityFn: shallow, fireImmediately: true },
  );

  return () => {
    unsubscribe();
    halt();
  };
}
