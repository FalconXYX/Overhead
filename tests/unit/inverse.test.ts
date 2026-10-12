import { describe, expect, it } from "vitest";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  distortionValid,
  horizonRadiusUnit,
  type LensModel,
  MIN_DISTORTION_SLOPE,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
  undistortRadius,
  unprojectPixel,
} from "../../src/domain/camera";
// The iteration-capped Newton behind undistortRadius: the only way to count iterations (M4 section 5, edges).
import { solveUndistortedRadius } from "../../src/domain/camera/lens";
import { angularSeparationDeg, wrap360 } from "../../src/domain/geo";
import { mulberry32 } from "../helpers/random";

const FISHEYES = [
  "fisheye-equidistant",
  "fisheye-equisolid",
  "fisheye-stereographic",
  "fisheye-orthographic",
] as const satisfies readonly LensModel[];
const ALL_LENSES = ["rectilinear", ...FISHEYES] as const satisfies readonly LensModel[];

function calibration(overrides: Partial<Calibration>): Calibration {
  return {
    azDeg: 0,
    altDeg: 0,
    rollDeg: 0,
    focalPx: 2742,
    cxPx: 1920,
    cyPx: 1080,
    k1: 0,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: null,
    updatedAtMs: 0,
    ...overrides,
  };
}

/** g(r) = r (1 + k1 r² + k2 r⁴). */
function distort(r: number, k1: number, k2: number): number {
  const r2 = r * r;
  return r * (1 + k1 * r2 + k2 * r2 * r2);
}

const sky = new Float64Array(2);
const px = new Float64Array(2);
const sky2 = new Float64Array(2);

describe("[M4] unprojectPixel: round trips", () => {
  it("pixel → sky → pixel < 1e-6 px and sky → pixel → sky < 1e-9° over 200 calibrations × 50 pixels per lens", () => {
    const rand = mulberry32(20261011);
    const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
    let checked = 0;
    let skipped = 0;
    let failures = 0;
    let worstPx = 0;
    let worstDeg = 0;
    for (const lens of ALL_LENSES) {
      const rect = lens === "rectilinear";
      const widthPx = rect ? 3840 : 1232;
      const heightPx = rect ? 2160 : 1232;
      const rh = horizonRadiusUnit(lens);
      for (let cam = 0; cam < 200; cam++) {
        // A valid calibration: redraw the distortion until distortionValid holds.
        let model: CameraModel | null = null;
        const locked = !rect && rand() < 0.3;
        const pose = {
          azDeg: locked ? 0 : between(0, 360),
          altDeg: locked ? 90 : rect ? between(-10, 90) : between(0, 90),
          rollDeg: between(-180, 180),
          flipX: rand() < 0.5,
          focalPx: rect ? between(2000, 4000) : (616 / rh) * between(0.9, 1.1),
          cxPx: widthPx / 2 + between(-20, 20),
          cyPx: heightPx / 2 + between(-20, 20),
        };
        for (let attempt = 0; model === null; attempt++) {
          expect(attempt).toBeLessThan(1000);
          const k2Choice = rand();
          const k1 = between(-0.1, 0.1);
          const k2 = k2Choice < 1 / 3 ? 0 : k2Choice < 2 / 3 ? 0.01 : -0.01;
          const candidate = createCameraModel({
            lens,
            calibration: calibration({ ...pose, k1, k2 }),
            widthPx,
            heightPx,
          });
          if (distortionValid(k1, k2, candidate.rMaxUnit)) model = candidate;
        }
        expect(model.zenithLocked).toBe(locked);
        const { k1, k2, focalPx, cxPx, cyPx } = model.calibration;
        // The distorted horizon radius: fisheye pixels beyond it have no sky.
        const horizonPx = rect ? Number.POSITIVE_INFINITY : distort(rh, k1, k2) * focalPx;
        for (let i = 0; i < 50; i++) {
          const u = rand() * widthPx;
          const v = rand() * heightPx;
          if (Math.hypot(u - cxPx, v - cyPx) > horizonPx) {
            skipped++;
            expect(unprojectPixel(model, u, v, sky, 0)).toBe(false);
            continue;
          }
          checked++;
          if (!unprojectPixel(model, u, v, sky, 0)) {
            failures++;
            continue;
          }
          const az = sky[0] ?? Number.NaN;
          const alt = sky[1] ?? Number.NaN;
          expect(az).toBeGreaterThanOrEqual(0);
          expect(az).toBeLessThan(360);
          if (!projectAzAltDeg(model, az, alt, px, 0)) {
            failures++;
            continue;
          }
          const dPx = Math.hypot((px[0] ?? Number.NaN) - u, (px[1] ?? Number.NaN) - v);
          if (!(dPx < 1e-6)) failures++;
          worstPx = Math.max(worstPx, dPx);
          if (!unprojectPixel(model, px[0] ?? Number.NaN, px[1] ?? Number.NaN, sky2, 0)) {
            failures++;
            continue;
          }
          const dDeg = angularSeparationDeg(az, alt, sky2[0] ?? Number.NaN, sky2[1] ?? Number.NaN);
          if (!(dDeg < 1e-9)) failures++;
          worstDeg = Math.max(worstDeg, dDeg);
        }
      }
    }
    expect(checked + skipped).toBe(50_000);
    expect(failures).toBe(0);
    expect(worstPx).toBeLessThan(1e-6);
    expect(worstDeg).toBeLessThan(1e-9);
    expect(checked).toBeGreaterThan(40_000);
  });
});

describe("[M4] unprojectPixel: edges", () => {
  it("the principal point of an (300, 20) camera is exactly (300, 20), whatever the distortion", () => {
    for (const lens of ALL_LENSES) {
      const model = createCameraModel({
        lens,
        calibration: calibration({ azDeg: 300, altDeg: 20, rollDeg: 33, k1: 0.05, flipX: true }),
        widthPx: 3840,
        heightPx: 2160,
      });
      expect(unprojectPixel(model, 1920, 1080, sky, 0), lens).toBe(true);
      expect(Array.from(sky), lens).toEqual([300, 20]);
    }
  });

  it("the principal point writes the calibration's degrees exactly for every azimuth 0.0°, 0.1° … 359.9°", () => {
    for (let i = 0; i < 3600; i++) {
      const azDeg = i / 10;
      const model = createCameraModel({
        lens: "rectilinear",
        calibration: calibration({ azDeg, altDeg: 12.3 }),
        widthPx: 3840,
        heightPx: 2160,
      });
      expect(unprojectPixel(model, 1920, 1080, sky, 0)).toBe(true);
      expect(sky[0]).toBe(azDeg);
      expect(sky[1]).toBe(12.3);
    }
    // An unwrapped azimuth comes back wrapped.
    const model = createCameraModel({
      lens: "rectilinear",
      calibration: calibration({ azDeg: -30, altDeg: 5 }),
      widthPx: 3840,
      heightPx: 2160,
    });
    expect(unprojectPixel(model, 1920, 1080, sky, 0)).toBe(true);
    expect(Array.from(sky)).toEqual([wrap360(-30), 5]);
  });

  it("a zenith-locked fisheye's principal point is (0, 90) even with a stale azDeg", () => {
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: { ...syntheticFisheyeCalibration(1232), azDeg: 37 },
      widthPx: 1232,
      heightPx: 1232,
    });
    expect(model.zenithLocked).toBe(true);
    expect(unprojectPixel(model, 616, 616, sky, 0)).toBe(true);
    expect(Array.from(sky)).toEqual([0, 90]);
  });

  it("orientation: the synthetic camera's top edge centre is the north horizon, its left edge east", () => {
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: syntheticFisheyeCalibration(1024),
      widthPx: 1024,
      heightPx: 1024,
    });
    expect(unprojectPixel(model, 512, 0, sky, 0)).toBe(true);
    expect(angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, 0, 0)).toBeLessThan(1e-12);
    expect(unprojectPixel(model, 0, 512, sky, 0)).toBe(true);
    expect(angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, 90, 0)).toBeLessThan(1e-12);
    expect(unprojectPixel(model, 512, 256, sky, 0)).toBe(true);
    expect(angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, 0, 45)).toBeLessThan(1e-12);
  });

  it("undistortRadius(0.80339, −0.2293, 0) converges in 9 iterations; −0.2296 (past the fold) → null", () => {
    const r = undistortRadius(0.80339, -0.2293, 0);
    expect(r).not.toBeNull();
    expect(Math.abs(distort(r ?? Number.NaN, -0.2293, 0) - 0.80339)).toBeLessThan(1e-12);
    expect(solveUndistortedRadius(0.80339, -0.2293, 0, 9)).toBe(r);
    expect(solveUndistortedRadius(0.80339, -0.2293, 0, 8)).toBeNull();
    expect(undistortRadius(0.80339, -0.2296, 0)).toBeNull();
  });

  it("undistortRadius: rd 0 → 0, no distortion → rd, non-finite or negative → null", () => {
    expect(undistortRadius(0, 0.1, 0.01)).toBe(0);
    expect(undistortRadius(0.7, 0, 0)).toBe(0.7);
    expect(undistortRadius(Number.NaN, 0, 0)).toBeNull();
    expect(undistortRadius(0.5, Number.NaN, 0)).toBeNull();
    expect(undistortRadius(0.5, 0, Number.POSITIVE_INFINITY)).toBeNull();
    expect(undistortRadius(Number.POSITIVE_INFINITY, 0, 0)).toBeNull();
    expect(undistortRadius(-0.1, 0, 0)).toBeNull();
    // g′ ≤ 0 at the first iterate: 1 + 3·(−1)·1 < 0.
    expect(undistortRadius(1, -1, 0)).toBeNull();
  });

  it("at each lens's 0.05-margin k1 bound every radius up to rMaxUnit converges in ≤ 8 iterations", () => {
    const m = MIN_DISTORTION_SLOPE;
    const rdc = Math.hypot(1920, 1080) / 2742;
    const cases: { lens: LensModel; k1: number; rMax: number }[] = [
      {
        lens: "rectilinear",
        k1: ((m - 1) * (2 + m) ** 2) / (27 * rdc * rdc),
        rMax: (3 * rdc) / (2 + m),
      },
      ...FISHEYES.map((lens) => {
        const rh = horizonRadiusUnit(lens);
        return { lens, k1: (m - 1) / (3 * rh * rh), rMax: rh };
      }),
    ];
    for (const { lens, k1, rMax } of cases) {
      // The model's own rMaxUnit agrees with the closed form.
      const rect = lens === "rectilinear";
      const model = createCameraModel({
        lens,
        calibration: rect
          ? calibration({ k1 })
          : calibration({
              k1,
              altDeg: 90,
              focalPx: 616 / horizonRadiusUnit(lens),
              cxPx: 616,
              cyPx: 616,
            }),
        widthPx: rect ? 3840 : 1232,
        heightPx: rect ? 2160 : 1232,
      });
      expect(Math.abs(model.rMaxUnit - rMax), lens).toBeLessThan(1e-9);
      for (let i = 0; i <= 1000; i++) {
        const r = (rMax * i) / 1000;
        const rd = distort(r, k1, 0);
        const solved = solveUndistortedRadius(rd, k1, 0, 8);
        expect(solved, `${lens} r ${r}`).not.toBeNull();
        expect(Math.abs((solved ?? Number.NaN) - r), `${lens} r ${r}`).toBeLessThan(1e-9);
      }
    }
  });

  it("returns false outside a fisheye's horizon circle and for non-finite input, leaving out untouched", () => {
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: syntheticFisheyeCalibration(1232),
      widthPx: 1232,
      heightPx: 1232,
    });
    const buf = new Float64Array([7, 7, 7]);
    expect(unprojectPixel(model, 5, 5, buf, 1)).toBe(false);
    expect(unprojectPixel(model, Number.NaN, 600, buf, 1)).toBe(false);
    expect(unprojectPixel(model, 600, Number.POSITIVE_INFINITY, buf, 1)).toBe(false);
    expect(Array.from(buf)).toEqual([7, 7, 7]);
    // Just inside the circle: the horizon, written at the offset.
    expect(unprojectPixel(model, 616, 0.001, buf, 1)).toBe(true);
    expect(buf[0]).toBe(7);
    expect(Math.abs((buf[2] ?? Number.NaN) - 0)).toBeLessThan(1e-3);
  });

  it("returns false where Newton has no preimage (a pixel beyond the distortion fold)", () => {
    // k1 −0.3 on the StarCam: g(r) peaks at 0.703, so a corner pixel (r_d 0.803) has no sky.
    const model = createCameraModel({
      lens: "rectilinear",
      calibration: calibration({ k1: -0.3 }),
      widthPx: 3840,
      heightPx: 2160,
    });
    expect(unprojectPixel(model, 0, 0, sky, 0)).toBe(false);
    expect(unprojectPixel(model, 1920 + 100, 1080, sky, 0)).toBe(true);
  });
});
