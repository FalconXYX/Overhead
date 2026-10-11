// src/map/pick.ts — pixel-space nearest-neighbour picking over the per-frame position arrays (M3 steps 13.7, 14.5).
// A MultiPoint is a single feature to OpenLayers' hit detection, so both maps pick from their own arrays.

/** EPSG:3857 world width in metres: 2π × 6,378,137. */
export const WORLD_WIDTH_M = 40_075_016.685578488;
/** Pick radius in CSS px (README section 9, rule 4); callers multiply by the view resolution. */
export const PICK_RADIUS_PX = 6;

/**
 * Nearest index within radius (map units, inclusive) of (x, y), or −1. Wraps dx by worldWidth only when
 * worldWidth > 0. Entries with skip[i] === 1 and non-finite positions are never picked; the first of two equally
 * near entries wins. Allocates nothing.
 */
export function pickNearest(
  x: number,
  y: number,
  xy: ArrayLike<number>,
  skip: Uint8Array,
  count: number,
  radius: number,
  worldWidth: number,
): number {
  const n = Math.min(count, skip.length, Math.floor(xy.length / 2));
  const wrap = worldWidth > 0;
  let best = -1;
  // Comparisons with NaN are false, so a non-finite pointer, radius or position never wins.
  let bestD2 = radius * radius;
  for (let i = 0; i < n; i++) {
    if (skip[i] === 1) continue;
    let dx = x - (xy[2 * i] ?? Number.NaN);
    if (wrap) dx -= worldWidth * Math.round(dx / worldWidth);
    const dy = y - (xy[2 * i + 1] ?? Number.NaN);
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (best === -1 && d2 === bestD2)) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}
