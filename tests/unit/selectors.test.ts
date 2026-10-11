import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { selectActiveCamera, selectSite, selectTrueColorDate } from "../../src/state/selectors";
import { createAppStore } from "../../src/state/store";
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
