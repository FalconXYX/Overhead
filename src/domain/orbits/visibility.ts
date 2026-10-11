// src/domain/orbits/visibility.ts — "visible to the eye" for a satellite (DECISIONS, Satellites; README section 7).
import type { GpGroup } from "./omm";

/**
 * Sun geometric altitude cutoff for "visible": −6° stations/visual, −12° starlink. Geometric, never refracted: a
 * refracted Sun turns "visible" on about 156 s after the twilight marker (M3 gotcha 8). Most Starlinks that pass
 * the −6° rule are fainter than magnitude 7.6, hence −12°.
 */
export const SUN_CUTOFF_DEG: Readonly<Record<GpGroup, number>> = Object.freeze({
  stations: -6,
  visual: -6,
  starlink: -12,
});

/**
 * sunlit AND sunAltDeg ≤ SUN_CUTOFF_DEG[group] AND apparentAltDeg > horizonDeg.
 *
 * `sunlit` is the sample's flag (shadow fraction < 0.5, via sunlitAt), `sunAltDeg` the Sun's geometric altitude
 * from the same sample, `apparentAltDeg` the refracted altitude. `horizonDeg` is 0 (the geometric horizon) until
 * M6 passes horizonAltAtAzDeg(profile, az), which is itself 0 while the profile is null. A non-finite input is
 * never visible.
 */
export function isVisible(
  sunlit: boolean,
  sunAltDeg: number,
  group: GpGroup,
  apparentAltDeg: number,
  horizonDeg: number,
): boolean {
  return sunlit && sunAltDeg <= SUN_CUTOFF_DEG[group] && apparentAltDeg > horizonDeg;
}
