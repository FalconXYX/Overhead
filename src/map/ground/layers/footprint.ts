// src/map/ground/layers/footprint.ts — where the camera frame looks at orbit height (M8 step 8.1). A canvas VectorLayer:
// WebGLVector does not draw beyond ±180° (DECISIONS "Rendering"), and the ring reaches −186.9° for cfht-starcam at
// 800 km. bindFootprint writes the one polygon. The polygon is exact only at its height, never a predictor (M8
// gotcha 6). Its look is visual design (M9 step 12): a light dashed ring on a dark casing, never the accent (which marks
// the ISS and the selection), that keeps the imagery underneath readable.
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { footprintStatus } from "../../../state/footprintStatus";

export interface FootprintLayer {
  readonly layer: VectorLayer<VectorSource<Feature<Polygon>>>;
  /** The one ring, written in place by bindFootprint; empty while nothing is drawn. */
  readonly polygon: Polygon;
}

/** "Camera view at {H} km", H = footprintStatus.heightKm rounded. */
export function footprintLabel(heightKm: number): string {
  return `Camera view at ${Math.round(heightKm)} km`;
}

/**
 * [M8] The footprint layer: one Feature(Polygon([])) on a canvas vector source (default wrapX, as the ground tracks).
 * The label follows footprintStatus, read when OpenLayers renders; bindFootprint changes the polygon on every
 * recompute, which re-renders the layer.
 */
export function createFootprintLayer(): FootprintLayer {
  const polygon = new Polygon([]);
  const source = new VectorSource<Feature<Polygon>>({ features: [new Feature(polygon)] });
  const text = new Text({
    text: "",
    overflow: true, // a ring narrower than its label still names itself
    font: "12px system-ui, -apple-system, 'Segoe UI', sans-serif",
    fill: new Fill({ color: "#e6ebf2" }),
    stroke: new Stroke({ color: "rgba(4, 6, 11, 0.9)", width: 3 }),
  });
  const styles = [
    new Style({ stroke: new Stroke({ color: "rgba(4, 6, 11, 0.55)", width: 4 }) }),
    new Style({
      fill: new Fill({ color: "rgba(200, 216, 236, 0.1)" }),
      stroke: new Stroke({ color: "rgba(226, 233, 243, 0.92)", width: 2, lineDash: [8, 4] }),
    }),
    new Style({ text }),
  ];
  let labelKm = Number.NaN;
  const layer = new VectorLayer({
    source,
    style: () => {
      const h = footprintStatus.heightKm;
      if (h === null || footprintStatus.pairCount === 0) return undefined; // nothing drawn
      const km = Math.round(h);
      if (km !== labelKm) {
        labelKm = km;
        text.setText(footprintLabel(h));
      }
      return styles;
    },
  });
  return { layer, polygon };
}
