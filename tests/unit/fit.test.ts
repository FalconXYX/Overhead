import { describe, expect, it } from "vitest";
import {
  type AcceptancePair,
  type Calibration,
  type CameraModel,
  calibrationAcceptance,
  createCameraModel,
  distortionValid,
  type FitOptions,
  type FitPair,
  type FitResult,
  fitCalibration,
  type LensModel,
  normalizeCalibration,
  projectAzAltDeg,
  type SatelliteCheckSample,
  satelliteCheckSummary,
  unprojectPixel,
} from "../../src/domain/camera";
import { angularSeparationDeg, wrap180 } from "../../src/domain/geo";
import { mulberry32 } from "../helpers/random";

const SEED = 20261011;
const D2R = Math.PI / 180;

function cal(overrides: Partial<Calibration>): Calibration {
  return {
    azDeg: 0,
    altDeg: 0,
    rollDeg: 0,
    focalPx: 1000,
    cxPx: 0,
    cyPx: 0,
    k1: 0,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: null,
    updatedAtMs: 0,
    ...overrides,
  };
}

interface Camera {
  readonly lens: LensModel;
  readonly widthPx: number;
  readonly heightPx: number;
}

const STARCAM: Camera = { lens: "rectilinear", widthPx: 3840, heightPx: 2160 };
const ALLSKY: Camera = { lens: "fisheye-equidistant", widthPx: 1232, heightPx: 1232 };

const STARCAM_TRUTH = cal({
  azDeg: 81.6,
  altDeg: 19.9,
  rollDeg: 0.7,
  focalPx: 2700,
  cxPx: 1925,
  cyPx: 1075,
  k1: -0.03,
});
const STARCAM_START = cal({
  azDeg: 81.2,
  altDeg: 19.6,
  rollDeg: 0,
  focalPx: 2742,
  cxPx: 1920,
  cyPx: 1080,
});

const TILT_TRUTH = cal({
  azDeg: 135,
  altDeg: 88,
  rollDeg: -45,
  focalPx: 376,
  cxPx: 622,
  cyPx: 601,
  k1: -0.03,
  flipX: true,
});
const LOCKED_START = cal({
  azDeg: 0,
  altDeg: 90,
  rollDeg: 180,
  focalPx: 376,
  cxPx: 616,
  cyPx: 616,
  flipX: true,
});

const NANAAO_TRUTH = cal({
  azDeg: 227,
  altDeg: 88.25,
  rollDeg: 45,
  focalPx: 373,
  cxPx: 620,
  cyPx: 610,
  k1: 0.003,
  flipX: true,
});

const OPTIONS: FitOptions = { fitK1: true, fitTilt: true, maxIterations: 100, rejectSigma: 3 };

function model(camera: Camera, c: Calibration): CameraModel {
  return createCameraModel({ ...camera, calibration: c });
}

/** Standard normal from two uniforms (Box–Muller). */
function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

interface Star {
  readonly uPx: number; // true pixel
  readonly vPx: number;
  readonly azDeg: number;
  readonly altDeg: number;
}

const sky = new Float64Array(2);
const px = new Float64Array(2);

/** Stars spread over the frame: uniform in-frame pixels whose truth direction is at alt ≥ minAltDeg. */
function frameStars(
  truth: CameraModel,
  count: number,
  minAltDeg: number,
  rand: () => number,
): Star[] {
  const list: Star[] = [];
  while (list.length < count) {
    const u = rand() * truth.widthPx;
    const v = rand() * truth.heightPx;
    if (!unprojectPixel(truth, u, v, sky, 0)) continue;
    const alt = sky[1] ?? Number.NaN;
    if (!(alt >= minAltDeg)) continue;
    list.push({ uPx: u, vPx: v, azDeg: sky[0] ?? Number.NaN, altDeg: alt });
  }
  return list;
}

/** Stars as the sky has them: uniform on the sphere at alt ≥ minAltDeg, kept when they land in the frame. */
function skyStars(
  truth: CameraModel,
  count: number,
  minAltDeg: number,
  rand: () => number,
): Star[] {
  const list: Star[] = [];
  const sinMin = Math.sin(minAltDeg * D2R);
  while (list.length < count) {
    const az = rand() * 360;
    const alt = Math.asin(sinMin + rand() * (1 - sinMin)) / D2R;
    if (!projectAzAltDeg(truth, az, alt, px, 0)) continue;
    const u = px[0] ?? Number.NaN;
    const v = px[1] ?? Number.NaN;
    if (!(u >= 0 && u <= truth.widthPx && v >= 0 && v <= truth.heightPx)) continue;
    list.push({ uPx: u, vPx: v, azDeg: az, altDeg: alt });
  }
  return list;
}

/** Clicks with Gaussian noise of noisePx per axis. */
function clicks(list: readonly Star[], noisePx: number, rand: () => number): FitPair[] {
  return list.map((s) => ({
    uPx: s.uPx + noisePx * gaussian(rand),
    vPx: s.vPx + noisePx * gaussian(rand),
    azDeg: s.azDeg,
    altDeg: s.altDeg,
  }));
}

/** Largest angle between a star's truth direction and its pixel unprojected through the fitted model. */
function worstUnseenDeg(fitted: CameraModel, unseen: readonly Star[]): number {
  let worst = 0;
  for (const s of unseen) {
    if (!unprojectPixel(fitted, s.uPx, s.vPx, sky, 0)) return Number.POSITIVE_INFINITY;
    worst = Math.max(worst, angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, s.azDeg, s.altDeg));
  }
  return worst;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The fit must give a result; narrows the type. */
function must(result: FitResult | null): FitResult {
  if (result === null) throw new Error("fit returned null");
  return result;
}

describe("fitCalibration · StarCam-like recovery", () => {
  it("recovers the pose to ≤ 0.3° at 400 unseen stars over 100 fits (20 pairs, 2 px noise)", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const worst: number[] = [];
    const rand = mulberry32(SEED);
    for (let trial = 0; trial < 100; trial++) {
      const pairs = clicks(frameStars(truth, 20, 10, rand), 2, rand);
      const fit = must(fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, pairs, OPTIONS));
      worst.push(worstUnseenDeg(model(STARCAM, fit.calibration), frameStars(truth, 400, 10, rand)));
    }
    worst.sort((a, b) => a - b);
    console.log(
      `StarCam recovery: worst unseen error median ${worst[50]?.toFixed(3)}°, worst ${worst[99]?.toFixed(3)}°`,
    );
    expect(worst[99]).toBeLessThanOrEqual(0.3);
  });

  it("noise-free pairs give the truth back exactly", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(frameStars(truth, 20, 10, rand), 0, rand);
    const fit = must(fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, pairs, OPTIONS));
    const c = fit.calibration;
    expect(c.azDeg).toBeCloseTo(81.6, 6);
    expect(c.altDeg).toBeCloseTo(19.9, 6);
    expect(c.rollDeg).toBeCloseTo(0.7, 6);
    expect(c.focalPx).toBeCloseTo(2700, 4);
    expect(c.cxPx).toBeCloseTo(1925, 4);
    expect(c.cyPx).toBeCloseTo(1075, 4);
    expect(c.k1).toBeCloseTo(-0.03, 7);
    expect(fit.rmsPx).toBeLessThan(1e-6);
    expect(fit.rmsDeg).toBeLessThan(1e-7);
    expect(Array.from(fit.rejected)).toEqual(new Array(20).fill(0));
  });
});

describe("fitCalibration · the 2026-10-11 Subaru star fit", () => {
  // DECISIONS "subaru-starcam defaults": the star fit on the recorded clip. Its principal point is not recorded
  // there, so the frame centre stands in. The start is M1's provisional published-centre pointing at f 2742.
  const REAL_FIT = cal({
    azDeg: 81.2322,
    altDeg: 19.6185,
    rollDeg: 0.7698,
    focalPx: 2525.93,
    cxPx: 1920,
    cyPx: 1080,
    k1: -0.00992,
  });
  const PROVISIONAL = cal({ azDeg: 81.2, altDeg: 19.6, focalPx: 2742, cxPx: 1920, cyPx: 1080 });

  it("is recovered from the provisional defaults to ≤ 0.3° at unseen stars (20 fits × 20 pairs, 2 px)", () => {
    const truth = model(STARCAM, REAL_FIT);
    const rand = mulberry32(SEED);
    let worst = 0;
    for (let trial = 0; trial < 20; trial++) {
      const pairs = clicks(frameStars(truth, 20, 10, rand), 2, rand);
      const fit = must(fitCalibration(STARCAM.lens, 3840, 2160, PROVISIONAL, pairs, OPTIONS));
      expect(Math.abs(fit.calibration.focalPx - 2525.93)).toBeLessThan(25);
      worst = Math.max(
        worst,
        worstUnseenDeg(model(STARCAM, fit.calibration), frameStars(truth, 400, 10, rand)),
      );
    }
    expect(worst).toBeLessThanOrEqual(0.3);
  });
});

describe("fitCalibration · tilted all-sky camera", () => {
  it("a locked fit leaves ≥ 0.25° mean RMS and fitTilt ≤ 0.22° (40 fits × 14 pairs, 1 px)", () => {
    const truth = model(ALLSKY, TILT_TRUTH);
    const locked: number[] = [];
    const tilted: number[] = [];
    const rand = mulberry32(SEED);
    for (let trial = 0; trial < 40; trial++) {
      const pairs = clicks(skyStars(truth, 14, 20, rand), 1, rand);
      const a = must(
        fitCalibration(ALLSKY.lens, 1232, 1232, LOCKED_START, pairs, {
          ...OPTIONS,
          fitTilt: false,
        }),
      );
      const b = must(fitCalibration(ALLSKY.lens, 1232, 1232, LOCKED_START, pairs, OPTIONS));
      expect(a.calibration.altDeg).toBe(90);
      expect(a.calibration.azDeg).toBe(0);
      expect(b.calibration.altDeg).toBeLessThan(90);
      locked.push(a.rmsDeg);
      tilted.push(b.rmsDeg);
    }
    console.log(
      `tilt: mean rmsDeg locked ${mean(locked).toFixed(3)}°, with fitTilt ${mean(tilted).toFixed(3)}°`,
    );
    expect(mean(locked)).toBeGreaterThanOrEqual(0.25);
    expect(mean(tilted)).toBeLessThanOrEqual(0.22);
  });
});

describe("fitCalibration · robustness", () => {
  it("a Nānā ao-like start 179° off in roll converges in all 100 fits with rmsDeg ≤ 0.3", () => {
    const truth = model(ALLSKY, NANAAO_TRUTH);
    const lockedRoll = wrap180(NANAAO_TRUTH.rollDeg - NANAAO_TRUTH.azDeg);
    let worst = 0;
    const rand = mulberry32(SEED);
    for (let trial = 0; trial < 100; trial++) {
      const pairs = clicks(skyStars(truth, 14, 20, rand), 1, rand);
      const start = cal({
        azDeg: 0,
        altDeg: 90,
        rollDeg: wrap180(lockedRoll + (trial % 2 === 0 ? 179 : -179)),
        focalPx: 373,
        cxPx: 616,
        cyPx: 616,
        flipX: true,
      });
      const fit = must(fitCalibration(ALLSKY.lens, 1232, 1232, start, pairs, OPTIONS));
      worst = Math.max(worst, fit.rmsDeg);
    }
    console.log(`roll 179° off: worst rmsDeg ${worst.toFixed(3)}°`);
    expect(worst).toBeLessThanOrEqual(0.3);
  });

  it("a StarCam start 30° off in azimuth converges in all 50 fits with rmsDeg ≤ 0.2", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const start = { ...STARCAM_START, azDeg: STARCAM_START.azDeg + 30 };
    let worst = 0;
    const rand = mulberry32(SEED);
    for (let trial = 0; trial < 50; trial++) {
      const pairs = clicks(frameStars(truth, 14, 10, rand), 2, rand);
      const fit = must(fitCalibration(STARCAM.lens, 3840, 2160, start, pairs, OPTIONS));
      worst = Math.max(worst, fit.rmsDeg);
    }
    console.log(`StarCam az +30°: worst rmsDeg ${worst.toFixed(3)}°`);
    expect(worst).toBeLessThanOrEqual(0.2);
  });

  it("returns null with fewer than 4 usable pairs", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(frameStars(truth, 4, 10, rand), 1, rand);
    expect(
      fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, pairs.slice(0, 3), OPTIONS),
    ).toBeNull();
    const broken = [...pairs.slice(0, 3), { ...(pairs[3] as FitPair), azDeg: Number.NaN }];
    expect(fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, broken, OPTIONS)).toBeNull();
    expect(fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, pairs, OPTIONS)).not.toBeNull();
  });

  it("returns null when a target is behind a rectilinear start", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(frameStars(truth, 6, 10, rand), 1, rand);
    const behind = { ...STARCAM_START, azDeg: STARCAM_START.azDeg + 180 };
    expect(fitCalibration(STARCAM.lens, 3840, 2160, behind, pairs, OPTIONS)).toBeNull();
  });

  it("returns null without convergence inside maxIterations", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(frameStars(truth, 20, 10, rand), 2, rand);
    const start = { ...STARCAM_START, azDeg: STARCAM_START.azDeg + 30 };
    expect(
      fitCalibration(STARCAM.lens, 3840, 2160, start, pairs, { ...OPTIONS, maxIterations: 1 }),
    ).toBeNull();
  });

  it("returns null when the start fails distortionValid", () => {
    const truth = model(ALLSKY, NANAAO_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(skyStars(truth, 8, 20, rand), 1, rand);
    const start = { ...LOCKED_START, k1: -0.5 }; // g′(π/2) = −2.70
    expect(fitCalibration(ALLSKY.lens, 1232, 1232, start, pairs, OPTIONS)).toBeNull();
  });
});

describe("fitCalibration · result fields", () => {
  it("keeps the unfitted fields, normalizes, and fills every per-pair array", () => {
    const truth = model(ALLSKY, TILT_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(skyStars(truth, 14, 20, rand), 1, rand);
    const start = { ...LOCKED_START, azDeg: 37, k2: 0.001, streamDelayMs: 1234, updatedAtMs: 99 };
    const fit = must(
      fitCalibration(ALLSKY.lens, 1232, 1232, start, pairs, { ...OPTIONS, fitK1: false }),
    );
    const c = fit.calibration;
    expect(c.k1).toBe(0);
    expect(c.k2).toBe(0.001);
    expect(c.flipX).toBe(true);
    expect(c.streamDelayMs).toBe(1234);
    expect(c.updatedAtMs).toBe(99);
    expect(c.rmsDeg).toBe(fit.rmsDeg);
    expect(normalizeCalibration(ALLSKY.lens, c)).toEqual(c);
    expect(fit.residualPx.length).toBe(14);
    expect(fit.residualDeg.length).toBe(14);
    expect(fit.rejected.length).toBe(14);
    expect(fit.iterations).toBeGreaterThan(0);

    // residualPx is the pixel distance under the result; residualDeg the angle of the unprojected click.
    const m = model(ALLSKY, c);
    const px = new Float64Array(2);
    let sumPx = 0;
    let sumDeg = 0;
    let n = 0;
    pairs.forEach((p, i) => {
      expect(projectAzAltDeg(m, p.azDeg, p.altDeg, px, 0)).toBe(true);
      expect(fit.residualPx[i]).toBeCloseTo(
        Math.hypot((px[0] ?? 0) - p.uPx, (px[1] ?? 0) - p.vPx),
        9,
      );
      expect(unprojectPixel(m, p.uPx, p.vPx, sky, 0)).toBe(true);
      const deg = angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, p.azDeg, p.altDeg);
      expect(fit.residualDeg[i]).toBeCloseTo(deg, 12);
      if (fit.rejected[i] === 0) {
        sumPx += (fit.residualPx[i] ?? 0) ** 2;
        sumDeg += deg * deg;
        n++;
      }
    });
    expect(fit.rmsPx).toBeCloseTo(Math.sqrt(sumPx / n), 12);
    expect(fit.rmsDeg).toBeCloseTo(Math.sqrt(sumDeg / n), 12);
  });

  it("a locked start without fitTilt stays locked and fits roll, f, cx, cy", () => {
    const truth = model(ALLSKY, { ...TILT_TRUTH, altDeg: 90, azDeg: 0, rollDeg: 170 });
    const rand = mulberry32(SEED);
    const pairs = clicks(skyStars(truth, 14, 20, rand), 0, rand);
    const fit = must(
      fitCalibration(ALLSKY.lens, 1232, 1232, LOCKED_START, pairs, { ...OPTIONS, fitTilt: false }),
    );
    expect(fit.calibration.azDeg).toBe(0);
    expect(fit.calibration.altDeg).toBe(90);
    expect(fit.calibration.rollDeg).toBeCloseTo(170, 6);
    expect(fit.calibration.focalPx).toBeCloseTo(376, 4);
    expect(fit.calibration.k1).toBeCloseTo(-0.03, 7);
    expect(fit.rmsPx).toBeLessThan(1e-6);
  });
});

describe("fitCalibration · 3σ rejection", () => {
  it("rejects one pair moved 30 px and keeps clean fits whole (60 + 60 fits)", () => {
    const truth = model(ALLSKY, TILT_TRUTH);
    let caught = 0;
    let wronglyRejected = 0;
    let cleanRejected = 0;
    const rand = mulberry32(SEED);
    for (let trial = 0; trial < 60; trial++) {
      const pairs = clicks(skyStars(truth, 12, 20, rand), 1, rand);
      const clean = must(fitCalibration(ALLSKY.lens, 1232, 1232, LOCKED_START, pairs, OPTIONS));
      cleanRejected += clean.rejected.reduce((a, b) => a + b, 0);
      const angle = rand() * 2 * Math.PI;
      const first = pairs[0] as FitPair;
      const moved = [
        { ...first, uPx: first.uPx + 30 * Math.cos(angle), vPx: first.vPx + 30 * Math.sin(angle) },
        ...pairs.slice(1),
      ];
      const bad = must(fitCalibration(ALLSKY.lens, 1232, 1232, LOCKED_START, moved, OPTIONS));
      if (bad.rejected[0] === 1) caught++;
      wronglyRejected += bad.rejected.reduce((a, b) => a + b, 0) - (bad.rejected[0] ?? 0);
      for (const result of [clean, bad]) {
        const m = model(ALLSKY, result.calibration);
        expect(distortionValid(result.calibration.k1, result.calibration.k2, m.rMaxUnit)).toBe(
          true,
        );
      }
    }
    console.log(
      `3σ: caught ${caught}/60, other pairs rejected ${wronglyRejected}, clean rejections ${cleanRejected}`,
    );
    expect(caught).toBeGreaterThanOrEqual(50);
    // M4 section 5 measured 0 here on its own draws. A good pair beyond 3σ of the others is a real Gaussian tail
    // event at about the clean fits' rate (8–14 per 600 seeds with this generator, against 9–12 clean), so
    // this bound matches the clean one.
    expect(wronglyRejected).toBeLessThanOrEqual(2);
    expect(cleanRejected).toBeLessThanOrEqual(2);
  });

  it("never rejects down to fewer than 4 active pairs", () => {
    const truth = model(STARCAM, STARCAM_TRUTH);
    const rand = mulberry32(SEED);
    const pairs = clicks(frameStars(truth, 5, 10, rand), 0.01, rand);
    const first = pairs[0] as FitPair;
    const moved = [{ ...first, uPx: first.uPx + 200 }, ...pairs.slice(1)];
    for (const list of [pairs.slice(0, 4), moved.slice(0, 4)]) {
      const fit = must(fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, list, OPTIONS));
      expect(Array.from(fit.rejected)).toEqual([0, 0, 0, 0]);
    }
    const fit = must(fitCalibration(STARCAM.lens, 3840, 2160, STARCAM_START, moved, OPTIONS));
    expect(fit.rejected.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
  });
});

describe("calibrationAcceptance", () => {
  const star = (overrides: Partial<AcceptancePair> = {}): AcceptancePair => ({
    kind: "star",
    named: true,
    altDeg: 45,
    role: "fit",
    rejected: false,
    residualDeg: 0.1,
    ...overrides,
  });
  /** 10 named fit stars at 0.1°, 3 holdout stars and 1 holdout planet at 0.2°: a pass. */
  const passing = (): AcceptancePair[] => [
    ...Array.from({ length: 10 }, () => star()),
    star({ role: "holdout", residualDeg: 0.2 }),
    star({ role: "holdout", residualDeg: 0.2 }),
    star({ role: "holdout", residualDeg: 0.2 }),
    star({ kind: "planet", named: true, role: "holdout", residualDeg: 0.2 }),
  ];

  it("passes the baseline and reports its counts", () => {
    const report = calibrationAcceptance("fisheye-equidistant", passing());
    expect(report).toEqual({
      namedFitStars: 10,
      rmsDeg: expect.closeTo(0.1, 12),
      maxFitDeg: 0.1,
      holdoutStars: 3,
      holdoutPlanets: 1,
      maxHoldoutDeg: 0.2,
      pass: true,
    });
  });

  /** Each case replaces pairs from index `at` (deleting `remove` of them) and must fail on its own. */
  const failures: [string, number, number, AcceptancePair[]][] = [
    ["9 named stars", 0, 1, []],
    ["an unnamed tenth star", 0, 1, [star({ named: false })]],
    ["a rejected tenth star", 0, 1, [star({ rejected: true })]],
    ["alt 19.9° on a fisheye", 0, 1, [star({ altDeg: 19.9 })]],
    ["0.26° RMS", 0, 10, Array.from({ length: 10 }, () => star({ residualDeg: 0.26 }))],
    ["one fit star at 0.51°", 0, 1, [star({ residualDeg: 0.51 })]],
    ["one 0.51° holdout", 10, 1, [star({ role: "holdout", residualDeg: 0.51 })]],
    ["2 holdout stars", 10, 1, []],
    ["no planet", 13, 1, []],
    ["a planet at alt 19.9°", 13, 1, [star({ kind: "planet", role: "holdout", altDeg: 19.9 })]],
    ["a NaN fit residual", 14, 0, [star({ named: false, residualDeg: Number.NaN })]],
  ];
  it.each(failures)("fails on %s alone", (_name, at, remove, insert) => {
    const list = passing();
    list.splice(at, remove, ...insert);
    expect(calibrationAcceptance("fisheye-equidistant", list).pass).toBe(false);
  });

  it("uses 10° on rectilinear lenses and leaves rejected pairs out of the RMS", () => {
    const list = passing().map((p) => ({ ...p, altDeg: 12 }));
    expect(calibrationAcceptance("rectilinear", list).pass).toBe(true);
    expect(calibrationAcceptance("fisheye-stereographic", list).pass).toBe(false);
    list.push(star({ rejected: true, residualDeg: 5 }));
    const report = calibrationAcceptance("rectilinear", list);
    expect(report.pass).toBe(true);
    expect(report.rmsDeg).toBeCloseTo(0.1, 12);
    expect(report.maxFitDeg).toBeCloseTo(0.1, 12);
  });

  it("an empty list fails with no holdout maximum", () => {
    const report = calibrationAcceptance("rectilinear", []);
    expect(report.pass).toBe(false);
    expect(report.namedFitStars).toBe(0);
    expect(report.maxHoldoutDeg).toBeNull();
  });
});

describe("satelliteCheckSummary [M5]", () => {
  /** Samples at the given times (ms) with the given residuals (one value for all, or one per sample). */
  const samples = (
    timesMs: readonly number[],
    residualDeg: number | readonly number[],
  ): SatelliteCheckSample[] =>
    timesMs.map((timeMs, i) => ({
      timeMs,
      residualDeg: typeof residualDeg === "number" ? residualDeg : (residualDeg[i] ?? Number.NaN),
    }));
  const T = Date.parse("2026-10-11T15:10:00Z");
  /** 12 samples 2,000 ms apart with residuals 0.30, 0.35, … 0.85°. */
  const twelve = samples(
    Array.from({ length: 12 }, (_, i) => T + 2_000 * i),
    Array.from({ length: 12 }, (_, i) => 0.3 + 0.05 * i),
  );

  it("passes 12 samples 2 s apart under 1°, with the median of the middle two", () => {
    const summary = satelliteCheckSummary(twelve, 1.0);
    expect(summary).toMatchObject({
      count: 12,
      firstMs: T,
      lastMs: T + 22_000,
      maxGapMs: 2_000,
      pass: true,
    });
    expect(summary.maxDeg).toBeCloseTo(0.85, 12);
    expect(summary.medianDeg).toBeCloseTo(0.575, 12);
  });

  it("fails one residual over the limit and passes one exactly at it", () => {
    const over = twelve.map((s, i) => (i === 5 ? { ...s, residualDeg: 1.01 } : s));
    expect(satelliteCheckSummary(over, 1.0).pass).toBe(false);
    const at = twelve.map((s, i) => (i === 5 ? { ...s, residualDeg: 1.0 } : s));
    expect(satelliteCheckSummary(at, 1.0).pass).toBe(true);
  });

  it("needs at least 10 samples", () => {
    expect(satelliteCheckSummary(twelve.slice(0, 9), 1.0)).toMatchObject({ count: 9, pass: false });
    expect(satelliteCheckSummary(twelve.slice(0, 10), 1.0).pass).toBe(true);
  });

  it("fails a gap over 2,500 ms", () => {
    const gappy = twelve.map((s, i) => (i >= 6 ? { ...s, timeMs: s.timeMs + 1_000 } : s));
    expect(satelliteCheckSummary(gappy, 1.0)).toMatchObject({ maxGapMs: 3_000, pass: false });
    const edge = twelve.map((s, i) => (i >= 6 ? { ...s, timeMs: s.timeMs + 500 } : s));
    expect(satelliteCheckSummary(edge, 1.0)).toMatchObject({ maxGapMs: 2_500, pass: true });
  });

  it("counts only the part of a gap that is not known to be hidden", () => {
    // 13 samples at 0, 2, … 20 s and 30, 32 s, residual 0.5°.
    const times = [...Array.from({ length: 11 }, (_, i) => T + 2_000 * i), T + 30_000, T + 32_000];
    const thirteen = samples(times, 0.5);
    expect(satelliteCheckSummary(thirteen, 1.0)).toMatchObject({ maxGapMs: 10_000, pass: false });
    expect(satelliteCheckSummary(thirteen, 1.0, [[T + 21_000, T + 29_000]])).toMatchObject({
      maxGapMs: 2_000,
      pass: true,
    });
    expect(satelliteCheckSummary(thirteen, 1.0, [[T + 23_000, T + 29_000]])).toMatchObject({
      maxGapMs: 4_000,
      pass: false,
    });
    // Two disjoint hidden stretches inside one gap both count; one outside every gap changes nothing.
    expect(
      satelliteCheckSummary(thirteen, 1.0, [
        [T + 21_000, T + 24_000],
        [T + 25_000, T + 30_000],
        [T + 100_000, T + 200_000],
      ]),
    ).toMatchObject({ maxGapMs: 2_000, pass: true });
  });

  it("does not depend on the order of the samples", () => {
    const reversed = [...twelve].reverse();
    expect(satelliteCheckSummary(reversed, 1.0)).toEqual(satelliteCheckSummary(twelve, 1.0));
    const hidden = [[T + 21_000, T + 29_000]] as const;
    const thirteen = samples(
      [T + 32_000, T, T + 30_000, ...Array.from({ length: 10 }, (_, i) => T + 2_000 * (i + 1))],
      0.5,
    );
    expect(satelliteCheckSummary(thirteen, 1.0, hidden)).toMatchObject({
      count: 13,
      firstMs: T,
      lastMs: T + 32_000,
      maxGapMs: 2_000,
      pass: true,
    });
  });

  it("fails a NaN residual", () => {
    const nan = twelve.map((s, i) => (i === 3 ? { ...s, residualDeg: Number.NaN } : s));
    const summary = satelliteCheckSummary(nan, 1.0);
    expect(summary.pass).toBe(false);
    expect(summary.count).toBe(12);
  });

  it("gives nulls and a fail for no samples, and no gap for one", () => {
    expect(satelliteCheckSummary([], 1.0)).toEqual({
      count: 0,
      firstMs: null,
      lastMs: null,
      maxGapMs: null,
      maxDeg: null,
      medianDeg: null,
      pass: false,
    });
    expect(satelliteCheckSummary(samples([T], 0.4), 1.0)).toEqual({
      count: 1,
      firstMs: T,
      lastMs: T,
      maxGapMs: null,
      maxDeg: 0.4,
      medianDeg: 0.4,
      pass: false,
    });
  });

  it("passes the 94 clicks of the 2026-10-11 clip only with the domes' hidden stretches", () => {
    // M5 step 13.4: clicks every 2 s across the visible stretches 78.7–228, 238–241.5, 256–258.4 and 260.8–290.43 s.
    const start = 1_791_731_310_183;
    const visible: readonly (readonly [number, number])[] = [
      [78.7, 228],
      [238, 241.5],
      [256, 258.4],
      [260.8, 290.43],
    ];
    const seconds: number[] = [];
    for (const [from, to] of visible)
      for (let s = Math.ceil(from / 2) * 2; s <= to; s += 2) seconds.push(s);
    const clicks = samples(
      seconds.map((s) => start + s * 1_000),
      0.5,
    );
    const hiddenMs = visible
      .slice(1)
      .map(([from], i) => [start + (visible[i]?.[1] ?? 0) * 1_000, start + from * 1_000] as const);
    expect(satelliteCheckSummary(clicks, 1.0)).toMatchObject({ maxGapMs: 16_000, pass: false });
    expect(satelliteCheckSummary(clicks, 1.0, hiddenMs)).toMatchObject({ pass: true });
    expect(satelliteCheckSummary(clicks, 1.0, hiddenMs).maxGapMs).toBeLessThanOrEqual(2_500);
  });
});
