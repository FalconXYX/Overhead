// The M4 actions (README actions table; M4 section 5 "actions.test.ts · M4 actions" row), kept in their own file so
// the M4 work merges without touching actions.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Calibration } from "../../src/domain/camera";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import { committedCameras } from "../helpers/store";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const FIT = { rmsPx: 0.4, rmsDeg: 0.06, maxFitDeg: 0.11, maxHoldoutDeg: 0.2 } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** createAppStore with the committed registry (every camera, so cfht-nanaao is there too). */
function newStore(activeId = DEFAULT_CAMERA_ID): AppStore {
  const store = createAppStore(initialState(NOW - 3_600_000, DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(committedCameras());
  store.getState().actions.setActiveCamera(activeId);
  return store;
}

function defaultsOf(store: AppStore, id: string): Calibration {
  const defaults = store.getState().camera.registry[id]?.defaults;
  if (defaults === undefined) throw new Error(`no camera ${id}`);
  return defaults;
}

describe("M4 camera actions", () => {
  it("setCameraStatus writes one camera's status; the same value changes nothing", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.setCameraStatus("cfht-nanaao", "offline");
    expect(store.getState().camera.status).toEqual({ "cfht-nanaao": "offline" });
    const before = store.getState();
    actions.setCameraStatus("cfht-nanaao", "offline");
    expect(store.getState()).toBe(before);
    actions.setCameraStatus("cfht-nanaao", "live");
    actions.setCameraStatus("synthetic-walenstadt", "daytime");
    expect(store.getState().camera.status).toEqual({
      "cfht-nanaao": "live",
      "synthetic-walenstadt": "daytime",
    });
  });

  it("setFrameTimeMs writes the time or null and ignores non-finite values", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.setFrameTimeMs(NOW - 40_000);
    expect(store.getState().camera.frameTimeMs).toBe(NOW - 40_000);
    const before = store.getState();
    actions.setFrameTimeMs(Number.NaN);
    actions.setFrameTimeMs(Number.POSITIVE_INFINITY);
    actions.setFrameTimeMs(NOW - 40_000);
    expect(store.getState()).toBe(before);
    actions.setFrameTimeMs(null);
    expect(store.getState().camera.frameTimeMs).toBeNull();
  });

  it("setActiveCamera resets calibrationUi to { pairs: [], pendingPx: null, fit: null }", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.addImagePoint(1, 2);
    actions.completePair("star:424");
    actions.addImagePoint(3, 4);
    store.setState((s) => ({ calibrationUi: { ...s.calibrationUi, fit: FIT } }));
    actions.setActiveCamera(DEFAULT_CAMERA_ID);
    expect(store.getState().calibrationUi).toEqual({ pairs: [], pendingPx: null, fit: null });
    expect(store.getState().camera.frameTimeMs).toBeNull();
  });
});

describe("M4 calibration writes", () => {
  it("updateCalibration on synthetic-maunakea: azDeg 37 folds into roll (azDeg 0, rollDeg 143), stamped now", () => {
    const store = newStore();
    const defaults = defaultsOf(store, DEFAULT_CAMERA_ID);
    const registryBefore = { ...defaults };
    store.getState().actions.updateCalibration({ azDeg: 37 });
    const stored = store.getState().camera.calibration[DEFAULT_CAMERA_ID];
    expect(stored?.azDeg).toBe(0);
    expect(stored?.altDeg).toBe(90);
    expect(stored?.rollDeg).toBeCloseTo(143, 12); // wrap180(180 − 37)
    expect(stored?.updatedAtMs).toBe(NOW);
    expect(stored?.focalPx).toBe(defaults.focalPx); // copied from the defaults the first time
    expect(defaults).toEqual(registryBefore); // the registry entry is never written
  });

  it("updateCalibration that fails distortionValid (k1 −0.5: g′(π/2) = −2.70) leaves the same reference", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.updateCalibration({ rollDeg: 170 });
    const before = store.getState().camera.calibration;
    actions.updateCalibration({ k1: -0.5 });
    expect(store.getState().camera.calibration).toBe(before);
    // Also refused: non-finite numbers and a focal length ≤ 0.
    actions.updateCalibration({ azDeg: Number.NaN });
    actions.updateCalibration({ focalPx: 0 });
    actions.updateCalibration({ focalPx: -300 });
    actions.updateCalibration({ cxPx: Number.POSITIVE_INFINITY });
    expect(store.getState().camera.calibration).toBe(before);
  });

  it("updateCalibration on a tilted camera wraps azDeg to [0, 360) and rollDeg to [−180, 180)", () => {
    const store = newStore("cfht-nanaao");
    store.getState().actions.updateCalibration({ azDeg: -132.7, rollDeg: 224.8 });
    const stored = store.getState().camera.calibration["cfht-nanaao"];
    expect(stored?.azDeg).toBeCloseTo(227.3, 9);
    expect(stored?.rollDeg).toBeCloseTo(-135.2, 9);
    expect(stored?.altDeg).toBe(88.26);
  });

  it("↑ to 90 locks a fisheye; altDeg is clamped to 90", () => {
    const store = newStore("cfht-nanaao");
    store.getState().actions.updateCalibration({ altDeg: 90.4 });
    const stored = store.getState().camera.calibration["cfht-nanaao"];
    expect(stored?.altDeg).toBe(90);
    expect(stored?.azDeg).toBe(0);
    expect(stored?.rollDeg).toBeCloseTo(44.8 - 227.3 + 360, 9); // wrap180(44.8 − 227.3) = 177.5
  });

  it("importCalibration normalizes, keeps the file's updatedAtMs, and rejects like updateCalibration", () => {
    const store = newStore();
    const { actions } = store.getState();
    const defaults = defaultsOf(store, "cfht-nanaao");
    actions.importCalibration("cfht-nanaao", {
      ...defaults,
      altDeg: 90,
      azDeg: 10,
      updatedAtMs: 5,
    });
    const stored = store.getState().camera.calibration["cfht-nanaao"];
    expect(stored?.azDeg).toBe(0);
    expect(stored?.rollDeg).toBeCloseTo(34.8, 9);
    expect(stored?.updatedAtMs).toBe(5);
    const before = store.getState().camera.calibration;
    actions.importCalibration("cfht-nanaao", { ...defaults, k1: -0.5 });
    actions.importCalibration("no-such-camera", defaults);
    actions.importCalibration("cfht-nanaao", { ...defaults, rmsDeg: Number.NaN });
    expect(store.getState().camera.calibration).toBe(before);
  });

  it("resetCalibration deletes the active camera's entry, so the defaults apply", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.updateCalibration({ rollDeg: 170 });
    actions.importCalibration("cfht-nanaao", defaultsOf(store, "cfht-nanaao"));
    actions.resetCalibration();
    expect(Object.keys(store.getState().camera.calibration)).toEqual(["cfht-nanaao"]);
    const before = store.getState();
    actions.resetCalibration();
    expect(store.getState()).toBe(before);
  });

  it("applyFit stores the normalized fit stamped now, each pair's residualPx and rejected, and the summary", () => {
    const store = newStore();
    const { actions } = store.getState();
    for (const [u, target] of [
      [100, "star:424"],
      [200, "star:2491"],
      [300, "planet:Saturn"],
    ] as const) {
      actions.addImagePoint(u, u);
      actions.completePair(target);
    }
    actions.setPairRole(2, "holdout");
    const fitted = {
      ...defaultsOf(store, DEFAULT_CAMERA_ID),
      azDeg: 20,
      rollDeg: 175,
      rmsDeg: 0.06,
    };
    actions.applyFit(fitted, [0.3, 4.2, 0.5], [false, true, false], FIT);
    const s = store.getState();
    const stored = s.camera.calibration[DEFAULT_CAMERA_ID];
    expect(stored?.azDeg).toBe(0);
    expect(stored?.rollDeg).toBeCloseTo(155, 9);
    expect(stored?.rmsDeg).toBe(0.06);
    expect(stored?.updatedAtMs).toBe(NOW);
    expect(
      s.calibrationUi.pairs.map((p) => [p.targetId, p.role, p.residualPx, p.rejected]),
    ).toEqual([
      ["star:424", "fit", 0.3, false],
      ["star:2491", "fit", 4.2, true],
      ["planet:Saturn", "holdout", 0.5, false],
    ]);
    expect(s.calibrationUi.fit).toEqual(FIT);
  });

  it("applyFit with an invalid distortion changes neither the calibration nor the pairs", () => {
    const store = newStore();
    const { actions } = store.getState();
    actions.addImagePoint(1, 1);
    actions.completePair("star:424");
    const before = store.getState();
    const bad = { ...defaultsOf(store, DEFAULT_CAMERA_ID), k1: -0.5 };
    actions.applyFit(bad, [0.3], [false], FIT);
    expect(store.getState()).toBe(before);
  });
});

describe("M4 star pairs", () => {
  it("a second addImagePoint replaces the pending point; non-finite clicks are ignored", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.addImagePoint(612.4, 433);
    actions.addImagePoint(100, 200);
    expect(store.getState().calibrationUi.pendingPx).toEqual([100, 200]);
    const before = store.getState();
    actions.addImagePoint(Number.NaN, 5);
    expect(store.getState()).toBe(before);
  });

  it("completePair without a pending point changes nothing", () => {
    const store = newStore("cfht-nanaao");
    const before = store.getState();
    before.actions.completePair("star:424");
    expect(store.getState()).toBe(before);
  });

  it("completePair makes a fit pair and clears the point; the same targetId replaces the first, in place", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.addImagePoint(10, 20);
    actions.completePair("star:424");
    actions.addImagePoint(30, 40);
    actions.completePair("planet:Jupiter");
    actions.setPairRole(0, "holdout");
    actions.addImagePoint(11, 21);
    actions.completePair("star:424");
    const { pairs, pendingPx } = store.getState().calibrationUi;
    expect(pendingPx).toBeNull();
    expect(pairs).toEqual([
      {
        imagePx: [11, 21],
        targetId: "star:424",
        role: "holdout",
        residualPx: null,
        rejected: false,
      },
      {
        imagePx: [30, 40],
        targetId: "planet:Jupiter",
        role: "fit",
        residualPx: null,
        rejected: false,
      },
    ]);
  });

  it("setPairRole and removePair ignore an index out of range", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.addImagePoint(10, 20);
    actions.completePair("star:424");
    const before = store.getState();
    actions.setPairRole(1, "holdout");
    actions.setPairRole(-1, "holdout");
    actions.setPairRole(0, "fit"); // unchanged role
    actions.removePair(3);
    expect(store.getState()).toBe(before);
    actions.removePair(0);
    expect(store.getState().calibrationUi.pairs).toEqual([]);
  });

  it("cancelImagePoint clears pendingPx and keeps the pairs", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.addImagePoint(10, 20);
    actions.completePair("star:424");
    actions.addImagePoint(50, 60);
    actions.cancelImagePoint();
    expect(store.getState().calibrationUi.pendingPx).toBeNull();
    expect(store.getState().calibrationUi.pairs).toHaveLength(1);
    const before = store.getState();
    actions.cancelImagePoint();
    expect(store.getState()).toBe(before);
  });

  it("clearPairs empties pairs, the pending point and the fit; already empty changes nothing", () => {
    const store = newStore("cfht-nanaao");
    const { actions } = store.getState();
    const empty = store.getState();
    actions.clearPairs();
    expect(store.getState()).toBe(empty);
    actions.addImagePoint(10, 20);
    actions.completePair("star:424");
    actions.addImagePoint(50, 60);
    store.setState((s) => ({ calibrationUi: { ...s.calibrationUi, fit: FIT } }));
    actions.clearPairs();
    expect(store.getState().calibrationUi).toEqual({ pairs: [], pendingPx: null, fit: null });
  });
});
