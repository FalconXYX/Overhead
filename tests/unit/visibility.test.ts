// tests/unit/visibility.test.ts — M3 step 6: "visible to the eye" = sunlit, the Sun's geometric altitude at or
// below the group's cutoff, and the apparent altitude above the horizon (0° until M6's terrain profile).
import { readFileSync } from "node:fs";
import { json2satrec, type SatRec } from "satellite.js";
import { describe, expect, it } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import { enuToAzAltDeg, type ObserverSite } from "../../src/domain/geo";
import {
  createPropagationContext,
  GP_GROUPS,
  type GpGroup,
  ISS_NORAD_ID,
  interpModeForRate,
  interpolateEnuKm,
  isVisible,
  parseGpFile,
  SAMPLE_STRIDE,
  SUN_CUTOFF_DEG,
  sunlitAt,
  writeSample,
} from "../../src/domain/orbits";
import type { ClockRate } from "../../src/domain/time";

describe("SUN_CUTOFF_DEG", () => {
  it("is −6° for stations and visual and −12° for Starlink, and cannot be changed", () => {
    expect(SUN_CUTOFF_DEG).toEqual({ stations: -6, visual: -6, starlink: -12 });
    expect(Object.keys(SUN_CUTOFF_DEG).sort()).toEqual([...GP_GROUPS].sort());
    expect(Object.isFrozen(SUN_CUTOFF_DEG)).toBe(true);
  });
});

describe("isVisible", () => {
  it("needs all three: sunlit, a dark enough sky, and above the horizon", () => {
    for (const group of GP_GROUPS) {
      const dark = SUN_CUTOFF_DEG[group] - 10;
      expect(isVisible(true, dark, group, 30, 0)).toBe(true);
      expect(isVisible(false, dark, group, 30, 0)).toBe(false); // in Earth's shadow
      expect(isVisible(true, 5, group, 30, 0)).toBe(false); // Sun too high
      expect(isVisible(true, dark, group, -3, 0)).toBe(false); // below the horizon
    }
  });

  it("includes the cutoff itself: the Sun at exactly −6° (−12° for Starlink) is dark enough", () => {
    for (const group of GP_GROUPS) {
      const cutoff = SUN_CUTOFF_DEG[group];
      expect(isVisible(true, cutoff, group, 30, 0)).toBe(true);
      expect(isVisible(true, cutoff + 1e-9, group, 30, 0)).toBe(false);
    }
  });

  it("needs a darker sky for Starlink: with the Sun at −8° only stations and visual pass", () => {
    const visible = (group: GpGroup): boolean => isVisible(true, -8, group, 45, 0);
    expect(visible("stations")).toBe(true);
    expect(visible("visual")).toBe(true);
    expect(visible("starlink")).toBe(false);
    expect(isVisible(true, -12.5, "starlink", 45, 0)).toBe(true);
  });

  it("needs the apparent altitude strictly above the horizon it is given", () => {
    expect(isVisible(true, -20, "stations", 0, 0)).toBe(false); // on the geometric horizon
    expect(isVisible(true, -20, "stations", 1e-9, 0)).toBe(true);
    // M6 swaps in horizonAltAtAzDeg: a ridge at 6.3° hides 5°, and a sea horizon at −1.94° shows −1°.
    expect(isVisible(true, -20, "stations", 5, 6.3)).toBe(false);
    expect(isVisible(true, -20, "stations", 7, 6.3)).toBe(true);
    expect(isVisible(true, -20, "stations", -1, -1.94)).toBe(true);
    expect(isVisible(true, -20, "stations", -2, -1.94)).toBe(false);
  });

  it("fails closed on a non-finite input", () => {
    expect(isVisible(true, Number.NaN, "visual", 30, 0)).toBe(false);
    expect(isVisible(true, -20, "visual", Number.NaN, 0)).toBe(false);
    expect(isVisible(true, -20, "visual", 30, Number.NaN)).toBe(false);
  });
});

// ---- The ISS over Maunakea on the committed snapshot (site of synthetic-maunakea).

function issSatrec(): SatRec {
  const url = new URL("../fixtures/gp/stations.json", import.meta.url);
  const omm = parseGpFile(JSON.parse(readFileSync(url, "utf8"))).find(
    (o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID,
  );
  if (omm === undefined) throw new Error("ISS missing from tests/fixtures/gp/stations.json");
  return json2satrec(omm);
}

const ISS = issSatrec();
const MAUNAKEA: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };

interface Seen {
  azDeg: number;
  altDeg: number; // apparent
  rangeKm: number;
  sunlit: boolean;
  sunAltDeg: number; // geometric, from the nearer sample
  visible: boolean;
}

/** The per-frame pipeline on the rate's grid (D = 100 ms × rate): interpolate ENU, recover az/alt, refract, test. */
function seenAt(timeMs: number, rate: ClockRate): Seen {
  const stepMs = 100 * rate;
  const tA = Math.floor(timeMs / stepMs) * stepMs;
  const tB = tA + stepMs;
  const a = new Float32Array(SAMPLE_STRIDE);
  const b = new Float32Array(SAMPLE_STRIDE);
  const ctxA = createPropagationContext(tA, MAUNAKEA);
  const ctxB = createPropagationContext(tB, MAUNAKEA);
  expect(writeSample(ISS, ctxA, a, 0)).toBe(true);
  expect(writeSample(ISS, ctxB, b, 0)).toBe(true);
  const mode = interpModeForRate(rate);
  const enu = new Float64Array(3);
  expect(interpolateEnuKm(a, tA, b, tB, 0, timeMs, mode, enu, 0)).toBe(true);
  const azAlt = new Float64Array(2);
  enuToAzAltDeg(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, azAlt, 0);
  const altDeg = apparentAltDeg(azAlt[1] ?? Number.NaN);
  const sunlit = sunlitAt(a, tA, b, tB, 0, timeMs);
  const sunAltDeg = timeMs - tA <= tB - timeMs ? ctxA.sunAltDeg : ctxB.sunAltDeg;
  return {
    azDeg: azAlt[0] ?? Number.NaN,
    altDeg,
    rangeKm: Math.hypot(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0),
    sunlit,
    sunAltDeg,
    visible: isVisible(sunlit, sunAltDeg, "stations", altDeg, 0),
  };
}

describe("the ISS from Maunakea", () => {
  const T = Date.parse("2026-10-11T15:09:50Z"); // the e2e instant (M3 section 5)

  it("at the e2e instant is visible, with the hover card's values (1×, on the grid)", () => {
    const seen = seenAt(T, 1);
    // satellite.js at 15:09:50Z: az 123.812°, geometric 28.841° + 0.030° refraction, range 794.522 km.
    expect(Math.abs(seen.azDeg - 123.812)).toBeLessThan(0.001);
    expect(Math.abs(seen.altDeg - 28.872)).toBeLessThan(0.001);
    expect(Math.abs(seen.rangeKm - 794.522)).toBeLessThan(0.001);
    expect(seen.azDeg.toFixed(1)).toBe("123.8");
    expect(seen.altDeg.toFixed(1)).toBe("28.9");
    expect(Math.round(seen.rangeKm)).toBe(795);
    expect(seen.sunlit).toBe(true);
    expect(Math.abs(seen.sunAltDeg - -16.2)).toBeLessThan(0.05);
    expect(seen.visible).toBe(true);
  });

  it("at the e2e instant at 600× (Hermite, 50 s into a 60 s step) agrees with the direct sample", () => {
    const direct = seenAt(T, 1);
    const hermite = seenAt(T, 600);
    expect(Math.abs(hermite.azDeg - direct.azDeg)).toBeLessThan(0.001);
    expect(Math.abs(hermite.altDeg - direct.altDeg)).toBeLessThan(0.001);
    expect(Math.abs(hermite.rangeKm - direct.rangeKm)).toBeLessThan(0.01);
    expect(hermite.visible).toBe(true);
  });

  it("is visible to the eye only in the first of the fixture's three passes", () => {
    // M3 step 4: 15:06:50–15:12:44Z (Sun far below −6°), 16:45:01–16:48:10Z (after sunrise),
    // 2026-10-12 00:57:45–01:04:11Z (afternoon). Sampled on the absolute 10 s grid, as the fixture is.
    const passes = [
      ["2026-10-11T15:06:50Z", "2026-10-11T15:12:40Z"],
      ["2026-10-11T16:45:10Z", "2026-10-11T16:48:10Z"],
      ["2026-10-12T00:57:50Z", "2026-10-12T01:04:10Z"],
    ] as const;
    const summary = passes.map(([from, to]) => {
      const seen: Seen[] = [];
      for (let t = Date.parse(from); t <= Date.parse(to); t += 10_000) seen.push(seenAt(t, 1));
      return seen;
    });
    const [first, second, third] = summary;
    expect(first?.length).toBeGreaterThan(30);
    const visibleToTheEye = (s: Seen): boolean =>
      s.visible && s.sunlit && s.sunAltDeg < -6 && s.altDeg > 0;
    expect(first?.every(visibleToTheEye)).toBe(true);
    // Above the horizon throughout, but the Sun is too high in both later passes.
    for (const pass of [second, third]) {
      expect(pass?.length).toBeGreaterThan(15);
      expect(pass?.every((s) => s.altDeg > 0 && s.sunAltDeg > -6 && !s.visible)).toBe(true);
    }
  });
});
