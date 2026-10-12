// src/map/sync/bindFootprint.ts — the footprint polygon follows the camera, its calibration, the site, the terrain
// profile and the chosen height (M8 step 8.3). With no preset it follows the selected satellite's geodetic height,
// recomputed when that moves ≥ 1 km (about 30 times per ISS orbit at 1×); otherwise it is drawn at 420 km. Writes
// footprintStatus in place on every recompute, before the polygon. Never on clock ticks, except to follow the
// selection.
import type Polygon from "ol/geom/Polygon";
import { fromEPSG4326 } from "ol/proj/epsg3857";
import { shallow } from "zustand/vanilla/shallow";
import {
  createCameraModel,
  FOOTPRINT_FALLBACK_HEIGHT_KM,
  FOOTPRINT_SAMPLES_PER_EDGE,
  footprintLonLatDeg,
  footprintMaxPairs,
} from "../../domain/camera";
import { registerFrameUpdater } from "../../state/clockLoop";
import { heightKmOf, indexOfObjectId, updateEphemerisFrame } from "../../state/ephemeris";
import { footprintStatus } from "../../state/footprintStatus";
import {
  selectActiveCamera,
  selectCalibration,
  selectHorizonProfileDeg,
  selectSite,
} from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { AppState } from "../../state/types";

/** The selected satellite's height must move this far before the polygon is rebuilt. */
const FOLLOW_STEP_KM = 1;

/** Index of the selected satellite when the footprint follows it: on, no preset, and a `sat:` selection. */
function followedIndex(s: AppState): number | null {
  const id = s.selection.selectedId;
  if (!s.layers.footprint || s.layers.footprintHeightKm !== null || id === null) return null;
  return id.startsWith("sat:") ? indexOfObjectId(id) : null;
}

/**
 * [M8] Binds the footprint polygon (createFootprintLayer's). Returns the disposer: it unsubscribes and unregisters the
 * frame updater. Allocates the ring's coordinate arrays once per vertex count it has seen, never per frame.
 */
export function bindFootprint(store: AppStore, polygon: Polygon): () => void {
  const lonLat = new Float64Array(2 * footprintMaxPairs(FOOTPRINT_SAMPLES_PER_EDGE));
  const pool: number[][] = []; // one [x, y] per vertex, reused
  const ring: number[][] = [];
  const rings = [ring];

  function clear(): void {
    // setCoordinates always fires a change: skip it when nothing is drawn.
    if (polygon.getFlatCoordinates().length > 0) polygon.setCoordinates([]);
  }

  /** Rebuilds the polygon; `followedKm` is the selected satellite's height when the frame updater passes it. */
  function recompute(followedKm?: number): void {
    const s = store.getState();
    if (!s.layers.footprint) {
      footprintStatus.heightKm = null;
      footprintStatus.source = "fallback";
      footprintStatus.pairCount = 0;
      clear();
      return;
    }
    // The height: the preset, else the selected satellite's, else 420 km.
    let heightKm: number = FOOTPRINT_FALLBACK_HEIGHT_KM;
    let source: typeof footprintStatus.source = "fallback";
    const preset = s.layers.footprintHeightKm;
    if (preset !== null) {
      heightKm = preset;
      source = "preset";
    } else {
      const index = followedIndex(s);
      const h = followedKm ?? (index === null ? null : heightKmOf(index));
      if (h !== null) {
        heightKm = h;
        source = "selected";
      }
    }
    const camera = selectActiveCamera(s);
    const calibration = selectCalibration(s);
    let pairs = 0;
    if (camera !== undefined && calibration !== undefined) {
      const model = createCameraModel({
        lens: camera.lens,
        calibration,
        widthPx: camera.imageSize.widthPx,
        heightPx: camera.imageSize.heightPx,
      });
      pairs = footprintLonLatDeg(
        model,
        camera.site,
        heightKm,
        FOOTPRINT_SAMPLES_PER_EDGE,
        selectHorizonProfileDeg(s),
        lonLat,
      );
    }
    // The status first: a change listener or the label style reading it sees this ring's values.
    footprintStatus.heightKm = heightKm;
    footprintStatus.source = source;
    footprintStatus.pairCount = pairs;
    if (pairs === 0) {
      clear();
    } else {
      // n + 1 coordinates in EPSG:3857, the last a copy of the first; fromEPSG4326 never wraps, so the ring keeps the
      // site's world copy (gotcha 11). One setCoordinates: one change.
      ring.length = 0;
      for (let i = 0; i <= pairs; i++) {
        const k = i === pairs ? 0 : i;
        let xy = pool[i];
        if (xy === undefined) {
          xy = [0, 0];
          pool[i] = xy;
        }
        xy[0] = lonLat[2 * k] ?? Number.NaN;
        xy[1] = lonLat[2 * k + 1] ?? Number.NaN;
        fromEPSG4326(xy, xy, 2);
        ring.push(xy);
      }
      polygon.setCoordinates(rings);
    }
  }

  const unsubscribe = store.subscribe(
    (s) =>
      [
        s.layers.footprint,
        s.layers.footprintHeightKm,
        s.selection.selectedId,
        // [M8] The entry, not only its id: a clip replaces local-replay's entry (site and image size) in place.
        selectActiveCamera(s),
        selectCalibration(s),
        selectSite(s),
        selectHorizonProfileDeg(s),
      ] as const,
    () => recompute(),
    { equalityFn: shallow, fireImmediately: true },
  );

  // Following the selection: the height moves continuously, so the frame loop checks it.
  const unregister = registerFrameUpdater((simTimeMs) => {
    const index = followedIndex(store.getState());
    if (index === null) return;
    updateEphemerisFrame(simTimeMs); // computes once per frame: free when another updater ran it
    const h = heightKmOf(index);
    if (h === null) return;
    if (
      footprintStatus.source !== "selected" ||
      !(Math.abs(h - (footprintStatus.heightKm ?? Number.NaN)) < FOLLOW_STEP_KM)
    ) {
      recompute(h);
    }
  });

  return () => {
    unsubscribe();
    unregister();
  };
}
