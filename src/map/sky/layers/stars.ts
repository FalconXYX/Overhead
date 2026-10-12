// src/map/sky/layers/stars.ts — every star of the magnitude prefix in one MultiPoint (M2 step 8.4).
// A custom Style.renderer draws only the visible stars, each with its own radius: 0.7–0.9 ms per render at
// 8,404 stars, against 5–8 ms for one MultiPoint per magnitude bin (gotcha 11).
import Feature from "ol/Feature";
import MultiPoint from "ol/geom/MultiPoint";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";
import type { StarRow } from "../../../domain/astro";

export interface StarsLayer {
  readonly layer: VectorLayer<VectorSource>;
  readonly geometry: MultiPoint; // point i = star i of the catalogue prefix
  readonly visible: Uint8Array; // 1 = draw star i (projected, alt ≥ 0)
  readonly radiusPx: Float32Array; // CSS px, set once from vmag
}

/**
 * One MultiPoint for every star; a custom renderer draws the visible ones with a per-star radius.
 * Every point must stay inside the frame (culled stars sit at the frame centre with visible 0): OpenLayers drops
 * points outside the rendered extent before the renderer runs, which would shift the per-star arrays (gotcha 20).
 */
export function createStarsLayer(capacity: number, fillStyle: string): StarsLayer {
  const visible = new Uint8Array(capacity);
  const radiusPx = new Float32Array(capacity);
  const geometry = new MultiPoint([0, 0], "XY");
  const style = new Style({
    renderer: (pixelCoordinates, state) => {
      const pts = pixelCoordinates as number[][]; // one [x, y] per point, in point order, device px
      const ctx = state.context;
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (visible[i] !== 1 || p === undefined) continue;
        const x = p[0] ?? 0;
        const y = p[1] ?? 0;
        const r = (radiusPx[i] ?? 0) * state.pixelRatio; // the renderer works in device pixels
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    },
  });
  const source = new VectorSource({ useSpatialIndex: false, features: [new Feature(geometry)] });
  return {
    layer: new VectorLayer({ source, style, renderBuffer: 1_000_000 }),
    geometry,
    visible,
    radiusPx,
  };
}

/** After a magnitude-limit change: one point per star in the new prefix (allocates once per change). */
export function setStarCount(stars: StarsLayer, count: number): void {
  stars.geometry.setFlatCoordinates("XY", new Array<number>(count * 2).fill(0));
  stars.visible.fill(0);
  stars.geometry.changed(); // setFlatCoordinates fires no change itself (gotcha 12)
}

/**
 * Marker radius in CSS px from V magnitude. Monotonic: a brighter star is never smaller. The numbers are visual
 * design, settled from screenshots: V 6.5 → 0.75 px, V 4.5 → 1.65 px, capped at 4 px (Sirius, V −1.46).
 */
export function starRadiusPx(vmag: number): number {
  if (!Number.isFinite(vmag)) return 0.75;
  return Math.min(4, Math.max(0.75, 0.75 + (6.5 - vmag) * 0.45));
}

/** Fills radiusPx from each row's vmag, once per catalogue load. Rows beyond the layer's capacity are ignored. */
export function setStarRadii(stars: StarsLayer, rows: readonly StarRow[]): void {
  const n = Math.min(rows.length, stars.radiusPx.length);
  for (let i = 0; i < n; i++) stars.radiusPx[i] = starRadiusPx(rows[i]?.[2] ?? Number.NaN);
}
