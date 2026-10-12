// tests/unit/checkClipPass.test.ts — M5 section 5: scripts/check-clip-pass.ts's pure helpers (the browser part is run
// by hand). Inline geometry, the settled Subaru fit, the committed ISS track and a Satellite check export.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alongTrackOffsetS,
  type CheckRow,
  type CssRect,
  clientToImagePx,
  type PassSample,
  parseCheckClipPassArgs,
  pixelSeparationDeg,
  stepPresses,
  summarizeCheck,
  summaryLine,
  trackFromJson,
} from "../../scripts/check-clip-pass";
import { createCameraModel } from "../../src/domain/camera";
import { M5_CAMERA_ENTRIES } from "../helpers/m5Cameras";

const W = 3840;
const H = 2160;
const START = 1_791_731_310_183; // the 2026-10-11 clip's media 0
const subaru = M5_CAMERA_ENTRIES[0];
const reference = createCameraModel({
  lens: "rectilinear",
  calibration: { ...subaru.defaults },
  widthPx: W,
  heightPx: H,
});

describe("clientToImagePx", () => {
  it("inverts the contained, letterboxed frame (s 0.375, 45 px bars) to 1e-9", () => {
    const rect: CssRect = { left: 100, top: 50, width: 1440, height: 900 };
    const s = 0.375;
    const oy = 45;
    for (const [u, v] of [
      [0, 0],
      [W, H],
      [1920, 1080],
      [1234.5, 678.9],
    ] as const) {
      const [bu, bv] = clientToImagePx(rect.left + u * s, rect.top + oy + v * s, rect, W, H);
      expect(Math.abs(bu - u)).toBeLessThan(1e-9);
      expect(Math.abs(bv - v)).toBeLessThan(1e-9);
    }
  });

  it("maps the centre of a 16:9 rect to the frame centre", () => {
    expect(
      clientToImagePx(580, 320, { left: 100, top: 50, width: 960, height: 540 }, W, H),
    ).toEqual([1920, 1080]);
  });
});

describe("alongTrackOffsetS", () => {
  const marker = (t: number): [number, number] => [1000 + 10 * t, 500 - 5 * t];

  it("is exactly 0.5 when the measured object leads the marker by 0.5 s of its velocity", () => {
    const samples: PassSample[] = [0, 2, 4, 6, 8].map((t) => ({
      mediaS: t,
      markerPx: marker(t),
      measuredPx: marker(t + 0.5),
    }));
    expect(alongTrackOffsetS(samples)).toBe(0.5);
  });

  it("is null for one sample, and for two samples 4 s apart (beyond maxGapS 3)", () => {
    expect(
      alongTrackOffsetS([{ mediaS: 0, markerPx: marker(0), measuredPx: marker(0) }]),
    ).toBeNull();
    expect(
      alongTrackOffsetS([
        { mediaS: 0, markerPx: marker(0), measuredPx: marker(0) },
        { mediaS: 4, markerPx: marker(4), measuredPx: marker(4) },
      ]),
    ).toBeNull();
    expect(alongTrackOffsetS([])).toBeNull();
  });
});

describe("pixelSeparationDeg", () => {
  it("1° near the axis is 44.09 px at 3840 width with the fitted f (M5 step 18.7)", () => {
    expect(pixelSeparationDeg(reference, [1920, 1080], [1920 + 44.09, 1080])).toBeCloseTo(1.0, 2);
    expect(pixelSeparationDeg(reference, [1000, 700], [1000, 700])).toBe(0);
  });

  it("null when either pixel does not unproject", () => {
    expect(pixelSeparationDeg(reference, [Number.NaN, 0], [1920, 1080])).toBeNull();
    expect(pixelSeparationDeg(reference, [1920, 1080], [1920, Number.NaN])).toBeNull();
  });
});

describe("parseCheckClipPassArgs", () => {
  const base = ["--cam", "subaru-2026-10-11-iss", "--track", "track.json"];

  it("defaults: no GP route, npm run dev under the H1 base, 1.0°, no calibration file", () => {
    expect(parseCheckClipPassArgs(base)).toEqual({
      cameraId: "subaru-2026-10-11-iss",
      trackFile: "track.json",
      gpDir: null,
      calibrationFile: null,
      url: "http://localhost:5173/Overhead/",
      limitDeg: 1,
    });
  });

  it("reads --gp, --calibration, --url and --limit", () => {
    const options = parseCheckClipPassArgs([
      ...base,
      ...["--gp", "tests/fixtures/gp", "--calibration", "cal.json"],
      ...["--url", "https://parthjain.ca/Overhead", "--limit", "0.5"],
    ]);
    expect(options.gpDir).toBe("tests/fixtures/gp");
    expect(options.calibrationFile).toBe("cal.json");
    expect(options.url).toBe("https://parthjain.ca/Overhead/");
    expect(options.limitDeg).toBe(0.5);
  });

  it("throws the usage without --cam or --track, on an unknown flag or a bad limit", () => {
    for (const argv of [
      ["--cam", "x"],
      ["--track", "t.json"],
      [...base, "--headed", "1"],
      [...base, "--limit", "0"],
      [...base, "--url", "not a url"],
    ])
      expect(() => parseCheckClipPassArgs(argv)).toThrow(/^usage: /);
  });
});

describe("trackFromJson", () => {
  it("reads the committed ISS track: 94 samples from 80 s to 290 s on the 1080p grid", () => {
    const json = JSON.parse(
      readFileSync(
        new URL("../fixtures/video/subaru-2026-10-11-iss-track.json", import.meta.url),
        "utf8",
      ),
    );
    const track = trackFromJson(json, START);
    expect(track.samples).toHaveLength(94);
    expect(track.noradId).toBe(25544);
    expect([track.widthPx, track.heightPx]).toEqual([1920, 1080]);
    expect(track.samples[0]).toEqual([80, 1905.4, 144.9]);
    expect(track.samples.at(-1)).toEqual([290, 456.3, 820.3]);
    const seconds = track.samples.map((s) => s[0]);
    expect(seconds.filter((s) => s % 2 === 1)).toEqual([221, 257, 265]); // the stand-ins (M5 step 14.6)
  });

  it("turns a Satellite check export into a track of whole media seconds on the camera grid", () => {
    const track = trackFromJson(
      {
        format: "overhead.satcheck",
        version: 1,
        cameraId: "subaru-2026-10-11-iss",
        clip: "subaru-2026-10-11-iss.mp4",
        widthPx: W,
        heightPx: H,
        noradId: 25544,
        samples: [
          { timeMs: START + 82_000, uPx: 3735.4, vPx: 318.6, residualDeg: 0.2, residualPx: 9 },
          { timeMs: START + 80_000, uPx: 3810.8, vPx: 289.8, residualDeg: 0.1, residualPx: 4 },
        ],
      },
      START,
    );
    expect(track.samples).toEqual([
      [80, 3810.8, 289.8],
      [82, 3735.4, 318.6],
    ]);
    expect([track.widthPx, track.heightPx, track.noradId]).toEqual([W, H, 25544]);
  });

  it("throws on anything else", () => {
    expect(() => trackFromJson([], START)).toThrow();
    expect(() => trackFromJson({ clip: "x", noradId: 1, samples: [] }, START)).toThrow();
    expect(() =>
      trackFromJson(
        { clip: "x", noradId: 1, widthPx: 1, heightPx: 1, method: "m", samples: [[1, 2]] },
        START,
      ),
    ).toThrow("Each track sample is [mediaS, uPx, vPx]");
  });
});

describe("stepPresses", () => {
  it("whole minutes first while 60 s or more remain, then seconds", () => {
    expect(stepPresses(0, 80)).toEqual({ minutes: 1, seconds: 20, forward: true });
    expect(stepPresses(80, 82)).toEqual({ minutes: 0, seconds: 2, forward: true });
    expect(stepPresses(240, 256)).toEqual({ minutes: 0, seconds: 16, forward: true });
    expect(stepPresses(0, 290)).toEqual({ minutes: 4, seconds: 50, forward: true });
    expect(stepPresses(90, 20)).toEqual({ minutes: 1, seconds: 10, forward: false });
  });
});

describe("summarizeCheck and summaryLine", () => {
  const row = (mediaS: number, sepDeg: number | null, t = mediaS): CheckRow => ({
    mediaS,
    markerPx: sepDeg === null ? null : [1000 + 10 * t, 500],
    measuredPx: [1000 + 10 * (t + 0.5), 500],
    sepDeg,
  });

  it("max with its media second, the median of the middle two, the offset, and pass", () => {
    const summary = summarizeCheck([row(80, 0.2), row(82, 0.54), row(84, 0.3), row(86, 0.25)], 1.0);
    expect(summary).toMatchObject({
      count: 4,
      maxDeg: 0.54,
      maxAtMediaS: 82,
      medianDeg: 0.275,
      overLimitMediaS: [],
      noMarkerMediaS: [],
      pass: true,
    });
    expect(summary.alongTrackOffsetS).toBeCloseTo(0.5, 12);
    expect(summaryLine(summary, 1.0)).toBe(
      "4 samples, max 0.54° at 82 s, median 0.28°, along-track +0.50 s: pass",
    );
  });

  it("fails on a sample over the limit or without a marker", () => {
    const over = summarizeCheck([row(80, 0.2), row(82, 1.01)], 1.0);
    expect(over.pass).toBe(false);
    expect(over.overLimitMediaS).toEqual([82]);
    const missing = summarizeCheck([row(80, 0.2), row(82, null)], 1.0);
    expect(missing.pass).toBe(false);
    expect(summaryLine(missing, 1.0)).toBe(
      "2 samples, max 0.20° at 80 s, median 0.20°, 1 without a marker: fail",
    );
    expect(summarizeCheck([], 1.0).pass).toBe(false);
  });
});
