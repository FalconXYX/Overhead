// src/state/types.ts

import type { PlanetName } from "../domain/astro";
import type { Calibration, LensModel } from "../domain/camera";
import type { GpGroup } from "../domain/orbits";
import type { ClockRate, TimeInterval } from "../domain/time";

export type { Calibration, ClockRate, GpGroup, LensModel, PlanetName, TimeInterval };

export type StarId = `star:${number}`; // BSC5 HR number
export type PlanetId = `planet:${PlanetName}`;
export type SatId = `sat:${number}`; // NORAD_CAT_ID, 5 or 6 digits
export type ObjectId = SatId | PlanetId | StarId | "moon" | "sun";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

// ---- Camera registry (public/data/cameras.json) ----
export interface Credit {
  text: string; // on screen at all times while the source is visible
  href: string | null;
  licence: string | null; // e.g. "GFDL-1.3-or-later"; null when none is published
  licenceHref: string | null;
}
export interface CameraSite {
  latDeg: number;
  lonDeg: number;
  heightM: number; // lens height above mean sea level (ground + mast): the observer height everywhere
  mastM: number; // lens height above local ground: horizon worker z0 = DEM ground + mastM
  geoidSepM: number; // geoid separation N: GeoPose h = heightM + geoidSepM
  timeZone: string; // IANA zone: local-time readout and burned-in image clocks
}
interface CameraBase {
  id: string;
  name: string;
  /** [Redesign] The camera switcher's plain name ("Subaru live", "ISS pass (recorded)"); else `name`. */
  shortName?: string;
  /** [Redesign] The ground map's site label in plain words ("Subaru Telescope camera"); else `name`. */
  siteName?: string;
  /** [Polish] The switcher's place line ("Maunakea, Hawaii"); else the site's time zone as a place (placeOfZone). */
  placeName?: string;
  site: CameraSite;
  imageSize: { widthPx: number; heightPx: number };
  lens: LensModel;
  defaults: Calibration; // starting guesses
  credit: Credit;
  termsNote: string; // shown next to the credit, e.g. "Non-commercial use only"
}
export interface SyntheticCamera extends CameraBase {
  kind: "synthetic"; // computed sky, no image (M2)
  source: null;
}
export interface StillImageCamera extends CameraBase {
  kind: "still-image";
  source: {
    imageUrl: string;
    refreshSec: number; // ≥ STILL_IMAGE_MIN_REFRESH_SEC (60); Nānā ao 60, ASK053 120
    corsEnabled: boolean; // false: leave crossOrigin unset (no pixel access)
    captureLagMs: number; // frameTimeMs = load time − captureLagMs until a manual time is entered
    exposureSec: number; // > 1: satellites drawn as arcs over the exposure
  };
}
export interface YoutubeCamera extends CameraBase {
  kind: "youtube";
  source: {
    youtubeVideoId: string; // last known id; live ids change when a stream restarts
    resolverUrl: string | null; // page whose HTML holds the current youtu.be/<id> link (CORS *)
  };
}
export interface LocalVideoCamera extends CameraBase {
  kind: "local-video";
  source: {
    sidecarUrl: string | null; // ClipSidecar URL relative to BASE_URL, e.g. "recordings/subaru-2026-10-11-iss.json"; null: picked at runtime
    sourceCameraId: string | null; // registry camera the clip was recorded from (the sidecar's cameraId must match); null: local-replay
    videoUrl: string | null; // set when the clip loads: videoFile next to the sidecar, or an object URL for picked files
    startUtcMs: number | null; // set when the clip loads: the sidecar's startUtcMs (UTC of media time 0)
  };
}
export type CameraConfig = SyntheticCamera | StillImageCamera | YoutubeCamera | LocalVideoCamera;
export type CameraKind = CameraConfig["kind"];
export type CameraStatus = "unknown" | "live" | "offline" | "daytime";
export const STILL_IMAGE_MIN_REFRESH_SEC = 60;
/** [M5] Over a video, only stars with V ≤ this are drawn (unless calibrating): 1–8 stars in the Subaru frame on 2026-10-11. */
export const VIDEO_STAR_MAG_LIMIT = 2;

// ---- Slices ----
export interface ClockState {
  mode: "live" | "replay";
  playing: boolean;
  rate: ClockRate; // fixed at 1 in live mode
  simTimeMs: number; // UTC epoch ms
  rangeCenterMs: number; // the ±12 h scrubber is centred here
}
export interface CameraState {
  activeId: string;
  registry: Record<string, CameraConfig>; // from public/data/cameras.json
  calibration: Record<string, Calibration>; // persisted per camera; missing → registry[id].defaults
  status: Record<string, CameraStatus>;
  frameTimeMs: number | null; // capture time of the still image or video frame on screen
}
export interface SelectionState {
  selectedId: ObjectId | null;
  hoverId: ObjectId | null;
  follow: boolean; // ground map keeps the selected satellite centred
}
export interface LayersState {
  trueColor: boolean;
  coastlines: boolean; // Coastlines + Reference_Labels overlays
  goesIr: boolean;
  hillshade: boolean;
  footprint: boolean;
  stars: boolean;
  planets: boolean; // Sun, Moon and planets
  satellites: boolean; // stations + visual
  starlink: boolean; // also triggers the lazy load of gp/starlink.json
  trails: boolean;
  tracks: boolean; // [Redesign] "Satellite paths" on the ground map
  grid: boolean;
  horizon: boolean; // terrain skyline and behind-terrain dimming
  footprintHeightKm: number | null; // null: selected satellite's current height (420 when none)
  starMagLimit: number; // default 4.5
  video: VideoOverlayLayers; // [M5] O3 proposal (O1)
}
/** [M5] Extra gates for the sky view while it is drawn over a video (selectSkyOverVideo). All default false. */
export interface VideoOverlayLayers {
  starlink: boolean; // Starlink on the video; also needs layers.starlink, which loads the data
  grid: boolean; // alt/az grid on the video; also needs layers.grid
  denseLabels: boolean; // false: labels only for the ISS, the selected or hovered object, the Sun, Moon and planets
}
export type LayerToggle = {
  [K in keyof LayersState]: LayersState[K] extends boolean ? K : never;
}[keyof LayersState];
export interface GroupData {
  status: LoadStatus;
  fetchedAtMs: number | null; // from public/data/gp/meta.json
  count: number; // objects drawn after dedupe and docking
}
export interface HorizonData {
  status: LoadStatus;
  profileDeg: Float32Array | null; // 360 values, 1 per degree of azimuth
  imagerySources: string[]; // dataset prefixes (eudem, srtm, …) from x-amz-meta-x-imagery-sources
}
export interface DataState {
  cameras: LoadStatus;
  gibs: LoadStatus; // capabilities snapshot parsed
  stars: LoadStatus;
  gp: Record<GpGroup, GroupData>;
  horizon: Record<string, HorizonData>; // keyed by camera id
  goes: {
    status: LoadStatus; // DescribeDomains poll; the tile guard sets "error" (M7)
    intervals: readonly TimeInterval[]; // from DescribeDomains, minus steps whose tiles failed
    latestStepMs: number | null; // newest step confirmed by a HEAD probe
  };
}
export interface StarPair {
  imagePx: readonly [uPx: number, vPx: number];
  targetId: StarId | PlanetId;
  role: "fit" | "holdout"; // holdout pairs are measured, never fitted
  residualPx: number | null; // from the last fit
  rejected: boolean; // dropped by the 3σ rule in the last fit
}
export interface CalibrationUiState {
  pairs: StarPair[];
  pendingPx: readonly [uPx: number, vPx: number] | null; // image click waiting for its catalog object
  fit: { rmsPx: number; rmsDeg: number; maxFitDeg: number; maxHoldoutDeg: number | null } | null;
}
export interface VideoState {
  status:
    | "idle"
    | "loading"
    | "playing"
    | "buffering"
    | "paused"
    | "ended"
    | "error"
    | "embed-blocked";
  errorCode: number | null; // YouTube onError: 101/150 embedding disabled (150 also: dead or unknown id), 153 no Referer
}
export interface UiState {
  panel: "calibration" | "layers" | null;
  demo: { active: boolean; step: number; paused: boolean };
}
/**
 * [M9] DEMO_STEPS.length (src/app/demo.ts, lazy-loaded): setDemoStep clamps to [0, DEMO_STEP_COUNT − 1]. [Redesign]
 * Five steps: the recorded ISS pass, then live.
 */
export const DEMO_STEP_COUNT = 5;

export interface StateData {
  clock: ClockState;
  camera: CameraState;
  selection: SelectionState;
  layers: LayersState;
  data: DataState;
  calibrationUi: CalibrationUiState;
  video: VideoState;
  ui: UiState;
}

export interface Actions {
  // clock
  tick(simTimeMs: number): void;
  setMode(mode: ClockState["mode"]): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setRate(rate: ClockRate): void;
  stepBy(deltaMs: number): void;
  seek(timeMs: number): void;
  jumpToNow(): void;
  recenter(timeMs: number): void;
  // camera
  setRegistry(registry: Record<string, CameraConfig>): void;
  setActiveCamera(id: string): void;
  setCameraStatus(id: string, status: CameraStatus): void;
  setFrameTimeMs(timeMs: number | null): void;
  updateCalibration(patch: Partial<Omit<Calibration, "updatedAtMs">>): void;
  setStreamDelayMs(ms: number): void;
  resetCalibration(): void;
  importCalibration(id: string, calibration: Calibration): void;
  // selection
  select(id: ObjectId | null): void;
  hover(id: ObjectId | null): void;
  setFollow(on: boolean): void;
  // layers
  setLayer(key: LayerToggle, on: boolean): void;
  toggleLayer(key: LayerToggle): void;
  setFootprintHeightKm(km: number | null): void;
  setStarMagLimit(vmag: number): void;
  setVideoLayer(key: keyof VideoOverlayLayers, on: boolean): void;
  // data
  setLoadStatus(key: "cameras" | "gibs" | "stars", status: LoadStatus): void;
  setGroupData(group: GpGroup, patch: Partial<GroupData>): void;
  setHorizon(cameraId: string, patch: Partial<HorizonData>): void;
  setGoesDomain(intervals: readonly TimeInterval[], latestStepMs: number | null): void;
  setGoesStatus(status: LoadStatus): void;
  // calibration UI
  addImagePoint(uPx: number, vPx: number): void;
  completePair(targetId: StarId | PlanetId): void;
  setPairRole(index: number, role: StarPair["role"]): void;
  removePair(index: number): void;
  clearPairs(): void;
  cancelImagePoint(): void;
  applyFit(
    calibration: Calibration,
    residualPx: readonly number[],
    rejected: readonly boolean[],
    fit: NonNullable<CalibrationUiState["fit"]>,
  ): void;
  // video
  setVideoStatus(status: VideoState["status"], errorCode?: number | null): void;
  // ui
  openPanel(panel: UiState["panel"]): void;
  togglePanel(panel: NonNullable<UiState["panel"]>): void;
  startDemo(): void;
  setDemoStep(step: number): void;
  stopDemo(): void;
  setDemoPaused(paused: boolean): void;
}

export interface AppState extends StateData {
  actions: Actions;
}
