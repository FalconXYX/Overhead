// src/app/clip.ts — recorded clips (O2): the ClipSidecar contract, its validation, and the clip camera it runs as
// (M5 step 10); [M5] loading a clip from its sidecar URL or from picked files (with the H1 Range probe), the probe of
// the video, the per-camera load state ClipControls shows, "Copy pointing", the rates a clip allows and the stretches
// where the sidecar says a satellite is hidden (step 13). [Redesign] Picked files (local-replay) and "Save sidecar" are
// gone from the UI; loadClip stays for the unit tests. The clip loader runs from main.tsx (startClipLoader), opens a
// clip a little before its pass, and gives the control bar the clip's position and length (clipProgress).
import { createCameraModel, distortionValid } from "../domain/camera";
import { isoUtcSeconds, localVideoTimeMs } from "../domain/time";
import type { AppStore } from "../state/store";
import type {
  AppState,
  Calibration,
  CameraConfig,
  ClockRate,
  Credit,
  LocalVideoCamera,
} from "../state/types";
import { parseUrlState } from "./url";

/** How the sidecar's startUtcMs was measured (section 8, "Recorded clips"). */
export type ClipTimingMethod = "hls-program-date-time" | "burned-in-clock" | "satellite" | "manual";
export interface ClipTiming {
  readonly method: ClipTimingMethod;
  readonly detail: string; // how, for people; further keys (cross-checks) are allowed and ignored
}
/** The pass a clip was cut for, in media seconds: predicted by scripts/find-passes.ts or measured on the video. */
export interface ClipPass {
  readonly noradId: number;
  readonly inFrameFromMediaS: number; // first moment inside the frame and visible
  readonly inFrameToMediaS: number; // last such moment
  readonly visibleMediaS?: readonly (readonly [fromS: number, toS: number])[]; // seen in the video, e.g. between domes
}
/**
 * recordings/<clip>.json, next to its video (O2). Plain JSON; every field without "?" is required, and keys not
 * listed here (provenance) are allowed and ignored. The clip plays as registry camera cameraId: its site, lens and
 * image size, drawn at that camera's W × H.
 */
export interface ClipSidecar {
  readonly cameraId: string; // a youtube or still-image registry camera
  readonly videoFile: string; // file name in the sidecar's folder, no "/": e.g. "subaru-2026-10-11-iss.mp4"
  readonly startUtcMs: number; // UTC epoch ms of media time 0
  readonly startUncertaintyS: number; // ± seconds on startUtcMs, ≥ 0
  readonly timingSource: ClipTiming;
  readonly durationS: number; // > 0 and ≤ 43,200 (the ± 12 h scrubber)
  readonly width: number; // encoded frame width, px
  readonly height: number; // encoded frame height, px; width:height within 0.5 % of the camera's W:H
  readonly fps: number;
  readonly sourceVideoId: string | null; // the YouTube video id it was recorded from; null for other sources
  readonly credit: Credit; // non-empty text; on screen while the clip is active
  readonly calibration?: Calibration; // fitted on this clip, in the camera's W × H pixels; the clip camera starts from it
  readonly pass?: ClipPass;
}

const TIMING_METHODS: readonly string[] = [
  "hls-program-date-time",
  "burned-in-clock",
  "satellite",
  "manual",
] satisfies readonly ClipTimingMethod[];
/** 2000-01-01T00:00:00Z: no StarCam clip is older. */
const MIN_START_UTC_MS = 946_684_800_000;
const DAY_MS = 86_400_000;
/** The ± 12 h scrubber holds at most 12 h of clip. */
const MAX_DURATION_S = 43_200;
/** Relative difference allowed between the clip's width:height and the camera's W:H. */
const MAX_ASPECT_DIFFERENCE = 0.005;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPositiveInteger = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** The registry's own entry for id (never an Object.prototype member such as "constructor"). */
function registryCamera(
  registry: Readonly<Record<string, CameraConfig>>,
  id: unknown,
): CameraConfig | undefined {
  return typeof id === "string" && Object.hasOwn(registry, id) ? registry[id] : undefined;
}

const CALIBRATION_NUMBERS = [
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

/**
 * The 12 Calibration fields with their types, copied without extra keys; null when any is missing or mistyped, or
 * when focalPx is not > 0 (as cameras.json requires of defaults).
 */
function readCalibration(v: unknown): Calibration | null {
  if (!isObject(v) || typeof v.flipX !== "boolean") return null;
  if (!(v.rmsDeg === null || isFiniteNumber(v.rmsDeg))) return null;
  if (!(isFiniteNumber(v.focalPx) && v.focalPx > 0)) return null;
  const numbers: Partial<Record<(typeof CALIBRATION_NUMBERS)[number], number>> = {};
  for (const key of CALIBRATION_NUMBERS) {
    const value = v[key];
    if (!isFiniteNumber(value)) return null;
    numbers[key] = value;
  }
  return {
    ...(numbers as Record<(typeof CALIBRATION_NUMBERS)[number], number>),
    flipX: v.flipX,
    rmsDeg: v.rmsDeg,
  };
}

/** Visible stretches [from, to], each from ≤ to, ascending and not overlapping, inside [0, durationS]. */
function readVisibleStretches(
  v: unknown,
  durationS: number | null,
): (readonly [number, number])[] | null {
  if (!Array.isArray(v)) return null;
  const out: (readonly [number, number])[] = [];
  let previousEnd = 0;
  for (const item of v as unknown[]) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [from, to] = item as unknown[];
    if (!isFiniteNumber(from) || !isFiniteNumber(to)) return null;
    if (from < previousEnd || from > to || (durationS !== null && to > durationS)) return null;
    out.push([from, to]);
    previousEnd = to;
  }
  return out;
}

/** The pass's contract fields, or null. Media times are checked against durationS only when it is valid. */
function readPass(v: unknown, durationS: number | null): ClipPass | null {
  if (!isObject(v) || !isPositiveInteger(v.noradId)) return null;
  const from = v.inFrameFromMediaS;
  const to = v.inFrameToMediaS;
  if (!isFiniteNumber(from) || !isFiniteNumber(to) || from < 0 || from > to) return null;
  if (durationS !== null && to > durationS) return null;
  const pass = { noradId: v.noradId, inFrameFromMediaS: from, inFrameToMediaS: to };
  if (v.visibleMediaS === undefined) return pass;
  const visibleMediaS = readVisibleStretches(v.visibleMediaS, durationS);
  return visibleMediaS === null ? null : { ...pass, visibleMediaS };
}

/**
 * Lists every problem, one message per field, in contract order (M5 step 10.1). startUtcMs must lie between
 * 2000-01-01 and nowMs + 1 day. The width:height and calibration-lens checks need a valid camera and are skipped
 * without one; a pass is checked against durationS only when durationS is valid. Keys the contract does not list
 * are ignored, and the returned sidecar holds only the contract fields (a caller that saves the file again keeps the
 * parsed JSON for its provenance keys).
 */
export function parseClipSidecar(
  json: unknown,
  registry: Readonly<Record<string, CameraConfig>>,
  nowMs: number,
): { ok: true; sidecar: ClipSidecar } | { ok: false; errors: string[] } {
  if (!isObject(json)) return { ok: false, errors: ["sidecar must be a JSON object"] };
  const errors: string[] = [];

  const source = registryCamera(registry, json.cameraId);
  const camera = source?.kind === "youtube" || source?.kind === "still-image" ? source : undefined;
  if (camera === undefined)
    errors.push("cameraId must name a youtube or still-image camera in cameras.json");

  const { videoFile } = json;
  if (
    typeof videoFile !== "string" ||
    videoFile === "" ||
    videoFile === "." ||
    videoFile === ".." ||
    /[/\\]/.test(videoFile)
  )
    errors.push("videoFile must be a file name with no / or \\");

  const { startUtcMs } = json;
  if (!isFiniteNumber(startUtcMs)) errors.push("startUtcMs must be a finite number");
  else if (startUtcMs < MIN_START_UTC_MS || startUtcMs > nowMs + DAY_MS)
    errors.push("startUtcMs is out of range");

  const { startUncertaintyS } = json;
  if (!isFiniteNumber(startUncertaintyS) || startUncertaintyS < 0)
    errors.push("startUncertaintyS must be a finite number ≥ 0");

  const { timingSource } = json;
  const timingOk =
    isObject(timingSource) &&
    TIMING_METHODS.includes(timingSource.method as string) &&
    typeof timingSource.detail === "string";
  if (!timingOk) errors.push("timingSource needs a known method and a detail string");

  const { durationS } = json;
  const durationOk = isFiniteNumber(durationS) && durationS > 0 && durationS <= MAX_DURATION_S;
  if (!durationOk) errors.push(`durationS must be > 0 and ≤ ${MAX_DURATION_S}`);

  const { width, height } = json;
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    errors.push("width and height must be positive integers");
  } else if (camera !== undefined) {
    const cameraAspect = camera.imageSize.widthPx / camera.imageSize.heightPx;
    if (Math.abs(width / height - cameraAspect) > MAX_ASPECT_DIFFERENCE * cameraAspect)
      errors.push("width:height differs from the camera's W:H by more than 0.5 %");
  }

  const { fps } = json;
  if (!isFiniteNumber(fps) || fps <= 0) errors.push("fps must be a finite number > 0");

  const { sourceVideoId } = json;
  if (
    !(
      sourceVideoId === null ||
      (typeof sourceVideoId === "string" && YOUTUBE_ID_RE.test(sourceVideoId))
    )
  )
    errors.push("sourceVideoId must be null or an 11-character YouTube id");

  const { credit } = json;
  const creditOk =
    isObject(credit) &&
    typeof credit.text === "string" &&
    credit.text !== "" &&
    isStringOrNull(credit.href) &&
    isStringOrNull(credit.licence) &&
    isStringOrNull(credit.licenceHref);
  if (!creditOk)
    errors.push(
      "credit needs non-empty text, and href, licence and licenceHref as strings or null",
    );

  let calibration: Calibration | null = null;
  if (json.calibration !== undefined) {
    calibration = readCalibration(json.calibration);
    const fitsLens =
      calibration === null
        ? false
        : camera === undefined ||
          distortionValid(
            calibration.k1,
            calibration.k2,
            createCameraModel({
              lens: camera.lens,
              calibration,
              widthPx: camera.imageSize.widthPx,
              heightPx: camera.imageSize.heightPx,
            }).rMaxUnit,
          );
    if (!fitsLens) errors.push("calibration must be a full Calibration for the camera's lens");
  }

  let pass: ClipPass | null = null;
  if (json.pass !== undefined) {
    pass = readPass(json.pass, durationOk ? (durationS as number) : null);
    if (pass === null)
      errors.push("pass needs a positive integer noradId and in-frame media times within the clip");
  }

  if (errors.length > 0) return { ok: false, errors };
  // Every check above passed, so each field has its contract type.
  const c = credit as Json;
  const t = timingSource as Json;
  const sidecar: ClipSidecar = {
    cameraId: json.cameraId as string,
    videoFile: videoFile as string,
    startUtcMs: startUtcMs as number,
    startUncertaintyS: startUncertaintyS as number,
    timingSource: { method: t.method as ClipTimingMethod, detail: t.detail as string },
    durationS: durationS as number,
    width: width as number,
    height: height as number,
    fps: fps as number,
    sourceVideoId: sourceVideoId as string | null,
    credit: {
      text: c.text as string,
      href: c.href as string | null,
      licence: c.licence as string | null,
      licenceHref: c.licenceHref as string | null,
    },
    ...(calibration === null ? {} : { calibration }),
    ...(pass === null ? {} : { pass }),
  };
  return { ok: true, sidecar };
}

/**
 * videoFile resolved against the sidecar's absolute URL. The name is percent-encoded first, so it always names a
 * file in the sidecar's folder: a "#", "?" or "scheme:" in it cannot turn into a fragment, a query or another host.
 */
export function clipVideoUrl(sidecarAbsUrl: string, sidecar: ClipSidecar): string {
  return new URL(encodeURIComponent(sidecar.videoFile), sidecarAbsUrl).href;
}

/**
 * [M9] Where a sidecar-URL clip's own element sets live (M9 step 14f): ".../recordings/<clip>.json" →
 * ".../recordings/<clip>.gp/" (absolute, no query or hash). The deploy copies them there (DEPLOY_CLIP_GP).
 */
export function clipGpBaseUrl(sidecarAbsUrl: string): string {
  const url = new URL(sidecarAbsUrl);
  url.pathname = url.pathname.replace(/\.json$/, ".gp/");
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * The camera a loaded clip runs as: entry's id, name, [Redesign] shortName and siteName (else the source camera's
 * siteName), [Polish] placeName (likewise) and source.sidecarUrl; site, lens, imageSize and termsNote from registry[sidecar.cameraId]; defaults =
 * sidecar.calibration ?? that camera's defaults, with streamDelayMs 0; the sidecar's credit; source.sourceCameraId,
 * videoUrl and startUtcMs filled in. null when sidecar.cameraId is not in the registry or differs from a non-null
 * entry.source.sourceCameraId.
 */
export function clipCamera(
  entry: LocalVideoCamera,
  sidecar: ClipSidecar,
  videoUrl: string,
  registry: Readonly<Record<string, CameraConfig>>,
): LocalVideoCamera | null {
  const source = registryCamera(registry, sidecar.cameraId);
  if (source === undefined) return null;
  const expected = entry.source.sourceCameraId;
  if (expected !== null && expected !== sidecar.cameraId) return null;
  // [Redesign] The entry's plain names; the site label falls back to the source camera's (the clip's site is its).
  const siteName = entry.siteName ?? source.siteName;
  const placeName = entry.placeName ?? source.placeName; // [Polish] the switcher's place line, likewise
  return {
    id: entry.id,
    name: entry.name,
    ...(entry.shortName === undefined ? {} : { shortName: entry.shortName }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(placeName === undefined ? {} : { placeName }),
    kind: "local-video",
    source: {
      sidecarUrl: entry.source.sidecarUrl,
      sourceCameraId: sidecar.cameraId,
      videoUrl,
      startUtcMs: sidecar.startUtcMs,
    },
    site: source.site,
    imageSize: source.imageSize,
    lens: source.lens,
    defaults: { ...(sidecar.calibration ?? source.defaults), streamDelayMs: 0 },
    credit: { ...sidecar.credit },
    termsNote: source.termsNote,
  };
}

// ---- [M5] Rates, hidden stretches, the saved sidecar and the probe checks (pure) ----

/** [M5] The registry id of the picked-files clip camera (M5 step 2). [Redesign] Never enabled: tests only. */
export const LOCAL_REPLAY_ID = "local-replay";
/** [M5] The rates with a clip: Chromium's playbackRate stops at 16 (gotcha G16). */
export const CLIP_RATES: readonly ClockRate[] = [1, 10];
const NO_RATES: readonly ClockRate[] = [];

/**
 * [Redesign] The rates [ and ] cycle: 1× and 10× (CLIP_RATES) on a recorded clip, and on the test-only computed and
 * still cameras; none on a live camera (it has no time controls) or before the camera list loads. 60× and 600× are
 * gone from every user path; ClockRate keeps them for the perf harness.
 */
export function offeredRates(kind: CameraConfig["kind"] | undefined): readonly ClockRate[] {
  return kind === undefined || kind === "youtube" ? NO_RATES : CLIP_RATES;
}

/** [M5] "<videoFile without its extension>.json": a clip's sidecar file name, next to its video. */
export function sidecarFileName(videoFile: string): string {
  const dot = videoFile.lastIndexOf(".");
  return `${dot > 0 ? videoFile.slice(0, dot) : videoFile}.json`;
}

/** [Redesign] Where a clip opens: at least this long before its pass enters the frame. */
const CLIP_OPEN_LEAD_S = 15;

/**
 * [Redesign] The media second a clip opens at: the last whole 10 s at least 15 s before its pass enters the frame
 * (media 60 s on the 2026-10-11 ISS clip, whose ISS enters at 78.7 s), so the pass starts within about 20 s of
 * pressing play; 0 for a clip without a pass.
 */
export function clipOpenMediaS(sidecar: Pick<ClipSidecar, "pass" | "durationS">): number {
  const from = sidecar.pass?.inFrameFromMediaS;
  if (from === undefined) return 0;
  const openS = Math.max(0, Math.floor((from - CLIP_OPEN_LEAD_S) / 10) * 10);
  return Math.min(openS, sidecar.durationS);
}

/** [Redesign] A media time as m:ss, rounded down to the second: 95.4 → "1:35", 480 → "8:00" (the control bar). */
export function formatClipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * [M5] Where the sidecar says satellite noradId is hidden (behind a dome), in UTC ms: the stretches between consecutive
 * pass.visibleMediaS intervals, [startUtcMs + a × 1000, startUtcMs + b × 1000]. [] when the pass is another object's
 * or lists no visible stretches (M5 step 13.4).
 */
export function clipHiddenMs(sidecar: ClipSidecar, noradId: number): [number, number][] {
  const visible = sidecar.pass?.noradId === noradId ? sidecar.pass.visibleMediaS : undefined;
  const out: [number, number][] = [];
  if (visible === undefined) return out;
  for (let i = 1; i < visible.length; i++) {
    const a = visible[i - 1]?.[1];
    const b = visible[i]?.[0];
    if (a === undefined || b === undefined || !(b > a)) continue; // touching stretches hide nothing
    out.push([sidecar.startUtcMs + a * 1000, sidecar.startUtcMs + b * 1000]);
  }
  return out;
}

/** [M5] A media duration as m:ss.s, e.g. 480 → "8:00.0" and 7 → "0:07.0". */
export function formatClipDuration(durationS: number): string {
  if (!Number.isFinite(durationS) || durationS < 0) return "unknown";
  const tenths = Math.round(durationS * 10);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** [M5] What the temporary <video preload="metadata"> reported (M5 step 10.6). */
export interface VideoProbe {
  readonly durationS: number;
  readonly widthPx: number; // videoWidth
  readonly heightPx: number; // videoHeight
}

const roundS = (s: number): number => Math.round(s * 1000) / 1000;

/** [M5] The step 10.6 message for a MediaError, with the remux command for the file. */
export function cannotPlayText(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const out = /\.mp4$/i.test(fileName) ? `${stem}-remux.mp4` : `${stem}.mp4`;
  return `This browser cannot play the file. Remux it to MP4: ffmpeg -i ${fileName} -map 0:v -c copy -movflags +faststart ${out}`;
}

/**
 * [M5] The probe's verdict (M5 step 10.6): an error for a duration that is not finite in (0, 43,200] s, for no video
 * size, or for a width:height more than 0.5 % from the camera's W:H; notes, which never block loading, when only the
 * size differs from the camera's (it is drawn at W × H), and when the duration differs from the sidecar's by more
 * than one frame (1/fps s) or the size from the sidecar's width × height.
 */
export function checkVideoProbe(
  probe: VideoProbe,
  sidecar: ClipSidecar,
  camera: Pick<CameraConfig, "imageSize">,
): { error: string | null; notes: string[] } {
  const { widthPx: W, heightPx: H } = camera.imageSize;
  const { durationS, widthPx: w, heightPx: h } = probe;
  if (!(Number.isFinite(durationS) && durationS > 0 && durationS <= MAX_DURATION_S))
    return {
      error: `The clip's duration (${durationS} s) is not a finite length of at most ${MAX_DURATION_S} s.`,
      notes: [],
    };
  if (!(w > 0 && h > 0))
    return { error: "The browser reports no video size for the clip.", notes: [] };
  if (Math.abs(w / h - W / H) > MAX_ASPECT_DIFFERENCE * (W / H))
    return {
      error: `The clip is ${w} × ${h}; its width:height differs from the camera's ${W} × ${H} by more than 0.5 %.`,
      notes: [],
    };
  const notes: string[] = [];
  if (w !== W || h !== H) notes.push(`The clip is ${w} × ${h}; it is drawn at ${W} × ${H}.`);
  if (Math.abs(durationS - sidecar.durationS) > 1 / sidecar.fps)
    notes.push(`The video lasts ${roundS(durationS)} s; the sidecar says ${sidecar.durationS} s.`);
  if (w !== sidecar.width || h !== sidecar.height)
    notes.push(`The video is ${w} × ${h}; the sidecar says ${sidecar.width} × ${sidecar.height}.`);
  return { error: null, notes };
}

// ---- [M5] The Satellite check's export (M5 step 13.5); scripts/check-clip-pass.ts reads it as a track ----

/** [M5] One recorded click of the Satellite check. */
export interface SatelliteCheckRow {
  readonly timeMs: number; // sim time of the frame
  readonly uPx: number; // the click, in the camera's W × H image px
  readonly vPx: number;
  readonly residualDeg: number;
  readonly residualPx: number | null; // to the projected marker; null when the marker is off the frame
}
export interface SatelliteCheckExport {
  readonly format: "overhead.satcheck";
  readonly version: 1;
  readonly cameraId: string;
  readonly clip: string | null; // the clip's video file name; null for a still image
  readonly sidecar: Readonly<Record<string, unknown>> | null; // as loaded, every key kept
  readonly widthPx: number; // the image grid of uPx, vPx: the camera's W × H
  readonly heightPx: number;
  readonly calibration: Calibration;
  readonly noradId: number;
  readonly satelliteName: string;
  readonly elementEpochUtc: string | null; // the satellite's element set EPOCH, ISO
  readonly samples: readonly SatelliteCheckRow[];
  readonly summary: {
    readonly count: number;
    readonly maxGapMs: number | null;
    readonly maxDeg: number | null;
    readonly medianDeg: number | null;
    readonly pass: boolean;
  };
  readonly exportedAtUtc: string;
}

/** [M5] "overhead-satcheck-<cameraId>-<YYYYMMDDTHHMMSSZ>.json". */
export function satelliteCheckFileName(cameraId: string, nowMs: number): string {
  return `overhead-satcheck-${cameraId}-${isoUtcSeconds(nowMs).replace(/[-:]/g, "")}.json`;
}

// ---- [M5] Loading a clip (M5 step 10.4–10.6 and DECISIONS H1's Range probe) ----

export const CLIP_TEXT = {
  loading: "Loading the recorded video…",
  notInBuild: "The recorded video is not included in this copy of the site.",
  /** [Redesign] ClipControls' plain line for any other failed load; the technical message goes under "Details". */
  failed: "The recorded video could not be loaded.",
  /** [Redesign] ClipControls' line when the <video> reports a MediaError. */
  cannotPlay: "This browser cannot play the recorded video.",
  problems: "The sidecar has problems:",
  pickBoth:
    "Pick the clip and its .json sidecar together (scripts/record-clip.ts writes the sidecar).",
  notJson: "the .json file is not valid JSON",
} as const;

/** [M5] A clip on screen: what ClipControls shows. */
export interface LoadedClip {
  readonly sidecar: ClipSidecar;
  /** The sidecar as read, every key kept (provenance included). */
  readonly sidecarJson: Readonly<Record<string, unknown>>;
  readonly fileName: string; // the sidecar's videoFile, or the picked video's name
  readonly probe: VideoProbe;
  readonly notes: readonly string[]; // non-blocking: size, duration and file-name differences
}
/** [M5] A camera's clip state. The failure of a pick leaves an earlier clip of local-replay on screen. */
export interface ClipLoadState {
  readonly loading: boolean;
  readonly clip: LoadedClip | null;
  readonly failure: { readonly message: string; readonly problems: readonly string[] } | null;
}

const loadStates = new Map<string, ClipLoadState>();
const loadListeners = new Set<() => void>();
/** [M5] Object URLs a camera's clip plays from (picked files, or a Blob read after the Range probe). */
const objectUrls = new Map<string, string>();

/** The clip on screen for a camera: its last loaded clip while its registry entry still plays from a videoUrl. */
function clipOnScreen(store: AppStore, cameraId: string): LoadedClip | null {
  const entry = store.getState().camera.registry[cameraId];
  const playing = entry?.kind === "local-video" && entry.source.videoUrl !== null;
  return playing ? (loadStates.get(cameraId)?.clip ?? null) : null;
}

function publish(cameraId: string, state: ClipLoadState): ClipLoadState {
  loadStates.set(cameraId, state);
  for (const listener of loadListeners) listener();
  return state;
}

/** [M5] The camera's clip state; undefined before its first load. A stable reference until it changes. */
export function getClipLoadState(cameraId: string): ClipLoadState | undefined {
  return loadStates.get(cameraId);
}

/** [M5] Runs listener after every change of any camera's clip state (useSyncExternalStore). */
export function subscribeClipLoads(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => {
    loadListeners.delete(listener);
  };
}

/** The page's query when this module loaded, before url.ts rewrote ?t=. */
const INITIAL_SEARCH = typeof location === "undefined" ? "" : location.search;
let urlTimeClaimed = false;

/**
 * [M5] The first clip that loads on a page keeps the URL time, instead of opening at clipOpenMediaS, when the page was
 * loaded with a valid ?t= and ?cam= names its camera, or [Redesign] names none (the default camera is the clip) (M5
 * step 10.4.7). commitClip also needs that time inside the clip. Claimed when a load commits, so an aborted load
 * claims nothing; every later call is false.
 */
export function claimUrlTime(cameraId: string, search: string = INITIAL_SEARCH): boolean {
  if (urlTimeClaimed) return false;
  urlTimeClaimed = true;
  const url = parseUrlState(search);
  return url.tMs !== null && (url.cam === null || url.cam === cameraId);
}

/** [M5] Loads videoUrl's metadata in a temporary, muted <video preload="metadata">; a MediaError gives "media-error". */
export function probeVideo(videoUrl: string): Promise<VideoProbe | "media-error"> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    const finish = (result: VideoProbe | "media-error"): void => {
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      video.load(); // drops the connection
      resolve(result);
    };
    const onMetadata = (): void =>
      finish({ durationS: video.duration, widthPx: video.videoWidth, heightPx: video.videoHeight });
    const onError = (): void => finish("media-error");
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("error", onError);
    video.src = videoUrl;
  });
}

export interface ClipLoadOptions {
  /** One AbortController per activation: once aborted, or once another camera is active, the result is dropped. */
  readonly signal?: AbortSignal;
  /** Keep the URL time instead of recenter(startUtcMs); default claimUrlTime(cameraId) when the load commits. */
  readonly keepTime?: boolean;
  /** probeVideo in the app; a fake in unit tests. */
  readonly probe?: (videoUrl: string) => Promise<VideoProbe | "media-error">;
  /**
   * The app's base, absolute: ClipControls passes new URL(import.meta.env.BASE_URL, location.href). Default
   * location.href. (No import.meta.env here: scripts import this module under tsconfig.node.json.)
   */
  readonly baseHref?: string;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  /** For parseClipSidecar's range check; default Date.now(). */
  readonly nowMs?: number;
}

/** One load: its camera, options and the "is it still wanted" test. */
interface LoadRun {
  readonly store: AppStore;
  readonly cameraId: string;
  readonly options: ClipLoadOptions;
  stale(): boolean;
}

function startRun(store: AppStore, cameraId: string, options: ClipLoadOptions): LoadRun {
  return {
    store,
    cameraId,
    options,
    stale: () => options.signal?.aborted === true || store.getState().camera.activeId !== cameraId,
  };
}

const revokeWith = (options: ClipLoadOptions) => (url: string | null) => {
  if (url !== null) (options.revokeObjectUrl ?? URL.revokeObjectURL)(url);
};

/** Ends a load with a failure: video status "error" (unless a clip stays on screen), and "offline" when asked. */
function fail(
  run: LoadRun,
  message: string,
  problems: readonly string[] = [],
  offline = false,
): ClipLoadState | null {
  if (run.stale()) return null;
  const { actions } = run.store.getState();
  const previous = clipOnScreen(run.store, run.cameraId);
  if (previous === null) actions.setVideoStatus("error");
  if (offline) actions.setCameraStatus(run.cameraId, "offline");
  return publish(run.cameraId, { loading: false, clip: previous, failure: { message, problems } });
}

function begin(run: LoadRun, setLoadingStatus: boolean): void {
  if (setLoadingStatus) run.store.getState().actions.setVideoStatus("loading");
  const previous = clipOnScreen(run.store, run.cameraId);
  publish(run.cameraId, { loading: true, clip: previous, failure: null });
}

/**
 * H1: one `Range: bytes=0-1` request. 206 streams from the URL; 200 with a video/ type reads the whole file into a
 * Blob, because Chromium cannot seek a video served without ranges (Playwright's route.fulfill); anything else is null
 * ("not part of this build").
 */
async function playableClipUrl(
  videoUrl: string,
  fetchFn: typeof fetch,
  options: ClipLoadOptions,
): Promise<{ url: string; objectUrl: string | null } | null> {
  const res = await fetchFn(videoUrl, {
    headers: { Range: "bytes=0-1" },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (res.status === 206) {
    await res.body?.cancel().catch(() => undefined);
    return { url: videoUrl, objectUrl: null };
  }
  if (res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("video/")) {
    const objectUrl = (options.createObjectUrl ?? URL.createObjectURL)(await res.blob());
    return { url: objectUrl, objectUrl };
  }
  await res.body?.cancel().catch(() => undefined);
  return null;
}

/**
 * Probes the video, then commits in the step 10.4.7 order: setRegistry, the calibration import, setRate(1) unless the
 * rate is a clip rate, recenter at clipOpenMediaS unless the URL time is kept (asked, or claimed and inside the clip),
 * camera status "live", video status "paused". The previous object URL of this camera is revoked once the new clip is
 * in the registry.
 */
async function commitClip(
  run: LoadRun,
  camera: LocalVideoCamera,
  sidecar: ClipSidecar,
  sidecarJson: Readonly<Record<string, unknown>>,
  fileName: string,
  objectUrl: string | null,
  notes: readonly string[],
  alwaysImport: boolean,
): Promise<ClipLoadState | null> {
  const { store, cameraId, options } = run;
  const revoke = revokeWith(options);
  const videoUrl = camera.source.videoUrl ?? "";
  let probe: VideoProbe | "media-error";
  try {
    probe = await (options.probe ?? probeVideo)(videoUrl);
  } catch {
    probe = "media-error";
  }
  if (run.stale()) {
    revoke(objectUrl);
    return null;
  }
  if (probe === "media-error") {
    revoke(objectUrl);
    return fail(run, cannotPlayText(fileName));
  }
  const checked = checkVideoProbe(probe, sidecar, camera);
  if (checked.error !== null) {
    revoke(objectUrl);
    return fail(run, checked.error);
  }

  const s = store.getState();
  const { actions } = s;
  const shown = s.camera.registry[cameraId];
  const shownUrl = shown?.kind === "local-video" ? shown.source.videoUrl : null;
  actions.setRegistry({ ...s.camera.registry, [cameraId]: camera });
  // The object URL the replaced clip played from (the registry stops using it here).
  const previousUrl = objectUrls.get(cameraId) === shownUrl ? shownUrl : null;
  if (objectUrl === null) objectUrls.delete(cameraId);
  else objectUrls.set(cameraId, objectUrl);
  if (previousUrl !== objectUrl) revoke(previousUrl);
  if (alwaysImport || s.camera.calibration[cameraId] === undefined) {
    const base =
      sidecar.calibration ??
      s.camera.calibration[sidecar.cameraId] ??
      s.camera.registry[sidecar.cameraId]?.defaults;
    if (base !== undefined) actions.importCalibration(cameraId, { ...base, streamDelayMs: 0 });
  }
  const { rate, simTimeMs } = store.getState().clock;
  if (!CLIP_RATES.includes(rate)) actions.setRate(1);
  const endUtcMs = localVideoTimeMs(sidecar.startUtcMs, probe.durationS);
  const keep =
    options.keepTime ??
    (claimUrlTime(cameraId) && simTimeMs >= sidecar.startUtcMs && simTimeMs <= endUtcMs);
  if (!keep) actions.recenter(localVideoTimeMs(sidecar.startUtcMs, clipOpenMediaS(sidecar)));
  actions.setCameraStatus(cameraId, "live");
  actions.setVideoStatus("paused");
  return publish(cameraId, {
    loading: false,
    clip: { sidecar, sidecarJson, fileName, probe, notes: [...notes, ...checked.notes] },
    failure: null,
  });
}

/**
 * [M5] Loads a clip camera's clip from its sidecarUrl (M5 step 10.4); ClipControls runs it on activation while the
 * camera has a sidecarUrl and no videoUrl. Anything but an OK JSON answer (vite's index.html fallback, GitHub Pages'
 * 404, a network error) is "This clip is not part of this build." with camera status "offline". Resolves to the
 * camera's new clip state, or null when the result was dropped (aborted, or another camera is active).
 */
export async function loadClipFromSidecarUrl(
  store: AppStore,
  cameraId: string,
  fetchFn: typeof fetch = fetch,
  options: ClipLoadOptions = {},
): Promise<ClipLoadState | null> {
  const entry = store.getState().camera.registry[cameraId];
  if (entry?.kind !== "local-video" || entry.source.sidecarUrl === null) return null;
  const run = startRun(store, cameraId, options);
  begin(run, true);
  const baseHref = options.baseHref ?? location.href; // the app passes its BASE_URL (the page sits there too)
  const sidecarAbsUrl = new URL(entry.source.sidecarUrl, baseHref).href;
  const signal = options.signal === undefined ? {} : { signal: options.signal };

  let json: unknown;
  try {
    const res = await fetchFn(sidecarAbsUrl, { cache: "no-cache", ...signal });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
      await res.body?.cancel().catch(() => undefined);
      return fail(run, CLIP_TEXT.notInBuild, [], true);
    }
    json = JSON.parse(await res.text());
  } catch {
    return fail(run, CLIP_TEXT.notInBuild, [], true); // includes an abort, which fail drops
  }
  if (run.stale()) return null;

  const { registry } = store.getState().camera;
  const parsed = parseClipSidecar(json, registry, options.nowMs ?? Date.now());
  if (!parsed.ok) return fail(run, CLIP_TEXT.problems, parsed.errors);
  const { sidecar } = parsed;
  const camera = clipCamera(entry, sidecar, clipVideoUrl(sidecarAbsUrl, sidecar), registry);
  if (camera === null)
    return fail(
      run,
      `The sidecar's cameraId (${sidecar.cameraId}) does not match this clip camera.`,
    );

  let playable: { url: string; objectUrl: string | null } | null;
  try {
    playable = await playableClipUrl(camera.source.videoUrl ?? "", fetchFn, options);
  } catch {
    playable = null;
  }
  if (run.stale()) {
    revokeWith(options)(playable?.objectUrl ?? null);
    return null;
  }
  if (playable === null) return fail(run, CLIP_TEXT.notInBuild, [], true);
  return commitClip(
    run,
    { ...camera, source: { ...camera.source, videoUrl: playable.url } },
    sidecar,
    json as Readonly<Record<string, unknown>>,
    sidecar.videoFile,
    playable.objectUrl,
    [],
    false,
  );
}

const isJsonFile = (f: File): boolean => /\.json$/i.test(f.name) || f.type === "application/json";
const isVideoFile = (f: File): boolean => !isJsonFile(f) && f.type.startsWith("video/");

/**
 * [M5] Loads picked files on local-replay (or the active local-video camera without a sidecarUrl): exactly one video
 * and one .json sidecar (M5 step 10.5). The sidecar's calibration is always imported: picked files are a new clip.
 * A sidecar that names another file only adds a note. While no clip is on screen, failures set video status "error".
 */
export async function loadClip(
  files: Iterable<File> | ArrayLike<File>,
  store: AppStore,
  options: ClipLoadOptions = {},
): Promise<ClipLoadState | null> {
  const s = store.getState();
  const active = s.camera.registry[s.camera.activeId];
  const cameraId =
    active?.kind === "local-video" && active.source.sidecarUrl === null
      ? active.id
      : LOCAL_REPLAY_ID;
  const entry = s.camera.registry[cameraId];
  if (entry?.kind !== "local-video") return null;
  const run = startRun(store, cameraId, options);
  const onScreen = clipOnScreen(store, cameraId);
  begin(run, onScreen === null);

  const list = Array.from(files);
  const videos = list.filter(isVideoFile);
  const sidecars = list.filter(isJsonFile);
  const video = videos[0];
  const sidecarFile = sidecars[0];
  if (list.length !== 2 || video === undefined || sidecarFile === undefined)
    return fail(run, CLIP_TEXT.pickBoth);

  let json: unknown;
  try {
    json = JSON.parse(await sidecarFile.text());
  } catch {
    return fail(run, CLIP_TEXT.problems, [CLIP_TEXT.notJson]);
  }
  if (run.stale()) return null;
  const { registry } = store.getState().camera;
  const parsed = parseClipSidecar(json, registry, options.nowMs ?? Date.now());
  if (!parsed.ok) return fail(run, CLIP_TEXT.problems, parsed.errors);
  const { sidecar } = parsed;
  const notes =
    sidecar.videoFile === video.name
      ? []
      : [`The sidecar names ${sidecar.videoFile}; playing ${video.name}.`];
  const objectUrl = (options.createObjectUrl ?? URL.createObjectURL)(video);
  const camera = clipCamera(entry, sidecar, objectUrl, registry);
  if (camera === null) {
    revokeWith(options)(objectUrl);
    return fail(
      run,
      `The sidecar's cameraId (${sidecar.cameraId}) does not match this clip camera.`,
    );
  }
  return commitClip(
    run,
    camera,
    sidecar,
    json as Readonly<Record<string, unknown>>,
    video.name,
    objectUrl,
    notes,
    true,
  );
}

/**
 * [M5] "Copy pointing to <source camera>" (M5 step 10.7): the clip camera's calibration becomes its source camera's,
 * which keeps its own stream delay; only the geometry moves. false when the clip has no source camera, or the source
 * camera refused the calibration.
 */
export function copyClipPointing(store: AppStore, clipCameraId: string): boolean {
  const s = store.getState();
  const clip = s.camera.registry[clipCameraId];
  if (clip?.kind !== "local-video" || clip.source.sourceCameraId === null) return false;
  const sourceId = clip.source.sourceCameraId;
  const source = s.camera.registry[sourceId];
  if (source === undefined) return false;
  const calibration = s.camera.calibration[clipCameraId] ?? clip.defaults;
  const before = s.camera.calibration[sourceId];
  const streamDelayMs = (before ?? source.defaults).streamDelayMs;
  s.actions.importCalibration(sourceId, { ...calibration, streamDelayMs });
  return store.getState().camera.calibration[sourceId] !== before;
}

// ---- [Redesign] The clip loader, and the clip's position and length for the control bar ----

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * [Redesign] Whether a clip that has just opened starts playing (muted: bindBackground's <video> always is): yes,
 * unless the visitor asks for reduced motion (then it opens paused) or the tour runs (its steps play the clip
 * themselves). No matchMedia (Node): yes.
 */
export function clipAutoplay(state: AppState): boolean {
  if (state.ui.demo.active) return false;
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION).matches;
  return !reduced;
}

/** [Redesign] startClipLoader's options: the load's, a fetch, and the autoplay rule (clipAutoplay by default). */
export interface ClipLoaderOptions extends Pick<ClipLoadOptions, "baseHref" | "probe"> {
  readonly fetchFn?: typeof fetch;
  readonly autoplay?: (state: AppState) => boolean;
}

/**
 * [Redesign] The active camera's clip, loaded from its sidecar URL on each activation (M5 step 10.4), from main.tsx
 * rather than from a component, so the clip loads whatever the layout renders. Subscribes to the active camera and
 * the registry: an activation of a clip camera that has not loaded starts loadClipFromSidecarUrl with its own
 * AbortController (a camera change aborts it); an activation of a clip that has loaded brings the clock back to the
 * clip's opening time when the clock is outside it (as after "Watch the recorded ISS pass" from live). A failed load
 * is retried on the next activation. Once the clip is open (loaded, or activated again), it plays when `autoplay`
 * says so (clipAutoplay: not with reduced motion, not during the tour), muted. Returns the stop function.
 */
export function startClipLoader(store: AppStore, options: ClipLoaderOptions = {}): () => void {
  const { fetchFn, autoplay = clipAutoplay, ...loadOptions } = options;
  /** The camera of the current activation, once its registry entry is known. */
  let activated: string | null = null;
  let controller: AbortController | null = null;
  let stopped = false;

  /** Plays the clip of this activation, if it is still the active one, loaded, paused and wanted playing. */
  const startPlaying = (id: string, activation: AbortController): void => {
    const s = store.getState();
    if (stopped || activation.signal.aborted || s.camera.activeId !== id) return;
    const camera = s.camera.registry[id];
    if (camera?.kind !== "local-video" || camera.source.videoUrl === null) return;
    if (s.clock.playing || !autoplay(s)) return;
    s.actions.play();
  };

  const onChange = (): void => {
    const s = store.getState();
    const id = s.camera.activeId;
    if (id === activated) return; // the same activation (its own commit replaces the registry entry)
    controller?.abort();
    controller = null;
    const camera = s.camera.registry[id];
    activated = camera === undefined ? null : id;
    if (camera?.kind !== "local-video" || camera.source.sidecarUrl === null) return;
    const activation = new AbortController();
    controller = activation;
    const { startUtcMs, videoUrl } = camera.source;
    if (videoUrl === null || startUtcMs === null) {
      void loadClipFromSidecarUrl(store, id, fetchFn ?? fetch, {
        ...loadOptions,
        signal: activation.signal,
      }).then((result) => {
        if (result?.clip != null && result.failure === null) startPlaying(id, activation);
      });
      return;
    }
    const clip = loadStates.get(id)?.clip;
    if (clip === undefined || clip === null) return;
    const { simTimeMs } = s.clock;
    if (simTimeMs < startUtcMs || simTimeMs > localVideoTimeMs(startUtcMs, clip.probe.durationS))
      s.actions.recenter(localVideoTimeMs(startUtcMs, clipOpenMediaS(clip.sidecar)));
    // After the activation: activateCamera pauses the clock once setActiveCamera (and this listener) returns.
    queueMicrotask(() => startPlaying(id, activation));
  };

  const unsubscribe = store.subscribe(
    (s) => [s.camera.activeId, s.camera.registry] as const,
    onChange,
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );
  onChange();
  return () => {
    stopped = true;
    unsubscribe();
    controller?.abort();
    controller = null;
    activated = null;
  };
}

/** [Redesign] The active camera's loaded clip and its start, or null (not a clip camera, or not loaded). */
function activeClip(
  state: AppState,
): { readonly startUtcMs: number; readonly clip: LoadedClip } | null {
  const camera = state.camera.registry[state.camera.activeId];
  if (camera?.kind !== "local-video") return null;
  const { startUtcMs, videoUrl } = camera.source;
  const clip = loadStates.get(camera.id)?.clip ?? null;
  return startUtcMs === null || videoUrl === null || clip === null ? null : { startUtcMs, clip };
}

/**
 * [Redesign] The active clip's position and length in media seconds, for the control bar's scrubber and "1:35 / 8:00";
 * null unless the active camera is a clip that has loaded. The position is the store's time, clamped to the clip. A
 * new object per call: read it during a 4 Hz render (useTick4Hz), never through useAppState.
 */
export function clipProgress(
  state: AppState,
): { readonly positionS: number; readonly durationS: number } | null {
  const active = activeClip(state);
  if (active === null) return null;
  const { durationS } = active.clip.probe;
  const positionS = Math.min(
    Math.max((state.clock.simTimeMs - active.startUtcMs) / 1000, 0),
    durationS,
  );
  return { positionS, durationS };
}

/** [Redesign] The scrubber: seek the active clip to media positionS, clamped to the clip; nothing without one. */
export function seekClipTo(store: AppStore, positionS: number): void {
  const s = store.getState();
  const active = activeClip(s);
  if (active === null || !Number.isFinite(positionS)) return;
  const clamped = Math.min(Math.max(positionS, 0), active.clip.probe.durationS);
  s.actions.seek(localVideoTimeMs(active.startUtcMs, clamped));
}
