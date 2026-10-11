// src/map/sky/layers/satellites.ts — satellites and trails on the sky view (M3 steps 13.2, 13.3, 13.5, 13.9).
// Canvas VectorLayers, one MultiPoint per group and class, written in place each frame (writeClassPoints). The ISS,
// the selected and the hovered objects are left out of the classes: selection.ts draws them with labels. Marker
// looks are visual design, settled from screenshots; the values here are neutral placeholders. Lit and shadowed differ
// in shape (filled circle, open square), not only in colour (README Accessibility rule 3).
import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import MultiPoint from "ol/geom/MultiPoint";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import RegularShape from "ol/style/RegularShape";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import { apparentAltDeg } from "../../../domain/astro";
import { type CameraModel, projectAzAltDeg, toSkyMapCoord } from "../../../domain/camera";
import { enuToAzAltDeg } from "../../../domain/geo";
import type { SatCatalog, SatFrame } from "../../../state/ephemeris";
import { SKY_PATH_STEP_MS, type SkyPathOut } from "../../../workers/protocol";
import { writeClassPoints } from "../../classPoints";

/** Trails cover the last 30 s of sim time (step 13.3). */
export const TRAIL_MS = 30_000;
/** Six classes: stations, visual and starlink, each lit and shadowed. */
export const CLASS_COUNT = 6;

/** SatFrame flag bits (README section 6, ephemeris.ts). */
const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
/** GP_GROUPS indices. */
const STARLINK_GROUP = 2;

// ---- Class styles (placeholders) ----
const DARK = "#222";
const LIGHT = "#fff";
const SHADOW_FILL = "#999";

/** A sunlit satellite: a filled circle. */
export function litImage(radiusPx: number): CircleStyle {
  return new CircleStyle({
    radius: radiusPx,
    fill: new Fill({ color: DARK }),
    stroke: new Stroke({ color: LIGHT, width: 1 }),
  });
}
/** A satellite in Earth's shadow: a square (a different shape, not only a different colour). */
export function shadowedImage(radiusPx: number): RegularShape {
  return new RegularShape({
    points: 4,
    radius: radiusPx * Math.SQRT2,
    angle: Math.PI / 4,
    fill: new Fill({ color: SHADOW_FILL }),
    stroke: new Stroke({ color: DARK, width: 1 }),
  });
}

export interface SatClass {
  readonly source: VectorSource;
  readonly feature: Feature<MultiPoint>;
  readonly style: Style;
  /** Reused per frame: [x, y] pairs of this class. */
  readonly flat: number[];
}

export interface SkySatellites {
  readonly satellitesLayer: VectorLayer<VectorSource>; // stations and visual
  readonly starlinkLayer: VectorLayer<VectorSource>;
  readonly trailsLayer: VectorLayer<VectorSource>;
  /** stations lit, stations shadowed, visual lit, visual shadowed, starlink lit, starlink shadowed. */
  readonly classes: readonly SatClass[];
  /** The trails layer's one MultiLineString, rewritten in place. */
  readonly trails: MultiLineString;
  /** Catalog indices covered by the arrays below in the last write (0 when the frame was not ready). */
  count: number;
  /** Sky-map coordinate [x, y] per catalog index; meaningful where projected[i] is 1. */
  xy: Float64Array;
  /** 1: valid, not docked, apparent alt > 0 and projectAzAltDeg succeeded in the last write. */
  projected: Uint8Array;
  /** Picking: 0 only for objects drawn (their layer is on, or they are selected). */
  skip: Uint8Array;
}

/** Indices of the objects that selection.ts draws instead of the classes; null for none. */
export interface SkySatelliteIds {
  readonly iss: number | null;
  readonly selected: number | null;
  readonly hovered: number | null;
}

function createClass(source: VectorSource, style: Style): SatClass {
  // One coordinate, not added to its source: writeClassPoints adds it when it has points (never a 0, 0 point).
  const feature = new Feature(new MultiPoint([[0, 0]]));
  feature.setStyle(style);
  return { source, feature, style, flat: [] };
}

const TRAIL_STYLE = new Style({
  stroke: new Stroke({ color: "rgba(34, 34, 34, 0.55)", width: 1.5 }),
});

/** The three layers, empty. Arrays start at `capacity` objects and grow with the catalog. */
export function createSkySatellites(capacity = 256): SkySatellites {
  const satellitesSource = new VectorSource({ useSpatialIndex: false });
  const starlinkSource = new VectorSource({ useSpatialIndex: false });
  const classes = [
    createClass(satellitesSource, new Style({ image: litImage(3.5) })),
    createClass(satellitesSource, new Style({ image: shadowedImage(3.5) })),
    createClass(satellitesSource, new Style({ image: litImage(3) })),
    createClass(satellitesSource, new Style({ image: shadowedImage(3) })),
    createClass(starlinkSource, new Style({ image: litImage(2) })),
    createClass(starlinkSource, new Style({ image: shadowedImage(2) })),
  ];
  // Empty: LineWriter rewrites its flat coordinates and ends in place.
  const trails = new MultiLineString([], "XY", []);
  const trailsFeature = new Feature(trails);
  return {
    satellitesLayer: new VectorLayer({ source: satellitesSource }),
    starlinkLayer: new VectorLayer({ source: starlinkSource }),
    trailsLayer: new VectorLayer({
      source: new VectorSource({ useSpatialIndex: false, features: [trailsFeature] }),
      style: TRAIL_STYLE,
    }),
    classes,
    trails,
    count: 0,
    xy: new Float64Array(2 * capacity),
    projected: new Uint8Array(capacity),
    skip: new Uint8Array(capacity),
  };
}

/** Reallocates the per-index arrays when the catalog has outgrown them (once per group load, never per frame). */
function ensureCapacity(sats: SkySatellites, n: number): void {
  if (sats.projected.length >= n) return;
  const capacity = Math.max(n, 2 * sats.projected.length);
  sats.xy = new Float64Array(2 * capacity);
  sats.projected = new Uint8Array(capacity);
  sats.skip = new Uint8Array(capacity);
}

const scratchUv = new Float64Array(2);
const scratchAzAlt = new Float64Array(2);
/** Points per class in the current write (writes are synchronous, so one scratch array serves every call). */
const classCounts = new Int32Array(CLASS_COUNT);

/**
 * Projects every object of the frame (valid, not docked, apparent alt > 0, projectAzAltDeg true) into sats.xy and
 * rewrites the class MultiPoints of the layers that are on, leaving out ids.iss, ids.selected and ids.hovered.
 * Fills sats.projected and the picking skip array (pickable: drawn, so on a visible layer, or selected). Fires no
 * change when nothing moved. Allocates nothing unless the catalog grew.
 */
export function writeSkySatellites(
  sats: SkySatellites,
  model: CameraModel,
  frame: SatFrame,
  catalog: SatCatalog,
  ids: SkySatelliteIds,
  satellitesOn: boolean,
  starlinkOn: boolean,
): void {
  const n = frame.ready ? Math.min(catalog.count, frame.flags.length) : 0;
  ensureCapacity(sats, n);
  const counts = classCounts.fill(0);
  const { xy, projected, skip, classes } = sats;
  for (let i = 0; i < n; i++) {
    projected[i] = 0;
    skip[i] = 1;
    const flags = frame.flags[i] ?? 0;
    if ((flags & FLAG_VALID) === 0 || (catalog.dockedWith[i] ?? -1) !== -1) continue;
    const alt = frame.azAltDeg[2 * i + 1] ?? Number.NaN;
    if (!(alt > 0)) continue; // apparent; the geometric horizon until M6
    if (!projectAzAltDeg(model, frame.azAltDeg[2 * i] ?? Number.NaN, alt, scratchUv, 0)) continue;
    toSkyMapCoord(model, scratchUv[0] ?? 0, scratchUv[1] ?? 0, xy, 2 * i);
    projected[i] = 1;
    const group = catalog.groupIndex[i] ?? 0;
    const layerOn = group === STARLINK_GROUP ? starlinkOn : satellitesOn;
    if (layerOn || i === ids.selected) skip[i] = 0;
    if (!layerOn || i === ids.iss || i === ids.selected || i === ids.hovered) continue;
    const c = 2 * Math.min(group, STARLINK_GROUP) + ((flags & FLAG_SUNLIT) !== 0 ? 0 : 1);
    const cls = classes[c];
    if (cls === undefined) continue;
    const k = 2 * (counts[c] ?? 0);
    cls.flat[k] = xy[2 * i] ?? 0;
    cls.flat[k + 1] = xy[2 * i + 1] ?? 0;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  sats.count = n;
  for (let c = 0; c < classes.length; c++) {
    const cls = classes[c];
    if (cls !== undefined) writeClassPoints(cls.source, cls.feature, cls.flat, counts[c] ?? 0);
  }
}

/**
 * The satellites whose sky paths are requested: the selected satellite first (whatever it is), then, while trails
 * are on, every drawn stations/visual satellite, in catalog order, up to `cap`. Call after writeSkySatellites.
 */
export function trackedSkyIndices(
  sats: SkySatellites,
  catalog: SatCatalog,
  selected: number | null,
  trailsOn: boolean,
  satellitesOn: boolean,
  out: Int32Array,
  cap: number,
): number {
  const max = Math.min(cap, out.length);
  let count = 0;
  if (selected !== null && selected >= 0 && selected < catalog.count && max > 0)
    out[count++] = selected;
  if (!trailsOn || !satellitesOn) return count;
  for (let i = 0; i < sats.count && count < max; i++) {
    if (i === selected || sats.projected[i] !== 1) continue;
    if ((catalog.groupIndex[i] ?? 0) === STARLINK_GROUP) continue;
    out[count++] = i;
  }
  return count;
}

/**
 * Writes polylines into a MultiLineString's own flat-coordinate and ends arrays, in place. A run shorter than two
 * points is dropped. end() truncates the arrays and calls changed() only if anything differs from before.
 */
export class LineWriter {
  private readonly geometry: MultiLineString;
  private cursor = 0;
  private endCount = 0;
  private runLength = 0;
  private pendingX = 0;
  private pendingY = 0;
  private dirty = false;

  constructor(geometry: MultiLineString) {
    this.geometry = geometry;
  }

  begin(): void {
    this.cursor = 0;
    this.endCount = 0;
    this.runLength = 0;
    this.dirty = false;
  }

  point(x: number, y: number): void {
    if (this.runLength === 0) {
      // Held back until a second point arrives, so a dropped one-point run writes nothing.
      this.pendingX = x;
      this.pendingY = y;
      this.runLength = 1;
      return;
    }
    if (this.runLength === 1) this.write(this.pendingX, this.pendingY);
    this.write(x, y);
    this.runLength++;
  }

  breakRun(): void {
    if (this.runLength >= 2) {
      const ends = this.geometry.getEnds();
      if (ends[this.endCount] !== this.cursor) {
        ends[this.endCount] = this.cursor;
        this.dirty = true;
      }
      this.endCount++;
    }
    this.runLength = 0;
  }

  /** Returns true when the geometry changed (and changed() was called). */
  end(): boolean {
    this.breakRun();
    const flat = this.geometry.getFlatCoordinates();
    const ends = this.geometry.getEnds();
    if (flat.length !== this.cursor || ends.length !== this.endCount) this.dirty = true;
    flat.length = this.cursor;
    ends.length = this.endCount;
    if (this.dirty) this.geometry.changed();
    return this.dirty;
  }

  private write(x: number, y: number): void {
    const flat = this.geometry.getFlatCoordinates();
    if (flat[this.cursor] !== x) {
      flat[this.cursor] = x;
      this.dirty = true;
    }
    if (flat[this.cursor + 1] !== y) {
      flat[this.cursor + 1] = y;
      this.dirty = true;
    }
    this.cursor += 2;
  }
}

const scratchXy = new Float64Array(2);

/**
 * Projects point j of a sky path (ENU km) like a satellite: enuToAzAltDeg, apparentAltDeg, projectAzAltDeg. Writes the
 * sky-map coordinate to scratchXy; false when culled or not finite (Refraction throws on a non-finite altitude).
 */
function projectPathPoint(model: CameraModel, path: SkyPathOut, j: number): boolean {
  const o = 3 * j;
  enuToAzAltDeg(
    path.enuKm[o] ?? 0,
    path.enuKm[o + 1] ?? 0,
    path.enuKm[o + 2] ?? 0,
    scratchAzAlt,
    0,
  );
  const geometric = scratchAzAlt[1] ?? Number.NaN;
  if (!Number.isFinite(geometric)) return false;
  const alt = apparentAltDeg(geometric);
  if (!projectAzAltDeg(model, scratchAzAlt[0] ?? Number.NaN, alt, scratchUv, 0)) return false;
  toSkyMapCoord(model, scratchUv[0] ?? 0, scratchUv[1] ?? 0, scratchXy, 0);
  return true;
}

/**
 * Appends to `writer` the points of `path` with fromMs ≤ t < toMs (fromInclusive) or fromMs < t ≤ toMs, split where a
 * point is culled. The caller adds the current position before or after.
 */
export function appendPathPoints(
  writer: LineWriter,
  model: CameraModel,
  path: SkyPathOut,
  fromMs: number,
  toMs: number,
  fromInclusive: boolean,
): void {
  const points = Math.floor(path.enuKm.length / 3);
  for (let j = 0; j < points; j++) {
    const t = path.firstPointMs + j * SKY_PATH_STEP_MS;
    if (fromInclusive ? t < fromMs || t >= toMs : t <= fromMs || t > toMs) continue;
    if (projectPathPoint(model, path, j)) writer.point(scratchXy[0] ?? 0, scratchXy[1] ?? 0);
    else writer.breakRun();
  }
}

/**
 * The trails: for each of the first `count` tracked indices, its path over [timeMs − 30 s, timeMs) ending at its
 * current position (sats.xy), split where culled. Returns true when the geometry changed.
 */
export function writeTrails(
  writer: LineWriter,
  sats: SkySatellites,
  model: CameraModel,
  paths: ReadonlyMap<number, SkyPathOut>,
  tracked: Int32Array,
  count: number,
  timeMs: number,
): boolean {
  writer.begin();
  for (let k = 0; k < count; k++) {
    const i = tracked[k] ?? -1;
    const path = paths.get(i);
    if (path !== undefined) appendPathPoints(writer, model, path, timeMs - TRAIL_MS, timeMs, true);
    if (i >= 0 && i < sats.count && sats.projected[i] === 1) {
      writer.point(sats.xy[2 * i] ?? 0, sats.xy[2 * i + 1] ?? 0);
    }
    writer.breakRun();
  }
  return writer.end();
}

/** The sky text alternative's satellites (step 13.9). */
export interface SkySatelliteList {
  /** Catalog indices, highest apparent altitude first. */
  readonly indices: number[];
  /** Starlink satellites above the horizon that are not in `indices` (0 while Starlink is off). */
  readonly starlinkCount: number;
}

/**
 * Every stations/visual satellite above the horizon (valid, not docked, apparent alt > 0) while the satellites layer
 * is on, plus the selected satellite when it is above the horizon, sorted by apparent altitude, highest first; and the
 * number of other Starlink satellites above the horizon while Starlink is on. null before the first ready frame.
 */
export function skySatelliteList(
  frame: SatFrame,
  catalog: SatCatalog,
  selected: number | null,
  satellitesOn: boolean,
  starlinkOn: boolean,
): SkySatelliteList | null {
  if (!frame.ready) return null;
  const n = Math.min(catalog.count, frame.flags.length);
  const indices: number[] = [];
  let starlinkCount = 0;
  for (let i = 0; i < n; i++) {
    if (((frame.flags[i] ?? 0) & FLAG_VALID) === 0 || (catalog.dockedWith[i] ?? -1) !== -1)
      continue;
    if (!((frame.azAltDeg[2 * i + 1] ?? Number.NaN) > 0)) continue;
    const starlink = (catalog.groupIndex[i] ?? 0) === STARLINK_GROUP;
    if (i === selected || (!starlink && satellitesOn)) indices.push(i);
    else if (starlink && starlinkOn) starlinkCount++;
  }
  const alt = (i: number): number => frame.azAltDeg[2 * i + 1] ?? 0;
  indices.sort((a, b) => alt(b) - alt(a) || a - b);
  return { indices, starlinkCount };
}
