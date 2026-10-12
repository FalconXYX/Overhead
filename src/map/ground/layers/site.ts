// src/map/ground/layers/site.ts — the active camera's site marker (M1 step 11) and its wedge (M4 step 12). Their look
// is visual design (M9 step 12): a dark dot in a light ring (unlike a satellite's light dot) and a faint light wedge.
import Feature from "ol/Feature";
import type Point from "ol/geom/Point";
import Polygon, { circular } from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { offset } from "ol/sphere";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import type { AzimuthCoverage } from "../../../domain/camera";
import { wrap360 } from "../../../domain/geo";

const LIGHT = "#e6ebf2";
const INK = "rgba(4, 6, 11, 0.9)";
/** A dark halo, so the light label reads on clouds and on the ocean alike. */
const LABEL_HALO = new Stroke({ color: INK, width: 3 });
const LABEL_FILL = new Fill({ color: LIGHT });
const MARKER_STYLE = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#04060b" }),
    stroke: new Stroke({ color: LIGHT, width: 2 }),
  }),
});
const WEDGE_STYLE = new Style({
  fill: new Fill({ color: "rgba(200, 216, 236, 0.12)" }),
  stroke: new Stroke({ color: "rgba(226, 233, 243, 0.85)", width: 1.5 }),
});
const labelStyles = new Map<string, Style[]>();

/** [M4] The wedge's radius on the ground in metres: a visual choice (M4 step 12.2), settled from screenshots. */
export const SITE_WEDGE_RADIUS_M = 100_000;
/** [M4] Vertices of the "full" circle (M4 step 12.2). */
export const WEDGE_CIRCLE_VERTICES = 64;
/** [M4] Bearing step of a "range" wedge's arc (M4 step 12.2). */
export const WEDGE_ARC_STEP_DEG = 2;

const D2R = Math.PI / 180;

/**
 * [M4] The site wedge in EPSG:3857 (M4 step 12.2; DECISIONS "Ground map"): the azimuth range the frame covers.
 * "full": `circular([lon, lat], radiusM, 64)`. "range": the site, then `offset([lon, lat], radiusM, az)` (bearings
 * clockwise from north) every 2° clockwise from `fromAzDeg`, ending exactly at `toAzDeg`, and back to the site; it
 * crosses north when fromAzDeg > toAzDeg.
 */
export function siteWedgeGeometry(
  lonDeg: number,
  latDeg: number,
  coverage: AzimuthCoverage,
  radiusM: number,
): Polygon {
  const centre = [lonDeg, latDeg];
  let polygon: Polygon;
  if (coverage.kind === "full") {
    polygon = circular(centre, radiusM, WEDGE_CIRCLE_VERTICES);
  } else {
    const spanDeg = wrap360(coverage.toAzDeg - coverage.fromAzDeg);
    const ring: number[][] = [centre];
    const steps = Math.ceil(spanDeg / WEDGE_ARC_STEP_DEG);
    for (let i = 0; i < steps; i++) {
      ring.push(offset(centre, radiusM, (coverage.fromAzDeg + i * WEDGE_ARC_STEP_DEG) * D2R));
    }
    ring.push(offset(centre, radiusM, (coverage.fromAzDeg + spanDeg) * D2R));
    ring.push(centre);
    polygon = new Polygon([ring]);
  }
  return polygon.transform("EPSG:4326", "EPSG:3857");
}

/** The marker with the feature's `name` as a label above it, or the wedge (which has no name). Cached per name. */
function siteStyle(feature: unknown): Style[] {
  const f = feature as Feature;
  if (f.getGeometry()?.getType() !== "Point") return [WEDGE_STYLE];
  const name = f.get("name");
  if (typeof name !== "string") return [MARKER_STYLE];
  let styles = labelStyles.get(name);
  if (styles === undefined) {
    const label = new Style({
      text: new Text({
        text: name,
        font: "12px system-ui, -apple-system, 'Segoe UI', sans-serif",
        offsetY: -16,
        fill: LABEL_FILL,
        stroke: LABEL_HALO,
      }),
    });
    styles = [MARKER_STYLE, label];
    labelStyles.set(name, styles);
  }
  return styles;
}

/**
 * The marker (`feature`) and, from M4, the wedge (`wedge`, created first so the default render order draws it below
 * the marker); bindSite sets their geometries and the marker's name.
 */
export function createSiteLayer(): {
  layer: VectorLayer<VectorSource<Feature<Point | Polygon>>>;
  feature: Feature<Point>;
  wedge: Feature<Polygon>;
} {
  const wedge = new Feature<Polygon>();
  const feature = new Feature<Point>();
  const layer = new VectorLayer({
    source: new VectorSource<Feature<Point | Polygon>>({ features: [wedge, feature] }),
    style: siteStyle,
  });
  return { layer, feature, wedge };
}
