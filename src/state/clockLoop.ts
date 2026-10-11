// src/state/clockLoop.ts — the one requestAnimationFrame loop. M0: replay without video.
// Live sources land in M1 (synthetic), M4 (still image) and M5 (YouTube, local video).
import { advanceReplayMs, clampToScrubRangeMs } from "../domain/time";
import type { AppStore } from "./store";

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

/** Starts the loop. Returns an idempotent stop(). A second start while one runs throws. */
export function startClockLoop(
  store: AppStore,
  scheduler: FrameScheduler = browserScheduler,
): () => void {
  if (running) throw new Error("clockLoop is already running");
  running = true;
  let lastWallMs: number | null = null;
  let handle = 0;
  let stopped = false;

  const frame = (wallMs: number): void => {
    try {
      const wallDeltaMs = lastWallMs === null ? 0 : wallMs - lastWallMs;
      lastWallMs = wallMs;
      const { clock, actions } = store.getState();
      let simTimeMs = clock.simTimeMs;
      let hitEdge = false;
      if (clock.mode === "replay" && clock.playing) {
        const advanced = advanceReplayMs(clock.simTimeMs, wallDeltaMs, clock.rate);
        simTimeMs = clampToScrubRangeMs(advanced, clock.rangeCenterMs);
        hitEdge = simTimeMs !== advanced;
      }
      if (simTimeMs !== clock.simTimeMs) actions.tick(simTimeMs);
      if (hitEdge) actions.pause();
      runUpdaters(simTimeMs);
      // M1: renderSyncAll() here, on frames where the sim time changed (README section 7).
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
