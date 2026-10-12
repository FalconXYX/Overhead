// scripts/find-passes.ts — the next spans of a satellite inside a camera's frame (M5 step 16; README "Recorded clips",
// "Finding a pass"). Run by hand, never in CI:
//   npx tsx scripts/find-passes.ts --cam <camera id> [--norad 25544] [--from <ISO Z>] [--hours 48]
//                                  [--calibration <CalibrationFileV1>] [--gp public/data/gp]
// It reads public/data/cameras.json and <gp>/stations.json and visual.json (run `git pull` first: fetch-gp.yml
// commits public/data/gp/). It never calls CelesTrak. findPasses (10 s, geometric 0°) finds each pass, then
// frameSpans (1 s, apparent altitude) runs over [riseMs − 60 s, setMs + 60 s]: refraction keeps a satellite above the
// apparent horizon after its geometric set (10 s for the ISS on 2026-10-11). Spans use the geometric horizon, so
// terrain or the domes can end a real span earlier.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { json2satrec, type SatRec } from "satellite.js";
import { parseCameraRegistry } from "../src/app/cameras";
import { parseCalibrationFile } from "../src/app/persist";
import { astroTimeAt, makeObserver, sunGeometricAltDeg } from "../src/domain/astro";
import { type Calibration, createCameraModel } from "../src/domain/camera";
import type { ObserverSite } from "../src/domain/geo";
import {
  type FrameSpan,
  findPasses,
  frameSpans,
  type GpGroup,
  ISS_NORAD_ID,
  parseGpFile,
} from "../src/domain/orbits";
import { formatZonedDateTime, parseOmmEpochMs } from "../src/domain/time";
import type { CameraConfig } from "../src/state/types";

export const CAMERAS_JSON = "public/data/cameras.json";
export const DEFAULT_GP_DIR = "public/data/gp";
const HOUR_MS = 3_600_000;
const PASS_STEP_MS = 10_000;
const SPAN_STEP_MS = 1_000;
/** frameSpans runs this far before each rise and after each set (README "Finding a pass" step 3). */
const SPAN_MARGIN_MS = 60_000;

export interface FindPassesOptions {
  readonly cameraId: string; // --cam (required)
  readonly noradId: number; // --norad, default 25544
  readonly fromMs: number; // --from <ISO Z>, default nowMs
  readonly hours: number; // --hours, default 48
  readonly calibrationFile: string | null; // --calibration <CalibrationFileV1>, default null (the camera's defaults)
  readonly gpDir: string; // --gp <dir>, default "public/data/gp"
}

const FIND_PASSES_USAGE =
  "usage: npx tsx scripts/find-passes.ts --cam <camera id> [--norad 25544] [--from <ISO Z>] [--hours 48] " +
  "[--calibration <CalibrationFileV1>] [--gp public/data/gp]";

/** An ISO 8601 UTC time with its Z ("2026-10-11T14:00:00Z", fractions allowed), as epoch ms; NaN otherwise. */
export function parseIsoZ(text: string): number {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(text)
    ? Date.parse(text)
    : Number.NaN;
}

/** `--flag value` pairs; throws Error(usage) on a flag outside `known` or a flag without a value. */
export function readFlags(
  argv: readonly string[],
  known: readonly string[],
  usage: string,
): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!known.includes(flag) || value === undefined || value.startsWith("--")) {
      throw new Error(usage);
    }
    flags.set(flag, value);
  }
  return flags;
}

/** A positive integer flag value, or Error(usage). */
export function positiveInteger(value: string, usage: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(usage);
  return n;
}

/** Throws Error(usage) on an unknown flag, a missing --cam or a --from without Z. */
export function parseFindPassesArgs(argv: readonly string[], nowMs: number): FindPassesOptions {
  const usage = FIND_PASSES_USAGE;
  const flags = readFlags(
    argv,
    ["--cam", "--norad", "--from", "--hours", "--calibration", "--gp"],
    usage,
  );
  const cameraId = flags.get("--cam");
  if (cameraId === undefined || cameraId === "") throw new Error(usage);
  const from = flags.get("--from");
  const fromMs = from === undefined ? nowMs : parseIsoZ(from);
  if (!Number.isFinite(fromMs)) throw new Error(usage);
  const hoursText = flags.get("--hours");
  const hours = hoursText === undefined ? 48 : Number(hoursText);
  if (!(Number.isFinite(hours) && hours > 0)) throw new Error(usage);
  const norad = flags.get("--norad");
  return {
    cameraId,
    noradId: norad === undefined ? ISS_NORAD_ID : positiveInteger(norad, usage),
    fromMs,
    hours,
    calibrationFile: flags.get("--calibration") ?? null,
    gpDir: flags.get("--gp") ?? DEFAULT_GP_DIR,
  };
}

export interface CameraPassSpan extends FrameSpan {
  readonly sunAltDegAtEnter: number; // geometric
  readonly elementAgeH: number; // enterMs − the element set's EPOCH, hours
}

/** One satellite's elements from the stations and visual groups of a GP directory. */
export interface LoadedSatellite {
  readonly satrec: SatRec;
  readonly group: GpGroup;
  readonly name: string;
  readonly epochMs: number;
}

/** The satellite noradId from <gpDir>/stations.json, else visual.json; throws when neither holds it. */
export function loadSatellite(
  readText: (path: string) => string,
  gpDir: string,
  noradId: number,
): LoadedSatellite {
  for (const group of ["stations", "visual"] as const) {
    const omm = parseGpFile(JSON.parse(readText(join(gpDir, `${group}.json`)))).find(
      (o) => Number(o.NORAD_CAT_ID) === noradId,
    );
    if (omm !== undefined) {
      return {
        satrec: json2satrec(omm),
        group,
        name: String(omm.OBJECT_NAME ?? `NORAD ${noradId}`),
        epochMs: parseOmmEpochMs(String(omm.EPOCH)),
      };
    }
  }
  throw new Error(`NORAD ${noradId} is in neither stations.json nor visual.json in ${gpDir}`);
}

/** Every committed camera (enabled or not), from cameras.json. */
export function readRegistry(readText: (path: string) => string): Record<string, CameraConfig> {
  return parseCameraRegistry(JSON.parse(readText(CAMERAS_JSON)));
}

/** The camera's defaults, or a CalibrationFileV1 export for the same lens and image size. */
export function cameraCalibration(
  camera: CameraConfig,
  registry: Readonly<Record<string, CameraConfig>>,
  calibrationFile: string | null,
  readText: (path: string) => string,
): Calibration {
  if (calibrationFile === null) return camera.defaults;
  const parsed = parseCalibrationFile(readText(calibrationFile), registry);
  if (!parsed.ok) throw new Error(`${calibrationFile}: ${parsed.errors.join("; ")}`);
  const { file } = parsed;
  if (
    file.lens !== camera.lens ||
    file.imageSize.widthPx !== camera.imageSize.widthPx ||
    file.imageSize.heightPx !== camera.imageSize.heightPx
  ) {
    throw new Error(`${calibrationFile} is for another lens or image size than ${camera.id}`);
  }
  return file.calibration;
}

export const observerSite = (camera: CameraConfig): ObserverSite => ({
  latDeg: camera.site.latDeg,
  lonDeg: camera.site.lonDeg,
  heightM: camera.site.heightM,
});

/**
 * findPasses (10 s, 0°) then frameSpans (1 s) over each pass's [riseMs − 60 s, setMs + 60 s]; readText reads
 * cameras.json, the GP files and the calibration file.
 */
export function findCameraPasses(
  options: FindPassesOptions,
  readText: (path: string) => string,
): CameraPassSpan[] {
  const registry = readRegistry(readText);
  const camera = registry[options.cameraId];
  if (camera === undefined) throw new Error(`Unknown camera ${options.cameraId}`);
  const calibration = cameraCalibration(camera, registry, options.calibrationFile, readText);
  const { satrec, group, epochMs } = loadSatellite(readText, options.gpDir, options.noradId);
  const site = observerSite(camera);
  const observer = makeObserver(site);
  const model = createCameraModel({
    lens: camera.lens,
    calibration,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
  });
  const toMs = options.fromMs + options.hours * HOUR_MS;
  const out: CameraPassSpan[] = [];
  for (const pass of findPasses(satrec, site, options.fromMs, toMs, PASS_STEP_MS, 0)) {
    const spans = frameSpans(
      satrec,
      group,
      site,
      model,
      pass.riseMs - SPAN_MARGIN_MS,
      pass.setMs + SPAN_MARGIN_MS,
      SPAN_STEP_MS,
    );
    for (const span of spans) {
      if (out.some((s) => s.enterMs === span.enterMs)) continue; // overlapping margins of close passes
      out.push({
        ...span,
        sunAltDegAtEnter: sunGeometricAltDeg(astroTimeAt(span.enterMs), observer),
        elementAgeH: (span.enterMs - epochMs) / HOUR_MS,
      });
    }
  }
  return out;
}

const deg = (x: number): string => `${x.toFixed(2)}°`;
/** UTC rounded to 0.1 s: "2026-10-11T15:09:50.6Z". */
const isoTenths = (ms: number): string =>
  `${new Date(Math.round(ms / 100) * 100).toISOString().slice(0, 21)}Z`;

/** The printed line of one span: enter and exit in UTC and the site's zone, az/alt at both ends, and the context. */
export function formatPassSpan(span: CameraPassSpan, timeZone: string): string {
  const at = (ms: number, [az, alt]: readonly [number, number]): string =>
    `${isoTenths(ms)} (${formatZonedDateTime(ms, timeZone)} ${timeZone}) az ${deg(az)} alt ${deg(alt)}`;
  return [
    `enter ${at(span.enterMs, span.enterAzAltDeg)}`,
    `exit ${at(span.exitMs, span.exitAzAltDeg)}`,
    `max alt ${deg(span.maxAltDeg)}`,
    `Sun ${deg(span.sunAltDegAtEnter)} at entry`,
    `elements ${span.elementAgeH.toFixed(2)} h old`,
  ].join("; ");
}

function main(argv: readonly string[]): void {
  const options = parseFindPassesArgs(argv, Date.now());
  const readText = (path: string): string => readFileSync(path, "utf8");
  const spans = findCameraPasses(options, readText);
  const camera = readRegistry(readText)[options.cameraId];
  const timeZone = camera?.site.timeZone ?? "UTC";
  const window = `${isoTenths(options.fromMs)} + ${options.hours} h`;
  if (spans.length === 0) {
    console.log(`No visible span of NORAD ${options.noradId} in ${options.cameraId} in ${window}.`);
    return;
  }
  console.log(`NORAD ${options.noradId} in ${options.cameraId}, ${window} (geometric horizon):`);
  for (const span of spans) console.log(formatPassSpan(span, timeZone));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
