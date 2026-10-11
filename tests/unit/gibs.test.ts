// tests/unit/gibs.test.ts — gibsWmtsOptions and the overlay sources, on a hand-built parse of the committed snapshot.
// WMTSCapabilities needs DOMParser (main thread only), so the parsed shape is built here from the snapshot's own
// templates; e2e covers the real parse in the browser.
import { readFileSync } from "node:fs";
import { get as getProjection } from "ol/proj";
import type Projection from "ol/proj/Projection";
import type WMTS from "ol/source/WMTS";
import { describe, expect, it } from "vitest";
import {
  createOverlayLayers,
  type GibsCapabilities,
  gibsWmtsOptions,
  LEVEL9,
  OVERLAY_ENCODING,
  OVERLAY_LAYERS,
  TRUE_COLOR_LAYER,
} from "../../src/map/ground/layers/gibs";

const snapshot = readFileSync(
  new URL("../../public/data/gibs-capabilities.xml", import.meta.url),
  "utf8",
);
const BEST = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";

/** The snapshot's Layer element for id: Layer elements are not nested and their first Identifier is the id. */
function layerBlock(id: string): string {
  const block = [...snapshot.matchAll(/<Layer>[\s\S]*?<\/Layer>/g)]
    .map((m) => m[0])
    .find((b) => /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(b)?.[1] === id);
  if (block === undefined) throw new Error(`snapshot has no ${id}`);
  return block;
}

/** The snapshot's tile ResourceURL templates for id, in document order. */
function tileTemplates(id: string): string[] {
  return [
    ...layerBlock(id).matchAll(
      /<ResourceURL template='([^']+)' resourceType='tile' format='[^']+'\/>/g,
    ),
  ].map((m) => m[1] ?? "");
}

/** What WMTSCapabilities#read gives for one layer of the snapshot (the fields optionsFromCapabilities reads). */
function parsedLayer(id: string) {
  const block = layerBlock(id);
  const format = /<Format>([^<]+)<\/Format>/.exec(block)?.[1] ?? "";
  const timeDefault =
    /<Dimension><ows:Identifier>Time<\/ows:Identifier>[\s\S]*?<Default>([^<]+)<\/Default>/.exec(
      block,
    )?.[1];
  return {
    Identifier: id,
    Style: [{ Identifier: "default", Title: "default", isDefault: true }],
    Format: [format],
    TileMatrixSetLink: [{ TileMatrixSet: LEVEL9 }],
    ...(timeDefault === undefined
      ? {}
      : { Dimension: [{ Identifier: "Time", Default: timeDefault }] }),
    ResourceURL: tileTemplates(id).map((template) => ({ format, resourceType: "tile", template })),
  };
}

const getEncoding = (href: string, value: string) => ({
  href,
  Constraint: [{ name: "GetEncoding", AllowedValues: { Value: [value] } }],
});

/** The three M1 layers, both GetTile encodings, and Level9 as the snapshot defines it (scale 559082264.0287178 / 2^z). */
const caps: GibsCapabilities = {
  OperationsMetadata: {
    GetTile: {
      DCP: {
        HTTP: { Get: [getEncoding(BEST, "RESTful"), getEncoding(`${BEST}wmts.cgi?`, "KVP")] },
      },
    },
  },
  Contents: {
    Layer: [TRUE_COLOR_LAYER, ...OVERLAY_LAYERS].map(parsedLayer),
    TileMatrixSet: [
      {
        Identifier: LEVEL9,
        SupportedCRS: "urn:ogc:def:crs:EPSG:6.18:3:3857",
        TileMatrix: Array.from({ length: 10 }, (_, z) => ({
          Identifier: String(z),
          ScaleDenominator: 559082264.0287178 / 2 ** z,
          TopLeftCorner: [-20037508.34278925, 20037508.34278925],
          TileWidth: 256,
          TileHeight: 256,
          MatrixWidth: 2 ** z,
          MatrixHeight: 2 ** z,
        })),
      },
    ],
  },
} as GibsCapabilities;

function epsg3857(): Projection {
  const projection = getProjection("EPSG:3857");
  if (projection === null) throw new Error("EPSG:3857 is always defined");
  return projection;
}

describe("gibsWmtsOptions", () => {
  it("true colour is KVP with one url (REST templates would drop Time)", () => {
    const opts = gibsWmtsOptions(caps, TRUE_COLOR_LAYER, LEVEL9);
    expect(opts.requestEncoding).toBe("KVP");
    expect(opts.urls).toEqual([`${BEST}wmts.cgi?`]);
    expect(opts.crossOrigin).toBe("anonymous");
  });

  it("Reference_Labels is REST over both snapshot templates", () => {
    expect(OVERLAY_ENCODING.Reference_Labels).toBe("REST");
    const templates = tileTemplates("Reference_Labels");
    expect(templates).toEqual([
      `${BEST}Reference_Labels/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
      `${BEST}Reference_Labels/default/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
    ]);
    const opts = gibsWmtsOptions(caps, "Reference_Labels", LEVEL9, false, "REST");
    expect(opts.requestEncoding).toBe("REST");
    expect(opts.urls).toEqual(templates);
    expect(opts.format).toBe("image/png");
    expect(opts.crossOrigin).toBe("anonymous");
  });

  it("refuses REST for a layer with a Time dimension, and REST without templates", () => {
    expect(() => gibsWmtsOptions(caps, TRUE_COLOR_LAYER, LEVEL9, false, "REST")).toThrow(
      /Time.*KVP/,
    );
    const noTemplates = {
      ...caps,
      Contents: {
        ...caps.Contents,
        Layer: caps.Contents.Layer.map((l) =>
          l.Identifier === "Reference_Labels" ? { ...l, ResourceURL: [] } : l,
        ),
      },
    } as GibsCapabilities;
    expect(() => gibsWmtsOptions(noTemplates, "Reference_Labels", LEVEL9, false, "REST")).toThrow(
      /no REST tile template/,
    );
  });
});

describe("createOverlayLayers", () => {
  it("Coastlines over KVP, Reference_Labels over REST, in OVERLAY_LAYERS order", () => {
    const sources = createOverlayLayers(caps).map((layer) => layer.getSource() as WMTS);
    expect(sources.map((s) => s.getLayer())).toEqual(["Coastlines", "Reference_Labels"]);
    expect(sources.map((s) => s.getRequestEncoding())).toEqual(["KVP", "REST"]);
    const [coastlines, labels] = sources;
    const url = (source: WMTS | undefined) =>
      source?.getTileUrlFunction()([6, 4, 28], 1, epsg3857()) ?? "";
    expect(url(coastlines)).toContain("wmts.cgi?layer=Coastlines&");
    // GIBS answers every KVP GetTile for Reference_Labels with one transparent tile; REST serves the labels.
    expect([
      `${BEST}Reference_Labels/default/GoogleMapsCompatible_Level9/6/28/4.png`,
      `${BEST}Reference_Labels/default/default/GoogleMapsCompatible_Level9/6/28/4.png`,
    ]).toContain(url(labels));
  });
});
