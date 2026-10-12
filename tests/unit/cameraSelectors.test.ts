// The M4 selectors appended to src/state/selectors.ts, kept in their own file so the M4 work merges without touching
// selectors.test.ts.
import { describe, expect, it } from "vitest";
import { selectCameraStatus, selectZenithLocked } from "../../src/state/selectors";
import { committedCameras, storeAt } from "../helpers/store";

function store() {
  const s = storeAt("2026-10-11T08:00:00Z");
  s.getState().actions.setRegistry(committedCameras());
  return s;
}

describe("selectCameraStatus", () => {
  it('synthetic cameras are always "live"; a still camera is "unknown" until polled, then its status', () => {
    const s = store();
    expect(selectCameraStatus("synthetic-maunakea")(s.getState())).toBe("live");
    expect(selectCameraStatus("cfht-nanaao")(s.getState())).toBe("unknown");
    s.getState().actions.setCameraStatus("cfht-nanaao", "offline");
    expect(selectCameraStatus("cfht-nanaao")(s.getState())).toBe("offline");
    s.getState().actions.setCameraStatus("synthetic-maunakea", "offline"); // never shown for synthetic
    expect(selectCameraStatus("synthetic-maunakea")(s.getState())).toBe("live");
    expect(selectCameraStatus("not-a-camera")(s.getState())).toBe("unknown");
  });
});

describe("selectZenithLocked", () => {
  it("a fisheye at altDeg exactly 90 is locked; a ↓ nudge unlocks it; rectilinear never locks", () => {
    const s = store();
    expect(selectZenithLocked(s.getState())).toBe(true); // synthetic-maunakea
    s.getState().actions.updateCalibration({ altDeg: 89.95 });
    expect(selectZenithLocked(s.getState())).toBe(false);
    s.getState().actions.setActiveCamera("cfht-nanaao"); // tilted 1.74°
    expect(selectZenithLocked(s.getState())).toBe(false);
    s.getState().actions.setActiveCamera("cfht-starcam"); // rectilinear
    s.getState().actions.updateCalibration({ altDeg: 90 });
    expect(s.getState().camera.calibration["cfht-starcam"]?.altDeg).toBe(90);
    expect(selectZenithLocked(s.getState())).toBe(false);
  });

  it("false with no registry entry", () => {
    const s = storeAt("2026-10-11T08:00:00Z");
    s.getState().actions.setRegistry({});
    expect(selectZenithLocked(s.getState())).toBe(false);
  });
});
