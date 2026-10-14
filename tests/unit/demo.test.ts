// tests/unit/demo.test.ts — the ?demo=1 tour (M9 step 10; [Redesign] five plain steps on the recorded ISS pass, then
// live): the step table, the clip state, "Step n of N", and the runner with fake timers, with and without the clip.
import { afterEach, describe, expect, it, vi } from "vitest";
import { enabledCameras } from "../../src/app/cameras";
import {
  DEMO_STEPS,
  demoClip,
  demoContext,
  demoIntroState,
  demoStepNumber,
  startDemoRunner,
} from "../../src/app/demo";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import { type CameraConfig, DEMO_STEP_COUNT } from "../../src/state/types";
import { committedCameras } from "../helpers/store";

const CLIP_ID = "subaru-2026-10-11-iss";
const CLIP_START_MS = 1791731310183; // 2026-10-11T15:08:30.183Z, media 0

const enabled = enabledCameras(committedCameras());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The enabled registry; with the clip loaded (videoUrl "blob:test") or not, with or without subaru-starcam. */
function registry(clipLoaded: boolean, live = true): Record<string, CameraConfig> {
  const out: Record<string, CameraConfig> = {};
  for (const [id, camera] of Object.entries(enabled)) {
    if (id === "subaru-starcam" && !live) continue;
    if (id === CLIP_ID && camera.kind === "local-video" && clipLoaded) {
      out[id] = {
        ...camera,
        source: { ...camera.source, videoUrl: "blob:test", startUtcMs: CLIP_START_MS },
      };
    } else {
      out[id] = camera;
    }
  }
  return out;
}

function tourStore(clipLoaded: boolean, live = true): AppStore {
  vi.useFakeTimers({ now: Date.parse("2026-10-11T15:20:00Z") });
  const store = createAppStore(initialState(CLIP_START_MS, DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(registry(clipLoaded, live));
  return store;
}

/** The fields the step table sets. */
function snapshot(store: AppStore) {
  const s = store.getState();
  return {
    step: s.ui.demo.step,
    camera: s.camera.activeId,
    mode: s.clock.mode,
    rate: s.clock.rate,
    playing: s.clock.playing,
    selectedId: s.selection.selectedId,
    follow: s.selection.follow,
  };
}

/** Advances exactly durationMs: one ms before it the step is unchanged. */
function runStep(store: AppStore, durationMs: number): void {
  const before = store.getState().ui.demo.step;
  vi.advanceTimersByTime(durationMs - 1);
  expect(store.getState().ui.demo.step).toBe(before);
  vi.advanceTimersByTime(1);
  expect(store.getState().ui.demo.step).toBe(before + 1);
}

const JARGON = /NORAD|OGC|GeoPose|WMTS|GIBS|GOES|azimuth|elements|Walenstadt|computed sky|R\/B/;

describe("DEMO_STEPS", () => {
  it("five steps, as many as the store's setDemoStep allows; the first and last wait for the user", () => {
    expect(DEMO_STEPS.map((s) => s.id)).toEqual(["intro", "iss", "map", "overlay", "live"]);
    expect(DEMO_STEPS).toHaveLength(DEMO_STEP_COUNT);
    expect(DEMO_STEPS.map((s) => s.durationMs)).toEqual([null, 35_000, 30_000, 25_000, null]);
  });

  it("every caption is plain: no jargon, and at most two sentences", () => {
    for (const clip of [true, false]) {
      const store = tourStore(clip);
      for (const status of ["playing", "embed-blocked"] as const) {
        store.getState().actions.setActiveCamera("subaru-starcam");
        store.getState().actions.setVideoStatus(status);
        const ctx = demoContext(store);
        for (const step of DEMO_STEPS) {
          const caption = step.caption(ctx);
          expect(caption, step.id).not.toMatch(JARGON);
          expect(
            caption.split(/[.!?](?:\s|$)/).filter(Boolean).length,
            step.id,
          ).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it("Step n of N counts the steps skip does not pass over: 5 with the clip, 2 without", () => {
    const withClip = demoContext(tourStore(true));
    const noClip = demoContext(tourStore(false));
    expect(demoStepNumber(withClip, 0)).toEqual({ n: 1, total: 5 });
    expect(demoStepNumber(withClip, 4)).toEqual({ n: 5, total: 5 });
    expect(demoStepNumber(noClip, 0)).toEqual({ n: 1, total: 2 });
    expect(demoStepNumber(noClip, 2)).toBeNull();
    expect(demoStepNumber(noClip, 4)).toEqual({ n: 2, total: 2 });
  });

  it("demoClip and demoIntroState follow the clip camera's load", () => {
    const store = tourStore(false);
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    expect(demoIntroState(store.getState())).toBe("missing");
    actions.setActiveCamera(CLIP_ID); // video status idle: the load has not started yet
    expect(demoIntroState(store.getState())).toBe("loading");
    actions.setVideoStatus("loading");
    expect(demoIntroState(store.getState())).toBe("loading");
    actions.setVideoStatus("error"); // "The recorded video is not included in this copy of the site."
    expect(demoIntroState(store.getState())).toBe("missing");
    actions.setRegistry(registry(true));
    actions.setVideoStatus("paused");
    expect(demoClip(store.getState())).toEqual({ startUtcMs: CLIP_START_MS });
    expect(demoIntroState(store.getState())).toBe("clip");
  });
});

describe("startDemoRunner with the recorded clip", () => {
  it("runs every step as the table says, each after exactly its duration, and never touches layers.video", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    actions.setMode("live");
    const video = store.getState().layers.video;
    startDemoRunner(store);
    actions.startDemo();
    expect(snapshot(store)).toMatchObject({
      step: 0,
      camera: CLIP_ID,
      mode: "replay",
      playing: false,
    });
    vi.advanceTimersByTime(3_600_000); // step 0 waits for the user
    expect(store.getState().ui.demo.step).toBe(0);

    actions.setDemoStep(1); // "Start the tour"
    expect(snapshot(store)).toEqual({
      step: 1,
      camera: CLIP_ID,
      mode: "replay",
      rate: 1,
      playing: true,
      selectedId: "sat:25544",
      follow: false,
    });
    expect(store.getState().clock.simTimeMs).toBe(1791731370183); // media 60 s
    expect(store.getState().layers).toMatchObject({ satellites: true, trails: true });

    runStep(store, 35_000);
    expect(snapshot(store)).toMatchObject({
      step: 2,
      selectedId: "sat:25544",
      follow: true,
      playing: true,
    });
    expect(store.getState().layers).toMatchObject({ footprint: true, footprintHeightKm: null });

    runStep(store, 30_000);
    expect(snapshot(store)).toMatchObject({ step: 3, camera: CLIP_ID, playing: true });
    expect(store.getState().layers).toMatchObject({ stars: true, planets: true });

    runStep(store, 25_000);
    expect(snapshot(store)).toMatchObject({
      step: 4,
      camera: "subaru-starcam",
      mode: "live",
      rate: 1,
      selectedId: null,
    });

    vi.advanceTimersByTime(3_600_000); // live is the last step: it waits for the user
    expect(store.getState().ui.demo).toEqual({ active: true, step: 4, paused: false });
    expect(store.getState().layers.video).toBe(video);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pause at 10 s keeps the remaining 25 s of the ISS step", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    startDemoRunner(store);
    actions.startDemo();
    actions.setDemoStep(1);
    vi.advanceTimersByTime(10_000);
    actions.setDemoPaused(true);
    vi.advanceTimersByTime(600_000);
    expect(store.getState().ui.demo.step).toBe(1);
    actions.setDemoPaused(false);
    runStep(store, 25_000);
  });

  it("Next while paused enters the map step and holds its full duration until resume", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    startDemoRunner(store);
    actions.startDemo();
    actions.setDemoStep(1);
    vi.advanceTimersByTime(5_000);
    actions.setDemoPaused(true);
    actions.setDemoStep(2); // "Next"
    expect(store.getState().selection.follow).toBe(true); // entered
    expect(store.getState().ui.demo.paused).toBe(true);
    vi.advanceTimersByTime(600_000);
    expect(store.getState().ui.demo.step).toBe(2);
    actions.setDemoPaused(false);
    runStep(store, 30_000);
  });

  it("stopDemo clears the timer, and the stop function unsubscribes", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    const stop = startDemoRunner(store);
    actions.startDemo();
    actions.setDemoStep(1);
    expect(vi.getTimerCount()).toBe(1);
    actions.stopDemo();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(store.getState().ui.demo).toEqual({ active: false, step: 0, paused: false });

    stop();
    actions.pause();
    actions.startDemo();
    actions.setDemoStep(1);
    expect(vi.getTimerCount()).toBe(0); // no runner any more
    expect(store.getState().clock.playing).toBe(false); // and no enter
  });
});

describe("[Redesign] the intro and the clip's autoplay", () => {
  it("holds a clip that started playing on its own before the tour began", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    actions.play(); // the clip loader's autoplay won the race with the tour's lazy module
    startDemoRunner(store);
    actions.startDemo();
    expect(snapshot(store)).toMatchObject({
      step: 0,
      camera: CLIP_ID,
      mode: "replay",
      playing: false,
    });
  });
});

describe("startDemoRunner without the clip (no computed-sky fallback)", () => {
  it("Start goes straight to live, and Previous comes back to the intro", () => {
    const store = tourStore(false);
    const { actions } = store.getState();
    startDemoRunner(store);
    actions.startDemo();
    expect(store.getState().camera.activeId).toBe(CLIP_ID); // the intro tries the clip; its load fails in the app
    actions.setDemoStep(1); // "Start the tour": the three clip steps are passed over without enter
    expect(snapshot(store)).toMatchObject({
      step: 4,
      camera: "subaru-starcam",
      mode: "live",
      selectedId: null,
    });
    expect(store.getState().layers.footprint).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    actions.setDemoStep(3); // "Previous"
    expect(store.getState().ui.demo.step).toBe(0);
    expect(store.getState().camera.activeId).toBe(CLIP_ID); // the intro entered again
  });

  it("without the live camera too, the last step stays put and says so", () => {
    const store = tourStore(false, false);
    const { actions } = store.getState();
    startDemoRunner(store);
    actions.startDemo();
    actions.setDemoStep(1);
    expect(store.getState().ui.demo.step).toBe(4);
    expect(store.getState().camera.activeId).toBe(CLIP_ID);
    expect(DEMO_STEPS[4]?.caption(demoContext(store))).toBe(
      "The live camera is not available right now.",
    );
  });
});
