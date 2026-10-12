// tests/unit/skyHorizon.test.ts — M6 step 9: the skyline's coordinates through the camera model (the zenith fisheye's
// horizon circle, a rectilinear frame's bottom edge, a profile below the horizon) and the layer's two features.
import MultiLineString from "ol/geom/MultiLineString";
import MultiPolygon from "ol/geom/MultiPolygon";
import { describe, expect, it } from "vitest";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  syntheticFisheyeCalibration,
} from "../../src/domain/camera";
import {
  buildSkylineCoords,
  createHorizonLayer,
  writeSkyline,
} from "../../src/map/sky/layers/horizon";

/** The 1024 zenith fisheye: f = 1024/π, roll 180 (north at the bottom of the map, east left). */
const FISHEYE: CameraModel = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

/** The Subaru defaults that fixtures name: az 81.2°, alt 19.6°, roll 0, f 2742, 3840 × 2160. */
const SUBARU_DEFAULTS: Calibration = {
  azDeg: 81.2,
  altDeg: 19.6,
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
};
const SUBARU: CameraModel = createCameraModel({
  lens: "rectilinear",
  calibration: SUBARU_DEFAULTS,
  widthPx: 3840,
  heightPx: 2160,
});

const constant = (deg: number): Float32Array => new Float32Array(360).fill(deg);
const at = (points: number[][] | undefined, i: number): number[] => points?.[i] ?? [];

describe("buildSkylineCoords", () => {
  it("fisheye: f = 1024/π and roll 180 put a 10° skyline's az 0° at [512, 967.111] and az 90° at [56.889, 512]", () => {
    expect(FISHEYE.calibration.focalPx).toBeCloseTo(1024 / Math.PI, 12);
    expect(FISHEYE.calibration.rollDeg).toBe(180);
    const { line, fill } = buildSkylineCoords(FISHEYE, constant(10));
    expect(line).toHaveLength(1); // nothing is culled: one run, az 0 … 360
    const run = line[0];
    expect(run).toHaveLength(361);
    const north = at(run, 0);
    const east = at(run, 90);
    expect(north[0]).toBeCloseTo(512, 3);
    expect(north[1]).toBeCloseTo(967.111, 3);
    expect(east[0]).toBeCloseTo(56.889, 3);
    expect(east[1]).toBeCloseTo(512, 3);
    // The line closes: az 360 is az 0.
    expect(at(run, 360)[0]).toBeCloseTo(north[0] ?? Number.NaN, 9);
    expect(at(run, 360)[1]).toBeCloseTo(north[1] ?? Number.NaN, 9);
    expect(fill).toHaveLength(360);
  });

  it("fisheye: every fill bottom lies on the horizon circle, radius 512 from [512, 512]", () => {
    const profile = new Float32Array(360).map(
      (_, az) => 2 + 30 * Math.abs(Math.sin((az * Math.PI) / 180)),
    );
    const { fill } = buildSkylineCoords(FISHEYE, profile);
    expect(fill).toHaveLength(360);
    for (const [ring] of fill) {
      expect(ring).toHaveLength(5); // top, top′, bottom′, bottom, closing point
      expect(ring?.[4]).toEqual(ring?.[0]);
      for (const i of [2, 3]) {
        const [x = Number.NaN, y = Number.NaN] = at(ring, i);
        expect(Math.abs(Math.hypot(x - 512, y - 512) - 512)).toBeLessThanOrEqual(0.2);
      }
      // The tops are the skyline, inside the circle.
      for (const i of [0, 1]) {
        const [x = Number.NaN, y = Number.NaN] = at(ring, i);
        expect(Math.hypot(x - 512, y - 512)).toBeLessThan(512);
      }
    }
  });

  it("fisheye: a profile entirely below the horizon (Maunakea's sea, −1.93°) gives an empty line and fill", () => {
    expect(buildSkylineCoords(FISHEYE, constant(-1.93))).toEqual({ line: [], fill: [] });
  });

  it("splits the line at culled points and skips their quads (NaN azimuths)", () => {
    const profile = constant(5);
    profile.fill(Number.NaN, 100, 110);
    const { line, fill } = buildSkylineCoords(FISHEYE, profile);
    expect(line.map((run) => run.length)).toEqual([100, 251]); // az 0–99, az 110–360
    expect(fill).toHaveLength(360 - 11); // quads 99 … 109 touch a NaN azimuth
  });

  it("rectilinear (Subaru defaults): the fill reaches past the frame's bottom edge, with no lens-specific code", () => {
    const profile = constant(1.9);
    const { line, fill } = buildSkylineCoords(SUBARU, profile);
    expect(line).toHaveLength(1);
    expect(fill.length).toBeGreaterThan(0);
    let inFrame = 0;
    for (const [ring] of fill) {
      for (const i of [2, 3]) {
        const [x = Number.NaN, y = Number.NaN] = at(ring, i);
        if (x < 0 || x > 3840) continue;
        inFrame += 1;
        expect(y).toBeLessThan(0); // map y = H − v: below the frame's bottom edge
      }
    }
    expect(inFrame).toBeGreaterThan(0);
  });
});

describe("createHorizonLayer and writeSkyline", () => {
  it("holds the fill below the line, empty until a profile, cleared by null", () => {
    const layer = createHorizonLayer();
    const features = layer.getSource()?.getFeatures() ?? [];
    expect(features).toHaveLength(2);
    const line = features.map((f) => f.getGeometry()).find((g) => g instanceof MultiLineString);
    const fill = features.map((f) => f.getGeometry()).find((g) => g instanceof MultiPolygon);
    if (!(line instanceof MultiLineString) || !(fill instanceof MultiPolygon)) {
      throw new Error("missing skyline geometries");
    }
    expect(line.getLineStrings()).toHaveLength(0);
    expect(fill.getPolygons()).toHaveLength(0);

    writeSkyline(layer, FISHEYE, constant(10));
    expect(line.getLineStrings()).toHaveLength(1);
    expect(fill.getPolygons()).toHaveLength(360);
    writeSkyline(layer, FISHEYE, null);
    expect(line.getLineStrings()).toHaveLength(0);
    expect(fill.getPolygons()).toHaveLength(0);
    writeSkyline(layer, null, constant(10)); // no camera model yet
    expect(line.getLineStrings()).toHaveLength(0);
  });
});
