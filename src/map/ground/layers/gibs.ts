// src/map/ground/layers/gibs.ts — the trimmed GIBS capabilities snapshot and its WMTS sources (M1 step 10).
// Every GIBS source in the app comes from gibsWmtsOptions. Time-enabled layers must use KVP: by default
// optionsFromCapabilities picks REST and spreads tiles over three templates, two of them without {Time} (Gotcha 1).
// Reference_Labels is the exception: it has no Time, and GIBS answers every KVP GetTile for it with one transparent tile.
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import TileLayer from "ol/layer/Tile";
import WMTS, { optionsFromCapabilities, type Options as WmtsOptions } from "ol/source/WMTS";

/** Change together with TRUE_COLOR_INSTRUMENT in src/app/credits.ts. */
export const TRUE_COLOR_LAYER = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
export const OVERLAY_LAYERS = ["Coastlines", "Reference_Labels"] as const;
export const LEVEL9 = "GoogleMapsCompatible_Level9";

export type GibsEncoding = "KVP" | "REST";
/**
 * Reference_Labels over KVP is GIBS's generic 155 B transparent tile for every tile (no layer-identifier headers);
 * its two REST templates serve the labels. Neither overlay has a Time dimension.
 */
export const OVERLAY_ENCODING: Readonly<Record<(typeof OVERLAY_LAYERS)[number], GibsEncoding>> = {
  Coastlines: "KVP",
  Reference_Labels: "REST",
};

interface CapsLink {
  TileMatrixSet: string;
  TileMatrixSetLimits?: unknown;
}
interface CapsLayer {
  Identifier: string;
  TileMatrixSetLink: CapsLink[];
}
export interface GibsCapabilities {
  Contents: { Layer: CapsLayer[] };
}

/** WMTSCapabilities#read is typed `any`: narrow it once, here. Main thread only (DOMParser). */
export function parseGibsCapabilities(xml: string): GibsCapabilities {
  const caps: unknown = new WMTSCapabilities().read(xml);
  const layers = (caps as { Contents?: { Layer?: unknown } } | null)?.Contents?.Layer;
  if (!Array.isArray(layers)) throw new Error("GIBS capabilities: no Contents/Layer");
  return caps as GibsCapabilities;
}

/** A copy of caps in which `layer` has no TileMatrixSetLimits. GIBS publishes wrong ones for GOES (M7). */
function withoutLimits(caps: GibsCapabilities, layer: string): GibsCapabilities {
  const Layer = caps.Contents.Layer.map((l) =>
    l.Identifier !== layer
      ? l
      : {
          ...l,
          TileMatrixSetLink: l.TileMatrixSetLink.map((k) => ({ TileMatrixSet: k.TileMatrixSet })),
        },
  );
  return { ...caps, Contents: { ...caps.Contents, Layer } };
}

/**
 * KVP (the default) for every layer with a Time dimension. REST only for a layer without one: it takes every tile
 * template of the layer, and throws if any of them carries {Time}.
 */
export function gibsWmtsOptions(
  caps: GibsCapabilities,
  layer: string,
  matrixSet: string,
  dropLimits = false,
  encoding: GibsEncoding = "KVP",
): WmtsOptions {
  const opts = optionsFromCapabilities(dropLimits ? withoutLimits(caps, layer) : caps, {
    layer,
    matrixSet,
    requestEncoding: encoding,
    crossOrigin: "anonymous",
  });
  if (opts === null) throw new Error(`GIBS: ${layer} not in capabilities`);
  // An unlinked matrix set silently falls back to the layer's first link (Gotcha 5).
  if (opts.matrixSet !== matrixSet) throw new Error(`GIBS: ${layer} has no ${matrixSet}`);
  if (encoding === "REST") {
    const urls = opts.urls ?? [];
    if (opts.requestEncoding !== "REST" || urls.length === 0)
      throw new Error(`GIBS: no REST tile template for ${layer}`);
    // REST spreads tiles over every template, and only some carry {Time} (Gotcha 1).
    if (urls.some((url) => url.includes("{Time}")) || "Time" in (opts.dimensions ?? {}))
      throw new Error(`GIBS: ${layer} has a Time dimension; use KVP`);
    return opts;
  }
  // Without KVP in OperationsMetadata, KVP silently becomes REST with 3 urls (Gotcha 4).
  if (opts.requestEncoding !== "KVP" || opts.urls?.length !== 1)
    throw new Error(`GIBS: no KVP GetTile for ${layer}`);
  return opts;
}

/** Time is set here: the capabilities Default is today's UTC date, whose tiles are black. */
export function createTrueColorLayer(caps: GibsCapabilities, dateUtc: string): TileLayer<WMTS> {
  const opts = gibsWmtsOptions(caps, TRUE_COLOR_LAYER, LEVEL9);
  return new TileLayer({ source: new WMTS({ ...opts, dimensions: { Time: dateUtc } }) });
}

/** One layer per OVERLAY_LAYERS id, in that order (Coastlines under Reference_Labels), each in OVERLAY_ENCODING. */
export function createOverlayLayers(caps: GibsCapabilities): TileLayer<WMTS>[] {
  return OVERLAY_LAYERS.map(
    (id) =>
      new TileLayer({
        source: new WMTS(gibsWmtsOptions(caps, id, LEVEL9, false, OVERLAY_ENCODING[id])),
      }),
  );
}

let loaded: GibsCapabilities | null = null;

/**
 * Fetches and parses the snapshot, and builds the options of the three M1 layers so a bad snapshot fails here,
 * at load. The result is kept for getGibsCapabilities().
 */
export async function loadGibsCapabilities(url: string): Promise<GibsCapabilities> {
  loaded = null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIBS capabilities: HTTP ${res.status} for ${url}`);
  const caps = parseGibsCapabilities(await res.text());
  gibsWmtsOptions(caps, TRUE_COLOR_LAYER, LEVEL9);
  for (const id of OVERLAY_LAYERS) gibsWmtsOptions(caps, id, LEVEL9, false, OVERLAY_ENCODING[id]);
  loaded = caps;
  return caps;
}

/** The parsed snapshot; null before loadGibsCapabilities resolves, or after it failed. */
export function getGibsCapabilities(): GibsCapabilities | null {
  return loaded;
}
