// src/app/cameras.ts — validation of public/data/cameras.json and the ids that reach the store (M1 step 5).
import { DEFAULT_CAMERA_ID } from "../state/initialState";
import {
  type Calibration,
  type CameraConfig,
  type CameraKind,
  type CameraSite,
  type Credit,
  STILL_IMAGE_MIN_REFRESH_SEC,
} from "../state/types";

/** [Redesign] The recorded ISS pass: the default camera (DEFAULT_CAMERA_ID) and "Watch the recorded ISS pass". */
export const RECORDED_CLIP_ID = "subaru-2026-10-11-iss";
/** [Redesign] The camera "Watch live" switches to: the live Subaru StarCam, the clip's own source camera. */
export const LIVE_CAMERA_ID = "subaru-starcam";

/**
 * Ids that reach the store, in the order the header's switcher lists them. [Redesign] Only cameras with a video: the
 * recorded ISS pass (loads where recordings/ is served or the deploy copied the clip; else ClipControls says it is
 * missing and offers "Watch live") and the two live StarCams. The computed skies (synthetic-maunakea,
 * synthetic-walenstadt), local-replay (picked files), cfht-nanaao (a still image) and ask053-walenstadt keep their
 * cameras.json entries for the unit tests, but never reach the store.
 */
export const ENABLED_CAMERA_IDS: readonly string[] = [
  RECORDED_CLIP_ID,
  LIVE_CAMERA_ID,
  "cfht-starcam",
];

const KINDS = ["synthetic", "still-image", "youtube", "local-video"] as const;
const LENSES = [
  "rectilinear",
  "fisheye-equidistant",
  "fisheye-equisolid",
  "fisheye-stereographic",
  "fisheye-orthographic",
] as const;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
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

/** A test of one field's value, and the problem to report when it fails. */
type Check = readonly [ok: (v: unknown) => boolean, problem: string];
/** One Check per field of T, so a field added to T must be checked here too. */
type Fields<T> = { readonly [K in keyof T]: Check };

const FINITE: Check = [isFiniteNumber, "must be a finite number"];
const NON_NEGATIVE: Check = [(v) => isFiniteNumber(v) && v >= 0, "must be a number ≥ 0"];
const BOOLEAN: Check = [(v) => typeof v === "boolean", "must be a boolean"];
const STRING_OR_NULL: Check = [
  (v) => v === null || typeof v === "string",
  "must be a string or null",
];
const NUMBER_OR_NULL: Check = [(v) => v === null || isFiniteNumber(v), "must be a number or null"];
/** [M5] videoUrl and startUtcMs of a local-video entry: set at runtime when its clip loads, never in the file. */
const NULL_IN_FILE: Check = [
  (v) => v === null,
  "must be null in cameras.json (set when the clip loads)",
];

/** [M5] An absolute https: URL (the resolver pages are fetched cross-origin with CORS *). */
const isHttpsUrl = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false; // TypeError: not an absolute URL
  }
};
/** [M5] A path relative to BASE_URL ending in .json: no scheme, no leading / or \, so it stays under the base. */
const isRelativeJsonPath = (v: unknown): boolean =>
  typeof v === "string" &&
  v.endsWith(".json") &&
  !/^[/\\]/.test(v) &&
  !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v);

type SourceOf<K extends CameraKind> = Extract<CameraConfig, { kind: K }>["source"];

/** Every kind but synthetic, whose source is null. */
const SOURCE_FIELDS: { readonly [K in Exclude<CameraKind, "synthetic">]: Fields<SourceOf<K>> } = {
  "still-image": {
    imageUrl: [
      (v) => typeof v === "string" && v.startsWith("https://"),
      "must start with https://",
    ],
    refreshSec: [
      (v) => isFiniteNumber(v) && v >= STILL_IMAGE_MIN_REFRESH_SEC,
      `must be at least ${STILL_IMAGE_MIN_REFRESH_SEC}`,
    ],
    corsEnabled: BOOLEAN,
    captureLagMs: NON_NEGATIVE,
    exposureSec: NON_NEGATIVE,
  },
  youtube: {
    youtubeVideoId: [
      (v) => typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v),
      "must be an 11-character YouTube id",
    ],
    resolverUrl: [(v) => v === null || isHttpsUrl(v), "must be null or an https: URL"],
  },
  "local-video": {
    sidecarUrl: [
      (v) => v === null || isRelativeJsonPath(v),
      "must be null or a relative path ending in .json (no scheme, no leading /)",
    ],
    sourceCameraId: STRING_OR_NULL, // and the id of a youtube or still-image entry: checked across entries
    videoUrl: NULL_IN_FILE,
    startUtcMs: NULL_IN_FILE,
  },
};

/** timeZone is checked on its own: its problem quotes the bad value. */
const SITE_FIELDS: Fields<Omit<CameraSite, "timeZone">> = {
  latDeg: [(v) => isFiniteNumber(v) && Math.abs(v) <= 90, "must lie within ±90"],
  lonDeg: [(v) => isFiniteNumber(v) && Math.abs(v) <= 180, "must lie within ±180"],
  heightM: FINITE,
  geoidSepM: FINITE,
  mastM: NON_NEGATIVE,
};

const DEFAULTS_FIELDS: Fields<Calibration> = {
  azDeg: FINITE,
  altDeg: FINITE,
  rollDeg: FINITE,
  focalPx: FINITE,
  cxPx: FINITE,
  cyPx: FINITE,
  k1: FINITE,
  k2: FINITE,
  streamDelayMs: FINITE,
  updatedAtMs: FINITE,
  flipX: BOOLEAN,
  rmsDeg: NUMBER_OR_NULL,
};

const CREDIT_FIELDS: Fields<Credit> = {
  text: [(v) => typeof v === "string" && v !== "", "must not be empty"],
  href: STRING_OR_NULL,
  licence: STRING_OR_NULL,
  licenceHref: STRING_OR_NULL,
};

/** Problems of one entry, each prefixed with its label. */
function entryProblems(entry: Json, label: string): string[] {
  const problems: string[] = [];
  const bad = (what: string): void => {
    problems.push(`${label}: ${what}`);
  };
  /** Reports "<path> must be an object", or "<path>.<key> <problem>" for each failed Check. */
  const checkFields = (value: unknown, path: string, fields: Readonly<Record<string, Check>>) => {
    if (!isObject(value)) {
      bad(`${path} must be an object`);
      return;
    }
    for (const [key, [ok, problem]] of Object.entries(fields)) {
      if (!ok(value[key])) bad(`${path}.${key} ${problem}`);
    }
  };

  if (typeof entry.name !== "string" || entry.name === "") bad("name must be a non-empty string");
  // [Redesign] Optional plain names: the switcher's, the ground map's site label and [Polish] the switcher's place line.
  for (const key of ["shortName", "siteName", "placeName"] as const) {
    const value = entry[key];
    if (value !== undefined && (typeof value !== "string" || value === ""))
      bad(`${key} must be a non-empty string when present`);
  }

  // kind and source
  const { kind, source } = entry;
  if (!includes(KINDS, kind)) {
    bad(`kind must be one of ${KINDS.join(", ")}`);
  } else if (kind === "synthetic") {
    if (source !== null) bad("source must be null for a synthetic camera");
  } else if (!isObject(source)) {
    bad(`source must be an object for a ${kind} camera`);
  } else {
    checkFields(source, "source", SOURCE_FIELDS[kind]);
  }

  // site
  const { site } = entry;
  checkFields(site, "site", SITE_FIELDS);
  if (isObject(site) && !isValidTimeZone(site.timeZone))
    bad(`site.timeZone ${JSON.stringify(site.timeZone)} is not an IANA time zone`);

  // image and lens
  const { imageSize } = entry;
  const imageOk =
    isObject(imageSize) &&
    isPositiveInteger(imageSize.widthPx) &&
    isPositiveInteger(imageSize.heightPx);
  if (!imageOk) bad("imageSize.widthPx and imageSize.heightPx must be positive integers");
  if (!includes(LENSES, entry.lens)) bad(`lens must be one of ${LENSES.join(", ")}`);

  // defaults: the Calibration fields, then focalPx > 0 and the principal point
  const { defaults } = entry;
  checkFields(defaults, "defaults", DEFAULTS_FIELDS);
  if (isObject(defaults)) {
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
    // [M5] A clip is the master clock: it has no stream delay.
    if (
      kind === "local-video" &&
      isFiniteNumber(defaults.streamDelayMs) &&
      defaults.streamDelayMs !== 0
    )
      bad("defaults.streamDelayMs must be 0 for a local-video camera");
  }

  // credit and terms
  checkFields(entry.credit, "credit", CREDIT_FIELDS);
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
  /** [M5] local-video sourceCameraId values, checked once every entry is known. */
  const clipSources: { label: string; sourceCameraId: string }[] = [];
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
    const { source } = entry;
    if (
      entry.kind === "local-video" &&
      isObject(source) &&
      typeof source.sourceCameraId === "string"
    )
      clipSources.push({ label, sourceCameraId: source.sourceCameraId });
  });
  for (const { label, sourceCameraId } of clipSources) {
    const target = Object.hasOwn(registry, sourceCameraId) ? registry[sourceCameraId] : undefined;
    if (target?.kind !== "youtube" && target?.kind !== "still-image")
      problems.push(
        `${label}: source.sourceCameraId must be null or the id of a youtube or still-image camera in this file`,
      );
  }
  if (!seen.has(DEFAULT_CAMERA_ID))
    problems.push(`the default camera ${DEFAULT_CAMERA_ID} is missing`);
  if (problems.length > 0) throw new Error(`cameras.json: ${problems.join("; ")}`);
  return registry;
}

/** The enabled subset, [Redesign] in ENABLED_CAMERA_IDS order (the switcher's), skipping ids the file lacks. */
export function enabledCameras(all: Record<string, CameraConfig>): Record<string, CameraConfig> {
  const enabled: Record<string, CameraConfig> = {};
  for (const id of ENABLED_CAMERA_IDS) {
    const camera = Object.hasOwn(all, id) ? all[id] : undefined;
    if (camera !== undefined) enabled[id] = camera;
  }
  return enabled;
}
