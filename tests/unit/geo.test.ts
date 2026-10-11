import { readFileSync } from "node:fs";
import {
  ecfToLookAngles,
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  json2satrec,
  type OMMJsonObject,
  propagate,
} from "satellite.js";
import { describe, expect, it } from "vitest";
import {
  angularSeparationDeg,
  azAltToEnuUnit,
  EARTH_ROTATION_RAD_S,
  ecefToEnu,
  ecefToLatLonDeg,
  enuToAzAltDeg,
  enuToEcef,
  enuToEcefMatrix,
  geodeticToEcefKm,
  type Mat3,
  type ObserverSite,
  unwrapLonDeg,
  unwrapLonLatPairsInPlace,
  WGS84_A_KM,
  WGS84_B_KM,
  wrap180,
  wrap360,
} from "../../src/domain/geo";
import { mulberry32 } from "../helpers/random";

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

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** The orbit-test site (M3 section 5). */
const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
/** The snapshot's fetch time, 2026-10-11T03:50:21Z. */
const SNAPSHOT_MS = 1791690621000;

function readGroup(file: string): OMMJsonObject[] {
  // Test-only cast: the shape is checked by orbits.test.ts (parseGpFile) and gpData.test.ts.
  return JSON.parse(
    readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8"),
  ) as OMMJsonObject[];
}

describe("WGS-84 and Earth-rotation constants", () => {
  it("match satellite.js and the README", () => {
    expect(WGS84_A_KM).toBe(6378.137);
    expect(WGS84_B_KM).toBe(6356.7523142);
    expect(EARTH_ROTATION_RAD_S).toBe(7.292115e-5);
  });
});

describe("enuToEcefMatrix", () => {
  it("is row-major with columns East, North, Up", () => {
    // At lat 0, lon 0: E = +y, N = +z, U = +x.
    const m = enuToEcefMatrix(0, 0);
    const expected = [0, 0, 1, 1, 0, 0, 0, 1, 0];
    for (let i = 0; i < 9; i++) near(m[i] ?? Number.NaN, expected[i] ?? Number.NaN);
    // At the north pole on lon 90: E = −x, N = −y, U = +z.
    const p = enuToEcefMatrix(90, 90);
    const expectedPole = [-1, 0, 0, 0, -1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) near(p[i] ?? Number.NaN, expectedPole[i] ?? Number.NaN);
  });

  it("is orthonormal at the orbit-test site and writes into a given matrix", () => {
    const out: Mat3 = new Float64Array(9);
    const m = enuToEcefMatrix(SITE.latDeg, SITE.lonDeg, out);
    expect(m).toBe(out);
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let dot = 0;
        for (let r = 0; r < 3; r++) dot += (m[3 * r + a] ?? 0) * (m[3 * r + b] ?? 0);
        near(dot, a === b ? 1 : 0, 1e-15);
      }
    }
  });
});

describe("enuToEcef and ecefToEnu", () => {
  it("round-trip 1,000 seeded vectors up to 10,000 km within 1e-9 km", () => {
    const rand = mulberry32(20261011);
    const m: Mat3 = new Float64Array(9);
    const enu = new Float64Array(3);
    const back = new Float64Array(5);
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      enuToEcefMatrix(rand() * 180 - 90, rand() * 360 - 180, m);
      const v = [rand() * 2e4 - 1e4, rand() * 2e4 - 1e4, rand() * 2e4 - 1e4] as const;
      ecefToEnu(m, v[0], v[1], v[2], enu, 0);
      enuToEcef(m, enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, back, 2);
      for (let k = 0; k < 3; k++)
        worst = Math.max(worst, Math.abs((back[2 + k] ?? 0) - (v[k] ?? Number.NaN)));
    }
    expect(back[0]).toBe(0); // writes only at the offset
    expect(back[1]).toBe(0);
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("geodeticToEcefKm", () => {
  it("is satellite.js geodeticToEcf with the height in metres", () => {
    const rand = mulberry32(20261011);
    const out = new Float64Array(4);
    for (let i = 0; i < 200; i++) {
      const latDeg = rand() * 180 - 90;
      const lonDeg = rand() * 360 - 180;
      const heightM = rand() * 9000 - 500;
      geodeticToEcefKm(latDeg, lonDeg, heightM, out, 1);
      const ref = geodeticToEcf({
        latitude: latDeg * D2R,
        longitude: lonDeg * D2R,
        height: heightM / 1000,
      });
      near(out[1] ?? Number.NaN, ref.x, 1e-9);
      near(out[2] ?? Number.NaN, ref.y, 1e-9);
      near(out[3] ?? Number.NaN, ref.z, 1e-9);
    }
    expect(out[0]).toBe(0);
  });
});

describe("azAltToEnuUnit and enuToAzAltDeg", () => {
  it("use az = atan2(E, N), clockwise from north", () => {
    const out = new Float64Array(2);
    const cases: readonly (readonly [number, number, number, number, number])[] = [
      [0, 1, 0, 0, 0], // north
      [1, 0, 0, 90, 0], // east
      [0, -1, 0, 180, 0], // south
      [-1, 0, 0, 270, 0], // west
      [-1, 1, 0, 315, 0],
      [0, 0, 5, 0, 90], // zenith: az 0
      [3, 0, -3, 90, -45],
    ];
    for (const [e, n, u, az, alt] of cases) {
      enuToAzAltDeg(e, n, u, out, 0);
      near(out[0] ?? Number.NaN, az);
      near(out[1] ?? Number.NaN, alt);
    }
  });

  it("keeps azimuth in [0, 360), with no −0", () => {
    const out = new Float64Array(2);
    enuToAzAltDeg(-0, 1, 0, out, 0);
    expect(Object.is(out[0], 0)).toBe(true);
    enuToAzAltDeg(-1e-300, 1, 0, out, 0);
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[0]).toBeLessThan(360);
  });

  it("round-trip 1,000 seeded directions, scaled by a range", () => {
    const rand = mulberry32(20261011);
    const enu = new Float64Array(4);
    const azAlt = new Float64Array(3);
    for (let i = 0; i < 1000; i++) {
      const az = rand() * 360;
      const alt = rand() * 178 - 89;
      const rangeKm = 300 + rand() * 3000;
      azAltToEnuUnit(az, alt, enu, 1);
      near(Math.hypot(enu[1] ?? 0, enu[2] ?? 0, enu[3] ?? 0), 1, 1e-15);
      enuToAzAltDeg(
        (enu[1] ?? 0) * rangeKm,
        (enu[2] ?? 0) * rangeKm,
        (enu[3] ?? 0) * rangeKm,
        azAlt,
        1,
      );
      near(angularSeparationDeg(azAlt[1] ?? 0, azAlt[2] ?? 0, az, alt), 0, 1e-9);
    }
    expect(enu[0]).toBe(0);
    expect(azAlt[0]).toBe(0);
  });

  it("agree with satellite.js ecfToLookAngles for the ISS seen from Maunakea", () => {
    // 2026-10-11T15:08:11Z: az 171.265°, el 19.338° (docs/verification/satellite-js.md #7).
    const iss = readGroup("stations.json").find((r) => Number(r.NORAD_CAT_ID) === 25544);
    if (iss === undefined) throw new Error("ISS missing from the snapshot");
    const date = new Date(Date.parse("2026-10-11T15:08:11Z"));
    const pv = propagate(json2satrec(iss), date);
    if (pv === null) throw new Error("ISS propagation failed");
    const gmst = gstime(date);
    const c = Math.cos(gmst);
    const s = Math.sin(gmst);
    const x = pv.position.x * c + pv.position.y * s;
    const y = -pv.position.x * s + pv.position.y * c;
    const z = pv.position.z;
    const o = new Float64Array(3);
    geodeticToEcefKm(SITE.latDeg, SITE.lonDeg, SITE.heightM, o, 0);
    const m = enuToEcefMatrix(SITE.latDeg, SITE.lonDeg);
    const enu = new Float64Array(3);
    ecefToEnu(m, x - (o[0] ?? 0), y - (o[1] ?? 0), z - (o[2] ?? 0), enu, 0);
    const azAlt = new Float64Array(2);
    enuToAzAltDeg(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, azAlt, 0);
    const look = ecfToLookAngles(
      { latitude: SITE.latDeg * D2R, longitude: SITE.lonDeg * D2R, height: SITE.heightM / 1000 },
      { x, y, z },
    );
    near(azAlt[0] ?? Number.NaN, look.azimuth * R2D, 1e-9);
    near(azAlt[1] ?? Number.NaN, look.elevation * R2D, 1e-9);
    near(Math.hypot(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0), look.rangeSat, 1e-9);
    near(azAlt[0] ?? Number.NaN, 171.265, 0.001);
    near(azAlt[1] ?? Number.NaN, 19.338, 0.001);
  });
});

describe("ecefToLatLonDeg (one-step Bowring)", () => {
  it("matches eciToGeodetic for all 11,280 snapshot records at 2026-10-11T03:50:21Z", () => {
    const records = [
      ...readGroup("stations.json"),
      ...readGroup("visual.json"),
      ...readGroup("starlink.json"),
    ];
    expect(records).toHaveLength(11_280);
    const date = new Date(SNAPSHOT_MS);
    const gmst = gstime(date);
    const c = Math.cos(gmst);
    const s = Math.sin(gmst);
    const out = new Float64Array(2);
    let checked = 0;
    let maxDLat = 0;
    let maxDLon = 0;
    for (const omm of records) {
      const pv = propagate(json2satrec(omm), date);
      if (pv === null) continue;
      const r = pv.position;
      ecefToLatLonDeg(r.x * c + r.y * s, -r.x * s + r.y * c, r.z, out, 0);
      const ref = eciToGeodetic(r, gmst);
      maxDLat = Math.max(maxDLat, Math.abs((out[0] ?? Number.NaN) - ref.latitude * R2D));
      maxDLon = Math.max(maxDLon, Math.abs(wrap180((out[1] ?? Number.NaN) - ref.longitude * R2D)));
      checked += 1;
    }
    console.log(
      `Bowring vs eciToGeodetic over ${checked} records: max |Δlat| ${maxDLat.toExponential(2)}°, max |Δlon| ${maxDLon.toExponential(2)}°`,
    );
    expect(checked).toBe(11_280); // 0 null propagations at the fetch time
    expect(maxDLat).toBeLessThan(1e-6); // measured 9.7e-8°
    expect(maxDLon).toBeLessThan(1e-9); // measured 8.5e-14°
  });

  it("inverts geodeticToEcefKm for 1,000 seeded points from 0 to 1,000 km", () => {
    const rand = mulberry32(20261011);
    const ecef = new Float64Array(3);
    const out = new Float64Array(3);
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      const latDeg = rand() * 180 - 90;
      const lonDeg = rand() * 360 - 180;
      geodeticToEcefKm(latDeg, lonDeg, rand() * 1e6, ecef, 0);
      ecefToLatLonDeg(ecef[0] ?? 0, ecef[1] ?? 0, ecef[2] ?? 0, out, 1);
      worst = Math.max(worst, Math.abs((out[1] ?? Number.NaN) - latDeg));
      if (Math.abs(latDeg) < 89.999) near(wrap180((out[2] ?? Number.NaN) - lonDeg), 0);
    }
    expect(out[0]).toBe(0);
    expect(worst).toBeLessThan(1e-6);
  });
});

describe("unwrapLonDeg", () => {
  it("adds the multiple of 360° that brings lon within 180° of prev", () => {
    near(unwrapLonDeg(179.949, -179.962), 180.038);
    near(unwrapLonDeg(-179.962, 179.949), -180.051);
    near(unwrapLonDeg(10, 20), 20);
    near(unwrapLonDeg(540, -170), 550);
    near(unwrapLonDeg(-300, 50), -310);
  });

  it("always lands within 180° of prev", () => {
    const rand = mulberry32(20261011);
    for (let i = 0; i < 1000; i++) {
      const prev = rand() * 2000 - 1000;
      const lon = rand() * 360 - 180;
      const r = unwrapLonDeg(prev, lon);
      expect(Math.abs(r - prev)).toBeLessThanOrEqual(180);
      near(wrap180(r - lon), 0);
    }
  });
});

describe("unwrapLonLatPairsInPlace", () => {
  it("wraps pair 0 into [−180, 180), then unwraps each longitude against the previous one", () => {
    const pairs = new Float64Array([190, 1, -170, 2, 170, 3]);
    unwrapLonLatPairsInPlace(pairs, 3);
    const expected = [-170, 1, -170, 2, -190, 3];
    for (let i = 0; i < 6; i++) near(pairs[i] ?? Number.NaN, expected[i] ?? Number.NaN);
  });

  it("touches only pairCount pairs and leaves latitudes alone", () => {
    const pairs = new Float64Array([179, 51.6, -179, 51.7, -177, 51.8, 999, 999]);
    unwrapLonLatPairsInPlace(pairs, 3);
    const expected = [179, 51.6, 181, 51.7, 183, 51.8, 999, 999];
    for (let i = 0; i < 8; i++) near(pairs[i] ?? Number.NaN, expected[i] ?? Number.NaN);
    unwrapLonLatPairsInPlace(pairs, 0); // no pairs: nothing to do
    near(pairs[0] ?? Number.NaN, 179);
  });
});
