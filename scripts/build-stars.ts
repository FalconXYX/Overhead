// scripts/build-stars.ts — CDS V/50 (Bright Star Catalogue, 5th Revised Ed.) + IAU-CSN proper names
// → public/data/stars.json (M2 step 2).
//
// Run by hand from the repository root. CI never runs it; commit only the output.
//   npx tsx scripts/build-stars.ts                                         downloads both inputs
//   npx tsx scripts/build-stars.ts --catalog <catalog.gz> --csn <IAU-CSN.txt>   local copies
//   either form also takes --out <path> (default public/data/stars.json)
//
// Inputs (both re-downloaded and byte-identical on 2026-10-11):
//   https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz
//     573,921 bytes, sha256 3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed
//   https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt ("Last updated 2022-04-04")
//     71,800 bytes, sha256 84fac0c90f1b19abc491c2793469e0caa7b003ad1bc93a790ca41147010d0eb0
// The script warns (and still writes) when an input's size or sha256 differs from these.
//
// Output: one StarRow [raDegJ2000, decDegJ2000, vmag, hr, name] per line, sorted by vmag then HR, so a
// magnitude limit is a prefix. Expected summary for the inputs above:
//   9110 records, 14 without position, 8404 rows at V <= 6.5, 333 proper names, 5319 without any name
//   (1245 Bayer, 1507 Flamsteed); stars.json is 307,503 bytes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import type { StarRow } from "../src/domain/astro";

export const CATALOG_URL = "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz";
export const CATALOG_BYTES = 573_921;
export const CATALOG_SHA256 = "3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed";
export const CSN_URL = "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt";
export const CSN_BYTES = 71_800;
export const CSN_SHA256 = "84fac0c90f1b19abc491c2793469e0caa7b003ad1bc93a790ca41147010d0eb0";
const DEFAULT_OUT = "public/data/stars.json";

/** CDS trims trailing blanks (lines are 160–197 characters); pad to the full record before slicing. */
export const BSC_LINE_LENGTH = 197;
/** Inclusive: 49 stars sit at exactly 6.50. */
export const V_LIMIT = 6.5;

/** BSC5 Bayer abbreviations (trimmed: "Mu", "Nu", "Xi" and "Pi" are 2 letters plus a blank in the file). */
const GREEK: ReadonlyMap<string, string> = new Map([
  ["Alp", "α"],
  ["Bet", "β"],
  ["Gam", "γ"],
  ["Del", "δ"],
  ["Eps", "ε"],
  ["Zet", "ζ"],
  ["Eta", "η"],
  ["The", "θ"],
  ["Iot", "ι"],
  ["Kap", "κ"],
  ["Lam", "λ"],
  ["Mu", "μ"],
  ["Nu", "ν"],
  ["Xi", "ξ"],
  ["Omi", "ο"],
  ["Pi", "π"],
  ["Rho", "ρ"],
  ["Sig", "σ"],
  ["Tau", "τ"],
  ["Ups", "υ"],
  ["Phi", "φ"],
  ["Chi", "χ"],
  ["Psi", "ψ"],
  ["Ome", "ω"],
]);

/**
 * The BSC Name field (record bytes 5–14): Flamsteed [0, 3), Bayer abbreviation [3, 6), Bayer index [6],
 * constellation [7, 10). Returns the Bayer designation ("ι Tel", "ψ6 Aur"), else the Flamsteed one ("61 Cyg"),
 * else "". Throws on an unknown Bayer abbreviation or a malformed field.
 */
export function bscDesignation(nameField: string): string {
  const field = nameField.padEnd(10, " ");
  const flamsteed = field.slice(0, 3).trim();
  const bayer = field.slice(3, 6).trim();
  const index = field.slice(6, 7).trim();
  const constellation = field.slice(7, 10).trim();
  if (bayer === "" && flamsteed === "") {
    if (field.trim() !== "") throw new Error(`BSC name field "${nameField}" has no designation`);
    return "";
  }
  if (!/^[A-Z][A-Za-z]{2}$/.test(constellation)) {
    throw new Error(`BSC name field "${nameField}": bad constellation "${constellation}"`);
  }
  if (bayer !== "") {
    const letter = GREEK.get(bayer);
    if (letter === undefined) {
      throw new Error(`BSC name field "${nameField}": unknown Bayer abbreviation "${bayer}"`);
    }
    if (!/^\d?$/.test(index)) {
      throw new Error(`BSC name field "${nameField}": bad Bayer index "${index}"`);
    }
    return `${letter}${index} ${constellation}`;
  }
  if (!/^\d+$/.test(flamsteed)) {
    throw new Error(`BSC name field "${nameField}": bad Flamsteed number "${flamsteed}"`);
  }
  return `${flamsteed} ${constellation}`;
}

export interface BscStar {
  readonly hr: number;
  readonly raDeg: number; // J2000, epoch 2000, rounded to 5 decimals
  readonly decDeg: number;
  readonly vmag: number;
  readonly designation: string; // bscDesignation of the Name field
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const round5 = (x: number): number => Math.round(x * 1e5) / 1e5;

/** Parses line.slice(start, end) as a decimal number below `max` (if given); throws naming the record. */
function field(
  line: string,
  start: number,
  end: number,
  what: string,
  hr: string,
  max?: number,
): number {
  const raw = line.slice(start, end).trim();
  const value = Number(raw);
  if (
    !DECIMAL.test(raw) ||
    !Number.isFinite(value) ||
    (max !== undefined && !(value >= 0 && value < max))
  ) {
    throw new Error(`HR ${hr}: bad ${what} "${line.slice(start, end)}"`);
  }
  return value;
}

/**
 * One CDS V/50 record (trailing blanks may be trimmed). Slices are the ReadMe's 1-based bytes minus one.
 * Returns null for a record whose J2000 RA is blank (14 in the catalogue: novae, clusters, deleted entries).
 */
export function parseBscRecord(rawLine: string): BscStar | null {
  const line = rawLine.padEnd(BSC_LINE_LENGTH, " ");
  const hrText = line.slice(0, 4).trim();
  const hr = field(line, 0, 4, "HR", hrText);
  if (!Number.isInteger(hr) || hr < 1) throw new Error(`bad HR "${line.slice(0, 4)}"`);
  if (line.slice(75, 83).trim() === "") return null;

  const raH = field(line, 75, 77, "RA hours", hrText, 24);
  const raM = field(line, 77, 79, "RA minutes", hrText, 60);
  const raS = field(line, 79, 83, "RA seconds", hrText, 60);
  const sign = line.slice(83, 84);
  if (sign !== "+" && sign !== "-") throw new Error(`HR ${hrText}: bad Dec sign "${sign}"`);
  const decD = field(line, 84, 86, "Dec degrees", hrText, 91);
  const decM = field(line, 86, 88, "Dec minutes", hrText, 60);
  const decS = field(line, 88, 90, "Dec seconds", hrText, 60);
  const vmag = field(line, 102, 107, "Vmag", hrText);

  const raDeg = round5((raH + raM / 60 + raS / 3600) * 15);
  const decAbs = round5(decD + decM / 60 + decS / 3600);
  // Rounding the magnitude, then applying the sign, keeps Math.round's half-up rule symmetric; no -0.
  const decDeg = sign === "-" && decAbs !== 0 ? -decAbs : decAbs;
  return { hr, raDeg, decDeg, vmag, designation: bscDesignation(line.slice(4, 14)) };
}

/** The Designation column starts at character 36 (after the ASCII and diacritics name columns, 18 each). */
const CSN_HR = /^.{18}.{18}HR (\d+)\s/;

/**
 * IAU-CSN proper names by HR number: the ASCII name (characters [0, 18), trimmed) of every data line whose
 * designation is "HR n". Lines starting with "#" or "$" are comments. Throws on a duplicate HR.
 */
export function parseCsnNames(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.startsWith("$")) continue;
    const match = CSN_HR.exec(line);
    if (match === null) {
      // A misaligned row would otherwise drop its name silently.
      if (/(^|\s)HR \d/.test(line.slice(18, 50)))
        throw new Error(`IAU-CSN: unaligned HR row "${line}"`);
      continue;
    }
    const hr = Number(match[1]);
    const name = line.slice(0, 18).trim();
    if (name === "") throw new Error(`IAU-CSN: HR ${hr} has an empty name`);
    const previous = names.get(hr);
    if (previous !== undefined) {
      throw new Error(`IAU-CSN: duplicate HR ${hr} ("${previous}" and "${name}")`);
    }
    names.set(hr, name);
  }
  return names;
}

export interface StarsSummary {
  readonly records: number; // non-empty catalogue lines
  readonly withoutPosition: number; // records skipped for a blank RA
  readonly rows: number; // records with V <= V_LIMIT
  readonly properNames: number; // rows named from IAU-CSN
  readonly bayer: number; // other rows named by Bayer designation
  readonly flamsteed: number; // other rows named by Flamsteed designation
  readonly unnamed: number; // rows with name ""
}

export interface StarsBuild {
  readonly rows: StarRow[];
  readonly summary: StarsSummary;
  readonly skippedHrs: number[]; // records without position
  readonly unusedCsnHrs: number[]; // IAU-CSN HR numbers that name no row
}

/** catalogText: the gunzipped catalogue decoded as latin1. csnText: IAU-CSN decoded as UTF-8. */
export function buildStarRows(catalogText: string, csnText: string): StarsBuild {
  const names = parseCsnNames(csnText);
  const seen = new Set<number>();
  const skippedHrs: number[] = [];
  const kept: BscStar[] = [];
  let records = 0;
  for (const line of catalogText.split("\n")) {
    if (line === "") continue;
    records++;
    const star = parseBscRecord(line);
    const hr = star?.hr ?? Number(line.slice(0, 4));
    if (seen.has(hr)) throw new Error(`catalogue: duplicate HR ${hr}`);
    seen.add(hr);
    if (star === null) skippedHrs.push(hr);
    else if (star.vmag <= V_LIMIT) kept.push(star);
  }
  kept.sort((a, b) => a.vmag - b.vmag || a.hr - b.hr);

  let properNames = 0;
  let bayer = 0;
  let flamsteed = 0;
  let unnamed = 0;
  const rows = kept.map((star): StarRow => {
    const proper = names.get(star.hr);
    if (proper !== undefined) properNames++;
    else if (star.designation === "") unnamed++;
    else if (/^\d/.test(star.designation)) flamsteed++;
    else bayer++;
    return [star.raDeg, star.decDeg, star.vmag, star.hr, proper ?? star.designation];
  });
  const rowHrs = new Set(kept.map((star) => star.hr));
  const unusedCsnHrs = [...names.keys()].filter((hr) => !rowHrs.has(hr)).sort((a, b) => a - b);
  return {
    rows,
    summary: {
      records,
      withoutPosition: skippedHrs.length,
      rows: rows.length,
      properNames,
      bayer,
      flamsteed,
      unnamed,
    },
    skippedHrs,
    unusedCsnHrs,
  };
}

/** The line to paste into the PR. */
export function summaryLine(s: StarsSummary, catalogSha256: string, csnSha256: string): string {
  return (
    `${s.records} records, ${s.withoutPosition} without position, ${s.rows} rows at V <= ${V_LIMIT}, ` +
    `${s.properNames} proper names, ${s.unnamed} without any name ` +
    `(${s.bayer} Bayer, ${s.flamsteed} Flamsteed); ` +
    `catalog.gz sha256 ${catalogSha256}, IAU-CSN.txt sha256 ${csnSha256}`
  );
}

/** One row per line: "[\n" + rows joined by ",\n" + "\n]\n". */
export function formatStarsJson(rows: readonly StarRow[]): string {
  return `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Reads a local copy when a path is given, else downloads; warns when the bytes differ from the header's. */
async function loadInput(
  label: string,
  path: string | undefined,
  url: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const bytes = path === undefined ? await download(url) : new Uint8Array(readFileSync(path));
  const sha256 = sha256Hex(bytes);
  if (bytes.byteLength !== expectedBytes || sha256 !== expectedSha256) {
    console.warn(
      `${label} differs from the recorded input: ${bytes.byteLength} bytes, sha256 ${sha256} ` +
        `(recorded ${expectedBytes} bytes, sha256 ${expectedSha256}). Check the output before committing it.`,
    );
  }
  return { bytes, sha256 };
}

function parseArgs(argv: readonly string[]): { catalog?: string; csn?: string; out: string } {
  const options: { catalog?: string; csn?: string; out: string } = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    if (flag === "--catalog") options.catalog = value;
    else if (flag === "--csn") options.csn = value;
    else if (flag === "--out") options.out = value;
    else {
      throw new Error(
        `unknown argument ${flag}. Usage: npx tsx scripts/build-stars.ts [--catalog <catalog.gz>] [--csn <IAU-CSN.txt>] [--out <path>]`,
      );
    }
  }
  return options;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  const catalog = await loadInput(
    "catalog.gz",
    options.catalog,
    CATALOG_URL,
    CATALOG_BYTES,
    CATALOG_SHA256,
  );
  const csn = await loadInput("IAU-CSN.txt", options.csn, CSN_URL, CSN_BYTES, CSN_SHA256);
  const catalogText = gunzipSync(catalog.bytes).toString("latin1");
  const csnText = new TextDecoder("utf-8", { fatal: true }).decode(csn.bytes);

  const build = buildStarRows(catalogText, csnText);
  if (build.unusedCsnHrs.length > 0) {
    console.warn(
      `IAU-CSN names for HR ${build.unusedCsnHrs.join(", ")} fall outside V <= ${V_LIMIT}.`,
    );
  }
  const json = formatStarsJson(build.rows);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, json);
  console.log(`Wrote ${options.out}: ${Buffer.byteLength(json)} bytes`);
  console.log(`Skipped without position: HR ${build.skippedHrs.join(", ")}`);
  console.log(summaryLine(build.summary, catalog.sha256, csn.sha256));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
