// src/map/sky/layers/satellites.ts — satellites and trails on the sky view (M3 steps 13.2, 13.3, 13.5, 13.9), and a
// still image's exposure arcs (M4 step 16). Canvas VectorLayers, one MultiPoint per group and class, written in place
// each frame (writeClassPoints). The ISS, the selected and the hovered objects are left out of the classes:
// selection.ts draws them with labels. [Redesign] Colour-coded (src/map/kindColors.ts): satellites cyan, Starlink
// violet, each with a dark rim so it also reads on a bright frame. Lit and shadowed differ in shape (filled circle,
// dark square with a coloured edge), not only in colour (README Accessibility rule 3).
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
import { SAMPLE_STRIDE, SampleField } from "../../../domain/orbits";
import type { ExposureArc, SatCatalog, SatFrame } from "../../../state/ephemeris";
import { SKY_PATH_STEP_MS, type SkyPathOut } from "../../../workers/protocol";
import { writeClassPoints } from "../../classPoints";
import { INK, KIND_COLOR, KIND_SHADOW_FILL } from "../../kindColors";

/** Trails cover the last 30 s of sim time (step 13.3). */
export const TRAIL_MS = 30_000;
/** Six classes: stations, visual and starlink, each lit and shadowed. */
export const CLASS_COUNT = 6;

/** SatFrame flag bits (README section 6, ephemeris.ts). */
const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
/** GP_GROUPS indices. */
const STARLINK_GROUP = 2;

// ---- Class styles ([Redesign] colour-coded, kindColors.ts) ----
/** A sunlit satellite's fill. */
const LIT_FILL = KIND_COLOR.satellite;
/** A shadowed satellite: a dark fill inside its kind's edge, so it reads on a night sky and a bright one. */
const SHADOW_FILL = KIND_SHADOW_FILL.satellite;
const SHADOW_STROKE = KIND_COLOR.satellite;

/** A sunlit satellite: a filled circle with a dark rim. */
export function litImage(radiusPx: number, fill: string = LIT_FILL): CircleStyle {
  return new CircleStyle({
    radius: radiusPx,
    fill: new Fill({ color: fill }),
    stroke: new Stroke({ color: INK, width: radiusPx >= 3 ? 1.5 : 1 }),
  });
}
/** A satellite in Earth's shadow: a square (a different shape, not only a different colour). */
export function shadowedImage(
  radiusPx: number,
  fill: string = SHADOW_FILL,
  stroke: string = SHADOW_STROKE,
): RegularShape {
  return new RegularShape({
    points: 4,
    radius: radiusPx * Math.SQRT2,
    angle: Math.PI / 4,
    fill: new Fill({ color: fill }),
    stroke: new Stroke({ color: stroke, width: 1 }),
  });
}

export interface SatClass {
  readonly source: VectorSource;
  readonly feature: Feature<MultiPoint>;
  readonly style: Style;
  /** Reused per frame: [x, y] pairs of this class. */
  readonly flat: number[];
}

/** One group's exposure arcs (M4 step 16): a MultiLineString in its group's layer source while it has a line. */
export interface SkyArcLine {
  readonly source: VectorSource;
  readonly feature: Feature<MultiLineString>;
  readonly line: MultiLineString;
  readonly writer: LineWriter;
}

export interface SkySatellites {
  readonly satellitesLayer: VectorLayer<VectorSource>; // stations and visual
  readonly starlinkLayer: VectorLayer<VectorSource>;
  readonly trailsLayer: VectorLayer<VectorSource>;
  /** stations lit, stations shadowed, visual lit, visual shadowed, starlink lit, starlink shadowed. */
  readonly classes: readonly SatClass[];
  /** The trails layer's one MultiLineString, rewritten in place. */
  readonly trails: MultiLineString;
  /** [M4] Exposure arcs, one line per group: stations, visual (satellites source), starlink (Starlink source). */
  readonly arcs: readonly SkyArcLine[];
  /**
   * [M4] True while writeSkyArcs draws an arc set: writeSkySatellites then writes no dots, writeTrails no trails and
   * trackedSkyIndices requests no trail paths. Picking (xy, projected, skip) is unchanged: the position at
   * frameTimeMs, the arc's midpoint.
   */
  arcsShown: boolean;
  /** [M4] The arc and model the arc lines were last written from (writeSkyArcs skips an unchanged pair). */
  arcDrawn: ExposureArc | null;
  arcModel: CameraModel | null;
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

/** [Redesign] A cyan trail on a faint dark casing, so it reads on a bright sky too. */
const TRAIL_STYLE = [
  new Style({ stroke: new Stroke({ color: "rgba(13, 20, 51, 0.45)", width: 3.5 }) }),
  new Style({ stroke: new Stroke({ color: "rgba(79, 209, 255, 0.7)", width: 1.5 }) }),
];

/** A coloured line on a dark casing, so it reads on a night image and on a bright one alike. */
function arcStyle(widthPx: number, color: string): Style[] {
  return [
    new Style({ stroke: new Stroke({ color: INK, width: widthPx + 2 }) }),
    new Style({ stroke: new Stroke({ color, width: widthPx }) }),
  ];
}

/** Arcs are sunlit segments only, so each group has one arc style: its lit class, as a line. */
function createArcLine(source: VectorSource, widthPx: number, color: string): SkyArcLine {
  // Empty: LineWriter rewrites its flat coordinates and ends in place. Added to the source only while non-empty.
  const line = new MultiLineString([], "XY", []);
  const feature = new Feature(line);
  feature.setStyle(arcStyle(widthPx, color));
  return { source, feature, line, writer: new LineWriter(line) };
}

/** The three layers, empty. Arrays start at `capacity` objects and grow with the catalog. */
export function createSkySatellites(capacity = 256): SkySatellites {
  const satellitesSource = new VectorSource({ useSpatialIndex: false });
  const starlinkSource = new VectorSource({ useSpatialIndex: false });
  const classes = [
    createClass(satellitesSource, new Style({ image: litImage(3.5) })),
    createClass(satellitesSource, new Style({ image: shadowedImage(3.5) })),
    createClass(satellitesSource, new Style({ image: litImage(3) })),
    createClass(satellitesSource, new Style({ image: shadowedImage(3) })),
    createClass(starlinkSource, new Style({ image: litImage(2, KIND_COLOR.starlink) })),
    createClass(
      starlinkSource,
      new Style({
        image: shadowedImage(2, KIND_SHADOW_FILL.starlink, KIND_COLOR.starlink),
      }),
    ),
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
    arcs: [
      createArcLine(satellitesSource, 2, KIND_COLOR.satellite),
      createArcLine(satellitesSource, 1.5, KIND_COLOR.satellite),
      createArcLine(starlinkSource, 1, KIND_COLOR.starlink),
    ],
    arcsShown: false,
    arcDrawn: null,
    arcModel: null,
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
 * rewrites the class MultiPoints of the layers that are on, leaving out ids.iss, ids.selected and ids.hovered, and
 * every dot while exposure arcs show (sats.arcsShown: call writeSkyArcs first). Fills sats.projected and the picking
 * skip array (pickable: drawn, so on a visible layer, or selected). Fires no change when nothing moved. Allocates
 * nothing unless the catalog grew.
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
  const { xy, projected, skip, classes, arcsShown } = sats;
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
    if (!layerOn || arcsShown || i === ids.iss || i === ids.selected || i === ids.hovered) continue;
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
 * are on and no exposure arcs show, every drawn stations/visual satellite, in catalog order, up to `cap`. Call after
 * writeSkySatellites.
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
  if (!trailsOn || !satellitesOn || sats.arcsShown) return count;
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
 * Projects an ENU position (km) like a satellite: enuToAzAltDeg, apparentAltDeg, projectAzAltDeg. Writes the sky-map
 * coordinate to scratchXy; false when culled, not finite (Refraction throws on a non-finite altitude) or, with
 * `aboveHorizon`, at or below the horizon (apparent; the geometric horizon until M6).
 */
function projectEnuKm(
  model: CameraModel,
  eKm: number,
  nKm: number,
  uKm: number,
  aboveHorizon: boolean,
): boolean {
  enuToAzAltDeg(eKm, nKm, uKm, scratchAzAlt, 0);
  const geometric = scratchAzAlt[1] ?? Number.NaN;
  if (!Number.isFinite(geometric)) return false;
  const alt = apparentAltDeg(geometric);
  if (aboveHorizon && !(alt > 0)) return false;
  if (!projectAzAltDeg(model, scratchAzAlt[0] ?? Number.NaN, alt, scratchUv, 0)) return false;
  toSkyMapCoord(model, scratchUv[0] ?? 0, scratchUv[1] ?? 0, scratchXy, 0);
  return true;
}

/** Point j of a sky path, through projectEnuKm into scratchXy. */
function projectPathPoint(model: CameraModel, path: SkyPathOut, j: number): boolean {
  const o = 3 * j;
  const e = path.enuKm[o] ?? 0;
  return projectEnuKm(model, e, path.enuKm[o + 1] ?? 0, path.enuKm[o + 2] ?? 0, false);
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
 * current position (sats.xy), split where culled. None while exposure arcs show (sats.arcsShown). Returns true when
 * the geometry changed.
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
  const n = sats.arcsShown ? 0 : count;
  for (let k = 0; k < n; k++) {
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

const ARC_VALID = SampleField.valid;
const ARC_SUNLIT = SampleField.sunlit;

/** Lays an arc line in its source while it has a line, and takes it out while empty. True when it moved. */
function placeArcLine(arc: SkyArcLine): boolean {
  const has = arc.source.hasFeature(arc.feature);
  const want = arc.line.getEnds().length > 0;
  if (has === want) return false;
  if (want) arc.source.addFeature(arc.feature);
  else arc.source.removeFeature(arc.feature);
  return true;
}

/**
 * [M4 step 16] A still image's exposure arcs: for every undocked object, the polyline through its arc steps, in its
 * group's line. A segment is drawn only when both ends are valid, sunlit, above the horizon (apparent) and projected,
 * so a satellite entering Earth's shadow ends its trail as on the image; a single point draws nothing. `arc` is
 * drawableExposureArc(state): null while no arc applies, which empties the lines.
 *
 * Call it before writeSkySatellites in every frame: it sets sats.arcsShown, which hides the dots and trails. It
 * rewrites the lines only when the arc or the model changed (once per arc reply, or per calibration change), and
 * fires changes only for lines that moved. Returns true when anything changed.
 */
export function writeSkyArcs(
  sats: SkySatellites,
  model: CameraModel,
  arc: ExposureArc | null,
  catalog: SatCatalog,
): boolean {
  sats.arcsShown = arc !== null;
  if (arc === sats.arcDrawn && model === sats.arcModel) return false;
  sats.arcDrawn = arc;
  sats.arcModel = model;
  const { arcs } = sats;
  for (const a of arcs) a.writer.begin();
  if (arc !== null) {
    const { data, count, steps } = arc;
    const n = Math.min(count, catalog.count);
    for (let i = 0; i < n; i++) {
      if ((catalog.dockedWith[i] ?? -1) !== -1) continue; // drawn at its host's position
      const writer = arcs[Math.min(catalog.groupIndex[i] ?? 0, STARLINK_GROUP)]?.writer;
      if (writer === undefined) continue;
      for (let s = 0; s < steps; s++) {
        const o = (s * count + i) * SAMPLE_STRIDE;
        const drawn =
          data[o + ARC_VALID] === 1 &&
          data[o + ARC_SUNLIT] === 1 &&
          projectEnuKm(model, data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, true);
        if (drawn) writer.point(scratchXy[0] ?? 0, scratchXy[1] ?? 0);
        else writer.breakRun();
      }
      writer.breakRun();
    }
  }
  let changed = false;
  for (const a of arcs) {
    if (a.writer.end()) changed = true;
    if (placeArcLine(a)) changed = true;
  }
  return changed;
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
