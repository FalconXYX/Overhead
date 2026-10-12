// tests/unit/coverage.test.ts — frameAzimuthCoverage (M4 step 4, M4 section 5; README fixture "Frame coverage").
import { describe, expect, it } from "vitest";
import {
  type AzimuthCoverage,
  type Calibration,
  type CameraModel,
  createCameraModel,
  frameAzimuthCoverage,
  type LensModel,
  syntheticFisheyeCalibration,
} from "../../src/domain/camera";

function calibration(overrides: Partial<Calibration>): Calibration {
  return {
    azDeg: 90,
    altDeg: 20,
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

/** The 2742 px StarCam-like rectilinear camera of the M4 fixture: 3840 × 2160, az₀ 90°, roll 0 by default. */
function starcam(overrides: Partial<Calibration>): CameraModel {
  return createCameraModel({
    lens: "rectilinear",
    calibration: calibration(overrides),
    widthPx: 3840,
    heightPx: 2160,
  });
}

function expectRange(c: AzimuthCoverage, fromAzDeg: number, toAzDeg: number, tol = 0.05): void {
  expect(c.kind).toBe("range");
  if (c.kind !== "range") return;
  expect(Math.abs(c.fromAzDeg - fromAzDeg), `from ${c.fromAzDeg}`).toBeLessThan(tol);
  expect(Math.abs(c.toAzDeg - toAzDeg), `to ${c.toAzDeg}`).toBeLessThan(tol);
}

describe("frameAzimuthCoverage, rectilinear (f 2742, 3840 × 2160, az₀ 90°)", () => {
  it("gives the HFOV span only at alt₀ 0", () => {
    expectRange(frameAzimuthCoverage(starcam({ altDeg: 0 }), 16), 55.0, 125.0);
  });

  it("widens as the camera tilts up (HFOV is not the azimuth span)", () => {
    expectRange(frameAzimuthCoverage(starcam({ altDeg: 20 }), 16), 48.98, 131.02);
    expectRange(frameAzimuthCoverage(starcam({ altDeg: 45 }), 16), 31.47, 148.53);
    expectRange(frameAzimuthCoverage(starcam({ altDeg: 68 }), 16), 0.77, 179.23);
  });

  it("follows the roll", () => {
    expectRange(frameAzimuthCoverage(starcam({ altDeg: 20, rollDeg: 5 }), 16), 49.79, 131.53);
  });

  it("is full once the zenith is in frame (from alt₀ 68.502°)", () => {
    expect(frameAzimuthCoverage(starcam({ altDeg: 68.6 }), 16)).toEqual({ kind: "full" });
  });

  it("runs clockwise across north", () => {
    expectRange(frameAzimuthCoverage(starcam({ azDeg: 350, altDeg: 20 }), 16), 308.98, 31.02);
  });

  it("gives the Subaru defaults 40.3553–122.0447° (M8 footprint bearings)", () => {
    const subaru = starcam({ azDeg: 81.2, altDeg: 19.6 });
    expectRange(frameAzimuthCoverage(subaru, 16), 40.3553, 122.0447, 0.001);
  });
});

describe("frameAzimuthCoverage, fisheyes", () => {
  it("is full for the zenith fisheye", () => {
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: syntheticFisheyeCalibration(1024),
      widthPx: 1024,
      heightPx: 1024,
    });
    expect(frameAzimuthCoverage(model, 16)).toEqual({ kind: "full" });
  });

  it("is full for a fisheye tilted 2° off the zenith, for every lens", () => {
    const lenses: readonly LensModel[] = [
      "fisheye-equidistant",
      "fisheye-equisolid",
      "fisheye-stereographic",
      "fisheye-orthographic",
    ];
    for (const lens of lenses) {
      const model = createCameraModel({
        lens,
        calibration: { ...syntheticFisheyeCalibration(1024), azDeg: 30, altDeg: 88 },
        widthPx: 1024,
        heightPx: 1024,
      });
      expect(frameAzimuthCoverage(model, 16), lens).toEqual({ kind: "full" });
    }
  });
});

describe("frameAzimuthCoverage, degenerate input", () => {
  it("is full when fewer than 2 boundary samples unproject", () => {
    // NaN focal length: no pixel has a preimage, and the zenith does not project either.
    const broken = starcam({ altDeg: 20, focalPx: Number.NaN });
    expect(frameAzimuthCoverage(broken, 16)).toEqual({ kind: "full" });
  });
});
