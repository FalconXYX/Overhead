// tests/unit/rays.test.ts — M8 step 1: rays on the footprint sphere R = 6371.0088 km, O = (R + h)·û.
import { describe, expect, it } from "vitest";
import {
  azAltToEnuUnit,
  EARTH_MEAN_RADIUS_KM,
  enuToEcef,
  enuToEcefMatrix,
  geodeticToEcefKm,
  geometricDipDeg,
  type ObserverSite,
  raySphereEntryKm,
  raySphereExitKm,
  sphericalLatLonDeg,
  sphericalObserverKm,
  wrap180,
} from "../../src/domain/geo";

const near = (actual: number | null, expected: number, tol: number): void => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThan(tol);
};

/** The synthetic-maunakea site of every M8 ray case. */
const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const R = EARTH_MEAN_RADIUS_KM;

const O = new Float64Array(3);
sphericalObserverKm(SITE.latDeg, SITE.lonDeg, SITE.heightM, O, 0);
const M = enuToEcefMatrix(SITE.latDeg, SITE.lonDeg);
const ox = O[0] ?? Number.NaN;
const oy = O[1] ?? Number.NaN;
const oz = O[2] ?? Number.NaN;

/** ECEF unit direction of (az, geometric alt) at the site. */
function direction(azDeg: number, altDeg: number): [number, number, number] {
  const enu = new Float64Array(3);
  const d = new Float64Array(3);
  azAltToEnuUnit(azDeg, altDeg, enu, 0);
  enuToEcef(M, enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, d, 0);
  return [d[0] ?? Number.NaN, d[1] ?? Number.NaN, d[2] ?? Number.NaN];
}

describe("sphericalObserverKm", () => {
  it("puts O at R + h along the Up column of the ENU matrix, writing only at the offset", () => {
    near(Math.hypot(ox, oy, oz) - R, 4.204, 1e-9);
    const up = [M[2] ?? 0, M[5] ?? 0, M[8] ?? 0];
    for (let k = 0; k < 3; k++) near(O[k] ?? Number.NaN, (R + 4.204) * (up[k] ?? 0), 1e-9);
    const out = new Float64Array(5);
    sphericalObserverKm(SITE.latDeg, SITE.lonDeg, SITE.heightM, out, 2);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(O[0]);
  });
});

describe("straight-up ray", () => {
  const [dx, dy, dz] = [M[2] ?? 0, M[5] ?? 0, M[8] ?? 0]; // the Up column

  it("reaches the shell after exactly H − h and hits above the site (README M8 acceptance)", () => {
    near(raySphereExitKm(ox, oy, oz, dx, dy, dz, R + 420), 415.796, 1e-9);
    near(raySphereExitKm(ox, oy, oz, dx, dy, dz, R + 480), 475.796, 1e-9);
    const t = raySphereExitKm(ox, oy, oz, dx, dy, dz, R + 420) ?? Number.NaN;
    const hit = new Float64Array(3);
    sphericalLatLonDeg(ox + t * dx, oy + t * dy, oz + t * dz, hit, 1);
    expect(hit[0]).toBe(0);
    near(hit[1] ?? Number.NaN, SITE.latDeg, 1e-9);
    near(wrap180((hit[2] ?? Number.NaN) - SITE.lonDeg), 0, 1e-9);
  });

  it("never meets the Earth", () => {
    expect(raySphereEntryKm(ox, oy, oz, dx, dy, dz, R)).toBeNull();
  });

  it("lands 0.115° off the site with a WGS-84 observer (gotcha 2: never mix the models)", () => {
    const w = new Float64Array(3);
    geodeticToEcefKm(SITE.latDeg, SITE.lonDeg, SITE.heightM, w, 0);
    const wx = w[0] ?? 0;
    const wy = w[1] ?? 0;
    const wz = w[2] ?? 0;
    const t = raySphereExitKm(wx, wy, wz, dx, dy, dz, R + 420) ?? Number.NaN;
    near(t, 411.11, 0.001);
    const hit = new Float64Array(2);
    sphericalLatLonDeg(wx + t * dx, wy + t * dy, wz + t * dz, hit, 0);
    expect(Math.abs((hit[0] ?? 0) - SITE.latDeg)).toBeGreaterThan(0.1);
  });
});

describe("Earth hits (gotcha 1: the + root draws the far side)", () => {
  it("finds the first ground hit east at −3°, −2.2° and −10°, and none at −2.0°", () => {
    const cases: readonly (readonly [number, number | null])[] = [
      [-3, 93.363],
      [-2.2, 165.308],
      [-2.0, null],
      [-10, 24.472],
    ];
    for (const [alt, entry] of cases) {
      const [dx, dy, dz] = direction(90, alt);
      const got = raySphereEntryKm(ox, oy, oz, dx, dy, dz, R);
      if (entry === null) expect(got).toBeNull();
      else near(got, entry, 0.001);
    }
  });

  it("still returns a shell exit for a ray that hits the Earth first", () => {
    const [dx, dy, dz] = direction(90, -3);
    near(raySphereExitKm(ox, oy, oz, dx, dy, dz, R + 420), 2697.08, 0.001);
    const [ex, ey, ez] = direction(90, -2.0);
    near(raySphereExitKm(ox, oy, oz, ex, ey, ez, R + 420), 2572.8, 0.01);
    const [fx, fy, fz] = direction(90, -2.2);
    near(raySphereExitKm(ox, oy, oz, fx, fy, fz, R + 420), 2597.25, 0.01);
  });

  it("returns null for a ray with no real root or a root behind O", () => {
    // From outside a small sphere, pointing away from it.
    expect(raySphereExitKm(10, 0, 0, 1, 0, 0, 5)).toBeNull();
    expect(raySphereEntryKm(10, 0, 0, 1, 0, 0, 5)).toBeNull();
    // A miss: no real root.
    expect(raySphereExitKm(10, 0, 0, 0, 1, 0, 5)).toBeNull();
    expect(raySphereEntryKm(10, 0, 0, 0, 1, 0, 5)).toBeNull();
    // NaN input never yields a distance.
    expect(raySphereExitKm(Number.NaN, 0, 0, 1, 0, 0, 5)).toBeNull();
    expect(raySphereEntryKm(Number.NaN, 0, 0, 1, 0, 0, 5)).toBeNull();
    // From outside, pointing at it: the near hit, not the far one.
    near(raySphereEntryKm(10, 0, 0, -1, 0, 0, 5), 5, 1e-12);
    near(raySphereExitKm(10, 0, 0, -1, 0, 0, 5), 15, 1e-12);
    // From inside: the exit is the first hit.
    near(raySphereEntryKm(1, 0, 0, 1, 0, 0, 5), 4, 1e-12);
  });
});

describe("geometricDipDeg and the tangent (gotcha 3)", () => {
  it("is −acos(R / (R + h))", () => {
    near(geometricDipDeg(4204), -2.080873, 1e-6);
    near(geometricDipDeg(4148), -2.066975, 1e-6);
    near(geometricDipDeg(467.6), -0.694157, 1e-6);
    near(geometricDipDeg(0), 0, 1e-6);
  });

  it("counts a ray exactly at the dip as a hit, and one 1e-9° above it as a miss", () => {
    const dip = geometricDipDeg(SITE.heightM);
    const [dx, dy, dz] = direction(90, dip);
    near(raySphereEntryKm(ox, oy, oz, dx, dy, dz, R), 231.48, 0.01);
    near(raySphereExitKm(ox, oy, oz, dx, dy, dz, R + 420), 2582.66, 0.01);
    const [ex, ey, ez] = direction(90, dip + 1e-9);
    expect(raySphereEntryKm(ox, oy, oz, ex, ey, ez, R)).toBeNull();
    near(raySphereExitKm(ox, oy, oz, ex, ey, ez, R + 420), 2582.66, 0.01);
  });
});

describe("sphericalLatLonDeg", () => {
  it("is [asin(z/|P|), atan2(y, x)], unlike the Bowring latitude", () => {
    const out = new Float64Array(2);
    sphericalLatLonDeg(1, 1, Math.SQRT2, out, 0);
    near(out[0] ?? Number.NaN, 45, 1e-12);
    near(out[1] ?? Number.NaN, 45, 1e-12);
    sphericalLatLonDeg(0, 0, -7000, out, 0);
    near(out[0] ?? Number.NaN, -90, 1e-12);
    sphericalLatLonDeg(-6800, 0, 0, out, 0);
    near(out[0] ?? Number.NaN, 0, 1e-12);
    near(Math.abs(out[1] ?? Number.NaN), 180, 1e-12);
  });
});
