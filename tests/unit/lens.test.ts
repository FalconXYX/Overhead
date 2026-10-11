import { readFileSync } from "node:fs";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  horizonRadiusUnit,
  type LensModel,
  projectAzAltDeg,
  projectBatch,
  syntheticFisheyeCalibration,
  toSkyMapCoord,
} from "../../src/domain/camera";
import { mulberry32 } from "../helpers/random";

const SIZE = 1024;
const EPS_PX = 1e-9;

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

  it("throws for any lens or pose other than a zenith equidistant fisheye (until M4)", () => {
    const calibration = syntheticFisheyeCalibration(SIZE);
    const base = { calibration, widthPx: SIZE, heightPx: SIZE };
    for (const lens of [
      "rectilinear",
      "fisheye-equisolid",
      "fisheye-stereographic",
      "fisheye-orthographic",
    ] as const) {
      expect(() => createCameraModel({ ...base, lens }), lens).toThrow();
    }
    expect(() =>
      createCameraModel({
        ...base,
        lens: "fisheye-equidistant",
        calibration: { ...calibration, altDeg: 88.26 },
      }),
    ).toThrow();
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
