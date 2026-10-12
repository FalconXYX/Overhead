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
  // M4
  "setCameraStatus",
  "setFrameTimeMs",
  "updateCalibration",
  "resetCalibration",
  "importCalibration",
  "addImagePoint",
  "completePair",
  "setPairRole",
  "removePair",
  "clearPairs",
  "cancelImagePoint",
  "applyFit",
  // M5
  "setStreamDelayMs",
  "setVideoLayer",
  "setVideoStatus",
  // M6
  "setHorizon",
  // M7
  "setGoesDomain",
  "setGoesStatus",
  // M8
  "setFootprintHeightKm",
  // M9
  "startDemo",
  "setDemoStep",
  "stopDemo",
  "setDemoPaused",
] as const satisfies readonly (keyof Actions)[];

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

  it("every action has landed: the 45 names, and none throws 'lands in'", () => {
    const { actions } = newStore().getState();
    // 45 actions: 4 landed in M0, 13 in M1, 1 in M2, 4 in M3, 12 in M4, 3 in M5, 1 in M6, 2 in M7, 1 in M8, 4 in M9
    expect(LANDED_ACTIONS).toHaveLength(45);
    expect(Object.keys(actions).sort()).toEqual([...LANDED_ACTIONS].sort());
    for (const name of LANDED_ACTIONS) {
      // Fresh store per call: the arguments are nonsense, so only a placeholder's "lands in" throw matters.
      const fresh = newStore().getState().actions;
      let message = "";
      try {
        Reflect.apply(fresh[name], fresh, []);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message, name).not.toMatch(/ lands in M\d+$/);
    }
  });
});
