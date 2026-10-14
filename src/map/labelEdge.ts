// src/map/labelEdge.ts — [Polish] keeps a marker's label inside its map's frame. A label sits centred above its marker;
// near the frame's right or left edge it lines up its right or left end with the marker instead, and near the top
// edge it goes below the marker. The sky map's frame is the video (the overlay tracks the video's content box), so
// "ISS" never runs off the video's edge. The decision is made in the layers' style functions, from the map's view
// extent and resolution at render time; styles stay cached per variant.
import { type Extent, getForViewAndSize } from "ol/extent";
import type OlMap from "ol/Map";

/**
 * "" centred above; "l" / "r" the label's left / right end at the marker; "b" below the marker; "x" no label (the
 * marker's centre is outside the frame, so any label would be cut).
 */
export type LabelEdge = "" | "l" | "r" | "b" | "lb" | "rb" | "x";

/** A label's width in CSS px, roughly: 0.6 em per character of a 12–13 px UI font, plus the halo. */
export function labelWidthPx(label: string, fontPx: number): number {
  return label.length * fontPx * 0.6 + 4;
}

/**
 * Which way the label of a marker at map coordinate (x, y) must lean to stay inside `extent` at `resolution` (map
 * units per CSS px): its half width must fit beside it, and its line (centred `aboveOffsetPx` above the marker) under
 * the top edge. On a map that wraps around the world (`wrapWidth`, the ground map), x is first taken to the world copy
 * nearest the view.
 */
export function labelEdge(
  xIn: number,
  y: number,
  extent: Extent,
  resolution: number,
  label: string,
  fontPx: number,
  aboveOffsetPx: number,
  wrapWidth = 0,
): LabelEdge {
  if (label === "" || !(resolution > 0)) return "";
  const centre = ((extent[0] ?? 0) + (extent[2] ?? 0)) / 2;
  const x = wrapWidth > 0 ? xIn - Math.round((xIn - centre) / wrapWidth) * wrapWidth : xIn;
  const half = labelWidthPx(label, fontPx) / 2;
  const left = (x - (extent[0] ?? 0)) / resolution;
  const right = ((extent[2] ?? 0) - x) / resolution;
  const top = ((extent[3] ?? 0) - y) / resolution;
  const bottom = (y - (extent[1] ?? 0)) / resolution;
  if (left < 0 || right < 0 || top < 0 || bottom < 0) return "x";
  const below = top < aboveOffsetPx + fontPx / 2 + 2;
  if (right < half) return below ? "rb" : "r";
  if (left < half) return below ? "lb" : "l";
  return below ? "b" : "";
}

/** Text placement for an edge: aligned to stay inside, `aboveOffsetPx` above (or below) the marker's centre. */
export function edgeTextPlacement(
  edge: LabelEdge,
  aboveOffsetPx: number,
): { textAlign: CanvasTextAlign | undefined; offsetY: number } {
  const align = edge.startsWith("r") ? "right" : edge.startsWith("l") ? "left" : undefined;
  return { textAlign: align, offsetY: edge.endsWith("b") ? aboveOffsetPx : -aboveOffsetPx };
}

/**
 * The map's view extent (what its frame shows), or null before it has a size. One array, rewritten on each call: the
 * style functions run on every render and allocate nothing.
 */
export function viewExtentOf(map: OlMap): () => Extent | null {
  const extent: Extent = [0, 0, 0, 0];
  return () => {
    const size = map.getSize();
    const view = map.getView();
    const center = view.getCenter();
    const resolution = view.getResolution();
    const [w = 0, h = 0] = size ?? [];
    if (size === undefined || !(w > 0 && h > 0) || center === undefined || resolution === undefined)
      return null;
    return getForViewAndSize(center, resolution, view.getRotation(), size, extent);
  };
}
