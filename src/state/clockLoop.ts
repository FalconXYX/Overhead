// src/state/clockLoop.ts — the one requestAnimationFrame loop (README section 7, Time). M0: replay without video.
// Live sources land in M1 (synthetic), M4 (still image) and M5 (YouTube, local video).
import { advanceReplayMs, clampToScrubRangeMs, SCRUB_HALF_RANGE_MS } from "../domain/time";
import { renderSyncAll } from "../map/registry";
import { selectActiveCamera } from "./selectors";
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

/** The live sim time, or null when this camera kind has no live source yet (M4 and M5 add theirs). */
function liveTimeMs(state: AppState): number | null {
  const camera = selectActiveCamera(state);
  // Synthetic cameras, or the registry not loaded yet: the sky shows now.
  if (camera === undefined || camera.kind === "synthetic") return Date.now();
  return null;
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
    try {
      const wallDeltaMs = lastWallMs === null ? 0 : wallMs - lastWallMs;
      lastWallMs = wallMs;
      const state = store.getState();
      const { clock, actions } = state;
      let simTimeMs = clock.simTimeMs;
      let hitEdge = false;
      if (clock.mode === "live") {
        const nowMs = liveTimeMs(state);
        if (nowMs !== null && Math.abs(nowMs - clock.rangeCenterMs) > SCRUB_HALF_RANGE_MS) {
          actions.jumpToNow(); // long live sessions keep the scrubber around now
          simTimeMs = store.getState().clock.simTimeMs;
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
      runUpdaters(simTimeMs);
      // Only on frames where the sim time changed: OpenLayers schedules its own renders for interaction,
      // tile loads and changed(), so a paused map makes 0 renders per idle second.
      if (simTimeMs !== lastRenderedMs) {
        lastRenderedMs = simTimeMs;
        renderSyncAll();
      }
    } finally {
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
