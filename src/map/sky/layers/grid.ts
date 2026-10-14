// src/map/sky/layers/grid.ts — the alt/az grid and the cardinal letters (M2 step 8.3).
// Every sample goes through the camera model, so the same code serves M4's lenses. Colours and fonts are visual
// design (M9 step 12): faint blue-grey lines and light letters on the night sky.
import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { type CameraModel, projectAzAltDeg, toSkyMapCoord } from "../../../domain/camera";

/** Altitude circles at 0, 10 … 80°; azimuth lines every 10° from alt 0° to 80°; samples every 1°. */
const CIRCLE_STEP_DEG = 10;
const LINE_STEP_DEG = 10;
const TOP_ALT_DEG = 80;
const SAMPLE_STEP_DEG = 1;
/** Letters sit at alt 5°, so they lie fully inside the frame. */
const LETTER_ALT_DEG = 5;
const LETTERS = [
  ["N", 0],
  ["E", 90],
  ["S", 180],
  ["W", 270],
] as const;

const scratch = new Float64Array(2);

/** Map coordinate of (az, alt), or null when the camera model culls it. */
function mapCoord(model: CameraModel, azDeg: number, altDeg: number): number[] | null {
  if (!projectAzAltDeg(model, azDeg, altDeg, scratch, 0)) return null;
  const out = [0, 0];
  toSkyMapCoord(model, scratch[0] ?? 0, scratch[1] ?? 0, out, 0);
  return out;
}

/** Appends one sampled curve, split wherever a sample is culled; runs shorter than 2 points are dropped. */
function appendSplit(
  model: CameraModel,
  out: number[][][],
  samples: number,
  azAltAt: (i: number) => readonly [azDeg: number, altDeg: number],
): void {
  let run: number[][] = [];
  for (let i = 0; i < samples; i++) {
    const [az, alt] = azAltAt(i);
    const c = mapCoord(model, az, alt);
    if (c !== null) {
      run.push(c);
      continue;
    }
    if (run.length >= 2) out.push(run);
    run = [];
  }
  if (run.length >= 2) out.push(run);
}

/** One MultiLineString (circles, then azimuth lines) plus a Point per visible letter, its text in `label`. */
export function buildGridFeatures(model: CameraModel): Feature[] {
  const polylines: number[][][] = [];
  const circleSamples = 360 / SAMPLE_STEP_DEG + 1; // az 0 … 360 inclusive: the circle closes
  for (let alt = 0; alt <= TOP_ALT_DEG; alt += CIRCLE_STEP_DEG) {
    appendSplit(model, polylines, circleSamples, (i) => [i * SAMPLE_STEP_DEG, alt]);
  }
  const lineSamples = TOP_ALT_DEG / SAMPLE_STEP_DEG + 1; // alt 0 … 80 inclusive
  for (let az = 0; az < 360; az += LINE_STEP_DEG) {
    appendSplit(model, polylines, lineSamples, (i) => [az, i * SAMPLE_STEP_DEG]);
  }
  const features: Feature[] = [new Feature(new MultiLineString(polylines))];
  for (const [label, az] of LETTERS) {
    const c = mapCoord(model, az, LETTER_ALT_DEG);
    if (c === null) continue;
    const letter = new Feature(new Point(c));
    letter.set("label", label);
    features.push(letter);
  }
  return features;
}

const LINE_STYLE = new Style({
  stroke: new Stroke({ color: "rgba(201, 209, 243, 0.4)", width: 1 }),
});
const LETTER_STYLES: ReadonlyMap<string, Style> = new Map(
  LETTERS.map(([label]) => [
    label,
    new Style({
      text: new Text({
        text: label,
        font: "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif",
        fill: new Fill({ color: "#c9d1f3" }),
        stroke: new Stroke({ color: "rgba(13, 20, 51, 0.9)", width: 3 }),
      }),
    }),
  ]),
);

/** Cached styles: the grid lines, or the letter's own text style. */
function gridStyle(feature: unknown): Style | undefined {
  const label = (feature as Feature).get("label");
  return typeof label === "string" ? LETTER_STYLES.get(label) : LINE_STYLE;
}

/** Empty until the first camera model; createSkyMap's setCameraModel replaces its features. */
export function createGridLayer(): VectorLayer<VectorSource> {
  return new VectorLayer({
    source: new VectorSource({ useSpatialIndex: false }),
    style: gridStyle,
  });
}
