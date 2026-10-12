// The sky view's calibration bindings (M4 step 14): the Sun, Moon and planets show while the Calibration panel is
// open even with their toggle off, and the pending image point is drawn while the panel is open.
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { describe, expect, it } from "vitest";
import { bindBodiesVisible, bindPendingPoint } from "../../src/map/sync/bindCalibrationView";
import { storeAt } from "../helpers/store";

describe("bindBodiesVisible", () => {
  it("follows layers.planets, and stays on while the Calibration panel is open", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    const layer = new VectorLayer({ source: new VectorSource() });
    const seen: boolean[] = [];
    layer.on("change:visible", () => seen.push(layer.getVisible()));
    const unbind = bindBodiesVisible(store, layer);
    const { actions } = store.getState();
    expect(layer.getVisible()).toBe(true);
    actions.setLayer("planets", false);
    expect(layer.getVisible()).toBe(false);
    actions.togglePanel("calibration");
    expect(layer.getVisible()).toBe(true);
    actions.togglePanel("layers"); // another panel replaces it
    expect(layer.getVisible()).toBe(false);
    actions.togglePanel("calibration");
    actions.setLayer("planets", true);
    actions.togglePanel("calibration"); // closed, toggle on
    expect(layer.getVisible()).toBe(true);
    expect(seen).toEqual([false, true, false, true]);
    unbind();
    actions.setLayer("planets", false);
    expect(layer.getVisible()).toBe(true);
  });

  it("no change on clock ticks", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    const layer = new VectorLayer({ source: new VectorSource() });
    let changes = 0;
    layer.on("change:visible", () => {
      changes += 1;
    });
    bindBodiesVisible(store, layer);
    const t0 = store.getState().clock.simTimeMs;
    for (let i = 1; i <= 100; i++) store.getState().actions.tick(t0 + i * 16);
    expect(changes).toBe(0);
  });
});

describe("bindPendingPoint", () => {
  it("applies the pending point while the panel is open, else null", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    const calls: (readonly [number, number] | null)[] = [];
    const unbind = bindPendingPoint(store, (px) => calls.push(px));
    const { actions } = store.getState();
    actions.setActiveCamera("cfht-nanaao");
    expect(calls).toEqual([null]);
    actions.togglePanel("calibration");
    actions.addImagePoint(612.4, 433);
    expect(calls).toEqual([null, [612.4, 433]]);
    actions.addImagePoint(10, 20); // replaces it
    expect(calls.at(-1)).toEqual([10, 20]);
    actions.togglePanel("calibration"); // closed: hidden, still pending
    expect(calls.at(-1)).toBeNull();
    expect(store.getState().calibrationUi.pendingPx).toEqual([10, 20]);
    actions.togglePanel("calibration");
    expect(calls.at(-1)).toEqual([10, 20]);
    actions.cancelImagePoint();
    expect(calls.at(-1)).toBeNull();
    const count = calls.length;
    const t0 = store.getState().clock.simTimeMs;
    for (let i = 1; i <= 100; i++) actions.tick(t0 + i * 16);
    expect(calls).toHaveLength(count);
    unbind();
    actions.addImagePoint(1, 2);
    expect(calls).toHaveLength(count);
  });
});
