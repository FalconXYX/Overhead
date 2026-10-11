// src/map/sync/bindTracks.ts — ground-track requests and the tracks layer (M3 step 14.4, README "Propagation: tracks
// and incoming" rule 1). The selected satellite gets ±10 min, the stations and visual satellites inside the sky frame
// ±3 min (cap 100; Starlink only when selected). Requests go out on a selection change, a change of that set, or a
// change of floor(simTimeMs / 20000), at most 10 per second. RequestGate also paces the sky paths (createSkyMap).
import { shallow } from "zustand/vanilla/shallow";
import { type CameraModel, createCameraModel, projectAzAltDeg } from "../../domain/camera";
import { TRACK_STEP_MS } from "../../domain/time";
import { registerFrameUpdater } from "../../state/clockLoop";
import {
  type Ephemeris,
  ephemeris,
  indexOfObjectId,
  requestTracks,
  type SatCatalog,
  type SatFrame,
  updateEphemerisFrame,
} from "../../state/ephemeris";
import { selectActiveCamera, selectCalibration } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { ObjectId } from "../../state/types";
import { type GroundTracks, writeTracks } from "../ground/layers/tracks";

/** At most 10 requests per second, so a burst never delays a sample past its slot (gotcha 23). */
export const MIN_REQUEST_INTERVAL_MS = 100;
/** Cap on the tracked set (tracks and sky paths). */
export const MAX_TRACKED = 100;

/** SatFrame flag bits (README section 6, ephemeris.ts). */
const FLAG_VALID = 1;
/** GP_GROUPS index of Starlink. */
const STARLINK_GROUP = 2;

/**
 * Decides when a path request goes out: when the time slot, the selected index (−1 for none) or the index set
 * differs from the last request sent, and that request is at least MIN_REQUEST_INTERVAL_MS old (wall clock). A
 * change that arrives too early is kept until it can go. Nothing selected and nothing to track is sent once (to
 * clear what is drawn) and then not again. Allocates only when the set outgrows its copy.
 */
export class RequestGate {
  private slot = Number.NaN;
  private selected = -1;
  private count = 0;
  private indices = new Int32Array(MAX_TRACKED);
  private lastWallMs = Number.NEGATIVE_INFINITY;

  offer(
    wallMs: number,
    slot: number,
    selected: number,
    indices: Int32Array,
    count: number,
  ): boolean {
    const empty = count === 0 && selected < 0;
    if (empty && this.count === 0 && this.selected < 0) return false;
    if (slot === this.slot && selected === this.selected && this.sameSet(indices, count))
      return false;
    if (wallMs - this.lastWallMs < MIN_REQUEST_INTERVAL_MS) return false;
    this.lastWallMs = wallMs;
    this.slot = slot;
    this.selected = selected;
    if (count > this.indices.length) this.indices = new Int32Array(count);
    this.indices.set(indices.subarray(0, count));
    this.count = count;
    return true;
  }

  private sameSet(indices: Int32Array, count: number): boolean {
    if (count !== this.count) return false;
    for (let i = 0; i < count; i++) if (indices[i] !== this.indices[i]) return false;
    return true;
  }
}

const scratchUv = new Float64Array(2);

/**
 * Writes into `out` the indices of the stations and visual satellites inside the sky frame (valid, not docked,
 * projectAzAltDeg true and 0 ≤ u ≤ W, 0 ≤ v ≤ H), in catalog order, without `selectedIndex`, up to `cap`. Returns
 * the count; 0 before the first ready frame.
 */
export function framedTrackIndices(
  model: CameraModel,
  frame: SatFrame,
  catalog: SatCatalog,
  selectedIndex: number | null,
  out: Int32Array,
  cap: number,
): number {
  if (!frame.ready) return 0;
  const max = Math.min(cap, out.length);
  const n = Math.min(catalog.count, frame.flags.length);
  let count = 0;
  for (let i = 0; i < n && count < max; i++) {
    if (i === selectedIndex || ((frame.flags[i] ?? 0) & FLAG_VALID) === 0) continue;
    if ((catalog.dockedWith[i] ?? -1) !== -1 || catalog.groupIndex[i] === STARLINK_GROUP) continue;
    const az = frame.azAltDeg[2 * i] ?? Number.NaN;
    const alt = frame.azAltDeg[2 * i + 1] ?? Number.NaN;
    if (!projectAzAltDeg(model, az, alt, scratchUv, 0)) continue;
    const u = scratchUv[0] ?? Number.NaN;
    const v = scratchUv[1] ?? Number.NaN;
    if (!(u >= 0 && u <= model.widthPx && v >= 0 && v <= model.heightPx)) continue;
    out[count++] = i;
  }
  return count;
}

/** What bindTracks needs from the ephemeris and the clock loop; tests pass fakes. */
export interface TrackDeps {
  readonly ephemeris: Pick<Ephemeris, "catalog" | "tracks" | "pathsVersion">;
  updateEphemerisFrame(simTimeMs: number): SatFrame;
  requestTracks(timeMs: number, selectedIndex: number | null, otherIndices: Int32Array): void;
  indexOfObjectId(id: ObjectId): number | null;
  registerFrameUpdater(fn: (simTimeMs: number) => void): () => void;
  /** Wall clock for the 10-per-second limit. */
  nowMs(): number;
}

const APP_DEPS: TrackDeps = {
  ephemeris,
  updateEphemerisFrame,
  requestTracks,
  indexOfObjectId,
  registerFrameUpdater,
  nowMs: () => performance.now(),
};

/** The active camera's model, or null (no camera yet, or a lens createCameraModel does not support yet). */
function modelFor(store: AppStore): CameraModel | null {
  const state = store.getState();
  const camera = selectActiveCamera(state);
  const calibration = selectCalibration(state);
  if (camera === undefined || calibration === undefined) return null;
  try {
    return createCameraModel({
      lens: camera.lens,
      calibration,
      widthPx: camera.imageSize.widthPx,
      heightPx: camera.imageSize.heightPx,
    });
  } catch {
    return null; // M2's model throws for every lens but the zenith fisheye until M4: track the selection only
  }
}

/**
 * Requests tracks from a frame updater and redraws `tracks` whenever ephemeris.pathsVersion or the selected index
 * changes. Returns the function that removes both subscriptions and the frame updater.
 */
export function bindTracks(
  store: AppStore,
  tracks: GroundTracks,
  deps: TrackDeps = APP_DEPS,
): () => void {
  let model: CameraModel | null = null;
  let selectedId: ObjectId | null = null;
  const unsubscribeCamera = store.subscribe(
    (s) => [selectActiveCamera(s), selectCalibration(s)] as const,
    () => {
      model = modelFor(store);
    },
    { equalityFn: shallow, fireImmediately: true },
  );
  const unsubscribeSelection = store.subscribe(
    (s) => s.selection.selectedId,
    (id) => {
      selectedId = id;
    },
    { equalityFn: shallow, fireImmediately: true },
  );

  const gate = new RequestGate();
  const others = new Int32Array(MAX_TRACKED);
  let drawnVersion = Number.NaN;
  let drawnSelected = Number.NaN;

  const unregister = deps.registerFrameUpdater((simTimeMs) => {
    const frame = deps.updateEphemerisFrame(simTimeMs);
    const id = selectedId;
    const selected = id?.startsWith("sat:") ? deps.indexOfObjectId(id) : null;
    if (frame.ready) {
      const count =
        model !== null && store.getState().layers.satellites
          ? framedTrackIndices(model, frame, deps.ephemeris.catalog, selected, others, MAX_TRACKED)
          : 0;
      const slot = Math.floor(simTimeMs / TRACK_STEP_MS);
      if (gate.offer(deps.nowMs(), slot, selected ?? -1, others, count)) {
        // A copy: the request may transfer its array to the worker (gotcha 16).
        deps.requestTracks(simTimeMs, selected, others.slice(0, count));
      }
    }
    const version = deps.ephemeris.pathsVersion;
    const sel = selected ?? -1;
    if (version !== drawnVersion || sel !== drawnSelected) {
      drawnVersion = version;
      drawnSelected = sel;
      writeTracks(tracks, deps.ephemeris.tracks, selected);
    }
  });

  return () => {
    unsubscribeCamera();
    unsubscribeSelection();
    unregister();
  };
}
