// src/domain/camera/index.ts — lens models, sky ↔ pixel, calibration fit, footprint, GeoPose.
// LensModel and Calibration land in M0, everything else from M2.
// Pixels: u right, v down, continuous, image corners at (0, 0) and (W, H), so the centre is W/2 (not (W − 1)/2).
// Unit-focal coordinates: x right, y up, before × focalPx.

export type LensModel =
  | "rectilinear"
  | "fisheye-equidistant"
  | "fisheye-equisolid"
  | "fisheye-stereographic"
  | "fisheye-orthographic";

export interface Calibration {
  azDeg: number; // optical axis azimuth; 0 on a zenith-locked fisheye (normalizeCalibration folds it into roll)
  altDeg: number; // optical axis altitude; 90 on a zenith fisheye
  rollDeg: number; // ρ in x' = x cos ρ − y sin ρ
  focalPx: number; // UI shows HFOV derived from it
  cxPx: number; // principal point
  cyPx: number;
  k1: number; // radial distortion, all lens models: s = 1 + k1 r² + k2 r⁴, r in unit-focal coordinates
  k2: number; // constrained: 1 + 3 k1 r² + 5 k2 r⁴ ≥ MIN_DISTORTION_SLOPE for r ≤ rMaxUnit (see CameraModel)
  flipX: boolean; // mirrored all-sky images
  streamDelayMs: number; // the only copy; read via selectStreamDelayMs
  rmsDeg: number | null; // quality of the last fit
  updatedAtMs: number;
}
