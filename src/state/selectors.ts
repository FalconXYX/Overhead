// src/state/selectors.ts — every selector returns a primitive or an existing reference. [Mn] = the milestone of its first user.
// Each selector in README section 4 lands with its first user.
import type { GroupMask } from "../domain/orbits";
import {
  formatUtcHhMm,
  goesStepMs,
  isoDateUtc,
  sampleStepMs,
  trueColorDateUtc,
} from "../domain/time";
import {
  type AppState,
  type Calibration,
  type CameraConfig,
  type CameraSite,
  type GpGroup,
  type LayerToggle,
  type LoadStatus,
  VIDEO_STAR_MAG_LIMIT,
} from "./types";

/** [M1] */
export const selectActiveCamera = (s: AppState): CameraConfig | undefined =>
  s.camera.registry[s.camera.activeId];

/** [M1] */
export const selectSite = (s: AppState): CameraSite | null =>
  s.camera.registry[s.camera.activeId]?.site ?? null;

/** [M2] The active camera's stored calibration, else its registry defaults (the object itself). */
export const selectCalibration = (s: AppState): Calibration | undefined =>
  s.camera.calibration[s.camera.activeId] ?? s.camera.registry[s.camera.activeId]?.defaults;

/** [M5] */
export const selectStreamDelayMs = (s: AppState): number =>
  s.camera.calibration[s.camera.activeId]?.streamDelayMs ??
  s.camera.registry[s.camera.activeId]?.defaults.streamDelayMs ??
  0;

/** [M5] Live mode on a YouTube camera: rate locked to 1, any play/pause/scrub/step switches to replay. */
export const selectLiveLocked = (s: AppState): boolean =>
  s.clock.mode === "live" && s.camera.registry[s.camera.activeId]?.kind === "youtube";

/**
 * [Redesign] The active camera is live (a YouTube stream): the control bar shows "● LIVE" and the delay, with no play,
 * rate, step or scrubber, and offers "Watch the recorded ISS pass".
 */
export const selectIsLiveCamera = (s: AppState): boolean =>
  s.camera.registry[s.camera.activeId]?.kind === "youtube";

/** [Redesign] The active camera is a recorded clip: the video-player control bar, and "Watch live". */
export const selectIsClipCamera = (s: AppState): boolean =>
  s.camera.registry[s.camera.activeId]?.kind === "local-video";

/**
 * [Redesign] The active camera is a recorded clip whose video has not loaded (or never will): its time is not the
 * clip's yet (the clock still reads the page's opening time), so the incoming chip lists nothing and announces nothing.
 */
export const selectClipWaiting = (s: AppState): boolean => {
  const camera = s.camera.registry[s.camera.activeId];
  return camera?.kind === "local-video" && camera.source.videoUrl === null;
};

/**
 * [Redesign] The active recorded clip cannot be shown: it is not part of this build (camera status "offline"), or its
 * load or playback failed (video status "error"). The stage then says so in plain words and offers "Watch live" (as
 * ClipControls does), never a black box.
 */
export const selectClipUnavailable = (s: AppState): boolean =>
  selectIsClipCamera(s) &&
  (s.camera.status[s.camera.activeId] === "offline" || s.video.status === "error");

/** [M5] The sky map is drawn over a video: youtube and local-video cameras get the light overlay set. */
export const selectSkyOverVideo = (s: AppState): boolean => {
  const kind = s.camera.registry[s.camera.activeId]?.kind;
  return kind === "youtube" || kind === "local-video";
};

/** [M5] Sky-view visibility of a toggle; over a video, starlink and grid also need their layers.video gate. */
export const selectSkyLayerVisible =
  (key: LayerToggle) =>
  (s: AppState): boolean => {
    if (!s.layers[key]) return false;
    if (!selectSkyOverVideo(s)) return true;
    if (key === "starlink") return s.layers.video.starlink;
    if (key === "grid") return s.layers.video.grid;
    return true;
  };

/** [M5] Every label the full sky view draws; over a video only with layers.video.denseLabels. */
export const selectSkyDenseLabels = (s: AppState): boolean =>
  !selectSkyOverVideo(s) || s.layers.video.denseLabels;

/** [M3] Propagation grid spacing D = 100 ms × rate (rate 1 in live mode). */
export const selectSampleStepMs = (s: AppState): number =>
  sampleStepMs(s.clock.mode === "live" ? 1 : s.clock.rate);

/** [M3] Groups the worker propagates: stations and visual always, Starlink while its toggle is on. */
export const selectGroupMask = (s: AppState): GroupMask => 0b011 | (s.layers.starlink ? 0b100 : 0);

/** [M8] Incoming alerts cover only the groups whose layers are on. */
export const selectIncomingMask = (s: AppState): GroupMask =>
  (s.layers.satellites ? 0b011 : 0) | (s.layers.starlink ? 0b100 : 0);

/** [M8] Alerts pause while replay plays at 60× or 600× (the 60 s look-ahead lasts under a second). */
export const selectIncomingActive = (s: AppState): boolean =>
  selectIncomingMask(s) !== 0 &&
  !(s.clock.mode === "replay" && s.clock.playing && s.clock.rate >= 60);

/** [M6] The active camera's profile, or null (use the geometric horizon). */
export const selectHorizonProfileDeg = (s: AppState): Float32Array | null =>
  s.data.horizon[s.camera.activeId]?.profileDeg ?? null;

/** [M6] */
export const selectHorizonStatus = (s: AppState): LoadStatus =>
  s.data.horizon[s.camera.activeId]?.status ?? "idle";

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

/** [M2] V ≤ 4 while calibrating; [M5] else V ≤ VIDEO_STAR_MAG_LIMIT over a video; else the layer setting. */
export const selectStarMagLimit = (s: AppState): number => {
  if (s.ui.panel === "calibration") return Math.min(4, s.layers.starMagLimit);
  if (selectSkyOverVideo(s)) return Math.min(VIDEO_STAR_MAG_LIMIT, s.layers.starMagLimit);
  return s.layers.starMagLimit;
};

/** [M3] */
export const selectGroupStatus =
  (group: GpGroup) =>
  (s: AppState): LoadStatus =>
    s.data.gp[group].status;

/**
 * [M4] CameraPicker status of camera `id`: a synthetic camera is always "live"; another shows its stored status, or
 * "unknown" ("Not checked") until it has been active since load (only the active camera is polled).
 */
export const selectCameraStatus =
  (id: string) =>
  (s: AppState): AppState["camera"]["status"][string] =>
    s.camera.registry[id]?.kind === "synthetic" ? "live" : (s.camera.status[id] ?? "unknown");

/** [M7] GOES Time value in epoch ms; changes once per 10-minute step. */
export const selectGoesStepMs = (s: AppState): number | null =>
  goesStepMs(s.clock.simTimeMs, s.data.goes.intervals, s.data.goes.latestStepMs);

/** [M7] The GOES layer shows only when on, availability is loaded and a step exists. */
export const selectGoesVisible = (s: AppState): boolean =>
  s.layers.goesIr && s.data.goes.status === "ready" && selectGoesStepMs(s) !== null;

/**
 * [M7] The GOES caption (M7 step 3; the e2e and screen-reader text), null while the layer is off. The UTC date comes
 * first when the step falls on another date than the sim time: gaps can last many steps. Read it during a useTick4Hz
 * render, never through useAppState.
 */
export const selectGoesLabel = (s: AppState): string | null => {
  if (!s.layers.goesIr) return null;
  const { status, intervals } = s.data.goes;
  if (status === "idle" || status === "loading") return "Loading GOES-West availability…";
  if (status === "error") {
    // With intervals present, the error comes from the tile guard (bindGoesLayer).
    return intervals.length === 0
      ? "GOES-West availability failed to load"
      : "GOES-West tiles failed to load";
  }
  const stepMs = selectGoesStepMs(s);
  if (stepMs === null) return "No GOES-West imagery for this time (NASA GIBS keeps 90 days)";
  const date = isoDateUtc(stepMs);
  const time = formatUtcHhMm(stepMs);
  return date === isoDateUtc(s.clock.simTimeMs)
    ? `Imagery as of ${time} UTC`
    : `Imagery as of ${date} ${time} UTC`;
};

/**
 * [M4] The active calibration is a zenith-locked fisheye (altDeg exactly 90), as createCameraModel decides: the
 * azimuth control is disabled and ← / → nudge roll instead.
 */
export const selectZenithLocked = (s: AppState): boolean => {
  const camera = selectActiveCamera(s);
  return (
    camera !== undefined && camera.lens !== "rectilinear" && selectCalibration(s)?.altDeg === 90
  );
};
