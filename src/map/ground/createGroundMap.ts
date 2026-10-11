// src/map/ground/createGroundMap.ts — the ground map: layers, bindings and registration (M1 step 13; satellites,
// tracks, markers, picking and follow in M3 step 14). A new map on every call: GroundView's effect may run mount,
// cleanup, mount under StrictMode.

import { defaults as defaultControls } from "ol/control/defaults";
import type { Coordinate } from "ol/coordinate";
import type BaseLayer from "ol/layer/Base";
import OlMap from "ol/Map";
import View from "ol/View";
import { recordHighlight } from "../../app/testHooks";
import { ISS_NORAD_ID } from "../../domain/orbits";
import { registerFrameUpdater } from "../../state/clockLoop";
import {
  ephemeris,
  indexOfObjectId,
  type SatFrame,
  updateEphemerisFrame,
} from "../../state/ephemeris";
import { selectTrueColorDate } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { ObjectId } from "../../state/types";
import { PICK_RADIUS_PX, pickNearest, WORLD_WIDTH_M } from "../pick";
import { registerMap } from "../registry";
import type { SkySatelliteIds } from "../sky/layers/satellites";
import type { SelectionTargets } from "../sky/layers/selection";
import { bindFollow } from "../sync/bindFollow";
import { bindTrueColorDate } from "../sync/bindGibs";
import { bindLayerVisible } from "../sync/bindLayers";
import { bindSelection } from "../sync/bindSelection";
import { bindSite } from "../sync/bindSite";
import { bindTracks } from "../sync/bindTracks";
import { createOverlayLayers, createTrueColorLayer, type GibsCapabilities } from "./layers/gibs";
import {
  createGroundSatellites,
  writeGroundMarkers,
  writeGroundSatellites,
} from "./layers/satellites";
import { createSiteLayer } from "./layers/site";
import { createTracksLayer } from "./layers/tracks";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Builds the map in `target` and returns its cleanup (registerMap). caps null: no GIBS layers. Layer order, bottom to
 * top: GIBS, site, tracks (canvas), satellites and starlink (WebGLVector), markers (canvas).
 */
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
  const tracks = createTracksLayer();
  // WebGL layers are disposed by registerMap's cleanup with every other layer (README Map lifecycle).
  const sats = createGroundSatellites();
  layers.push(
    site.layer,
    tracks.layer,
    sats.satellitesLayer,
    sats.starlinkLayer,
    sats.markers.layer,
  );

  // Credits.tsx is the only credit display.
  const map = new OlMap({
    target,
    layers,
    view,
    controls: defaultControls({ attribution: false }),
  });

  let selectedId: ObjectId | null = null;
  let hoverId: ObjectId | null = null;
  // Reused every frame: the hot path allocates nothing (README section 9, rule 1).
  const ids: Mutable<SkySatelliteIds> = { iss: null, selected: null, hovered: null };
  const targets: Mutable<SelectionTargets> = {
    selectedId: null,
    hoverId: null,
    selectedIndex: null,
    hoverIndex: null,
    issIndex: null,
  };

  /** Class points and markers for `frame`; each write fires a change only when something moved. */
  function draw(frame: SatFrame): void {
    const catalog = ephemeris.catalog;
    const satellitesOn = sats.satellitesLayer.getVisible();
    const selectedIndex = selectedId === null ? null : indexOfObjectId(selectedId);
    const hoverIndex = hoverId === null ? null : indexOfObjectId(hoverId);
    const issIndex = catalog.indexByNorad.get(ISS_NORAD_ID) ?? null;
    ids.iss = issIndex;
    ids.selected = selectedIndex;
    ids.hovered = hoverIndex;
    writeGroundSatellites(sats, frame, catalog, ids, satellitesOn, sats.starlinkLayer.getVisible());
    targets.selectedId = selectedId;
    targets.hoverId = hoverId;
    targets.selectedIndex = selectedIndex;
    targets.hoverIndex = hoverIndex;
    targets.issIndex = issIndex;
    writeGroundMarkers(sats, frame, catalog, targets, satellitesOn);
  }

  /** The nearest drawn satellite within PICK_RADIUS_PX; view coordinates are not wrapped, so dx wraps. */
  function pickGround(coordinate: Coordinate): ObjectId | null {
    const resolution = view.getResolution();
    if (resolution === undefined || !ephemeris.frame.ready) return null;
    const i = pickNearest(
      coordinate[0] ?? Number.NaN,
      coordinate[1] ?? Number.NaN,
      ephemeris.frame.mercator,
      sats.skip,
      sats.count,
      PICK_RADIUS_PX * resolution,
      WORLD_WIDTH_M,
    );
    return i < 0 ? null : `sat:${ephemeris.catalog.noradIds[i] ?? 0}`;
  }

  // Listeners on the viewport, which map.dispose() discards: the target element outlives a StrictMode remount.
  const viewport = map.getViewport();
  const setCursor = (pointer: boolean): void => {
    if (viewport !== undefined) viewport.style.cursor = pointer ? "pointer" : "";
  };
  map.on("pointermove", (e) => {
    if (e.dragging) return;
    const id = pickGround(e.coordinate);
    store.getState().actions.hover(id);
    setCursor(id !== null);
  });
  // singleclick, not click: a double-click zooms and must not deselect.
  map.on("singleclick", (e) => {
    store.getState().actions.select(pickGround(e.coordinate));
  });
  viewport?.addEventListener("pointerleave", () => {
    setCursor(false);
    store.getState().actions.hover(null);
  });
  // The test hooks' highlight: the selected id while its marker is drawn (M3 step 16.1).
  sats.markers.layer.on("postrender", () => recordHighlight("ground", sats.drawnSelectedId));

  disposers.push(
    bindSite(store, site.feature, view),
    bindLayerVisible(store, "satellites", sats.satellitesLayer),
    bindLayerVisible(store, "starlink", sats.starlinkLayer),
    bindSelection(store, (nextSelected, nextHover) => {
      selectedId = nextSelected;
      hoverId = nextHover;
      // At once, from the frame already computed: OpenLayers draws the markers in the next frame, paused or not.
      draw(ephemeris.frame);
    }),
    bindTracks(store, tracks),
    bindFollow(store, map),
    registerFrameUpdater((simTimeMs) => draw(updateEphemerisFrame(simTimeMs))),
  );
  return registerMap("ground", map, disposers);
}
