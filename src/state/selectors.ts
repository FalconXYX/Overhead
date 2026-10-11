// src/state/selectors.ts — every selector returns a primitive or an existing reference. [Mn] = the milestone of its first user.
// Each selector in README section 4 lands with its first user.
import type { GroupMask } from "../domain/orbits";
import { sampleStepMs, trueColorDateUtc } from "../domain/time";
import type { AppState, Calibration, CameraConfig, CameraSite, GpGroup, LoadStatus } from "./types";

/** [M1] */
export const selectActiveCamera = (s: AppState): CameraConfig | undefined =>
  s.camera.registry[s.camera.activeId];

/** [M1] */
export const selectSite = (s: AppState): CameraSite | null =>
  s.camera.registry[s.camera.activeId]?.site ?? null;

/** [M2] The active camera's stored calibration, else its registry defaults (the object itself). */
export const selectCalibration = (s: AppState): Calibration | undefined =>
  s.camera.calibration[s.camera.activeId] ?? s.camera.registry[s.camera.activeId]?.defaults;

/** [M3] Propagation grid spacing D = 100 ms × rate (rate 1 in live mode). */
export const selectSampleStepMs = (s: AppState): number =>
  sampleStepMs(s.clock.mode === "live" ? 1 : s.clock.rate);

/** [M3] Groups the worker propagates: stations and visual always, Starlink while its toggle is on. */
export const selectGroupMask = (s: AppState): GroupMask => 0b011 | (s.layers.starlink ? 0b100 : 0);

/**
 * [M1] VIIRS true-colour date "YYYY-MM-DD" for the active site, from the sim time capped at the real clock: a pass the
 * real clock has not reached has no imagery, and GIBS answers its date with 200 black tiles that the tile-error revert
 * cannot catch. Reads Date.now() but returns a primitive; the cap moves on the next state change (every frame in live).
 */
export const selectTrueColorDate = (s: AppState): string | null => {
  const site = selectSite(s);
  return site === null
    ? null
    : trueColorDateUtc(Math.min(s.clock.simTimeMs, Date.now()), site.lonDeg);
};

/** [M2] V ≤ 4 while calibrating; else the layer setting. [M5] adds V ≤ VIDEO_STAR_MAG_LIMIT over a video. */
export const selectStarMagLimit = (s: AppState): number => {
  if (s.ui.panel === "calibration") return Math.min(4, s.layers.starMagLimit);
  return s.layers.starMagLimit;
};

/** [M3] */
export const selectGroupStatus =
  (group: GpGroup) =>
  (s: AppState): LoadStatus =>
    s.data.gp[group].status;
