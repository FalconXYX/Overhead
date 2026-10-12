// tests/unit/interpolate.test.ts — M3 step 6: Cartesian interpolation between two worker samples, and the sunlit
// flag from the nearer sample. Synthetic rows first, then the ISS error table (M3 section 5).
import { readFileSync } from "node:fs";
import { eciToEcf, json2satrec, propagate, type SatRec } from "satellite.js";
import { describe, expect, it } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import { angularSeparationDeg, enuToAzAltDeg, type ObserverSite } from "../../src/domain/geo";
import {
  createPropagationContext,
  type InterpMode,
  ISS_NORAD_ID,
  interpModeForRate,
  interpolateEnuKm,
  parseGpFile,
  SAMPLE_STRIDE,
  SampleField,
  sunlitAt,
  writeSample,
} from "../../src/domain/orbits";
import type { ClockRate } from "../../src/domain/time";

const F = SampleField;

/** [eKm, nKm, uKm, veKmS, vnKmS, vuKmS] of one object. */
type Row = readonly [number, number, number, number, number, number];

/** A sample of `count` valid, lit rows at the origin, with `row` at `index`. */
function sampleWith(
  row: Row,
  { count = 1, index = 0, sunlit = 1, valid = 1 } = {},
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(count * SAMPLE_STRIDE);
  for (let i = 0; i < count; i++) {
    out[i * SAMPLE_STRIDE + F.sunlit] = 1;
    out[i * SAMPLE_STRIDE + F.valid] = 1;
  }
  const o = index * SAMPLE_STRIDE;
  for (let k = 0; k < 6; k++) out[o + k] = row[k] ?? 0;
  out[o + F.sunlit] = sunlit;
  out[o + F.valid] = valid;
  return out;
}

/** Interpolates row 0 into a fresh array; null when interpolateEnuKm returns false. */
function at(
  a: Float32Array,
  tA: number,
  b: Float32Array,
  tB: number,
  t: number,
  mode: InterpMode,
): number[] | null {
  const out = new Float64Array(3);
  return interpolateEnuKm(a, tA, b, tB, 0, t, mode, out, 0) ? Array.from(out) : null;
}

const near = (actual: readonly number[] | null, expected: readonly number[], tol = 1e-9): void => {
  expect(actual).not.toBeNull();
  expect(actual?.length).toBe(expected.length);
  for (let k = 0; k < expected.length; k++) {
    expect(Math.abs((actual?.[k] ?? Number.NaN) - (expected[k] ?? 0))).toBeLessThan(tol);
  }
};

const MODES: readonly InterpMode[] = ["linear", "hermite"];
const D = 6_000; // the 60× step
const TA = 1_791_690_600_000; // 2026-10-11T03:50:00Z, a multiple of D
const TB = TA + D;
// Positions and velocities exactly representable in Float32.
const A = sampleWith([100, -200, 300, 1.5, -2.25, 0.5]);
const B = sampleWith([160, -140, 330, 2.5, 1.75, -0.5]);

describe("interpModeForRate", () => {
  it("is linear up to 60× and Hermite at 600×", () => {
    const rates: readonly ClockRate[] = [1, 10, 60];
    for (const rate of rates) expect(interpModeForRate(rate)).toBe("linear");
    expect(interpModeForRate(600)).toBe("hermite");
  });
});

describe("interpolateEnuKm on synthetic samples", () => {
  it("moves linearly between the two positions", () => {
    near(at(A, TA, B, TB, TA + D / 4, "linear"), [115, -185, 307.5]);
    near(at(A, TA, B, TB, TA + D / 2, "linear"), [130, -170, 315]);
  });

  it("returns each sample's own position at its time, in both modes", () => {
    for (const mode of MODES) {
      near(at(A, TA, B, TB, TA, mode), [100, -200, 300]);
      near(at(A, TA, B, TB, TB, mode), [160, -140, 330]);
    }
  });

  it("clamps to [tA, tB] and never extrapolates", () => {
    for (const mode of MODES) {
      for (const t of [TA - 1, TA - 5_000, TA - 1e15, Number.NEGATIVE_INFINITY]) {
        near(at(A, TA, B, TB, t, mode), [100, -200, 300]);
      }
      for (const t of [TB + 1, TB + 5_000, TB + 1e15, Number.POSITIVE_INFINITY]) {
        near(at(A, TA, B, TB, t, mode), [160, -140, 330]);
      }
    }
  });

  it("holds sample a when b is a (the next sample is late), whatever the times say", () => {
    for (const mode of MODES) {
      for (const t of [TA, TA + 1_000, TA + D / 2, TB, TB + 60_000]) {
        near(at(A, TA, A, TA, t, mode), [100, -200, 300]); // what SampleClient hands over
        near(at(A, TA, A, TB, t, mode), [100, -200, 300]); // Hermite must not drift along a's velocity
      }
    }
  });

  it("holds sample a for a zero-length span or a non-finite time", () => {
    for (const mode of MODES) {
      near(at(A, TA, B, TA, TA + 2_000, mode), [100, -200, 300]);
      near(at(A, TA, B, TB, Number.NaN, mode), [100, -200, 300]);
      near(at(A, TA, B, Number.NaN, TA + 2_000, mode), [100, -200, 300]);
      near(at(A, Number.NaN, B, TB, TA + 2_000, mode), [100, -200, 300]);
      near(at(A, TA, B, Number.POSITIVE_INFINITY, TA + 2_000, mode), [100, -200, 300]);
    }
  });

  it("returns false and leaves out untouched when either sample is invalid", () => {
    const invalidA = sampleWith([100, -200, 300, 1.5, -2.25, 0.5], { valid: 0 });
    const invalidB = sampleWith([160, -140, 330, 2.5, 1.75, -0.5], { valid: 0 });
    for (const mode of MODES) {
      const out = Float64Array.of(7, 7, 7);
      expect(interpolateEnuKm(invalidA, TA, B, TB, 0, TA + 1_000, mode, out, 0)).toBe(false);
      expect(interpolateEnuKm(A, TA, invalidB, TB, 0, TA + 1_000, mode, out, 0)).toBe(false);
      expect(interpolateEnuKm(invalidA, TA, invalidA, TA, 0, TA, mode, out, 0)).toBe(false);
      expect(Array.from(out)).toEqual([7, 7, 7]);
    }
  });

  it("reads row `index` and writes only out[offset..offset + 2]", () => {
    const a = sampleWith([10, 20, 30, 0, 0, 0], { count: 4, index: 2 });
    const b = sampleWith([20, 40, 60, 0, 0, 0], { count: 4, index: 2, valid: 1 });
    // Row 1 is invalid in b: interpolating it fails, and row 2 is unaffected.
    b[1 * SAMPLE_STRIDE + F.valid] = 0;
    for (const mode of MODES) {
      const out = new Float64Array(7).fill(-1);
      expect(interpolateEnuKm(a, TA, b, TB, 2, TA + D / 2, mode, out, 3)).toBe(true);
      expect(Array.from(out.subarray(0, 3))).toEqual([-1, -1, -1]);
      expect(out[6]).toBe(-1);
      near(Array.from(out.subarray(3, 6)), [15, 30, 45]);
      expect(interpolateEnuKm(a, TA, b, TB, 1, TA + D / 2, mode, out, 0)).toBe(false);
    }
  });

  it("Hermite reproduces a cubic exactly: velocities are km/s, the span is in ms", () => {
    // p(τ) = c0 + c1 τ + c2 τ² + c3 τ³ per axis, τ in seconds, over the 600× step (60 s).
    const span = 60_000;
    const coeffs = [
      [1000, 7, -0.0625, 2 ** -10],
      [-500, -3, 0.125, -(2 ** -11)],
      [250, 0.5, 0, 2 ** -12],
    ] as const;
    const p = (c: readonly number[], tau: number): number =>
      (c[0] ?? 0) + (c[1] ?? 0) * tau + (c[2] ?? 0) * tau ** 2 + (c[3] ?? 0) * tau ** 3;
    const v = (c: readonly number[], tau: number): number =>
      (c[1] ?? 0) + 2 * (c[2] ?? 0) * tau + 3 * (c[3] ?? 0) * tau ** 2;
    const row = (tau: number): Row => [
      p(coeffs[0], tau),
      p(coeffs[1], tau),
      p(coeffs[2], tau),
      v(coeffs[0], tau),
      v(coeffs[1], tau),
      v(coeffs[2], tau),
    ];
    const a = sampleWith(row(0));
    const b = sampleWith(row(60));
    for (let k = 0; k < 6; k++) {
      expect(a[k]).toBe(row(0)[k]); // the inputs are exact in Float32
      expect(b[k]).toBe(row(60)[k]);
    }
    for (const sec of [0, 3, 18, 30, 41.25, 59, 60]) {
      near(at(a, TA, b, TA + span, TA + sec * 1000, "hermite"), row(sec).slice(0, 3));
    }
  });

  it("Hermite along a straight line at constant velocity equals linear", () => {
    const a = sampleWith([100, 200, 300, 7.5, -1, 0.25]);
    const b = sampleWith([550, 140, 315, 7.5, -1, 0.25]); // a + 60 s × v
    for (const sec of [0, 12.5, 30, 47, 60]) {
      const t = TA + sec * 1000;
      near(at(a, TA, b, TA + 60_000, t, "hermite"), at(a, TA, b, TA + 60_000, t, "linear") ?? []);
    }
  });
});

describe("sunlitAt", () => {
  const lit = sampleWith([0, 0, 0, 0, 0, 0], { sunlit: 1 });
  const dark = sampleWith([0, 0, 0, 0, 0, 0], { sunlit: 0 });

  it("takes the flag from the nearer sample, never a blend", () => {
    expect(sunlitAt(lit, TA, dark, TB, 0, TA + 0.4 * D)).toBe(true);
    expect(sunlitAt(lit, TA, dark, TB, 0, TA + 0.6 * D)).toBe(false);
    expect(sunlitAt(dark, TA, lit, TB, 0, TA + 0.4 * D)).toBe(false);
    expect(sunlitAt(dark, TA, lit, TB, 0, TA + 0.6 * D)).toBe(true);
  });

  it("breaks a tie (or a non-finite time) toward a, and keeps the end flags outside the span", () => {
    expect(sunlitAt(lit, TA, dark, TB, 0, TA + D / 2)).toBe(true);
    expect(sunlitAt(dark, TA, lit, TB, 0, TA + D / 2)).toBe(false);
    expect(sunlitAt(lit, TA, dark, TB, 0, TA - 10_000)).toBe(true);
    expect(sunlitAt(lit, TA, dark, TB, 0, TB + 10_000)).toBe(false);
    expect(sunlitAt(dark, TA, dark, TA, 0, TA + 10_000)).toBe(false); // b === a: hold
    expect(sunlitAt(lit, TA, lit, TA, 0, TA + 10_000)).toBe(true);
    expect(sunlitAt(lit, TA, dark, TB, 0, Number.NaN)).toBe(true); // like interpolateEnuKm: hold a
    expect(sunlitAt(dark, TA, lit, TB, 0, Number.NaN)).toBe(false);
  });

  it("reads row `index`", () => {
    const a = sampleWith([0, 0, 0, 0, 0, 0], { count: 3, index: 1, sunlit: 0 });
    const b = sampleWith([0, 0, 0, 0, 0, 0], { count: 3, index: 1, sunlit: 0 });
    expect(sunlitAt(a, TA, b, TB, 1, TA + 1)).toBe(false);
    expect(sunlitAt(a, TA, b, TB, 0, TA + 1)).toBe(true);
    expect(sunlitAt(a, TA, b, TB, 2, TB - 1)).toBe(true);
  });
});

// ---- ISS error table (M3 step 6). Truth is a direct sample at each time; errors are great-circle on the
// drawn (apparent) position: az/alt are recovered from the interpolated ENU, then refracted.

function issSatrec(): SatRec {
  const url = new URL("../fixtures/gp/stations.json", import.meta.url);
  const omm = parseGpFile(JSON.parse(readFileSync(url, "utf8"))).find(
    (o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID,
  );
  if (omm === undefined) throw new Error("ISS missing from tests/fixtures/gp/stations.json");
  return json2satrec(omm);
}

const ISS = issSatrec();
/** Observer at the ISS sub-point at the culmination of the 44.8° Maunakea pass: a zenith pass. */
const ZENITH_SITE: ObserverSite = { latDeg: 22.0404, lonDeg: -152.6504, heightM: 4204 };
const MAUNAKEA: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const CULMINATION_MS = Date.parse("2026-10-12T01:00:58.527Z");
const HALF_WINDOW_MS = 360_000;
const MIN_ALT_DEG = 10;
const POINTS_PER_INTERVAL = 10;

/** One sample at timeMs; `naive` replaces the velocity with the rotated one, without − ω × r (gotcha 9). */
function sampleAt(timeMs: number, site: ObserverSite, naive: boolean): Float32Array<ArrayBuffer> {
  const out = new Float32Array(SAMPLE_STRIDE);
  const ctx = createPropagationContext(timeMs, site);
  if (!writeSample(ISS, ctx, out, 0)) throw new Error(`ISS propagation failed at ${timeMs}`);
  if (naive) {
    const pv = propagate(ISS, ctx.date);
    if (pv === null) throw new Error(`ISS propagation failed at ${timeMs}`);
    const v = eciToEcf(pv.velocity, ctx.gmstRad);
    const m = ctx.enuToEcef;
    out[F.veKmS] = (m[0] ?? 0) * v.x + (m[3] ?? 0) * v.y + (m[6] ?? 0) * v.z;
    out[F.vnKmS] = (m[1] ?? 0) * v.x + (m[4] ?? 0) * v.y + (m[7] ?? 0) * v.z;
    out[F.vuKmS] = (m[2] ?? 0) * v.x + (m[5] ?? 0) * v.y + (m[8] ?? 0) * v.z;
  }
  return out;
}

const azAlt = new Float64Array(2);
/** Apparent [az, alt] of the ENU position in enu[0..2]: enuToAzAltDeg, then apparentAltDeg (every altitude). */
function apparentAzAlt(enu: ArrayLike<number>): [number, number] {
  enuToAzAltDeg(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, azAlt, 0);
  return [azAlt[0] ?? Number.NaN, apparentAltDeg(azAlt[1] ?? Number.NaN)];
}

type Variant = "linear" | "hermite" | "hermiteNaive";
const VARIANTS: readonly Variant[] = ["linear", "hermite", "hermiteNaive"];

/** Worst great-circle error per variant over the pass (truth geometric alt > 10°), 10 points per interval. */
function worstErrorsDeg(site: ObserverSite, rate: ClockRate): Record<Variant, number> {
  const stepMs = 100 * rate;
  const worst: Record<Variant, number> = { linear: 0, hermite: 0, hermiteNaive: 0 };
  const enu = new Float64Array(3);
  const first = Math.floor((CULMINATION_MS - HALF_WINDOW_MS) / stepMs) * stepMs;
  let a = sampleAt(first, site, false);
  let aNaive = sampleAt(first, site, true);
  for (let tA = first; tA < CULMINATION_MS + HALF_WINDOW_MS; tA += stepMs) {
    const tB = tA + stepMs;
    const b = sampleAt(tB, site, false);
    const bNaive = sampleAt(tB, site, true);
    for (let j = 0; j < POINTS_PER_INTERVAL; j++) {
      const t = tA + (j * stepMs) / POINTS_PER_INTERVAL;
      const truth = sampleAt(t, site, false);
      enuToAzAltDeg(truth[F.eKm] ?? 0, truth[F.nKm] ?? 0, truth[F.uKm] ?? 0, azAlt, 0);
      if ((azAlt[1] ?? 0) <= MIN_ALT_DEG) continue;
      const [azTrue, altTrue] = apparentAzAlt(truth); // F.eKm..F.uKm are fields 0..2
      for (const variant of VARIANTS) {
        const [sa, sb] = variant === "hermiteNaive" ? [aNaive, bNaive] : [a, b];
        const mode: InterpMode = variant === "linear" ? "linear" : "hermite";
        expect(interpolateEnuKm(sa, tA, sb, tB, 0, t, mode, enu, 0)).toBe(true);
        const [az, alt] = apparentAzAlt(enu);
        worst[variant] = Math.max(worst[variant], angularSeparationDeg(azTrue, altTrue, az, alt));
      }
    }
    a = b;
    aNaive = bNaive;
  }
  return worst;
}

describe("ISS interpolation error (M3 step 6 table)", () => {
  it("the zenith site sees the ISS at the zenith at the culmination", () => {
    const s = sampleAt(CULMINATION_MS, ZENITH_SITE, false);
    enuToAzAltDeg(s[F.eKm] ?? 0, s[F.nKm] ?? 0, s[F.uKm] ?? 0, azAlt, 0);
    expect(azAlt[1]).toBeGreaterThan(89.9);
  });

  it("meets the stated bounds, and the failure modes stay detectable", () => {
    const rates: readonly ClockRate[] = [1, 10, 60, 600];
    const table: Record<string, Record<Variant, string>> = {};
    const errors = new Map<string, Record<Variant, number>>();
    for (const [name, site] of [
      ["zenith", ZENITH_SITE],
      ["maunakea 44.8°", MAUNAKEA],
    ] as const) {
      for (const rate of rates) {
        const worst = worstErrorsDeg(site, rate);
        errors.set(`${name} ${rate}`, worst);
        table[`${name} ${rate}×`] = {
          linear: worst.linear.toExponential(2),
          hermite: worst.hermite.toExponential(2),
          hermiteNaive: worst.hermiteNaive.toExponential(2),
        };
      }
    }
    console.log("ISS interpolation error, great-circle degrees (alt > 10°, Float32 samples)");
    console.table(table);
    const zenith60 = errors.get("zenith 60");
    const zenith600 = errors.get("zenith 600");
    // The doc's assertions (M3 section 5): both bounds and both failure modes.
    expect(zenith60?.linear).toBeLessThan(0.005);
    expect(zenith600?.hermite).toBeLessThan(0.005);
    expect(zenith600?.linear).toBeGreaterThan(0.1);
    expect(zenith600?.hermiteNaive).toBeGreaterThan(0.01);
    // Each rate's own mode (interpModeForRate) stays inside the bound at every rate, on both passes.
    for (const rate of rates) {
      const mode = interpModeForRate(rate);
      expect(errors.get(`zenith ${rate}`)?.[mode]).toBeLessThan(0.005);
      expect(errors.get(`maunakea 44.8° ${rate}`)?.[mode]).toBeLessThan(0.005);
    }
  });
});
