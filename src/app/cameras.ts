// src/app/cameras.ts — validation of public/data/cameras.json and the ids that reach the store (M1 step 5).
import { DEFAULT_CAMERA_ID } from "../state/initialState";
import { type CameraConfig, STILL_IMAGE_MIN_REFRESH_SEC } from "../state/types";

/** Ids that reach the store; the milestone that enables an entry adds it (README camera registry). */
export const ENABLED_CAMERA_IDS: readonly string[] = ["synthetic-maunakea"];

const KINDS = ["synthetic", "still-image", "youtube", "local-video"] as const;
const LENSES = [
  "rectilinear",
  "fisheye-equidistant",
  "fisheye-equisolid",
  "fisheye-stereographic",
  "fisheye-orthographic",
] as const;
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
] as const;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStringOrNull = (v: unknown): boolean => v === null || typeof v === "string";
const isPositiveInteger = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0;
const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

function isValidTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== "string" || timeZone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false; // RangeError: invalid time zone
  }
}

/** Problems of one entry, each prefixed with its label. */
function entryProblems(entry: Json, label: string): string[] {
  const problems: string[] = [];
  const bad = (what: string): void => {
    problems.push(`${label}: ${what}`);
  };

  if (typeof entry.name !== "string" || entry.name === "") bad("name must be a non-empty string");

  // kind and source
  const { kind, source } = entry;
  if (!includes(KINDS, kind)) {
    bad(`kind must be one of ${KINDS.join(", ")}`);
  } else if (kind === "synthetic") {
    if (source !== null) bad("source must be null for a synthetic camera");
  } else if (!isObject(source)) {
    bad(`source must be an object for a ${kind} camera`);
  } else if (kind === "still-image") {
    if (typeof source.imageUrl !== "string" || !source.imageUrl.startsWith("https://"))
      bad("source.imageUrl must start with https://");
    if (!isFiniteNumber(source.refreshSec) || source.refreshSec < STILL_IMAGE_MIN_REFRESH_SEC)
      bad(`source.refreshSec must be at least ${STILL_IMAGE_MIN_REFRESH_SEC}`);
    if (typeof source.corsEnabled !== "boolean") bad("source.corsEnabled must be a boolean");
    if (!isFiniteNumber(source.captureLagMs) || source.captureLagMs < 0)
      bad("source.captureLagMs must be a number ≥ 0");
    if (!isFiniteNumber(source.exposureSec) || source.exposureSec < 0)
      bad("source.exposureSec must be a number ≥ 0");
  } else if (kind === "youtube") {
    if (
      typeof source.youtubeVideoId !== "string" ||
      !/^[A-Za-z0-9_-]{11}$/.test(source.youtubeVideoId)
    )
      bad("source.youtubeVideoId must be an 11-character YouTube id");
    if (!isStringOrNull(source.resolverUrl)) bad("source.resolverUrl must be a string or null");
  } else {
    for (const key of ["sidecarUrl", "sourceCameraId", "videoUrl"] as const) {
      if (!isStringOrNull(source[key])) bad(`source.${key} must be a string or null`);
    }
    if (!(source.startUtcMs === null || isFiniteNumber(source.startUtcMs)))
      bad("source.startUtcMs must be a number or null");
  }

  // site
  const { site } = entry;
  if (!isObject(site)) {
    bad("site must be an object");
  } else {
    if (!isFiniteNumber(site.latDeg) || Math.abs(site.latDeg) > 90)
      bad("site.latDeg must lie within ±90");
    if (!isFiniteNumber(site.lonDeg) || Math.abs(site.lonDeg) > 180)
      bad("site.lonDeg must lie within ±180");
    if (!isFiniteNumber(site.heightM)) bad("site.heightM must be a finite number");
    if (!isFiniteNumber(site.geoidSepM)) bad("site.geoidSepM must be a finite number");
    if (!isFiniteNumber(site.mastM) || site.mastM < 0) bad("site.mastM must be a number ≥ 0");
    if (!isValidTimeZone(site.timeZone))
      bad(`site.timeZone ${JSON.stringify(site.timeZone)} is not an IANA time zone`);
  }

  // image and lens
  const { imageSize } = entry;
  const imageOk =
    isObject(imageSize) &&
    isPositiveInteger(imageSize.widthPx) &&
    isPositiveInteger(imageSize.heightPx);
  if (!imageOk) bad("imageSize.widthPx and imageSize.heightPx must be positive integers");
  if (!includes(LENSES, entry.lens)) bad(`lens must be one of ${LENSES.join(", ")}`);

  // defaults: the 12 Calibration fields
  const { defaults } = entry;
  if (!isObject(defaults)) {
    bad("defaults must be an object");
  } else {
    for (const key of CALIBRATION_NUMBERS) {
      if (!isFiniteNumber(defaults[key])) bad(`defaults.${key} must be a finite number`);
    }
    if (typeof defaults.flipX !== "boolean") bad("defaults.flipX must be a boolean");
    if (!(defaults.rmsDeg === null || isFiniteNumber(defaults.rmsDeg)))
      bad("defaults.rmsDeg must be a number or null");
    if (isFiniteNumber(defaults.focalPx) && defaults.focalPx <= 0)
      bad("defaults.focalPx must be > 0");
    if (
      imageOk &&
      isFiniteNumber(defaults.cxPx) &&
      isFiniteNumber(defaults.cyPx) &&
      (defaults.cxPx < 0 ||
        defaults.cxPx > (imageSize.widthPx as number) ||
        defaults.cyPx < 0 ||
        defaults.cyPx > (imageSize.heightPx as number))
    )
      bad("the principal point (defaults.cxPx, defaults.cyPx) lies outside the image");
  }

  // credit and terms
  const { credit } = entry;
  if (!isObject(credit)) {
    bad("credit must be an object");
  } else {
    if (typeof credit.text !== "string" || credit.text === "") bad("credit.text must not be empty");
    for (const key of ["href", "licence", "licenceHref"] as const) {
      if (!isStringOrNull(credit[key])) bad(`credit.${key} must be a string or null`);
    }
  }
  if (typeof entry.termsNote !== "string") bad("termsNote must be a string");

  return problems;
}

/** Entries keyed by id in file order. Throws one Error listing every problem (README Errors rule 2). */
export function parseCameraRegistry(json: unknown): Record<string, CameraConfig> {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error("cameras.json: expected a non-empty array");
  }
  const problems: string[] = [];
  const registry: Record<string, CameraConfig> = {};
  const seen = new Set<string>();
  json.forEach((entry: unknown, index) => {
    if (!isObject(entry)) {
      problems.push(`entry ${index}: expected an object`);
      return;
    }
    const { id } = entry;
    const label = typeof id === "string" ? `entry ${index} (${id})` : `entry ${index}`;
    if (typeof id !== "string" || id === "") {
      problems.push(`${label}: id is missing`);
    } else if (!/^[a-z0-9-]+$/.test(id)) {
      problems.push(`${label}: id ${JSON.stringify(id)} must match /^[a-z0-9-]+$/`);
    } else if (seen.has(id)) {
      problems.push(`${label}: duplicate id ${id}`);
    }
    problems.push(...entryProblems(entry, label));
    if (typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      registry[id] = entry as unknown as CameraConfig;
    }
  });
  if (!seen.has(DEFAULT_CAMERA_ID))
    problems.push(`the default camera ${DEFAULT_CAMERA_ID} is missing`);
  if (problems.length > 0) throw new Error(`cameras.json: ${problems.join("; ")}`);
  return registry;
}

/** The enabled subset, in file order. */
export function enabledCameras(all: Record<string, CameraConfig>): Record<string, CameraConfig> {
  const enabled: Record<string, CameraConfig> = {};
  for (const [id, camera] of Object.entries(all)) {
    if (ENABLED_CAMERA_IDS.includes(id)) enabled[id] = camera;
  }
  return enabled;
}
