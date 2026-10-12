// tests/unit/findPasses.test.ts — M5 section 5: scripts/find-passes.ts's arguments, and the one span it finds on the
// committed ISS elements (tests/fixtures/gp, epoch 2026-10-09T22:48:38.797Z) with the settled Subaru defaults
// (M5 "Recording a clip" step 1). readText reads the fixture files; nothing reaches the network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CameraPassSpan,
  findCameraPasses,
  formatPassSpan,
  loadSatellite,
  parseFindPassesArgs,
  parseIsoZ,
} from "../../scripts/find-passes";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const N = Date.parse("2026-10-11T16:00:00Z");
const at = (iso: string): number => Date.parse(iso);

/** Reads the project's files, with cameras.json carrying the M5 entries (the settled Subaru defaults). */
function readText(path: string): string {
  const text = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  return path === "public/data/cameras.json"
    ? JSON.stringify(withM5CameraEntries(JSON.parse(text)))
    : text;
}

describe("parseFindPassesArgs", () => {
  it("defaults: norad 25544, from now, 48 h, public/data/gp, the camera's defaults", () => {
    expect(parseFindPassesArgs(["--cam", "subaru-starcam"], N)).toEqual({
      cameraId: "subaru-starcam",
      noradId: 25544,
      fromMs: N,
      hours: 48,
      calibrationFile: null,
      gpDir: "public/data/gp",
    });
  });

  it("reads every flag", () => {
    expect(
      parseFindPassesArgs(
        [
          ...["--cam", "cfht-starcam", "--norad", "48274", "--from", "2026-10-11T14:00:00Z"],
          ...["--hours", "3", "--calibration", "cal.json", "--gp", "tests/fixtures/gp"],
        ],
        N,
      ),
    ).toEqual({
      cameraId: "cfht-starcam",
      noradId: 48274,
      fromMs: at("2026-10-11T14:00:00Z"),
      hours: 3,
      calibrationFile: "cal.json",
      gpDir: "tests/fixtures/gp",
    });
  });

  it("throws the usage on a --from without Z, an unknown flag, no --cam or a bad value", () => {
    const bad = [
      ["--cam", "subaru-starcam", "--from", "2026-10-11T14:00:00"],
      ["--cam", "subaru-starcam", "--days", "2"],
      ["--norad", "25544"],
      [],
      ["--cam"],
      ["--cam", "subaru-starcam", "--norad", "0"],
      ["--cam", "subaru-starcam", "--hours", "-1"],
    ];
    for (const argv of bad) expect(() => parseFindPassesArgs(argv, N)).toThrow(/^usage: /);
  });

  it("parseIsoZ needs the Z", () => {
    expect(parseIsoZ("2026-10-11T15:08:30.039Z")).toBe(1_791_731_310_039);
    expect(parseIsoZ("2026-10-11T15:08Z")).toBe(at("2026-10-11T15:08:00Z"));
    expect(parseIsoZ("2026-10-11T15:08:30")).toBeNaN();
    expect(parseIsoZ("2026-10-11T15:08:30+00:00")).toBeNaN();
  });
});

describe("findCameraPasses on the fixture elements", () => {
  const spans: CameraPassSpan[] = findCameraPasses(
    parseFindPassesArgs(
      ["--cam", "subaru-starcam", "--from", "2026-10-11T14:00:00Z", "--hours", "3"].concat([
        "--gp",
        "tests/fixtures/gp",
      ]),
      N,
    ),
    readText,
  );

  it("finds one span: entry 15:09:50.6Z at az 123.43°, alt 28.84°; exit 15:15:08.6Z at az 52.09°, alt 0.02°", () => {
    expect(spans).toHaveLength(1); // the second pass (16:42–16:51Z) is in daylight
    const [span] = spans;
    if (span === undefined) throw new Error("no span");
    expect(Math.abs(span.enterMs - at("2026-10-11T15:09:50.6Z"))).toBeLessThanOrEqual(1_000);
    expect(Math.abs(span.exitMs - at("2026-10-11T15:15:08.6Z"))).toBeLessThanOrEqual(1_000);
    expect(span.enterAzAltDeg[0]).toBeCloseTo(123.43, 1);
    expect(span.enterAzAltDeg[1]).toBeCloseTo(28.84, 1);
    expect(span.exitAzAltDeg[0]).toBeCloseTo(52.09, 1);
    expect(span.exitAzAltDeg[1]).toBeCloseTo(0.02, 1);
    expect(span.maxAltDeg).toBeCloseTo(28.84, 1);
    expect(span.sunAltDegAtEnter).toBeCloseTo(-16.21, 1);
    expect(span.elementAgeH).toBeCloseTo(40.35, 1);
    // The samples fall on whole seconds from the pass's rise − 60 s (15:03:35.6Z): refraction keeps the ISS up 10 s
    // after its geometric set, which [riseMs, setMs] alone would cut off (DECISIONS, find-passes window).
    expect(span.exitMs).toBeGreaterThan(at("2026-10-11T15:14:59.2Z"));
  });

  it("prints one line with both ends in UTC and HST, the Sun and the element age", () => {
    const [span] = spans;
    if (span === undefined) throw new Error("no span");
    const line = formatPassSpan(span, "Pacific/Honolulu");
    expect(line).toMatch(
      /^enter 2026-10-11T15:09:5\d\.\dZ \(2026-10-11 05:09:5\d Pacific\/Honolulu\) az 123\.4\d° alt 28\.8\d°; /,
    );
    expect(line).toContain("exit 2026-10-11T15:15:0");
    expect(line).toMatch(/max alt 28\.8\d°; Sun -16\.2\d° at entry; elements 40\.3\d h old$/);
  });

  it("an unknown camera or satellite stops with a message", () => {
    const options = parseFindPassesArgs(["--cam", "nope", "--gp", "tests/fixtures/gp"], N);
    expect(() => findCameraPasses(options, readText)).toThrow("Unknown camera nope");
    expect(() => loadSatellite(readText, "tests/fixtures/gp", 99_999_999)).toThrow(
      "NORAD 99999999 is in neither stations.json nor visual.json in tests/fixtures/gp",
    );
  });

  it("loadSatellite finds the ISS in stations, with its EPOCH", () => {
    const iss = loadSatellite(readText, "tests/fixtures/gp", 25544);
    expect(iss.group).toBe("stations");
    expect(new Date(iss.epochMs).toISOString()).toBe("2026-10-09T22:48:38.797Z");
  });
});
