import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Calibration,
  createCameraModel,
  fromGeoPose,
  type GeoPoseBasicYpr,
  geoPoseRotation,
  type LensModel,
  projectAzAltDeg,
  toGeoPose,
  validateGeoPose,
} from "../../src/domain/camera";
import { wrap180 } from "../../src/domain/geo";
import { mulberry32 } from "../helpers/random";

const D2R = Math.PI / 180;
const SCHEMA_PATH = "src/domain/camera/schemas/GeoPose.Basic.YPR.Schema.json";
const SCHEMA_SHA256 = "5508d26aed6f546384ac1e1b9d1117f201179a2b32200ad28af3e5209c765640";
const LENSES: readonly LensModel[] = [
  "rectilinear",
  "fisheye-equidistant",
  "fisheye-equisolid",
  "fisheye-stereographic",
  "fisheye-orthographic",
];

function calibration(overrides: Partial<Calibration>): Calibration {
  return {
    azDeg: 0,
    altDeg: 0,
    rollDeg: 0,
    focalPx: 800,
    cxPx: 800,
    cyPx: 600,
    k1: 0,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: null,
    updatedAtMs: 0,
    ...overrides,
  };
}

/** ρ(θ) of each lens, unit focal. */
function rhoOf(lens: LensModel, theta: number): number {
  switch (lens) {
    case "rectilinear":
      return Math.tan(theta);
    case "fisheye-equidistant":
      return theta;
    case "fisheye-equisolid":
      return 2 * Math.sin(theta / 2);
    case "fisheye-stereographic":
      return 2 * Math.tan(theta / 2);
    case "fisheye-orthographic":
      return Math.sin(theta);
  }
}

/** Pixel of a direction through the GeoPose body axes: b = Rᵀd, right = −b_y, up = b_z, then the lens and tail. */
function poseProject(
  lens: LensModel,
  c: Calibration,
  pose: GeoPoseBasicYpr,
  azDeg: number,
  altDeg: number,
): [number, number] {
  const m = geoPoseRotation(pose.angles.yaw, pose.angles.pitch, pose.angles.roll);
  const a = azDeg * D2R;
  const h = altDeg * D2R;
  const d = [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)] as const;
  const col = (j: number): number =>
    (m[j] ?? 0) * d[0] + (m[3 + j] ?? 0) * d[1] + (m[6 + j] ?? 0) * d[2];
  const bx = col(0);
  const right = -col(1);
  const up = col(2);
  const hyp = Math.hypot(right, up);
  const theta = Math.atan2(hyp, bx);
  const scale = hyp === 0 ? 0 : rhoOf(lens, theta) / hyp;
  const x = right * scale;
  const y = up * scale;
  const r2 = x * x + y * y;
  const s = 1 + c.k1 * r2 + c.k2 * r2 * r2;
  return [c.cxPx + (c.flipX ? -1 : 1) * c.focalPx * s * x, c.cyPx - c.focalPx * s * y];
}

/** Largest absolute element difference of two 3×3 matrices. */
function matrixDiff(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
}

describe("geoPoseRotation and toGeoPose · mapping to the forward model", () => {
  it.each(LENSES)("%s: GeoPose body axes reproduce projectAzAltDeg to 1e-9 px", (lens) => {
    const rand = mulberry32(20261011);
    const fisheye = lens !== "rectilinear";
    const out = new Float64Array(2);
    let worst = 0;
    let compared = 0;
    for (let p = 0; p < 400; p++) {
      const locked = fisheye && rand() < 0.25;
      const c = calibration({
        azDeg: rand() * 360,
        altDeg: locked ? 90 : -30 + rand() * 120,
        rollDeg: -180 + rand() * 360,
        flipX: rand() < 0.5,
        k1: 0.02,
      });
      if (!locked && c.altDeg >= 90) c.altDeg = 89.5;
      const model = createCameraModel({ lens, calibration: c, widthPx: 1600, heightPx: 1200 });
      const pose = toGeoPose(19.8, -155.5, 4228, c, model.zenithLocked);
      // Axis of the forward model: A₀ = 0, h₀ = 90 when locked, whatever azDeg holds.
      const a0 = (locked ? 0 : c.azDeg) * D2R;
      const h0 = (locked ? 90 : c.altDeg) * D2R;
      const f = [Math.cos(h0) * Math.sin(a0), Math.cos(h0) * Math.cos(a0), Math.sin(h0)];
      const r = [Math.cos(a0), -Math.sin(a0), 0];
      const u = [-Math.sin(h0) * Math.sin(a0), -Math.sin(h0) * Math.cos(a0), Math.cos(h0)];
      const thetaMax = fisheye ? 89 * D2R : 55 * D2R;
      for (let k = 0; k < 20; k++) {
        // Uniform on the cap within thetaMax of the axis.
        const cosT = 1 - rand() * (1 - Math.cos(thetaMax));
        const sinT = Math.sqrt(1 - cosT * cosT);
        const phi = rand() * 2 * Math.PI;
        const dx =
          cosT * (f[0] ?? 0) + sinT * (Math.cos(phi) * (r[0] ?? 0) + Math.sin(phi) * (u[0] ?? 0));
        const dy =
          cosT * (f[1] ?? 0) + sinT * (Math.cos(phi) * (r[1] ?? 0) + Math.sin(phi) * (u[1] ?? 0));
        const dz =
          cosT * (f[2] ?? 0) + sinT * (Math.cos(phi) * (r[2] ?? 0) + Math.sin(phi) * (u[2] ?? 0));
        const az = Math.atan2(dx, dy) / D2R;
        const alt = Math.atan2(dz, Math.hypot(dx, dy)) / D2R;
        if (!projectAzAltDeg(model, az, alt, out, 0)) continue; // beyond 1.05·rMaxUnit
        const [pu, pv] = poseProject(lens, c, pose, az, alt);
        worst = Math.max(worst, Math.hypot(pu - (out[0] ?? 0), pv - (out[1] ?? 0)));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(4000);
    expect(worst).toBeLessThanOrEqual(1e-9);
  });
});

describe("GeoPose · zenith and round trips", () => {
  it("geoPoseRotation(100, −90, −10) equals (90, −90, 0)", () => {
    expect(
      matrixDiff(geoPoseRotation(100, -90, -10), geoPoseRotation(90, -90, 0)),
    ).toBeLessThanOrEqual(1e-15);
  });

  it("columns are F, image-left and image-up in ENU", () => {
    // Looking east (az 90, alt 0), roll 0: image-left is north, image-up is up.
    const m = Array.from(geoPoseRotation(0, 0, 0), (x) => x + 0); // + 0 turns −0 into 0
    expect([m[0], m[3], m[6]]).toEqual([1, 0, 0]); // F = E
    expect([m[1], m[4], m[7]]).toEqual([0, 1, 0]); // left = N
    expect([m[2], m[5], m[8]]).toEqual([0, 0, 1]); // up = U
    const out = new Float64Array(9);
    expect(geoPoseRotation(0, 0, 0, out)).toBe(out);
  });

  it("fromGeoPose(yaw, −90, roll) gives (0, 90, wrap180(roll + yaw − 90)) for 2,000 pairs", () => {
    const rand = mulberry32(20261011);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const yaw = -180 + rand() * 360;
      const roll = -180 + rand() * 360;
      const got = fromGeoPose({
        position: { lat: 0, lon: 0, h: 0 },
        angles: { yaw, pitch: -90, roll },
      });
      expect(got.azDeg).toBe(0);
      expect(got.altDeg).toBe(90);
      worst = Math.max(worst, Math.abs(wrap180(got.rollDeg - (roll + yaw - 90))));
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it("to → from → to gives the same rotation matrix over 10,000 poses", () => {
    const rand = mulberry32(20261011);
    let worst = 0;
    for (let i = 0; i < 10_000; i++) {
      const locked = rand() < 0.25;
      const c = calibration({
        azDeg: rand() * 360,
        altDeg: locked ? 90 : -90 + rand() * 180,
        rollDeg: -180 + rand() * 360,
      });
      const first = toGeoPose(47.7, -122.3, 11.5, c, locked);
      const back = fromGeoPose(first);
      const second = toGeoPose(47.7, -122.3, 11.5, calibration(back), false);
      const m1 = geoPoseRotation(first.angles.yaw, first.angles.pitch, first.angles.roll);
      const m2 = geoPoseRotation(second.angles.yaw, second.angles.pitch, second.angles.roll);
      worst = Math.max(worst, matrixDiff(m1, m2));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it("a nadir pose comes back looking straight down", () => {
    const got = fromGeoPose({
      position: { lat: 0, lon: 0, h: 0 },
      angles: { yaw: 30, pitch: 90, roll: 10 },
    });
    expect(got.azDeg).toBe(0);
    expect(got.altDeg).toBe(-90);
    const m1 = geoPoseRotation(30, 90, 10);
    const pose = toGeoPose(0, 0, 0, calibration(got), false);
    const m2 = geoPoseRotation(pose.angles.yaw, pose.angles.pitch, pose.angles.roll);
    expect(matrixDiff(m1, m2)).toBeLessThanOrEqual(1e-12);
  });

  it("a locked camera with stored azDeg 37 exports yaw 90 (gotcha G8)", () => {
    const pose = toGeoPose(0, 0, 0, calibration({ azDeg: 37, altDeg: 90, rollDeg: 150 }), true);
    expect(pose.angles).toEqual({ yaw: 90, pitch: -90, roll: 150 });
  });

  it("exports the cfht-nanaao defaults as yaw −137.3, pitch −88.26, roll 44.8, h 4228.23", () => {
    const c = calibration({ azDeg: 227.3, altDeg: 88.26, rollDeg: 44.8 });
    const pose = toGeoPose(19.8253, -155.4689, 4204 + 24.23, c, false);
    expect(pose.position).toEqual({ lat: 19.8253, lon: -155.4689, h: 4204 + 24.23 });
    expect(pose.position.h).toBeCloseTo(4228.23, 9);
    expect(pose.angles.yaw).toBeCloseTo(-137.3, 9);
    expect(pose.angles.pitch).toBeCloseTo(-88.26, 9);
    expect(pose.angles.roll).toBeCloseTo(44.8, 9);
  });
});

describe("validateGeoPose · vendored schema", () => {
  const valid = (): GeoPoseBasicYpr => ({
    position: { lat: 19.8253, lon: -155.4689, h: 4228.23 },
    angles: { yaw: -137.3, pitch: -88.26, roll: 44.8 },
  });

  it("the vendored schema matches the pinned sha256", () => {
    const bytes = readFileSync(SCHEMA_PATH);
    expect(bytes.length).toBe(969);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SCHEMA_SHA256);
  });

  it.each(["00", "01", "02", "03"])("official instance %s is valid", async (n) => {
    const text = readFileSync(
      `tests/fixtures/geopose/GeoPose.Basic.YPR.Instance.${n}.json`,
      "utf8",
    );
    const instance: unknown = JSON.parse(text);
    const result = await validateGeoPose(instance);
    expect(result).toEqual({ ok: true, pose: instance });
  });

  it('an export with "x-overhead" is valid', async () => {
    const exported = {
      ...valid(),
      "x-overhead": {
        cameraId: "cfht-nanaao",
        lens: "fisheye-equidistant",
        convention:
          "R = Rz(yaw)·Ry(pitch)·Rx(roll) from ENU; x optical axis, y image-left, z image-up",
        heightDatum: "WGS-84 ellipsoid (heightM + geoidSepM)",
      },
    };
    expect((await validateGeoPose(exported)).ok).toBe(true);
  });

  it("names the missing position of the draft schema's `location`", async () => {
    const { angles } = valid();
    expect(await validateGeoPose({ location: { lat: 0, lon: 0, h: 0 }, angles })).toEqual({
      ok: false,
      errors: ["/ must have required property 'position'"],
    });
  });

  it.each([
    ["the string", "0"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects yaw %s", async (_name, yaw) => {
    const pose = valid();
    expect(await validateGeoPose({ ...pose, angles: { ...pose.angles, yaw } })).toEqual({
      ok: false,
      errors: ["/angles/yaw must be number"],
    });
  });

  it("checks lat and lon ranges the schema lacks", async () => {
    const pose = valid();
    expect(await validateGeoPose({ ...pose, position: { ...pose.position, lat: 999 } })).toEqual({
      ok: false,
      errors: ["/position/lat must be in [-90, 90]"],
    });
    expect(await validateGeoPose({ ...pose, position: { ...pose.position, lon: -180.5 } })).toEqual(
      {
        ok: false,
        errors: ["/position/lon must be in [-180, 180]"],
      },
    );
    expect(
      (await validateGeoPose({ ...pose, position: { ...pose.position, lat: 90, lon: 180 } })).ok,
    ).toBe(true);
  });

  it("reports every error, not just the first", async () => {
    const result = await validateGeoPose({ position: { lat: "x", lon: 0 }, angles: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBe(5);
  });

  it("[M9] is async: concurrent first calls share one compile and agree", async () => {
    const pose = valid();
    const [a, b] = await Promise.all([
      validateGeoPose(pose),
      validateGeoPose({ ...pose, angles: {} }),
    ]);
    expect(a).toEqual({ ok: true, pose });
    expect(b.ok).toBe(false);
  });

  it("rejects non-objects", async () => {
    expect(await validateGeoPose(null)).toEqual({ ok: false, errors: ["/ must be object"] });
    expect((await validateGeoPose("pose")).ok).toBe(false);
  });
});
