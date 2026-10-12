// tests/unit/gpData.test.ts — the CelesTrak data the app serves from public/data/gp/ (seeded from the
// verification snapshot in M3 step 1, refreshed by fetch-gp.yml): every group file parses as OMM, and
// meta.json holds its sha256 and record count. Never compared with tests/fixtures/gp: the workflow moves it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GpGroup, GpMeta } from "../../src/domain/orbits";
import { GP_GROUPS, parseGpFile } from "../../src/domain/orbits";

const GP_DIR = new URL("../../public/data/gp/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("meta.json", GP_DIR), "utf8")) as Partial<GpMeta>;

function metaEntry(group: GpGroup): GpMeta[GpGroup] {
  const entry = meta[group];
  if (entry === undefined) throw new Error(`public/data/gp/meta.json has no ${group} entry`);
  return entry;
}

describe("public/data/gp", () => {
  it("holds meta.json and one file per GP group, nothing else", () => {
    const expected = ["meta.json", ...GP_GROUPS.map((group) => `${group}.json`)].sort();
    expect(readdirSync(GP_DIR).sort()).toEqual(expected);
    expect(Object.keys(meta).sort()).toEqual([...GP_GROUPS].sort());
  });

  describe.each(GP_GROUPS)("%s.json", (group) => {
    const bytes = readFileSync(new URL(`${group}.json`, GP_DIR));

    it("parses with parseGpFile into a non-empty array of meta.json's count", () => {
      const omms = parseGpFile(JSON.parse(bytes.toString("utf8")));
      expect(omms.length).toBeGreaterThan(0);
      expect(omms).toHaveLength(metaEntry(group).count);
    });

    it("has the sha256 recorded in meta.json", () => {
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(metaEntry(group).sha256);
    });

    it("has a whole-millisecond fetch stamp", () => {
      expect(Number.isSafeInteger(metaEntry(group).fetchedAtMs)).toBe(true);
    });
  });
});
