// src/map/sky/layers/bodies.ts — the Sun, Moon and planets with labels (M2 step 8.5).
// Colours, fonts and sizes are visual design, settled from screenshots; the values here are placeholders.
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { BODY_IDS, BODY_STRIDE } from "../../../domain/astro";
import { type CameraModel, projectAzAltDeg, toSkyMapCoord } from "../../../domain/camera";

export type BodyId = (typeof BODY_IDS)[number];

const scratch = new Float64Array(2);

const NAMES: Readonly<Record<BodyId, string>> = {
  sun: "Sun",
  moon: "Moon",
  "planet:Mercury": "Mercury",
  "planet:Venus": "Venus",
  "planet:Mars": "Mars",
  "planet:Jupiter": "Jupiter",
  "planet:Saturn": "Saturn",
  "planet:Uranus": "Uranus",
};

/** Below this illuminated fraction the Moon is labelled "Moon (new)": it still reports magnitude −4.45 (gotcha 9). */
const NEW_MOON_PHASE = 0.02;

/** "Sun", "Moon", "Mercury" … "Uranus"; "Moon (new)" while the Moon's phase fraction is below 0.02. */
export function bodyLabel(id: BodyId, phaseFraction: number): string {
  if (id === "moon" && phaseFraction < NEW_MOON_PHASE) return "Moon (new)";
  return NAMES[id];
}

const MIN_RADIUS_PX = 2.5;
const MAX_RADIUS_PX = 7;

/**
 * Marker radius in CSS px from Illumination magnitude: grows with brightness, clamped so the Sun (−26.7) and the
 * Moon do not dominate. Rounded to 0.5 px so a style is rebuilt only when the size visibly changes.
 */
export function bodyRadiusPx(mag: number): number {
  if (!Number.isFinite(mag)) return MIN_RADIUS_PX;
  const r = Math.min(MAX_RADIUS_PX, Math.max(MIN_RADIUS_PX, 2.5 + (2 - mag) * 0.75));
  return Math.round(r * 2) / 2;
}

export interface BodiesLayer {
  readonly layer: VectorLayer<VectorSource>;
  readonly features: readonly Feature<Point>[]; // BODY_IDS order; id = the BODY_IDS string, bodyIndex = i
  readonly points: readonly Point[]; // features[i]'s geometry
  readonly visible: Uint8Array; // 1 = projected in the last pass; 0 = culled, or no pass yet
  readonly styles: (Style | undefined)[]; // cached per body; rebuilt only when styleKeys[i] changes
  readonly styleKeys: string[]; // "label|radius|hollow"
}

const MARKER_FILL = new Fill({ color: "#222" });
const MARKER_STROKE = new Stroke({ color: "#fff", width: 1 });
/** The new Moon's hollow marker: shape, not colour, de-emphasises it; the label carries the meaning. */
const NEW_MOON_STROKE = new Stroke({ color: "#222", width: 1.5 });
const LABEL_FILL = new Fill({ color: "#222" });
const LABEL_HALO = new Stroke({ color: "#fff", width: 3 });

function bodyStyle(label: string, radiusPx: number, hollow: boolean): Style {
  return new Style({
    image: new CircleStyle({
      radius: radiusPx,
      fill: hollow ? undefined : MARKER_FILL,
      stroke: hollow ? NEW_MOON_STROKE : MARKER_STROKE,
    }),
    text: new Text({
      text: label,
      font: "12px sans-serif",
      offsetY: -(radiusPx + 9),
      fill: LABEL_FILL,
      stroke: LABEL_HALO,
    }),
  });
}

/** 8 Point features, created once. The style function draws only bodies the last pass projected. */
export function createBodiesLayer(): BodiesLayer {
  const visible = new Uint8Array(BODY_IDS.length);
  const styles: (Style | undefined)[] = new Array(BODY_IDS.length).fill(undefined);
  const styleKeys: string[] = new Array(BODY_IDS.length).fill("");
  const points = BODY_IDS.map(() => new Point([0, 0]));
  const features = BODY_IDS.map((id, i) => {
    const f = new Feature(points[i]);
    f.setId(id);
    f.set("bodyIndex", i);
    return f;
  });
  const layer = new VectorLayer({
    source: new VectorSource({ useSpatialIndex: false, features }),
    style: (feature) => {
      const i = feature.get("bodyIndex");
      return typeof i === "number" && visible[i] === 1 ? styles[i] : undefined;
    },
  });
  return { layer, features, points, visible, styles, styleKeys };
}

/**
 * After a sky pass: projects each body of `values` ([az, alt, mag, phase] × 8, BODY_IDS order), writes its map
 * coordinate in place and calls point.changed(). A body's Style is rebuilt only when its label or size changes.
 */
export function writeBodies(bodies: BodiesLayer, model: CameraModel, values: Float64Array): void {
  for (let i = 0; i < BODY_IDS.length; i++) {
    const point = bodies.points[i];
    const id = BODY_IDS[i];
    if (point === undefined || id === undefined) continue;
    const o = i * BODY_STRIDE;
    const az = values[o] ?? Number.NaN;
    const alt = values[o + 1] ?? Number.NaN;
    const mag = values[o + 2] ?? Number.NaN;
    const phase = values[o + 3] ?? Number.NaN;
    if (projectAzAltDeg(model, az, alt, scratch, 0)) {
      toSkyMapCoord(model, scratch[0] ?? 0, scratch[1] ?? 0, point.getFlatCoordinates(), 0);
      bodies.visible[i] = 1;
      const label = bodyLabel(id, phase);
      const hollow = id === "moon" && phase < NEW_MOON_PHASE;
      const radius = bodyRadiusPx(mag);
      const key = `${label}|${radius}|${hollow}`;
      if (bodies.styleKeys[i] !== key) {
        bodies.styleKeys[i] = key;
        bodies.styles[i] = bodyStyle(label, radius, hollow);
      }
    } else {
      bodies.visible[i] = 0;
    }
    point.changed(); // also re-evaluates the style of a body that just set
  }
}
