// tests/unit/starsJson.test.ts — the committed star catalogue (public/data/stars.json) and the parsing in
// scripts/build-stars.ts (M2 step 2). No network: the parser tests use real BSC5 and IAU-CSN lines inline.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BSC_LINE_LENGTH,
  bscDesignation,
  buildStarRows,
  formatStarsJson,
  parseBscRecord,
  parseCsnNames,
  summaryLine,
} from "../../scripts/build-stars";
import type { StarRow } from "../../src/domain/astro";
import { starCountForLimit } from "../../src/state/skyCache";

const STARS_URL = new URL("../../public/data/stars.json", import.meta.url);
const text = readFileSync(STARS_URL, "utf8");
const rows = JSON.parse(text) as StarRow[];
const byHr = new Map(rows.map((row) => [row[3], row]));

describe("committed stars.json", () => {
  it("has 8,404 rows of [ra, dec, vmag, hr, name] with finite numbers", () => {
    expect(rows).toHaveLength(8404);
    for (const row of rows) {
      expect(row).toHaveLength(5);
      const [ra, dec, vmag, hr, name] = row;
      expect(Number.isFinite(ra) && ra >= 0 && ra < 360).toBe(true);
      expect(Number.isFinite(dec) && dec >= -90 && dec <= 90).toBe(true);
      expect(Number.isFinite(vmag) && vmag <= 6.5).toBe(true);
      expect(Number.isInteger(hr) && hr >= 1 && hr <= 9110).toBe(true);
      expect(typeof name).toBe("string");
    }
    expect(byHr.size).toBe(8404); // HR numbers are unique
  });

  it("is sorted by vmag, then HR, so a magnitude limit is a prefix", () => {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev === undefined || cur === undefined) throw new Error(`row ${i} missing`);
      expect(cur[2] > prev[2] || (cur[2] === prev[2] && cur[3] > prev[3])).toBe(true);
    }
    expect(rows[0]?.[4]).toBe("Sirius");
    expect(rows.filter((row) => row[2] === 6.5)).toHaveLength(49);
  });

  it("names stars from IAU-CSN, then Bayer, then Flamsteed", () => {
    expect(byHr.get(424)).toEqual([37.95292, 89.26417, 2.02, 424, "Polaris"]);
    expect(byHr.get(2491)?.[4]).toBe("Sirius");
    expect(byHr.get(7001)?.[4]).toBe("Vega");
    expect(byHr.get(7228)?.[4]).toBe("Polaris Australis");
    expect(byHr.get(7424)?.[4]).toBe("ι Tel");
    expect(byHr.get(2487)?.[4]).toBe("ψ6 Aur");
    expect(byHr.get(8085)?.[4]).toBe("61 Cyg");
  });

  it("has one row per line, exactly as the script writes it", () => {
    expect(text).toBe(formatStarsJson(rows));
  });

  it("starCountForLimit gives the prefix length for a limit", () => {
    expect(starCountForLimit(rows, 4)).toBe(518);
    expect(starCountForLimit(rows, 4.5)).toBe(904);
    expect(starCountForLimit(rows, 6.5)).toBe(8404);
  });
});

// Real CDS V/50 lines, with trailing blanks trimmed as CDS serves them.
const POLARIS_BSC =
  " 424  1Alp UMiBD+88    8   8890   308 907    1477  Alp UMi  012233.7+884626023148.7+891551123.28 26.46 2.02  +0.60 +0.38 +0.31   F7:Ib-II          v+0.038-0.015 +.007-017SBO    17  6.8  18.4AB   5*";
const SIRIUS_BSC =
  "2491  9Alp CMaBD-16 1591  48915151881 257I   5423           064044.6-163444064508.9-164258227.22-08.88-1.46   0.00 -0.05 -0.03   A1Vm               -0.553-1.205 +.375-008SBO    13 10.3  11.2AB   4*";
const IOT_TEL_BSC =
  "7424   Iot TelCD-4813161 184127229751 735                   192747.9-481853193513.0-480557350.25-26.89 4.90  +1.09               K0III              -0.009-0.038 +.002+022";
const CYG61_BSC =
  "8085 61    CygBD+38 4343 201091 70919 793   14636A V1803 Cyg210224.8+381531210654.6+384445 82.25-05.81 5.21  +1.18 +1.11 +0.65   K5V                +4.136+3.203 +.292-064V    < 17  0.8  28.7AB   6*";
const NOVA_BSC =
  "  92 NOVA 1572                                     B Cas                                                                                                                                            *";

const POLARIS_CSN =
  "Polaris           Polaris           HR 424       alf   α     UMi Aa   02318+8916  2.13  V  11767   8890  37.954561  89.264109 2016-06-30 ";
const POLARIS_AUS_CSN =
  "Polaris Australis Polaris Australis HR 7228      sig   σ     Oct _    _           5.45  V 104382 177482 317.195164 -88.956499 2017-09-05 ";
const NON_HR_CSN =
  "Absolutno         Absolutno         XO-5         _     _     Lyn _    _          11.95  G      _      _ 116.716506  39.094572 2019-12-17 ";

/** Replaces the HR [0, 4) and Vmag [102, 107) fields of a catalogue line. */
function withHrVmag(line: string, hr: number, vmag: string): string {
  const padded = line.padEnd(BSC_LINE_LENGTH, " ");
  return `${String(hr).padStart(4, " ")}${padded.slice(4, 102)}${vmag.padStart(5, " ")}${padded.slice(107)}`;
}

describe("bscDesignation", () => {
  it("formats Bayer as Greek letter, index digit, space, constellation", () => {
    expect(bscDesignation("  1Alp UMi")).toBe("α UMi");
    expect(bscDesignation("   Iot Tel")).toBe("ι Tel");
    expect(bscDesignation(" 57Psi6Aur")).toBe("ψ6 Aur");
    expect(bscDesignation("   Mu  Phe")).toBe("μ Phe");
    expect(bscDesignation(" 37Mu  And")).toBe("μ And");
    expect(bscDesignation("   Ome1Sco")).toBe("ω1 Sco");
  });

  it("falls back to Flamsteed, then to an empty string", () => {
    expect(bscDesignation(" 61    Cyg")).toBe("61 Cyg");
    expect(bscDesignation("          ")).toBe("");
  });

  it("throws on an unknown Bayer abbreviation", () => {
    expect(() => bscDesignation("   Xyz Tel")).toThrow(/Xyz/);
  });
});

describe("parseBscRecord", () => {
  it("parses J2000 position, Vmag and designation, rounded to 5 decimals", () => {
    expect(parseBscRecord(POLARIS_BSC)).toEqual({
      hr: 424,
      raDeg: 37.95292,
      decDeg: 89.26417,
      vmag: 2.02,
      designation: "α UMi",
    });
    expect(parseBscRecord(SIRIUS_BSC)).toEqual({
      hr: 2491,
      raDeg: 101.28708,
      decDeg: -16.71611,
      vmag: -1.46,
      designation: "α CMa",
    });
  });

  it("returns null for a record without a position", () => {
    expect(parseBscRecord(NOVA_BSC)).toBeNull();
  });

  it("throws on a positioned record with a blank Vmag", () => {
    expect(() => parseBscRecord(withHrVmag(POLARIS_BSC, 424, ""))).toThrow(/HR 424/);
  });
});

describe("parseCsnNames", () => {
  it("joins ASCII names by HR, skipping comments, $ lines and non-HR designations", () => {
    const csn = [
      "# comment HR 1",
      "$ https://example HR 2",
      POLARIS_CSN,
      POLARIS_AUS_CSN,
      NON_HR_CSN,
      "",
    ].join("\n");
    expect([...parseCsnNames(csn)]).toEqual([
      [424, "Polaris"],
      [7228, "Polaris Australis"],
    ]);
  });

  it("throws on a duplicate HR", () => {
    expect(() => parseCsnNames(`${POLARIS_CSN}\n${POLARIS_CSN}\n`)).toThrow(/HR 424/);
  });
});

describe("buildStarRows", () => {
  const catalog = `${[
    NOVA_BSC,
    POLARIS_BSC,
    SIRIUS_BSC,
    IOT_TEL_BSC,
    CYG61_BSC,
    withHrVmag(IOT_TEL_BSC, 9001, "6.50"),
    withHrVmag(IOT_TEL_BSC, 9000, "6.50"),
    withHrVmag(IOT_TEL_BSC, 9002, "6.51"),
    "",
  ].join("\n")}\n`;
  const result = buildStarRows(catalog, `${POLARIS_CSN}\n`);

  it("keeps V <= 6.5 inclusive, sorted by vmag then HR, with names in priority order", () => {
    expect(result.rows).toEqual([
      [101.28708, -16.71611, -1.46, 2491, "α CMa"],
      [37.95292, 89.26417, 2.02, 424, "Polaris"],
      [293.80417, -48.09917, 4.9, 7424, "ι Tel"],
      [316.7275, 38.74583, 5.21, 8085, "61 Cyg"],
      [293.80417, -48.09917, 6.5, 9000, "ι Tel"],
      [293.80417, -48.09917, 6.5, 9001, "ι Tel"],
    ]);
  });

  it("counts records, skips, rows and names", () => {
    expect(result.summary).toEqual({
      records: 8,
      withoutPosition: 1,
      rows: 6,
      properNames: 1,
      bayer: 4,
      flamsteed: 1,
      unnamed: 0,
    });
  });

  it("prints the summary line with both input checksums", () => {
    expect(
      summaryLine(
        {
          records: 9110,
          withoutPosition: 14,
          rows: 8404,
          properNames: 333,
          bayer: 1245,
          flamsteed: 1507,
          unnamed: 5319,
        },
        "aa",
        "bb",
      ),
    ).toBe(
      "9110 records, 14 without position, 8404 rows at V <= 6.5, 333 proper names, 5319 without any name (1245 Bayer, 1507 Flamsteed); catalog.gz sha256 aa, IAU-CSN.txt sha256 bb",
    );
  });
});

describe("formatStarsJson", () => {
  it("writes one row per line", () => {
    expect(
      formatStarsJson([
        [1, 2, 3, 4, "a"],
        [5, -6, 7.5, 8, ""],
      ]),
    ).toBe('[\n[1,2,3,4,"a"],\n[5,-6,7.5,8,""]\n]\n');
  });
});
