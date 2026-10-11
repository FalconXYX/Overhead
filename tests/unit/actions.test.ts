import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";

const T = 1791603000000; // 2026-10-10T03:30:00Z
const HALF = 43_200_000;

const newStore = (): AppStore => createAppStore(initialState(T, DEFAULT_CAMERA_ID));

function liveStore(): AppStore {
  const store = newStore();
  store.setState((s) => ({ clock: { ...s.clock, mode: "live", playing: true, rate: 1 } }));
  return store;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("M1 clock actions", () => {
  it("recenter from live gives paused replay at exactly that time", () => {
    const store = liveStore();
    const target = T + 50 * 3_600_000; // beyond ±12 h: seek could not reach it
    store.getState().actions.recenter(target);
    expect(store.getState().clock).toEqual({
      mode: "replay",
      playing: false,
      rate: 1,
      simTimeMs: target,
      rangeCenterMs: target,
    });
  });

  it("stepBy(+13 h) stops at centre + 12 h and switches to replay", () => {
    const store = liveStore();
    store.getState().actions.stepBy(13 * 3_600_000);
    const { clock } = store.getState();
    expect(clock.simTimeMs - clock.rangeCenterMs).toBe(HALF);
    expect(clock.mode).toBe("replay");
    expect(clock.playing).toBe(true); // stepBy keeps playing
  });

  it("stepBy moves by the delta and keeps playing", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.stepBy(1000);
    expect(store.getState().clock.simTimeMs).toBe(T + 1000);
    expect(store.getState().clock.playing).toBe(false);
    actions.play();
    actions.stepBy(-60_000);
    expect(store.getState().clock.simTimeMs).toBe(T - 59_000);
    expect(store.getState().clock.playing).toBe(true);
  });

  it("seek(centre − 50 h) clamps to −12 h and keeps playing", () => {
    const store = liveStore();
    store.getState().actions.seek(T - 50 * 3_600_000);
    const { clock } = store.getState();
    expect(clock.simTimeMs - clock.rangeCenterMs).toBe(-HALF);
    expect(clock.mode).toBe("replay");
    expect(clock.playing).toBe(true);
  });

  it("setRate(60) in live gives replay at 60", () => {
    const store = liveStore();
    store.getState().actions.setRate(60);
    const { mode, rate } = store.getState().clock;
    expect({ mode, rate }).toEqual({ mode: "replay", rate: 60 });
  });

  it('setMode("live") gives rate 1 and playing; "replay" keeps rate and playing', () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setRate(600);
    actions.setMode("live");
    const live = store.getState().clock;
    expect({ mode: live.mode, rate: live.rate, playing: live.playing }).toEqual({
      mode: "live",
      rate: 1,
      playing: true,
    });
    actions.setMode("replay");
    const replay = store.getState().clock;
    expect({ mode: replay.mode, rate: replay.rate, playing: replay.playing }).toEqual({
      mode: "replay",
      rate: 1,
      playing: true,
    });
  });

  it("jumpToNow sets both times and keeps the mode", () => {
    const now = Date.parse("2026-10-11T10:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const store = liveStore();
    store.getState().actions.jumpToNow();
    const { clock } = store.getState();
    expect(clock.simTimeMs).toBe(now);
    expect(clock.rangeCenterMs).toBe(now);
    expect(clock.mode).toBe("live");
    const replay = newStore();
    replay.getState().actions.jumpToNow();
    expect(replay.getState().clock.mode).toBe("replay");
    expect(replay.getState().clock.rangeCenterMs).toBe(now);
  });
});

describe("M1 camera, layer, data and panel actions", () => {
  it("setRegistry stores the registry", () => {
    const store = newStore();
    const registry = {};
    store.getState().actions.setRegistry(registry);
    expect(store.getState().camera.registry).toBe(registry);
  });

  it("setActiveCamera sets the id and clears frameTimeMs", () => {
    const store = newStore();
    store.setState((s) => ({ camera: { ...s.camera, frameTimeMs: T } }));
    store.getState().actions.setActiveCamera("synthetic-walenstadt");
    expect(store.getState().camera.activeId).toBe("synthetic-walenstadt");
    expect(store.getState().camera.frameTimeMs).toBeNull();
  });

  it("setLayer and toggleLayer", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setLayer("coastlines", false);
    expect(store.getState().layers.coastlines).toBe(false);
    actions.toggleLayer("coastlines");
    expect(store.getState().layers.coastlines).toBe(true);
    actions.toggleLayer("trueColor");
    expect(store.getState().layers.trueColor).toBe(false);
    expect(store.getState().layers.coastlines).toBe(true);
  });

  it("setLoadStatus", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setLoadStatus("cameras", "loading");
    actions.setLoadStatus("gibs", "error");
    expect(store.getState().data.cameras).toBe("loading");
    expect(store.getState().data.gibs).toBe("error");
    expect(store.getState().data.stars).toBe("idle");
  });

  it('openPanel, and togglePanel("layers") twice returns to null', () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.togglePanel("layers");
    expect(store.getState().ui.panel).toBe("layers");
    actions.togglePanel("layers");
    expect(store.getState().ui.panel).toBeNull();
    actions.openPanel("layers");
    expect(store.getState().ui.panel).toBe("layers");
    actions.openPanel(null);
    expect(store.getState().ui.panel).toBeNull();
  });
});
