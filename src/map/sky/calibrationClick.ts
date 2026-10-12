// src/map/sky/calibrationClick.ts — the sky map's calibration clicks (M4 steps 11.3 and 14.4). createSkyMap calls
// these from its `singleclick` listener, which does not fire on a double-click zoom; the rule itself (pairClick) and
// the catalogue markers are the Calibration panel's, in src/ui/calibrationPairs.ts (pure, no React).
import type { StarRow } from "../../domain/astro";
import { createCameraModel } from "../../domain/camera";
import { selectActiveCamera, selectCalibration } from "../../state/selectors";
import type { Actions, AppState } from "../../state/types";
import {
  catalogTargetsAt,
  type PairClick,
  type ProjectedTarget,
  pairClick,
  projectTargets,
} from "../../ui/calibrationPairs";

/**
 * The calibration meaning of a sky-map singleclick at map coordinate [x, y], whose image pixel is (u, v) = (x, H − y),
 * or null when it is an ordinary click: the Calibration panel is closed, the active camera is not a still image or
 * [M5] a clip, no frame is on screen (frameTimeMs null), or the resolution is not a positive number. `resolution` is the view's
 * image px per screen px; `rows` the star catalogue, used only once `data.stars` is "ready" (planets otherwise).
 * The markers (stars V ≤ 4 and planets at frameTimeMs, under the current calibration) are computed only while a
 * point is pending, since only then can a click complete a pair.
 */
export function calibrationClickAt(
  state: AppState,
  rows: readonly StarRow[],
  x: number,
  y: number,
  resolution: number,
): PairClick | null {
  if (state.ui.panel !== "calibration") return null;
  if (!(resolution > 0 && Number.isFinite(resolution))) return null;
  const camera = selectActiveCamera(state);
  const calibration = selectCalibration(state);
  const frameTimeMs = state.camera.frameTimeMs;
  // [M5] A paused clip is an image camera too (M5 step 11.4).
  const image = camera?.kind === "still-image" || camera?.kind === "local-video";
  if (camera === undefined || !image || calibration === undefined || frameTimeMs === null) {
    return null;
  }
  const { widthPx, heightPx } = camera.imageSize;
  const { pendingPx } = state.calibrationUi;
  let projected: ProjectedTarget[] = [];
  if (pendingPx !== null) {
    const model = createCameraModel({ lens: camera.lens, calibration, widthPx, heightPx });
    const catalogue = state.data.stars === "ready" ? rows : [];
    projected = projectTargets(model, catalogTargetsAt(catalogue, camera.site, frameTimeMs));
  }
  return pairClick(x, heightPx - y, widthPx, heightPx, pendingPx, projected, resolution);
}

/** add → addImagePoint(u, v) (it replaces a pending point); complete → completePair(targetId); ignore → nothing. */
export function applyPairClick(
  actions: Pick<Actions, "addImagePoint" | "completePair">,
  click: PairClick,
): void {
  if (click.kind === "add") actions.addImagePoint(click.uPx, click.vPx);
  else if (click.kind === "complete") actions.completePair(click.targetId);
}

// ---- [M5] The Satellite check's clicks (M5 step 13) ----

/** The Satellite check's handler while its toggle says "satellite check"; null: clicks add star pairs. */
let satelliteCheckClick: ((uPx: number, vPx: number) => void) | null = null;

/**
 * [M5] Routes the sky map's calibration clicks to the Satellite check instead of the star pairs while a handler is
 * set; returns the remover, which clears it only while it is still the one set.
 */
export function setSatelliteCheckClicks(handler: (uPx: number, vPx: number) => void): () => void {
  satelliteCheckClick = handler;
  return () => {
    if (satelliteCheckClick === handler) satelliteCheckClick = null;
  };
}

/**
 * [M5] Hands a sky-map singleclick at map coordinate [x, y] to the Satellite check as image pixel (x, H − y) when a
 * handler is set, the Calibration panel is open and a frame of an image camera is on screen; true when it took the
 * click (createSkyMap then neither selects nor adds a pair).
 */
export function satelliteCheckClickAt(state: AppState, x: number, y: number): boolean {
  const handler = satelliteCheckClick;
  if (handler === null || state.ui.panel !== "calibration" || state.camera.frameTimeMs === null)
    return false;
  const camera = selectActiveCamera(state);
  if (camera?.kind !== "still-image" && camera?.kind !== "local-video") return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  handler(x, camera.imageSize.heightPx - y);
  return true;
}
