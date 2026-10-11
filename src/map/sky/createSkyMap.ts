// src/map/sky/createSkyMap.ts — the sky view: a pixel projection of the camera frame, three layers and the per-frame
// sky pass (M2 step 8). A new map on every call: SkyView's effect may run mount, cleanup, mount under StrictMode.
import { getCenter } from "ol/extent";
import type VectorLayer from "ol/layer/Vector";
import OlMap from "ol/Map";
import Projection from "ol/proj/Projection";
import type VectorSource from "ol/source/Vector";
import View from "ol/View";
import type { StarRow } from "../../domain/astro";
import { type CameraModel, projectBatch, toSkyMapCoord } from "../../domain/camera";
import { selectActiveCamera, selectSite, selectStarMagLimit } from "../../state/selectors";
import {
  invalidateSky,
  type SkyCache,
  // The committed catalogue's row count, shared with loadStars, which rejects a longer file.
  MAX_STAR_ROWS as STAR_CAPACITY,
  setStarLimit,
  updateSky,
} from "../../state/skyCache";
import type { AppStore } from "../../state/store";
import { createBodiesLayer, writeBodies } from "./layers/bodies";
import { buildGridFeatures, createGridLayer } from "./layers/grid";
import { createStarsLayer, setStarCount, setStarRadii } from "./layers/stars";

/** Visual design, settled from screenshots: a placeholder that reads on the default page background. */
const STAR_FILL = "#222";
/** The frame until the first setCameraModel when the registry is still loading. */
const DEFAULT_FRAME_PX = 1024;

/** Functions are closures, not methods that use `this`: updateFrame is passed to registerFrameUpdater unbound. */
export interface SkyMapHandle {
  readonly map: OlMap;
  readonly gridLayer: VectorLayer<VectorSource>;
  readonly starsLayer: VectorLayer<VectorSource>;
  readonly bodiesLayer: VectorLayer<VectorSource>;
  setCameraModel(model: CameraModel): void; // called by bindSkyCamera
  updateFrame(simTimeMs: number): void; // registered with registerFrameUpdater
}

/** Pixel projection of one camera frame: a pixel (u, v) is the coordinate [u, H − v]. */
export function skyPixelProjection(widthPx: number, heightPx: number): Projection {
  return new Projection({
    code: `sky-px-${widthPx}x${heightPx}`,
    units: "pixels",
    extent: [0, 0, widthPx, heightPx],
  });
}

/** One view per frame size. Without maxResolution, OpenLayers caps it at max(W, H)/256. */
export function createSkyView(widthPx: number, heightPx: number): View {
  const projection = skyPixelProjection(widthPx, heightPx);
  return new View({
    projection,
    center: getCenter(projection.getExtent()),
    resolution: 1,
    maxResolution: Math.max(widthPx, heightPx),
    enableRotation: false,
  });
}

/** Fits the current view's whole frame (its projection extent) into the map's size. */
export function fitSkyFrame(map: OlMap): void {
  const size = map.getSize();
  if (size === undefined || !((size[0] ?? 0) > 0 && (size[1] ?? 0) > 0)) return;
  const view = map.getView();
  view.fit(view.getProjection().getExtent(), { size });
}

/** No interactions or controls: the sky view always shows the whole frame. */
export function createSkyOlMap(target: HTMLElement, widthPx: number, heightPx: number): OlMap {
  const map = new OlMap({
    target,
    controls: [],
    interactions: [],
    view: createSkyView(widthPx, heightPx),
  });
  map.on("change:size", () => fitSkyFrame(map));
  fitSkyFrame(map);
  return map;
}

/**
 * Builds the map in `target` with the grid, stars and bodies layers (bottom to top). The caller registers it with
 * registerMap and starts bindSkyCamera, the layer bindings and updateFrame (SkyView).
 */
export function createSkyMap(target: HTMLElement, store: AppStore, cache: SkyCache): SkyMapHandle {
  const imageSize = selectActiveCamera(store.getState())?.imageSize;
  const map = createSkyOlMap(
    target,
    imageSize?.widthPx ?? DEFAULT_FRAME_PX,
    imageSize?.heightPx ?? DEFAULT_FRAME_PX,
  );
  const gridLayer = createGridLayer();
  const stars = createStarsLayer(STAR_CAPACITY, STAR_FILL);
  const bodies = createBodiesLayer();
  map.addLayer(gridLayer);
  map.addLayer(stars.layer);
  map.addLayer(bodies.layer);
  // The cache outlives this map: a new map must not wait 2 s of sim time for its first pass.
  invalidateSky(cache);

  let model: CameraModel | null = null;
  let seenRows: readonly StarRow[] | null = null;
  const uvPx = new Float32Array(2 * STAR_CAPACITY); // projectBatch output, reused every pass

  function setCameraModel(next: CameraModel): void {
    const extent = map.getView().getProjection().getExtent();
    if (extent[2] !== next.widthPx || extent[3] !== next.heightPx) {
      map.setView(createSkyView(next.widthPx, next.heightPx));
      fitSkyFrame(map); // setView fires no change:size
      // Points of the old frame could fall outside the new one and shift the per-star arrays (gotcha 20): park
      // them at the corner, hidden, until the pass that invalidateSky below forces.
      setStarCount(stars, cache.starCount);
    }
    model = next;
    const source = gridLayer.getSource();
    source?.clear(true);
    source?.addFeatures(buildGridFeatures(next));
    invalidateSky(cache);
  }

  function updateFrame(simTimeMs: number): void {
    const state = store.getState();
    const site = selectSite(state);
    const m = model;
    if (m === null || site === null) return;
    if (cache.rows !== seenRows) {
      // The catalogue arrived, or this map is new: setStars or createSkyMap already cleared lastSkyMs.
      seenRows = cache.rows;
      setStarRadii(stars, cache.rows);
      setStarCount(stars, cache.starCount);
    } else if (setStarLimit(cache, selectStarMagLimit(state))) {
      setStarCount(stars, cache.starCount); // setStarLimit cleared lastSkyMs, so the pass below refills the points
    }

    const t0 = performance.now();
    if (!updateSky(cache, simTimeMs, site)) return;

    const count = Math.min(cache.starCount, STAR_CAPACITY);
    projectBatch(m, cache.starAzAltDeg, count, uvPx, stars.visible);
    const flat = stars.geometry.getFlatCoordinates();
    const centreU = m.widthPx / 2;
    const centreV = m.heightPx / 2;
    for (let i = 0; i < count; i++) {
      if (stars.visible[i] === 1) {
        toSkyMapCoord(m, uvPx[2 * i] ?? centreU, uvPx[2 * i + 1] ?? centreV, flat, 2 * i);
      } else {
        // Culled: the frame centre, never off-frame and never NaN (gotcha 20).
        toSkyMapCoord(m, centreU, centreV, flat, 2 * i);
      }
    }
    stars.geometry.changed();
    writeBodies(bodies, m, cache.bodies);

    // Cleared at once so the buffer does not grow at 60 entries per second; a PerformanceObserver still sees each.
    performance.measure("overhead:sky", { start: t0 });
    performance.clearMeasures("overhead:sky");
  }

  return {
    map,
    gridLayer,
    starsLayer: stars.layer,
    bodiesLayer: bodies.layer,
    setCameraModel,
    updateFrame,
  };
}
