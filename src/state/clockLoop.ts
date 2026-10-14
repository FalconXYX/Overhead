// src/state/clockLoop.ts — the one requestAnimationFrame loop (README section 7, Time). M0: replay without video.
// Live sources land in M1 (synthetic), M4 (still image) and M5 (YouTube, local video); frameCount in M3.
import {
  advanceReplayMs,
  clampToScrubRangeMs,
  localVideoTimeMs,
  SCRUB_HALF_RANGE_MS,
  youtubeLiveTimeMs,
} from "../domain/time";
import { renderSyncAll } from "../map/registry";
import { selectActiveCamera, selectStreamDelayMs } from "./selectors";
import type { AppStore } from "./store";
import type { AppState } from "./types";

export type FrameUpdater = (simTimeMs: number) => void;

/** requestAnimationFrame in the app; a manual fake in unit tests. */
export interface FrameScheduler {
  request(callback: (wallMs: number) => void): number;
  cancel(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

const updaters = new Set<FrameUpdater>();
let running = false;
/** Frame callbacks since the app started, across loop restarts: it never goes back. */
let frames = 0;

/** [M3] Frames since start, incremented at the start of each frame callback. */
export function frameCount(): number {
  return frames;
}

/** Runs fn once per frame, after the tick, in registration order. Returns the unregister function. */
export function registerFrameUpdater(fn: FrameUpdater): () => void {
  updaters.add(fn);
  return () => {
    updaters.delete(fn);
  };
}

function runUpdaters(simTimeMs: number): void {
  for (const fn of updaters) {
    try {
      fn(simTimeMs);
    } catch (error) {
      updaters.delete(fn); // one failure must not stop the clock or flood the console
      console.error("Frame updater failed and was removed", error);
    }
  }
}

/** [M5] The YouTube player's clock, registered by mountYoutubePlayer. */
export interface YoutubeMediaClock {
  readonly kind: "youtube";
  /** player.getCurrentTime() when it is a finite number, else null. */
  mediaSec(): number | null;
  /** Taken at the first PLAYING with a finite getCurrentTime() > 0 after a video id loads; null before. */
  anchor(): { readonly wallMs: number; readonly mediaSec: number } | null;
  /** mediaReferenceTimeMs(player): undocumented, null when absent. */
  mediaReferenceTimeMs(): number | null;
}
/** [M5] A local clip's clock, registered by bindBackground. */
export interface LocalMediaClock {
  readonly kind: "local-video";
  readonly startUtcMs: number;
  /** rVFC metadata.mediaTime of the frame on screen while playing; video.currentTime when paused or seeking. */
  mediaSec(): number;
  /** Sets video.currentTime clamped to [0, duration]. */
  seekToSec(mediaSec: number): void;
}
export type MediaClock = YoutubeMediaClock | LocalMediaClock; // [M5]

let mediaClock: MediaClock | null = null;
/** [M5] clock.simTimeMs as it stood after the last frame; null right after setMediaClock (nothing remembered). */
let rememberedSimMs: number | null = null;

/**
 * [M5] One media clock at a time; null unregisters. Resets the loop's "user moved time" memory to `simTimeMs`: null
 * (the default) lets the video win on the next frame. [Redesign] A clip passes the store's time it has just seeked
 * its video to, so a seek, step or scrub made before that next frame still moves the video instead of being lost.
 */
export function setMediaClock(clock: MediaClock | null, simTimeMs: number | null = null): void {
  mediaClock = clock;
  rememberedSimMs = simTimeMs;
}

/** [M5] */
export function getMediaClock(): MediaClock | null {
  return mediaClock;
}

/** The live sim time, or null when this camera kind has no live source yet, or this frame must not tick. */
function liveTimeMs(state: AppState): number | null {
  const camera = selectActiveCamera(state);
  // Synthetic cameras, or the registry not loaded yet: the sky shows now.
  if (camera === undefined || camera.kind === "synthetic") return Date.now();
  // [M4] A still image: the capture time of the image on screen, or now until the first image loads.
  if (camera.kind === "still-image") return state.camera.frameTimeMs ?? Date.now();
  // [M5] YouTube: the player's media clock from its anchor, offset by the stream delay; now − delay until it has
  // one. A null media time skips the tick, so the sky freezes while the player pauses or buffers.
  if (camera.kind === "youtube") {
    const delayMs = selectStreamDelayMs(state);
    const clock = mediaClock?.kind === "youtube" ? mediaClock : null;
    const anchor = clock?.anchor() ?? null;
    if (clock === null || anchor === null) return Date.now() - delayMs;
    const mediaSec = clock.mediaSec();
    return mediaSec === null
      ? null
      : youtubeLiveTimeMs(anchor.wallMs, anchor.mediaSec, mediaSec, delayMs);
  }
  return null;
}

/**
 * [M5] A local clip's sim time this frame (M5 step 6.2). A clock.simTimeMs that differs from the value remembered
 * after the last frame was written by the user (a seek, step, scrub or recentre): seek the video there once and keep
 * it. Otherwise, including the first frame after setMediaClock without a time (nothing remembered), the video wins.
 */
function localClipTimeMs(clip: LocalMediaClock, simTimeMs: number): number {
  if (rememberedSimMs !== null && simTimeMs !== rememberedSimMs) {
    clip.seekToSec((simTimeMs - clip.startUtcMs) / 1000);
    return simTimeMs;
  }
  return localVideoTimeMs(clip.startUtcMs, clip.mediaSec());
}

/** Starts the loop. Returns an idempotent stop(). A second start while one runs throws. */
export function startClockLoop(
  store: AppStore,
  scheduler: FrameScheduler = browserScheduler,
): () => void {
  if (running) throw new Error("clockLoop is already running");
  running = true;
  let lastWallMs: number | null = null;
  // The sim time the maps last rendered: a user's seek or step while paused also counts as a change.
  let lastRenderedMs = store.getState().clock.simTimeMs;
  let handle = 0;
  let stopped = false;

  const frame = (wallMs: number): void => {
    frames += 1; // first: the tick's listeners and every updater see this frame's number
    const t0 = performance.now(); // [M9] the overhead:frame measure (README section 9)
    try {
      const wallDeltaMs = lastWallMs === null ? 0 : wallMs - lastWallMs;
      lastWallMs = wallMs;
      const state = store.getState();
      const { clock, actions } = state;
      let simTimeMs = clock.simTimeMs;
      let hitEdge = false;
      if (selectActiveCamera(state)?.kind === "local-video") {
        // [M5] A clip is its own master clock, in either mode (M5 step 6.2–6.3); without one there is no tick, and
        // advanceReplayMs never runs while a clip is registered.
        if (mediaClock?.kind === "local-video") simTimeMs = localClipTimeMs(mediaClock, simTimeMs);
      } else if (clock.mode === "live") {
        const nowMs = liveTimeMs(state);
        if (nowMs !== null && Math.abs(nowMs - clock.rangeCenterMs) > SCRUB_HALF_RANGE_MS) {
          // Long live sessions keep the scrubber around now. [M4] Only the wall clock recentres: a still image's
          // capture time far from now is clamped to the range edge, so jumpToNow does not run on every frame.
          if (Math.abs(Date.now() - clock.rangeCenterMs) > SCRUB_HALF_RANGE_MS) actions.jumpToNow();
          simTimeMs = clampToScrubRangeMs(nowMs, store.getState().clock.rangeCenterMs);
        } else if (nowMs !== null) {
          simTimeMs = nowMs;
        }
      } else if (clock.playing) {
        const advanced = advanceReplayMs(clock.simTimeMs, wallDeltaMs, clock.rate);
        simTimeMs = clampToScrubRangeMs(advanced, clock.rangeCenterMs);
        hitEdge = simTimeMs !== advanced;
      }
      if (simTimeMs !== store.getState().clock.simTimeMs) actions.tick(simTimeMs);
      if (hitEdge) actions.pause();
      // [M5] A later change the loop did not write is the user's (a seek, step, scrub or recentre).
      rememberedSimMs = store.getState().clock.simTimeMs;
      runUpdaters(simTimeMs);
      // Only on frames where the sim time changed: OpenLayers schedules its own renders for interaction,
      // tile loads and changed(), so a paused map makes 0 renders per idle second.
      if (simTimeMs !== lastRenderedMs) {
        lastRenderedMs = simTimeMs;
        renderSyncAll();
      }
    } finally {
      // [M9] The main-thread frame budget: collected by tests/perf/starlink.perf.ts with a PerformanceObserver,
      // which still receives the entry after it is cleared (README section 9, rule 8).
      performance.measure("overhead:frame", { start: t0 });
      performance.clearMeasures("overhead:frame");
      if (!stopped) handle = scheduler.request(frame);
    }
  };

  handle = scheduler.request(frame);
  return () => {
    if (stopped) return; // a stale stop() must not clear `running` for a newer loop
    stopped = true;
    running = false;
    scheduler.cancel(handle);
  };
}
