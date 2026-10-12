// src/map/sync/bindFollow.ts — the ground map keeps the selected satellite centred while selection.follow is on
// (M3 step 14.6). A drag on the map turns follow off. The Inspector's "Show on map" animates the centre itself.
import type OlMap from "ol/Map";
import ViewHint from "ol/ViewHint";
import { registerFrameUpdater } from "../../state/clockLoop";
import { indexOfObjectId, type SatFrame, updateEphemerisFrame } from "../../state/ephemeris";
import type { AppStore } from "../../state/store";
import type { ObjectId } from "../../state/types";

/** SatFrame flag bit 0. */
const FLAG_VALID = 1;

/** What bindFollow needs from the ephemeris and the clock loop; tests pass fakes. */
export interface FollowDeps {
  updateEphemerisFrame(simTimeMs: number): SatFrame;
  indexOfObjectId(id: ObjectId): number | null;
  registerFrameUpdater(fn: (simTimeMs: number) => void): () => void;
}

const APP_DEPS: FollowDeps = { updateEphemerisFrame, indexOfObjectId, registerFrameUpdater };

/**
 * While selection.follow is on and a satellite with a position is selected, a frame updater centres the view on it
 * (the world copy nearest the current centre: the view is not wrapped). It leaves the view alone while it animates
 * or the user interacts, and sets nothing when the centre is already there, so a paused map is not redrawn. A
 * `pointerdrag` calls setFollow(false). Returns the function that removes both.
 */
export function bindFollow(store: AppStore, map: OlMap, deps: FollowDeps = APP_DEPS): () => void {
  const onDrag = (): void => {
    const { selection, actions } = store.getState();
    if (selection.follow) actions.setFollow(false);
  };
  map.on("pointerdrag", onDrag);

  const unregister = deps.registerFrameUpdater((simTimeMs) => {
    const { follow, selectedId } = store.getState().selection;
    if (!follow || selectedId === null || !selectedId.startsWith("sat:")) return;
    const frame = deps.updateEphemerisFrame(simTimeMs);
    const i = deps.indexOfObjectId(selectedId);
    if (!frame.ready || i === null || ((frame.flags[i] ?? 0) & FLAG_VALID) === 0) return;
    const view = map.getView();
    const hints = view.getHints();
    if ((hints[ViewHint.ANIMATING] ?? 0) > 0 || (hints[ViewHint.INTERACTING] ?? 0) > 0) return;
    let x = frame.mercator[2 * i] ?? Number.NaN;
    const y = frame.mercator[2 * i + 1] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const centre = view.getCenter();
    const extent = view.getProjection().getExtent();
    const worldWidth = (extent[2] ?? 0) - (extent[0] ?? 0);
    if (centre !== undefined && worldWidth > 0) {
      x += worldWidth * Math.round(((centre[0] ?? x) - x) / worldWidth);
    }
    if (centre !== undefined && centre[0] === x && centre[1] === y) return;
    view.setCenter([x, y]);
  });

  return () => {
    map.un("pointerdrag", onDrag);
    unregister();
  };
}
