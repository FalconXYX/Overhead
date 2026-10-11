// src/map/ground/createGroundMap.ts — the ground map: layers, bindings and registration (M1 step 13).
// A new map on every call: GroundView's effect may run mount, cleanup, mount under StrictMode.
import { defaults as defaultControls } from "ol/control/defaults";
import type BaseLayer from "ol/layer/Base";
import OlMap from "ol/Map";
import View from "ol/View";
import { selectTrueColorDate } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import { registerMap } from "../registry";
import { bindTrueColorDate } from "../sync/bindGibs";
import { bindLayerVisible } from "../sync/bindLayers";
import { bindSite } from "../sync/bindSite";
import { createOverlayLayers, createTrueColorLayer, type GibsCapabilities } from "./layers/gibs";
import { createSiteLayer } from "./layers/site";

/** Builds the map in `target` and returns its cleanup (registerMap). caps null: only the site marker. */
export function createGroundMap(
  target: HTMLElement,
  store: AppStore,
  caps: GibsCapabilities | null,
): () => void {
  // Level9 tiles overzoom past z9; bindSite centres the view on the site.
  const view = new View({ center: [0, 0], zoom: 6, minZoom: 2, maxZoom: 12 });
  const layers: BaseLayer[] = [];
  const disposers: (() => void)[] = [];

  const date = selectTrueColorDate(store.getState());
  if (caps !== null && date !== null) {
    // Built with the computed date, so the black capabilities Default is never requested.
    const trueColor = createTrueColorLayer(caps, date);
    const source = trueColor.getSource();
    if (source === null) throw new Error("createTrueColorLayer returned a layer without a source");
    const overlays = createOverlayLayers(caps);
    layers.push(trueColor, ...overlays);
    disposers.push(
      bindLayerVisible(store, "trueColor", trueColor),
      bindTrueColorDate(store, source),
    );
    for (const overlay of overlays) disposers.push(bindLayerVisible(store, "coastlines", overlay));
  }

  const site = createSiteLayer();
  layers.push(site.layer);
  disposers.push(bindSite(store, site.feature, view));

  // Credits.tsx is the only credit display.
  const map = new OlMap({
    target,
    layers,
    view,
    controls: defaultControls({ attribution: false }),
  });
  return registerMap("ground", map, disposers);
}
