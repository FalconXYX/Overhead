import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GIBS_CAPS_LAYERS,
  GIBS_CAPS_MATRIX_SETS,
  snapshotProblems,
  trimGibsCapabilities,
} from "../../scripts/fetch-gibs-caps";

const SNAPSHOT_URL = new URL("../../public/data/gibs-capabilities.xml", import.meta.url);
const snapshot = readFileSync(SNAPSHOT_URL, "utf8");

describe("committed GIBS capabilities snapshot", () => {
  it("passes every check and stays small", () => {
    expect(snapshotProblems(snapshot)).toEqual([]);
    expect(statSync(SNAPSHOT_URL).size).toBeLessThan(40_000);
  });

  it("was written by the script", () => {
    expect(snapshot).toMatch(
      /^<!-- Trimmed GIBS capabilities written by scripts\/fetch-gibs-caps\.ts at \d{4}-\d{2}-\d{2}T[\d:.]+Z from https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/wmts\.cgi\?\S+ -->/,
    );
  });

  it("names the five layers and two matrix sets", () => {
    expect([...GIBS_CAPS_LAYERS].sort()).toEqual([
      "Coastlines",
      "GOES-West_ABI_Band13_Clean_Infrared",
      "Reference_Labels",
      "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
      "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
    ]);
    expect(GIBS_CAPS_MATRIX_SETS).toEqual([
      "GoogleMapsCompatible_Level6",
      "GoogleMapsCompatible_Level9",
    ]);
  });

  it("removing the GetTile operation yields exactly the KVP message", () => {
    const withoutGetTile = snapshot.replace(
      /<ows:Operation name=['"]GetTile['"]>[\s\S]*?<\/ows:Operation>/,
      "",
    );
    expect(withoutGetTile).not.toBe(snapshot);
    const problems = snapshotProblems(withoutGetTile);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/GetTile.*KVP/);
  });

  it("reports a missing layer, an extra matrix set, a lost {Time} template and lost GOES limits", () => {
    const noCoastlines = snapshot.replace(
      /<Layer>(?:(?!<\/Layer>)[\s\S])*?Coastlines[\s\S]*?<\/Layer>/,
      "",
    );
    expect(snapshotProblems(noCoastlines).join("\n")).toMatch(/layers/);
    const goesNoLimits = snapshot.replace(
      /<TileMatrixSetLimits>[\s\S]*?<\/TileMatrixSetLimits>/g,
      "",
    );
    expect(snapshotProblems(goesNoLimits)).toEqual([expect.stringMatching(/TileMatrixSetLimits/)]);
    const extraSet = snapshot.replace(
      "</Contents>",
      "<TileMatrixSet><ows:Identifier>GoogleMapsCompatible_Level3</ows:Identifier></TileMatrixSet></Contents>",
    );
    expect(snapshotProblems(extraSet)).toEqual([expect.stringMatching(/matrix sets/)]);
    const noTime = snapshot.replace(/\{Time\}\//, "");
    expect(snapshotProblems(noTime)).toEqual([expect.stringMatching(/\{Time\}/)]);
  });
});

describe("trimGibsCapabilities", () => {
  // Attributes in single quotes, as GIBS writes them.
  const doc = [
    "<Capabilities><Contents>",
    "<Layer><ows:Title xml:lang='en'>A</ows:Title><ows:Identifier>KeepMe</ows:Identifier>",
    "<TileMatrixSetLink><TileMatrixSet>SetKeep</TileMatrixSet></TileMatrixSetLink></Layer>",
    "<Layer><ows:Identifier>DropMe</ows:Identifier>",
    "<TileMatrixSetLink><TileMatrixSet>SetDrop</TileMatrixSet></TileMatrixSetLink></Layer>",
    "<TileMatrixSet><ows:Identifier>SetKeep</ows:Identifier><TileMatrix/></TileMatrixSet>",
    "<TileMatrixSet>\n  <ows:Identifier>SetDrop</ows:Identifier><TileMatrix/></TileMatrixSet>",
    "</Contents></Capabilities>",
  ].join("");

  it("keeps and drops layers and top-level matrix sets by id", () => {
    const out = trimGibsCapabilities(doc, ["KeepMe"], ["SetKeep"]);
    expect(out).toContain("<ows:Identifier>KeepMe</ows:Identifier>");
    expect(out).not.toContain("DropMe");
    expect(out).toContain("<TileMatrixSet><ows:Identifier>SetKeep</ows:Identifier>");
    expect(out).not.toContain("<ows:Identifier>SetDrop</ows:Identifier>");
    // A link's <TileMatrixSet>Name</TileMatrixSet> is not a top-level set and is never touched.
    expect(out).toContain("<TileMatrixSet>SetKeep</TileMatrixSet>");
    expect(out.startsWith("<Capabilities><Contents>")).toBe(true);
    expect(out.endsWith("</Contents></Capabilities>")).toBe(true);
  });

  it("keeps everything when every id is kept", () => {
    expect(trimGibsCapabilities(doc, ["KeepMe", "DropMe"], ["SetKeep", "SetDrop"])).toBe(doc);
  });
});
