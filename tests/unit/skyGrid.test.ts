import type Feature from "ol/Feature";
import type MultiLineString from "ol/geom/MultiLineString";
import Point from "ol/geom/Point";
import CircleStyle from "ol/style/Circle";
import Style from "ol/style/Style";
import { describe, expect, it } from "vitest";
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
} from "../../src/domain/astro";
import {
  type CameraModel,
  createCameraModel,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
} from "../../src/domain/camera";
import {
  type BodiesLayer,
  bodyLabel,
  bodyRadiusPx,
  createBodiesLayer,
  writeBodies,
} from "../../src/map/sky/layers/bodies";
import { buildGridFeatures, createGridLayer } from "../../src/map/sky/layers/grid";
import {
  createStarsLayer,
  setStarCount,
  setStarRadii,
  starRadiusPx,
} from "../../src/map/sky/layers/stars";

const SYNTHETIC: CameraModel = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

function lines(features: readonly Feature[]): MultiLineString {
  const multi = features.filter((f) => f.getGeometry()?.getType() === "MultiLineString");
  expect(multi).toHaveLength(1);
  return multi[0]?.getGeometry() as MultiLineString;
}

function letters(features: readonly Feature[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of features) {
    const g = f.getGeometry();
    if (g instanceof Point) out.set(String(f.get("label")), g.getCoordinates());
  }
  return out;
}

function expectCoord(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toHaveLength(2);
  expect(actual?.[0]).toBeCloseTo(expected[0] ?? Number.NaN, 3);
  expect(actual?.[1]).toBeCloseTo(expected[1] ?? Number.NaN, 3);
}

describe("buildGridFeatures", () => {
  it("synthetic camera: one MultiLineString of 45 polylines (9 circles + 36 lines) and 4 letters", () => {
    const features = buildGridFeatures(SYNTHETIC);
    expect(features).toHaveLength(5);
    const polylines = lines(features).getLineStrings();
    expect(polylines).toHaveLength(45);
    // Circles: alt 0–80 every 10°, az 0–360 every 1° (closed). Lines: az every 10°, alt 0–80 every 1°.
    const sizes = polylines.map((l) => l.getCoordinates().length);
    expect(sizes.filter((n) => n === 361)).toHaveLength(9);
    expect(sizes.filter((n) => n === 81)).toHaveLength(36);
  });

  it("synthetic camera: N, E, S and W at alt 5° in map coordinates (north up, east left)", () => {
    const byLabel = letters(buildGridFeatures(SYNTHETIC));
    expect([...byLabel.keys()].sort()).toEqual(["E", "N", "S", "W"]);
    expectCoord(byLabel.get("N"), [512, 995.556]);
    expectCoord(byLabel.get("E"), [28.444, 512]);
    expectCoord(byLabel.get("S"), [512, 28.444]);
    expectCoord(byLabel.get("W"), [995.556, 512]);
  });

  it("every sample goes through the camera model: the horizon circle starts at N [512, 1024]", () => {
    const polylines = lines(buildGridFeatures(SYNTHETIC)).getLineStrings();
    const horizon = polylines.find((l) => {
      const c = l.getCoordinates();
      return c.length === 361 && Math.abs((c[0]?.[1] ?? 0) - 1024) < 1e-9;
    });
    expect(horizon).toBeDefined();
    const coords = horizon?.getCoordinates() ?? [];
    expectCoord(coords[0], [512, 1024]); // az 0, alt 0
    expectCoord(coords[90], [0, 512]); // az 90 (E) is on the left
    expectCoord(coords[360], [512, 1024]); // closed
  });

  it("splits at culled samples: a 512 px frame with the 1024 px focal length culls below alt 23.2°", () => {
    // rMaxUnit = hypot(256, 256) / 325.949 = 1.1107; the cull radius 1.05 × that is 66.82° from the zenith.
    const small = createCameraModel({
      lens: "fisheye-equidistant",
      calibration: { ...syntheticFisheyeCalibration(1024), cxPx: 256, cyPx: 256 },
      widthPx: 512,
      heightPx: 512,
    });
    const features = buildGridFeatures(small);
    const polylines = lines(features).getLineStrings();
    // Circles at 30–80 survive whole (6); each of the 36 azimuth lines keeps alt 24–80 (57 samples).
    expect(polylines).toHaveLength(42);
    const sizes = polylines.map((l) => l.getCoordinates().length);
    expect(sizes.filter((n) => n === 361)).toHaveLength(6);
    expect(sizes.filter((n) => n === 57)).toHaveLength(36);
    // The letters at alt 5° are culled too.
    expect(letters(features).size).toBe(0);
    for (const l of polylines) {
      for (const [x, y] of l.getCoordinates()) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      }
    }
  });
});

describe("createGridLayer", () => {
  it("is a vector layer over a source without a spatial index, empty until the first camera model", () => {
    const layer = createGridLayer();
    const source = layer.getSource();
    expect(source).not.toBeNull();
    expect(source?.getFeatures()).toHaveLength(0);
    // useSpatialIndex: false keeps the features in a plain collection.
    expect(source?.getFeaturesCollection()).not.toBeNull();
  });

  it("styles are cached: the same Style object for the same feature on every call", () => {
    const layer = createGridLayer();
    const style = layer.getStyleFunction();
    expect(style).toBeDefined();
    for (const f of buildGridFeatures(SYNTHETIC)) {
      const a = style?.(f, 1);
      const b = style?.(f, 2);
      expect(a).toBeDefined();
      expect(a).toBe(b);
    }
  });
});

// The other two sky layers' formulas (M2 step 8.4, 8.5): no separate test file is listed for them in section 5.
describe("stars layer", () => {
  it("starRadiusPx is monotonic: a brighter star is never smaller; finite and positive", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let v = -1.5; v <= 6.5 + 1e-9; v += 0.01) {
      const r = starRadiusPx(v);
      expect(Number.isFinite(r) && r > 0).toBe(true);
      expect(r).toBeLessThanOrEqual(previous);
      previous = r;
    }
    expect(starRadiusPx(-1.46)).toBeGreaterThan(starRadiusPx(6.5));
    expect(Number.isFinite(starRadiusPx(Number.NaN))).toBe(true);
  });

  it("setStarCount resizes the MultiPoint to the prefix and hides every star until the next pass", () => {
    const stars = createStarsLayer(10, "#000");
    expect(stars.layer.getSource()?.getFeatures()).toHaveLength(1);
    stars.visible.fill(1);
    let changes = 0;
    stars.geometry.on("change", () => {
      changes += 1;
    });
    setStarCount(stars, 4);
    expect(stars.geometry.getFlatCoordinates()).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...stars.visible]).toEqual(new Array(10).fill(0));
    expect(changes).toBe(1);
  });

  it("setStarRadii fills radiusPx from vmag, up to the capacity", () => {
    const stars = createStarsLayer(2, "#000");
    setStarRadii(stars, [
      [101.28716, -16.71612, -1.46, 2491, "Sirius"],
      [37.95292, 89.26417, 2.02, 424, "Polaris"],
      [0, 0, 6.5, 1, ""],
    ]);
    expect(stars.radiusPx[0]).toBeCloseTo(starRadiusPx(-1.46), 6);
    expect(stars.radiusPx[1]).toBeCloseTo(starRadiusPx(2.02), 6);
  });
});

describe("bodies layer", () => {
  const SITE = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
  const LABELS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus"];

  function styleOf(bodies: BodiesLayer, i: number): Style | undefined {
    const feature = bodies.features[i];
    if (feature === undefined) throw new Error(`no feature ${i}`);
    const s = bodies.layer.getStyleFunction()?.(feature, 1);
    return s instanceof Style ? s : undefined;
  }

  function bodiesAt(iso: string): Float64Array {
    const out = new Float64Array(BODY_IDS.length * BODY_STRIDE);
    computeBodies(astroTimeAt(Date.parse(iso)), makeObserver(SITE), out);
    return out;
  }

  it("bodyLabel names every body; the Moon below phase 0.02 is 'Moon (new)'", () => {
    expect(BODY_IDS.map((id) => bodyLabel(id, 0.5))).toEqual(LABELS);
    expect(bodyLabel("moon", 0.002)).toBe("Moon (new)");
    expect(bodyLabel("moon", 0.0199)).toBe("Moon (new)");
    expect(bodyLabel("moon", 0.02)).toBe("Moon");
    expect(bodyLabel("sun", 0)).toBe("Sun");
    expect(bodyLabel("planet:Mercury", 0.001)).toBe("Mercury");
  });

  it("bodyRadiusPx grows with brightness and is capped, so the Sun and Moon do not dominate", () => {
    let previous = 0;
    for (let mag = 8; mag >= -27; mag -= 0.05) {
      const r = bodyRadiusPx(mag);
      expect(Number.isFinite(r) && r > 0).toBe(true);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
    expect(bodyRadiusPx(-26.7)).toBe(bodyRadiusPx(-4.45)); // Sun = new Moon = the cap
    expect(bodyRadiusPx(-2.5)).toBeGreaterThan(bodyRadiusPx(5.7)); // Jupiter over Uranus
    expect(Number.isFinite(bodyRadiusPx(Number.NaN))).toBe(true);
  });

  it("8 features in BODY_IDS order with their ids and indices; nothing is drawn before the first pass", () => {
    const bodies = createBodiesLayer();
    expect(bodies.features.map((f) => f.getId())).toEqual([...BODY_IDS]);
    expect(bodies.features.map((f) => f.get("bodyIndex"))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let i = 0; i < BODY_IDS.length; i++) expect(styleOf(bodies, i)).toBeUndefined();
  });

  it("at 2026-10-10T08:00Z only Saturn and Uranus are drawn, at their projected positions", () => {
    const bodies = createBodiesLayer();
    const values = bodiesAt("2026-10-10T08:00:00Z");
    writeBodies(bodies, SYNTHETIC, values);
    const drawn = BODY_IDS.map((_, i) => styleOf(bodies, i)?.getText()?.getText() ?? null);
    expect(drawn).toEqual([null, null, null, null, null, null, "Saturn", "Uranus"]);
    const uv = new Float64Array(2);
    for (const i of [6, 7]) {
      const az = values[i * BODY_STRIDE] ?? Number.NaN;
      const alt = values[i * BODY_STRIDE + 1] ?? Number.NaN;
      expect(projectAzAltDeg(SYNTHETIC, az, alt, uv, 0)).toBe(true);
      const at = bodies.points[i]?.getCoordinates();
      expectCoord(at, [uv[0] ?? Number.NaN, 1024 - (uv[1] ?? Number.NaN)]);
    }
  });

  it("styles are cached across passes, and the new Moon's marker is hollow", () => {
    const bodies = createBodiesLayer();
    const values = new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN);
    values.set([120, 30, -4.45, 0.002], BODY_STRIDE); // the Moon, up, new
    writeBodies(bodies, SYNTHETIC, values);
    const newMoon = styleOf(bodies, 1);
    expect(newMoon?.getText()?.getText()).toBe("Moon (new)");
    const marker = newMoon?.getImage();
    expect(marker).toBeInstanceOf(CircleStyle);
    expect((marker as CircleStyle).getFill()).toBeNull();
    expect((marker as CircleStyle).getStroke()).not.toBeNull();
    writeBodies(bodies, SYNTHETIC, values);
    expect(styleOf(bodies, 1)).toBe(newMoon);

    values.set([121, 31, -12.6, 0.98], BODY_STRIDE); // a full Moon
    writeBodies(bodies, SYNTHETIC, values);
    const full = styleOf(bodies, 1);
    expect(full?.getText()?.getText()).toBe("Moon");
    const fullMarker = full?.getImage();
    expect(fullMarker).toBeInstanceOf(CircleStyle);
    expect((fullMarker as CircleStyle).getFill()).not.toBeNull();

    values.set([121, -1, -12.6, 0.98], BODY_STRIDE); // set
    writeBodies(bodies, SYNTHETIC, values);
    expect(styleOf(bodies, 1)).toBeUndefined();
  });
});
