// src/map/classPoints.ts — the per-class MultiPoint writes (M3 step 14.2, DECISIONS Rendering). One MultiPoint per
// group and style class, written in place, then one changed() per frame: per-feature setCoordinates costs 13–46 ms
// per frame at Starlink scale on either renderer.
import type Feature from "ol/Feature";
import type MultiPoint from "ol/geom/MultiPoint";
import type VectorSource from "ol/source/Vector";

/**
 * Writes count points ([x, y] pairs from flat) in place and calls changed(); removes the feature while empty and
 * adds it back after (WebGL, gotcha 10: an emptied MultiPoint never redraws on WebGLVector). Create the feature
 * with one coordinate and do not add it to its source: the first non-empty write adds it, so no placeholder point
 * is ever drawn at 0, 0. Returns true when it changed anything; identical points fire no change, so a paused map is
 * not redrawn every frame (README section 7, Time rule 4).
 */
export function writeClassPoints(
  source: VectorSource,
  feature: Feature<MultiPoint>,
  flat: number[],
  count: number,
): boolean {
  const geometry = feature.getGeometry();
  if (geometry === undefined) return false;
  if (count === 0) {
    if (!source.hasFeature(feature)) return false;
    source.removeFeature(feature);
    return true;
  }
  const coords = geometry.getFlatCoordinates(); // live array: write in place, then one changed()
  const n = 2 * count;
  let dirty = coords.length !== n;
  coords.length = n;
  for (let i = 0; i < n; i++) {
    const v = flat[i] ?? 0;
    if (coords[i] !== v) {
      coords[i] = v;
      dirty = true;
    }
  }
  if (dirty) geometry.changed();
  if (!source.hasFeature(feature)) {
    source.addFeature(feature);
    return true;
  }
  return dirty;
}
