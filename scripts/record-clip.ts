// scripts/record-clip.ts — cuts a UTC window out of a StarCam's YouTube DVR window after the fact (M5 step 17; README
// "Recorded clips", "Recording"). Run by hand within about an hour of the window's start, never in CI:
//   npx tsx scripts/record-clip.ts --cam <youtube camera id> --from <ISO Z> --to <ISO Z> --name <clip>
//                                  [--norad <id>] [--yt-dlp "<command>"] [--ffmpeg <path>]
// It writes recordings/<clip>-dvr.ts (the segments, concatenated), <clip>.mp4 (remuxed), <clip>.json (the first
// sidecar, timed by the first segment's PROGRAM-DATE-TIME), <clip>.segments.json (sq, PROGRAM-DATE-TIME and bytes per
// segment) and <clip>.gp/ (the element sets of the day). Playlist and segment URLs are signed, expire after about
// 6 h and carry the client's IP address: they stay in memory, never in a log or a file (gotcha G24). Then adopt the
// burned-in clock and calibrate (M5 "Recording a clip" steps 4–6).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ClipPass, ClipSidecar } from "../src/app/clip";
import { resolveYoutubeVideoId } from "../src/app/youtube";
import { createCameraModel } from "../src/domain/camera";
import { frameSpans } from "../src/domain/orbits";
import type { YoutubeCamera } from "../src/state/types";
import {
  DEFAULT_GP_DIR,
  loadSatellite,
  observerSite,
  parseIsoZ,
  positiveInteger,
  readFlags,
  readRegistry,
} from "./find-passes";

// ---- The HLS media playlist (README section 6, Script modules) ----

/** One media segment of a YouTube live HLS playlist (itag 270: 5.0 s each on 2026-10-11). */
export interface HlsSegment {
  readonly sq: number; // media sequence number; equals the /sq/<n>/ in its URL
  readonly programDateTimeMs: number; // the head #EXT-X-PROGRAM-DATE-TIME + the EXTINF durations before it
  readonly durationS: number; // EXTINF
  readonly url: string; // signed and carries the client's IP: never logged or written to disk
}
export interface MediaPlaylist {
  readonly mediaSequence: number; // #EXT-X-MEDIA-SEQUENCE
  readonly segments: readonly HlsSegment[];
}

const TAG_MEDIA_SEQUENCE = "#EXT-X-MEDIA-SEQUENCE:";
const TAG_PROGRAM_DATE_TIME = "#EXT-X-PROGRAM-DATE-TIME:";
const TAG_EXTINF = "#EXTINF:";
const TAG_DISCONTINUITY = "#EXT-X-DISCONTINUITY";

/**
 * Reads #EXT-X-MEDIA-SEQUENCE, the head #EXT-X-PROGRAM-DATE-TIME and each #EXTINF; ignores every other tag (VERSION,
 * TARGETDURATION, DISCONTINUITY-SEQUENCE, the CUEPOINT-AD DATERANGE and CUEPOINT pairs, a later PROGRAM-DATE-TIME).
 * Throws when the head has no PROGRAM-DATE-TIME, a segment follows an #EXT-X-DISCONTINUITY (matched against the whole
 * line: a prefix test also matches DISCONTINUITY-SEQUENCE), a segment has no #EXTINF, or a URL's /sq/<n>/ differs
 * from MEDIA-SEQUENCE plus the segment's index. No message quotes a URL.
 */
export function parseMediaPlaylist(text: string): MediaPlaylist {
  let mediaSequence = 0;
  let headMs: number | null = null;
  let extinfS: number | null = null;
  let discontinuity = false;
  let elapsedS = 0;
  const segments: HlsSegment[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith(TAG_MEDIA_SEQUENCE)) {
      if (segments.length === 0) mediaSequence = Number(line.slice(TAG_MEDIA_SEQUENCE.length));
    } else if (line.startsWith(TAG_PROGRAM_DATE_TIME)) {
      if (segments.length === 0 && headMs === null) {
        headMs = Date.parse(line.slice(TAG_PROGRAM_DATE_TIME.length));
        if (!Number.isFinite(headMs))
          throw new Error("The head #EXT-X-PROGRAM-DATE-TIME is not a time");
      }
    } else if (line.startsWith(TAG_EXTINF)) {
      extinfS = Number.parseFloat(line.slice(TAG_EXTINF.length));
    } else if (line === TAG_DISCONTINUITY) {
      discontinuity = true;
    } else if (!line.startsWith("#")) {
      const index = segments.length;
      const sq = mediaSequence + index;
      if (headMs === null)
        throw new Error("The playlist has no #EXT-X-PROGRAM-DATE-TIME at its head");
      if (discontinuity) throw new Error(`Segment ${sq} follows an #EXT-X-DISCONTINUITY`);
      if (extinfS === null || !(extinfS > 0)) throw new Error(`Segment ${sq} has no #EXTINF`);
      const inUrl = /\/sq\/(\d+)\//.exec(line)?.[1];
      if (inUrl !== undefined && Number(inUrl) !== sq) {
        throw new Error(`Segment ${index} names /sq/${inUrl}/, not ${sq} (MEDIA-SEQUENCE + index)`);
      }
      segments.push({
        sq,
        programDateTimeMs: headMs + elapsedS * 1000,
        durationS: extinfS,
        url: line,
      });
      elapsedS += extinfS;
      extinfS = null;
    }
  }
  if (headMs === null) throw new Error("The playlist has no #EXT-X-PROGRAM-DATE-TIME at its head");
  return { mediaSequence, segments };
}

const segmentEndMs = (s: HlsSegment): number => s.programDateTimeMs + s.durationS * 1000;

/** The segments that overlap [fromMs, toMs), in order. Throws unless the window lies inside the playlist. */
export function selectSegments(
  playlist: MediaPlaylist,
  fromMs: number,
  toMs: number,
): HlsSegment[] {
  const { segments } = playlist;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first === undefined || last === undefined) throw new Error("The playlist has no segments");
  if (!(toMs > fromMs)) throw new Error("The window is empty");
  if (fromMs < first.programDateTimeMs || toMs > segmentEndMs(last)) {
    throw new Error(
      `The window is outside the playlist (${new Date(first.programDateTimeMs).toISOString()} to ${new Date(segmentEndMs(last)).toISOString()})`,
    );
  }
  return segments.filter((s) => s.programDateTimeMs < toMs && segmentEndMs(s) > fromMs);
}

// ---- Arguments ----

export interface RecordClipOptions {
  readonly cameraId: string; // --cam, a youtube camera
  readonly fromMs: number; // --from <ISO Z>
  readonly toMs: number; // --to <ISO Z>, > fromMs, at most 3,600 s after it
  readonly name: string; // --name, /^[a-z0-9][a-z0-9-]*$/: recordings/<name>.mp4 and .json
  readonly noradId: number | null; // --norad
  readonly ytDlp: readonly string[]; // --yt-dlp "<command>", split on spaces; default ["uvx", "yt-dlp"]
  readonly ffmpeg: string; // --ffmpeg <path>, default "ffmpeg"
}

const RECORD_CLIP_USAGE =
  "usage: npx tsx scripts/record-clip.ts --cam <youtube camera id> --from <ISO Z> --to <ISO Z> --name <clip> " +
  '[--norad <id>] [--yt-dlp "<command>"] [--ffmpeg <path>]';
/** The DVR window held the last 3,600 s on 2026-10-11. */
export const DVR_WINDOW_MS = 3_600_000;
const CLIP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Throws Error(usage) for a missing flag, a time without Z, --to not after --from, a window over 3,600 s or a bad --name. */
export function parseRecordClipArgs(argv: readonly string[]): RecordClipOptions {
  const usage = RECORD_CLIP_USAGE;
  const flags = readFlags(
    argv,
    ["--cam", "--from", "--to", "--name", "--norad", "--yt-dlp", "--ffmpeg"],
    usage,
  );
  const cameraId = flags.get("--cam");
  const name = flags.get("--name");
  const fromMs = parseIsoZ(flags.get("--from") ?? "");
  const toMs = parseIsoZ(flags.get("--to") ?? "");
  if (cameraId === undefined || cameraId === "" || name === undefined) throw new Error(usage);
  if (!CLIP_NAME_RE.test(name)) throw new Error(usage);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error(usage);
  if (!(toMs > fromMs) || toMs - fromMs > DVR_WINDOW_MS) throw new Error(usage);
  const norad = flags.get("--norad");
  const ytDlp = (flags.get("--yt-dlp") ?? "uvx yt-dlp").split(" ").filter((part) => part !== "");
  if (ytDlp.length === 0) throw new Error(usage);
  return {
    cameraId,
    fromMs,
    toMs,
    name,
    noradId: norad === undefined ? null : positiveInteger(norad, usage),
    ytDlp,
    ffmpeg: flags.get("--ffmpeg") ?? "ffmpeg",
  };
}

// ---- The sidecar ----

/** What `ffmpeg -i <name>.mp4` reported. */
export interface ClipProbe {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationS: number;
}

/** Reads `Duration: 00:08:00.00`, `1920x1080` and `30 fps` from `ffmpeg -i` stderr; throws when one is missing. */
export function parseFfmpegProbe(stderr: string): ClipProbe {
  const duration = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const video =
    /Stream #[^\n]*: Video: [^\n]*?\b(\d{2,5})x(\d{2,5})\b[^\n]*?(\d+(?:\.\d+)?) fps/.exec(stderr);
  if (duration === null || video === null) throw new Error("ffmpeg -i did not report a video");
  return {
    width: Number(video[1]),
    height: Number(video[2]),
    fps: Number(video[3]),
    durationS: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
  };
}

/** The sidecar's start uncertainty from PROGRAM-DATE-TIME: it preceded the burned-in clock by 0.144 s on 2026-10-11. */
export const HLS_START_UNCERTAINTY_S = 0.2;

export function buildClipSidecar(input: {
  readonly camera: YoutubeCamera;
  readonly videoId: string;
  readonly segments: readonly HlsSegment[]; // selectSegments' result, in order
  readonly probe: ClipProbe;
  readonly videoFile: string;
  readonly pass: ClipPass | null;
}): ClipSidecar {
  const { camera, videoId, segments, probe, videoFile, pass } = input;
  const first = segments[0];
  if (first === undefined) throw new Error("A clip needs at least one segment");
  return {
    cameraId: camera.id,
    videoFile,
    startUtcMs: first.programDateTimeMs,
    startUncertaintyS: HLS_START_UNCERTAINTY_S,
    timingSource: {
      method: "hls-program-date-time",
      detail: `first segment sq ${first.sq}, PROGRAM-DATE-TIME ${new Date(first.programDateTimeMs).toISOString()}`,
    },
    durationS: segments.reduce((sum, s) => sum + s.durationS, 0),
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    sourceVideoId: videoId,
    credit: { ...camera.credit, href: `https://www.youtube.com/watch?v=${videoId}` },
    ...(pass === null ? {} : { pass }),
  };
}

// ---- Downloading ----

/**
 * GETs every segment, `concurrency` at a time and up to `tries` times each, and returns their bytes in segment order.
 * Errors name the sq and the status, never the URL.
 */
export async function downloadSegments(
  segments: readonly HlsSegment[],
  fetchFn: typeof fetch,
  concurrency = 6,
  tries = 3,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = new Array(segments.length);
  let next = 0;
  const one = async (segment: HlsSegment): Promise<Uint8Array> => {
    let last = "";
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const res = await fetchFn(segment.url);
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        last = `HTTP ${res.status}`;
      } catch (error) {
        last = error instanceof Error ? error.name : "error";
      }
    }
    throw new Error(`Segment ${segment.sq} failed ${tries} times (${last})`);
  };
  const worker = async (): Promise<void> => {
    while (next < segments.length) {
      const i = next;
      next += 1;
      const segment = segments[i];
      if (segment !== undefined) out[i] = await one(segment);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker));
  return out;
}

/** <clip>.segments.json: the script's log, with no URL. */
export function segmentLog(
  segments: readonly HlsSegment[],
  bytes: readonly Uint8Array[],
): { sq: number; programDateTime: string; durationS: number; bytes: number }[] {
  return segments.map((s, i) => ({
    sq: s.sq,
    programDateTime: new Date(s.programDateTimeMs).toISOString(),
    durationS: s.durationS,
    bytes: bytes[i]?.length ?? 0,
  }));
}

/** A frame span in UTC as the sidecar's pass, in media seconds from startUtcMs, clamped to the clip. */
export function passInMedia(
  noradId: number,
  span: { readonly enterMs: number; readonly exitMs: number },
  startUtcMs: number,
  durationS: number,
): ClipPass {
  const media = (ms: number): number =>
    Math.round(Math.min(Math.max((ms - startUtcMs) / 1000, 0), durationS) * 1000) / 1000;
  return { noradId, inFrameFromMediaS: media(span.enterMs), inFrameToMediaS: media(span.exitMs) };
}

// ---- main ----

function run(
  command: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null && typeof error.code !== "number") {
        reject(error); // not started
        return;
      }
      resolve({ stdout, stderr, ok: error === null });
    });
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseRecordClipArgs(argv);
  const readText = (path: string): string => readFileSync(path, "utf8");
  const registry = readRegistry(readText);
  const camera = registry[options.cameraId];
  if (camera?.kind !== "youtube") throw new Error(`${options.cameraId} is not a youtube camera`);
  const resolved = await resolveYoutubeVideoId(
    camera.source.resolverUrl,
    camera.source.youtubeVideoId,
    fetch,
  );
  const videoId = resolved.id;
  console.log(
    resolved.source === "resolver"
      ? `Video id ${videoId} from the resolver page.`
      : `Video id ${videoId}, the last known one (${resolved.reason}).`,
  );

  const nowMs = Date.now();
  if (options.toMs > nowMs)
    throw new Error("--to is still in the future: wait until it has passed.");
  if (options.fromMs < nowMs - (DVR_WINDOW_MS - 60_000)) {
    throw new Error("--from is more than 3,540 s ago: it has left the DVR window.");
  }

  const ytDlp = await run(options.ytDlp[0] ?? "uvx", [
    ...options.ytDlp.slice(1),
    ...["--js-runtimes", `node:${process.execPath}`, "-f", "270", "-g"],
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
  const playlistUrl = ytDlp.stdout.split("\n")[0]?.trim() ?? "";
  if (!ytDlp.ok || !playlistUrl.startsWith("https://")) {
    throw new Error("yt-dlp did not print the itag 270 playlist URL");
  }
  const res = await fetch(playlistUrl);
  if (!res.ok) throw new Error(`The playlist answered HTTP ${res.status}`);
  const segments = selectSegments(
    parseMediaPlaylist(await res.text()),
    options.fromMs,
    options.toMs,
  );
  console.log(
    `Downloading segments ${segments[0]?.sq}–${segments.at(-1)?.sq} (${segments.length}).`,
  );
  const bytes = await downloadSegments(segments, fetch);

  await mkdir("recordings", { recursive: true });
  const dvr = join("recordings", `${options.name}-dvr.ts`);
  const mp4 = join("recordings", `${options.name}.mp4`);
  await writeFile(dvr, Buffer.concat(bytes));
  const remux = await run(options.ffmpeg, [
    ...["-hide_banner", "-y", "-i", dvr],
    ...["-map", "0:v", "-c", "copy", "-movflags", "+faststart", mp4],
  ]);
  if (!remux.ok) throw new Error(`ffmpeg could not remux ${dvr}`);
  const probe = parseFfmpegProbe((await run(options.ffmpeg, ["-hide_banner", "-i", mp4])).stderr);
  const segmentsS = segments.reduce((sum, s) => sum + s.durationS, 0);
  if (Math.abs(probe.durationS - segmentsS) > 1 / probe.fps) {
    throw new Error(`${mp4} lasts ${probe.durationS} s; its segments sum to ${segmentsS} s`);
  }

  const startUtcMs = segments[0]?.programDateTimeMs ?? options.fromMs;
  let pass: ClipPass | null = null;
  if (options.noradId !== null) {
    const { satrec, group } = loadSatellite(readText, DEFAULT_GP_DIR, options.noradId);
    const model = createCameraModel({
      lens: camera.lens,
      calibration: camera.defaults,
      widthPx: camera.imageSize.widthPx,
      heightPx: camera.imageSize.heightPx,
    });
    const span = frameSpans(
      satrec,
      group,
      observerSite(camera),
      model,
      options.fromMs,
      options.toMs,
      1_000,
    )[0];
    if (span === undefined) console.warn(`NORAD ${options.noradId} is never in the frame.`);
    else pass = passInMedia(options.noradId, span, startUtcMs, segmentsS);
  }

  const sidecar = buildClipSidecar({
    camera,
    videoId,
    segments,
    probe,
    videoFile: `${options.name}.mp4`,
    pass,
  });
  await writeFile(
    join("recordings", `${options.name}.json`),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );
  await writeFile(
    join("recordings", `${options.name}.segments.json`),
    `${JSON.stringify(segmentLog(segments, bytes), null, 1)}\n`,
  );
  const gp = join("recordings", `${options.name}.gp`);
  await mkdir(gp, { recursive: true });
  for (const file of ["stations.json", "visual.json", "starlink.json", "meta.json"]) {
    await copyFile(join(DEFAULT_GP_DIR, file), join(gp, file));
  }
  console.log(`Wrote ${mp4}, ${dvr}, recordings/${options.name}.json, .segments.json and ${gp}/.`);
  console.log('Next, read the burned-in clock (M5 "Recording a clip" step 4):');
  console.log(
    `${options.ffmpeg} -hide_banner -i ${mp4} -vf "select='between(n\\,20\\,31)',showinfo,crop=200:50:1450:925,tile=2x6" -fps_mode passthrough -frames:v 1 -y clock.png 2>&1 | grep -o 'n: *[0-9]* pts: *[0-9]* pts_time:[0-9.]*'`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
