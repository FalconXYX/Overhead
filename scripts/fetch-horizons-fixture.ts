// scripts/fetch-horizons-fixture.ts — JPL Horizons AIRLESS az/el tables for the Sun, Moon and six planets
// at the CFHT point on Maunakea, 2026-10-10 00:00 → 2026-10-11 00:00 UT every 20 min (M2 step 4).
// Run by hand: npx tsx scripts/fetch-horizons-fixture.ts [outPath]
//   (default tests/fixtures/horizons-airless-maunakea-2026-10-10.json)
// CI never runs it. One request per body, 500 ms apart. Nothing is written unless all 8 tables pass the checks.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";
const DEFAULT_OUT = "tests/fixtures/horizons-airless-maunakea-2026-10-10.json";
const REQUEST_GAP_MS = 500;
/** 00:00 through 24:00 inclusive at 20 min. */
export const HORIZONS_ROWS_PER_BODY = 73;

/** Keys are the BODY_IDS strings of src/domain/astro, in that order; values are Horizons COMMAND ids. */
export const HORIZONS_BODIES: readonly (readonly [bodyId: string, command: string])[] = [
  ["sun", "10"],
  ["moon", "301"],
  ["planet:Mercury", "199"],
  ["planet:Venus", "299"],
  ["planet:Mars", "499"],
  ["planet:Jupiter", "599"],
  ["planet:Saturn", "699"],
  ["planet:Uranus", "799"],
];

export const HORIZONS_SITE = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 } as const;

export const HORIZONS_QUERY_SUMMARY =
  "EPHEM_TYPE=OBSERVER CENTER=coord@399 COORD_TYPE=GEODETIC QUANTITIES=4 ANG_FORMAT=DEG EXTRA_PREC=YES APPARENT=AIRLESS TIME_TYPE=UT STEP_SIZE=20m";

/** One row: [isoUtc, azDeg, elDeg], airless. */
export type HorizonsRow = [isoUtc: string, azDeg: number, elDeg: number];

/** The request for one body. Single quotes are part of each value; URLSearchParams encodes them. */
export function horizonsQueryParams(command: string): URLSearchParams {
  // SITE_COORD is east longitude, latitude, km.
  const siteCoord = `${HORIZONS_SITE.lonDeg},${HORIZONS_SITE.latDeg},${HORIZONS_SITE.heightM / 1000}`;
  return new URLSearchParams({
    format: "json",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@399'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${siteCoord}'`,
    START_TIME: "'2026-10-10 00:00'",
    STOP_TIME: "'2026-10-11 00:00'",
    STEP_SIZE: "'20m'",
    TIME_TYPE: "'UT'",
    QUANTITIES: "'4'",
    ANG_FORMAT: "'DEG'",
    EXTRA_PREC: "'YES'",
    APPARENT: "'AIRLESS'",
    CSV_FORMAT: "'YES'",
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HORIZONS_DATE = /^\s*(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2})\s*$/;

/** " 2026-Oct-10 00:20" → "2026-10-10T00:20:00Z". Throws on anything else. */
export function horizonsUtcToIso(text: string): string {
  const m = HORIZONS_DATE.exec(text);
  const month = MONTHS.indexOf(m?.[2] ?? "");
  if (m === null || month < 0) throw new Error(`unexpected Horizons date ${JSON.stringify(text)}`);
  return `${m[1]}-${String(month + 1).padStart(2, "0")}-${m[3]}T${m[4]}:${m[5]}:00Z`;
}

/**
 * Rows of one Horizons `result` text: the CSV lines between $$SOE and $$EOE (date, solar flag, lunar flag,
 * az, el). Throws unless the header says the table is airless, or on a missing table or a non-finite angle.
 */
export function parseHorizonsTable(result: string): HorizonsRow[] {
  if (!result.includes("Atmos refraction: NO (AIRLESS)")) {
    throw new Error("Horizons table is not AIRLESS ('Atmos refraction: NO (AIRLESS)' missing)");
  }
  const start = result.indexOf("$$SOE");
  const end = result.indexOf("$$EOE");
  if (start < 0 || end < start) throw new Error("Horizons table has no $$SOE … $$EOE block");
  return result
    .slice(start + "$$SOE".length, end)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): HorizonsRow => {
      const cells = line.split(",");
      return [
        horizonsUtcToIso(cells[0] ?? ""),
        angleCell(cells[3], line),
        angleCell(cells[4], line),
      ];
    });
}

/** Number("") is 0, so a blank cell is rejected before the finiteness check. */
function angleCell(cell: string | undefined, line: string): number {
  const text = cell?.trim() ?? "";
  const value = text === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite az or el in Horizons row ${JSON.stringify(line)}`);
  }
  return value;
}

async function fetchBody(command: string): Promise<HorizonsRow[]> {
  const url = `${API_URL}?${horizonsQueryParams(command).toString()}`;
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: unknown };
  if (body.error !== undefined) {
    throw new Error(`Horizons COMMAND '${command}': ${String(body.error)}`);
  }
  if (typeof body.result !== "string") {
    throw new Error(`Horizons COMMAND '${command}': no result text`);
  }
  const rows = parseHorizonsTable(body.result);
  if (rows.length !== HORIZONS_ROWS_PER_BODY) {
    throw new Error(
      `Horizons COMMAND '${command}': ${rows.length} rows, expected ${HORIZONS_ROWS_PER_BODY}`,
    );
  }
  return rows;
}

/** Same JSON as JSON.stringify(…, null, 2), but one table row per line. */
function formatFixture(fixture: {
  generator: string;
  fetchedAtUtc: string;
  query: string;
  site: typeof HORIZONS_SITE;
  bodies: Record<string, { command: string; rows: HorizonsRow[] }>;
}): string {
  const bodies = Object.entries(fixture.bodies).map(
    ([id, { command, rows }]) =>
      `    ${JSON.stringify(id)}: {\n      "command": ${JSON.stringify(command)},\n      "rows": [\n` +
      `${rows.map((row) => `        ${JSON.stringify(row)}`).join(",\n")}\n      ]\n    }`,
  );
  return (
    "{\n" +
    `  "generator": ${JSON.stringify(fixture.generator)},\n` +
    `  "fetchedAtUtc": ${JSON.stringify(fixture.fetchedAtUtc)},\n` +
    `  "query": ${JSON.stringify(fixture.query)},\n` +
    `  "site": ${JSON.stringify(fixture.site)},\n` +
    `  "bodies": {\n${bodies.join(",\n")}\n  }\n}\n`
  );
}

async function main(outPath: string): Promise<void> {
  const fetchedAtUtc = new Date().toISOString();
  const bodies: Record<string, { command: string; rows: HorizonsRow[] }> = {};
  for (const [i, [id, command]] of HORIZONS_BODIES.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
    const rows = await fetchBody(command);
    bodies[id] = { command, rows };
    const above = rows.filter((row) => row[2] > 0).length;
    console.log(`${id} (${command}): ${rows.length} rows, ${above} with el > 0`);
  }
  const text = formatFixture({
    generator: "scripts/fetch-horizons-fixture.ts",
    fetchedAtUtc,
    query: HORIZONS_QUERY_SUMMARY,
    site: HORIZONS_SITE,
    bodies,
  });
  JSON.parse(text); // the hand-written layout must stay valid JSON
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text);
  console.log(`Wrote ${outPath}: ${Buffer.byteLength(text)} B, fetched at ${fetchedAtUtc}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv[2] ?? DEFAULT_OUT);
}
