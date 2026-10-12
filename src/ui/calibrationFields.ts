// src/ui/calibrationFields.ts — the Calibration panel's pointing and lens fields (M4 step 14.2), its image-time
// texts (step 14.3) and the arrow-key nudges of step 15.2: ranges, steps, units, display formats, the k1 floor and
// the HFOV link. Pure functions, kept out of the component file so it stays a React Fast Refresh boundary (as
// gibsStatus.ts and objectText.ts).
import { burnedInOffsetMs } from "../app/stillImage";
import {
  type Calibration,
  createCameraModel,
  distortionValid,
  focalPxForHfov,
  hfovDeg,
  type LensModel,
} from "../domain/camera";
import { formatZonedDateTime } from "../domain/time";
import type { StillImageCamera } from "../state/types";

export type CalibrationFieldKey =
  | "azDeg"
  | "altDeg"
  | "rollDeg"
  | "focalPx"
  | "cxPx"
  | "cyPx"
  | "k1";

export interface FieldSpec {
  readonly key: CalibrationFieldKey;
  readonly label: string; // visible label, unit included: "Azimuth (°)"
  readonly unitWords: string; // aria-valuetext unit: "degrees", "pixels", or "" for k1
  readonly min: number; // on the step grid, so the range input's values stay on it
  readonly max: number;
  readonly step: number;
  readonly decimals: number; // digits shown, from the step
  readonly wraps: boolean; // any finite typed value is accepted; normalizeCalibration wraps it
  readonly disabled: boolean;
}

export interface FieldContext {
  readonly lens: LensModel;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly defaultFocalPx: number; // registry defaults.focalPx: the focal range is 0.5–2 × this
  readonly zenithLocked: boolean;
  readonly k1Floor: number; // k1FloorFor(...) for the current f, cx, cy and k2
}

/** Upper end of the k1 field (M4 step 14.2). */
export const K1_MAX = 0.5;
/** "40-step bisection" for the k1 floor (M4 step 14.2). */
export const K1_BISECTION_STEPS = 40;
/** Keyboard nudge while the Calibration panel is open, and with Shift (M4 step 15.2). */
export const NUDGE_DEG = 0.05;
export const NUDGE_SHIFT_DEG = 0.5;

const DEG_STEP = 0.01;
const PX_STEP = 0.1;
const K1_STEP = 0.0001;

export const isFisheyeLens = (lens: LensModel): boolean => lens !== "rectilinear";

/** Lowest altitude the panel offers: −10° on a rectilinear camera, 0° on a fisheye (M4 step 14.2). */
export const altMinDeg = (lens: LensModel): number => (isFisheyeLens(lens) ? 0 : -10);

/** Digits after the point for a step of 10^-n. */
function decimalsFor(step: number): number {
  return Math.max(0, Math.round(-Math.log10(step)));
}

/** x rounded onto the step grid, upwards (down = false) or downwards, without binary fuzz (0.1 × 1866 = 186.6). */
function onGrid(x: number, step: number, up: boolean): number {
  const n = x / step;
  const k = up ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return Number((k * step).toFixed(decimalsFor(step)));
}

/**
 * The smallest k1 for which the camera model passes distortionValid with this f, cx, cy and k2 (the pointing does not
 * enter rMaxUnit): a 40-step bisection between a valid upper end (K1_MAX) and an invalid lower end found by doubling
 * from −1. Validity is monotone in k1: a larger k1 raises g′ at every radius and shrinks rMaxUnit. NaN when even
 * K1_MAX is invalid.
 */
export function k1FloorFor(
  lens: LensModel,
  widthPx: number,
  heightPx: number,
  frame: Pick<Calibration, "focalPx" | "cxPx" | "cyPx" | "k2">,
): number {
  const valid = (k1: number): boolean => {
    const calibration: Calibration = {
      azDeg: 0,
      altDeg: 0,
      rollDeg: 0,
      flipX: false,
      streamDelayMs: 0,
      rmsDeg: null,
      updatedAtMs: 0,
      ...frame,
      k1,
    };
    const model = createCameraModel({ lens, calibration, widthPx, heightPx });
    return distortionValid(k1, frame.k2, model.rMaxUnit);
  };
  let hi = K1_MAX;
  if (!valid(hi)) return Number.NaN;
  let lo = -1;
  while (valid(lo)) {
    hi = lo;
    lo *= 2;
    if (lo < -1e9) return lo; // a degenerate frame (no field at all): no practical floor
  }
  for (let i = 0; i < K1_BISECTION_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (valid(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The focal-length field's range: 0.5–2 × the registry default, on the 0.1 px grid. */
export function focalRangePx(defaultFocalPx: number): readonly [min: number, max: number] {
  return [onGrid(0.5 * defaultFocalPx, PX_STEP, true), onGrid(2 * defaultFocalPx, PX_STEP, false)];
}

/** The seven fields of M4 step 14.2, in panel order. */
export function calibrationFields(ctx: FieldContext): FieldSpec[] {
  const [fMin, fMax] = focalRangePx(ctx.defaultFocalPx);
  const k1Min = Number.isFinite(ctx.k1Floor) ? onGrid(ctx.k1Floor, K1_STEP, true) : K1_MAX;
  const deg = { unitWords: "degrees", step: DEG_STEP, decimals: decimalsFor(DEG_STEP) } as const;
  const px = { unitWords: "pixels", step: PX_STEP, decimals: decimalsFor(PX_STEP) } as const;
  return [
    {
      key: "azDeg",
      label: "Azimuth (°)",
      ...deg,
      min: 0,
      max: 360,
      wraps: true,
      disabled: ctx.zenithLocked,
    },
    {
      key: "altDeg",
      label: "Altitude (°)",
      ...deg,
      min: altMinDeg(ctx.lens),
      max: 90,
      wraps: false,
      disabled: false,
    },
    {
      key: "rollDeg",
      label: "Roll (°)",
      ...deg,
      min: -180,
      max: 180,
      wraps: true,
      disabled: false,
    },
    {
      key: "focalPx",
      label: "Focal length (px)",
      ...px,
      min: fMin,
      max: fMax,
      wraps: false,
      disabled: false,
    },
    {
      key: "cxPx",
      label: "Principal point x (px)",
      ...px,
      min: 0,
      max: ctx.widthPx,
      wraps: false,
      disabled: false,
    },
    {
      key: "cyPx",
      label: "Principal point y (px)",
      ...px,
      min: 0,
      max: ctx.heightPx,
      wraps: false,
      disabled: false,
    },
    {
      key: "k1",
      label: "Radial distortion k1 (no unit)",
      unitWords: "",
      step: K1_STEP,
      decimals: decimalsFor(K1_STEP),
      min: k1Min,
      max: K1_MAX,
      wraps: false,
      disabled: false,
    },
  ];
}

/** The updateCalibration patch that sets one field. */
export function fieldPatch(
  key: CalibrationFieldKey,
  value: number,
): Partial<Pick<Calibration, CalibrationFieldKey>> {
  const patch: Partial<Pick<Calibration, CalibrationFieldKey>> = {};
  patch[key] = value;
  return patch;
}

/** toFixed without "-0.00": the text of a number input, so it keeps an ASCII minus. */
export function fieldText(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** aria-valuetext of a range input: "227.30 degrees", "373.1 pixels", "0.0030". */
export function fieldValueText(
  value: number,
  spec: Pick<FieldSpec, "decimals" | "unitWords">,
): string {
  const text = fieldText(value, spec.decimals);
  return spec.unitWords === "" ? text : `${text} ${spec.unitWords}`;
}

/**
 * A typed value to commit, or null while it is not one yet: empty or partial text, non-finite, or outside the range
 * of a field that does not wrap (typing "37" on the way to "373.1" commits nothing).
 */
export function parseFieldInput(
  text: string,
  spec: Pick<FieldSpec, "min" | "max" | "wraps">,
): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (spec.wraps) return value;
  const tol = 1e-9 * Math.max(1, Math.abs(spec.min), Math.abs(spec.max));
  return value >= spec.min - tol && value <= spec.max + tol ? value : null;
}

// ---- Field across the width (HFOV), beside the focal length ----

/** "Field across the width": an all-sky lens can exceed 180° (Nānā ao at f 373.1 gives 189.2°, M4 step 2.2). */
export const HFOV_LABEL = "Field across the width (°)";

/** The HFOV readout of a focal length; k1, k2 and the principal point do not enter it. */
export const hfovOf = (lens: LensModel, widthPx: number, focalPx: number): number =>
  hfovDeg(lens, widthPx, focalPx);

/**
 * The HFOV input's range: the HFOVs of the focal-length range's ends (a longer focal length is a narrower field),
 * capped at 360°, beyond which no equidistant focal length exists (focalPxForHfov gives NaN).
 */
export function hfovRangeDeg(
  lens: LensModel,
  widthPx: number,
  defaultFocalPx: number,
): readonly [min: number, max: number] {
  const [fMin, fMax] = focalRangePx(defaultFocalPx);
  return [
    onGrid(hfovDeg(lens, widthPx, fMax), DEG_STEP, true),
    Math.min(360, onGrid(hfovDeg(lens, widthPx, fMin), DEG_STEP, false)),
  ];
}

/** The focal length for a typed HFOV, or null when it has none or it falls outside the focal-length range. */
export function focalForHfovInput(
  lens: LensModel,
  widthPx: number,
  hfov: number,
  defaultFocalPx: number,
): number | null {
  const [fMin, fMax] = focalRangePx(defaultFocalPx);
  const f = focalPxForHfov(lens, widthPx, hfov);
  return Number.isFinite(f) && f >= fMin - 1e-9 && f <= fMax + 1e-9 ? f : null;
}

// ---- Image time (M4 steps 7 and 14.3) ----

/** How a burned-in stamp becomes the image time, under the "Enter burned-in time" input. */
export function stampRuleText(camera: Pick<StillImageCamera, "site" | "source">): string {
  const offsetSec = burnedInOffsetMs(camera.source) / 1000;
  return camera.source.exposureSec > 0
    ? `Type the stamp in ${camera.site.timeZone} time. It marks the start of the exposure; the image time is the stamp + ${offsetSec} s, mid-exposure.`
    : `Type the stamp in ${camera.site.timeZone} time. It is to the minute; the image time is the stamp + ${offsetSec} s.`;
}

/** "2026-10-11T06:04:01": an instant in a zone as the value of an <input type="datetime-local" step="1">. */
export function zonedInputValue(timeMs: number, timeZone: string): string {
  return formatZonedDateTime(timeMs, timeZone).replace(" ", "T");
}

/**
 * The "Enter burned-in time" prefill: the stamp that the frame time implies (frame time − the stamp offset), to the
 * minute when the camera stamps to the minute. Submitting it unchanged therefore keeps an entered frame time instead
 * of adding the offset again.
 */
export function impliedStampValue(
  camera: Pick<StillImageCamera, "site" | "source">,
  frameTimeMs: number,
): string {
  const value = zonedInputValue(
    frameTimeMs - burnedInOffsetMs(camera.source),
    camera.site.timeZone,
  );
  return camera.source.exposureSec > 0 ? value : `${value.slice(0, 16)}:00`;
}

// ---- Keyboard nudges (M4 step 15.2; README Keyboard) ----

/** Rounds away the binary fuzz of repeated 0.05° steps (227.3 + 0.05 is 227.35000000000002). */
const nudged = (deg: number): number => Math.round(deg * 1e6) / 1e6;

/**
 * The updateCalibration patch for an arrow key while the Calibration panel is open, or null for any other key.
 * ← / → change azDeg by −/+ 0.05°, or rollDeg on a zenith-locked fisheye; ↑ / ↓ change altDeg by ± 0.05°; Shift
 * makes it 0.5°. Altitude stays in the panel's range (90 at most, so ↑ on a locked fisheye stays locked; ↓ unlocks
 * it, and normalizeCalibration keeps that continuous).
 */
export function calibrationNudge(
  lens: LensModel,
  calibration: Calibration,
  key: string,
  shiftKey: boolean,
): Partial<Pick<Calibration, "azDeg" | "altDeg" | "rollDeg">> | null {
  const step = shiftKey ? NUDGE_SHIFT_DEG : NUDGE_DEG;
  const locked = isFisheyeLens(lens) && calibration.altDeg === 90;
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight": {
      const delta = key === "ArrowLeft" ? -step : step;
      return locked
        ? { rollDeg: nudged(calibration.rollDeg + delta) }
        : { azDeg: nudged(calibration.azDeg + delta) };
    }
    case "ArrowUp":
    case "ArrowDown": {
      const delta = key === "ArrowDown" ? -step : step;
      const altDeg = Math.min(90, Math.max(altMinDeg(lens), nudged(calibration.altDeg + delta)));
      return { altDeg };
    }
    default:
      return null;
  }
}
