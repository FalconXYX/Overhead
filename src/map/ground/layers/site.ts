// src/map/ground/layers/site.ts — the active camera's site marker (M1 step 11). Its look is visual design, not fixed.
import Feature from "ol/Feature";
import type Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Stroke from "ol/style/Stroke";
import Style, { createDefaultStyle } from "ol/style/Style";
import Text from "ol/style/Text";

/** A halo so OpenLayers' default dark text stays readable on satellite imagery (placeholder until the visual design). */
const LABEL_HALO = new Stroke({ color: "#fff", width: 3 });

/** OpenLayers' default point style, plus the feature's `name` as a label above it. */
function siteStyle(feature: unknown): Style[] {
  const name = (feature as Feature).get("name");
  const label = new Style({
    text: new Text({
      text: typeof name === "string" ? name : "",
      offsetY: -16,
      stroke: LABEL_HALO,
    }),
  });
  return [...createDefaultStyle(feature as Feature, 1), label];
}

/** One feature; bindSite sets its geometry and name. */
export function createSiteLayer(): {
  layer: VectorLayer<VectorSource<Feature<Point>>>;
  feature: Feature<Point>;
} {
  const feature = new Feature<Point>();
  const layer = new VectorLayer({
    source: new VectorSource<Feature<Point>>({ features: [feature] }),
    style: siteStyle,
  });
  return { layer, feature };
}
