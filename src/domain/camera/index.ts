// src/domain/camera/index.ts — lens models, sky ↔ pixel, calibration fit, footprint, GeoPose.
// LensModel and Calibration land in M0, everything else from M2. Other modules import only this file.
// Pixels: u right, v down, continuous, image corners at (0, 0) and (W, H), so the centre is W/2 (not (W − 1)/2).
// Unit-focal coordinates: x right, y up, before × focalPx.

export type { Calibration, CameraModel, CameraModelInput, LensModel } from "./lens";
export { createCameraModel, horizonRadiusUnit, syntheticFisheyeCalibration } from "./lens";
export { projectAzAltDeg, projectBatch, toSkyMapCoord } from "./project";
