import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import { withM5CameraEntries } from "../helpers/m5Cameras";

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

describe("M2 layer actions", () => {
  it("setStarMagLimit clamps to [1, 6.5]", () => {
    const store = newStore();
    const { actions } = store.getState();
    expect(store.getState().layers.starMagLimit).toBe(4.5);
    actions.setStarMagLimit(7);
    expect(store.getState().layers.starMagLimit).toBe(6.5);
    actions.setStarMagLimit(0);
    expect(store.getState().layers.starMagLimit).toBe(1);
    actions.setStarMagLimit(-3);
    expect(store.getState().layers.starMagLimit).toBe(1);
    actions.setStarMagLimit(5);
    expect(store.getState().layers.starMagLimit).toBe(5);
    actions.setStarMagLimit(6.5);
    expect(store.getState().layers.starMagLimit).toBe(6.5);
  });

  it("setStarMagLimit ignores non-finite values and leaves the state alone", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setStarMagLimit(3);
    const before = store.getState();
    for (const vmag of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      actions.setStarMagLimit(vmag);
      expect(store.getState()).toBe(before);
    }
    expect(store.getState().layers.starMagLimit).toBe(3);
  });

  it("setStarMagLimit to the current value changes nothing", () => {
    const store = newStore();
    const before = store.getState();
    before.actions.setStarMagLimit(4.5);
    expect(store.getState()).toBe(before);
    before.actions.setStarMagLimit(9); // clamps to 6.5: a change
    const after = store.getState();
    expect(after.layers.starMagLimit).toBe(6.5);
    after.actions.setStarMagLimit(8); // clamps to 6.5 again: no change
    expect(store.getState()).toBe(after);
  });
});

describe("M3 selection and data actions", () => {
  it("select sets the id and keeps follow; select(null) clears both", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.select("sat:25544");
    actions.setFollow(true);
    expect(store.getState().selection).toEqual({
      selectedId: "sat:25544",
      hoverId: null,
      follow: true,
    });
    actions.select("sat:48274"); // only null turns follow off
    expect(store.getState().selection.follow).toBe(true);
    actions.select("planet:Jupiter");
    expect(store.getState().selection).toEqual({
      selectedId: "planet:Jupiter",
      hoverId: null,
      follow: true,
    });
    actions.select(null);
    expect(store.getState().selection).toEqual({ selectedId: null, hoverId: null, follow: false });
  });

  it("select with the current id and follow unchanged is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    const idle = store.getState();
    actions.select(null);
    expect(store.getState()).toBe(idle);
    actions.select("star:424");
    const selected = store.getState();
    actions.select("star:424");
    expect(store.getState()).toBe(selected);
    // The same id with follow on stays as it is; null still clears follow.
    actions.setFollow(true);
    const following = store.getState();
    actions.select("star:424");
    expect(store.getState()).toBe(following);
    actions.select(null);
    expect(store.getState().selection.follow).toBe(false);
  });

  it("hover leaves the state alone when the id is unchanged", () => {
    const store = newStore();
    const { actions } = store.getState();
    const before = store.getState();
    actions.hover(null);
    expect(store.getState()).toBe(before);
    actions.hover("moon");
    const hovering = store.getState();
    expect(hovering.selection).toEqual({ selectedId: null, hoverId: "moon", follow: false });
    actions.hover("moon");
    expect(store.getState()).toBe(hovering);
    actions.hover(null);
    expect(store.getState().selection.hoverId).toBeNull();
  });

  it("hover never touches the selection or follow", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.select("sat:25544");
    actions.setFollow(true);
    actions.hover("sun");
    actions.hover(null);
    expect(store.getState().selection).toEqual({
      selectedId: "sat:25544",
      hoverId: null,
      follow: true,
    });
  });

  it("setFollow writes follow; an unchanged value is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    const before = store.getState();
    actions.setFollow(false);
    expect(store.getState()).toBe(before);
    actions.setFollow(true);
    expect(store.getState().selection.follow).toBe(true);
    const on = store.getState();
    actions.setFollow(true);
    expect(store.getState()).toBe(on);
    actions.setFollow(false);
    expect(store.getState().selection.follow).toBe(false);
  });

  it("selection listeners fire once per change and never for a no-op", () => {
    const store = newStore();
    const { actions } = store.getState();
    const seen: unknown[] = [];
    const unsubscribe = store.subscribe(
      (s) => s.selection,
      (selection) => seen.push(selection.selectedId),
    );
    actions.select("sat:25544");
    actions.select("sat:25544");
    actions.hover(null);
    actions.setFollow(false);
    actions.select(null);
    actions.select(null);
    unsubscribe();
    expect(seen).toEqual(["sat:25544", null]);
  });

  it("setGroupData merges the patch into one group", () => {
    const store = newStore();
    const { actions } = store.getState();
    const { visual, starlink } = store.getState().data.gp;
    actions.setGroupData("stations", { status: "loading" });
    expect(store.getState().data.gp.stations).toEqual({
      status: "loading",
      fetchedAtMs: null,
      count: 0,
    });
    actions.setGroupData("stations", { status: "ready", fetchedAtMs: 1791690621000, count: 12 });
    expect(store.getState().data.gp.stations).toEqual({
      status: "ready",
      fetchedAtMs: 1791690621000,
      count: 12,
    });
    // The other groups keep their objects; the rest of data is untouched.
    expect(store.getState().data.gp.visual).toBe(visual);
    expect(store.getState().data.gp.starlink).toBe(starlink);
    expect(store.getState().data.stars).toBe("idle");
    actions.setGroupData("starlink", { status: "error" });
    expect(store.getState().data.gp.starlink).toEqual({
      status: "error",
      fetchedAtMs: null,
      count: 0,
    });
    expect(store.getState().data.gp.stations.status).toBe("ready");
  });

  it("setGroupData with nothing new is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setGroupData("visual", { status: "ready", fetchedAtMs: 1791690621000, count: 153 });
    const before = store.getState();
    actions.setGroupData("visual", { status: "ready" });
    actions.setGroupData("visual", { count: 153, fetchedAtMs: 1791690621000 });
    actions.setGroupData("visual", {});
    expect(store.getState()).toBe(before);
  });

  it("setGroupData ignores keys whose value is undefined", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setGroupData("stations", { status: "ready", fetchedAtMs: 1791690621000, count: 12 });
    const before = store.getState();
    // Partial<GroupData> admits explicit undefined; it must never erase a field.
    actions.setGroupData("stations", { status: undefined, count: undefined });
    expect(store.getState()).toBe(before);
    actions.setGroupData("stations", { status: "loading", fetchedAtMs: undefined });
    expect(store.getState().data.gp.stations).toEqual({
      status: "loading",
      fetchedAtMs: 1791690621000,
      count: 12,
    });
  });
});

describe("M5 video actions", () => {
  /** A store with the committed cameras plus M5's entries, on subaru-starcam (delay 50,000 ms by default). */
  function videoStore(activeId = "subaru-starcam"): AppStore {
    const store = newStore();
    const json: unknown = JSON.parse(
      readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
    );
    store.getState().actions.setRegistry(parseCameraRegistry(withM5CameraEntries(json)));
    store.getState().actions.setActiveCamera(activeId);
    return store;
  }
  const delayOf = (store: AppStore): number | undefined =>
    store.getState().camera.calibration[store.getState().camera.activeId]?.streamDelayMs;

  it("setStreamDelayMs clamps to [0, 120 s] in whole ms through updateCalibration", () => {
    const store = videoStore();
    const { actions } = store.getState();
    actions.setStreamDelayMs(130_000);
    expect(delayOf(store)).toBe(120_000);
    actions.setStreamDelayMs(-5);
    expect(delayOf(store)).toBe(0);
    actions.setStreamDelayMs(49_999.5);
    expect(delayOf(store)).toBe(50_000);
    // The geometry stays the camera's own: only the delay changed.
    const calibration = store.getState().camera.calibration["subaru-starcam"];
    expect(calibration?.azDeg).toBe(81.2322);
    expect(calibration?.focalPx).toBe(2525.93);
  });

  it("setStreamDelayMs ignores non-finite input and every camera that is not youtube", () => {
    const store = videoStore();
    const { actions } = store.getState();
    actions.setStreamDelayMs(22_000);
    const before = store.getState();
    actions.setStreamDelayMs(Number.NaN);
    actions.setStreamDelayMs(Number.POSITIVE_INFINITY);
    expect(store.getState()).toBe(before);
    for (const id of ["synthetic-maunakea", "cfht-nanaao", "subaru-2026-10-11-iss"]) {
      actions.setActiveCamera(id);
      const s = store.getState();
      actions.setStreamDelayMs(30_000);
      expect(store.getState(), id).toBe(s);
    }
  });

  it("setVideoStatus stores the status and the code, null by default", () => {
    const store = videoStore();
    const { actions } = store.getState();
    expect(store.getState().video).toEqual({ status: "idle", errorCode: null });
    actions.setVideoStatus("embed-blocked", 150);
    expect(store.getState().video).toEqual({ status: "embed-blocked", errorCode: 150 });
    actions.setVideoStatus("playing");
    expect(store.getState().video).toEqual({ status: "playing", errorCode: null });
    const before = store.getState();
    actions.setVideoStatus("playing");
    expect(store.getState()).toBe(before);
  });

  it("setActiveCamera resets video to idle", () => {
    const store = videoStore();
    const { actions } = store.getState();
    actions.setVideoStatus("error", 5);
    actions.setActiveCamera("cfht-starcam");
    expect(store.getState().video).toEqual({ status: "idle", errorCode: null });
  });

  it("setVideoLayer writes a new layers.video with only that key; a repeat keeps the reference", () => {
    const store = videoStore();
    const { actions } = store.getState();
    const before = store.getState().layers;
    actions.setVideoLayer("grid", true);
    const after = store.getState().layers;
    expect(after.video).not.toBe(before.video);
    expect(after.video).toEqual({ starlink: false, grid: true, denseLabels: false });
    expect(after.grid).toBe(before.grid);
    const state = store.getState();
    actions.setVideoLayer("grid", true);
    expect(store.getState()).toBe(state);
    expect(store.getState().layers.video).toBe(after.video);
  });
});

describe("M7 GOES actions", () => {
  const intervals = [
    [Date.parse("2026-10-07T12:00:00Z"), Date.parse("2026-10-07T19:20:00Z")],
    [Date.parse("2026-10-07T19:40:00Z"), Date.parse("2026-10-11T00:00:00Z")],
  ] as const;

  it("setGoesDomain stores the given array by reference and latestStepMs; nothing else in data changes", () => {
    const store = newStore();
    const before = store.getState();
    before.actions.setGoesDomain(intervals, Date.parse("2026-10-11T00:00:00Z"));
    const { data } = store.getState();
    expect(data.goes.intervals).toBe(intervals);
    expect(data.goes.latestStepMs).toBe(Date.parse("2026-10-11T00:00:00Z"));
    expect(data.goes.status).toBe("idle");
    expect({ ...data, goes: before.data.goes }).toEqual(before.data);
    expect(data.gp).toBe(before.data.gp);
    expect(data.horizon).toBe(before.data.horizon);
    expect(store.getState().layers).toBe(before.layers);
    before.actions.setGoesDomain([], null);
    expect(store.getState().data.goes).toEqual({
      status: "idle",
      intervals: [],
      latestStepMs: null,
    });
  });

  it("setGoesDomain with the same reference and step is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setGoesDomain(intervals, null);
    const before = store.getState();
    actions.setGoesDomain(intervals, null);
    expect(store.getState()).toBe(before);
    actions.setGoesDomain([...intervals], null); // a new array is a change, even when equal
    expect(store.getState()).not.toBe(before);
  });

  it("setGoesStatus round-trips; nothing else in data changes; an unchanged status is not a state change", () => {
    const store = newStore();
    const before = store.getState();
    for (const status of ["loading", "ready", "error", "idle"] as const) {
      before.actions.setGoesStatus(status);
      expect(store.getState().data.goes.status).toBe(status);
    }
    expect(store.getState().data.goes.intervals).toBe(before.data.goes.intervals);
    expect({ ...store.getState().data, goes: before.data.goes }).toEqual(before.data);
    const idle = store.getState();
    idle.actions.setGoesStatus("idle");
    expect(store.getState()).toBe(idle);
  });
});

describe("M6 horizon action", () => {
  it("setHorizon merges into data.horizon[cameraId], starting from the idle default", () => {
    const store = newStore();
    const before = store.getState();
    expect(before.data.horizon).toEqual({});
    before.actions.setHorizon("cam-a", { status: "loading" });
    expect(store.getState().data.horizon["cam-a"]).toEqual({
      status: "loading",
      profileDeg: null,
      imagerySources: [],
    });
    const profile = new Float32Array(360).fill(2);
    before.actions.setHorizon("cam-a", {
      status: "ready",
      profileDeg: profile,
      imagerySources: ["eudem", "srtm"],
    });
    const ready = store.getState().data.horizon["cam-a"];
    expect(ready?.profileDeg).toBe(profile); // stored as is, never copied
    expect(ready).toEqual({
      status: "ready",
      profileDeg: profile,
      imagerySources: ["eudem", "srtm"],
    });
    // A status-only patch keeps the profile and the sources; other cameras and data are untouched.
    before.actions.setHorizon("cam-a", { status: "error" });
    expect(store.getState().data.horizon["cam-a"]).toEqual({ ...ready, status: "error" });
    before.actions.setHorizon("cam-b", {});
    expect(store.getState().data.horizon["cam-b"]).toEqual({
      status: "idle",
      profileDeg: null,
      imagerySources: [],
    });
    expect(store.getState().data.horizon["cam-a"]?.status).toBe("error");
    expect({ ...store.getState().data, horizon: {} }).toEqual(before.data);
  });

  it("setHorizon ignores undefined keys, and a patch with nothing new is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    const profile = new Float32Array(360);
    actions.setHorizon("cam-a", { status: "ready", profileDeg: profile });
    const before = store.getState();
    actions.setHorizon("cam-a", { status: "ready", profileDeg: profile });
    expect(store.getState()).toBe(before);
    actions.setHorizon("cam-a", { status: undefined, profileDeg: undefined });
    expect(store.getState()).toBe(before);
    expect(store.getState().data.horizon["cam-a"]?.profileDeg).toBe(profile);
  });
});

describe("M8 footprint action", () => {
  it("setFootprintHeightKm stores null, 420, 480 and 0.5", () => {
    const store = newStore();
    const { actions } = store.getState();
    const stored: (number | null)[] = [];
    for (const km of [420, 480, 0.5, null]) {
      actions.setFootprintHeightKm(km);
      stored.push(store.getState().layers.footprintHeightKm);
    }
    expect(stored).toEqual([420, 480, 0.5, null]);
  });

  it("setFootprintHeightKm ignores 0, −1, NaN and Infinity, and a repeat is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setFootprintHeightKm(480);
    const before = store.getState();
    for (const km of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      actions.setFootprintHeightKm(km);
      expect(store.getState()).toBe(before);
    }
    actions.setFootprintHeightKm(480);
    expect(store.getState()).toBe(before);
    // Only the height changes.
    actions.setFootprintHeightKm(420);
    expect({ ...store.getState().layers, footprintHeightKm: 480 }).toEqual(before.layers);
  });
});

describe("M9 tour actions", () => {
  it("startDemo gives { active: true, step: 0, paused: false } from any earlier tour state", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.startDemo();
    expect(store.getState().ui.demo).toEqual({ active: true, step: 0, paused: false });
    actions.setDemoStep(5);
    actions.setDemoPaused(true);
    actions.startDemo();
    expect(store.getState().ui.demo).toEqual({ active: true, step: 0, paused: false });
  });

  it("setDemoStep clamps to 0–9 (DEMO_STEPS.length − 1), keeps whole steps and ignores non-finite input", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.startDemo();
    const steps: number[] = [];
    for (const step of [3, 9, 10, 42, -1, 2.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      actions.setDemoStep(step);
      steps.push(store.getState().ui.demo.step);
    }
    expect(steps).toEqual([3, 9, 9, 9, 0, 2, 2, 2]);
    expect(store.getState().ui.demo.active).toBe(true);
  });

  it("setDemoPaused sets paused, keeps the step, and a repeat is not a state change", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.startDemo();
    actions.setDemoStep(4);
    actions.setDemoPaused(true);
    expect(store.getState().ui.demo).toEqual({ active: true, step: 4, paused: true });
    const before = store.getState();
    actions.setDemoPaused(true);
    actions.setDemoStep(4);
    expect(store.getState()).toBe(before);
    actions.setDemoPaused(false);
    expect(store.getState().ui.demo).toEqual({ active: true, step: 4, paused: false });
  });

  it("stopDemo resets to { active: false, step: 0, paused: false } and leaves the rest alone", () => {
    const store = newStore();
    const { actions } = store.getState();
    const initial = store.getState();
    actions.stopDemo(); // already stopped: no change
    expect(store.getState()).toBe(initial);
    actions.startDemo();
    actions.setDemoStep(7);
    actions.setDemoPaused(true);
    actions.openPanel("layers");
    actions.stopDemo();
    const after = store.getState();
    expect(after.ui).toEqual({ panel: "layers", demo: { active: false, step: 0, paused: false } });
    expect(after.clock).toBe(initial.clock);
    expect(after.layers).toBe(initial.layers);
  });
});
