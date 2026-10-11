import TileLayer from "ol/layer/Tile";
import { describe, expect, it } from "vitest";
import { bindLayerVisible } from "../../src/map/sync/bindLayers";
import { storeAt } from "../helpers/store";

describe("bindLayerVisible", () => {
  it("both overlay layers follow the coastlines toggle", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    store.getState().actions.setLayer("coastlines", false);
    const overlays = [new TileLayer(), new TileLayer()];
    const unbinds = overlays.map((layer) => bindLayerVisible(store, "coastlines", layer));
    expect(overlays.map((l) => l.getVisible())).toEqual([false, false]);
    store.getState().actions.toggleLayer("coastlines");
    expect(overlays.map((l) => l.getVisible())).toEqual([true, true]);
    for (const unbind of unbinds) unbind();
    store.getState().actions.toggleLayer("coastlines");
    expect(overlays.map((l) => l.getVisible())).toEqual([true, true]);
  });
});
