import Feature from "ol/Feature";
import type Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import View from "ol/View";
import { describe, expect, it } from "vitest";
import { bindSite } from "../../src/map/sync/bindSite";
import { committedCameras, storeAt } from "../helpers/store";

function setup() {
  const store = storeAt("2026-10-10T03:30:00Z");
  const feature = new Feature<Point>();
  const view = new View({ center: [0, 0], zoom: 6 });
  let geometryChanges = 0;
  feature.on("change:geometry", () => {
    geometryChanges += 1;
  });
  const unbind = bindSite(store, feature, view);
  return { store, feature, view, unbind, geometryChanges: () => geometryChanges };
}

describe("bindSite", () => {
  it("places the marker at the site, names it and centres the view", () => {
    const { feature, view } = setup();
    const coordinates = feature.getGeometry()?.getCoordinates() ?? [];
    const expected = fromLonLat([-155.4689, 19.8253]);
    expect(coordinates).toEqual(expected);
    expect(coordinates[0]).toBeCloseTo(-17306718.78, 2);
    expect(coordinates[1]).toBeCloseTo(2252346.76, 2);
    expect(view.getCenter()).toEqual(expected);
    expect(feature.get("name")).toBe("Computed sky, Maunakea");
  });

  it("one geometry change over 100 ticks", () => {
    const { store, geometryChanges } = setup();
    const t0 = store.getState().clock.simTimeMs;
    for (let i = 1; i <= 100; i += 1) store.getState().actions.tick(t0 + i * 16);
    expect(geometryChanges()).toBe(1);
  });

  it("follows a camera change, and nothing moves after unbind", () => {
    const { store, feature, view, unbind } = setup();
    store.getState().actions.setRegistry(committedCameras());
    store.getState().actions.setActiveCamera("synthetic-walenstadt");
    const walenstadt = fromLonLat([9.3242, 47.1236]);
    expect(feature.getGeometry()?.getCoordinates()).toEqual(walenstadt);
    expect(view.getCenter()).toEqual(walenstadt);
    expect(feature.get("name")).toBe("Computed sky, Walenstadt");
    unbind();
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expect(feature.getGeometry()?.getCoordinates()).toEqual(walenstadt);
    expect(view.getCenter()).toEqual(walenstadt);
  });

  it("clears the marker when the active camera is not in the registry", () => {
    const { store, feature } = setup();
    store.getState().actions.setActiveCamera("nope");
    expect(feature.getGeometry()).toBeUndefined();
  });
});
