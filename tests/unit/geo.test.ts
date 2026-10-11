import { describe, expect, it } from "vitest";
import { angularSeparationDeg, type ObserverSite, wrap180, wrap360 } from "../../src/domain/geo";

/** ± 1e-9 for every geo case (M2 step 1). Never compare wrapped angles with ===. */
const near = (actual: number, expected: number, tol = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

describe("angularSeparationDeg (haversine)", () => {
  it("is 90° between north and east on the horizon", () => {
    near(angularSeparationDeg(0, 0, 90, 0), 90);
  });

  it("is 0.2° across the zenith between opposite azimuths at alt 89.9°", () => {
    near(angularSeparationDeg(10, 89.9, 190, 89.9), 0.2);
  });

  it("stays accurate for a tiny separation", () => {
    near(angularSeparationDeg(0, 45, 0.001, 45), 0.000707107);
  });

  it("is symmetric, zero for identical directions, and ignores azimuth at the zenith", () => {
    near(angularSeparationDeg(123.4, 56.7, 123.4, 56.7), 0);
    near(angularSeparationDeg(10, 20, 300, -5), angularSeparationDeg(300, -5, 10, 20));
    near(angularSeparationDeg(0, 90, 217, 90), 0);
    near(angularSeparationDeg(0, 90, 45, 0), 90);
    near(angularSeparationDeg(0, -90, 0, 90), 180);
  });
});

describe("wrap360", () => {
  it("maps into [0, 360)", () => {
    near(wrap360(-0.5), 359.5);
    near(wrap360(360), 0);
    near(wrap360(0), 0);
    near(wrap360(725), 5);
    near(wrap360(-725), 355);
  });

  it("never returns 360 for a value just below 0 or a multiple of 360", () => {
    for (const deg of [-1e-15, -1e-14, -360, 720, -720 - 1e-13, 359.99999999999994]) {
      const r = wrap360(deg);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
});

describe("wrap180", () => {
  it("maps into [-180, 180)", () => {
    near(wrap180(190), -170);
    near(wrap180(180), -180);
    near(wrap180(-180), -180);
    near(wrap180(179.5), 179.5);
    near(wrap180(-190), 170);
    near(wrap180(44.8), 44.8); // 44.799999999999955: tolerance, never ===
  });

  it("never returns 180", () => {
    for (const deg of [180, 540, -180, 179.99999999999997, -1e-15]) {
      const r = wrap180(deg);
      expect(r).toBeGreaterThanOrEqual(-180);
      expect(r).toBeLessThan(180);
    }
  });
});

describe("ObserverSite", () => {
  it("carries latitude, longitude and height above mean sea level", () => {
    const site: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
    expect(site).toEqual({ latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 });
  });
});
