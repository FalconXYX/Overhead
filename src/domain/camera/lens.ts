// src/domain/camera/lens.ts — lens models, calibration and the precomputed camera model.
// M2: the zenith equidistant fisheye. M4: all five lenses in closed form around any optical axis (A₀, h₀),
// tilted all-sky cameras included, the distortion limits, the HFOV helpers and normalizeCalibration.
// Degrees at every API, radians inside. Unit-focal coordinates: x right, y up, before × focalPx.

import { wrap180, wrap360 } from "../geo";

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
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** [M4] Smallest g′ that distortionValid accepts: at 0.05 the inverse Newton converges in ≤ 8 iterations for every lens. */
export const MIN_DISTORTION_SLOPE = 0.05;

/** Newton iteration cap of undistortRadius (DECISIONS "Camera model": ≤ 10 iterations). */
export const UNDISTORT_MAX_ITERATIONS = 10;
/** Newton stops when |step| drops below this, in unit-focal radius. */
const UNDISTORT_STEP_TOLERANCE = 1e-9;
/** The frame cull: a point whose undistorted radius exceeds FRAME_CULL_FACTOR·rMaxUnit is not projected. */
const FRAME_CULL_FACTOR = 1.05;

/** true for every lens but rectilinear. */
export function isFisheye(lens: LensModel): boolean {
  return lens !== "rectilinear";
}

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

/** [M4] ρ(θ): the undistorted unit-focal radius at angle θ (radians) from the optical axis. */
export function lensRadiusUnit(lens: LensModel, thetaRad: number): number {
  switch (lens) {
    case "rectilinear":
      return Math.tan(thetaRad);
    case "fisheye-equidistant":
      return thetaRad;
    case "fisheye-equisolid":
      return 2 * Math.sin(thetaRad / 2);
    case "fisheye-stereographic":
      return 2 * Math.tan(thetaRad / 2);
    case "fisheye-orthographic":
      return Math.sin(thetaRad);
  }
}

/** [M4] θ(ρ): the angle (radians) from the optical axis at undistorted unit-focal radius ρ ≥ 0. */
export function lensAngleRad(lens: LensModel, radiusUnit: number): number {
  switch (lens) {
    case "rectilinear":
      return Math.atan(radiusUnit);
    case "fisheye-equidistant":
      return radiusUnit;
    case "fisheye-equisolid":
      return 2 * Math.asin(Math.min(radiusUnit / 2, 1)); // caps the field at 360°
    case "fisheye-stereographic":
      return 2 * Math.atan(radiusUnit / 2);
    case "fisheye-orthographic":
      return Math.asin(Math.min(radiusUnit, 1)); // caps the field at 180°
  }
}

/** Largest half-field (radians) for which ρ(θ) is increasing and finite; `open` when the limit itself is excluded. */
function halfFieldLimit(lens: LensModel): { readonly rad: number; readonly open: boolean } {
  switch (lens) {
    case "rectilinear":
      return { rad: HALF_PI, open: true }; // tan θ → ∞
    case "fisheye-orthographic":
      return { rad: HALF_PI, open: false };
    case "fisheye-stereographic":
      return { rad: Math.PI, open: true }; // 2 tan(θ/2) → ∞
    case "fisheye-equidistant":
    case "fisheye-equisolid":
      return { rad: Math.PI, open: false };
  }
}

/** [M4] HFOV = 2·θ(W/(2f)) with θ = atan r | r | 2 asin(r/2) | 2 atan(r/2) | asin r (k1 = k2 = 0, cx = W/2). */
export function hfovDeg(lens: LensModel, widthPx: number, focalPx: number): number {
  return 2 * lensAngleRad(lens, widthPx / (2 * focalPx)) * R2D;
}

/**
 * [M4] (W/2)/ρ(HFOV/2): the inverse of hfovDeg. NaN unless 0 < HFOV and the half-field is inside the lens's
 * range: below 180° rectilinear, ≤ 180° orthographic, below 360° stereographic, ≤ 360° equidistant and equisolid.
 */
export function focalPxForHfov(lens: LensModel, widthPx: number, hfovDeg: number): number {
  const half = (hfovDeg / 2) * D2R;
  const limit = halfFieldLimit(lens);
  if (!(half > 0) || half > limit.rad || (limit.open && half === limit.rad)) return Number.NaN;
  return widthPx / 2 / lensRadiusUnit(lens, half);
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

/**
 * Newton solve of g(r) = r(1 + k1 r² + k2 r⁴) = rd from r = rd, at most maxIterations steps:
 * r ← r − (g(r) − rd)/g′(r), done when |step| < 1e-9. null when an input is non-finite or rd < 0, g′ ≤ 0 at an
 * iterate, r < 0, or no convergence within maxIterations. undistortRadius (inverse.ts) passes 10; tests pass
 * fewer to count iterations.
 */
export function solveUndistortedRadius(
  rd: number,
  k1: number,
  k2: number,
  maxIterations: number,
): number | null {
  if (!(rd >= 0) || !Number.isFinite(rd) || !Number.isFinite(k1) || !Number.isFinite(k2))
    return null;
  let r = rd;
  for (let i = 0; i < maxIterations; i++) {
    const r2 = r * r;
    const slope = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2;
    if (!(slope > 0)) return null;
    const step = (r * (1 + k1 * r2 + k2 * r2 * r2) - rd) / slope;
    r -= step;
    if (r < 0) return null;
    if (Math.abs(step) < UNDISTORT_STEP_TOLERANCE) return r;
  }
  return null;
}

/**
 * [M4] true when g′(r) = 1 + 3k1r² + 5k2r⁴ ≥ MIN_DISTORTION_SLOPE for all r in [0, rMaxUnit]; false for non-finite
 * input. g′ is a quadratic in s = r², so it is checked at s = rMax² and, for k2 > 0, at the vertex
 * s* = −3k1/(10k2) when 0 < s* < rMax² (g′(0) = 1 always passes).
 */
export function distortionValid(k1: number, k2: number, rMaxUnit: number): boolean {
  if (!Number.isFinite(k1) || !Number.isFinite(k2) || !Number.isFinite(rMaxUnit)) return false;
  const sMax = rMaxUnit * rMaxUnit;
  if (!(1 + 3 * k1 * sMax + 5 * k2 * sMax * sMax >= MIN_DISTORTION_SLOPE)) return false;
  if (k2 > 0) {
    const sVertex = (-3 * k1) / (10 * k2);
    if (sVertex > 0 && sVertex < sMax) {
      return 1 + 3 * k1 * sVertex + 5 * k2 * sVertex * sVertex >= MIN_DISTORTION_SLOPE;
    }
  }
  return true;
}

/**
 * [M4] Runs on every calibration write: clamps altDeg to [−90, 90]; a fisheye at altDeg 90 gets
 * rollDeg = wrap180(rollDeg − azDeg) and azDeg = 0; otherwise azDeg = wrap360(azDeg), rollDeg = wrap180(rollDeg).
 * Why: (A₀, 90, ρ) is the same rotation as (0, 90, ρ − A₀), and a stale azimuth would turn the image by A₀ the
 * moment a ↓ nudge unlocks it.
 */
export function normalizeCalibration(lens: LensModel, c: Calibration): Calibration {
  const altDeg = Math.min(90, Math.max(-90, c.altDeg));
  if (isFisheye(lens) && altDeg === 90) {
    return { ...c, azDeg: 0, altDeg, rollDeg: wrap180(c.rollDeg - c.azDeg) };
  }
  return { ...c, azDeg: wrap360(c.azDeg), altDeg, rollDeg: wrap180(c.rollDeg) };
}

/**
 * [M2, M4] The precomputed model. A fisheye at altDeg 90 is zenith-locked: its axis is A₀ = 0, h₀ = 90 whatever
 * azDeg holds. rMaxUnit: r_dc = the largest corner radius hypot(u − cx, v − cy)/f, r_uc = undistortRadius(r_dc);
 * rectilinear r_uc (NaN when it is null, which fails distortionValid and culls every point); fisheye
 * min(horizonRadiusUnit, r_uc ?? ∞), since a circular fisheye's corners lie outside its image circle.
 */
export function createCameraModel(input: CameraModelInput): CameraModel {
  const { lens, calibration: c, widthPx, heightPx } = input;
  let rCorner = 0;
  for (const u of [0, widthPx]) {
    for (const v of [0, heightPx]) {
      rCorner = Math.max(rCorner, Math.hypot(u - c.cxPx, v - c.cyPx) / c.focalPx);
    }
  }
  const rUndistorted = solveUndistortedRadius(rCorner, c.k1, c.k2, UNDISTORT_MAX_ITERATIONS);
  const fisheye = isFisheye(lens);
  return {
    lens,
    calibration: c,
    widthPx,
    heightPx,
    zenithLocked: fisheye && c.altDeg === 90,
    thetaMaxRad: HALF_PI,
    rMaxUnit: fisheye
      ? Math.min(horizonRadiusUnit(lens), rUndistorted ?? Number.POSITIVE_INFINITY)
      : (rUndistorted ?? Number.NaN),
  };
}

/**
 * Internal: the per-model trig that projectAzAltDeg, projectBatch and unprojectPixel share. The axis (A₀, h₀) in
 * ENU: F = (cos h₀ sin A₀, cos h₀ cos A₀, sin h₀), image-right R̂ = (cos A₀, −sin A₀, 0),
 * image-up Û = (−sin h₀ sin A₀, −sin h₀ cos A₀, cos h₀), before roll.
 */
export interface ModelGeometry {
  readonly fisheye: boolean;
  readonly axisAzDeg: number; // A₀: 0 when zenith-locked, else the calibration's azDeg
  readonly sinAxisAz: number;
  readonly cosAxisAz: number;
  readonly sinAxisAlt: number;
  readonly cosAxisAlt: number;
  readonly sinRoll: number;
  readonly cosRoll: number;
  readonly sx: number; // −1 with flipX, else 1
  readonly cullRadius2: number; // (1.05·rMaxUnit)²; NaN culls every point
  /** [M9] h₀ in degrees: 90 when zenith-locked, else the calibration's altDeg. */
  readonly axisAltDeg: number;
  /**
   * [M9] A direction with |alt − h₀| above this (degrees) is surely culled by the angle test (c ≥ |h − h₀| while
   * |h|, |h₀| ≤ 90°), so projectAzAltDeg can skip its trigonometry. The 1e-6° margin keeps every result identical
   * to the full test. Infinity when h₀ is outside [−90°, 90°], where the bound does not hold.
   */
  readonly preCullDeg: number;
}

const geometryCache = new WeakMap<CameraModel, ModelGeometry>();

/** sin and cos of an angle in degrees, exact at multiples of 90° (gotcha G1: Math.cos(π/2) is 6.1e-17, not 0). */
function sinCosDeg(deg: number): [number, number] {
  switch (wrap360(deg)) {
    case 0:
      return [0, 1];
    case 90:
      return [1, 0];
    case 180:
      return [0, -1];
    case 270:
      return [-1, 0];
    default:
      return [Math.sin(deg * D2R), Math.cos(deg * D2R)];
  }
}

/** Internal: the model's geometry, computed on first use per model object (so a spread copy never goes stale). */
export function modelGeometry(model: CameraModel): ModelGeometry {
  const cached = geometryCache.get(model);
  if (cached !== undefined) return cached;
  const c = model.calibration;
  const axisAzDeg = model.zenithLocked ? 0 : c.azDeg;
  const [sinAxisAz, cosAxisAz] = sinCosDeg(axisAzDeg);
  const axisAltDeg = model.zenithLocked ? 90 : c.altDeg;
  const [sinAxisAlt, cosAxisAlt] = sinCosDeg(axisAltDeg);
  const fisheye = isFisheye(model.lens);
  // Fisheyes cull beyond thetaMaxRad from the axis, rectilinear lenses at 90° (cos c ≤ 0).
  const cullAngleDeg = fisheye ? model.thetaMaxRad * R2D : 90;
  const [sinRoll, cosRoll] = sinCosDeg(c.rollDeg);
  const cullRadius = FRAME_CULL_FACTOR * model.rMaxUnit;
  const geometry: ModelGeometry = {
    fisheye,
    axisAzDeg,
    sinAxisAz,
    cosAxisAz,
    sinAxisAlt,
    cosAxisAlt,
    sinRoll,
    cosRoll,
    sx: c.flipX ? -1 : 1,
    cullRadius2: cullRadius * cullRadius,
    axisAltDeg,
    preCullDeg:
      axisAltDeg >= -90 && axisAltDeg <= 90 ? cullAngleDeg + 1e-6 : Number.POSITIVE_INFINITY,
  };
  geometryCache.set(model, geometry);
  return geometry;
}
