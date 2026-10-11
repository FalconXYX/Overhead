import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import {
  selectActiveCamera,
  selectCalibration,
  selectGroupMask,
  selectGroupStatus,
  selectSampleStepMs,
  selectSite,
  selectStarMagLimit,
  selectTrueColorDate,
} from "../../src/state/selectors";
import { createAppStore } from "../../src/state/store";
import type { AppState, Calibration } from "../../src/state/types";
import { storeAt } from "../helpers/store";

afterEach(() => {
  vi.useRealTimers();
});

describe("M1 selectors", () => {
  it("selectTrueColorDate follows the clock across the Maunakea flip", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    expect(selectTrueColorDate(store.getState())).toBe("2026-10-08");
    store.getState().actions.stepBy(30 * 60_000);
    expect(selectTrueColorDate(store.getState())).toBe("2026-10-09");
  });

  it("never picks a pass the real clock has not reached: sim time ahead of now uses now", () => {
    // Real time 2026-10-11T19:20Z: the newest pass with imagery at Maunakea is 2026-10-10. GIBS answers a later date
    // with 200 black tiles, so the tile-error revert cannot catch it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-11T19:20:00Z"));
    const dateAt = (iso: string) => selectTrueColorDate(storeAt(iso).getState());
    expect(dateAt("2026-10-12T07:20:48Z")).toBe("2026-10-10"); // the scrubber's right end from live
    expect(dateAt("2026-10-12T04:00:00Z")).toBe("2026-10-10");
    // At or behind now, the sim time decides.
    expect(dateAt("2026-10-11T19:20:00Z")).toBe("2026-10-10");
    expect(dateAt("2026-10-11T03:00:00Z")).toBe("2026-10-09");
    // Once the real clock passes the next flip (03:51:52.5Z), the cap follows it on the next state change.
    const store = storeAt("2026-10-12T07:20:48Z");
    vi.setSystemTime(Date.parse("2026-10-12T04:00:00Z"));
    store.getState().actions.stepBy(1_000);
    expect(selectTrueColorDate(store.getState())).toBe("2026-10-11");
  });

  it("null with an empty registry", () => {
    const store = createAppStore(
      initialState(Date.parse("2026-10-10T03:30:00Z"), DEFAULT_CAMERA_ID),
    );
    const state = store.getState();
    expect(selectTrueColorDate(state)).toBeNull();
    expect(selectSite(state)).toBeNull();
    expect(selectActiveCamera(state)).toBeUndefined();
  });

  it("selectActiveCamera and selectSite return existing references across 100 ticks", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    const camera = selectActiveCamera(store.getState());
    const site = selectSite(store.getState());
    expect(camera?.id).toBe("synthetic-maunakea");
    expect(site).toBe(camera?.site);
    for (let i = 1; i <= 100; i += 1) {
      store.getState().actions.tick(Date.parse("2026-10-10T03:30:00Z") + i * 16);
      expect(selectSite(store.getState())).toBe(site);
      expect(selectActiveCamera(store.getState())).toBe(camera);
    }
  });
});

describe("M2 selectors", () => {
  const T = Date.parse("2026-10-10T08:00:00Z");
  const stateWith = (starMagLimit: number, panel: AppState["ui"]["panel"]): AppState => {
    const s = createAppStore(initialState(T, DEFAULT_CAMERA_ID)).getState();
    // The Calibration panel lands in M4: build the state directly.
    return { ...s, layers: { ...s.layers, starMagLimit }, ui: { ...s.ui, panel } };
  };

  it("selectStarMagLimit caps the layer setting at V ≤ 4 while the Calibration panel is open", () => {
    expect(selectStarMagLimit(stateWith(4.5, "calibration"))).toBe(4);
    expect(selectStarMagLimit(stateWith(4.5, null))).toBe(4.5);
    expect(selectStarMagLimit(stateWith(4.5, "layers"))).toBe(4.5);
    expect(selectStarMagLimit(stateWith(3, "calibration"))).toBe(3);
    expect(selectStarMagLimit(stateWith(6.5, null))).toBe(6.5);
  });

  it("selectStarMagLimit follows setStarMagLimit", () => {
    const store = storeAt("2026-10-10T08:00:00Z");
    expect(selectStarMagLimit(store.getState())).toBe(4.5);
    store.getState().actions.setStarMagLimit(6);
    expect(selectStarMagLimit(store.getState())).toBe(6);
  });

  it("selectCalibration is the registry defaults object itself until the camera has its own", () => {
    const store = storeAt("2026-10-10T08:00:00Z");
    const defaults = store.getState().camera.registry["synthetic-maunakea"]?.defaults;
    expect(defaults).toBeDefined();
    expect(selectCalibration(store.getState())).toBe(defaults);
    store.getState().actions.tick(T + 16);
    expect(selectCalibration(store.getState())).toBe(defaults);

    // updateCalibration lands in M4: write camera.calibration directly.
    const stored: Calibration = { ...(defaults as Calibration), rollDeg: 179, updatedAtMs: T };
    store.setState((s) => ({
      camera: {
        ...s.camera,
        calibration: { ...s.camera.calibration, "synthetic-maunakea": stored },
      },
    }));
    expect(selectCalibration(store.getState())).toBe(stored);
    store.getState().actions.tick(T + 32);
    expect(selectCalibration(store.getState())).toBe(stored);
  });

  it("selectCalibration is undefined with an empty registry", () => {
    const store = createAppStore(initialState(T, DEFAULT_CAMERA_ID));
    expect(selectCalibration(store.getState())).toBeUndefined();
  });
});

describe("M3 selectors", () => {
  it("selectGroupMask: stations and visual always (3), Starlink while its toggle is on (7)", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    expect(selectGroupMask(store.getState())).toBe(3);
    actions.setLayer("starlink", true);
    expect(selectGroupMask(store.getState())).toBe(7);
    // The satellites toggle hides the layer only: the Inspector stays live, so the mask keeps both groups.
    actions.setLayer("satellites", false);
    expect(selectGroupMask(store.getState())).toBe(7);
    actions.setLayer("starlink", false);
    expect(selectGroupMask(store.getState())).toBe(3);
  });

  it("selectSampleStepMs is 100 ms × rate in replay and 100 ms in live", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    expect(selectSampleStepMs(store.getState())).toBe(100);
    const steps: number[] = [];
    for (const rate of [10, 60, 600] as const) {
      actions.setRate(rate);
      steps.push(selectSampleStepMs(store.getState()));
    }
    expect(steps).toEqual([1_000, 6_000, 60_000]);
    // A live state keeps its stored rate until setMode resets it; the grid uses rate 1 regardless.
    store.setState((s) => ({ clock: { ...s.clock, mode: "live" } }));
    expect(store.getState().clock.rate).toBe(600);
    expect(selectSampleStepMs(store.getState())).toBe(100);
  });

  it("selectGroupStatus reads one group's load status", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    const stations = selectGroupStatus("stations");
    const starlink = selectGroupStatus("starlink");
    expect(stations(store.getState())).toBe("idle");
    actions.setGroupData("stations", { status: "loading" });
    expect(stations(store.getState())).toBe("loading");
    expect(starlink(store.getState())).toBe("idle");
    actions.setGroupData("starlink", { status: "error" });
    expect(starlink(store.getState())).toBe("error");
    expect(selectGroupStatus("visual")(store.getState())).toBe("idle");
  });

  it("each M3 selector returns a primitive that does not change on ticks", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const fired: string[] = [];
    const unsubscribes = [
      store.subscribe(selectGroupMask, () => fired.push("mask")),
      store.subscribe(selectSampleStepMs, () => fired.push("step")),
      store.subscribe(selectGroupStatus("stations"), () => fired.push("status")),
    ];
    for (let i = 1; i <= 100; i += 1) {
      store.getState().actions.tick(Date.parse("2026-10-11T15:09:50Z") + i * 16);
    }
    for (const unsubscribe of unsubscribes) unsubscribe();
    expect(fired).toEqual([]);
  });
});
