// src/map/sky/createSkyMap.ts — the sky view: a pixel projection of the camera frame, its layers and the per-frame
// pass (M2 step 8; satellites, trails, selection, picking and the hover-card anchor in M3 step 13). A new map on
// every call: SkyView's effect may run mount, cleanup, mount under StrictMode.
import { getCenter } from "ol/extent";
import type VectorLayer from "ol/layer/Vector";
import OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import type { Pixel } from "ol/pixel";
import Projection from "ol/proj/Projection";
import type VectorSource from "ol/source/Vector";
import View from "ol/View";
import { recordHighlight } from "../../app/testHooks";
import { BODY_IDS, type StarRow } from "../../domain/astro";
import { type CameraModel, projectBatch, toSkyMapCoord } from "../../domain/camera";
import { ISS_NORAD_ID } from "../../domain/orbits";
import {
  ephemeris,
  indexOfObjectId,
  requestSkyPaths,
  type SatFrame,
  updateEphemerisFrame,
} from "../../state/ephemeris";
import {
  selectActiveCamera,
  selectSampleStepMs,
  selectSite,
  selectStarMagLimit,
} from "../../state/selectors";
import {
  invalidateSky,
  type SkyCache,
  // The committed catalogue's row count, shared with loadStars, which rejects a longer file.
  MAX_STAR_ROWS as STAR_CAPACITY,
  setStarLimit,
  updateSky,
} from "../../state/skyCache";
import type { AppStore } from "../../state/store";
import type { AppState, ObjectId } from "../../state/types";
import { SKY_PATH_STEP_MS } from "../../workers/protocol";
import { PICK_RADIUS_PX, pickNearest } from "../pick";
import { MAX_TRACKED, RequestGate } from "../sync/bindTracks";
import { createBodiesLayer, writeBodies } from "./layers/bodies";
import { buildGridFeatures, createGridLayer } from "./layers/grid";
import {
  createSkySatellites,
  LineWriter,
  type SkySatelliteIds,
  TRAIL_MS,
  trackedSkyIndices,
  writeSkySatellites,
  writeTrails,
} from "./layers/satellites";
import {
  createSkySelection,
  NEXT_PATH_MS,
  type SelectionTargets,
  writeNextPath,
  writeSkySelection,
} from "./layers/selection";
import { createStarsLayer, setStarCount, setStarRadii } from "./layers/stars";

/** Visual design, settled from screenshots: a placeholder that reads on the default page background. */
const STAR_FILL = "#222";
/** The frame until the first setCameraModel when the registry is still loading. */
const DEFAULT_FRAME_PX = 1024;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Accessibility rule 2: no trails while the user asks for reduced motion. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Functions are closures, not methods that use `this`: updateFrame is passed to registerFrameUpdater unbound. */
export interface SkyMapHandle {
  readonly map: OlMap;
  readonly gridLayer: VectorLayer<VectorSource>;
  readonly starsLayer: VectorLayer<VectorSource>;
  readonly bodiesLayer: VectorLayer<VectorSource>;
  setCameraModel(model: CameraModel): void; // called by bindSkyCamera
  updateFrame(simTimeMs: number): void; // registered with registerFrameUpdater
  readonly satellitesLayer: VectorLayer<VectorSource>; // [M3]
  readonly starlinkLayer: VectorLayer<VectorSource>; // [M3]
  readonly trailsLayer: VectorLayer<VectorSource>; // [M3]
  readonly selectionLayer: VectorLayer<VectorSource>; // [M3]
  readonly hoverElement: HTMLElement; // [M3] ol/Overlay element; SkyView portals HoverCard into it
  pick(pixel: Pixel): ObjectId | null; // [M3]
  /** [M3] bindSelection's apply: the ids the selection layer marks, redrawn at once. */
  setSelection(selectedId: ObjectId | null, hoverId: ObjectId | null): void;
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
 * Builds the map in `target`, bottom to top: grid, stars, bodies (M2), trails, satellites, starlink, selection (M3).
 * The caller registers it with registerMap and starts bindSkyCamera, the layer bindings, bindSelection with
 * setSelection, and updateFrame (SkyView). Picking: pointermove hovers, click selects (a miss selects null), leaving
 * the viewport hovers nothing.
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
  const sats = createSkySatellites();
  const selection = createSkySelection();
  for (const layer of [
    gridLayer,
    stars.layer,
    bodies.layer,
    sats.trailsLayer,
    sats.satellitesLayer,
    sats.starlinkLayer,
    selection.layer,
  ]) {
    map.addLayer(layer);
  }
  // The cache outlives this map: a new map must not wait 2 s of sim time for its first pass.
  invalidateSky(cache);

  // The hover card's anchor: SkyView portals HoverCard into hoverElement. It never takes the pointer.
  const hoverElement = document.createElement("div");
  hoverElement.style.pointerEvents = "none";
  const hoverOverlay = new Overlay({
    element: hoverElement,
    stopEvent: false,
    positioning: "bottom-left",
    offset: [14, -14],
  });
  map.addOverlay(hoverOverlay);

  let model: CameraModel | null = null;
  let seenRows: readonly StarRow[] | null = null;
  const uvPx = new Float32Array(2 * STAR_CAPACITY); // projectBatch output, reused every pass
  // Picking: 1 = not pickable; stars of the last pass that projectBatch culled, or beyond the prefix.
  const starSkip = new Uint8Array(STAR_CAPACITY).fill(1);
  let starPickCount = 0;

  let selectedId: ObjectId | null = null;
  let hoverId: ObjectId | null = null;
  const trailWriter = new LineWriter(sats.trails);
  const pathWriter = new LineWriter(selection.nextPath);
  const tracked = new Int32Array(MAX_TRACKED);
  const pathGate = new RequestGate();
  const reducedMotion = typeof matchMedia === "function" ? matchMedia(REDUCED_MOTION_QUERY) : null;
  let hoverX = Number.NaN;
  let hoverY = Number.NaN;
  // Reused every frame: the hot path allocates nothing (README section 9, rule 1).
  const ids: Mutable<SkySatelliteIds> = { iss: null, selected: null, hovered: null };
  const targets: Mutable<SelectionTargets> = {
    selectedId: null,
    hoverId: null,
    selectedIndex: null,
    hoverIndex: null,
    issIndex: null,
  };

  function setCameraModel(next: CameraModel): void {
    const extent = map.getView().getProjection().getExtent();
    if (extent[2] !== next.widthPx || extent[3] !== next.heightPx) {
      map.setView(createSkyView(next.widthPx, next.heightPx));
      fitSkyFrame(map); // setView fires no change:size
      // Points of the old frame could fall outside the new one and shift the per-star arrays (gotcha 20): park
      // them at the corner, hidden, until the pass that invalidateSky below forces.
      setStarCount(stars, cache.starCount);
      starSkip.fill(1);
    }
    model = next;
    const source = gridLayer.getSource();
    source?.clear(true);
    source?.addFeatures(buildGridFeatures(next));
    invalidateSky(cache);
  }

  /** M2's star and body pass, when needsSkyRecompute says so (≥ 2 s of sim time, or a new site or limit). */
  function skyPass(simTimeMs: number, m: CameraModel, state: AppState): void {
    const site = selectSite(state);
    if (site === null) return;
    if (cache.rows !== seenRows) {
      // The catalogue arrived, or this map is new: setStars or createSkyMap already cleared lastSkyMs.
      seenRows = cache.rows;
      setStarRadii(stars, cache.rows);
      setStarCount(stars, cache.starCount);
      starSkip.fill(1);
    } else if (setStarLimit(cache, selectStarMagLimit(state))) {
      setStarCount(stars, cache.starCount); // setStarLimit cleared lastSkyMs, so the pass below refills the points
      starSkip.fill(1);
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
        starSkip[i] = 0;
      } else {
        // Culled: the frame centre, never off-frame and never NaN (gotcha 20).
        toSkyMapCoord(m, centreU, centreV, flat, 2 * i);
        starSkip[i] = 1;
      }
    }
    starPickCount = count;
    stars.geometry.changed();
    writeBodies(bodies, m, cache.bodies);

    // Cleared at once so the buffer does not grow at 60 entries per second; a PerformanceObserver still sees each.
    performance.measure("overhead:sky", { start: t0 });
    performance.clearMeasures("overhead:sky");
  }

  /**
   * Satellites, trails, the next path and the markers for `frame`. Every write fires a change only when something
   * moved, so a paused sky is not redrawn. `requestPaths` is false outside the frame loop.
   */
  function drawSatellites(
    simTimeMs: number,
    m: CameraModel,
    frame: SatFrame,
    state: AppState,
    requestPaths: boolean,
  ): void {
    const catalog = ephemeris.catalog;
    const satellitesOn = sats.satellitesLayer.getVisible();
    const starlinkOn = sats.starlinkLayer.getVisible();
    const selectedIndex = selectedId === null ? null : indexOfObjectId(selectedId);
    const hoverIndex = hoverId === null ? null : indexOfObjectId(hoverId);
    const issIndex = catalog.indexByNorad.get(ISS_NORAD_ID) ?? null;
    ids.iss = issIndex;
    ids.selected = selectedIndex;
    ids.hovered = hoverIndex;
    writeSkySatellites(sats, m, frame, catalog, ids, satellitesOn, starlinkOn);

    // Trails and the selected satellite's next 2 minutes, from worker sky paths (step 13.5).
    const trailsOn = sats.trailsLayer.getVisible() && reducedMotion?.matches !== true;
    const count = frame.ready
      ? trackedSkyIndices(
          sats,
          catalog,
          selectedIndex,
          trailsOn,
          satellitesOn,
          tracked,
          MAX_TRACKED,
        )
      : 0;
    if (requestPaths && frame.ready) {
      const slot = Math.floor(simTimeMs / SKY_PATH_STEP_MS);
      if (pathGate.offer(performance.now(), slot, selectedIndex ?? -1, tracked, count)) {
        const twoSteps = 2 * selectSampleStepMs(state);
        requestSkyPaths(
          simTimeMs - TRAIL_MS - twoSteps,
          simTimeMs + NEXT_PATH_MS + twoSteps,
          tracked.slice(0, count),
        );
      }
    }
    const paths = ephemeris.skyPaths;
    writeTrails(trailWriter, sats, m, paths, tracked, trailsOn ? count : 0, simTimeMs);
    writeNextPath(pathWriter, sats, m, paths, frame.ready ? selectedIndex : null, simTimeMs);

    targets.selectedId = selectedId;
    targets.hoverId = hoverId;
    targets.selectedIndex = selectedIndex;
    targets.hoverIndex = hoverIndex;
    targets.issIndex = issIndex;
    writeSkySelection(selection, m, sats, frame, catalog, cache, targets, satellitesOn);
    placeHoverCard();
  }

  /** The hover card follows the hovered object: its own marker, or the selected one when they are the same. */
  function placeHoverCard(): void {
    const slot = selection.hover.visible
      ? selection.hover
      : hoverId !== null && hoverId === selectedId && selection.selected.visible
        ? selection.selected
        : null;
    const c = slot?.point.getFlatCoordinates();
    const x = c?.[0] ?? Number.NaN;
    const y = c?.[1] ?? Number.NaN;
    if (x === hoverX && y === hoverY) return;
    if (Number.isNaN(x) && Number.isNaN(hoverX)) return;
    hoverX = x;
    hoverY = y;
    hoverOverlay.setPosition(slot === null ? undefined : [x, y]);
  }

  function updateFrame(simTimeMs: number): void {
    const state = store.getState();
    const m = model;
    if (m === null) return;
    skyPass(simTimeMs, m, state);
    drawSatellites(simTimeMs, m, updateEphemerisFrame(simTimeMs), state, true);
  }

  function setSelection(nextSelected: ObjectId | null, nextHover: ObjectId | null): void {
    selectedId = nextSelected;
    hoverId = nextHover;
    const m = model;
    if (m === null) return;
    // At once, from the frame already computed: OpenLayers then draws the markers in the next frame, paused or not.
    const state = store.getState();
    drawSatellites(state.clock.simTimeMs, m, ephemeris.frame, state, false);
  }

  /** The nearest satellite, body or star within PICK_RADIUS_PX of the pixel, among those drawn; null for none. */
  function pick(pixel: Pixel): ObjectId | null {
    const coordinate = map.getCoordinateFromPixel(pixel);
    const resolution = map.getView().getResolution();
    if (coordinate === null || coordinate === undefined || resolution === undefined) return null;
    const x = coordinate[0] ?? Number.NaN;
    const y = coordinate[1] ?? Number.NaN;
    const radius = PICK_RADIUS_PX * resolution;
    let best: ObjectId | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    const consider = (id: ObjectId, cx: number, cy: number): void => {
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      if (d2 <= radius * radius && d2 < bestD2) {
        best = id;
        bestD2 = d2;
      }
    };
    const s = pickNearest(x, y, sats.xy, sats.skip, sats.count, radius, 0);
    if (s >= 0)
      consider(
        `sat:${ephemeris.catalog.noradIds[s] ?? 0}`,
        sats.xy[2 * s] ?? 0,
        sats.xy[2 * s + 1] ?? 0,
      );
    if (bodies.layer.getVisible()) {
      for (let i = 0; i < BODY_IDS.length; i++) {
        const id = BODY_IDS[i];
        const c = bodies.points[i]?.getFlatCoordinates();
        if (id === undefined || c === undefined || bodies.visible[i] !== 1) continue;
        consider(id, c[0] ?? Number.NaN, c[1] ?? Number.NaN);
      }
    }
    if (stars.layer.getVisible()) {
      const flat = stars.geometry.getFlatCoordinates();
      const k = pickNearest(x, y, flat, starSkip, starPickCount, radius, 0);
      const hr = k >= 0 ? cache.rows[k]?.[3] : undefined;
      if (hr !== undefined) consider(`star:${hr}`, flat[2 * k] ?? 0, flat[2 * k + 1] ?? 0);
    }
    return best;
  }

  // Listeners on the viewport, which map.dispose() discards: the target element outlives a StrictMode remount.
  const viewport = map.getViewport();
  const setCursor = (pointer: boolean): void => {
    if (viewport !== undefined) viewport.style.cursor = pointer ? "pointer" : "";
  };
  map.on("pointermove", (e) => {
    if (e.dragging) return;
    const id = pick(e.pixel);
    store.getState().actions.hover(id);
    setCursor(id !== null);
  });
  map.on("click", (e) => {
    store.getState().actions.select(pick(e.pixel));
  });
  viewport?.addEventListener("pointerleave", () => {
    setCursor(false);
    store.getState().actions.hover(null);
  });
  // The test hooks' highlight: the selected id while its marker is drawn (M3 step 16.1).
  selection.layer.on("postrender", () => recordHighlight("sky", selection.drawnSelectedId));

  return {
    map,
    gridLayer,
    starsLayer: stars.layer,
    bodiesLayer: bodies.layer,
    setCameraModel,
    updateFrame,
    satellitesLayer: sats.satellitesLayer,
    starlinkLayer: sats.starlinkLayer,
    trailsLayer: sats.trailsLayer,
    selectionLayer: selection.layer,
    hoverElement,
    pick,
    setSelection,
  };
}
