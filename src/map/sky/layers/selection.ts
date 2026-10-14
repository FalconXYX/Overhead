// src/map/sky/layers/selection.ts — labelled markers for the ISS, the hovered and the selected object, and the selected
// satellite's dotted next 2 minutes (M3 steps 13.4, 13.6). The marker slots are shared with the ground map's markers
// layer. Satellites keep their lit/shadowed shape; selected and hovered differ by their ring (solid or dashed), not
// by colour. [Redesign] Colour-coded (kindColors.ts): each satellite keeps its kind's colour (the ISS orange, Starlink
// violet, others cyan); the selection is an orange ring on a dark casing, hover a light dashed ring; every label on a
// dark halo.
import type { Extent } from "ol/extent";
import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../../../domain/astro";
import { type CameraModel, projectAzAltDeg, toSkyMapCoord } from "../../../domain/camera";
import type { SatCatalog, SatFrame } from "../../../state/ephemeris";
import type { SkyCache } from "../../../state/skyCache";
import type { ObjectId } from "../../../state/types";
import { friendlySatellite } from "../../../ui/friendly";
import type { SkyPathOut } from "../../../workers/protocol";
import {
  HALO,
  INK,
  KIND_COLOR,
  KIND_SHADOW_FILL,
  LABEL_LIGHT,
  type SatelliteKind,
  SELECTION_COLOR,
  satelliteKind,
} from "../../kindColors";
import { edgeTextPlacement, type LabelEdge, labelEdge } from "../../labelEdge";
import { bodyLabel } from "./bodies";
import {
  appendPathPoints,
  type LineWriter,
  litImage,
  type SkySatellites,
  shadowedImage,
} from "./satellites";

/** The selected satellite's path ahead (step 13.4). */
export const NEXT_PATH_MS = 120_000;

export type MarkerRole = "selected" | "hover" | "iss";
/** A satellite's lit state, or "none" for a star or body (which keeps its own marker underneath). */
export type MarkerShape = "lit" | "shadowed" | "none";

export interface MarkerSlot {
  readonly role: MarkerRole;
  readonly feature: Feature<Point>;
  readonly point: Point;
  visible: boolean;
  /** "shape|label" of the current style. */
  key: string;
  style: Style[] | undefined;
  /** [Polish] What the style was built from, for its edge variants (labelEdge.ts). */
  shape: MarkerShape;
  label: string;
  kind: SatelliteKind | undefined;
  /** [Polish] The last edge variant drawn, and the style it was built for: reused while neither changes. */
  edge: LabelEdge;
  edgeFor: Style[] | undefined;
  edgeStyle: Style[] | undefined;
}

export interface MarkerLayer {
  readonly layer: VectorLayer<VectorSource>;
  readonly selected: MarkerSlot;
  readonly hover: MarkerSlot;
  readonly iss: MarkerSlot;
}

const MARKER_RADIUS_PX = 4.5;
const LABEL_FONT = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
const LABEL_FONT_BOLD = `700 13px system-ui, -apple-system, 'Segoe UI', sans-serif`;
/** The label's centre above (or [Polish] below) the marker's, in CSS px. */
const LABEL_OFFSET_PX = 18;
const LABEL_HALO = new Stroke({ color: HALO, width: 3.5 });
/** The ISS's label in its colour, lightened for text on the halo; the others in the light text colour. */
const LABEL_FILLS: Readonly<Record<MarkerRole, Fill>> = {
  selected: new Fill({ color: LABEL_LIGHT }),
  iss: new Fill({ color: "#ffad75" }),
  hover: new Fill({ color: LABEL_LIGHT }),
};

const RINGS: Readonly<Record<MarkerRole, Style[] | null>> = {
  // An orange ring on a dark casing, so the selection reads on a bright frame too.
  selected: [
    new Style({
      image: new CircleStyle({ radius: 11, stroke: new Stroke({ color: INK, width: 5 }) }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 11,
        stroke: new Stroke({ color: SELECTION_COLOR, width: 2.5 }),
      }),
    }),
  ],
  hover: [
    new Style({
      image: new CircleStyle({
        radius: 9,
        stroke: new Stroke({ color: LABEL_LIGHT, width: 1.5, lineDash: [3, 3] }),
      }),
    }),
  ],
  iss: null,
};

const styleCache = new Map<string, Style[]>();

/** [Redesign] Plain short labels ("ISS", "Rocket stage", "Cosmos 1536"), cached per catalogue name. */
const labelCache = new Map<string, string>();

/** A satellite's marker label: its friendly short name (src/ui/friendly.ts), never a raw catalogue name. */
export function satelliteLabel(catalogName: string): string {
  let label = labelCache.get(catalogName);
  if (label === undefined) {
    label = catalogName === "" ? "" : friendlySatellite(catalogName).shortName;
    labelCache.set(catalogName, label);
  }
  return label;
}

/**
 * [rings (selected solid on a casing, hovered dashed), shape + label]. The shape takes the satellite's kind colour (the
 * ISS slot is always the ISS); the label sits above the marker ([Polish] or leans to stay inside the frame: `edge`),
 * and the selected one is bold. Cached per role, shape, kind, label and edge.
 */
export function markerStyle(
  role: MarkerRole,
  shape: MarkerShape,
  label: string,
  kind: SatelliteKind = role === "iss" ? "iss" : "satellite",
  edge: LabelEdge = "",
): Style[] {
  const key = `${role}|${shape}|${kind}|${label}|${edge}`;
  const cached = styleCache.get(key);
  if (cached !== undefined) return cached;
  const image =
    shape === "lit"
      ? litImage(MARKER_RADIUS_PX, KIND_COLOR[kind])
      : shape === "shadowed"
        ? shadowedImage(MARKER_RADIUS_PX, KIND_SHADOW_FILL[kind], KIND_COLOR[kind])
        : undefined;
  const main = new Style({
    image,
    text:
      edge === "x"
        ? undefined
        : new Text({
            text: label,
            font: role === "selected" ? LABEL_FONT_BOLD : LABEL_FONT,
            ...edgeTextPlacement(edge, LABEL_OFFSET_PX),
            fill: LABEL_FILLS[role],
            stroke: LABEL_HALO,
          }),
  });
  const rings = RINGS[role];
  const styles = rings === null ? [main] : [...rings, main];
  styleCache.set(key, styles);
  return styles;
}

function createSlot(role: MarkerRole, slotIndex: number): MarkerSlot {
  const point = new Point([0, 0]);
  const feature = new Feature(point);
  feature.set("slot", slotIndex);
  return {
    role,
    feature,
    point,
    visible: false,
    key: "",
    style: undefined,
    shape: "none",
    label: "",
    kind: undefined,
    edge: "",
    edgeFor: undefined,
    edgeStyle: undefined,
  };
}

/** Places a slot at (x, y) with its shape and label. Fires a change only when something differs; returns true then. */
export function placeMarker(
  slot: MarkerSlot,
  x: number,
  y: number,
  shape: MarkerShape,
  label: string,
  kind?: SatelliteKind,
): boolean {
  let changed = false;
  const c = slot.point.getFlatCoordinates();
  if (c[0] !== x || c[1] !== y) {
    c[0] = x;
    c[1] = y;
    slot.point.changed();
    changed = true;
  }
  const key = `${shape}|${kind ?? ""}|${label}`;
  if (!slot.visible || slot.key !== key) {
    slot.visible = true;
    slot.key = key;
    slot.style = markerStyle(slot.role, shape, label, kind);
    slot.shape = shape;
    slot.label = label;
    slot.kind = kind;
    slot.feature.changed(); // re-evaluates the style function
    changed = true;
  }
  return changed;
}

/** Hides a slot; returns true when it was visible. */
export function hideMarker(slot: MarkerSlot): boolean {
  if (!slot.visible) return false;
  slot.visible = false;
  slot.feature.changed();
  return true;
}

const NEXT_PATH_STYLES = [
  new Style({
    stroke: new Stroke({ color: HALO, width: 4.5, lineDash: [1, 5], lineCap: "round" }),
  }),
  new Style({
    stroke: new Stroke({ color: SELECTION_COLOR, width: 2.5, lineDash: [1, 5], lineCap: "round" }),
  }),
];

/**
 * Three slots (iss, hover, selected, drawn in that order, so the selected marker is on top) in a canvas VectorLayer.
 * `updateWhileMoving` sets updateWhileAnimating and updateWhileInteracting: the ground map needs both, or its
 * markers freeze during a pan or the "Show on map" animation (gotcha 11). `extra` features are drawn underneath.
 * [Polish] With `viewExtent` (the map's view extent, labelEdge.ts viewExtentOf), a label near the frame's edge leans
 * inward so it stays whole; `wrapWidth` is the world's width on a map that wraps (the ground map).
 */
export function createMarkerLayer(
  updateWhileMoving: boolean,
  extra: readonly Feature[] = [],
  viewExtent?: () => Extent | null,
  wrapWidth = 0,
): MarkerLayer {
  const iss = createSlot("iss", 0);
  const hover = createSlot("hover", 1);
  const selected = createSlot("selected", 2);
  const slots = [iss, hover, selected];
  const layer = new VectorLayer({
    source: new VectorSource({
      useSpatialIndex: false,
      features: [...extra, iss.feature, hover.feature, selected.feature],
    }),
    style: (feature, resolution) => {
      if (feature.get("nextPath") === true) return NEXT_PATH_STYLES;
      const i = feature.get("slot");
      const slot = typeof i === "number" ? slots[i] : undefined;
      if (slot?.visible !== true) return undefined;
      const extent = slot.label === "" || viewExtent === undefined ? null : viewExtent();
      if (extent === null) return slot.style;
      const [x = 0, y = 0] = slot.point.getFlatCoordinates();
      const fontPx = slot.role === "selected" ? 13 : 12;
      const edge = labelEdge(
        x,
        y,
        extent,
        resolution,
        slot.label,
        fontPx,
        LABEL_OFFSET_PX,
        wrapWidth,
      );
      if (edge === "") return slot.style;
      if (edge !== slot.edge || slot.edgeFor !== slot.style) {
        slot.edge = edge;
        slot.edgeFor = slot.style;
        slot.edgeStyle = markerStyle(slot.role, slot.shape, slot.label, slot.kind, edge);
      }
      return slot.edgeStyle;
    },
    updateWhileAnimating: updateWhileMoving,
    updateWhileInteracting: updateWhileMoving,
  });
  return { layer, selected, hover, iss };
}

export interface SkySelection extends MarkerLayer {
  /** The selected satellite's next 2 minutes, rewritten in place (LineWriter). */
  readonly nextPath: MultiLineString;
  /** The selected id while its marker is drawn, else null: what the layer's postrender reports to the test hooks. */
  drawnSelectedId: ObjectId | null;
}

/** [Polish] `viewExtent`: the sky map's view extent, so labels stay inside the video's frame. */
export function createSkySelection(viewExtent?: () => Extent | null): SkySelection {
  const nextPath = new MultiLineString([], "XY", []);
  const pathFeature = new Feature(nextPath);
  pathFeature.set("nextPath", true);
  return {
    ...createMarkerLayer(false, [pathFeature], viewExtent),
    nextPath,
    drawnSelectedId: null,
  };
}

/** What the selection layer marks this frame; indices are catalog indices (docked ids already map to their host). */
export interface SelectionTargets {
  readonly selectedId: ObjectId | null;
  readonly hoverId: ObjectId | null;
  readonly selectedIndex: number | null;
  readonly hoverIndex: number | null;
  readonly issIndex: number | null;
}

/** The parts of skyCache the markers read. */
export type SkyPositions = Pick<SkyCache, "rows" | "starCount" | "starAzAltDeg" | "bodies">;

const FLAG_SUNLIT = 2;
const scratchUv = new Float64Array(2);
const scratchXy = new Float64Array(2);

/** HR number → row index, per catalogue array (rows are sorted by vmag). Built once per catalogue. */
const rowByHr = new WeakMap<readonly StarRow[], Map<number, number>>();
function rowIndexOfHr(rows: readonly StarRow[], hr: number): number | undefined {
  let map = rowByHr.get(rows);
  if (map === undefined) {
    map = new Map(rows.map((row, i) => [row[3], i]));
    rowByHr.set(rows, map);
  }
  return map.get(hr);
}

/** Projects an apparent az/alt into scratchXy; false when culled or not computed (NaN). */
function projectToScratch(model: CameraModel, azDeg: number, altDeg: number): boolean {
  if (!projectAzAltDeg(model, azDeg, altDeg, scratchUv, 0)) return false;
  toSkyMapCoord(model, scratchUv[0] ?? 0, scratchUv[1] ?? 0, scratchXy, 0);
  return true;
}

/** Places `slot` on satellite `index` where writeSkySatellites projected it, or hides it. */
function placeSkySatellite(
  slot: MarkerSlot,
  index: number | null,
  sats: SkySatellites,
  frame: SatFrame,
  catalog: SatCatalog,
): boolean {
  if (index === null || index < 0 || index >= sats.count || sats.projected[index] !== 1) {
    return hideMarker(slot);
  }
  const lit = ((frame.flags[index] ?? 0) & FLAG_SUNLIT) !== 0;
  const x = sats.xy[2 * index] ?? 0;
  const y = sats.xy[2 * index + 1] ?? 0;
  const kind = satelliteKind(catalog.noradIds[index], catalog.groupIndex[index]);
  const label = satelliteLabel(catalog.names[index] ?? "");
  return placeMarker(slot, x, y, lit ? "lit" : "shadowed", label, kind);
}

/** Places `slot` on object `id` in the sky, or hides it when the object is not drawn there. */
function placeSkyObject(
  slot: MarkerSlot,
  id: ObjectId | null,
  index: number | null,
  model: CameraModel,
  sats: SkySatellites,
  frame: SatFrame,
  catalog: SatCatalog,
  sky: SkyPositions,
): boolean {
  if (id === null) return hideMarker(slot);
  if (id.startsWith("sat:")) return placeSkySatellite(slot, index, sats, frame, catalog);
  if (id.startsWith("star:")) {
    const hr = Number(id.slice(5));
    const r = rowIndexOfHr(sky.rows, hr);
    const row = r === undefined ? undefined : sky.rows[r];
    // Only the magnitude prefix is rotated each pass.
    if (r === undefined || row === undefined || r >= sky.starCount) return hideMarker(slot);
    const az = sky.starAzAltDeg[2 * r] ?? Number.NaN;
    const alt = sky.starAzAltDeg[2 * r + 1] ?? Number.NaN;
    if (!projectToScratch(model, az, alt)) return hideMarker(slot);
    const label = row[4] === "" ? `HR ${hr}` : row[4];
    return placeMarker(slot, scratchXy[0] ?? 0, scratchXy[1] ?? 0, "none", label);
  }
  const b = (BODY_IDS as readonly string[]).indexOf(id);
  const bodyId = BODY_IDS[b];
  if (bodyId === undefined) return hideMarker(slot);
  const o = b * BODY_STRIDE;
  if (!projectToScratch(model, sky.bodies[o] ?? Number.NaN, sky.bodies[o + 1] ?? Number.NaN)) {
    return hideMarker(slot);
  }
  const label = bodyLabel(bodyId, sky.bodies[o + 3] ?? Number.NaN);
  return placeMarker(slot, scratchXy[0] ?? 0, scratchXy[1] ?? 0, "none", label);
}

/**
 * Positions the three markers for this frame: the selected object, the hovered one (unless it is the selected one) and
 * the ISS (while the satellites layer is on, when it is neither). Call after writeSkySatellites and the sky pass.
 * Returns true when anything changed.
 */
export function writeSkySelection(
  sel: SkySelection,
  model: CameraModel,
  sats: SkySatellites,
  frame: SatFrame,
  catalog: SatCatalog,
  sky: SkyPositions,
  targets: SelectionTargets,
  satellitesOn: boolean,
): boolean {
  const { selectedId, hoverId, selectedIndex, hoverIndex, issIndex } = targets;
  let changed = placeSkyObject(
    sel.selected,
    selectedId,
    selectedIndex,
    model,
    sats,
    frame,
    catalog,
    sky,
  );
  const hover = hoverId === selectedId ? null : hoverId;
  changed =
    placeSkyObject(sel.hover, hover, hoverIndex, model, sats, frame, catalog, sky) || changed;
  const showIss =
    satellitesOn &&
    issIndex !== null &&
    issIndex !== selectedIndex &&
    (hover === null || issIndex !== hoverIndex);
  changed =
    (showIss ? placeSkySatellite(sel.iss, issIndex, sats, frame, catalog) : hideMarker(sel.iss)) ||
    changed;
  sel.drawnSelectedId = sel.selected.visible ? selectedId : null;
  return changed;
}

/**
 * The selected satellite's next 2 minutes: its current position, then the path points in (timeMs, timeMs + 2 min],
 * split where culled. Empty when nothing (or no satellite) is selected. Returns true when the geometry changed.
 */
export function writeNextPath(
  writer: LineWriter,
  sats: SkySatellites,
  model: CameraModel,
  paths: ReadonlyMap<number, SkyPathOut>,
  selectedIndex: number | null,
  timeMs: number,
): boolean {
  writer.begin();
  if (selectedIndex !== null) {
    if (selectedIndex >= 0 && selectedIndex < sats.count && sats.projected[selectedIndex] === 1) {
      writer.point(sats.xy[2 * selectedIndex] ?? 0, sats.xy[2 * selectedIndex + 1] ?? 0);
    }
    const path = paths.get(selectedIndex);
    if (path !== undefined)
      appendPathPoints(writer, model, path, timeMs, timeMs + NEXT_PATH_MS, false);
  }
  return writer.end();
}
