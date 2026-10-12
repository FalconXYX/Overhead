// src/map/sky/viewCentre.ts — the sky view's centre as an image pixel, for the Calibration panel's keyboard path
// "Add point at view centre" (M4 step 14.4). It reads the map registry, so the panel imports no OpenLayers module
// (README import rule 4).
import { registry } from "../registry";

/**
 * (u, v) = (x, H − y) of the sky view's centre, where [x, y] is the view centre in the sky map's pixel projection
 * ([u, H − v], README Units rule 4); null without a sky map or a finite centre.
 */
export function skyViewCentreImagePx(heightPx: number): [uPx: number, vPx: number] | null {
  const centre = registry.get("sky")?.getView().getCenter();
  const x = centre?.[0];
  const y = centre?.[1];
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, heightPx - y];
}
