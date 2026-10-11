// src/map/ground/layers/satellites.ts — satellites on the ground map (M3 step 14.1–14.3): two WebGLVector layers of
// class MultiPoints (stations and visual; Starlink), every valid, undocked object on the whole globe, plus a canvas
// markers layer with the labelled ISS, selected and hovered satellites. WebGLVector draws about one frame late and
// freezes while the view moves, so those three are drawn only on the canvas layer (gotcha 11). Picking is ours
// (pick.ts), so the WebGL layers disable hit detection. Looks are visual design; the values here are placeholders,
// with lit and shadowed differing in shape (circle, square).
import Feature from "ol/Feature";
import MultiPoint from "ol/geom/MultiPoint";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import type { Rule } from "ol/style/flat";
import type { SatCatalog, SatFrame } from "../../../state/ephemeris";
import type { ObjectId } from "../../../state/types";
import { writeClassPoints } from "../../classPoints";
import type { SkySatelliteIds } from "../../sky/layers/satellites";
import {
  createMarkerLayer,
  hideMarker,
  type MarkerLayer,
  type MarkerSlot,
  placeMarker,
  type SelectionTargets,
} from "../../sky/layers/selection";

/** SatFrame flag bits (README section 6, ephemeris.ts). */
const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
const STARLINK_GROUP = 2;
/** Points per class in the current write (writes are synchronous, so one scratch array serves every call). */
const classCounts = new Int32Array(6);

/** WebGL flat style: lit (feature property lit = 1) a filled circle, shadowed a square of the same size. */
export function satelliteWebglStyle(radiusPx: number): Rule[] {
  return [
    {
      filter: ["==", ["get", "lit"], 1],
      style: {
        "circle-radius": radiusPx,
        "circle-fill-color": "#222",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
      },
    },
    {
      else: true,
      style: {
        "shape-points": 4,
        "shape-radius": radiusPx * Math.SQRT2,
        "shape-angle": Math.PI / 4,
        "shape-fill-color": "#999",
        "shape-stroke-color": "#222",
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
  readonly starlinkLayer: WebGLVectorLayer<VectorSource>;
  readonly markers: MarkerLayer; // canvas, updateWhileAnimating and updateWhileInteracting
  /** stations lit, stations shadowed, visual lit, visual shadowed, starlink lit, starlink shadowed. */
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
  const starlinkSource = new VectorSource({ useSpatialIndex: false });
  return {
    satellitesLayer: new WebGLVectorLayer({
      source: satellitesSource,
      style: satelliteWebglStyle(3.5),
      disableHitDetection: true,
    }),
    starlinkLayer: new WebGLVectorLayer({
      source: starlinkSource,
      style: satelliteWebglStyle(2),
      disableHitDetection: true,
    }),
    markers: createMarkerLayer(true),
    classes: [
      createClass(satellitesSource, true),
      createClass(satellitesSource, false),
      createClass(satellitesSource, true),
      createClass(satellitesSource, false),
      createClass(starlinkSource, true),
      createClass(starlinkSource, false),
    ],
    count: 0,
    skip: new Uint8Array(capacity),
    drawnSelectedId: null,
  };
}

/**
 * Rewrites the class MultiPoints of the visible layers from frame.mercator: every valid, undocked object except
 * ids.iss, ids.selected and ids.hovered. Fills the picking skip array. Fires no change when nothing moved. Allocates
 * nothing unless the catalog grew.
 */
export function writeGroundSatellites(
  g: GroundSatellites,
  frame: SatFrame,
  catalog: SatCatalog,
  ids: SkySatelliteIds,
  satellitesOn: boolean,
  starlinkOn: boolean,
): void {
  const n = frame.ready
    ? Math.min(catalog.count, frame.flags.length, frame.mercator.length >> 1)
    : 0;
  if (g.skip.length < n) g.skip = new Uint8Array(Math.max(n, 2 * g.skip.length));
  const { skip, classes } = g;
  const counts = classCounts.fill(0);
  for (let i = 0; i < n; i++) {
    skip[i] = 1;
    const flags = frame.flags[i] ?? 0;
    if ((flags & FLAG_VALID) === 0 || (catalog.dockedWith[i] ?? -1) !== -1) continue;
    const group = catalog.groupIndex[i] ?? 0;
    const layerOn = group === STARLINK_GROUP ? starlinkOn : satellitesOn;
    if (layerOn || i === ids.selected) skip[i] = 0;
    if (!layerOn || i === ids.iss || i === ids.selected || i === ids.hovered) continue;
    const c = 2 * Math.min(group, STARLINK_GROUP) + ((flags & FLAG_SUNLIT) !== 0 ? 0 : 1);
    const cls = classes[c];
    if (cls === undefined) continue;
    const k = 2 * (counts[c] ?? 0);
    cls.flat[k] = frame.mercator[2 * i] ?? 0;
    cls.flat[k + 1] = frame.mercator[2 * i + 1] ?? 0;
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
  return placeMarker(slot, x, y, shape, catalog.names[index] ?? "");
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
