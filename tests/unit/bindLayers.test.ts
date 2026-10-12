import { readFileSync } from "node:fs";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import { describe, expect, it } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import { bindBodiesVisible } from "../../src/map/sync/bindCalibrationView";
import { bindLayerVisible, bindSkyLayerVisible } from "../../src/map/sync/bindLayers";
import { withM5CameraEntries } from "../helpers/m5Cameras";
import { storeAt } from "../helpers/store";

/** A store on the committed cameras plus M5's entries (local-replay for a local-video camera). */
function m5Store() {
  const store = storeAt("2026-10-11T08:00:00Z");
  const json: unknown = JSON.parse(
    readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
  );
  store.getState().actions.setRegistry(parseCameraRegistry(withM5CameraEntries(json)));
  return store;
}

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

describe("bindSkyLayerVisible [M5]", () => {
  it("the README run: the grid over a synthetic camera, a YouTube player and a clip", () => {
    const store = m5Store();
    const { actions } = store.getState();
    const layer = new VectorLayer();
    const visible: boolean[] = [];
    layer.on("change:visible", () => visible.push(layer.getVisible()));
    const unbind = bindSkyLayerVisible(store, "grid", layer);
    expect(layer.getVisible()).toBe(true); // synthetic: the plain toggle
    actions.setActiveCamera("subaru-starcam");
    expect(layer.getVisible()).toBe(false); // over a video: needs layers.video.grid
    const changes = visible.length;
    actions.tick(store.getState().clock.simTimeMs + 1_000);
    expect(visible).toHaveLength(changes); // a clock tick changes nothing
    actions.setVideoLayer("grid", true);
    expect(layer.getVisible()).toBe(true);
    actions.setLayer("grid", false);
    expect(layer.getVisible()).toBe(false);
    actions.setLayer("grid", true);
    expect(layer.getVisible()).toBe(true);
    actions.setActiveCamera("local-replay");
    expect(layer.getVisible()).toBe(true); // layers.video.grid is still on
    unbind();
    actions.setVideoLayer("grid", false);
    expect(layer.getVisible()).toBe(true);
  });

  it("Starlink over a video needs both its layer and its video gate; stars and satellites keep theirs", () => {
    const store = m5Store();
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    const starlink = new VectorLayer();
    const stars = new VectorLayer();
    const satellites = new VectorLayer();
    const unbinds = [
      bindSkyLayerVisible(store, "starlink", starlink),
      bindSkyLayerVisible(store, "stars", stars),
      bindSkyLayerVisible(store, "satellites", satellites),
    ];
    expect([starlink, stars, satellites].map((l) => l.getVisible())).toEqual([false, true, true]);
    actions.setLayer("starlink", true);
    expect(starlink.getVisible()).toBe(false);
    actions.setVideoLayer("starlink", true);
    expect(starlink.getVisible()).toBe(true);
    for (const unbind of unbinds) unbind();
  });

  it("bindBodiesVisible keeps M4's rule over a video: planets on, and always while calibrating", () => {
    const store = m5Store();
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    const bodies = new VectorLayer();
    const unbind = bindBodiesVisible(store, bodies);
    expect(bodies.getVisible()).toBe(true);
    actions.setLayer("planets", false);
    expect(bodies.getVisible()).toBe(false);
    actions.openPanel("calibration");
    expect(bodies.getVisible()).toBe(true);
    unbind();
  });
});
