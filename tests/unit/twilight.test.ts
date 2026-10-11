import { describe, expect, it } from "vitest";
import {
  astroTimeAt,
  civilTwilightMs,
  makeObserver,
  sunGeometricAltDeg,
  twilightMarkersMs,
} from "../../src/domain/astro";
import type { ObserverSite } from "../../src/domain/geo";

const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Skyfield 1.55 + DE421 references (to the second); USNO agrees at its minute resolution. */
const DUSK_MS = Date.parse("2026-10-11T04:24:11Z");
const DAWN_MS = Date.parse("2026-10-10T15:53:03Z");
const PREV_DUSK_MS = Date.parse("2026-10-10T04:24:59Z");

const within = (actualMs: number | null | undefined, expectedMs: number, tolMs: number): void => {
  expect(actualMs).not.toBeNull();
  expect(actualMs).toBeDefined();
  expect(Math.abs((actualMs ?? Number.NaN) - expectedMs)).toBeLessThanOrEqual(tolMs);
};

describe("civilTwilightMs", () => {
  const start = Date.parse("2026-10-10T10:00:00Z");

  it("finds civil dusk (−1) and civil dawn (+1) within 60 s of Skyfield", () => {
    const observer = makeObserver(SITE);
    within(civilTwilightMs(observer, start, -1, 1), DUSK_MS, 60_000);
    within(civilTwilightMs(observer, start, 1, 1), DAWN_MS, 60_000);
  });

  it("puts the Sun's geometric altitude at −6° (± 0.001°) at the returned dusk", () => {
    const observer = makeObserver(SITE);
    const dusk = civilTwilightMs(observer, start, -1, 1);
    expect(dusk).not.toBeNull();
    const alt = sunGeometricAltDeg(astroTimeAt(dusk ?? Number.NaN), observer);
    expect(Math.abs(alt + 6)).toBeLessThan(0.001);
  });

  it("returns null when no crossing lies inside the search window", () => {
    expect(
      civilTwilightMs(makeObserver(SITE), Date.parse("2026-10-11T05:00:00Z"), -1, 0.1),
    ).toBeNull();
  });
});

describe("sunGeometricAltDeg", () => {
  it("is unrefracted: matches the Horizons AIRLESS Sun at 2026-10-10T04:00Z (± 0.01°)", () => {
    const observer = makeObserver(SITE);
    // 2026-10-10T04:00Z: the Horizons AIRLESS Sun row is el −0.152892915.
    const alt = sunGeometricAltDeg(astroTimeAt(Date.parse("2026-10-10T04:00:00Z")), observer);
    expect(Math.abs(alt - -0.152892915)).toBeLessThan(0.01);
  });
});

describe("twilightMarkersMs", () => {
  const center = Date.parse("2026-10-10T08:00:00Z");

  it("finds exactly one dusk and one dawn in ± 12 h around 2026-10-10T08:00Z", () => {
    const { duskMs, dawnMs } = twilightMarkersMs(makeObserver(SITE), center, 12 * HOUR_MS);
    expect(duskMs.length).toBe(1);
    expect(dawnMs.length).toBe(1);
    within(duskMs[0], PREV_DUSK_MS, 60_000);
    within(dawnMs[0], DAWN_MS, 60_000);
  });

  it("finds 3 dusks and 3 dawns in ± 36 h, ascending, about 24 h apart, all inside the window", () => {
    const half = 36 * HOUR_MS;
    const { duskMs, dawnMs } = twilightMarkersMs(makeObserver(SITE), center, half);
    expect(duskMs.length).toBe(3);
    expect(dawnMs.length).toBe(3);
    for (const list of [duskMs, dawnMs]) {
      for (const t of list) {
        expect(t).toBeGreaterThanOrEqual(center - half);
        expect(t).toBeLessThanOrEqual(center + half);
      }
      for (let k = 1; k < list.length; k++) {
        const gap = (list[k] ?? Number.NaN) - (list[k - 1] ?? Number.NaN);
        expect(Math.abs(gap - DAY_MS)).toBeLessThanOrEqual(5 * 60_000);
      }
    }
  });

  it("gives empty arrays in polar day (Tromsø, 2026-06-21T00:00Z ± 12 h)", () => {
    const tromso: ObserverSite = { latDeg: 69.65, lonDeg: 18.96, heightM: 0 };
    const { duskMs, dawnMs } = twilightMarkersMs(
      makeObserver(tromso),
      Date.parse("2026-06-21T00:00:00Z"),
      12 * HOUR_MS,
    );
    expect(duskMs).toEqual([]);
    expect(dawnMs).toEqual([]);
  });
});
