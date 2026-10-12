// src/domain/camera/index.ts — lens models, sky ↔ pixel, calibration fit, footprint, GeoPose.
// LensModel and Calibration land in M0, everything else from M2. Other modules import only this file.
// Pixels: u right, v down, continuous, image corners at (0, 0) and (W, H), so the centre is W/2 (not (W − 1)/2).
// Unit-focal coordinates: x right, y up, before × focalPx.

// [M4] Frame azimuth coverage (coverage.ts): the site wedge.
export { type AzimuthCoverage, frameAzimuthCoverage } from "./coverage";
export type {
  AcceptancePair,
  AcceptanceReport,
  FitOptions,
  FitPair,
  FitResult,
  SatelliteCheckSample,
  SatelliteCheckSummary,
} from "./fit";
export { calibrationAcceptance, fitCalibration, satelliteCheckSummary } from "./fit";
// [M8] Orbit-height footprint (footprint.ts).
export {
  FOOTPRINT_CLIP_EPS_DEG,
  FOOTPRINT_FALLBACK_HEIGHT_KM,
  FOOTPRINT_PRESETS_KM,
  FOOTPRINT_SAMPLES_PER_EDGE,
  footprintLonLatDeg,
  footprintMaxPairs,
} from "./footprint";
// geopose.ts loads ajv and compiles it on the first validateGeoPose call (gotcha G9; [M9] a dynamic import).
export type { GeoPoseBasicYpr, GeoPoseValidation } from "./geopose";
export { fromGeoPose, geoPoseRotation, toGeoPose, validateGeoPose } from "./geopose";
export { undistortRadius, unprojectPixel } from "./inverse";
export type { Calibration, CameraModel, CameraModelInput, LensModel } from "./lens";
export {
  createCameraModel,
  distortionValid,
  focalPxForHfov,
  hfovDeg,
  horizonRadiusUnit,
  MIN_DISTORTION_SLOPE,
  normalizeCalibration,
  syntheticFisheyeCalibration,
} from "./lens";
export { projectAzAltDeg, projectBatch, toSkyMapCoord } from "./project";
