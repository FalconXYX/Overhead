// tests/unit/readme.test.ts — [M9] the root README's Credits section against the code and the camera registry (M9
// step 13; README section 7, Credits rule 3). Exact substrings: a credit edited in one place fails here until the
// README says the same.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enabledCameras } from "../../src/app/cameras";
import * as credits from "../../src/app/credits";
import type { Credit } from "../../src/state/types";
import { committedCameras } from "../helpers/store";

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

function isCredit(value: unknown): value is Credit {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text?: unknown }).text === "string" &&
    "href" in value &&
    "licence" in value
  );
}

/** Every Credit object credits.ts exports, by export name. */
const exportedCredits: [string, Credit][] = Object.entries(credits).flatMap(([name, value]) =>
  isCredit(value) ? [[name, value] as [string, Credit]] : [],
);

describe("README credits", () => {
  it("finds the credits.ts exports to check", () => {
    expect(exportedCredits.map(([name]) => name).sort()).toEqual(
      [
        "BSC5_CREDIT",
        "CELESTRAK_CREDIT",
        "GIBS_CREDIT",
        "IAU_WGSN_CREDIT",
        "NANAAO_CREDIT",
        "OSM_NE_CREDIT",
        "TERRAIN_CREDIT",
      ].sort(),
    );
  });

  it("contains every Credit.text exported by credits.ts, with its link and licence", () => {
    for (const [name, credit] of exportedCredits) {
      expect(README, `${name} text`).toContain(credit.text);
      if (credit.href !== null) expect(README, `${name} href`).toContain(credit.href);
      if (credit.licence !== null) expect(README, `${name} licence`).toContain(credit.licence);
      if (credit.licenceHref !== null) {
        expect(README, `${name} licence link`).toContain(credit.licenceHref);
      }
    }
  });

  it("contains every TERRAIN_SOURCE_STATEMENTS line", () => {
    expect(credits.TERRAIN_SOURCE_STATEMENTS).toHaveLength(11);
    for (const line of credits.TERRAIN_SOURCE_STATEMENTS) expect(README).toContain(line);
  });

  it("names both GIBS instruments as the Credits region shows them", () => {
    expect(README).toContain(`Imagery: ${credits.TRUE_COLOR_INSTRUMENT}`);
    expect(README).toContain(`Imagery: ${credits.GOES_SUBTITLE}, Band 13 Clean Infrared`);
  });

  it("contains every enabled cameras.json credit and termsNote", () => {
    const cameras = Object.values(enabledCameras(committedCameras()));
    expect(cameras.length).toBeGreaterThanOrEqual(3); // [Redesign] the recorded ISS pass and the two live StarCams
    for (const camera of cameras) {
      expect(README, `${camera.id} credit`).toContain(camera.credit.text);
      if (camera.termsNote !== "") {
        expect(README, `${camera.id} termsNote`).toContain(camera.termsNote);
      }
      expect(README, `${camera.id} id`).toContain(`\`${camera.id}\``);
    }
    expect(README).toContain(credits.NANAAO_TERMS_NOTE);
  });
});

describe("README", () => {
  it("links production and the tour, and shows the overview screenshot", () => {
    expect(README).toContain("https://parthjain.ca/Overhead/");
    expect(README).toContain("https://parthjain.ca/Overhead/?demo=1");
    expect(README).toContain("(docs/overview.png)");
  });

  it("has the architecture diagram", () => {
    const diagram = /```mermaid\n([\s\S]*?)```/.exec(README)?.[1] ?? "";
    expect(diagram.startsWith("flowchart LR")).toBe(true);
    // 16 nodes and 19 edges (M9 step 13).
    expect(diagram.match(/^ {4}\w+\["/gm) ?? []).toHaveLength(16);
    expect(diagram.match(/^ {2}\w+ -/gm) ?? []).toHaveLength(19);
  });
});
