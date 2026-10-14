// src/app/demo.ts — the ?demo=1 tour (M9 step 10), [Redesign] as five short, plain steps: what you are looking at, the
// ISS crossing the recorded clip, the map, how the labels are made, then the live camera. Lazy-loaded: main.tsx
// imports it only for ?demo=1, and DemoCaptions (its region) is a lazy chunk too. Where the build lacks the recorded
// clip, the three clip steps are passed over and the tour goes straight to live; there is no computed-sky fallback.
import { ISS_NORAD_ID } from "../domain/orbits";
import type { AppStore } from "../state/store";
import type { AppState } from "../state/types";
import { activateCamera } from "./activateCamera";
import { LIVE_CAMERA_ID, RECORDED_CLIP_ID } from "./cameras";

export type DemoStepId = "intro" | "iss" | "map" | "overlay" | "live";

export interface DemoContext {
  readonly store: AppStore;
  readonly clip: { readonly startUtcMs: number } | null; // the recorded clip, once loaded; null when this build lacks it
}

export interface DemoStep {
  readonly id: DemoStepId;
  readonly durationMs: number | null; // null: waits for the user
  caption(ctx: DemoContext): string;
  skip?(ctx: DemoContext): boolean; // true: the runner passes over this step
  enter(ctx: DemoContext): void; // store actions only
}

/** The ISS step seeks the clip to media 60 s: 18.7 s before the ISS enters at the right edge (media 78.7 s). */
const DEMO_CLIP_SEEK_MS = 60_000;
const ISS_ID = `sat:${ISS_NORAD_ID}` as const;

const hasCamera = (ctx: DemoContext, id: string): boolean =>
  Object.hasOwn(ctx.store.getState().camera.registry, id);

/** Through activateCamera (the mode a video camera needs), and only when another camera is active. */
function showCamera(ctx: DemoContext, id: string): void {
  if (ctx.store.getState().camera.activeId !== id) activateCamera(ctx.store, id);
}

/** The clip steps need the recorded clip. */
const noClip = (ctx: DemoContext): boolean => ctx.clip === null;
const same = (text: string) => (): string => text;

/** The live stream cannot play: the player is blocked, failed, or the stream ended with no new one. */
function liveUnavailable(state: AppState): boolean {
  const { status } = state.video;
  return (
    status === "embed-blocked" ||
    status === "error" ||
    (status === "ended" && state.camera.status[state.camera.activeId] === "offline")
  );
}

export const DEMO_STEPS: readonly DemoStep[] = [
  {
    id: "intro",
    durationMs: null,
    caption: same(
      "This is a sky camera on Maunakea, Hawaii, filmed on the night the International Space Station flew over. The labels on the video are added by this site.",
    ),
    // The clip loader loads the clip and opens it paused, a little before the ISS enters (no autoplay during the
    // tour). A clip that loaded before the tour started may already play on its own: the intro holds it.
    enter(ctx) {
      if (!hasCamera(ctx, RECORDED_CLIP_ID)) return;
      showCamera(ctx, RECORDED_CLIP_ID);
      ctx.store.getState().actions.pause();
    },
  },
  {
    id: "iss",
    durationMs: 35_000,
    caption: same(
      "Watch the right-hand side: in about 20 seconds the International Space Station appears and glides toward the lower left. Its card tells you what it is.",
    ),
    skip: noClip,
    enter(ctx) {
      const { actions } = ctx.store.getState();
      if (ctx.clip === null) return;
      showCamera(ctx, RECORDED_CLIP_ID);
      actions.seek(ctx.clip.startUtcMs + DEMO_CLIP_SEEK_MS);
      actions.setRate(1);
      actions.play();
      actions.setLayer("satellites", true);
      actions.setLayer("trails", true);
      actions.select(ISS_ID);
    },
  },
  {
    id: "map",
    durationMs: 30_000,
    caption: same(
      "The map shows the same moment from above: where the space station is over the Earth, and the patch of sky the camera can see at its height.",
    ),
    skip: noClip,
    enter(ctx) {
      const { actions } = ctx.store.getState();
      actions.select(ISS_ID);
      actions.setFollow(true);
      actions.setLayer("footprint", true);
      actions.setFootprintHeightKm(null);
    },
  },
  {
    id: "overlay",
    durationMs: 25_000,
    caption: same(
      "Nothing is placed by hand: the site works out where each satellite, planet and star should be from public orbit data, and draws it through a model of this camera's lens.",
    ),
    skip: noClip,
    enter(ctx) {
      const { actions } = ctx.store.getState();
      actions.setLayer("stars", true);
      actions.setLayer("planets", true);
    },
  },
  {
    id: "live",
    durationMs: null,
    caption: (ctx) => {
      const state = ctx.store.getState();
      if (!hasCamera(ctx, LIVE_CAMERA_ID)) return "The live camera is not available right now.";
      if (state.camera.activeId === LIVE_CAMERA_ID && liveUnavailable(state))
        return "The live stream cannot play here right now. You can watch it on YouTube, or go back to the recorded pass.";
      return "This is the same camera, live. The labels follow the stream, which runs about a minute behind real time. Exit the tour to look around on your own.";
    },
    // The last step: DemoCaptions offers "Restart tour" (setDemoStep(0)) and "Exit tour" (stopDemo()).
    enter(ctx) {
      if (!hasCamera(ctx, LIVE_CAMERA_ID)) return;
      showCamera(ctx, LIVE_CAMERA_ID);
      const { actions } = ctx.store.getState();
      actions.setMode("live");
      actions.select(null); // the ISS is not in the live sky
    },
  },
];

/**
 * [M9] The recorded clip's start: the registry's subaru-2026-10-11-iss is a local-video camera whose clip has loaded
 * (videoUrl and startUtcMs set); else null.
 */
export function demoClip(state: AppState): { readonly startUtcMs: number } | null {
  const entry = state.camera.registry[RECORDED_CLIP_ID];
  if (entry?.kind !== "local-video") return null;
  const { videoUrl, startUtcMs } = entry.source;
  return videoUrl === null || startUtcMs === null ? null : { startUtcMs };
}

/**
 * [M9] The intro's state: "clip" once the clip has loaded; "loading" while the clip camera is active and its clip has
 * neither loaded nor failed (video status idle, before the load starts, or loading); else "missing" (the tour goes
 * straight to live).
 */
export function demoIntroState(state: AppState): "clip" | "loading" | "missing" {
  if (demoClip(state) !== null) return "clip";
  const loading =
    state.camera.activeId === RECORDED_CLIP_ID &&
    (state.video.status === "idle" || state.video.status === "loading");
  return loading ? "loading" : "missing";
}

/** [M9] "Step n of N" among the steps skip does not pass over (5, or 2 without the clip); null on a skipped step. */
export function demoStepNumber(
  ctx: DemoContext,
  step: number,
): { readonly n: number; readonly total: number } | null {
  let n = 0;
  let total = 0;
  for (const [i, s] of DEMO_STEPS.entries()) {
    if (s.skip?.(ctx) === true) continue;
    total += 1;
    if (i <= step) n += 1;
  }
  const current = DEMO_STEPS[step];
  return current === undefined || current.skip?.(ctx) === true ? null : { n, total };
}

/** [M9] A fresh DemoContext: the store and the clip. */
export function demoContext(store: AppStore): DemoContext {
  return { store, clip: demoClip(store.getState()) };
}

/** A one-shot timer that can hold its remaining time (setDemoPaused). */
function countdown(): {
  start(ms: number, fire: () => void, held: boolean): void;
  hold(): void;
  resume(): void;
  clear(): void;
} {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let fire: (() => void) | null = null;
  let remainingMs = 0;
  let startedAtMs = 0;
  const run = (): void => {
    if (fire === null || handle !== null) return;
    const f = fire;
    startedAtMs = Date.now();
    handle = setTimeout(
      () => {
        handle = null;
        fire = null;
        f();
      },
      Math.max(0, remainingMs),
    );
  };
  const clear = (): void => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
    fire = null;
  };
  return {
    start(ms, f, held) {
      clear();
      fire = f;
      remainingMs = ms;
      if (!held) run();
    },
    hold() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = null;
      remainingMs -= Date.now() - startedAtMs;
    },
    resume: run,
    clear,
  };
}

/**
 * Subscribes to ui.demo, runs skip, enter and the step timer; returns the stop function. On each step change: skip
 * passes over a step without enter (forward, or back after Previous); otherwise enter runs once and a timer of
 * durationMs moves to the next step. setDemoPaused(true) keeps the remaining time and false restarts it; a step
 * entered while paused holds its full duration until resume. stopDemo() clears the timer.
 */
export function startDemoRunner(store: AppStore): () => void {
  const stepTimer = countdown();

  /** From `from` to `to`, unless the tour has moved on or stopped meanwhile. */
  const moveOn = (from: number, to: number): void => {
    const { ui, actions } = store.getState();
    if (ui.demo.active && ui.demo.step === from) actions.setDemoStep(to);
  };
  const onStep = (step: number, previous: number | null): void => {
    stepTimer.clear();
    const def = DEMO_STEPS[step];
    if (def === undefined) return;
    const ctx = demoContext(store);
    if (def.skip?.(ctx) === true) {
      const next = previous !== null && step < previous ? step - 1 : step + 1;
      // A nested write: this listener runs again for the new step before the call returns.
      if (next >= 0 && next < DEMO_STEPS.length) store.getState().actions.setDemoStep(next);
      return;
    }
    def.enter(ctx);
    const held = store.getState().ui.demo.paused;
    if (def.durationMs !== null)
      stepTimer.start(def.durationMs, () => moveOn(step, step + 1), held);
  };

  const unsubscribe = store.subscribe(
    (s) => s.ui.demo,
    (demo, prev) => {
      if (!demo.active) {
        stepTimer.clear();
        return;
      }
      if (!prev.active || demo.step !== prev.step) {
        onStep(demo.step, prev.active ? prev.step : null);
        return;
      }
      if (demo.paused === prev.paused) return;
      if (demo.paused) stepTimer.hold();
      else stepTimer.resume();
    },
  );
  const { demo } = store.getState().ui;
  if (demo.active) onStep(demo.step, null);

  return () => {
    unsubscribe();
    stepTimer.clear();
  };
}
