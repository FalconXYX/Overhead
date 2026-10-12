// src/app/stillImage.ts — the rules of still-image cameras (M4 steps 7, 10, 13 and 16) as pure functions:
// capture time (estimated and from a burned-in clock), status after a failed load, the image-size notice, the
// exposure-arc grid and the status text. bindBackground, the Calibration panel, the CameraPicker and the arc
// sender call them; the refresh loop itself is src/map/sky/layers/background.ts.
import { astroTimeAt, makeObserver, sunGeometricAltDeg } from "../domain/astro";
import { isoUtcSeconds, localDateTimeToUtcMs } from "../domain/time";
import type { CameraSite, CameraStatus, StillImageCamera } from "../state/types";

/** A burned-in stamp to the minute (Nānā ao) stands for the middle of that minute: stamp + 30 s. */
export const MINUTE_STAMP_OFFSET_MS = 30_000;
/** The uncertainty the UI states for an estimated frame time: "estimated (± 30 s)". */
export const ESTIMATED_FRAME_TIME_TEXT = "estimated (± 30 s)";
/** Exposure arcs (step 16): one sample every 5 s across the exposure. */
export const EXPOSURE_ARC_STEP_MS = 5_000;
/** Exposure arcs only for exposures longer than this; shorter ones draw dots. */
export const EXPOSURE_ARC_MIN_SEC = 1;

/** Until a time is entered: frameTimeMs = load time − captureLagMs (Nānā ao 40,000 ms). */
export function estimatedFrameTimeMs(loadedAtMs: number, captureLagMs: number): number {
  return loadedAtMs - captureLagMs;
}

/**
 * Offset from a burned-in stamp to the capture time (M4 step 7).
 * - `exposureSec` > 0 (ASK053: 60 s): the stamp, to the second, is the exposure start, so + `exposureSec` × 500 ms,
 *   mid-exposure.
 * - `exposureSec` 0 (Nānā ao, whose exposure CFHT does not publish): the stamp is to the minute, so + 30 s.
 */
export function burnedInOffsetMs(source: Pick<StillImageCamera["source"], "exposureSec">): number {
  return source.exposureSec > 0 ? source.exposureSec * 500 : MINUTE_STAMP_OFFSET_MS;
}

/**
 * The capture time of a frame from its burned-in clock, typed in ISO order ("YYYY-MM-DDTHH:MM[:SS]", the value of
 * `<input type="datetime-local" step="1">`) and read in `site.timeZone`, plus `burnedInOffsetMs`. null when
 * `localDateTimeToUtcMs` is null: malformed, an impossible date, or a wall time skipped by a DST change.
 * Nānā ao burns "YYYY-MM-DD HH:MM" in HST; ASK053 burns "DD-MM-YYYY HH:MM:SS" in Europe/Vaduz time (the UI asks
 * for ISO order).
 */
export function burnedInCaptureTimeMs(
  camera: Pick<StillImageCamera, "site" | "source">,
  localIso: string,
): number | null {
  const stampMs = localDateTimeToUtcMs(localIso, camera.site.timeZone);
  return stampMs === null ? null : stampMs + burnedInOffsetMs(camera.source);
}

/**
 * Status after a failed load (404 and network errors alike): "daytime" while the Sun's geometric altitude is above 0°,
 * else "offline". Nānā ao runs sunset to sunrise and answers 404 while its hatch is closed, even at night (G13).
 */
export function stillImageErrorStatus(
  sunAltDeg: number,
): Extract<CameraStatus, "daytime" | "offline"> {
  return sunAltDeg > 0 ? "daytime" : "offline";
}

/** stillImageErrorStatus at the site, by the wall clock (wallMs is Date.now() in the app). */
export function stillImageErrorStatusAt(
  site: Pick<CameraSite, "latDeg" | "lonDeg" | "heightM">,
  wallMs: number,
): Extract<CameraStatus, "daytime" | "offline"> {
  return stillImageErrorStatus(sunGeometricAltDeg(astroTimeAt(wallMs), makeObserver(site)));
}

/**
 * "Image is W × H px; the calibration assumes W′ × H′ px" when the loaded image's natural size differs from the
 * registry's imageSize; null when they match or the size is unknown (0). Shown in the sky view and the panel, never
 * logged as a console error.
 */
export function imageSizeNotice(
  naturalWidthPx: number,
  naturalHeightPx: number,
  imageSize: { readonly widthPx: number; readonly heightPx: number },
): string | null {
  if (!(naturalWidthPx > 0 && naturalHeightPx > 0)) return null;
  if (naturalWidthPx === imageSize.widthPx && naturalHeightPx === imageSize.heightPx) return null;
  return `Image is ${naturalWidthPx} × ${naturalHeightPx} px; the calibration assumes ${imageSize.widthPx} × ${imageSize.heightPx} px`;
}

/** "Image captured HH:MM:SS UTC", shown beside the overlay time in replay mode. */
export function imageCapturedText(frameTimeMs: number): string {
  return `Image captured ${isoUtcSeconds(frameTimeMs).slice(11, 19)} UTC`;
}

/** The `arc` message's time grid (step 16). */
export interface ExposureArcGrid {
  readonly startMs: number;
  readonly stepMs: number;
  readonly steps: number;
}

/**
 * startMs = frameTimeMs − exposureSec × 500, stepMs 5,000, steps = floor(exposureSec / 5) + 1 (13 for ASK053's 60 s);
 * null unless exposureSec > 1 and both inputs are finite.
 */
export function exposureArcGrid(frameTimeMs: number, exposureSec: number): ExposureArcGrid | null {
  if (!Number.isFinite(frameTimeMs) || !Number.isFinite(exposureSec)) return null;
  if (!(exposureSec > EXPOSURE_ARC_MIN_SEC)) return null;
  return {
    startMs: frameTimeMs - exposureSec * 500,
    stepMs: EXPOSURE_ARC_STEP_MS,
    steps: Math.floor((exposureSec * 1000) / EXPOSURE_ARC_STEP_MS) + 1,
  };
}

/** The CameraPicker's status words (shown with an icon or shape, never colour alone). */
export const CAMERA_STATUS_TEXT: Readonly<Record<CameraStatus, string>> = {
  live: "Live",
  offline: "Offline",
  daytime: "Daytime",
  unknown: "Not checked",
};
