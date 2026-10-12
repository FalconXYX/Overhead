// src/app/persist.ts — calibrations in localStorage, calibration files (M4 step 8), and the GeoPose export and import
// payloads of the Calibration panel (M4 step 14.6).
// Every getItem, setItem and JSON.parse sits inside try/catch: a failure means defaults (README "URL and
// persistence", Errors rule 7). The storage is passed in: window.localStorage in the app (browserStorage()), a
// Map-backed stub in tests.
import {
  type Calibration,
  createCameraModel,
  fromGeoPose,
  type GeoPoseBasicYpr,
  type GeoPoseValidation,
  type LensModel,
  toGeoPose,
  validateGeoPose,
} from "../domain/camera";
import { wrap180 } from "../domain/geo";
import { isoUtcSeconds } from "../domain/time";
import { CALIBRATION_NUMBER_FIELDS, calibrationDistortionValid } from "../state/calibrationWrite";
import { selectActiveCamera, selectCalibration } from "../state/selectors";
import type { AppStore } from "../state/store";
import type {
  AppState,
  CameraConfig,
  PlanetId,
  PlanetName,
  StarId,
  StarPair,
} from "../state/types";

/** localStorage key of the whole `camera.calibration` record. */
export const CALIBRATION_STORAGE_KEY = "overhead.calibration.v1";
export const CALIBRATION_FILE_FORMAT = "overhead.calibration";
export const CALIBRATION_FILE_VERSION = 1;

/** The part of Storage that persist.ts uses. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** One star pair as a file holds it: the click and its target; residuals are recomputed, never stored. */
export interface CalibrationFilePair {
  imagePx: readonly [uPx: number, vPx: number];
  targetId: StarId | PlanetId;
  role: StarPair["role"];
}

/** An exported calibration (M4 step 8). Import uses only the calibration; the pairs serve review and the fixture. */
export interface CalibrationFileV1 {
  format: typeof CALIBRATION_FILE_FORMAT;
  version: typeof CALIBRATION_FILE_VERSION;
  exportedAtMs: number;
  cameraId: string;
  lens: LensModel;
  imageSize: { widthPx: number; heightPx: number };
  frameTimeMs: number | null; // capture time of the frame the pairs were clicked on
  calibration: Calibration;
  pairs: CalibrationFilePair[];
}

type Json = Record<string, unknown>;
type Registry = Readonly<Record<string, CameraConfig>>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cameraOf = (registry: Registry, id: unknown): CameraConfig | undefined =>
  typeof id === "string" && Object.hasOwn(registry, id) ? registry[id] : undefined;

/** Every PlanetName, so a name added to the type must be added here (planet target ids). */
const PLANETS: Readonly<Record<PlanetName, true>> = {
  Mercury: true,
  Venus: true,
  Mars: true,
  Jupiter: true,
  Saturn: true,
  Uranus: true,
};
/** BSC5 HR numbers run 1–9110 (README parseObjectId). */
const MAX_HR = 9110;

function isTargetId(v: unknown): v is StarId | PlanetId {
  if (typeof v !== "string") return false;
  const star = /^star:([1-9]\d{0,3})$/.exec(v);
  if (star !== null) return Number(star[1]) <= MAX_HR;
  const planet = /^planet:([A-Za-z]+)$/.exec(v);
  return planet !== null && Object.hasOwn(PLANETS, planet[1] ?? "");
}

/** Type problems of a stored or imported calibration: all 12 fields typed, focalPx > 0. Prefixed with `path`. */
function calibrationProblems(value: unknown, path: string): string[] {
  if (!isObject(value)) return [`${path} must be an object`];
  const problems: string[] = [];
  for (const key of CALIBRATION_NUMBER_FIELDS) {
    if (!isFiniteNumber(value[key])) problems.push(`${path}.${key} must be a finite number`);
  }
  if (isFiniteNumber(value.focalPx) && value.focalPx <= 0)
    problems.push(`${path}.focalPx must be > 0`);
  if (typeof value.flipX !== "boolean") problems.push(`${path}.flipX must be a boolean`);
  if (value.rmsDeg !== null && !isFiniteNumber(value.rmsDeg))
    problems.push(`${path}.rmsDeg must be a number or null`);
  return problems;
}

/** The 12 Calibration fields of a value that passed calibrationProblems; any other key is dropped. */
function pickCalibration(v: Json): Calibration {
  return {
    azDeg: v.azDeg as number,
    altDeg: v.altDeg as number,
    rollDeg: v.rollDeg as number,
    focalPx: v.focalPx as number,
    cxPx: v.cxPx as number,
    cyPx: v.cyPx as number,
    k1: v.k1 as number,
    k2: v.k2 as number,
    flipX: v.flipX as boolean,
    streamDelayMs: v.streamDelayMs as number,
    rmsDeg: v.rmsDeg as number | null,
    updatedAtMs: v.updatedAtMs as number,
  };
}

/** window.localStorage, or null without a window or when reading the property throws (blocked site data). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // SecurityError
  }
}

/**
 * The stored calibrations worth keeping: entries whose camera id is in `registry`, with all 12 fields typed (finite
 * numbers, boolean flipX, number or null rmsDeg, focalPx > 0) and distortionValid for that camera's model. Anything
 * else, a missing key, malformed JSON or a throwing storage gives {} or drops the entry; it never throws.
 */
export function loadCalibrations(
  storage: StorageLike | null,
  registry: Registry,
): Record<string, Calibration> {
  const out: Record<string, Calibration> = {};
  if (storage === null) return out;
  let parsed: unknown;
  try {
    const raw = storage.getItem(CALIBRATION_STORAGE_KEY);
    if (raw === null) return out;
    parsed = JSON.parse(raw);
  } catch {
    return out; // storage blocked, or a corrupt value: defaults
  }
  if (!isObject(parsed)) return out;
  for (const [id, value] of Object.entries(parsed)) {
    const camera = cameraOf(registry, id);
    if (camera === undefined || !isObject(value) || calibrationProblems(value, id).length > 0)
      continue;
    const calibration = pickCalibration(value);
    if (calibrationDistortionValid(camera, calibration)) out[id] = calibration;
  }
  return out;
}

/**
 * main.tsx, after setRegistry and before the first render: importCalibration for every stored entry that
 * loadCalibrations keeps (importCalibration normalizes and checks it again). Returns how many were applied.
 */
export function restoreCalibrations(store: AppStore, storage: StorageLike | null): number {
  const { actions, camera } = store.getState();
  let applied = 0;
  for (const [id, calibration] of Object.entries(loadCalibrations(storage, camera.registry))) {
    const before = store.getState().camera.calibration;
    actions.importCalibration(id, calibration);
    if (store.getState().camera.calibration !== before) applied += 1;
  }
  return applied;
}

/**
 * Writes the whole `camera.calibration` record to CALIBRATION_STORAGE_KEY on every change (one small JSON string, so
 * no throttle). Not on subscribe: restoreCalibrations runs first. A failing setItem (quota, blocked storage) is
 * ignored. Returns the unsubscribe function.
 */
export function startCalibrationPersistence(
  store: AppStore,
  storage: StorageLike | null,
): () => void {
  return store.subscribe(
    (s) => s.camera.calibration,
    (calibration) => {
      if (storage === null) return;
      try {
        storage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
      } catch {
        // QuotaExceededError or SecurityError: the session keeps working on what it has
      }
    },
  );
}

/** The active camera's calibration file, or null while its registry entry is missing. */
export function buildCalibrationFile(state: AppState, nowMs: number): CalibrationFileV1 | null {
  const camera = selectActiveCamera(state);
  const calibration = selectCalibration(state);
  if (camera === undefined || calibration === undefined) return null;
  return {
    format: CALIBRATION_FILE_FORMAT,
    version: CALIBRATION_FILE_VERSION,
    exportedAtMs: nowMs,
    cameraId: camera.id,
    lens: camera.lens,
    imageSize: { widthPx: camera.imageSize.widthPx, heightPx: camera.imageSize.heightPx },
    frameTimeMs: state.camera.frameTimeMs,
    calibration: { ...calibration },
    pairs: state.calibrationUi.pairs.map((p) => ({
      imagePx: [p.imagePx[0], p.imagePx[1]],
      targetId: p.targetId,
      role: p.role,
    })),
  };
}

/** "overhead-calibration-<cameraId>-<YYYYMMDDTHHMMSSZ>.json". */
export function calibrationFileName(cameraId: string, nowMs: number): string {
  return `overhead-calibration-${cameraId}-${isoUtcSeconds(nowMs).replace(/[-:]/g, "")}.json`;
}

/** "geopose-<cameraId>.json". */
export function geoPoseFileName(cameraId: string): string {
  return `geopose-${cameraId}.json`;
}

/** Saves `value` as pretty JSON through a Blob, an object URL and a clicked <a download>, then revokes the URL. */
export function downloadJsonFile(fileName: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0); // after the click has handed the blob to the download
}

/**
 * Checks a calibration file (its text, or the value JSON.parse gave): format "overhead.calibration", version 1, a
 * known camera id, that camera's lens and image size, the field types (pairs included) and distortionValid for the
 * camera's model. Lists every problem; never throws. The panel then calls importCalibration(file.cameraId,
 * file.calibration) and ignores the pairs.
 */
export function parseCalibrationFile(
  json: unknown,
  registry: Registry,
): { ok: true; file: CalibrationFileV1 } | { ok: false; errors: string[] } {
  let value = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch {
      return { ok: false, errors: ["The file is not valid JSON."] };
    }
  }
  if (!isObject(value)) return { ok: false, errors: ["The file is not a JSON object."] };
  const errors: string[] = [];
  if (value.format !== CALIBRATION_FILE_FORMAT)
    errors.push(`format must be "${CALIBRATION_FILE_FORMAT}"`);
  if (value.version !== CALIBRATION_FILE_VERSION)
    errors.push(`version must be ${CALIBRATION_FILE_VERSION}`);
  if (!isFiniteNumber(value.exportedAtMs)) errors.push("exportedAtMs must be a finite number");
  if (value.frameTimeMs !== null && !isFiniteNumber(value.frameTimeMs))
    errors.push("frameTimeMs must be a number or null");

  const camera = cameraOf(registry, value.cameraId);
  if (camera === undefined) {
    errors.push(`cameraId ${JSON.stringify(value.cameraId)} is not a camera in this app`);
  } else {
    if (value.lens !== camera.lens)
      errors.push(
        `lens ${JSON.stringify(value.lens)} does not match ${camera.name}, whose lens is "${camera.lens}"`,
      );
    const size = value.imageSize;
    const { widthPx, heightPx } = camera.imageSize;
    if (!isObject(size) || !isFiniteNumber(size.widthPx) || !isFiniteNumber(size.heightPx)) {
      errors.push("imageSize must hold widthPx and heightPx");
    } else if (size.widthPx !== widthPx || size.heightPx !== heightPx) {
      errors.push(
        `imageSize ${size.widthPx} × ${size.heightPx} px does not match ${camera.name}, which is ${widthPx} × ${heightPx} px`,
      );
    }
  }

  const typeProblems = calibrationProblems(value.calibration, "calibration");
  errors.push(...typeProblems);
  if (
    camera !== undefined &&
    typeProblems.length === 0 &&
    isObject(value.calibration) &&
    !calibrationDistortionValid(camera, pickCalibration(value.calibration))
  )
    errors.push(
      `calibration k1 ${String(value.calibration.k1)} and k2 ${String(value.calibration.k2)} fold the image inside the frame (distortion slope below the limit)`,
    );

  const pairs: CalibrationFilePair[] = [];
  if (!Array.isArray(value.pairs)) {
    errors.push("pairs must be an array");
  } else {
    value.pairs.forEach((p: unknown, i) => {
      const at = `pairs[${i}]`;
      if (!isObject(p)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const px = p.imagePx;
      const pxOk =
        Array.isArray(px) && px.length === 2 && isFiniteNumber(px[0]) && isFiniteNumber(px[1]);
      if (!pxOk) errors.push(`${at}.imagePx must be [u, v] in finite pixels`);
      if (!isTargetId(p.targetId))
        errors.push(`${at}.targetId must be "star:<HR 1–9110>" or "planet:<name>"`);
      if (p.role !== "fit" && p.role !== "holdout")
        errors.push(`${at}.role must be "fit" or "holdout"`);
      if (pxOk && isTargetId(p.targetId) && (p.role === "fit" || p.role === "holdout"))
        pairs.push({ imagePx: [px[0], px[1]], targetId: p.targetId, role: p.role });
    });
  }

  if (errors.length > 0 || camera === undefined || !isObject(value.calibration))
    return { ok: false, errors };
  return {
    ok: true,
    file: {
      format: CALIBRATION_FILE_FORMAT,
      version: CALIBRATION_FILE_VERSION,
      exportedAtMs: value.exportedAtMs as number,
      cameraId: camera.id,
      lens: camera.lens,
      imageSize: { widthPx: camera.imageSize.widthPx, heightPx: camera.imageSize.heightPx },
      frameTimeMs: value.frameTimeMs as number | null,
      calibration: pickCalibration(value.calibration),
      pairs,
    },
  };
}

// ---- GeoPose (M4 step 14.6; docs/DECISIONS.md "GeoPose") ----

/** The pose convention written into every export (OGC's own examples use another one). */
export const GEOPOSE_CONVENTION =
  "R = Rz(yaw)·Ry(pitch)·Rx(roll) from local ENU; body x = optical axis, y = image left, z = image up; " +
  "yaw = 90° − optical-axis azimuth, pitch = −optical-axis altitude, roll = image roll; " +
  "a zenith-locked fisheye exports (90, −90, roll); a horizontal image flip is not part of the pose";
/** How position.h was made. */
export const GEOPOSE_HEIGHT_DATUM =
  "WGS 84 ellipsoid: site height above mean sea level + geoid separation";
/** Import warns when the pose's position is farther than this from the camera site. */
export const GEOPOSE_WARN_DEG = 0.01;
export const GEOPOSE_WARN_M = 100;

/** A GeoPose Basic-YPR export plus the extra "x-overhead" member (the schema allows extra properties). */
export interface GeoPoseExport extends GeoPoseBasicYpr {
  "x-overhead": {
    cameraId: string;
    lens: LensModel;
    convention: string;
    heightDatum: string;
  };
}

/** [M9] The error when ajv's chunk cannot be loaded (validateGeoPose rejects). */
export const GEOPOSE_VALIDATOR_UNAVAILABLE =
  "The GeoPose validator could not be loaded; check the connection and try again.";

/** [M9] validateGeoPose, with a failed load of ajv reported as a validation error. */
async function validated(value: unknown): Promise<GeoPoseValidation> {
  try {
    return await validateGeoPose(value);
  } catch {
    return { ok: false, errors: [GEOPOSE_VALIDATOR_UNAVAILABLE] };
  }
}

/**
 * "Export GeoPose": toGeoPose(lat, lon, heightM + geoidSepM, calibration, zenithLocked) plus "x-overhead", then
 * validateGeoPose. On failure the panel shows the errors and downloads nothing. [M9] Async: validateGeoPose loads
 * ajv on its first call (M9 step 7).
 */
export async function buildGeoPoseExport(
  camera: CameraConfig,
  calibration: Calibration,
): Promise<{ ok: true; pose: GeoPoseExport } | { ok: false; errors: string[] }> {
  const { site } = camera;
  const { zenithLocked } = createCameraModel({
    lens: camera.lens,
    calibration,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
  });
  const pose = toGeoPose(
    site.latDeg,
    site.lonDeg,
    site.heightM + site.geoidSepM,
    calibration,
    zenithLocked,
  );
  const payload: GeoPoseExport = {
    ...pose,
    "x-overhead": {
      cameraId: camera.id,
      lens: camera.lens,
      convention: GEOPOSE_CONVENTION,
      heightDatum: GEOPOSE_HEIGHT_DATUM,
    },
  };
  const result = await validated(payload);
  return result.ok ? { ok: true, pose: payload } : result;
}

/**
 * "Import GeoPose" (its text or parsed value): validateGeoPose, then the pointing from the rotation matrix
 * (fromGeoPose), which the panel applies through updateCalibration. Warns when the position is more than 0.01° or
 * 100 m from the camera site (h compared with heightM + geoidSepM); the position itself is never applied.
 * [M9] Async, as buildGeoPoseExport.
 */
export async function parseGeoPoseImport(
  json: unknown,
  camera: CameraConfig,
): Promise<
  | {
      ok: true;
      pointing: { azDeg: number; altDeg: number; rollDeg: number };
      warnings: string[];
    }
  | { ok: false; errors: string[] }
> {
  let value = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch {
      return { ok: false, errors: ["The file is not valid JSON."] };
    }
  }
  const result = await validated(value);
  if (!result.ok) return result;
  const { position } = result.pose;
  const { site } = camera;
  const warnings: string[] = [];
  const dLat = Math.abs(position.lat - site.latDeg);
  const dLon = Math.abs(wrap180(position.lon - site.lonDeg));
  if (dLat > GEOPOSE_WARN_DEG || dLon > GEOPOSE_WARN_DEG)
    warnings.push(
      `The pose's position is ${dLat.toFixed(4)}° in latitude and ${dLon.toFixed(4)}° in longitude from ${camera.name}; only its angles are applied.`,
    );
  const dH = Math.abs(position.h - (site.heightM + site.geoidSepM));
  if (dH > GEOPOSE_WARN_M)
    warnings.push(
      `The pose's height is ${dH.toFixed(0)} m from ${camera.name}'s; only its angles are applied.`,
    );
  return { ok: true, pointing: fromGeoPose(result.pose), warnings };
}
