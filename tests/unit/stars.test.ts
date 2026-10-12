import { readFileSync } from "node:fs";
import {
  HorizonFromVector,
  Refraction,
  RotateVector,
  Rotation_EQJ_HOR,
  Spherical,
  VectorFromSphere,
} from "astronomy-engine";
import { describe, expect, it } from "vitest";
import {
  apparentAltDeg,
  astroTimeAt,
  geometricAltDeg,
  makeObserver,
  needsSkyRecompute,
  rotateStarsAzAltDeg,
  type StarRow,
  starUnitVectors,
} from "../../src/domain/astro";
import { angularSeparationDeg, type ObserverSite } from "../../src/domain/geo";

// Section 5: every astronomy test uses the CFHT point on Maunakea unless stated.
const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const POLARIS_MS = Date.parse("2026-10-10T08:00:00Z");
// HR 424, J2000 (SIMBAD).
const POLARIS: StarRow = [37.95456, 89.26411, 2.02, 424, "Polaris"];

const near = (actual: number, expected: number, tol: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

/** The library pipeline per star: test oracle only, never in the app (it allocates per star). */
function oracleAzAlt(row: StarRow, refraction: string): { az: number; alt: number } {
  const t = astroTimeAt(POLARIS_MS);
  const rot = Rotation_EQJ_HOR(t, makeObserver(SITE));
  const hor = HorizonFromVector(
    RotateVector(rot, VectorFromSphere(new Spherical(row[1], row[0], 1), t)),
    refraction,
  );
  return { az: hor.lon, alt: hor.lat };
}

describe("starUnitVectors", () => {
  it("writes (cos δ cos α, cos δ sin α, sin δ) per row, equal to VectorFromSphere", () => {
    const rows: StarRow[] = [
      POLARIS,
      [101.28716, -16.71612, -1.46, 2491, "Sirius"],
      [0, 0, 6, 1, ""],
    ];
    const v = starUnitVectors(rows);
    expect(v).toBeInstanceOf(Float64Array);
    expect(v.length).toBe(9);
    const t = astroTimeAt(POLARIS_MS);
    rows.forEach((row, i) => {
      const lib = VectorFromSphere(new Spherical(row[1], row[0], 1), t);
      near(v[3 * i] ?? Number.NaN, lib.x, 1e-15);
      near(v[3 * i + 1] ?? Number.NaN, lib.y, 1e-15);
      near(v[3 * i + 2] ?? Number.NaN, lib.z, 1e-15);
    });
  });
});

describe("rotateStarsAzAltDeg", () => {
  it("puts Polaris at az 0.592°, alt 20.151° at 2026-10-10T08:00Z (± 0.01°)", () => {
    const out = new Float32Array(2);
    rotateStarsAzAltDeg(
      astroTimeAt(POLARIS_MS),
      makeObserver(SITE),
      starUnitVectors([POLARIS]),
      1,
      out,
    );
    const az = out[0] ?? Number.NaN;
    const alt = out[1] ?? Number.NaN;
    near(az, 0.592, 0.01);
    near(alt, 20.151, 0.01);
    // Dropping refraction gives 20.105°, which this tolerance must reject.
    expect(Math.abs(20.105 - 20.151)).toBeGreaterThan(0.01);
    expect(Math.abs(alt - Refraction("normal", alt) - 20.151)).toBeGreaterThan(0.01);
  });

  it("matches the airless library oracle for Polaris: alt 20.105° (± 0.01°)", () => {
    const airless = oracleAzAlt(POLARIS, "");
    near(airless.alt, 20.105, 0.01);
    near(airless.az, 0.592, 0.01);
    const out = new Float32Array(2);
    rotateStarsAzAltDeg(
      astroTimeAt(POLARIS_MS),
      makeObserver(SITE),
      starUnitVectors([POLARIS]),
      1,
      out,
    );
    // The inline loop is the airless oracle plus 'normal' refraction (Float32 output).
    near(out[0] ?? Number.NaN, airless.az, 1e-4);
    near(out[1] ?? Number.NaN, apparentAltDeg(airless.alt), 1e-4);
  });

  it("writes only the first `count` pairs into the caller's array", () => {
    const rows: StarRow[] = [POLARIS, [101.28716, -16.71612, -1.46, 2491, "Sirius"]];
    const out = new Float32Array(4).fill(-999);
    rotateStarsAzAltDeg(astroTimeAt(POLARIS_MS), makeObserver(SITE), starUnitVectors(rows), 1, out);
    expect(out[0]).not.toBe(-999);
    expect(out[1]).not.toBe(-999);
    expect([out[2], out[3]]).toEqual([-999, -999]);
  });

  it("matches HorizonFromVector('normal') for every star in stars.json (< 1e-4°)", () => {
    const rows = JSON.parse(
      readFileSync(new URL("../../public/data/stars.json", import.meta.url), "utf8"),
    ) as StarRow[];
    expect(rows.length).toBe(8404);
    const out = new Float32Array(2 * rows.length);
    rotateStarsAzAltDeg(
      astroTimeAt(POLARIS_MS),
      makeObserver(SITE),
      starUnitVectors(rows),
      rows.length,
      out,
    );
    let worst = 0;
    rows.forEach((row, i) => {
      const az = out[2 * i] ?? Number.NaN;
      const alt = out[2 * i + 1] ?? Number.NaN;
      expect(az).toBeGreaterThanOrEqual(0);
      expect(az).toBeLessThanOrEqual(360); // Math.fround can round 359.99999 up to 360 (gotcha 15)
      const lib = oracleAzAlt(row, "normal");
      worst = Math.max(worst, angularSeparationDeg(az, alt, lib.az, lib.alt));
    });
    expect(worst).toBeLessThan(1e-4);
  });
});

describe("refraction", () => {
  const cases: readonly (readonly [number, number])[] = [
    [0, 0.48303],
    [10, 0.09013],
    [20, 0.04569],
    [45, 0.01688],
  ];

  it.each(cases)("Refraction('normal', %s°) and apparentAltDeg add %s° (± 1e-5)", (alt, r) => {
    near(Refraction("normal", alt), r, 1e-5);
    near(apparentAltDeg(alt) - alt, r, 1e-5);
  });

  it("geometricAltDeg inverts apparentAltDeg from −1° to 90° (< 1e-9°)", () => {
    let worst = 0;
    for (let a = -1; a <= 90; a += 0.25) {
      worst = Math.max(worst, Math.abs(geometricAltDeg(apparentAltDeg(a)) - a));
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("needsSkyRecompute", () => {
  it("recomputes on a first pass and on ≥ 2 s of sim time in either direction", () => {
    expect(needsSkyRecompute(1000, null)).toBe(true);
    expect(needsSkyRecompute(10000, 8001)).toBe(false);
    expect(needsSkyRecompute(10000, 8000)).toBe(true);
    expect(needsSkyRecompute(8000, 10000)).toBe(true);
    expect(needsSkyRecompute(8001, 10000)).toBe(false);
    expect(needsSkyRecompute(10000, 10000)).toBe(false);
  });
});

describe("[M9] the refraction shortcut below −1°", () => {
  it("astronomy-engine's 'normal' refraction below −1° is its −1° value times (alt + 90) / 89, bit for bit", () => {
    const atMinus1 = Refraction("normal", -1);
    for (let alt = -90; alt < -1; alt += 0.0137) {
      expect(atMinus1 * ((alt + 90.0) / 89.0)).toBe(Refraction("normal", alt));
    }
  });
});
