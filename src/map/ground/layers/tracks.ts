// src/map/ground/layers/tracks.ts — ground tracks on a canvas VectorLayer (M3 step 14.4). WebGLVector drops unwrapped
// geometry past ±180° (gotcha 12), so tracks keep the worker's unwrapped longitudes on canvas with the source's
// default wrapX. [Redesign] Thin cyan lines (the satellites' colour) on the imagery; the selected track in the
// selection's orange on a dark casing. Visible while layers.tracks ("Satellite paths") is on.
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import VectorLayer from "ol/layer/Vector";
import { fromEPSG4326 } from "ol/proj/epsg3857";
import VectorSource from "ol/source/Vector";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import type { TrackOut } from "../../../workers/protocol";

export interface GroundTracks {
  readonly layer: VectorLayer<VectorSource<Feature<LineString>>>;
  readonly source: VectorSource<Feature<LineString>>;
}

/** Other tracks: thin. */
const TRACK_STYLE = new Style({
  stroke: new Stroke({ color: "rgba(79, 209, 255, 0.6)", width: 1.25 }),
});
/** The selected satellite's ±10 min track, emphasised by width (with a halo), not by colour alone. */
const SELECTED_TRACK_STYLES = [
  new Style({ stroke: new Stroke({ color: "rgba(13, 20, 51, 0.75)", width: 5 }) }),
  new Style({ stroke: new Stroke({ color: "#ff8a3d", width: 2.5 }) }),
];

function trackStyle(feature: unknown): Style | Style[] {
  return (feature as Feature).get("selected") === true ? SELECTED_TRACK_STYLES : TRACK_STYLE;
}

/** Empty until the first tracks reply; bindTracks redraws it whenever ephemeris.pathsVersion changes. */
export function createTracksLayer(): GroundTracks {
  const source = new VectorSource<Feature<LineString>>(); // wrapX defaults to true
  const layer = new VectorLayer({ source, style: trackStyle });
  return { layer, source };
}

/**
 * Replaces every track with the given ones: one LineString per track with at least 2 points, its [lon, lat] pairs
 * converted to EPSG:3857 without wrapping. Feature properties: `index` (catalog index) and `selected`.
 * Allocates per call; bindTracks calls it only when the tracks or the selection change (≤ 10 per second).
 */
export function writeTracks(
  tracks: GroundTracks,
  all: ReadonlyMap<number, TrackOut>,
  selectedIndex: number | null,
): void {
  const features: Feature<LineString>[] = [];
  for (const t of all.values()) {
    const n = 2 * Math.floor(t.lonLatDeg.length / 2);
    if (n < 4) continue;
    const flat = new Array<number>(n);
    for (let i = 0; i < n; i++) flat[i] = t.lonLatDeg[i] ?? 0;
    fromEPSG4326(flat, flat, 2); // no wrapping: x keeps the unwrapped longitude
    const feature = new Feature(new LineString(flat, "XY"));
    feature.set("index", t.index);
    feature.set("selected", t.index === selectedIndex);
    features.push(feature);
  }
  tracks.source.clear(true); // fires one change; fast: no removefeature events
  if (features.length > 0) tracks.source.addFeatures(features);
}
