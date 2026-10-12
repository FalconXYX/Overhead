// tests/unit/goes.test.ts — the GOES-West URL builders and layer (M7 step 4). WMTSCapabilities needs DOMParser, so the
// GOES layer's parsed shape is built here from the committed snapshot, as in gibs.test.ts; e2e covers the real parse.
import { readFileSync } from "node:fs";
import { get as getProjection } from "ol/proj";
import type Projection from "ol/proj/Projection";
import { describe, expect, it } from "vitest";
import { isoUtcSeconds } from "../../src/domain/time";
import type { GibsCapabilities } from "../../src/map/ground/layers/gibs";
import {
  createGoesLayer,
  domainTextFromXml,
  GOES_LAYER,
  GOES_OPACITY,
  goesDomainUrl,
  goesProbeUrl,
  LEVEL6,
} from "../../src/map/ground/layers/goes";

const at = (iso: string): number => Date.parse(iso);
const BEST = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
const snapshot = readFileSync(
  new URL("../../public/data/gibs-capabilities.xml", import.meta.url),
  "utf8",
);
const goesBlock =
  [...snapshot.matchAll(/<Layer>[\s\S]*?<\/Layer>/g)]
    .map((m) => m[0])
    .find((b) => b.includes(`<ows:Identifier>${GOES_LAYER}</ows:Identifier>`)) ?? "";

/** The snapshot's GOES TileMatrixSetLimits as WMTSCapabilities#read gives them: z0–z5, two ranges at most levels. */
const limits = [...goesBlock.matchAll(/<TileMatrixLimits>([\s\S]*?)<\/TileMatrixLimits>/g)].map(
  (m) => {
    const field = (name: string): string =>
      new RegExp(`<${name}>([^<]+)</${name}>`).exec(m[1] ?? "")?.[1] ?? "";
    return {
      TileMatrix: field("TileMatrix"),
      MinTileRow: Number(field("MinTileRow")),
      MaxTileRow: Number(field("MaxTileRow")),
      MinTileCol: Number(field("MinTileCol")),
      MaxTileCol: Number(field("MaxTileCol")),
    };
  },
);
const SNAPSHOT_DEFAULT =
  /<Dimension><ows:Identifier>Time<\/ows:Identifier>[\s\S]*?<Default>([^<]+)<\/Default>/.exec(
    goesBlock,
  )?.[1] ?? "";

const getEncoding = (href: string, value: string) => ({
  href,
  Constraint: [{ name: "GetEncoding", AllowedValues: { Value: [value] } }],
});

/** What WMTSCapabilities#read gives for the snapshot's GOES layer (the fields optionsFromCapabilities reads). */
const goesLayer = {
  Identifier: GOES_LAYER,
  Style: [{ Identifier: "default", Title: "default", isDefault: true }],
  Format: ["image/png"],
  TileMatrixSetLink: [{ TileMatrixSet: LEVEL6, TileMatrixSetLimits: limits }],
  Dimension: [{ Identifier: "Time", Default: SNAPSHOT_DEFAULT }],
  ResourceURL: [
    `${BEST}${GOES_LAYER}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
    `${BEST}${GOES_LAYER}/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
    `${BEST}${GOES_LAYER}/default/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
  ].map((template) => ({ format: "image/png", resourceType: "tile", template })),
};

/** The GOES layer with its snapshot limits, both GetTile encodings, and Level6 as the snapshot defines it. */
const caps = {
  OperationsMetadata: {
    GetTile: {
      DCP: {
        HTTP: { Get: [getEncoding(BEST, "RESTful"), getEncoding(`${BEST}wmts.cgi?`, "KVP")] },
      },
    },
  },
  Contents: {
    Layer: [goesLayer],
    TileMatrixSet: [
      {
        Identifier: LEVEL6,
        SupportedCRS: "urn:ogc:def:crs:EPSG:6.18:3:3857",
        TileMatrix: Array.from({ length: 7 }, (_, z) => ({
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

describe("GOES URL builders", () => {
  it("goesDomainUrl covers 90 days back to a 10-minute step and ends at now floored to the minute", () => {
    expect(goesDomainUrl(at("2026-10-11T09:52:31Z"))).toBe(
      `${BEST}1.0.0/GOES-West_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/2026-07-13T09:50:00Z--2026-10-11T09:52:00Z.xml`,
    );
    // A new URL every minute: each 5-minute poll misses GIBS's 30-minute origin cache (Gotcha 5).
    expect(goesDomainUrl(at("2026-10-11T09:57:31Z"))).not.toBe(
      goesDomainUrl(at("2026-10-11T09:52:31Z")),
    );
  });

  it("goesProbeUrl is tile 0/0/0 at the step, with seconds and %3A", () => {
    const url = goesProbeUrl(at("2026-10-11T09:30:00Z"));
    expect(url.startsWith(`${BEST}wmts.cgi?layer=${GOES_LAYER}&`)).toBe(true);
    expect(url.endsWith("&TileMatrix=0&TileCol=0&TileRow=0&Time=2026-10-11T09%3A30%3A00Z")).toBe(
      true,
    );
    expect(new URL(url).searchParams.get("Time")).toBe("2026-10-11T09:30:00Z");
    expect(new URL(url).searchParams.get("Request")).toBe("GetTile");
  });

  it("domainTextFromXml: the fixture's Domain, '' when empty, null without one", () => {
    const fixture = readFileSync(
      new URL("../fixtures/gibs/goes-domain.xml", import.meta.url),
      "utf8",
    );
    expect(domainTextFromXml(fixture)).toBe(
      "2026-10-07T12:00:00Z/2026-10-07T19:20:00Z/PT10M,2026-10-07T19:40:00Z/2026-10-07T21:00:00Z/PT10M,2026-10-07T21:20:00Z/2026-10-11/PT10M",
    );
    expect(
      domainTextFromXml(
        "<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain></Domain><Size>0</Size></DimensionDomain></Domains>",
      ),
    ).toBe("");
    expect(domainTextFromXml("<html><body>Bad Request</body></html>")).toBeNull();
  });
});

describe("createGoesLayer", () => {
  it("the snapshot's limits stop at z5 (the reason for dropLimits)", () => {
    expect(limits.length).toBeGreaterThan(6);
    expect(new Set(limits.map((l) => l.TileMatrix))).toEqual(
      new Set(["0", "1", "2", "3", "4", "5"]),
    );
  });

  it("a hidden KVP layer at 60 % opacity, on the capabilities Default until bindGoesTime sets a step", () => {
    const { layer, source } = createGoesLayer(caps);
    expect(layer.getSource()).toBe(source);
    expect(layer.getVisible()).toBe(false);
    expect(layer.getOpacity()).toBe(GOES_OPACITY);
    expect(GOES_OPACITY).toBe(0.6);
    expect(source.getRequestEncoding()).toBe("KVP");
    expect(source.getUrls()).toEqual([`${BEST}wmts.cgi?`]);
    expect(source.getFormat()).toBe("image/png");
    expect(source.getMatrixSet()).toBe(LEVEL6);
    expect(source.getDimensions()).toEqual({ Time: SNAPSHOT_DEFAULT });
  });

  it("limits dropped: z6 exists, including 6/28/4 over Maunakea", () => {
    const { source } = createGoesLayer(caps);
    const grid = source.getTileGrid();
    expect(grid?.getMaxZoom()).toBe(6);
    const url = source.getTileUrlFunction()([6, 4, 28], 1, epsg3857()) ?? "";
    expect(url).toContain("&TileMatrix=6&TileCol=4&TileRow=28&");
  });

  it("goesProbeUrl equals the source's tile 0/0/0 URL at the same Time", () => {
    const { source } = createGoesLayer(caps);
    const stepMs = at("2026-10-11T09:30:00Z");
    source.updateDimensions({ Time: isoUtcSeconds(stepMs) });
    expect(source.getTileUrlFunction()([0, 0, 0], 1, epsg3857())).toBe(goesProbeUrl(stepMs));
  });
});
