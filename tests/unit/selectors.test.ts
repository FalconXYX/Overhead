import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import type { TimeInterval } from "../../src/domain/time";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import {
  selectActiveCamera,
  selectCalibration,
  selectGoesLabel,
  selectGoesStepMs,
  selectGoesVisible,
  selectGroupMask,
  selectGroupStatus,
  selectHorizonProfileDeg,
  selectHorizonStatus,
  selectIncomingActive,
  selectIncomingMask,
  selectLiveLocked,
  selectSampleStepMs,
  selectSite,
  selectSkyDenseLabels,
  selectSkyLayerVisible,
  selectSkyOverVideo,
  selectStarMagLimit,
  selectStreamDelayMs,
  selectTrueColorDate,
} from "../../src/state/selectors";
import { createAppStore } from "../../src/state/store";
import type { AppState, Calibration } from "../../src/state/types";
import { withM5CameraEntries } from "../helpers/m5Cameras";
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

describe("M5 selectors", () => {
  /** The committed cameras plus M5's entries (the two clip cameras), at 2026-10-11T08:00Z. */
  function videoStore(activeId: string) {
    const store = storeAt("2026-10-11T08:00:00Z");
    const json: unknown = JSON.parse(
      readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
    );
    store.getState().actions.setRegistry(parseCameraRegistry(withM5CameraEntries(json)));
    store.getState().actions.setActiveCamera(activeId);
    return store;
  }

  it("selectStreamDelayMs: the camera's default, then the stored delay; 0 for other kinds", () => {
    const store = videoStore("subaru-starcam");
    expect(selectStreamDelayMs(store.getState())).toBe(50_000);
    store.getState().actions.setStreamDelayMs(22_000);
    expect(selectStreamDelayMs(store.getState())).toBe(22_000);
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expect(selectStreamDelayMs(store.getState())).toBe(0);
    store.getState().actions.setActiveCamera("subaru-2026-10-11-iss");
    expect(selectStreamDelayMs(store.getState())).toBe(0);
  });

  it("selectLiveLocked: live mode on a youtube camera only", () => {
    const store = videoStore("subaru-starcam");
    const { actions } = store.getState();
    actions.setMode("live");
    expect(selectLiveLocked(store.getState())).toBe(true);
    actions.setMode("replay");
    expect(selectLiveLocked(store.getState())).toBe(false);
    actions.setActiveCamera("synthetic-maunakea");
    actions.setMode("live");
    expect(selectLiveLocked(store.getState())).toBe(false);
  });

  it("selectSkyOverVideo and selectStarMagLimit by camera kind and panel", () => {
    const store = videoStore("subaru-starcam");
    const { actions } = store.getState();
    const at = (id: string) => {
      actions.setActiveCamera(id);
      return [selectSkyOverVideo(store.getState()), selectStarMagLimit(store.getState())];
    };
    expect(at("subaru-starcam")).toEqual([true, 2]);
    expect(at("local-replay")).toEqual([true, 2]);
    expect(at("synthetic-maunakea")).toEqual([false, 4.5]);
    expect(at("cfht-nanaao")).toEqual([false, 4.5]);
    actions.setActiveCamera("subaru-starcam");
    actions.openPanel("calibration");
    expect(selectStarMagLimit(store.getState())).toBe(4);
    actions.openPanel(null);
    actions.setStarMagLimit(1.5);
    expect(selectStarMagLimit(store.getState())).toBe(1.5); // the layer limit still caps it
  });

  it("selectSkyLayerVisible: grid and Starlink need their layers.video gate over a video", () => {
    const store = videoStore("subaru-starcam");
    const { actions } = store.getState();
    const grid = selectSkyLayerVisible("grid");
    const starlink = selectSkyLayerVisible("starlink");
    expect(grid(store.getState())).toBe(false);
    actions.setVideoLayer("grid", true);
    expect(grid(store.getState())).toBe(true);
    actions.setLayer("grid", false);
    expect(grid(store.getState())).toBe(false);
    expect(starlink(store.getState())).toBe(false);
    actions.setLayer("starlink", true);
    expect(starlink(store.getState())).toBe(false);
    actions.setVideoLayer("starlink", true);
    expect(starlink(store.getState())).toBe(true);
    actions.setLayer("starlink", false);
    expect(starlink(store.getState())).toBe(false);
    expect(selectSkyLayerVisible("stars")(store.getState())).toBe(true);
    // A synthetic camera follows the plain toggle.
    actions.setActiveCamera("synthetic-maunakea");
    actions.setVideoLayer("grid", false);
    actions.setLayer("grid", true);
    expect(grid(store.getState())).toBe(true);
  });

  it("selectSkyDenseLabels: off over a video until layers.video.denseLabels", () => {
    const store = videoStore("subaru-starcam");
    expect(selectSkyDenseLabels(store.getState())).toBe(false);
    store.getState().actions.setVideoLayer("denseLabels", true);
    expect(selectSkyDenseLabels(store.getState())).toBe(true);
    store.getState().actions.setVideoLayer("denseLabels", false);
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expect(selectSkyDenseLabels(store.getState())).toBe(true);
  });
});

describe("M7 selectors", () => {
  const at = (iso: string): number => Date.parse(iso);
  /** parseGoesDomain of tests/fixtures/gibs/goes-domain.xml. */
  const FIXTURE: readonly TimeInterval[] = [
    [at("2026-10-07T12:00:00Z"), at("2026-10-07T19:20:00Z")],
    [at("2026-10-07T19:40:00Z"), at("2026-10-07T21:00:00Z")],
    [at("2026-10-07T21:20:00Z"), at("2026-10-11T00:00:00Z")],
  ];

  it("selectGoesLabel and selectGoesVisible follow the caption table (M7 step 3)", () => {
    const store = storeAt("2026-10-11T00:05:00Z");
    const { actions } = store.getState();
    const label = () => selectGoesLabel(store.getState());
    const visible = () => selectGoesVisible(store.getState());
    expect(label()).toBeNull(); // off
    expect(visible()).toBe(false);
    actions.setLayer("goesIr", true);
    expect(label()).toBe("Loading GOES-West availability…"); // idle
    actions.setGoesStatus("loading");
    expect(label()).toBe("Loading GOES-West availability…");
    actions.setGoesStatus("error");
    expect(label()).toBe("GOES-West availability failed to load");
    expect(visible()).toBe(false);
    actions.setGoesDomain(FIXTURE, at("2026-10-10T23:40:00Z"));
    expect(label()).toBe("GOES-West tiles failed to load"); // the tile guard's error
    actions.setGoesStatus("ready");
    expect(label()).toBe("Imagery as of 2026-10-10 23:40 UTC");
    expect(visible()).toBe(true);
    actions.seek(at("2026-10-10T12:05:00Z"));
    expect(label()).toBe("Imagery as of 12:00 UTC");
    expect(selectGoesStepMs(store.getState())).toBe(at("2026-10-10T12:00:00Z"));
    actions.setGoesDomain([[at("2026-10-10T13:00:00Z"), at("2026-10-10T23:40:00Z")]], null);
    expect(label()).toBe("No GOES-West imagery for this time (NASA GIBS keeps 90 days)");
    expect(visible()).toBe(false);
    expect(selectGoesStepMs(store.getState())).toBeNull();
    actions.setLayer("goesIr", false);
    expect(label()).toBeNull();
  });

  it("selectGoesStepMs changes once per 10-minute step", () => {
    const store = storeAt("2026-10-10T09:58:00Z");
    store.getState().actions.setGoesDomain(FIXTURE, at("2026-10-11T00:00:00Z"));
    const fired: (number | null)[] = [];
    const unsubscribe = store.subscribe(selectGoesStepMs, (stepMs) => fired.push(stepMs));
    for (let i = 0; i < 240; i += 1) store.getState().actions.stepBy(1000);
    unsubscribe();
    expect(fired).toEqual([at("2026-10-10T10:00:00Z")]);
  });
});

describe("M6 selectors", () => {
  it("selectHorizonProfileDeg and selectHorizonStatus read the active camera's entry: null and idle without one", () => {
    const store = storeAt("2026-10-11T15:20:00Z");
    const { actions } = store.getState();
    expect(selectHorizonProfileDeg(store.getState())).toBeNull();
    expect(selectHorizonStatus(store.getState())).toBe("idle");
    actions.setHorizon("synthetic-maunakea", { status: "loading" });
    expect(selectHorizonStatus(store.getState())).toBe("loading");
    expect(selectHorizonProfileDeg(store.getState())).toBeNull();
    const profile = new Float32Array(360).fill(-1.9);
    actions.setHorizon("synthetic-maunakea", { status: "ready", profileDeg: profile });
    expect(selectHorizonProfileDeg(store.getState())).toBe(profile); // the existing reference
    expect(selectHorizonStatus(store.getState())).toBe("ready");
    // Another camera's entry is not the active one's.
    actions.setActiveCamera("synthetic-walenstadt");
    expect(selectHorizonProfileDeg(store.getState())).toBeNull();
    expect(selectHorizonStatus(store.getState())).toBe("idle");
    actions.setActiveCamera("synthetic-maunakea");
    expect(selectHorizonProfileDeg(store.getState())).toBe(profile);
  });
});

describe("M8 selectors", () => {
  it("selectIncomingMask: 0b011 by default, 0b111 with starlink, 0b100 with only starlink, 0 with both off", () => {
    const store = storeAt("2026-10-11T15:05:07Z");
    const { actions } = store.getState();
    const mask = () => selectIncomingMask(store.getState());
    expect(mask()).toBe(0b011);
    actions.setLayer("starlink", true);
    expect(mask()).toBe(0b111);
    actions.setLayer("satellites", false);
    expect(mask()).toBe(0b100);
    actions.setLayer("starlink", false);
    expect(mask()).toBe(0);
  });

  it("selectIncomingActive: on at 1× and 10× playing, off at 60× and 600× playing in replay, on at 60× paused", () => {
    const store = storeAt("2026-10-11T15:05:07Z");
    const { actions } = store.getState();
    const active = () => selectIncomingActive(store.getState());
    const results: boolean[] = [];
    for (const rate of [1, 10, 60, 600] as const) {
      actions.setRate(rate);
      actions.play();
      results.push(active());
    }
    expect(results).toEqual([true, true, false, false]);
    actions.setRate(60);
    actions.pause();
    expect(active()).toBe(true);
    // Both satellite layers off: nothing to alert about.
    actions.setLayer("satellites", false);
    expect(active()).toBe(false);
  });

  it("both return primitives that do not change on ticks", () => {
    const store = storeAt("2026-10-11T15:05:07Z");
    const fired: string[] = [];
    const unsubscribes = [
      store.subscribe(selectIncomingMask, () => fired.push("mask")),
      store.subscribe(selectIncomingActive, () => fired.push("active")),
    ];
    for (let i = 1; i <= 100; i += 1) {
      store.getState().actions.tick(Date.parse("2026-10-11T15:05:07Z") + i * 16);
    }
    for (const unsubscribe of unsubscribes) unsubscribe();
    expect(fired).toEqual([]);
  });
});
