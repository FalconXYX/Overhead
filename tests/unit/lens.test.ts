import { readFileSync } from "node:fs";
import proj4, { type Converter } from "proj4";
import { describe, expect, it } from "vitest";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  distortionValid,
  focalPxForHfov,
  hfovDeg,
  horizonRadiusUnit,
  type LensModel,
  MIN_DISTORTION_SLOPE,
  normalizeCalibration,
  projectAzAltDeg,
  projectBatch,
  syntheticFisheyeCalibration,
  toSkyMapCoord,
  unprojectPixel,
} from "../../src/domain/camera";
import { angularSeparationDeg } from "../../src/domain/geo";
import { mulberry32 } from "../helpers/random";

const SIZE = 1024;
const EPS_PX = 1e-9;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const FISHEYES = [
  "fisheye-equidistant",
  "fisheye-equisolid",
  "fisheye-stereographic",
  "fisheye-orthographic",
] as const satisfies readonly LensModel[];
const ALL_LENSES = ["rectilinear", ...FISHEYES] as const satisfies readonly LensModel[];

/** A StarCam-like rectilinear calibration: 3840 × 2160, f 2742, centred, no distortion. */
function starCam(overrides: Partial<Calibration> = {}): Calibration {
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

/** A 1232² circular fisheye: f = 616/horizonRadiusUnit, so the horizon circle touches the frame edges. */
function fisheyeCal(lens: LensModel, overrides: Partial<Calibration> = {}): Calibration {
  return {
    ...starCam(),
    altDeg: 90,
    focalPx: 616 / horizonRadiusUnit(lens),
    cxPx: 616,
    cyPx: 616,
    ...overrides,
  };
}

/** The synthetic camera's model, with calibration fields overridden. */
function synthetic(overrides: Partial<Calibration> = {}): CameraModel {
  return createCameraModel({
    lens: "fisheye-equidistant",
    calibration: { ...syntheticFisheyeCalibration(SIZE), ...overrides },
    widthPx: SIZE,
    heightPx: SIZE,
  });
}

const out = new Float64Array(2);
const coord = new Float64Array(2);

/** Pixel [u, v] (v down) of (az, alt); throws when culled so a cull never passes as a position. */
function pixel(model: CameraModel, azDeg: number, altDeg: number): [number, number] {
  if (!projectAzAltDeg(model, azDeg, altDeg, out, 0))
    throw new Error(`culled: ${azDeg}, ${altDeg}`);
  return [out[0] ?? Number.NaN, out[1] ?? Number.NaN];
}

/** OpenLayers sky-map coordinate [u, H − v] of (az, alt). */
function mapCoord(model: CameraModel, azDeg: number, altDeg: number): [number, number] {
  const [u, v] = pixel(model, azDeg, altDeg);
  toSkyMapCoord(model, u, v, coord, 0);
  return [coord[0] ?? Number.NaN, coord[1] ?? Number.NaN];
}

function expectNear(actual: readonly number[], expected: readonly number[], eps: number): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect(Math.abs((actual[i] ?? Number.NaN) - e)).toBeLessThan(eps);
  });
}

describe("syntheticFisheyeCalibration", () => {
  it("puts the horizon on the image edge: f = (W/2)/(π/2)", () => {
    const c = syntheticFisheyeCalibration(SIZE);
    expect(Math.abs(c.focalPx - 325.949)).toBeLessThan(0.001);
    expect(Math.abs(c.focalPx - 325.94932345220167)).toBeLessThan(1e-9);
  });

  it("is a zenith fisheye at roll 180° centred on W/2 with no distortion", () => {
    expect(syntheticFisheyeCalibration(SIZE)).toEqual({
      azDeg: 0,
      altDeg: 90,
      rollDeg: 180,
      focalPx: 512 / (Math.PI / 2),
      cxPx: 512,
      cyPx: 512,
      k1: 0,
      k2: 0,
      flipX: false,
      streamDelayMs: 0,
      rmsDeg: null,
      updatedAtMs: 0,
    });
  });

  it("equals the committed synthetic-maunakea defaults in cameras.json (except updatedAtMs)", () => {
    const cameras = JSON.parse(
      readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
    ) as { id: string; imageSize: { widthPx: number; heightPx: number }; defaults: Calibration }[];
    const camera = cameras.find((c) => c.id === "synthetic-maunakea");
    expect(camera).toBeDefined();
    expect(camera?.imageSize).toEqual({ widthPx: SIZE, heightPx: SIZE });
    const committed = camera?.defaults as Calibration;
    const expected = syntheticFisheyeCalibration(SIZE);
    expect(Object.keys(committed).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected) as (keyof Calibration)[]) {
      if (key === "updatedAtMs") continue;
      const want = expected[key];
      const got = committed[key];
      if (typeof want === "number") {
        // focalPx must be the full double 325.94932345220167, not a rounded value.
        expect(typeof got, key).toBe("number");
        expect(Math.abs((got as number) - want), key).toBeLessThan(1e-9);
      } else {
        expect(got, key).toBe(want);
      }
    }
  });
});

describe("horizonRadiusUnit", () => {
  it("r/f at the horizon of each zenith lens", () => {
    const cases: readonly (readonly [LensModel, number])[] = [
      ["fisheye-equidistant", Math.PI / 2],
      ["fisheye-equisolid", Math.SQRT2],
      ["fisheye-stereographic", 2],
      ["fisheye-orthographic", 1],
      ["rectilinear", Number.POSITIVE_INFINITY],
    ];
    for (const [lens, r] of cases) expect(horizonRadiusUnit(lens), lens).toBe(r);
  });
});

describe("createCameraModel", () => {
  it("the synthetic camera: zenith-locked, culls below the horizon, rMaxUnit capped at π/2", () => {
    const model = synthetic();
    expect(model.lens).toBe("fisheye-equidistant");
    expect(model.widthPx).toBe(SIZE);
    expect(model.heightPx).toBe(SIZE);
    expect(model.calibration).toEqual(syntheticFisheyeCalibration(SIZE));
    expect(model.zenithLocked).toBe(true);
    expect(model.thetaMaxRad).toBe(Math.PI / 2);
    // r_corner = hypot(512, 512)/f = 2.2214 > π/2.
    expect(Math.hypot(512, 512) / syntheticFisheyeCalibration(SIZE).focalPx).toBeCloseTo(2.2214, 4);
    expect(model.rMaxUnit).toBe(Math.PI / 2);
  });

  it("rMaxUnit is the largest corner radius when the corners lie inside the horizon", () => {
    // Off-centre principal point: the farthest corner is (1024, 1024).
    const model = synthetic({ focalPx: 1000, cxPx: 400, cyPx: 300 });
    expect(Math.abs(model.rMaxUnit - Math.hypot(624, 724) / 1000)).toBeLessThan(1e-15);
  });

  it("[M4] builds every lens and pose; zenithLocked only for a fisheye at altDeg 90", () => {
    const calibration = syntheticFisheyeCalibration(SIZE);
    const base = { widthPx: SIZE, heightPx: SIZE };
    for (const lens of ALL_LENSES) {
      const zenith = createCameraModel({ ...base, lens, calibration });
      expect(zenith.zenithLocked, lens).toBe(lens !== "rectilinear");
      expect(zenith.thetaMaxRad, lens).toBe(Math.PI / 2);
      const tilted = createCameraModel({
        ...base,
        lens,
        calibration: { ...calibration, altDeg: 88.26 },
      });
      expect(tilted.zenithLocked, lens).toBe(false);
      expect(tilted.thetaMaxRad, lens).toBe(Math.PI / 2);
    }
  });

  it("[M4] rectilinear rMaxUnit is the undistorted corner radius, NaN when the corner has no preimage", () => {
    const base = { lens: "rectilinear" as const, widthPx: 3840, heightPx: 2160 };
    const plain = createCameraModel({ ...base, calibration: starCam() });
    expect(Math.abs(plain.rMaxUnit - Math.hypot(1920, 1080) / 2742)).toBeLessThan(1e-15);
    // k1 0.05: r_u (1 + 0.05 r_u²) = r_dc.
    const pincushion = createCameraModel({ ...base, calibration: starCam({ k1: 0.05 }) });
    const r = pincushion.rMaxUnit;
    expect(Math.abs(r * (1 + 0.05 * r * r) - Math.hypot(1920, 1080) / 2742)).toBeLessThan(1e-12);
    expect(r).toBeLessThan(plain.rMaxUnit);
    // k1 −0.3: g(r) = r − 0.3 r³ peaks at 0.703 < r_dc 0.803, so the corner has no preimage.
    const folded = createCameraModel({ ...base, calibration: starCam({ k1: -0.3 }) });
    expect(Number.isNaN(folded.rMaxUnit)).toBe(true);
  });

  it("[M4] fisheye rMaxUnit = min(horizon radius, undistorted corner radius), ∞ when the corner has no preimage", () => {
    for (const lens of FISHEYES) {
      const rh = horizonRadiusUnit(lens);
      // Circular fisheye: the corners lie outside the image circle.
      const circle = createCameraModel({
        lens,
        calibration: fisheyeCal(lens, { k1: -0.05 }),
        widthPx: 1232,
        heightPx: 1232,
      });
      expect(circle.rMaxUnit, lens).toBe(rh);
      // Long focal length: the frame lies inside the horizon circle.
      const narrow = createCameraModel({
        lens,
        calibration: fisheyeCal(lens, { focalPx: 2000 }),
        widthPx: 1232,
        heightPx: 1232,
      });
      expect(Math.abs(narrow.rMaxUnit - Math.hypot(616, 616) / 2000), lens).toBeLessThan(1e-15);
      // A fold before the corner: undistortRadius is null, so the cap is the horizon radius.
      const folded = createCameraModel({
        lens,
        calibration: fisheyeCal(lens, { k1: -1 }),
        widthPx: 1232,
        heightPx: 1232,
      });
      expect(folded.rMaxUnit, lens).toBe(rh);
    }
  });
});

describe("projectAzAltDeg: zenith equidistant fisheye", () => {
  it("orientation at roll 180°: north at the top and east on the left (the view from below)", () => {
    const model = synthetic();
    expectNear(mapCoord(model, 0, 90), [512, 512], EPS_PX); // zenith
    expectNear(mapCoord(model, 0, 0), [512, 1024], EPS_PX); // N horizon: top
    expectNear(mapCoord(model, 90, 0), [0, 512], EPS_PX); // E: left
    expectNear(mapCoord(model, 180, 0), [512, 0], EPS_PX); // S: bottom
    expectNear(mapCoord(model, 270, 0), [1024, 512], EPS_PX); // W: right
    // The same in image pixels (v down): north is at the top edge, east at the left edge.
    expectNear(pixel(model, 0, 0), [512, 0], EPS_PX);
    expectNear(pixel(model, 90, 0), [0, 512], EPS_PX);
  });

  it("roll 0° puts N at map [512, 0]; flipX at roll 180° puts E at x = 1024", () => {
    expectNear(mapCoord(synthetic({ rollDeg: 0 }), 0, 0), [512, 0], EPS_PX);
    expectNear(mapCoord(synthetic({ rollDeg: 0 }), 90, 0), [1024, 512], EPS_PX);
    const flipped = synthetic({ flipX: true });
    expectNear(mapCoord(flipped, 90, 0), [1024, 512], EPS_PX);
    expectNear(mapCoord(flipped, 0, 0), [512, 1024], EPS_PX);
  });

  it("equidistance: radius = 512 × (90 − alt)/90 px", () => {
    const model = synthetic();
    for (const alt of [0, 10, 30, 45, 60, 89]) {
      for (const az of [0, 37, 90, 200, 333]) {
        const [u, v] = pixel(model, az, alt);
        const r = Math.hypot(u - 512, v - 512);
        expect(Math.abs(r - (512 * (90 - alt)) / 90), `az ${az} alt ${alt}`).toBeLessThan(EPS_PX);
      }
    }
  });

  it("culls below the horizon and non-finite input; the horizon itself projects", () => {
    const model = synthetic();
    expect(projectAzAltDeg(model, 0, -0.001, out, 0)).toBe(false);
    expect(projectAzAltDeg(model, 0, 0, out, 0)).toBe(true);
    expect(projectAzAltDeg(model, 0, Number.NaN, out, 0)).toBe(false);
    expect(projectAzAltDeg(model, Number.NaN, 45, out, 0)).toBe(false);
    expect(projectAzAltDeg(model, Number.POSITIVE_INFINITY, 45, out, 0)).toBe(false);
    expect(projectAzAltDeg(model, 0, Number.POSITIVE_INFINITY, out, 0)).toBe(false);
    expect(projectAzAltDeg(model, 0, Number.NEGATIVE_INFINITY, out, 0)).toBe(false);
    expect(projectAzAltDeg(model, 0, 90.001, out, 0)).toBe(false);
  });

  it("a cull leaves out untouched and a hit writes at the offset", () => {
    const model = synthetic();
    const buf = new Float64Array([7, 7, 7, 7]);
    expect(projectAzAltDeg(model, 0, -5, buf, 2)).toBe(false);
    expect(Array.from(buf)).toEqual([7, 7, 7, 7]);
    expect(projectAzAltDeg(model, 0, 90, buf, 2)).toBe(true);
    expectNear(Array.from(buf), [7, 7, 512, 512], EPS_PX);
  });

  it("culls beyond 1.05 rMaxUnit when the frame is smaller than the horizon circle", () => {
    // f 1000: rMaxUnit = hypot(512, 512)/1000 = 0.7241 rad, so the cut is at θ = 0.7603 rad (43.56°).
    const model = synthetic({ focalPx: 1000 });
    expect(projectAzAltDeg(model, 0, 90 - 43, out, 0)).toBe(true);
    expect(projectAzAltDeg(model, 0, 90 - 44, out, 0)).toBe(false);
  });

  it("matches proj4 aeqd (lat_0 = 90) at roll 0° for 50 seeded points", () => {
    const toAeqd = proj4(
      "+proj=longlat +R=1 +no_defs",
      "+proj=aeqd +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +R=1 +no_defs",
    );
    const model = synthetic({ rollDeg: 0 });
    const { focalPx: f, cxPx: cx, cyPx: cy } = model.calibration;
    const rand = mulberry32(20261011);
    for (let i = 0; i < 50; i += 1) {
      const az = rand() * 360;
      const alt = rand() * 90;
      const [x, y] = toAeqd.forward([az, alt]);
      const [u, v] = pixel(model, az, alt);
      expect(Math.abs((u - cx) / f - (x ?? Number.NaN)), `x at ${az}, ${alt}`).toBeLessThan(1e-9);
      expect(Math.abs(-(v - cy) / f - (y ?? Number.NaN)), `y at ${az}, ${alt}`).toBeLessThan(1e-9);
    }
  });
});

describe("projectBatch", () => {
  it("projects [az, alt] pairs into caller-owned arrays and counts the visible ones", () => {
    const model = synthetic();
    const azAlt = new Float32Array([0, 0, 90, -5, 180, 45]);
    const uv = new Float32Array(6);
    const visible = new Uint8Array([9, 9, 9]);
    expect(projectBatch(model, azAlt, 3, uv, visible)).toBe(2);
    expect(Array.from(visible)).toEqual([1, 0, 1]);
    expectNear([uv[0] ?? Number.NaN, uv[1] ?? Number.NaN], [512, 0], 1e-3);
    expectNear([uv[4] ?? Number.NaN, uv[5] ?? Number.NaN], [512, 768], 1e-3);
  });

  it("stops at count and accepts Float64 arrays", () => {
    const model = synthetic();
    const azAlt = new Float64Array([180, 45, 0, 0]);
    const uv = new Float64Array([1, 1, 1, 1]);
    const visible = new Uint8Array([5, 5]);
    expect(projectBatch(model, azAlt, 1, uv, visible)).toBe(1);
    expect(Array.from(visible)).toEqual([1, 5]);
    expectNear(Array.from(uv), [512, 768, 1, 1], EPS_PX);
  });
});

describe("toSkyMapCoord", () => {
  it("writes [u, H − v] at the offset, into typed or plain arrays", () => {
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: syntheticFisheyeCalibration(1232),
      widthPx: 1232,
      heightPx: 1232,
    });
    const typed = new Float64Array(4);
    toSkyMapCoord(model, 100.5, 200.25, typed, 2);
    expect(Array.from(typed)).toEqual([0, 0, 100.5, 1031.75]);
    const plain = [0, 0];
    toSkyMapCoord(model, 0, 0, plain, 0);
    expect(plain).toEqual([0, 1232]);
  });
});

// ---- M4: every lens, any pointing, the shared tail, culls, HFOV, distortion limits, normalizeCalibration.

const SKY = "+proj=longlat +R=1 +no_defs";
const PROJ: Record<LensModel, string> = {
  rectilinear: "gnom",
  "fisheye-equidistant": "aeqd",
  "fisheye-equisolid": "laea",
  "fisheye-stereographic": "stere",
  "fisheye-orthographic": "ortho",
};
const converters = new Map<string, Converter>();

/** proj4's converter for an optical axis at (axisAzDeg, axisAltDeg); a zenith-locked fisheye passes (0, 90). */
function proj4Lens(lens: LensModel, axisAzDeg: number, axisAltDeg: number): Converter {
  // gnom and laea return NaN unless both +x_0=0 and +y_0=0 are given (gotcha G2).
  const def = `+proj=${PROJ[lens]} +lat_0=${axisAltDeg} +lon_0=${axisAzDeg} +x_0=0 +y_0=0 +R=1 +no_defs`;
  let conv = converters.get(def);
  if (conv === undefined) {
    conv = proj4(SKY, def);
    converters.set(def, conv);
  }
  return conv;
}

/** proj4's unit-focal (x right, y up) for an optical axis at (axisAzDeg, axisAltDeg). */
function proj4UnitXY(
  lens: LensModel,
  axisAzDeg: number,
  axisAltDeg: number,
  azDeg: number,
  altDeg: number,
): [number, number] {
  return proj4Lens(lens, axisAzDeg, axisAltDeg).forward<[number, number]>([azDeg, altDeg]);
}

/** [az, alt] of the direction θ from the axis (A₀, h₀) at position angle φ (from image-right toward image-up). */
function directionAround(
  axisAzDeg: number,
  axisAltDeg: number,
  thetaRad: number,
  phiRad: number,
): [number, number] {
  const a0 = axisAzDeg * D2R;
  const h0 = axisAltDeg * D2R;
  const F = [Math.cos(h0) * Math.sin(a0), Math.cos(h0) * Math.cos(a0), Math.sin(h0)] as const;
  const right = [Math.cos(a0), -Math.sin(a0), 0] as const;
  const up = [-Math.sin(h0) * Math.sin(a0), -Math.sin(h0) * Math.cos(a0), Math.cos(h0)] as const;
  const ct = Math.cos(thetaRad);
  const st = Math.sin(thetaRad);
  const d = [0, 1, 2].map(
    (i) =>
      ct * (F[i] ?? 0) +
      st * (Math.cos(phiRad) * (right[i] ?? 0) + Math.sin(phiRad) * (up[i] ?? 0)),
  );
  const [e = 0, n = 0, u = 0] = d;
  const az = Math.atan2(e, n) * R2D;
  return [az < 0 ? az + 360 : az, Math.atan2(u, Math.hypot(e, n)) * R2D];
}

/** Largest pixel distance between two models over the points both project. */
function maxShiftPx(a: CameraModel, b: CameraModel, points: readonly [number, number][]): number {
  const pa = new Float64Array(2);
  const pb = new Float64Array(2);
  let worst = 0;
  let both = 0;
  for (const [az, alt] of points) {
    if (projectAzAltDeg(a, az, alt, pa, 0) && projectAzAltDeg(b, az, alt, pb, 0)) {
      both++;
      worst = Math.max(worst, Math.hypot((pa[0] ?? 0) - (pb[0] ?? 0), (pa[1] ?? 0) - (pb[1] ?? 0)));
    }
  }
  expect(both).toBeGreaterThan(points.length / 2);
  return worst;
}

const CROSS_CHECK_POSES: readonly (readonly [number, number])[] = [
  [81.2, 19.6],
  [270, 20],
  [0, 0],
  [180, 45],
  [300, -5],
  [123.4, 67.8],
  [200, 80],
  [37, 86.3],
];

describe("[M4] projectAzAltDeg: closed forms vs proj4", () => {
  it("matches gnom, aeqd, laea, stere and ortho at every cross-check pose, 50 points each", () => {
    const rand = mulberry32(20261011);
    const p = new Float64Array(2);
    const sky = new Float64Array(2);
    let checked = 0;
    let worstRatio = 0;
    for (const lens of ALL_LENSES) {
      const poses =
        lens === "rectilinear" ? CROSS_CHECK_POSES : [...CROSS_CHECK_POSES, [0, 90] as const];
      for (const [axisAz, axisAlt] of poses) {
        const rect = lens === "rectilinear";
        const calibration = rect
          ? starCam({ azDeg: axisAz, altDeg: axisAlt })
          : fisheyeCal(lens, { azDeg: axisAz, altDeg: axisAlt });
        const model = createCameraModel({
          lens,
          calibration,
          widthPx: rect ? 3840 : 1232,
          heightPx: rect ? 2160 : 1232,
        });
        expect(model.zenithLocked).toBe(!rect && axisAlt === 90);
        const { focalPx: f, cxPx: cx, cyPx: cy } = calibration;
        for (let i = 0; i < 50; i++) {
          let az: number;
          let alt: number;
          if (rect) {
            // Uniform pixels of the 3840 × 2160 frame, unprojected.
            expect(unprojectPixel(model, rand() * 3840, rand() * 2160, sky, 0)).toBe(true);
            az = sky[0] ?? Number.NaN;
            alt = sky[1] ?? Number.NaN;
          } else {
            // Uniform on the sphere within 90° of the axis.
            [az, alt] = directionAround(
              axisAz,
              axisAlt,
              Math.acos(1 - rand()),
              rand() * 2 * Math.PI,
            );
          }
          expect(projectAzAltDeg(model, az, alt, p, 0), `${lens} ${az} ${alt}`).toBe(true);
          const x = ((p[0] ?? Number.NaN) - cx) / f;
          const y = (cy - (p[1] ?? Number.NaN)) / f;
          const [px, py] = proj4UnitXY(lens, axisAz, axisAlt, az, alt);
          const bound = 1e-12 * Math.max(1, Math.hypot(px, py));
          const err = Math.hypot(x - px, y - py);
          expect(err, `${lens} (${axisAz}, ${axisAlt}) at ${az}, ${alt}`).toBeLessThanOrEqual(
            bound,
          );
          worstRatio = Math.max(worstRatio, err / bound);
          // proj4's inverse returns the sample.
          const [lon, lat] = proj4Lens(lens, axisAz, axisAlt).inverse<[number, number]>([px, py]);
          expect(angularSeparationDeg(az, alt, lon, lat)).toBeLessThan(1e-9);
          checked++;
        }
      }
    }
    expect(checked).toBe(2200);
    expect(worstRatio).toBeLessThan(1);
  });
});

describe("[M4] projectAzAltDeg: orientation", () => {
  it("west-facing rectilinear (az₀ 270, alt₀ 20, f 2742): az right, alt up", () => {
    const model = createCameraModel({
      lens: "rectilinear",
      calibration: starCam({ azDeg: 270, altDeg: 20 }),
      widthPx: 3840,
      heightPx: 2160,
    });
    expectNear(pixel(model, 300, 20), [3381.18, 946.092], 1e-3);
    expect(Math.abs(pixel(model, 240, 20)[0] - 458.82)).toBeLessThan(1e-3);
    expect(Math.abs(pixel(model, 270, 40)[1] - 81.994)).toBeLessThan(1e-3);
    expectNear(pixel(model, 270, 20), [1920, 1080], 1e-9); // the axis lands on the principal point
  });

  it("zenith fisheye at alt 0 exactly: N, E, S, W on the frame edges; flipX swaps E and W (S projects: G1)", () => {
    for (const lens of FISHEYES) {
      const model = createCameraModel({
        lens,
        calibration: {
          ...syntheticFisheyeCalibration(SIZE),
          focalPx: 512 / horizonRadiusUnit(lens),
        },
        widthPx: SIZE,
        heightPx: SIZE,
      });
      expectNear(pixel(model, 0, 0), [512, 0], EPS_PX);
      expectNear(pixel(model, 90, 0), [0, 512], EPS_PX);
      expectNear(pixel(model, 180, 0), [512, 1024], EPS_PX);
      expectNear(pixel(model, 270, 0), [1024, 512], EPS_PX);
      expectNear(mapCoord(model, 0, 0), [512, 1024], EPS_PX);
      expectNear(mapCoord(model, 90, 0), [0, 512], EPS_PX);
      expectNear(mapCoord(model, 180, 0), [512, 0], EPS_PX);
      expectNear(mapCoord(model, 270, 0), [1024, 512], EPS_PX);
      const flipped = createCameraModel({
        ...model,
        calibration: { ...model.calibration, flipX: true },
      });
      expectNear(pixel(flipped, 90, 0), [1024, 512], EPS_PX);
      expectNear(pixel(flipped, 270, 0), [0, 512], EPS_PX);
      expectNear(pixel(flipped, 0, 0), [512, 0], EPS_PX);
    }
  });

  it("a zenith-locked fisheye ignores azDeg: (A₀, 90, ρ) projects like (0, 90, ρ)", () => {
    const locked = synthetic({ azDeg: 37 });
    const plain = synthetic();
    expect(locked.zenithLocked).toBe(true);
    for (const [az, alt] of [
      [0, 0],
      [37, 10],
      [200, 45],
      [300, 80],
    ] as const) {
      expectNear(pixel(locked, az, alt), pixel(plain, az, alt), EPS_PX);
    }
  });

  it("a tilted fisheye puts its axis on the principal point and tips the zenith away from it", () => {
    // Nānā ao-like: tilted 1.74° toward az 227.3, flipX.
    const c = { ...syntheticFisheyeCalibration(1232), azDeg: 227.3, altDeg: 88.26, rollDeg: 44.8 };
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: { ...c, focalPx: 373.1, cxPx: 619.6, cyPx: 609.8, k1: 0.003, flipX: true },
      widthPx: 1232,
      heightPx: 1232,
    });
    expect(model.zenithLocked).toBe(false);
    expectNear(pixel(model, 227.3, 88.26), [619.6, 609.8], 1e-9);
    const [u, v] = pixel(model, 0, 90);
    const rUnit = Math.hypot(u - 619.6, v - 609.8) / 373.1;
    // r_d = θ (1 + k1 θ²) with θ = 1.74°.
    const theta = 1.74 * D2R;
    expect(Math.abs(rUnit - theta * (1 + 0.003 * theta * theta))).toBeLessThan(1e-12);
  });

  it("roll turns the image counter-clockwise in unit-focal (x right, y up) coordinates", () => {
    const base = starCam({ azDeg: 90, altDeg: 0 });
    const model0 = createCameraModel({
      lens: "rectilinear",
      calibration: base,
      widthPx: 3840,
      heightPx: 2160,
    });
    const model30 = createCameraModel({
      lens: "rectilinear",
      calibration: { ...base, rollDeg: 30 },
      widthPx: 3840,
      heightPx: 2160,
    });
    const [u0, v0] = pixel(model0, 100, 0); // on the image-right axis
    const x0 = (u0 - 1920) / 2742;
    expect(Math.abs((v0 - 1080) / 2742)).toBeLessThan(1e-15);
    const [u1, v1] = pixel(model30, 100, 0);
    expect(Math.abs((u1 - 1920) / 2742 - x0 * Math.cos(30 * D2R))).toBeLessThan(1e-12);
    expect(Math.abs((1080 - v1) / 2742 - x0 * Math.sin(30 * D2R))).toBeLessThan(1e-12);
  });

  it("distortion scales the rolled unit-focal radius by 1 + k1 r² + k2 r⁴ on every lens", () => {
    for (const lens of ALL_LENSES) {
      const rect = lens === "rectilinear";
      const c = rect
        ? starCam({ azDeg: 10, altDeg: 30 })
        : fisheyeCal(lens, { azDeg: 10, altDeg: 70 });
      const size = rect ? [3840, 2160] : [1232, 1232];
      const make = (k1: number, k2: number) =>
        createCameraModel({
          lens,
          calibration: { ...c, k1, k2, rollDeg: 25, flipX: true },
          widthPx: size[0] ?? 0,
          heightPx: size[1] ?? 0,
        });
      const ideal = make(0, 0);
      const distorted = make(0.02, -0.004);
      const [u0, v0] = pixel(ideal, 25, 35);
      const [u1, v1] = pixel(distorted, 25, 35);
      const x = (u0 - c.cxPx) / c.focalPx;
      const y = (v0 - c.cyPx) / c.focalPx;
      const r2 = x * x + y * y;
      const s = 1 + 0.02 * r2 - 0.004 * r2 * r2;
      expectNear([u1, v1], [c.cxPx + s * (u0 - c.cxPx), c.cyPx + s * (v0 - c.cyPx)], 1e-9);
    }
  });
});

describe("[M4] projectAzAltDeg: culls", () => {
  const out2 = new Float64Array(2);

  it("zenith fisheye: alt 0 projects, −0.001 does not; orthographic alt −30 is culled (it would fold onto +30)", () => {
    for (const lens of FISHEYES) {
      const model = createCameraModel({
        lens,
        calibration: fisheyeCal(lens),
        widthPx: 1232,
        heightPx: 1232,
      });
      expect(projectAzAltDeg(model, 180, 0, out2, 0), lens).toBe(true);
      expect(projectAzAltDeg(model, 180, -0.001, out2, 0), lens).toBe(false);
      expect(projectAzAltDeg(model, 37, -30, out2, 0), lens).toBe(false);
    }
  });

  it("a tilted fisheye culls by the angle from its axis (θ > π/2), not by altitude", () => {
    const model = createCameraModel({
      lens: "fisheye-orthographic",
      calibration: fisheyeCal("fisheye-orthographic", { azDeg: 0, altDeg: 30 }),
      widthPx: 1232,
      heightPx: 1232,
    });
    expect(projectAzAltDeg(model, 0, -50, out2, 0)).toBe(true); // 80° from the axis
    expect(projectAzAltDeg(model, 0, -61, out2, 0)).toBe(false); // 91°
    expect(projectAzAltDeg(model, 180, 61, out2, 0)).toBe(true); // 89° over the zenith
    expect(projectAzAltDeg(model, 180, 59, out2, 0)).toBe(false); // 91°
  });

  it("rectilinear: behind the camera and at 90° from the axis are culled; outside the frame too", () => {
    const model = createCameraModel({
      lens: "rectilinear",
      calibration: starCam({ azDeg: 90, altDeg: 10 }),
      widthPx: 3840,
      heightPx: 2160,
    });
    expect(projectAzAltDeg(model, 90, 10, out2, 0)).toBe(true);
    expect(projectAzAltDeg(model, 270, -10, out2, 0)).toBe(false); // the antipode
    expect(projectAzAltDeg(model, 270, 30, out2, 0)).toBe(false);
    expect(projectAzAltDeg(model, 0, 0, out2, 0)).toBe(false); // exactly 90° from the axis
    expect(projectAzAltDeg(model, 150, 10, out2, 0)).toBe(false); // in front, but far outside the frame
  });

  it("non-finite input and |alt| > 90 return false and leave out untouched", () => {
    const buf = new Float64Array([7, 7]);
    for (const lens of ALL_LENSES) {
      const rect = lens === "rectilinear";
      const model = createCameraModel({
        lens,
        calibration: rect ? starCam({ altDeg: 45 }) : fisheyeCal(lens),
        widthPx: rect ? 3840 : 1232,
        heightPx: rect ? 2160 : 1232,
      });
      for (const [az, alt] of [
        [Number.NaN, 45],
        [0, Number.NaN],
        [Number.POSITIVE_INFINITY, 45],
        [0, Number.NEGATIVE_INFINITY],
        [0, 90.001],
        [0, -90.001],
      ] as const) {
        expect(projectAzAltDeg(model, az, alt, buf, 0), `${lens} ${az} ${alt}`).toBe(false);
      }
    }
    expect(Array.from(buf)).toEqual([7, 7]);
  });

  it("a rectilinear model whose corner has no preimage (rMaxUnit NaN) projects nothing", () => {
    const model = createCameraModel({
      lens: "rectilinear",
      calibration: starCam({ k1: -0.3 }),
      widthPx: 3840,
      heightPx: 2160,
    });
    expect(projectAzAltDeg(model, 0, 0, out2, 0)).toBe(false);
  });
});

describe("[M4] projectBatch", () => {
  it("runs the same arithmetic as projectAzAltDeg on a tilted, rolled, distorted, flipped camera", () => {
    const model = createCameraModel({
      lens: "fisheye-stereographic",
      calibration: fisheyeCal("fisheye-stereographic", {
        azDeg: 140,
        altDeg: 60,
        rollDeg: -70,
        k1: 0.01,
        k2: -0.001,
        flipX: true,
      }),
      widthPx: 1232,
      heightPx: 1232,
    });
    const rand = mulberry32(20261011);
    const n = 500;
    const azAlt = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      azAlt[2 * i] = rand() * 360;
      azAlt[2 * i + 1] = rand() * 180 - 90;
    }
    const uv = new Float64Array(2 * n);
    const visible = new Uint8Array(n);
    const count = projectBatch(model, azAlt, n, uv, visible);
    let expected = 0;
    for (let i = 0; i < n; i++) {
      const hit = projectAzAltDeg(model, azAlt[2 * i] ?? 0, azAlt[2 * i + 1] ?? 0, out, 0);
      expect(visible[i]).toBe(hit ? 1 : 0);
      if (hit) {
        expected++;
        expect(uv[2 * i]).toBe(out[0]);
        expect(uv[2 * i + 1]).toBe(out[1]);
      }
    }
    expect(count).toBe(expected);
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(n);
  });
});

describe("[M4] hfovDeg and focalPxForHfov", () => {
  it("rectilinear StarCam: 70.0009° at f 2742; f 2742.044 for 70°", () => {
    expect(Math.abs(hfovDeg("rectilinear", 3840, 2742) - 70.0009)).toBeLessThan(1e-4);
    expect(Math.abs(focalPxForHfov("rectilinear", 3840, 70) - 2742.044)).toBeLessThan(1e-3);
  });

  it("f for 180° at W 1232: 392.158, 435.578, 308, 616", () => {
    const cases: readonly (readonly [LensModel, number])[] = [
      ["fisheye-equidistant", 392.158],
      ["fisheye-equisolid", 435.578],
      ["fisheye-stereographic", 308],
      ["fisheye-orthographic", 616],
    ];
    for (const [lens, f] of cases) {
      expect(Math.abs(focalPxForHfov(lens, 1232, 180) - f), lens).toBeLessThan(1e-3);
      expect(
        Math.abs(hfovDeg(lens, 1232, focalPxForHfov(lens, 1232, 180)) - 180),
        lens,
      ).toBeLessThan(1e-9);
    }
  });

  it("an all-sky lens can exceed 180°: Nānā ao at f 373.1 spans 189.2° across its width", () => {
    expect(Math.abs(hfovDeg("fisheye-equidistant", 1232, 373.1) - 189.2)).toBeLessThan(0.05);
  });

  it("the min clamps cap orthographic at 180° and equisolid at 360°", () => {
    expect(hfovDeg("fisheye-orthographic", 1232, 300)).toBe(180);
    expect(hfovDeg("fisheye-equisolid", 1232, 200)).toBe(360);
  });

  it("f → HFOV → f round-trips to a relative 1e-12 on every lens", () => {
    const rand = mulberry32(20261011);
    for (const lens of ALL_LENSES) {
      for (let i = 0; i < 200; i++) {
        const w = 640 + rand() * 3200;
        const hfov =
          5 + rand() * (lens === "rectilinear" || lens === "fisheye-orthographic" ? 170 : 300);
        const f = focalPxForHfov(lens, w, hfov);
        expect(Math.abs(focalPxForHfov(lens, w, hfovDeg(lens, w, f)) / f - 1), lens).toBeLessThan(
          1e-12,
        );
      }
    }
  });

  it("focalPxForHfov is NaN outside a lens's range of fields", () => {
    expect(Number.isNaN(focalPxForHfov("rectilinear", 3840, 180))).toBe(true);
    expect(Number.isNaN(focalPxForHfov("fisheye-orthographic", 1232, 181))).toBe(true);
    expect(Number.isNaN(focalPxForHfov("fisheye-stereographic", 1232, 360))).toBe(true);
    expect(Number.isNaN(focalPxForHfov("fisheye-equidistant", 1232, 0))).toBe(true);
    expect(Number.isNaN(focalPxForHfov("fisheye-equisolid", 1232, Number.NaN))).toBe(true);
  });
});

describe("[M4] distortionValid", () => {
  it("MIN_DISTORTION_SLOPE is 0.05", () => {
    expect(MIN_DISTORTION_SLOPE).toBe(0.05);
  });

  it("checks g′ = 1 + 3k1r² + 5k2r⁴ ≥ 0.05 at rMaxUnit and at the vertex", () => {
    expect(distortionValid(0, 0, 2)).toBe(true);
    // Linear in r² (k2 = 0): only the edge matters.
    expect(distortionValid(-0.95 / 3 + 1e-9, 0, 1)).toBe(true);
    expect(distortionValid(-0.95 / 3 - 1e-9, 0, 1)).toBe(false);
    // k2 > 0 with the vertex s* = −3k1/(10k2) inside [0, rMax²]: g′(s*) = 1 − 9k1²/(20k2).
    // k1 −1, k2 0.45: s* = 2/3, g′(s*) = 1 − 9/9 = 0 although g′(1) = 1 − 3 + 2.25 = 0.25.
    expect(distortionValid(-1, 0.45, 1)).toBe(false);
    // k2 0.5: s* = 0.6, g′(s*) = 1 − 9/10 = 0.1 passes, and g′(1) = 0.5.
    expect(distortionValid(-1, 0.5, 1)).toBe(true);
    // k2 0.45 with the vertex beyond rMax: g′(0.5²) = 1 − 0.75 + 0.140625 = 0.39.
    expect(distortionValid(-1, 0.45, 0.5)).toBe(true);
    // k2 < 0: concave, the edge decides.
    expect(distortionValid(0.1, -0.2, 1)).toBe(true); // 1 + 0.3 − 1 = 0.3
    expect(distortionValid(0.1, -0.3, 1)).toBe(false); // 1 + 0.3 − 1.5 = −0.2
  });

  it("is false for any non-finite input", () => {
    expect(distortionValid(Number.NaN, 0, 1)).toBe(false);
    expect(distortionValid(0, Number.NaN, 1)).toBe(false);
    expect(distortionValid(0, 0, Number.NaN)).toBe(false);
    expect(distortionValid(0, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(distortionValid(Number.NEGATIVE_INFINITY, 0, 1)).toBe(false);
  });

  /** Smallest k1 (k2 = 0) that createCameraModel + distortionValid accept, by bisection. */
  function k1Floor(valid: (k1: number) => boolean): number {
    let lo = -2; // invalid
    let hi = 0; // valid
    expect(valid(lo)).toBe(false);
    expect(valid(hi)).toBe(true);
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (valid(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  it("k1 bounds (k2 = 0): StarCam −0.22909; 1232² fisheyes −0.12834, −0.15833, −0.07917, −0.31667", () => {
    const m = MIN_DISTORTION_SLOPE;
    const starValid = (k1: number) => {
      const model = createCameraModel({
        lens: "rectilinear",
        calibration: starCam({ k1 }),
        widthPx: 3840,
        heightPx: 2160,
      });
      return distortionValid(k1, 0, model.rMaxUnit);
    };
    const rdc = Math.hypot(1920, 1080) / 2742;
    expect(Math.abs(rdc - 0.80339)).toBeLessThan(1e-5);
    const starBound = k1Floor(starValid);
    expect(Math.abs(starBound - ((m - 1) * (2 + m) ** 2) / (27 * rdc * rdc))).toBeLessThan(1e-5);
    expect(Math.abs(starBound - -0.22909)).toBeLessThan(1e-5);
    expect(starValid(starBound + 1e-6)).toBe(true);
    expect(starValid(starBound - 1e-6)).toBe(false);

    const expected: Record<(typeof FISHEYES)[number], number> = {
      "fisheye-equidistant": -0.12834,
      "fisheye-equisolid": -0.15833,
      "fisheye-stereographic": -0.07917,
      "fisheye-orthographic": -0.31667,
    };
    for (const lens of FISHEYES) {
      const valid = (k1: number) => {
        const model = createCameraModel({
          lens,
          calibration: fisheyeCal(lens, { k1 }),
          widthPx: 1232,
          heightPx: 1232,
        });
        return distortionValid(k1, 0, model.rMaxUnit);
      };
      const bound = k1Floor(valid);
      const rh = horizonRadiusUnit(lens);
      expect(Math.abs(bound - (m - 1) / (3 * rh * rh)), lens).toBeLessThan(1e-5);
      expect(Math.abs(bound - expected[lens]), lens).toBeLessThan(1e-5);
      expect(valid(bound + 1e-6), lens).toBe(true);
      expect(valid(bound - 1e-6), lens).toBe(false);
    }
  });
});

describe("[M4] normalizeCalibration", () => {
  it("clamps altDeg to [−90, 90]; wraps azDeg to [0, 360) and rollDeg to [−180, 180)", () => {
    const c = normalizeCalibration(
      "rectilinear",
      starCam({ azDeg: -30, altDeg: 95, rollDeg: 190 }),
    );
    expect(c.azDeg).toBe(330);
    expect(c.altDeg).toBe(90); // a rectilinear lens is never locked: its azimuth stays
    expect(Math.abs(c.rollDeg - -170)).toBeLessThan(1e-12);
    const low = normalizeCalibration(
      "fisheye-equisolid",
      starCam({ azDeg: 725, altDeg: -100, rollDeg: -200 }),
    );
    expect(low.altDeg).toBe(-90);
    expect(Math.abs(low.azDeg - 5)).toBeLessThan(1e-12);
    expect(Math.abs(low.rollDeg - 160)).toBeLessThan(1e-12);
  });

  it("a fisheye at altDeg 90 folds azDeg into roll: roll − az, az 0; other fields are kept", () => {
    const start = fisheyeCal("fisheye-equidistant", {
      azDeg: 37,
      altDeg: 90,
      rollDeg: 150,
      k1: 0.003,
    });
    const c = normalizeCalibration("fisheye-equidistant", start);
    expect(c.azDeg).toBe(0);
    expect(c.altDeg).toBe(90);
    expect(Math.abs(c.rollDeg - 113)).toBeLessThan(1e-12);
    expect({ ...c, azDeg: 37, rollDeg: 150 }).toEqual(start);
    // Above 90 clamps, then locks.
    const over = normalizeCalibration("fisheye-orthographic", { ...start, altDeg: 91 });
    expect([over.azDeg, over.altDeg]).toEqual([0, 90]);
    expect(Math.abs(over.rollDeg - 113)).toBeLessThan(1e-12);
    // The synthetic camera: updateCalibration({ azDeg: 37 }) gives roll wrap180(180 − 37) = 143.
    const synth = normalizeCalibration("fisheye-equidistant", {
      ...syntheticFisheyeCalibration(1024),
      azDeg: 37,
    });
    expect(synth.azDeg).toBe(0);
    expect(Math.abs(synth.rollDeg - 143)).toBeLessThan(1e-12);
  });

  it("locking (37, 89.9999, 150) at f 375 moves the image ≤ 1e-3 px; then 90 → 89.95 moves it ≤ 0.5 px", () => {
    const rand = mulberry32(20261011);
    const points: [number, number][] = [];
    for (let i = 0; i < 2000; i++) {
      // Uniform on the sky above alt 1°, clear of the tilted horizon.
      points.push([rand() * 360, Math.asin(Math.sin(D2R) + rand() * (1 - Math.sin(D2R))) * R2D]);
    }
    const lens = "fisheye-equidistant";
    const model = (c: Calibration) =>
      createCameraModel({ lens, calibration: c, widthPx: 1232, heightPx: 1232 });
    const nearZenith = fisheyeCal(lens, { azDeg: 37, altDeg: 89.9999, rollDeg: 150, focalPx: 375 });
    const locked = normalizeCalibration(lens, { ...nearZenith, altDeg: 90 });
    expect(locked.azDeg).toBe(0);
    expect(locked.altDeg).toBe(90);
    expect(Math.abs(locked.rollDeg - 113)).toBeLessThan(1e-12);
    expect(maxShiftPx(model(nearZenith), model(locked), points)).toBeLessThanOrEqual(1e-3);
    // The ↓ nudge from the normalized state: a small tilt, not a 37° turn.
    const nudged = normalizeCalibration(lens, { ...locked, altDeg: 89.95 });
    expect(nudged.azDeg).toBe(0);
    expect(maxShiftPx(model(locked), model(nudged), points)).toBeLessThanOrEqual(0.5);
    // Keeping the stale azimuth instead would turn the image by 37° when it unlocks.
    const stale = { ...nearZenith, altDeg: 90 };
    expect(maxShiftPx(model(stale), model({ ...stale, altDeg: 89.95 }), points)).toBeGreaterThan(
      300,
    );
  });

  it("returns a new object and never edits its input", () => {
    const start = starCam({ azDeg: 400 });
    const frozen = Object.freeze({ ...start });
    const c = normalizeCalibration("rectilinear", frozen);
    expect(c).not.toBe(frozen);
    expect(frozen.azDeg).toBe(400);
  });
});

describe("[M9] projectAzAltDeg: the trigonometry-free pre-cull", () => {
  // c ≥ |h − h₀|: a direction more than 90° (+1e-6°) in altitude from the axis is more than 90° from the axis.
  const rand = mulberry32(20261011);
  const cases: [string, LensModel, Partial<Calibration>][] = [
    ["zenith fisheye", "fisheye-equidistant", {}],
    ["tilted fisheye", "fisheye-equisolid", { azDeg: 81, altDeg: 20 }],
    ["fisheye looking down", "fisheye-stereographic", { azDeg: 200, altDeg: -40 }],
  ];
  it.each(cases)(
    "%s: every pre-culled direction is more than 90° from the axis, and is culled",
    (_name, lens, cal) => {
      const model = createCameraModel({
        lens,
        calibration: fisheyeCal(lens, cal),
        widthPx: 1232,
        heightPx: 1232,
      });
      const axisAz = model.zenithLocked ? 0 : model.calibration.azDeg;
      const axisAlt = model.zenithLocked ? 90 : model.calibration.altDeg;
      const out2 = new Float64Array(2);
      let preCulled = 0;
      for (let k = 0; k < 20_000; k++) {
        const az = 360 * rand();
        const alt = 180 * rand() - 90;
        if (Math.abs(alt - axisAlt) <= 90 + 1e-6) continue;
        preCulled++;
        expect(angularSeparationDeg(az, alt, axisAz, axisAlt)).toBeGreaterThan(90);
        expect(projectAzAltDeg(model, az, alt, out2, 0)).toBe(false);
      }
      if (axisAlt !== 0) expect(preCulled).toBeGreaterThan(0);
    },
  );

  it("leaves the boundary to the full test: a zenith fisheye still projects alt 0 and culls −0.001°", () => {
    const model = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: fisheyeCal("fisheye-equidistant"),
      widthPx: 1232,
      heightPx: 1232,
    });
    const out2 = new Float64Array(2);
    expect(projectAzAltDeg(model, 10, 0, out2, 0)).toBe(true);
    expect(projectAzAltDeg(model, 10, -1e-7, out2, 0)).toBe(false);
    expect(projectAzAltDeg(model, 10, -0.001, out2, 0)).toBe(false);
  });
});
