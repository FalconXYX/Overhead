// src/map/sync/bindLayers.ts — one visibility binding per toggle and OpenLayers layer (README Binding rules).
import type BaseLayer from "ol/layer/Base";
import { shallow } from "zustand/vanilla/shallow";
import { selectSkyLayerVisible } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { LayerToggle } from "../../state/types";

/** One call per toggle and OpenLayers layer: ground-map layers (sky layers use bindSkyLayerVisible from M5). */
export function bindLayerVisible(store: AppStore, key: LayerToggle, layer: BaseLayer): () => void {
  return store.subscribe(
    (s) => s.layers[key],
    (on) => layer.setVisible(on),
    {
      equalityFn: shallow,
      fireImmediately: true,
    },
  );
}

/** [M5] Sky-view layers: the toggle, gated by layers.video while the sky is over a video. */
export function bindSkyLayerVisible(
  store: AppStore,
  key: LayerToggle,
  layer: BaseLayer,
): () => void {
  return store.subscribe(selectSkyLayerVisible(key), (on) => layer.setVisible(on), {
    equalityFn: shallow,
    fireImmediately: true,
  });
}
