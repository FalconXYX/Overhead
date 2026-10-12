// src/map/sky/layers/horizon.ts — the terrain skyline and its dimming fill (M6 step 9). Every point goes through the
// camera model, so one rule serves every lens and pose. Rebuilt only on a new camera model or profile, never per
// frame. The fill sits above every object layer, so anything behind terrain is dimmed by it (DECISIONS, M6). Colours,
// opacity and line weight are visual design, settled from screenshots; over a video the line stays thin (O1).
import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import MultiPolygon from "ol/geom/MultiPolygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import { type CameraModel, projectAzAltDeg, toSkyMapCoord } from "../../../domain/camera";

/** Bisection steps for a fill bottom: resolution (top + 90°)/4096, 0.024° for a 10° top. */
const BOTTOM_BISECTIONS = 12;
const NADIR_DEG = -90;
const PROFILE_LENGTH = 360;

const LINE_ID = "skyline";
const FILL_ID = "skyline-fill";

const LINE_STYLE = new Style({
  stroke: new Stroke({ color: "rgba(168, 150, 128, 0.9)", width: 1.5 }), // [M9] a muted earth tone, never the accent
  zIndex: 1,
});
const FILL_STYLE = new Style({ fill: new Fill({ color: "rgba(10, 9, 8, 0.55)" }), zIndex: 0 });

/** Coordinates in sky-map space (toSkyMapCoord): a MultiLineString and a MultiPolygon of closed quads. */
export interface SkylineCoords {
  readonly line: number[][][];
  readonly fill: number[][][][];
}

const scratch = new Float64Array(2);

/** Map coordinate of (az, alt), or null when the camera model culls it. */
function mapCoord(model: CameraModel, azDeg: number, altDeg: number): number[] | null {
  if (!projectAzAltDeg(model, azDeg, altDeg, scratch, 0)) return null;
  const out = [0, 0];
  toSkyMapCoord(model, scratch[0] ?? 0, scratch[1] ?? 0, out, 0);
  return out;
}

const projects = (model: CameraModel, azDeg: number, altDeg: number): boolean =>
  projectAzAltDeg(model, azDeg, altDeg, scratch, 0);

/**
 * The lowest altitude at `azDeg` that still projects, for a projectable `topDeg`: −90° if it projects; otherwise
 * BOTTOM_BISECTIONS bisections between −90° (culled) and topDeg (projectable), keeping the projectable end. This fills
 * to the horizon circle on a zenith fisheye and past the frame edge on a rectilinear camera, with no lens-specific
 * code.
 */
function fillBottomDeg(model: CameraModel, azDeg: number, topDeg: number): number {
  if (projects(model, azDeg, NADIR_DEG)) return NADIR_DEG;
  let culled = NADIR_DEG;
  let shown = topDeg;
  for (let i = 0; i < BOTTOM_BISECTIONS; i++) {
    const mid = (culled + shown) / 2;
    if (projects(model, azDeg, mid)) shown = mid;
    else culled = mid;
  }
  return shown;
}

/**
 * The skyline for `profileDeg` (360 values, one per degree of azimuth) through `model`. Line: az 0, 1 … 360 at
 * profileDeg[az mod 360], split wherever a point is culled (runs of one point are dropped). Fill: one quad per
 * degree, (az, top), (az + 1, top′), (az + 1, bottom′), (az, bottom), skipped when top or top′ does not project.
 * A profile entirely below a zenith fisheye's horizon gives an empty line and fill.
 */
export function buildSkylineCoords(
  model: CameraModel,
  profileDeg: ArrayLike<number>,
): SkylineCoords {
  const top: (number[] | null)[] = [];
  const bottom: (number[] | null)[] = [];
  for (let az = 0; az <= PROFILE_LENGTH; az++) {
    const alt = profileDeg[az % PROFILE_LENGTH] ?? Number.NaN;
    const t = mapCoord(model, az, alt);
    top.push(t);
    bottom.push(t === null ? null : mapCoord(model, az, fillBottomDeg(model, az, alt)));
  }

  const line: number[][][] = [];
  let run: number[][] = [];
  for (const c of top) {
    if (c !== null) {
      run.push(c);
      continue;
    }
    if (run.length >= 2) line.push(run);
    run = [];
  }
  if (run.length >= 2) line.push(run);

  const fill: number[][][][] = [];
  for (let az = 0; az < PROFILE_LENGTH; az++) {
    const t0 = top[az];
    const t1 = top[az + 1];
    const b0 = bottom[az];
    const b1 = bottom[az + 1];
    if (t0 == null || t1 == null || b0 == null || b1 == null) continue;
    fill.push([[t0, t1, b1, b0, [...t0]]]);
  }
  return { line, fill };
}

/** Empty until the first profile; holds the fill below the line. Canvas renderer, no spatial index. */
export function createHorizonLayer(): VectorLayer<VectorSource> {
  const fill = new Feature(new MultiPolygon([]));
  fill.setId(FILL_ID);
  fill.setStyle(FILL_STYLE);
  const line = new Feature(new MultiLineString([]));
  line.setId(LINE_ID);
  line.setStyle(LINE_STYLE);
  return new VectorLayer({
    source: new VectorSource({ useSpatialIndex: false, features: [fill, line] }),
  });
}

/** Rebuilds both features for this model and profile; a null model or profile clears them. */
export function writeSkyline(
  layer: VectorLayer<VectorSource>,
  model: CameraModel | null,
  profileDeg: Float32Array | null,
): void {
  const source = layer.getSource();
  const line = source?.getFeatureById(LINE_ID)?.getGeometry();
  const fill = source?.getFeatureById(FILL_ID)?.getGeometry();
  if (!(line instanceof MultiLineString) || !(fill instanceof MultiPolygon)) return;
  const coords =
    model === null || profileDeg === null
      ? { line: [], fill: [] }
      : buildSkylineCoords(model, profileDeg);
  line.setCoordinates(coords.line);
  fill.setCoordinates(coords.fill);
}
