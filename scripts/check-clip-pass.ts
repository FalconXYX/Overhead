// scripts/check-clip-pass.ts — the M5 acceptance tool (M5 step 18): the app's drawn satellite marker against a measured
// track, frame by frame, by angle on the sky through the sidecar's star fit. Run by hand against `npm run dev` (which
// serves recordings/ at /Overhead/recordings/), never in CI. It drives a headless Chromium only:
//   npx tsx scripts/check-clip-pass.ts --cam <clip camera id> --track <ClipTrack file or Satellite check export>
//          [--gp <dir>] [--calibration <CalibrationFileV1>] [--url http://localhost:5173/Overhead/] [--limit 1.0]
// It writes recordings/<clip>.check.json and prints one line, e.g. "94 samples, max 0.54° at 94 s, median 0.27°,
// along-track +0.87 s: pass". The exit code is 0 only if every sample has a marker within --limit degrees.
// main runs only when the file is executed directly, so the unit tests import the helpers without a browser.
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { parseClipSidecar } from "../src/app/clip";
import { parseCalibrationFile } from "../src/app/persist";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  unprojectPixel,
} from "../src/domain/camera";
import { angularSeparationDeg } from "../src/domain/geo";
import { parseGpFile } from "../src/domain/orbits";
import { isoUtcSeconds } from "../src/domain/time";
import { readFlags, readRegistry } from "./find-passes";

// ---- Types and arguments (M5 step 16.2) ----

/** A measured track of one object in a clip, e.g. tests/fixtures/video/subaru-2026-10-11-iss-track.json. */
export interface ClipTrack {
  readonly clip: string; // the sidecar's file name
  readonly noradId: number;
  readonly widthPx: number; // pixel grid of the samples
  readonly heightPx: number;
  readonly method: string;
  readonly samples: readonly (readonly [mediaS: number, uPx: number, vPx: number])[]; // whole seconds; continuous px
}
export interface CheckClipPassOptions {
  readonly cameraId: string; // --cam, a local-video camera with a sidecarUrl
  readonly trackFile: string; // --track
  readonly gpDir: string | null; // --gp <dir>; null (the default): no GP route, the app loads what the server holds
  readonly calibrationFile: string | null; // --calibration, imported through the Calibration panel first
  readonly url: string; // --url, default "http://localhost:5173/Overhead/" (npm run dev under the H1 base)
  readonly limitDeg: number; // --limit, default 1.0
}

const USAGE =
  "usage: npx tsx scripts/check-clip-pass.ts --cam <clip camera id> --track <file> [--gp <dir>] " +
  "[--calibration <CalibrationFileV1>] [--url http://localhost:5173/Overhead/] [--limit 1.0]";
export const DEFAULT_CHECK_URL = "http://localhost:5173/Overhead/";

export function parseCheckClipPassArgs(argv: readonly string[]): CheckClipPassOptions {
  const flags = readFlags(
    argv,
    ["--cam", "--track", "--gp", "--calibration", "--url", "--limit"],
    USAGE,
  );
  const cameraId = flags.get("--cam");
  const trackFile = flags.get("--track");
  if (cameraId === undefined || trackFile === undefined) throw new Error(USAGE);
  const limitText = flags.get("--limit");
  const limitDeg = limitText === undefined ? 1.0 : Number(limitText);
  if (!(Number.isFinite(limitDeg) && limitDeg > 0)) throw new Error(USAGE);
  const url = flags.get("--url") ?? DEFAULT_CHECK_URL;
  if (!URL.canParse(url)) throw new Error(USAGE);
  return {
    cameraId,
    trackFile,
    gpDir: flags.get("--gp") ?? null,
    calibrationFile: flags.get("--calibration") ?? null,
    url: url.endsWith("/") ? url : `${url}/`,
    limitDeg,
  };
}

// ---- The pure helpers (M5 step 18.6) ----

/** A rectangle in viewport CSS px, as getBoundingClientRect() returns it. */
export interface CssRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Viewport CSS px → camera image px, for a sky map whose view shows the whole W × H frame, centred and contained. */
export function clientToImagePx(
  clientX: number,
  clientY: number,
  mapRect: CssRect,
  widthPx: number,
  heightPx: number,
): [uPx: number, vPx: number] {
  const s = Math.min(mapRect.width / widthPx, mapRect.height / heightPx); // CSS px per image px
  const ox = (mapRect.width - widthPx * s) / 2;
  const oy = (mapRect.height - heightPx * s) / 2;
  return [(clientX - mapRect.left - ox) / s, (clientY - mapRect.top - oy) / s];
}

/** One compared sample: media time, and the drawn marker and the measured object, both in camera image px. */
export interface PassSample {
  readonly mediaS: number;
  readonly markerPx: readonly [uPx: number, vPx: number];
  readonly measuredPx: readonly [uPx: number, vPx: number];
}

/**
 * Least-squares along-track offset δ in seconds: the measured object sits where the marker will be δ s later.
 * The marker's image velocity is the difference to the neighbouring samples at most maxGapS away.
 */
export function alongTrackOffsetS(samples: readonly PassSample[], maxGapS = 3): number | null {
  let num = 0;
  let den = 0;
  samples.forEach((r, i) => {
    const prev = samples[i - 1];
    const next = samples[i + 1];
    const a = prev !== undefined && r.mediaS - prev.mediaS <= maxGapS ? prev : r;
    const b = next !== undefined && next.mediaS - r.mediaS <= maxGapS ? next : r;
    if (a === b) return;
    const dt = b.mediaS - a.mediaS;
    const vx = (b.markerPx[0] - a.markerPx[0]) / dt;
    const vy = (b.markerPx[1] - a.markerPx[1]) / dt;
    num += (r.measuredPx[0] - r.markerPx[0]) * vx + (r.measuredPx[1] - r.markerPx[1]) * vy;
    den += vx * vx + vy * vy;
  });
  return den > 0 ? num / den : null;
}

const scratch = new Float64Array(4);

/** Angle on the sky between two image pixels, both unprojected through the reference model; null if either fails. */
export function pixelSeparationDeg(
  reference: CameraModel,
  a: readonly [number, number],
  b: readonly [number, number],
): number | null {
  if (!unprojectPixel(reference, a[0], a[1], scratch, 0)) return null;
  if (!unprojectPixel(reference, b[0], b[1], scratch, 2)) return null;
  const [azA = Number.NaN, altA = Number.NaN, azB = Number.NaN, altB = Number.NaN] = scratch;
  return angularSeparationDeg(azA, altA, azB, altB);
}

// ---- Track, stepping and the report (pure) ----

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A ClipTrack, or a Satellite check export (M5 step 13.5) turned into one: each sample becomes
 * [round((timeMs − startUtcMs) / 1000), uPx, vPx] on the export's (the camera's) W × H grid. Samples are sorted by
 * media time. Throws on anything else.
 */
export function trackFromJson(json: unknown, startUtcMs: number): ClipTrack {
  if (!isObject(json)) throw new Error("The track is not a JSON object");
  if (json.format === "overhead.satcheck") {
    const rows = Array.isArray(json.samples) ? (json.samples as unknown[]) : [];
    const samples = rows.map((row): [number, number, number] => {
      if (
        !isObject(row) ||
        !isFiniteNumber(row.timeMs) ||
        !isFiniteNumber(row.uPx) ||
        !isFiniteNumber(row.vPx)
      )
        throw new Error("A Satellite check sample needs timeMs, uPx and vPx");
      return [Math.round((row.timeMs - startUtcMs) / 1000), row.uPx, row.vPx];
    });
    if (
      !isFiniteNumber(json.noradId) ||
      !isFiniteNumber(json.widthPx) ||
      !isFiniteNumber(json.heightPx)
    )
      throw new Error("A Satellite check export needs noradId, widthPx and heightPx");
    return {
      clip: typeof json.clip === "string" ? json.clip : "",
      noradId: json.noradId,
      widthPx: json.widthPx,
      heightPx: json.heightPx,
      method: "Satellite check export (overhead.satcheck)",
      samples: samples.sort((a, b) => a[0] - b[0]),
    };
  }
  const { clip, noradId, widthPx, heightPx, method, samples } = json;
  if (
    typeof clip !== "string" ||
    !Number.isInteger(noradId) ||
    !(isFiniteNumber(widthPx) && widthPx > 0) ||
    !(isFiniteNumber(heightPx) && heightPx > 0) ||
    typeof method !== "string" ||
    !Array.isArray(samples)
  ) {
    throw new Error("The track needs clip, noradId, widthPx, heightPx, method and samples");
  }
  const rows = (samples as unknown[]).map((row): [number, number, number] => {
    if (!Array.isArray(row) || row.length !== 3 || !row.every(isFiniteNumber))
      throw new Error("Each track sample is [mediaS, uPx, vPx]");
    return [row[0] as number, row[1] as number, row[2] as number];
  });
  return {
    clip,
    noradId: noradId as number,
    widthPx,
    heightPx,
    method,
    samples: rows.sort((a, b) => a[0] - b[0]),
  };
}

/** The Timeline presses from media second fromS to toS: whole minutes first, then seconds (backwards if toS < fromS). */
export function stepPresses(
  fromS: number,
  toS: number,
): { readonly minutes: number; readonly seconds: number; readonly forward: boolean } {
  const d = Math.round(toS - fromS);
  const n = Math.abs(d);
  const minutes = Math.floor(n / 60);
  return { minutes, seconds: n - 60 * minutes, forward: d >= 0 };
}

/** One compared sample of the report; markerPx and sepDeg are null without a marker. */
export interface CheckRow {
  readonly mediaS: number;
  readonly markerPx: readonly [number, number] | null;
  readonly measuredPx: readonly [number, number];
  readonly sepDeg: number | null;
}
export interface CheckSummary {
  readonly count: number;
  readonly maxDeg: number | null;
  readonly maxAtMediaS: number | null;
  readonly medianDeg: number | null; // the mean of the middle two for an even count, as satelliteCheckSummary
  readonly overLimitMediaS: readonly number[];
  readonly noMarkerMediaS: readonly number[];
  readonly alongTrackOffsetS: number | null;
  readonly pass: boolean;
}

export function summarizeCheck(rows: readonly CheckRow[], limitDeg: number): CheckSummary {
  const measured = rows.filter((r) => r.sepDeg !== null);
  const seps = measured.map((r) => r.sepDeg as number).sort((a, b) => a - b);
  let maxAt: CheckRow | null = null;
  for (const r of measured) if (maxAt === null || (r.sepDeg ?? 0) > (maxAt.sepDeg ?? 0)) maxAt = r;
  const n = seps.length;
  const medianDeg =
    n === 0
      ? null
      : n % 2 === 1
        ? (seps[(n - 1) / 2] ?? null)
        : ((seps[n / 2 - 1] ?? 0) + (seps[n / 2] ?? 0)) / 2;
  const overLimitMediaS = measured.filter((r) => (r.sepDeg ?? 0) > limitDeg).map((r) => r.mediaS);
  const noMarkerMediaS = rows.filter((r) => r.sepDeg === null).map((r) => r.mediaS);
  const passSamples: PassSample[] = rows.flatMap((r) =>
    r.markerPx === null
      ? []
      : [{ mediaS: r.mediaS, markerPx: r.markerPx, measuredPx: r.measuredPx }],
  );
  return {
    count: rows.length,
    maxDeg: maxAt?.sepDeg ?? null,
    maxAtMediaS: maxAt?.mediaS ?? null,
    medianDeg,
    overLimitMediaS,
    noMarkerMediaS,
    alongTrackOffsetS: alongTrackOffsetS(passSamples),
    pass: rows.length > 0 && overLimitMediaS.length === 0 && noMarkerMediaS.length === 0,
  };
}

/** "94 samples, max 0.54° at 94 s, median 0.27°, along-track +0.87 s: pass". */
export function summaryLine(summary: CheckSummary, limitDeg: number): string {
  const parts = [`${summary.count} samples`];
  if (summary.maxDeg !== null)
    parts.push(`max ${summary.maxDeg.toFixed(2)}° at ${summary.maxAtMediaS} s`);
  if (summary.medianDeg !== null) parts.push(`median ${summary.medianDeg.toFixed(2)}°`);
  const offset = summary.alongTrackOffsetS;
  if (offset !== null) parts.push(`along-track ${offset >= 0 ? "+" : ""}${offset.toFixed(2)} s`);
  if (summary.overLimitMediaS.length > 0)
    parts.push(`${summary.overLimitMediaS.length} over ${limitDeg}°`);
  if (summary.noMarkerMediaS.length > 0)
    parts.push(`${summary.noMarkerMediaS.length} without a marker`);
  return `${parts.join(", ")}: ${summary.pass ? "pass" : "fail"}`;
}

// ---- main (a headless Chromium) ----

interface HookWindow {
  __overhead?: {
    frame(): number;
    readyFrame(): number | null;
    clientPoint(view: "sky" | "ground", id: string): { x: number; y: number } | null;
  };
}

async function frameNow(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as HookWindow).__overhead?.frame() ?? 0);
}

async function waitFrames(page: Page, n: number): Promise<void> {
  const target = (await frameNow(page)) + n;
  await page.waitForFunction(
    (t) => ((window as unknown as HookWindow).__overhead?.frame() ?? 0) >= t,
    target,
  );
}

async function waitTimeUtc(page: Page, timeMs: number): Promise<void> {
  const want = isoUtcSeconds(timeMs);
  await page.waitForFunction(
    (iso) => document.querySelector('[data-testid="time-utc"]')?.textContent === iso,
    want,
    { timeout: 30_000 },
  );
}

/** clientPoint read twice, 10 frames apart, until both agree within 0.01 CSS px; null after 5 s. */
async function stableMarker(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  const read = (): Promise<{ x: number; y: number } | null> =>
    page.evaluate((objectId) => {
      return (window as unknown as HookWindow).__overhead?.clientPoint("sky", objectId) ?? null;
    }, id);
  const deadline = Date.now() + 5_000;
  for (;;) {
    const a = await read();
    await waitFrames(page, 10);
    const b = await read();
    if (a !== null && b !== null && Math.abs(a.x - b.x) <= 0.01 && Math.abs(a.y - b.y) <= 0.01)
      return b;
    if (Date.now() > deadline) return null;
  }
}

async function main(argv: readonly string[]): Promise<boolean> {
  const options = parseCheckClipPassArgs(argv);
  const readText = (path: string): string => readFileSync(path, "utf8");
  const registry = readRegistry(readText);
  const entry = registry[options.cameraId];
  if (entry?.kind !== "local-video" || entry.source.sidecarUrl === null)
    throw new Error(`${options.cameraId} is not a clip camera with a sidecarUrl`);
  const sidecarUrl = new URL(entry.source.sidecarUrl, options.url).href;
  const res = await fetch(sidecarUrl, { cache: "no-cache" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error(`${sidecarUrl} is not served: run npm run dev with the clip in recordings/`);
  const sidecarJson: unknown = await res.json();
  const parsed = parseClipSidecar(sidecarJson, registry, Date.now());
  if (!parsed.ok) throw new Error(`The sidecar has problems: ${parsed.errors.join("; ")}`);
  const { sidecar } = parsed;
  if (sidecar.calibration === undefined)
    throw new Error("The check needs a star-calibrated sidecar.");
  const source = registry[sidecar.cameraId];
  if (source === undefined) throw new Error(`Unknown camera ${sidecar.cameraId}`);
  const { widthPx: W, heightPx: H } = source.imageSize;
  const reference = createCameraModel({
    lens: source.lens,
    calibration: sidecar.calibration,
    widthPx: W,
    heightPx: H,
  });
  const track = trackFromJson(JSON.parse(readText(options.trackFile)), sidecar.startUtcMs);
  let calibrationUsed: Calibration = sidecar.calibration;
  if (options.calibrationFile !== null) {
    const file = parseCalibrationFile(readText(options.calibrationFile), registry);
    if (!file.ok) throw new Error(`${options.calibrationFile}: ${file.errors.join("; ")}`);
    if (file.file.cameraId !== options.cameraId)
      throw new Error(
        `${options.calibrationFile} is for ${file.file.cameraId}, not ${options.cameraId}`,
      );
    calibrationUsed = file.file.calibration;
  }

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true }); // never a visible window
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    if (options.gpDir !== null) {
      const gpDir = options.gpDir;
      const answer = (route: import("@playwright/test").Route) =>
        route.fulfill({
          path: join(gpDir, basename(new URL(route.request().url()).pathname)),
          contentType: "application/json",
        });
      await context.route("**/data/gp/*.json", answer);
      await context.route("**/recordings/*.gp/*.json", answer);
    }
    let stationsBody: string | null = null;
    context.on("response", (response) => {
      if (!new URL(response.url()).pathname.endsWith("/stations.json")) return;
      response.text().then(
        (text) => {
          stationsBody = text;
        },
        () => {},
      );
    });
    const page = await context.newPage();
    const objectId = `sat:${track.noradId}`;
    await page.goto(`${options.url}?cam=${encodeURIComponent(options.cameraId)}&sel=${objectId}`);
    await page
      .locator('[data-testid="video-status"][data-status="paused"]')
      .waitFor({ timeout: 60_000 });
    await waitTimeUtc(page, sidecar.startUtcMs);
    await page.waitForFunction(
      () => (window as unknown as HookWindow).__overhead?.readyFrame() != null,
      null,
      { timeout: 60_000 },
    );

    if (options.calibrationFile !== null) {
      await page.keyboard.press("c");
      const panel = page.getByRole("region", { name: "Calibration" });
      await panel.getByLabel("Import JSON").setInputFiles(options.calibrationFile);
      await panel.getByText(/^Calibration imported for /).waitFor();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("c");
    }

    const mapBox = async (): Promise<CssRect> => {
      const box = await page.locator('[data-testid="sky-map"]').boundingBox();
      if (box === null) throw new Error("The sky map is not on screen");
      return { left: box.x, top: box.y, width: box.width, height: box.height };
    };
    const rows: CheckRow[] = [];
    let currentS = 0;
    for (const [mediaS, uPx, vPx] of track.samples) {
      const { minutes, seconds, forward } = stepPresses(currentS, mediaS);
      const minute = page.getByRole("button", {
        name: forward ? "Forward 1 minute" : "Back 1 minute",
      });
      const second = page.getByRole("button", {
        name: forward ? "Forward 1 second" : "Back 1 second",
      });
      for (let i = 0; i < minutes; i++) await minute.click();
      for (let i = 0; i < seconds; i++) await second.click();
      currentS = mediaS;
      await waitTimeUtc(page, sidecar.startUtcMs + mediaS * 1000);
      await waitFrames(page, 30); // a worker sample that arrives after the jump
      const marker = await stableMarker(page, objectId);
      const measuredPx: [number, number] = [(uPx * W) / track.widthPx, (vPx * H) / track.heightPx];
      const markerPx =
        marker === null ? null : clientToImagePx(marker.x, marker.y, await mapBox(), W, H);
      const sepDeg = markerPx === null ? null : pixelSeparationDeg(reference, markerPx, measuredPx);
      rows.push({ mediaS, markerPx, measuredPx, sepDeg });
      console.log(`${mediaS} s: ${sepDeg === null ? "no marker" : `${sepDeg.toFixed(3)}°`}`);
    }

    const summary = summarizeCheck(rows, options.limitDeg);
    const body: string | null = stationsBody;
    const omm =
      body === null
        ? undefined
        : parseGpFile(JSON.parse(body)).find((o) => Number(o.NORAD_CAT_ID) === track.noradId);
    const stem = basename(entry.source.sidecarUrl, ".json");
    const reportPath = join("recordings", `${stem}.check.json`);
    const report = {
      options,
      checkedAtUtc: new Date().toISOString(),
      track: { clip: track.clip, noradId: track.noradId, method: track.method },
      elements: {
        noradId: track.noradId,
        epoch: omm?.EPOCH ?? null,
        objectName: omm?.OBJECT_NAME ?? null,
      },
      calibration: calibrationUsed,
      reference: sidecar.calibration,
      samples: rows,
      summary,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(summaryLine(summary, options.limitDeg));
    console.log(`Report: ${reportPath}`);
    return summary.pass;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = (await main(process.argv.slice(2))) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
