// scripts/contact-sheet.ts — [M9] one contact sheet per viewport from tests/perf/screens.perf.ts's screenshots (M9
// step 12.2), for the pull request. Run by hand after `npm run build && npm run perf -- screens`, never in CI:
//
//   npx tsx scripts/contact-sheet.ts --ffmpeg <path to ffmpeg> [--dir test-results/screens] [--cols 4] [--cell 720]
//     [--font /System/Library/Fonts/Supplemental/Arial.ttf]
//
// For each <dir>/<viewport>/*.png (sorted by name) it writes <dir>/contact-sheet-<viewport>.png: every screenshot
// scaled to --cell px wide, top-aligned in a cell as tall as the tallest one, labelled with its file name, and tiled
// --cols to a row on white. It needs only ffmpeg (scale, pad, drawtext, concat, tile): no new dependency. Without a
// font file it draws no labels and prints the order instead.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_DIR = "test-results/screens";
export const DEFAULT_COLS = 4;
export const DEFAULT_CELL_PX = 720;
export const DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";
/** Height of the label band above each screenshot, px. */
export const LABEL_BAND_PX = 44;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's IHDR chunk (bytes 16–23); throws for anything that is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isPng =
    bytes.byteLength >= 24 &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR";
  if (!isPng) throw new Error("not a PNG");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Escapes a value for a filtergraph option inside single quotes. */
const quoteOption = (value: string): string => `'${value.replace(/[\\':]/g, (c) => `\\${c}`)}'`;

/**
 * The -filter_complex graph for `sizes` (one per input, in order): scale each to cellPx wide (even height), pad to the
 * tallest plus the label band, label it, then concat and tile `cols` to a row. Output pad: [sheet].
 */
export function sheetFilter(
  sizes: readonly { width: number; height: number }[],
  labels: readonly string[],
  cols: number,
  cellPx: number,
  fontFile: string | null,
): string {
  const scaled = sizes.map((s) => 2 * Math.round((s.height * cellPx) / s.width / 2));
  const cellHeight = Math.max(...scaled) + LABEL_BAND_PX;
  const rows = Math.ceil(sizes.length / cols);
  const cells = sizes.map((_, i) => {
    const label = (labels[i] ?? "").replace(/[^A-Za-z0-9 ._-]/g, "_");
    const text =
      fontFile === null
        ? ""
        : `,drawtext=fontfile=${quoteOption(fontFile)}:text=${quoteOption(label)}:x=12:y=10:fontsize=26:fontcolor=black`;
    return (
      `[${i}:v]scale=${cellPx}:-2:flags=lanczos,format=rgb24,` +
      `pad=${cellPx}:${cellHeight}:0:${LABEL_BAND_PX}:color=white${text},setsar=1[c${i}]`
    );
  });
  const inputs = sizes.map((_, i) => `[c${i}]`).join("");
  return (
    `${cells.join(";")};${inputs}concat=n=${sizes.length}:v=1:a=0,` +
    `tile=${cols}x${rows}:margin=16:padding=16:color=white[sheet]`
  );
}

interface Args {
  readonly ffmpeg: string;
  readonly dir: string;
  readonly cols: number;
  readonly cellPx: number;
  readonly font: string;
}

function parseArgs(argv: readonly string[]): Args {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const ffmpeg = value("--ffmpeg");
  if (ffmpeg === undefined)
    throw new Error("usage: contact-sheet.ts --ffmpeg <path> [--dir <dir>]");
  const cols = Number(value("--cols") ?? DEFAULT_COLS);
  const cellPx = Number(value("--cell") ?? DEFAULT_CELL_PX);
  if (!Number.isInteger(cols) || cols < 1) throw new Error("--cols must be a positive integer");
  if (!Number.isInteger(cellPx) || cellPx < 64) throw new Error("--cell must be an integer ≥ 64");
  return {
    ffmpeg,
    dir: value("--dir") ?? DEFAULT_DIR,
    cols,
    cellPx: cellPx - (cellPx % 2),
    font: value("--font") ?? DEFAULT_FONT,
  };
}

function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const fontFile = existsSync(args.font) ? args.font : null;
  if (fontFile === null) console.warn(`No font at ${args.font}: the sheets are unlabelled.`);
  const viewports = readdirSync(args.dir)
    .filter((name) => statSync(join(args.dir, name)).isDirectory())
    .sort();
  if (viewports.length === 0) throw new Error(`No viewport folders in ${args.dir}`);
  for (const viewport of viewports) {
    const files = readdirSync(join(args.dir, viewport))
      .filter((name) => name.endsWith(".png"))
      .sort();
    if (files.length === 0) continue;
    const paths = files.map((name) => join(args.dir, viewport, name));
    const sizes = paths.map((p) => pngSize(readFileSync(p)));
    const labels = files.map((name) => name.replace(/\.png$/, ""));
    const out = join(args.dir, `contact-sheet-${viewport}.png`);
    const result = spawnSync(
      args.ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        ...paths.flatMap((p) => ["-i", p]),
        "-filter_complex",
        sheetFilter(sizes, labels, args.cols, args.cellPx, fontFile),
        "-map",
        "[sheet]",
        "-frames:v",
        "1",
        out,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status} for ${viewport}`);
    const sheet = pngSize(readFileSync(out));
    console.log(`${out}: ${files.length} screenshots, ${sheet.width} × ${sheet.height} px`);
    if (fontFile === null) console.log(`  order: ${labels.join(", ")}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
