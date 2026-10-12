// src/state/calibrationWrite.ts — the one gate every calibration write passes (M4 step 8): updateCalibration,
// importCalibration and applyFit in actions.ts, and the stored and imported files in src/app/persist.ts.
import {
  type Calibration,
  createCameraModel,
  distortionValid,
  normalizeCalibration,
} from "../domain/camera";
import type { AppState, CalibrationUiState, CameraConfig, StateData } from "./types";

/** The numeric fields of Calibration; each must be a finite number. */
export const CALIBRATION_NUMBER_FIELDS = [
  "azDeg",
  "altDeg",
  "rollDeg",
  "focalPx",
  "cxPx",
  "cyPx",
  "k1",
  "k2",
  "streamDelayMs",
  "updatedAtMs",
] as const satisfies readonly (keyof Calibration)[];

/** true when the distortion of `c` is valid for the camera's lens and frame: distortionValid on its model's rMaxUnit. */
export function calibrationDistortionValid(
  camera: Pick<CameraConfig, "lens" | "imageSize">,
  c: Calibration,
): boolean {
  const model = createCameraModel({
    lens: camera.lens,
    calibration: c,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
  });
  return distortionValid(c.k1, c.k2, model.rMaxUnit);
}

/**
 * The calibration a write stores for `camera`: normalizeCalibration(lens, c), or null (the write is refused and the
 * state stays as it was) when the camera is unknown, a number field is not finite, focalPx ≤ 0, flipX is not a
 * boolean, rmsDeg is neither null nor finite, or distortionValid fails for the camera's model.
 */
export function acceptCalibration(
  camera: Pick<CameraConfig, "lens" | "imageSize"> | undefined,
  c: Calibration,
): Calibration | null {
  if (camera === undefined) return null;
  for (const key of CALIBRATION_NUMBER_FIELDS) {
    if (!Number.isFinite(c[key])) return null;
  }
  if (!(c.focalPx > 0) || typeof c.flipX !== "boolean") return null;
  if (c.rmsDeg !== null && !Number.isFinite(c.rmsDeg)) return null;
  const normalized = normalizeCalibration(camera.lens, c);
  return calibrationDistortionValid(camera, normalized) ? normalized : null;
}

/** Pairs, pending point and fit of a fresh frame: setActiveCamera and clearPairs. */
export function emptyCalibrationUi(): CalibrationUiState {
  return { pairs: [], pendingPx: null, fit: null };
}

/**
 * The state patch that stores `c` as camera `id`'s calibration (through acceptCalibration), or null when the write
 * is refused. updateCalibration and applyFit stamp updatedAtMs before calling it; importCalibration keeps the file's.
 */
export function calibrationPatch(
  s: AppState,
  id: string,
  c: Calibration,
): Pick<StateData, "camera"> | null {
  const next = acceptCalibration(s.camera.registry[id], c);
  if (next === null) return null;
  return { camera: { ...s.camera, calibration: { ...s.camera.calibration, [id]: next } } };
}

/**
 * applyFit's patch: the fitted calibration for the active camera, stamped with nowMs, and each pair's residualPx and
 * rejected flag (aligned by index; a missing entry gives null and false) plus the fit summary. null when the
 * calibration is refused: then neither the calibration nor the pairs change.
 */
export function appliedFitPatch(
  s: AppState,
  calibration: Calibration,
  residualPx: readonly number[],
  rejected: readonly boolean[],
  fit: NonNullable<CalibrationUiState["fit"]>,
  nowMs: number,
): Pick<StateData, "camera" | "calibrationUi"> | null {
  const stored = calibrationPatch(s, s.camera.activeId, { ...calibration, updatedAtMs: nowMs });
  if (stored === null) return null;
  const pairs = s.calibrationUi.pairs.map((pair, i) => ({
    ...pair,
    residualPx: residualPx[i] ?? null,
    rejected: rejected[i] ?? false,
  }));
  return { ...stored, calibrationUi: { ...s.calibrationUi, pairs, fit } };
}
