// src/map/sync/bindCalibrationView.ts — what the sky view adds while the Calibration panel is open (M4 step 14): the
// Sun, Moon and planets whatever their toggle says (they are calibration targets), and the pending image point.
import type BaseLayer from "ol/layer/Base";
import { shallow } from "zustand/vanilla/shallow";
import { selectSkyLayerVisible } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { CalibrationUiState } from "../../state/types";

/**
 * [M4] The bodies layer shows with `layers.planets`, and always while the Calibration panel is open. [M5] Through
 * selectSkyLayerVisible, like every sky layer (the light set keeps the Sun, Moon and planets over a video).
 */
const planetsVisible = selectSkyLayerVisible("planets");
export function bindBodiesVisible(store: AppStore, layer: BaseLayer): () => void {
  return store.subscribe(
    (s) => planetsVisible(s) || s.ui.panel === "calibration",
    (on) => layer.setVisible(on),
    { equalityFn: shallow, fireImmediately: true },
  );
}

/** [M4] Calls apply with the pending image point while the Calibration panel is open, else with null. */
export function bindPendingPoint(
  store: AppStore,
  apply: (pendingPx: CalibrationUiState["pendingPx"]) => void,
): () => void {
  return store.subscribe(
    (s) => (s.ui.panel === "calibration" ? s.calibrationUi.pendingPx : null),
    (pendingPx) => apply(pendingPx),
    { equalityFn: shallow, fireImmediately: true },
  );
}
