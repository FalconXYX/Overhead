import { describe, expect, it } from "vitest";
import { type CameraModel, syntheticFisheyeCalibration } from "../../src/domain/camera";
import { bindSkyCamera } from "../../src/map/sync/bindSkyCamera";
import type { AppStore } from "../../src/state/store";
import { committedCameras, storeAt } from "../helpers/store";

function setup() {
  const store = storeAt("2026-10-10T08:00:00Z");
  const models: CameraModel[] = [];
  const unbind = bindSkyCamera(store, { setCameraModel: (m) => models.push(m) });
  return { store, models, unbind };
}

/** updateCalibration still throws until M4, so tests write camera.calibration directly. */
function setCalibration(store: AppStore, id: string, patch: { rollDeg: number }): void {
  const s = store.getState();
  const base = s.camera.registry[id]?.defaults ?? syntheticFisheyeCalibration(1024);
  store.setState({
    camera: { ...s.camera, calibration: { ...s.camera.calibration, [id]: { ...base, ...patch } } },
  });
}

describe("bindSkyCamera", () => {
  it("one call at subscribe, for the active camera, zenith-locked", () => {
    const { models } = setup();
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m?.zenithLocked).toBe(true);
    expect(m?.lens).toBe("fisheye-equidistant");
    expect(m?.widthPx).toBe(1024);
    expect(m?.heightPx).toBe(1024);
    expect(m?.calibration.focalPx).toBe(325.94932345220167);
    expect(m?.calibration.rollDeg).toBe(180);
  });

  it("no call on clock ticks", () => {
    const { store, models } = setup();
    const t0 = store.getState().clock.simTimeMs;
    for (let i = 1; i <= 100; i++) store.getState().actions.tick(t0 + i * 16);
    expect(models).toHaveLength(1);
  });

  it("one call after a calibration change, built from the stored calibration", () => {
    const { store, models } = setup();
    setCalibration(store, "synthetic-maunakea", { rollDeg: 170 });
    expect(models).toHaveLength(2);
    expect(models[1]?.calibration.rollDeg).toBe(170);
    expect(models[1]?.zenithLocked).toBe(true);
  });

  it("one call after a camera switch", () => {
    const { store, models } = setup();
    store.getState().actions.setRegistry(committedCameras());
    const before = models.length;
    store.getState().actions.setActiveCamera("synthetic-walenstadt");
    expect(models).toHaveLength(before + 1);
    expect(models.at(-1)?.calibration).toBe(
      store.getState().camera.registry["synthetic-walenstadt"]?.defaults,
    );
  });

  it("no call while the active camera is not in the registry", () => {
    const store = storeAt("2026-10-10T08:00:00Z");
    store.getState().actions.setActiveCamera("nope");
    const models: CameraModel[] = [];
    const unbind = bindSkyCamera(store, { setCameraModel: (m) => models.push(m) });
    expect(models).toHaveLength(0);
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expect(models).toHaveLength(1);
    unbind();
  });

  it("no call after an unsubscribe", () => {
    const { store, models, unbind } = setup();
    unbind();
    setCalibration(store, "synthetic-maunakea", { rollDeg: 170 });
    store.getState().actions.tick(store.getState().clock.simTimeMs + 1000);
    expect(models).toHaveLength(1);
  });
});
