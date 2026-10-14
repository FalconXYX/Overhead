// src/map/ground/layers/satellites.ts — satellites on the ground map (M3 step 14.1–14.3): WebGLVector layers of
// class MultiPoints (stations and visual; Starlink), every valid, undocked object on the whole globe, plus a canvas
// markers layer with the labelled ISS, selected and hovered satellites. WebGLVector draws about one frame late and
// freezes while the view moves, so those three are drawn only on the canvas layer (gotcha 11). Picking is ours
// (pick.ts), so the WebGL layers disable hit detection. [Redesign] Colour-coded as on the video (kindColors.ts):
// satellites cyan, Starlink violet, the ISS orange; lit and shadowed differ in shape (circle, square).
import Feature from "ol/Feature";
import MultiPoint from "ol/geom/MultiPoint";
import LayerGroup from "ol/layer/Group";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import type { Rule } from "ol/style/flat";
import type { SatCatalog, SatFrame } from "../../../state/ephemeris";
import type { ObjectId } from "../../../state/types";
import { writeClassPoints } from "../../classPoints";
import {
  INK,
  KIND_COLOR,
  KIND_SHADOW_FILL,
  type SatelliteKind,
  satelliteKind,
} from "../../kindColors";
import { WORLD_WIDTH_M } from "../../pick";
import type { SkySatelliteIds } from "../../sky/layers/satellites";
import {
  createMarkerLayer,
  hideMarker,
  type MarkerLayer,
  type MarkerSlot,
  placeMarker,
  type SelectionTargets,
  satelliteLabel,
} from "../../sky/layers/selection";

/** SatFrame flag bits (README section 6, ephemeris.ts). */
const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
const STARLINK_GROUP = 2;
const HALF_WORLD_M = WORLD_WIDTH_M / 2;
/** [M9] The first Starlink class: even rows lit, even shadowed, odd lit, odd shadowed. */
const STARLINK_CLASS = 4;
/** Points per class in the current write (writes are synchronous, so one scratch array serves every call). */
const classCounts = new Int32Array(8);

/**
 * WebGL flat style: lit (feature property lit = 1) a filled circle in the kind's colour with a dark rim, shadowed a
 * dark square of the same size with an edge in the kind's colour.
 */
export function satelliteWebglStyle(
  radiusPx: number,
  kind: Exclude<SatelliteKind, "iss"> = "satellite",
): Rule[] {
  return [
    {
      filter: ["==", ["get", "lit"], 1],
      style: {
        "circle-radius": radiusPx,
        "circle-fill-color": KIND_COLOR[kind],
        "circle-stroke-color": INK,
        "circle-stroke-width": 1,
      },
    },
    {
      else: true,
      style: {
        "shape-points": 4,
        "shape-radius": radiusPx * Math.SQRT2,
        "shape-angle": Math.PI / 4,
        "shape-fill-color": KIND_SHADOW_FILL[kind],
        "shape-stroke-color": KIND_COLOR[kind],
        "shape-stroke-width": 1,
      },
    },
  ];
}

export interface GroundClass {
  readonly source: VectorSource;
  readonly feature: Feature<MultiPoint>;
  readonly flat: number[];
}

export interface GroundSatellites {
  readonly satellitesLayer: WebGLVectorLayer<VectorSource>; // stations and visual
  /**
   * [M9] Starlink: two WebGLVector layers, even and odd catalogue rows. ephemeris.ts updates one parity per frame
   * while playing (M9 step 4), so only that layer's points change and only its buffers are rebuilt: OpenLayers
   * regenerates a WebGL layer's whole batch whenever any of its features changes.
   */
  readonly starlinkLayer: LayerGroup;
  readonly markers: MarkerLayer; // canvas, updateWhileAnimating and updateWhileInteracting
  /**
   * stations lit, stations shadowed, visual lit, visual shadowed; [M9] starlink even rows lit and shadowed, then odd
   * rows lit and shadowed.
   */
  readonly classes: readonly GroundClass[];
  /** Catalog indices covered by `skip` in the last write (0 when the frame was not ready). */
  count: number;
  /** Picking over ephemeris.frame.mercator: 0 only for objects drawn (their layer is on, or they are selected). */
  skip: Uint8Array;
  /** The selected id while its marker is drawn, else null: what the markers' postrender reports to the test hooks. */
  drawnSelectedId: ObjectId | null;
}

function createClass(source: VectorSource, lit: boolean): GroundClass {
  // One coordinate, not added to its source: a MultiPoint created empty never draws on WebGLVector, and
  // writeClassPoints adds the feature with its first points, so nothing is drawn at 0, 0 (gotcha 10).
  const feature = new Feature(new MultiPoint([[0, 0]]));
  feature.set("lit", lit ? 1 : 0);
  return { source, feature, flat: [] };
}

/** The three layers, empty. `skip` starts at `capacity` objects and grows with the catalog. */
export function createGroundSatellites(capacity = 256): GroundSatellites {
  const satellitesSource = new VectorSource({ useSpatialIndex: false });
  const starlinkEvenSource = new VectorSource({ useSpatialIndex: false });
  const starlinkOddSource = new VectorSource({ useSpatialIndex: false });
  const starlinkLayer = (source: VectorSource) =>
    new WebGLVectorLayer({
      source,
      style: satelliteWebglStyle(2, "starlink"),
      disableHitDetection: true,
    });
  return {
    satellitesLayer: new WebGLVectorLayer({
      source: satellitesSource,
      style: satelliteWebglStyle(3.5),
      disableHitDetection: true,
    }),
    starlinkLayer: new LayerGroup({
      layers: [starlinkLayer(starlinkEvenSource), starlinkLayer(starlinkOddSource)],
    }),
    markers: createMarkerLayer(true),
    classes: [
      createClass(satellitesSource, true),
      createClass(satellitesSource, false),
      createClass(satellitesSource, true),
      createClass(satellitesSource, false),
      createClass(starlinkEvenSource, true),
      createClass(starlinkEvenSource, false),
      createClass(starlinkOddSource, true),
      createClass(starlinkOddSource, false),
    ],
    count: 0,
    skip: new Uint8Array(capacity),
    drawnSelectedId: null,
  };
}

/**
 * [M9] The part of the map worth drawing: points within halfSizeM of centre in x (wrapped around the world) and in y.
 * The ground map passes its view's bounding circle plus a margin; null draws the whole globe.
 */
export interface GroundDrawWindow {
  centerX: number;
  centerY: number;
  halfSizeM: number;
}

/**
 * Rewrites the class MultiPoints of the visible layers from frame.mercator: every valid, undocked object except
 * ids.iss, ids.selected and ids.hovered. Fills the picking skip array. Fires no change when nothing moved. Allocates
 * nothing unless the catalog grew. [M9] With an area, Starlink points outside it are left out of the class points:
 * OpenLayers rebuilds a WebGL layer's buffers for every point it holds, and at the default zoom almost every Starlink
 * is off screen (step 4). The picking skip array does not depend on the window.
 */
export function writeGroundSatellites(
  g: GroundSatellites,
  frame: SatFrame,
  catalog: SatCatalog,
  ids: SkySatelliteIds,
  satellitesOn: boolean,
  starlinkOn: boolean,
  area: GroundDrawWindow | null = null,
): void {
  const n = frame.ready
    ? Math.min(catalog.count, frame.flags.length, frame.mercator.length >> 1)
    : 0;
  if (g.skip.length < n) g.skip = new Uint8Array(Math.max(n, 2 * g.skip.length));
  const { skip, classes } = g;
  const counts = classCounts.fill(0);
  // [M9] No culling when the window spans the world in x.
  const cull = area !== null && 2 * area.halfSizeM < WORLD_WIDTH_M;
  const cx = area?.centerX ?? 0;
  const cy = area?.centerY ?? 0;
  const half = area?.halfSizeM ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    skip[i] = 1;
    const flags = frame.flags[i] ?? 0;
    if ((flags & FLAG_VALID) === 0 || (catalog.dockedWith[i] ?? -1) !== -1) continue;
    const group = catalog.groupIndex[i] ?? 0;
    const layerOn = group === STARLINK_GROUP ? starlinkOn : satellitesOn;
    if (layerOn || i === ids.selected) skip[i] = 0;
    if (!layerOn || i === ids.iss || i === ids.selected || i === ids.hovered) continue;
    const shade = (flags & FLAG_SUNLIT) !== 0 ? 0 : 1;
    const x = frame.mercator[2 * i] ?? 0;
    const y = frame.mercator[2 * i + 1] ?? 0;
    if (cull && group >= STARLINK_GROUP) {
      if (y - cy > half || cy - y > half) continue;
      let dx = x - cx;
      if (dx > HALF_WORLD_M || dx < -HALF_WORLD_M)
        dx -= WORLD_WIDTH_M * Math.round(dx / WORLD_WIDTH_M);
      if (dx > half || dx < -half) continue;
    }
    // [M9] Starlink by row parity, as ephemeris.ts interleaves its ground updates.
    const c = group >= STARLINK_GROUP ? STARLINK_CLASS + 2 * (i & 1) + shade : 2 * group + shade;
    const cls = classes[c];
    if (cls === undefined) continue;
    const k = 2 * (counts[c] ?? 0);
    cls.flat[k] = x;
    cls.flat[k + 1] = y;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  g.count = n;
  for (let c = 0; c < classes.length; c++) {
    const cls = classes[c];
    if (cls !== undefined) writeClassPoints(cls.source, cls.feature, cls.flat, counts[c] ?? 0);
  }
}

/** Places `slot` on satellite `index` at its EPSG:3857 position, or hides it (no position this frame). */
function placeGroundSatellite(
  slot: MarkerSlot,
  index: number | null,
  frame: SatFrame,
  catalog: SatCatalog,
): boolean {
  if (index === null || index < 0 || !frame.ready) return hideMarker(slot);
  const flags = frame.flags[index] ?? 0;
  if ((flags & FLAG_VALID) === 0) return hideMarker(slot);
  const x = frame.mercator[2 * index] ?? Number.NaN;
  const y = frame.mercator[2 * index + 1] ?? Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return hideMarker(slot); // never NaN into a geometry
  const shape = (flags & FLAG_SUNLIT) !== 0 ? "lit" : "shadowed";
  const kind = satelliteKind(catalog.noradIds[index], catalog.groupIndex[index]);
  return placeMarker(slot, x, y, shape, satelliteLabel(catalog.names[index] ?? ""), kind);
}

/** Stars and bodies have no ground position: only a `sat:` id gets a marker. */
function placeGroundObject(
  slot: MarkerSlot,
  id: ObjectId | null,
  index: number | null,
  frame: SatFrame,
  catalog: SatCatalog,
): boolean {
  if (id === null || !id.startsWith("sat:")) return hideMarker(slot);
  return placeGroundSatellite(slot, index, frame, catalog);
}

/**
 * Positions the three canvas markers: the selected satellite, the hovered one (unless it is the selected one) and the
 * ISS (while the satellites layer is on, when it is neither). Stars and bodies have no ground marker. Returns true
 * when anything changed.
 */
export function writeGroundMarkers(
  g: GroundSatellites,
  frame: SatFrame,
  catalog: SatCatalog,
  targets: SelectionTargets,
  satellitesOn: boolean,
): boolean {
  const { selectedId, hoverId, selectedIndex, hoverIndex, issIndex } = targets;
  const m = g.markers;
  let changed = placeGroundObject(m.selected, selectedId, selectedIndex, frame, catalog);
  const hover = hoverId === selectedId ? null : hoverId;
  changed = placeGroundObject(m.hover, hover, hoverIndex, frame, catalog) || changed;
  const showIss =
    satellitesOn &&
    issIndex !== null &&
    issIndex !== selectedIndex &&
    (hover === null || issIndex !== hoverIndex);
  changed =
    (showIss ? placeGroundSatellite(m.iss, issIndex, frame, catalog) : hideMarker(m.iss)) ||
    changed;
  g.drawnSelectedId = m.selected.visible ? selectedId : null;
  return changed;
}
