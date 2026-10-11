// src/domain/camera/lens.ts — lens models, calibration and the precomputed camera model.
// M2: the zenith equidistant fisheye only (the synthetic sky). M4 adds every lens and tilt.

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

export interface CameraModelInput {
  readonly lens: LensModel;
  readonly calibration: Calibration;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Precomputed trig and limits. Rebuild on every calibration change (cheap); never per frame. */
export interface CameraModel extends CameraModelInput {
  readonly zenithLocked: boolean; // fisheye with altDeg = 90
  readonly thetaMaxRad: number; // cull angle from the optical axis: π/2 for fisheyes (a zenith fisheye culls alt < 0)
  readonly rMaxUnit: number; // undistorted corner radius in unit-focal coordinates, capped at the fisheye horizon radius
}

const HALF_PI = Math.PI / 2;

/** [M2] r/f at the horizon for a zenith fisheye: π/2, √2, 2, 1; Infinity for rectilinear. */
export function horizonRadiusUnit(lens: LensModel): number {
  switch (lens) {
    case "fisheye-equidistant":
      return HALF_PI; // r = θ
    case "fisheye-equisolid":
      return Math.SQRT2; // r = 2 sin(θ/2)
    case "fisheye-stereographic":
      return 2; // r = 2 tan(θ/2)
    case "fisheye-orthographic":
      return 1; // r = sin θ
    case "rectilinear":
      return Number.POSITIVE_INFINITY; // r = tan θ
  }
}

/** [M2] M2 synthetic sky: W = H = sizePx, altDeg 90, rollDeg 180, focalPx = (sizePx/2)/(π/2), k1 = k2 = 0. */
export function syntheticFisheyeCalibration(sizePx: number): Calibration {
  const centrePx = sizePx / 2; // continuous pixels: the centre is W/2, not (W − 1)/2
  return {
    azDeg: 0,
    altDeg: 90,
    rollDeg: 180, // north up, east left: the sky seen from below
    focalPx: centrePx / HALF_PI, // the horizon (θ = π/2) lands on the image edge
    cxPx: centrePx,
    cyPx: centrePx,
    k1: 0,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: null,
    updatedAtMs: 0,
  };
}

/** [M2] M2 supports only the zenith equidistant fisheye and throws for anything else; M4 adds every lens and tilt. */
export function createCameraModel(input: CameraModelInput): CameraModel {
  const { lens, calibration: c, widthPx, heightPx } = input;
  if (lens !== "fisheye-equidistant" || c.altDeg !== 90) {
    // A programmer error until M4: M2's registry enables only the synthetic camera.
    throw new Error(
      `createCameraModel: only a zenith fisheye-equidistant camera is supported until M4 (got ${lens} at altDeg ${c.altDeg})`,
    );
  }
  // Largest corner radius in unit-focal coordinates (no distortion before M4).
  let rCorner = 0;
  for (const u of [0, widthPx]) {
    for (const v of [0, heightPx]) {
      rCorner = Math.max(rCorner, Math.hypot(u - c.cxPx, v - c.cyPx) / c.focalPx);
    }
  }
  return {
    lens,
    calibration: c,
    widthPx,
    heightPx,
    zenithLocked: true,
    thetaMaxRad: HALF_PI,
    rMaxUnit: Math.min(rCorner, horizonRadiusUnit(lens)),
  };
}
