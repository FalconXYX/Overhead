// src/map/sky/createSkyMap.ts — the sky view: a pixel projection of the camera frame, its layers and the per-frame
// pass (M2 step 8; satellites, trails, selection, picking and the hover-card anchor in M3 step 13; the still-image
// background, pan and zoom for image cameras, calibration clicks and the pending point in M4 steps 10, 11 and 14).
// A new map on every call: SkyView's effect may run mount, cleanup, mount under StrictMode.

import type { EventsKey } from "ol/events";
import { getCenter } from "ol/extent";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import type Interaction from "ol/interaction/Interaction";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import OlMap from "ol/Map";
import { unByKey } from "ol/Observable";
import Overlay from "ol/Overlay";
import type { Pixel } from "ol/pixel";
import Projection from "ol/proj/Projection";
import type { Size } from "ol/size";
import type ImageSource from "ol/source/Image";
import VectorSource from "ol/source/Vector";
import View from "ol/View";
import { recordHighlight } from "../../app/testHooks";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../../domain/astro";
import { type CameraModel, projectBatch, toSkyMapCoord } from "../../domain/camera";
import { ISS_NORAD_ID } from "../../domain/orbits";
import {
  drawableExposureArc,
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
  selectSkyOverVideo,
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
import type { AppState, CalibrationUiState, CameraKind, ObjectId } from "../../state/types";
import { friendlyName } from "../../ui/friendly";
import { SKY_PATH_STEP_MS } from "../../workers/protocol";
import { viewExtentOf } from "../labelEdge";
import { PICK_RADIUS_PX, pickNearest } from "../pick";
import { MAX_TRACKED, RequestGate } from "../sync/bindTracks";
import { applyPairClick, calibrationClickAt, satelliteCheckClickAt } from "./calibrationClick";
import { bodyLabel, createBodiesLayer, writeBodies } from "./layers/bodies";
import { buildGridFeatures, createGridLayer } from "./layers/grid";
import { createHitTargets, type HitTargetVisit } from "./layers/hitTargets";
import { createHorizonLayer, writeSkyline } from "./layers/horizon";
import {
  createSkySatellites,
  LineWriter,
  type SkySatelliteIds,
  TRAIL_MS,
  trackedSkyIndices,
  writeSkyArcs,
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

/**
 * [Redesign] A satellite's hit-target name: its friendly name ("Spent rocket stage (CZ-2C)"), never "CZ-2C R/B"
 * (redesign spec section 3); cached per catalogue name, so the frame loop allocates nothing once seen.
 */
const hitNames = new Map<string, string>();
function satelliteHitName(catalogName: string): string {
  let name = hitNames.get(catalogName);
  if (name === undefined) {
    name = friendlyName(catalogName);
    hitNames.set(catalogName, name);
  }
  return name;
}

/** [M9] Visual design (step 12): a cool white that reads on the night-sky stage and on night video. */
const STAR_FILL = "#ffffff"; // [Redesign] stars white (kindColors.ts)
/** The frame until the first setCameraModel when the registry is still loading. */
const DEFAULT_FRAME_PX = 1024;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** GP_GROUPS index of Starlink, which gets no hit targets (README "Sky over video" rule 6). */
const STARLINK_GROUP_INDEX = 2;

/** Accessibility rule 2: no trails while the user asks for reduced motion. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * [M4] The image cameras' zoom-in limit in image px per screen px. OpenLayers snaps it to maxResolution / 2ⁿ, so the
 * limit lands between 4 and 8 screen px per image px (fitted 2.0533 gives 0.1283, M4 step 11.1).
 */
export const PAN_ZOOM_MIN_RESOLUTION = 0.125;

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
  readonly backgroundLayer: ImageLayer<ImageSource>; // [M4] still image (M4) or video frames (M5); no source until then
  setPanZoom(on: boolean): void; // [M4] true for still-image and local-video cameras (cameraPansAndZooms)
  /** [M4] "Fit frame": the whole frame at the fitted resolution for the map's current size (a new view). */
  fitFrame(): void;
  /** [M4] bindPendingPoint's apply: the pending calibration point (u, v) as a marker, or none. */
  setPendingPoint(pendingPx: CalibrationUiState["pendingPx"]): void;
  readonly horizonLayer: VectorLayer<VectorSource>; // [M6] skyline and behind-terrain fill, below selection
  /** [M6] bindSkyHorizon's apply: rebuilds the skyline for the current model; null clears it. */
  setHorizonProfile(profileDeg: Float32Array | null): void;
  /** [M5] true for youtube cameras: pointer-events none on the target and on the HoverCard overlay's container, map picking off, ol/Overlay hit targets on. */
  setPassThrough(on: boolean): void;
}

/** [M4] Still-image and local-video cameras pan and zoom over their image; synthetic and YouTube cameras do not. */
export function cameraPansAndZooms(kind: CameraKind): boolean {
  return kind === "still-image" || kind === "local-video";
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

/**
 * [M4] Image px per screen px that fits the whole W × H frame into `size`, as
 * `view.getResolutionForExtent([0, 0, W, H], size)` gives it; NaN without a non-empty size.
 */
export function fittedSkyResolution(
  widthPx: number,
  heightPx: number,
  size: Size | undefined,
): number {
  const w = size?.[0] ?? 0;
  const h = size?.[1] ?? 0;
  if (!(w > 0 && h > 0)) return Number.NaN;
  return Math.max(widthPx / w, heightPx / h);
}

/**
 * [M4] The image cameras' view (M4 step 11.1), fitted to `size`: `extent` [0, 0, W, H] with `constrainOnlyCenter`, no
 * rotation, `maxResolution` the fitted resolution and `minResolution` 0.125. View limits are fixed at construction,
 * so every refit builds a new view.
 */
export function createPanZoomSkyView(widthPx: number, heightPx: number, size: Size): View {
  const projection = skyPixelProjection(widthPx, heightPx);
  const extent = projection.getExtent();
  const fitted = fittedSkyResolution(widthPx, heightPx, size);
  return new View({
    projection,
    extent,
    constrainOnlyCenter: true,
    enableRotation: false,
    center: getCenter(extent),
    maxResolution: fitted,
    minResolution: Math.min(PAN_ZOOM_MIN_RESOLUTION, fitted),
    resolution: fitted,
  });
}

/** [M4] The view shows the whole frame as a refit left it: the fitted resolution, centred on the frame. */
export function isFittedSkyView(view: View, fittedResolution: number): boolean {
  const resolution = view.getResolution();
  const centre = view.getCenter();
  if (resolution === undefined || centre === undefined) return false;
  const [cx = Number.NaN, cy = Number.NaN] = getCenter(view.getProjection().getExtent());
  return (
    Math.abs(resolution - fittedResolution) <= 1e-9 * fittedResolution &&
    Math.abs((centre[0] ?? Number.NaN) - cx) <= 1e-6 &&
    Math.abs((centre[1] ?? Number.NaN) - cy) <= 1e-6
  );
}

/**
 * No interactions or controls (M4's setPanZoom adds them): the sky view always shows the whole frame. `onResize` runs
 * on every change:size; by default it refits the frame.
 */
export function createSkyOlMap(
  target: HTMLElement,
  widthPx: number,
  heightPx: number,
  onResize: (map: OlMap) => void = fitSkyFrame,
): OlMap {
  const map = new OlMap({
    target,
    controls: [],
    interactions: [],
    view: createSkyView(widthPx, heightPx),
  });
  map.on("change:size", () => onResize(map));
  fitSkyFrame(map);
  return map;
}

/**
 * Builds the map in `target`, bottom to top: background (M4), grid, stars, bodies (M2), trails, satellites, starlink,
 * horizon (M6), selection (M3), the pending calibration point (M4). The caller registers it with registerMap and starts
 * bindSkyCamera, the layer bindings, bindSelection with setSelection, bindBackground, bindPendingPoint with
 * setPendingPoint, and updateFrame (SkyView). Picking: pointermove hovers, leaving the viewport hovers nothing; a
 * click selects (a miss selects null). With pan and zoom on (image cameras) selection waits for `singleclick`, which
 * a double-click zoom does not fire, and with the Calibration panel open on a still image that click places or
 * completes a star pair instead (calibrationClickAt).
 */
export function createSkyMap(target: HTMLElement, store: AppStore, cache: SkyCache): SkyMapHandle {
  // Pan and zoom (M4 step 11), declared before the map: its change:size listener reads them.
  let panZoom = false;
  let fittedResolution: number | null = null; // the pan-zoom view's fitted (max) resolution; null: M2's fixed view
  let interactions: Interaction[] | null = null; // created on the first setPanZoom(true), reused after

  const imageSize = selectActiveCamera(store.getState())?.imageSize;
  const map = createSkyOlMap(
    target,
    imageSize?.widthPx ?? DEFAULT_FRAME_PX,
    imageSize?.heightPx ?? DEFAULT_FRAME_PX,
    () => handleResize(),
  );
  // No source until bindBackground starts a still image (M4) or M5 a video: ImageSource, not ImageStatic, so M5's
  // ImageCanvas fits the same layer.
  const backgroundLayer = new ImageLayer<ImageSource>();
  const gridLayer = createGridLayer();
  const stars = createStarsLayer(STAR_CAPACITY, STAR_FILL);
  const bodies = createBodiesLayer(viewExtentOf(map));
  const sats = createSkySatellites();
  const selection = createSkySelection(viewExtentOf(map)); // [Polish] labels stay inside the video's frame
  // [M6] Rebuilt only by setCameraModel and setHorizonProfile, never per frame.
  const horizonLayer = createHorizonLayer();
  let horizonProfile: Float32Array | null = null;
  // The pending calibration point in OpenLayers' default style (visual design, settled from screenshots).
  const pendingFeature = new Feature<Point>();
  const pendingLayer = new VectorLayer({
    source: new VectorSource({ features: [pendingFeature] }),
  });
  for (const layer of [
    backgroundLayer,
    gridLayer,
    stars.layer,
    bodies.layer,
    sats.trailsLayer,
    sats.satellitesLayer,
    sats.starlinkLayer,
    horizonLayer, // [M6] above every object, so its fill dims what is behind terrain
    selection.layer,
    pendingLayer,
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

  /** The current frame's W × H, from the view's pixel projection. */
  function frameSize(): [widthPx: number, heightPx: number] {
    const extent = map.getView().getProjection().getExtent();
    return [extent[2] ?? DEFAULT_FRAME_PX, extent[3] ?? DEFAULT_FRAME_PX];
  }

  /**
   * A new view for a W × H frame showing the whole frame (setView fires no change:size): the pan-zoom view while pan
   * and zoom are on and the map has a size, else M2's fixed view.
   */
  function installView(widthPx: number, heightPx: number): void {
    const size = map.getSize();
    if (
      panZoom &&
      size !== undefined &&
      Number.isFinite(fittedSkyResolution(widthPx, heightPx, size))
    ) {
      const view = createPanZoomSkyView(widthPx, heightPx, size);
      map.setView(view);
      fittedResolution = view.getMaxResolution();
    } else {
      map.setView(createSkyView(widthPx, heightPx));
      fitSkyFrame(map);
      fittedResolution = null;
    }
  }

  /** M2 refits on every resize; with pan and zoom, only while the view is at its fitted state (M4 step 11.2). */
  function handleResize(): void {
    if (!panZoom) {
      fitSkyFrame(map);
      return;
    }
    if (fittedResolution === null || isFittedSkyView(map.getView(), fittedResolution)) {
      installView(...frameSize());
    }
  }

  function setPanZoom(on: boolean): void {
    if (on === panZoom) return;
    panZoom = on;
    if (on) {
      interactions ??= [
        ...defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }).getArray(),
      ];
      for (const interaction of interactions) map.addInteraction(interaction);
    } else {
      for (const interaction of interactions ?? []) map.removeInteraction(interaction);
    }
    installView(...frameSize());
  }

  function fitFrame(): void {
    installView(...frameSize());
  }

  function setPendingPoint(pendingPx: CalibrationUiState["pendingPx"]): void {
    if (pendingPx === null) {
      pendingFeature.setGeometry(undefined);
      return;
    }
    const [, heightPx] = frameSize();
    pendingFeature.setGeometry(new Point([pendingPx[0], heightPx - pendingPx[1]]));
  }

  function setCameraModel(next: CameraModel): void {
    const [widthPx, heightPx] = frameSize();
    if (widthPx !== next.widthPx || heightPx !== next.heightPx) {
      installView(next.widthPx, next.heightPx);
      // Points of the old frame could fall outside the new one and shift the per-star arrays (gotcha 20): park
      // them at the corner, hidden, until the pass that invalidateSky below forces.
      setStarCount(stars, cache.starCount);
      starSkip.fill(1);
    }
    model = next;
    hitTargets.setCameraModel(next); // [M5]
    const source = gridLayer.getSource();
    source?.clear(true);
    source?.addFeatures(buildGridFeatures(next));
    writeSkyline(horizonLayer, next, horizonProfile);
    invalidateSky(cache);
  }

  /** [M6] The active camera's terrain profile; null clears the skyline (the geometric horizon). */
  function setHorizonProfile(profileDeg: Float32Array | null): void {
    horizonProfile = profileDeg;
    writeSkyline(horizonLayer, model, profileDeg);
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
    // Exposure arcs (M4 step 16): before writeSkySatellites, which then hides the dots (writeTrails the trails).
    writeSkyArcs(sats, m, drawableExposureArc(state), catalog);
    writeSkySatellites(sats, m, frame, catalog, ids, satellitesOn, starlinkOn);

    // Trails and the selected satellite's next 2 minutes, from worker sky paths (step 13.5).
    const trailsOn = sats.trailsLayer.getVisible() && reducedMotion?.matches !== true;
    // [M5] The light set over a video: only the selected object keeps its trail (README "Sky over video" rule 1).
    const otherTrailsOn = trailsOn && !selectSkyOverVideo(state);
    const count = frame.ready
      ? trackedSkyIndices(
          sats,
          catalog,
          selectedIndex,
          otherTrailsOn,
          satellitesOn,
          tracked,
          MAX_TRACKED,
        )
      : 0;
    if (!frame.ready) pathGate.reset(); // [M9] a flush or worker restart cleared the paths: ask again once ready
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
    hitTargets.update(simTimeMs); // [M5] after every layer wrote this frame's positions
  }

  function setSelection(nextSelected: ObjectId | null, nextHover: ObjectId | null): void {
    selectedId = nextSelected;
    hoverId = nextHover;
    const m = model;
    if (m === null) return;
    // At once, from the frame already computed: OpenLayers then draws the markers in the next frame, paused or not.
    const state = store.getState();
    drawSatellites(state.clock.simTimeMs, m, ephemeris.frame, state, false);
    hitTargets.update(state.clock.simTimeMs); // [M5] the selected object's target moves last at once
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

  // [M5] Hit targets over a YouTube player (step 8.3): the objects the layers drew this frame, with pick's
  // predicates. Ids are cached per catalog index and star row, so the frame loop allocates no id strings.
  const satIds: ObjectId[] = [];
  let starIds: ObjectId[] = [];
  let starIdRows: readonly StarRow[] | null = null;
  function drawnObjects(visit: HitTargetVisit): void {
    const catalog = ephemeris.catalog;
    const selected = selectedId;
    // The satellites layer's objects (never Starlink, README "Sky over video" rule 6), as drawn and picked.
    for (let i = 0; i < sats.count; i++) {
      if (sats.skip[i] !== 0 || (catalog.groupIndex[i] ?? 0) === STARLINK_GROUP_INDEX) continue;
      const noradId = catalog.noradIds[i] ?? 0;
      let id = satIds[i];
      if (id === undefined) {
        id = `sat:${noradId}`;
        satIds[i] = id;
      }
      if (id === selected) continue;
      const name = satelliteHitName(catalog.names[i] ?? "");
      visit(id, name, sats.xy[2 * i] ?? Number.NaN, sats.xy[2 * i + 1] ?? Number.NaN);
    }
    if (bodies.layer.getVisible()) {
      for (let i = 0; i < BODY_IDS.length; i++) {
        const id = BODY_IDS[i];
        const c = bodies.points[i]?.getFlatCoordinates();
        if (id === undefined || c === undefined || bodies.visible[i] !== 1 || id === selected)
          continue;
        const name = bodyLabel(id, cache.bodies[i * BODY_STRIDE + 3] ?? Number.NaN);
        visit(id, name, c[0] ?? Number.NaN, c[1] ?? Number.NaN);
      }
    }
    if (stars.layer.getVisible()) {
      if (starIdRows !== cache.rows) {
        starIdRows = cache.rows;
        starIds = [];
      }
      const flat = stars.geometry.getFlatCoordinates();
      for (let k = 0; k < starPickCount; k++) {
        const row = cache.rows[k];
        if (starSkip[k] !== 0 || row === undefined) continue;
        let id = starIds[k];
        if (id === undefined) {
          id = `star:${row[3]}`;
          starIds[k] = id;
        }
        if (id === selected) continue;
        visit(id, row[4] === "" ? `HR ${row[3]}` : row[4], flat[2 * k] ?? 0, flat[2 * k + 1] ?? 0);
      }
    }
    // The selected object last, where its marker is drawn, named by the marker's label ("shape|label").
    const slot = selection.selected;
    if (selected !== null && slot.visible) {
      const c = slot.point.getFlatCoordinates();
      visit(selected, slot.key.slice(slot.key.indexOf("|") + 1), c[0] ?? 0, c[1] ?? 0);
    }
  }
  const hitTargets = createHitTargets(map, store, drawnObjects);

  // Listeners on the viewport, which map.dispose() discards: the target element outlives a StrictMode remount.
  const viewport = map.getViewport();
  const setCursor = (pointer: boolean): void => {
    if (viewport !== undefined) viewport.style.cursor = pointer ? "pointer" : "";
  };
  /** The picking listeners; [M5] attached only while pass-through is off (setPassThrough detaches them). */
  const attachPicking = (): EventsKey[] => [
    map.on("pointermove", (e) => {
      if (e.dragging) return;
      const id = pick(e.pixel);
      store.getState().actions.hover(id);
      setCursor(id !== null);
    }),
    // Without pan and zoom (synthetic cameras, M3) a click selects at once.
    map.on("click", (e) => {
      if (!panZoom) store.getState().actions.select(pick(e.pixel));
    }),
    // With pan and zoom: singleclick, so a double-click zoom neither selects nor places a calibration point.
    map.on("singleclick", (e) => {
      if (!panZoom) return;
      const state = store.getState();
      // [M5] While the Satellite check takes clicks, it gets this one (M5 step 13).
      if (
        satelliteCheckClickAt(state, e.coordinate[0] ?? Number.NaN, e.coordinate[1] ?? Number.NaN)
      )
        return;
      const click = calibrationClickAt(
        state,
        cache.rows,
        e.coordinate[0] ?? Number.NaN,
        e.coordinate[1] ?? Number.NaN,
        map.getView().getResolution() ?? Number.NaN,
      );
      if (click === null) state.actions.select(pick(e.pixel));
      else applyPairClick(state.actions, click);
    }),
  ];
  let pickingKeys = attachPicking();
  viewport?.addEventListener("pointerleave", () => {
    setCursor(false);
    store.getState().actions.hover(null);
  });

  /**
   * [M5] Over a YouTube player (step 8.2): pointer-events none on the target element itself (not .ol-viewport) and on
   * the HoverCard overlay's container (OpenLayers sets auto on every overlay container), map picking detached, hit
   * targets on. Off undoes each.
   */
  let passThrough = false;
  function setPassThrough(on: boolean): void {
    if (on === passThrough) return;
    passThrough = on;
    target.style.pointerEvents = on ? "none" : "";
    const card = hoverElement.parentElement;
    if (card !== null) card.style.pointerEvents = on ? "none" : "auto";
    if (on) {
      unByKey(pickingKeys);
      pickingKeys = [];
      setCursor(false);
    } else {
      pickingKeys = attachPicking();
    }
    hitTargets.setEnabled(on);
  }
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
    backgroundLayer,
    setPanZoom,
    fitFrame,
    setPendingPoint,
    setPassThrough,
    horizonLayer,
    setHorizonProfile,
  };
}
