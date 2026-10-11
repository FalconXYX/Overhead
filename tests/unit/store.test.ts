import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { createAppStore } from "../../src/state/store";
import type { Actions } from "../../src/state/types";

const T0 = Date.UTC(2026, 9, 11, 3, 20, 0); // 2026-10-11T03:20:00Z

const LANDED_ACTIONS = [
  // M0
  "tick",
  "play",
  "pause",
  "togglePlay",
  // M1
  "setMode",
  "setRate",
  "stepBy",
  "seek",
  "jumpToNow",
  "recenter",
  "setRegistry",
  "setActiveCamera",
  "setLayer",
  "toggleLayer",
  "setLoadStatus",
  "openPanel",
  "togglePanel",
  // M2
  "setStarMagLimit",
  // M3
  "select",
  "hover",
  "setFollow",
  "setGroupData",
] as const;

// Every action whose milestone has not landed, with that milestone (README section 4, actions).
// Each milestone removes its own names, test first.
const UNLANDED: Readonly<Partial<Record<keyof Actions, string>>> = {
  setCameraStatus: "M4",
  setFrameTimeMs: "M4",
  updateCalibration: "M4",
  setStreamDelayMs: "M5",
  resetCalibration: "M4",
  importCalibration: "M4",
  setFootprintHeightKm: "M8",
  setVideoLayer: "M5",
  setHorizon: "M6",
  setGoesDomain: "M7",
  setGoesStatus: "M7",
  addImagePoint: "M4",
  completePair: "M4",
  setPairRole: "M4",
  removePair: "M4",
  clearPairs: "M4",
  cancelImagePoint: "M4",
  applyFit: "M4",
  setVideoStatus: "M5",
  startDemo: "M9",
  setDemoStep: "M9",
  stopDemo: "M9",
  setDemoPaused: "M9",
};

const newStore = () => createAppStore(initialState(T0, DEFAULT_CAMERA_ID));

describe("store", () => {
  it("initialState", () => {
    const state = newStore().getState();
    expect(state.clock).toEqual({
      mode: "replay",
      playing: false,
      rate: 1,
      simTimeMs: T0,
      rangeCenterMs: T0,
    });
    expect(state.camera.activeId).toBe("synthetic-maunakea");
    expect(state.layers.starMagLimit).toBe(4.5);
    expect(state.layers.footprintHeightKm).toBeNull();
    const { stations, visual, starlink } = state.data.gp;
    expect(new Set([stations, visual, starlink]).size).toBe(3);
  });

  it("tick writes simTimeMs and nothing else", () => {
    const store = newStore();
    const before = store.getState();
    before.actions.tick(T0 + 16);
    const after = store.getState();
    expect(after.clock).toEqual({ ...before.clock, simTimeMs: T0 + 16 });
    expect(after.clock.rangeCenterMs).toBe(T0);
    expect(after.layers).toBe(before.layers);
    expect(after.actions).toBe(before.actions);
  });

  it("play, pause and togglePlay", () => {
    const store = newStore();
    const { actions } = store.getState();
    const playing: boolean[] = [];
    actions.play();
    playing.push(store.getState().clock.playing);
    actions.pause();
    playing.push(store.getState().clock.playing);
    actions.togglePlay();
    playing.push(store.getState().clock.playing);
    actions.togglePlay();
    playing.push(store.getState().clock.playing);
    expect(playing).toEqual([true, false, true, false]);
  });

  it("pause switches live to replay", () => {
    const store = newStore();
    store.setState((s) => ({ clock: { ...s.clock, mode: "live", playing: true } }));
    store.getState().actions.pause();
    const { mode, playing } = store.getState().clock;
    expect({ mode, playing }).toEqual({ mode: "replay", playing: false });
  });

  it("every later action throws and names its milestone", () => {
    const { actions } = newStore().getState();
    const unlanded = Object.entries(UNLANDED);
    expect(unlanded).toHaveLength(23); // 45 actions: 4 landed in M0, 13 in M1, 1 in M2, 4 in M3
    expect(Object.keys(actions).sort()).toEqual(
      [...LANDED_ACTIONS, ...unlanded.map(([name]) => name)].sort(),
    );
    for (const [name, milestone] of unlanded) {
      expect(milestone).toMatch(/^M[4-9]$/);
      const action = actions[name as keyof Actions];
      expect(() => Reflect.apply(action, actions, [])).toThrow(
        new RegExp(`^actions\\.${name} lands in ${milestone}$`),
      );
    }
  });
});
