// tests/unit/passes.test.ts — M5 section 5: findPasses and frameSpans on the committed ISS elements
// (tests/fixtures/gp/stations.json, epoch 2026-10-09T22:48:38.797Z) at the Subaru StarCam.
import { readFileSync } from "node:fs";
import { json2satrec, type SatRec } from "satellite.js";
import { describe, expect, it } from "vitest";
import { type Calibration, createCameraModel, projectAzAltDeg } from "../../src/domain/camera";
import { angularSeparationDeg, type ObserverSite } from "../../src/domain/geo";
import {
  type FrameSpan,
  findPasses,
  frameSpans,
  ISS_NORAD_ID,
  type Pass,
  parseGpFile,
} from "../../src/domain/orbits";
import { M5_CAMERA_ENTRIES } from "../helpers/m5Cameras";

function issSatrec(): SatRec {
  const url = new URL("../fixtures/gp/stations.json", import.meta.url);
  const omm = parseGpFile(JSON.parse(readFileSync(url, "utf8"))).find(
    (o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID,
  );
  if (omm === undefined) throw new Error("ISS missing from tests/fixtures/gp/stations.json");
  return json2satrec(omm);
}

const satrec = issSatrec();
const SUBARU: ObserverSite = { latDeg: 19.82552, lonDeg: -155.47587, heightM: 4148 };
const at = (iso: string): number => Date.parse(iso);
const W = 3840;
const H = 2160;

/** README "ISS span in the Subaru frame": the old Subaru defaults as inline inputs (az 81.2°, alt 19.6°, f 2742). */
const OLD_DEFAULTS: Calibration = {
  azDeg: 81.2,
  altDeg: 19.6,
  rollDeg: 0,
  focalPx: 2742,
  cxPx: 1920,
  cyPx: 1080,
  k1: 0,
  k2: 0,
  flipX: false,
  streamDelayMs: 50_000,
  rmsDeg: null,
  updatedAtMs: 0,
};
/** The settled subaru-starcam defaults of M5 step 2 (the 2026-10-11 star fit). */
const settled = M5_CAMERA_ENTRIES[0];
const SETTLED_DEFAULTS: Calibration = { ...settled.defaults };

const expectTime = (actualMs: number, iso: string, toleranceMs: number): void => {
  expect(
    Math.abs(actualMs - at(iso)),
    `${new Date(actualMs).toISOString()} vs ${iso}`,
  ).toBeLessThanOrEqual(toleranceMs);
};

describe("findPasses", () => {
  const passes: Pass[] = findPasses(
    satrec,
    SUBARU,
    at("2026-10-11T14:00:00Z"),
    at("2026-10-11T17:00:00Z"),
    10_000,
    0,
  );

  it("finds the two ISS passes over Maunakea between 14:00Z and 17:00Z", () => {
    expect(passes).toHaveLength(2);
    expect(passes[1]?.riseMs ?? 0).toBeGreaterThan(passes[0]?.setMs ?? Number.POSITIVE_INFINITY);
  });

  it("times the first pass: rise, culmination and set, sunlit under a dark sky", () => {
    const first = passes[0];
    if (first === undefined) throw new Error("no pass");
    expectTime(first.riseMs, "2026-10-11T15:04:35.6Z", 1_000);
    expectTime(first.culminationMs, "2026-10-11T15:09:47Z", 2_000);
    expectTime(first.setMs, "2026-10-11T15:14:59.2Z", 1_000);
    expect(first.maxAltDeg).toBeCloseTo(28.835, 1);
    expect(Math.abs(first.maxAltDeg - 28.835)).toBeLessThanOrEqual(0.05);
    expect(first.sunlitAtCulmination).toBe(true);
    expect(Math.abs(first.sunAltDegAtCulmination - -16.22)).toBeLessThanOrEqual(0.05);
  });

  it("bisects rise and set to the millisecond and culminates on a whole second", () => {
    const first = passes[0];
    if (first === undefined) throw new Error("no pass");
    expect(Number.isInteger(first.riseMs)).toBe(true);
    expect(Number.isInteger(first.setMs)).toBe(true);
    expect(first.culminationMs % 1_000).toBe(0);
    expect(first.riseMs).toBeLessThan(first.culminationMs);
    expect(first.culminationMs).toBeLessThan(first.setMs);
    // The same pass found with a finer scan agrees to the bisection's 1 ms.
    const fine = findPasses(satrec, SUBARU, first.riseMs - 60_000, first.setMs + 60_000, 1_000, 0);
    expect(fine).toHaveLength(1);
    expect(Math.abs((fine[0]?.riseMs ?? 0) - first.riseMs)).toBeLessThanOrEqual(1);
    expect(Math.abs((fine[0]?.setMs ?? 0) - first.setMs)).toBeLessThanOrEqual(1);
  });

  it("raises the threshold with minAltDeg", () => {
    const high = findPasses(
      satrec,
      SUBARU,
      at("2026-10-11T14:00:00Z"),
      at("2026-10-11T17:00:00Z"),
      10_000,
      20,
    );
    expect(high.length).toBeGreaterThanOrEqual(1);
    const first = high[0];
    if (first === undefined) throw new Error("no pass");
    expect(first.riseMs).toBeGreaterThan(passes[0]?.riseMs ?? 0);
    expect(first.setMs).toBeLessThan(passes[0]?.setMs ?? 0);
  });

  it("cuts a pass at the ends of the window instead of dropping it", () => {
    const first = passes[0];
    if (first === undefined) throw new Error("no pass");
    const fromMs = first.culminationMs - 30_000;
    const toMs = first.culminationMs + 30_000;
    const cut = findPasses(satrec, SUBARU, fromMs, toMs, 10_000, 0);
    expect(cut).toHaveLength(1);
    expect(cut[0]?.riseMs).toBe(fromMs);
    expect(cut[0]?.setMs).toBe(toMs);
    expect(cut[0]?.culminationMs).toBe(first.culminationMs);
  });

  it("finds nothing in an empty or reversed window", () => {
    expect(
      findPasses(satrec, SUBARU, at("2026-10-11T15:20:00Z"), at("2026-10-11T15:30:00Z"), 10_000, 0),
    ).toEqual([]);
    expect(
      findPasses(satrec, SUBARU, at("2026-10-11T17:00:00Z"), at("2026-10-11T14:00:00Z"), 10_000, 0),
    ).toEqual([]);
  });
});

describe("frameSpans", () => {
  const expectAzAlt = (actual: readonly [number, number], az: number, alt: number): void => {
    expect(angularSeparationDeg(actual[0], actual[1], az, alt)).toBeLessThanOrEqual(0.05);
  };

  it("finds the README span with the old Subaru defaults over 14:00Z–17:00Z", () => {
    const camera = createCameraModel({
      lens: "rectilinear",
      calibration: OLD_DEFAULTS,
      widthPx: W,
      heightPx: H,
    });
    const spans: FrameSpan[] = frameSpans(
      satrec,
      "stations",
      SUBARU,
      camera,
      at("2026-10-11T14:00:00Z"),
      at("2026-10-11T17:00:00Z"),
      1_000,
    );
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (span === undefined) throw new Error("no span");
    expectTime(span.enterMs, "2026-10-11T15:09:55Z", 1_000);
    expectTime(span.exitMs, "2026-10-11T15:15:09Z", 1_000);
    expectAzAlt(span.enterAzAltDeg, 120.76, 28.756);
    expectAzAlt(span.exitAzAltDeg, 52.065, 0.002);
    expect(Math.abs(span.maxAltDeg - 28.756)).toBeLessThanOrEqual(0.05);
  });

  it("finds one span with the settled subaru-starcam defaults over 15:05Z–15:20Z", () => {
    const camera = createCameraModel({
      lens: "rectilinear",
      calibration: SETTLED_DEFAULTS,
      widthPx: W,
      heightPx: H,
    });
    const spans = frameSpans(
      satrec,
      "stations",
      SUBARU,
      camera,
      at("2026-10-11T15:05:00Z"),
      at("2026-10-11T15:20:00Z"),
      1_000,
    );
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (span === undefined) throw new Error("no span");
    expectTime(span.enterMs, "2026-10-11T15:09:50Z", 1_000);
    expectTime(span.exitMs, "2026-10-11T15:15:09Z", 1_000);
    expectAzAlt(span.enterAzAltDeg, 123.78, 28.85);
    expect(Math.abs(span.maxAltDeg - 28.85)).toBeLessThanOrEqual(0.05);
    // Samples fall on the 1 s grid from fromMs.
    expect((span.enterMs - at("2026-10-11T15:05:00Z")) % 1_000).toBe(0);
  });

  it("gives find-passes' span over the pass's [rise − 60 s, set + 60 s] (M5 'Recording a clip' step 1)", () => {
    const camera = createCameraModel({
      lens: "rectilinear",
      calibration: SETTLED_DEFAULTS,
      widthPx: W,
      heightPx: H,
    });
    const pass = findPasses(
      satrec,
      SUBARU,
      at("2026-10-11T14:00:00Z"),
      at("2026-10-11T17:00:00Z"),
      10_000,
      0,
    )[0];
    if (pass === undefined) throw new Error("no pass");
    const spans = frameSpans(
      satrec,
      "stations",
      SUBARU,
      camera,
      pass.riseMs - 60_000,
      pass.setMs + 60_000,
      1_000,
    );
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (span === undefined) throw new Error("no span");
    // Refraction keeps the ISS above the apparent horizon about 10 s past the geometric set.
    expectTime(span.enterMs, "2026-10-11T15:09:50.6Z", 1_000);
    expectTime(span.exitMs, "2026-10-11T15:15:08.6Z", 1_000);
    expect(span.exitMs).toBeGreaterThan(pass.setMs);
    expectAzAlt(span.enterAzAltDeg, 123.43, 28.84);
    expectAzAlt(span.exitAzAltDeg, 52.09, 0.02);
    expect(Math.abs(span.maxAltDeg - 28.84)).toBeLessThanOrEqual(0.05);
  });

  it("relies on M4's cull: the ISS at 15:08:08Z, 84.51° off the axis, does not fold into the frame (G13)", () => {
    const camera = createCameraModel({
      lens: "rectilinear",
      calibration: SETTLED_DEFAULTS,
      widthPx: W,
      heightPx: H,
    });
    const out = new Float64Array(2);
    expect(projectAzAltDeg(camera, 172.11, 18.99, out, 0)).toBe(false);
    const spans = frameSpans(
      satrec,
      "stations",
      SUBARU,
      camera,
      at("2026-10-11T15:08:00Z"),
      at("2026-10-11T15:08:20Z"),
      1_000,
    );
    expect(spans).toEqual([]);
  });

  it("ends a span still open at toMs on the last sample", () => {
    const camera = createCameraModel({
      lens: "rectilinear",
      calibration: SETTLED_DEFAULTS,
      widthPx: W,
      heightPx: H,
    });
    const spans = frameSpans(
      satrec,
      "stations",
      SUBARU,
      camera,
      at("2026-10-11T15:10:00Z"),
      at("2026-10-11T15:11:00.5Z"),
      1_000,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]?.enterMs).toBe(at("2026-10-11T15:10:00Z"));
    expect(spans[0]?.exitMs).toBe(at("2026-10-11T15:11:00Z"));
  });

  it("needs a dark enough sky: none in daylight, and the group's Sun cutoff applies", () => {
    const camera = createCameraModel({
      lens: "rectilinear",
      calibration: SETTLED_DEFAULTS,
      widthPx: W,
      heightPx: H,
    });
    // The second pass (16:42–16:51Z) is in daylight.
    expect(
      frameSpans(
        satrec,
        "stations",
        SUBARU,
        camera,
        at("2026-10-11T16:40:00Z"),
        at("2026-10-11T16:55:00Z"),
        1_000,
      ),
    ).toEqual([]);
    // The Sun is at about −16° during the first pass: dark enough for the −12° Starlink cutoff as well.
    expect(
      frameSpans(
        satrec,
        "starlink",
        SUBARU,
        camera,
        at("2026-10-11T15:05:00Z"),
        at("2026-10-11T15:20:00Z"),
        1_000,
      ),
    ).toHaveLength(1);
  });
});
