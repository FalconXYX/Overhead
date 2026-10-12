// scripts/fixtures/clip-pairs.ts — the real-frame calibration fixture, measured on the recorded Subaru StarCam clip
// (M4 step 18 stand-in until a clear Nānā ao night; tests/unit/calibrationFixture.test.ts reads it).
// Run by hand: npx tsx scripts/fixtures/clip-pairs.ts [--sidecar recordings/subaru-2026-10-11-iss.json]
//                [--ffmpeg ffmpeg] [--out tests/fixtures/calibration/subaru-clip-pairs.json]
// CI never runs it: the clip is gitignored (O2). Needs an ffmpeg with the H.264 decoder.
//
// Per epoch: the mean of 60 consecutive frames (ffmpeg, gray). Sources: 5 × 5 local maxima ≥ 6σ above a 32 px
// median background, measured by the centroid of the positive residual in the 5 × 5 window; a blob that reaches the
// 8-bit ceiling (Jupiter, the brightest stars) by the residual-weighted centroid of its whole half-maximum region
// (gotcha G15). Targets: stars.json rows with V ≤ 5.5 and the planets, apparent az/alt at the epoch's frame time
// (starUnitVectors, rotateStarsAzAltDeg, computeBodies) at the registry site, projected through the sidecar's star
// fit scaled to the clip. A target pairs with the nearest source within 3 px and a source keeps its nearest target.
// Sky only: v < 870 px (the domes and the burned-in clock lie below). Pixels are continuous: index + 0.5.
// Roles: the planets and HOLDOUT_STARS are holdouts at every epoch, everything else fits.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCameraRegistry } from "../../src/app/cameras";
import { parseClipSidecar } from "../../src/app/clip";
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
  rotateStarsAzAltDeg,
  type StarRow,
  starUnitVectors,
} from "../../src/domain/astro";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  projectAzAltDeg,
} from "../../src/domain/camera";
import type { ObserverSite } from "../../src/domain/geo";
import type { PlanetId, StarId, StarPair } from "../../src/state/types";

const DEFAULT_SIDECAR = "recordings/subaru-2026-10-11-iss.json";
const DEFAULT_OUT = "tests/fixtures/calibration/subaru-clip-pairs.json";
const CAMERAS_JSON = "public/data/cameras.json";
const STARS_JSON = "public/data/stars.json";

/** First frame of each 60-frame stack: media 55.0, 240.0 and 460.0 s (start, middle, end of the 480 s clip). */
export const EPOCH_FIRST_FRAMES: readonly number[] = [1650, 7200, 13800];
export const STACK_FRAMES = 60;
const BACKGROUND_TILE_PX = 32;
const DETECT_SIGMA = 6;
const LOCAL_MAX_RADIUS_PX = 2; // 5 × 5
const SATURATED_LEVEL = 250; // stack mean at the 8-bit ceiling
const BLOB_MAX_RADIUS_PX = 30;
const MAX_VMAG = 5.5;
const MATCH_RADIUS_PX = 3;
const EDGE_PX = 3;
const SKY_MAX_V_PX = 870;

/** Named stars held out at every epoch, left, middle and right of the frame (u ≈ 260, 930, 1675 px; V 3.0–3.6). */
export const HOLDOUT_STARS: readonly StarId[] = [
  "star:4335", // ψ UMa
  "star:4359", // Chertan
  "star:3994", // λ Hya
];

/**
 * The start: the provisional Subaru defaults at the registry's 3840 × 2160 (DECISIONS O2: fixtures naming them keep
 * az 81.2°, alt 19.6°, roll 0, f 2742 inline), scaled to the clip like the sidecar's calibration.
 */
const PROVISIONAL_DEFAULTS_3840: Calibration = {
  azDeg: 81.2,
  altDeg: 19.6,
  rollDeg: 0,
  focalPx: 2742,
  cxPx: 1920,
  cyPx: 1080,
  k1: 0,
  k2: 0,
  flipX: false,
  streamDelayMs: 0,
  rmsDeg: null,
  updatedAtMs: 0,
};

export interface Source {
  readonly uPx: number; // continuous
  readonly vPx: number;
  readonly peak: number; // residual above the background
  readonly saturated: boolean;
}

export interface Target {
  readonly id: StarId | PlanetId;
  readonly azDeg: number;
  readonly altDeg: number;
}

export interface FixturePair {
  readonly imagePx: readonly [uPx: number, vPx: number];
  readonly targetId: StarId | PlanetId;
  readonly role: StarPair["role"];
}

/** focalPx, cxPx and cyPx × scale; the angles and the distortion are size-free. */
export function scaleCalibration(c: Calibration, scale: number): Calibration {
  return { ...c, focalPx: c.focalPx * scale, cxPx: c.cxPx * scale, cyPx: c.cyPx * scale };
}

/** Mean gray frame of each [first, first + count) range, in one ffmpeg pass (frames come out in order). */
async function stackEpochs(
  ffmpeg: string,
  video: string,
  firstFrames: readonly number[],
  count: number,
  widthPx: number,
  heightPx: number,
): Promise<Float32Array[]> {
  const select = firstFrames.map((n) => `between(n\\,${n}\\,${n + count - 1})`).join("+");
  const args = ["-hide_banner", "-loglevel", "error", "-i", video, "-vf"];
  args.push(`select=${select},format=gray`, "-fps_mode", "passthrough", "-f", "rawvideo", "-");
  const frameBytes = widthPx * heightPx;
  const sums = firstFrames.map(() => new Float64Array(frameBytes));
  let frames = 0;
  let pending: Buffer = Buffer.alloc(0);
  const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.on("data", (chunk: Buffer) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      const sum = sums[Math.floor(frames / count)];
      if (sum !== undefined)
        for (let i = 0; i < frameBytes; i++) sum[i] = (sum[i] ?? 0) + (pending[i] ?? 0);
      pending = pending.subarray(frameBytes);
      frames++;
    }
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`ffmpeg exited with ${String(code)}`);
  if (frames !== firstFrames.length * count)
    throw new Error(`ffmpeg gave ${frames} frames, expected ${firstFrames.length * count}`);
  return sums.map((sum) => Float32Array.from(sum, (s) => s / count));
}

/** Median of each tile, bilinear between tile centres. */
function backgroundOf(img: Float32Array, widthPx: number, heightPx: number): Float32Array {
  const t = BACKGROUND_TILE_PX;
  const gw = Math.ceil(widthPx / t);
  const gh = Math.ceil(heightPx / t);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const values: number[] = [];
      for (let y = gy * t; y < Math.min(heightPx, (gy + 1) * t); y++)
        for (let x = gx * t; x < Math.min(widthPx, (gx + 1) * t); x++)
          values.push(img[y * widthPx + x] ?? 0);
      values.sort((a, b) => a - b);
      grid[gy * gw + gx] = values[values.length >> 1] ?? 0;
    }
  }
  const at = (i: number, j: number): number =>
    grid[Math.min(j, gh - 1) * gw + Math.min(i, gw - 1)] ?? 0;
  const bg = new Float32Array(widthPx * heightPx);
  for (let y = 0; y < heightPx; y++) {
    const fy = Math.min(Math.max(y / t - 0.5, 0), gh - 1.001);
    const iy = Math.floor(fy);
    const ay = fy - iy;
    for (let x = 0; x < widthPx; x++) {
      const fx = Math.min(Math.max(x / t - 0.5, 0), gw - 1.001);
      const ix = Math.floor(fx);
      const ax = fx - ix;
      bg[y * widthPx + x] =
        (1 - ax) * (1 - ay) * at(ix, iy) +
        ax * (1 - ay) * at(ix + 1, iy) +
        (1 - ax) * ay * at(ix, iy + 1) +
        ax * ay * at(ix + 1, iy + 1);
    }
  }
  return bg;
}

/** Point sources of a stacked frame, brightest first (see the header). */
export function detectSources(img: Float32Array, widthPx: number, heightPx: number): Source[] {
  const bg = backgroundOf(img, widthPx, heightPx);
  const res = new Float32Array(img.length);
  for (let i = 0; i < img.length; i++) res[i] = (img[i] ?? 0) - (bg[i] ?? 0);
  const sample: number[] = [];
  for (let i = 0; i < res.length; i += 97) sample.push(Math.abs(res[i] ?? 0));
  sample.sort((a, b) => a - b);
  const threshold = DETECT_SIGMA * 1.4826 * (sample[sample.length >> 1] ?? 0);

  const r = LOCAL_MAX_RADIUS_PX;
  const peaks: number[] = [];
  for (let y = r + 1; y < heightPx - r - 1; y++) {
    for (let x = r + 1; x < widthPx - r - 1; x++) {
      const i = y * widthPx + x;
      const v = res[i] ?? 0;
      if (v < threshold) continue;
      let isMax = true;
      for (let dy = -r; dy <= r && isMax; dy++)
        for (let dx = -r; dx <= r; dx++)
          if ((dx !== 0 || dy !== 0) && (res[i + dy * widthPx + dx] ?? 0) > v) {
            isMax = false;
            break;
          }
      if (isMax) peaks.push(i);
    }
  }
  peaks.sort((a, b) => (res[b] ?? 0) - (res[a] ?? 0));

  const claimed = new Uint8Array(img.length);
  const sources: Source[] = [];
  for (const i of peaks) {
    if (claimed[i] === 1) continue;
    const x0 = i % widthPx;
    const y0 = (i - x0) / widthPx;
    if ((img[i] ?? 0) < SATURATED_LEVEL) {
      let sw = 0;
      let sx = 0;
      let sy = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const q = res[i + dy * widthPx + dx] ?? 0;
          if (q <= 0) continue;
          sw += q;
          sx += q * (x0 + dx);
          sy += q * (y0 + dy);
        }
      sources.push({ uPx: sx / sw + 0.5, vPx: sy / sw + 0.5, peak: res[i] ?? 0, saturated: false });
      continue;
    }
    // Saturated: flood the 8-connected region at or above half the peak over the background.
    const half = (bg[i] ?? 0) + ((img[i] ?? 0) - (bg[i] ?? 0)) / 2;
    const seen = new Set<number>([i]);
    const stack = [i];
    let sw = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length > 0) {
      const p = stack.pop() ?? i;
      const px = p % widthPx;
      const py = (p - px) / widthPx;
      const w = Math.max(res[p] ?? 0, 0);
      sw += w;
      sx += w * px;
      sy += w * py;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          const n = ny * widthPx + nx;
          if (nx < 0 || ny < 0 || nx >= widthPx || ny >= heightPx || seen.has(n)) continue;
          if (Math.hypot(nx - x0, ny - y0) > BLOB_MAX_RADIUS_PX || (img[n] ?? 0) < half) continue;
          seen.add(n);
          stack.push(n);
        }
    }
    const cu = sx / sw;
    const cv = sy / sw;
    let radius = 0;
    for (const p of seen)
      radius = Math.max(radius, Math.hypot((p % widthPx) - cu, Math.floor(p / widthPx) - cv));
    // The halo of a saturated blob is bumpy: claim twice its radius so no bump becomes a star.
    const claim = Math.ceil(2 * radius + 3);
    for (
      let y = Math.max(0, Math.floor(cv) - claim);
      y <= Math.min(heightPx - 1, Math.ceil(cv) + claim);
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cu) - claim);
        x <= Math.min(widthPx - 1, Math.ceil(cu) + claim);
        x++
      )
        if (Math.hypot(x - cu, y - cv) <= claim) claimed[y * widthPx + x] = 1;
    sources.push({ uPx: cu + 0.5, vPx: cv + 0.5, peak: res[i] ?? 0, saturated: true });
  }
  return sources;
}

/** Stars with V ≤ MAX_VMAG (brightest first), then the planets, apparent az/alt at timeMs. */
export function targetsAt(rows: readonly StarRow[], site: ObserverSite, timeMs: number): Target[] {
  const time = astroTimeAt(timeMs);
  const observer = makeObserver(site);
  const bright = rows.filter((row) => row[2] <= MAX_VMAG);
  const azAlt = new Float32Array(2 * bright.length);
  rotateStarsAzAltDeg(time, observer, starUnitVectors(bright), bright.length, azAlt);
  const targets: Target[] = bright.map((row, i) => ({
    id: `star:${row[3]}`,
    azDeg: azAlt[2 * i] ?? Number.NaN,
    altDeg: azAlt[2 * i + 1] ?? Number.NaN,
  }));
  const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE);
  computeBodies(time, observer, bodies);
  BODY_IDS.forEach((id, i) => {
    if (!id.startsWith("planet:")) return;
    targets.push({
      id: id as PlanetId,
      azDeg: bodies[i * BODY_STRIDE] ?? Number.NaN,
      altDeg: bodies[i * BODY_STRIDE + 1] ?? Number.NaN,
    });
  });
  return targets;
}

/** Nearest source within MATCH_RADIUS_PX of each target that projects into the sky part of the frame. */
export function identify(
  targets: readonly Target[],
  sources: readonly Source[],
  model: CameraModel,
): { target: Target; source: Source; distancePx: number }[] {
  const uv = new Float64Array(2);
  const bySource = new Map<Source, { target: Target; source: Source; distancePx: number }>();
  for (const target of targets) {
    if (!projectAzAltDeg(model, target.azDeg, target.altDeg, uv, 0)) continue;
    const u = uv[0] ?? Number.NaN;
    const v = uv[1] ?? Number.NaN;
    if (!(u >= EDGE_PX && u <= model.widthPx - EDGE_PX && v >= EDGE_PX && v <= SKY_MAX_V_PX))
      continue;
    let best: Source | null = null;
    let bestD = MATCH_RADIUS_PX;
    for (const s of sources) {
      const d = Math.hypot(s.uPx - u, s.vPx - v);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best === null) continue;
    const held = bySource.get(best);
    if (held === undefined || bestD < held.distancePx)
      bySource.set(best, { target, source: best, distancePx: bestD });
  }
  const order = new Map(targets.map((t, i) => [t, i]));
  return [...bySource.values()].sort(
    (a, b) => (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0),
  );
}

/** JSON with every value that fits on one line kept on one line (a pair per line). */
function formatJson(value: unknown, indent = ""): string {
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== "object" || indent.length + flat.length <= 100)
    return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value))
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value).map(
    ([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

const round = (x: number, digits: number): number => Number(x.toFixed(digits));

function argValue(argv: readonly string[], name: string, fallback: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] ?? fallback) : fallback;
}

export async function main(argv: readonly string[]): Promise<void> {
  const sidecarPath = argValue(argv, "--sidecar", DEFAULT_SIDECAR);
  const ffmpeg = argValue(argv, "--ffmpeg", "ffmpeg");
  const out = argValue(argv, "--out", DEFAULT_OUT);

  const registry = parseCameraRegistry(JSON.parse(await readFile(CAMERAS_JSON, "utf8")));
  const parsed = parseClipSidecar(
    JSON.parse(await readFile(sidecarPath, "utf8")),
    registry,
    Date.now(),
  );
  if (!parsed.ok) throw new Error(`${sidecarPath}: ${parsed.errors.join("; ")}`);
  const sidecar = parsed.sidecar;
  const camera = registry[sidecar.cameraId];
  if (camera === undefined || sidecar.calibration === undefined)
    throw new Error(`${sidecarPath} needs a registry camera and a star-fitted calibration`);
  const { width, height, fps } = sidecar;
  const scale = width / camera.imageSize.widthPx;
  const seed = scaleCalibration(sidecar.calibration, scale);
  const model = createCameraModel({
    lens: camera.lens,
    calibration: seed,
    widthPx: width,
    heightPx: height,
  });
  const rows = JSON.parse(await readFile(STARS_JSON, "utf8")) as StarRow[];

  const video = join(dirname(sidecarPath), sidecar.videoFile);
  const stacks = await stackEpochs(ffmpeg, video, EPOCH_FIRST_FRAMES, STACK_FRAMES, width, height);
  const holdout = new Set<string>(HOLDOUT_STARS);
  const epochs = EPOCH_FIRST_FRAMES.map((firstFrame, e) => {
    const mediaS = (firstFrame + (STACK_FRAMES - 1) / 2) / fps;
    const frameTimeMs = sidecar.startUtcMs + Math.round(mediaS * 1000);
    const sources = detectSources(stacks[e] ?? new Float32Array(0), width, height);
    const matches = identify(targetsAt(rows, camera.site, frameTimeMs), sources, model);
    const pairs: FixturePair[] = matches.map((m) => ({
      imagePx: [round(m.source.uPx, 2), round(m.source.vPx, 2)],
      targetId: m.target.id,
      role: m.target.id.startsWith("planet:") || holdout.has(m.target.id) ? "holdout" : "fit",
    }));
    const rms = Math.sqrt(matches.reduce((s, m) => s + m.distancePx ** 2, 0) / matches.length);
    console.log(
      `media ${mediaS.toFixed(3)} s: ${sources.length} sources, ${pairs.length} pairs, ` +
        `rms ${rms.toFixed(3)} px under the sidecar fit`,
    );
    return {
      mediaS: round(mediaS, 3),
      firstFrame,
      frameCount: STACK_FRAMES,
      frameTimeMs,
      frameTimeUtc: new Date(frameTimeMs).toISOString(),
      pairs,
    };
  });

  const fixture = {
    description:
      "Star and planet pairs measured on the recorded Subaru StarCam clip of 2026-10-11 (M4 calibration " +
      "acceptance on a real frame). Pixels are continuous at the clip's 1920 × 1080 (corners at (0, 0) and " +
      "(W, H)); each epoch is the mean of frameCount frames from firstFrame, at frameTimeMs = startUtcMs + " +
      "the stack's middle media time. calibration is the fit's start: the provisional Subaru defaults scaled " +
      "to 1920 px. Holdouts: the planets and three named stars at every epoch. Targets were identified " +
      "through identifiedWith, the sidecar's star fit at 1920 px. Rebuilt by scripts/fixtures/clip-pairs.ts.",
    cameraId: sidecar.cameraId,
    clip: {
      sidecar: sidecarPath,
      videoFile: sidecar.videoFile,
      startUtcMs: sidecar.startUtcMs,
      startUncertaintyS: sidecar.startUncertaintyS,
      fps,
    },
    lens: camera.lens,
    imageSize: { widthPx: width, heightPx: height },
    calibration: scaleCalibration(PROVISIONAL_DEFAULTS_3840, scale),
    measurement: {
      backgroundTilePx: BACKGROUND_TILE_PX,
      detectSigma: DETECT_SIGMA,
      saturatedLevel: SATURATED_LEVEL,
      maxVmag: MAX_VMAG,
      matchRadiusPx: MATCH_RADIUS_PX,
      skyMaxVPx: SKY_MAX_V_PX,
      identifiedWith: {
        azDeg: seed.azDeg,
        altDeg: seed.altDeg,
        rollDeg: seed.rollDeg,
        focalPx: seed.focalPx,
        cxPx: seed.cxPx,
        cyPx: seed.cyPx,
        k1: seed.k1,
        k2: seed.k2,
        flipX: seed.flipX,
      },
    },
    epochs,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${formatJson(fixture)}\n`);
  console.log(`wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
