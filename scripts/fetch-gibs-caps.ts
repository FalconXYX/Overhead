// scripts/fetch-gibs-caps.ts — fetch, trim, check and write the GIBS capabilities snapshot (M1 step 1).
// Run by hand: npx tsx scripts/fetch-gibs-caps.ts [outPath]   (default public/data/gibs-capabilities.xml)
// CI never runs it. The app never reads Time values from the snapshot: they are stale by design.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const GIBS_CAPS_LAYERS: readonly string[] = [
  "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
  "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
  "GOES-West_ABI_Band13_Clean_Infrared",
  "Coastlines",
  "Reference_Labels",
];

export const GIBS_CAPS_MATRIX_SETS: readonly string[] = [
  "GoogleMapsCompatible_Level6",
  "GoogleMapsCompatible_Level9",
];

const GOES_LAYER = "GOES-West_ABI_Band13_Clean_Infrared";
const BASE_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities";
/** The LAYER filter works only in this KVP form. */
const FILTERED_URL = `${BASE_URL}&LAYER=${GIBS_CAPS_LAYERS.join(",")}`;
const DEFAULT_OUT = "public/data/gibs-capabilities.xml";

const LAYER_BLOCK = /<Layer>[\s\S]*?<\/Layer>/g;
const FIRST_IDENTIFIER = /<ows:Identifier>([^<]+)<\/ows:Identifier>/;
const TOP_LEVEL_MATRIX_SET =
  /<TileMatrixSet>\s*<ows:Identifier>([^<]+)<\/ows:Identifier>[\s\S]*?<\/TileMatrixSet>/g;

/** Drops every Layer and every top-level TileMatrixSet whose identifier is not kept. */
export function trimGibsCapabilities(
  xml: string,
  keepLayers: readonly string[] = GIBS_CAPS_LAYERS,
  keepMatrixSets: readonly string[] = GIBS_CAPS_MATRIX_SETS,
): string {
  return xml
    .replace(LAYER_BLOCK, (block) => {
      const id = FIRST_IDENTIFIER.exec(block)?.[1] ?? "";
      return keepLayers.includes(id) ? block : "";
    })
    .replace(TOP_LEVEL_MATRIX_SET, (block, id: string) =>
      keepMatrixSets.includes(id) ? block : "",
    );
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * One message per failed check, [] when the snapshot is usable. GIBS writes attributes in single quotes
 * (<ows:Operation name='GetTile'>, template='…'), so every attribute match accepts either quote.
 */
export function snapshotProblems(xml: string): string[] {
  const problems: string[] = [];

  const layerBlocks = xml.match(LAYER_BLOCK) ?? [];
  const layerIds = layerBlocks.map((block) => FIRST_IDENTIFIER.exec(block)?.[1] ?? "");
  if (!sameSet(layerIds, GIBS_CAPS_LAYERS)) {
    problems.push(
      `layers: expected ${[...GIBS_CAPS_LAYERS].sort().join(", ")}; found ${[...layerIds].sort().join(", ") || "none"}`,
    );
  }

  const setIds = [...xml.matchAll(TOP_LEVEL_MATRIX_SET)].map((m) => m[1] ?? "");
  if (!sameSet(setIds, GIBS_CAPS_MATRIX_SETS)) {
    problems.push(
      `matrix sets: expected ${GIBS_CAPS_MATRIX_SETS.join(", ")}; found ${[...setIds].sort().join(", ") || "none"}`,
    );
  }

  // Without KVP in OperationsMetadata, optionsFromCapabilities silently falls back to REST (Gotcha 4).
  const getTile = /<ows:Operation name=['"]GetTile['"]>[\s\S]*?<\/ows:Operation>/.exec(xml)?.[0];
  if (getTile === undefined || !getTile.includes("<ows:Value>KVP</ows:Value>")) {
    problems.push("GetTile operation does not list <ows:Value>KVP</ows:Value>");
  }

  const timeTemplates = [...xml.matchAll(/template=(['"])([^'"]*)\1/g)].filter((m) =>
    (m[2] ?? "").includes("{Time}"),
  ).length;
  if (timeTemplates !== 3) {
    problems.push(
      `expected 3 {Time} ResourceURL templates (NOAA-20, NOAA-21, GOES); found ${timeTemplates}`,
    );
  }

  const goes = layerBlocks.find((block) => FIRST_IDENTIFIER.exec(block)?.[1] === GOES_LAYER);
  if (goes === undefined || !goes.includes("<TileMatrixSetLimits>")) {
    problems.push(`${GOES_LAYER} has no <TileMatrixSetLimits> (M7's workaround needs them)`);
  }

  return problems;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}

/** The comment goes after an XML declaration, if the document has one. */
function withProvenance(xml: string, sourceUrl: string): string {
  const comment = `<!-- Trimmed GIBS capabilities written by scripts/fetch-gibs-caps.ts at ${new Date().toISOString()} from ${sourceUrl} -->`;
  const declaration = /^<\?xml[^>]*\?>\s*/.exec(xml)?.[0];
  return declaration === undefined
    ? `${comment}\n${xml}`
    : `${declaration.trimEnd()}\n${comment}\n${xml.slice(declaration.length)}`;
}

async function main(outPath: string): Promise<void> {
  let sourceUrl = FILTERED_URL;
  let xml = trimGibsCapabilities(await fetchText(sourceUrl));
  let problems = snapshotProblems(xml);
  if (problems.length > 0) {
    console.warn(
      `The LAYER-filtered capabilities failed the checks (${problems.join("; ")}); trimming the full document instead.`,
    );
    sourceUrl = BASE_URL;
    xml = trimGibsCapabilities(await fetchText(sourceUrl));
    problems = snapshotProblems(xml);
  }
  if (problems.length > 0) {
    throw new Error(
      `GIBS capabilities snapshot rejected, nothing written:\n${problems.join("\n")}`,
    );
  }
  const out = withProvenance(xml, sourceUrl);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, out);
  console.log(`Wrote ${outPath}: ${Buffer.byteLength(out)} B from ${sourceUrl}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv[2] ?? DEFAULT_OUT);
}
