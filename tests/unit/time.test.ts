import { describe, expect, it, vi } from "vitest";
import {
  advanceReplayMs,
  BASE_SAMPLE_STEP_MS,
  clampToScrubRangeMs,
  floorToStepMs,
  formatUtcHhMm,
  formatZonedDateTime,
  isoDateUtc,
  isoUtcSeconds,
  MAX_WALL_DELTA_MS,
  parseOmmEpochMs,
  SCRUB_HALF_RANGE_MS,
  SKY_RECOMPUTE_MS,
  sampleStepMs,
  TRACK_STEP_MS,
  trueColorDateUtc,
} from "../../src/domain/time";
import { mulberry32 } from "../helpers/random";

const T0 = Date.UTC(2026, 9, 11, 3, 20, 0); // 2026-10-11T03:20:00Z

describe("advanceReplayMs", () => {
  it("adds the wall delta times the rate", () => {
    expect(advanceReplayMs(T0, 16, 1)).toBe(T0 + 16);
    expect(advanceReplayMs(T0, 100, 10)).toBe(T0 + 1_000);
    expect(advanceReplayMs(T0, 16, 600)).toBe(T0 + 9_600);
  });

  it("clamps the wall delta to 250 ms", () => {
    expect(MAX_WALL_DELTA_MS).toBe(250);
    expect(advanceReplayMs(T0, 3_600_000, 600)).toBe(T0 + 150_000);
    expect(advanceReplayMs(T0, 250, 1)).toBe(T0 + 250);
    expect(advanceReplayMs(T0, 251, 1)).toBe(T0 + 250);
  });

  it("never runs backwards", () => {
    expect(advanceReplayMs(T0, -40, 60)).toBe(T0);
  });
});

describe("clampToScrubRangeMs", () => {
  it("keeps times inside ±12 h, inclusive", () => {
    expect(SCRUB_HALF_RANGE_MS).toBe(43_200_000);
    expect(clampToScrubRangeMs(T0 + 43_200_000, T0)).toBe(T0 + 43_200_000);
    expect(clampToScrubRangeMs(T0 + 43_200_001, T0)).toBe(T0 + 43_200_000);
    expect(clampToScrubRangeMs(T0 - 43_200_001, T0)).toBe(T0 - 43_200_000);
  });
});

describe("isoUtcSeconds", () => {
  it("whole seconds, truncated", () => {
    expect(isoUtcSeconds(T0)).toBe("2026-10-11T03:20:00Z");
    expect(isoUtcSeconds(T0 + 999)).toBe("2026-10-11T03:20:00Z");
    expect(isoUtcSeconds(Date.UTC(2026, 11, 31, 23, 59, 59, 500))).toBe("2026-12-31T23:59:59Z");
  });
});

describe("isoDateUtc", () => {
  it("the UTC date", () => {
    expect(isoDateUtc(1791603000123)).toBe("2026-10-10");
  });
});

describe("trueColorDateUtc", () => {
  const MAUNAKEA = -155.4689;
  const WALENSTADT = 9.3242;
  const SUBARU = -155.47587;
  // [siteLonDeg, time, expected date]: 18 cases around each flip (13:30 local mean solar time + 4 h).
  const cases: readonly (readonly [number, string, string])[] = [
    [MAUNAKEA, "2026-10-11T04:00:00Z", "2026-10-10"],
    [MAUNAKEA, "2026-10-11T03:51:52Z", "2026-10-09"],
    [MAUNAKEA, "2026-10-11T03:51:53Z", "2026-10-10"],
    [MAUNAKEA, "2026-10-10T03:30:00Z", "2026-10-08"],
    [MAUNAKEA, "2026-10-10T04:00:00Z", "2026-10-09"],
    [MAUNAKEA, "2026-10-10T08:00:00Z", "2026-10-09"],
    [WALENSTADT, "2026-10-11T03:00:00Z", "2026-10-10"],
    [WALENSTADT, "2026-10-10T20:00:00Z", "2026-10-10"],
    [WALENSTADT, "2026-10-10T16:52:42Z", "2026-10-09"],
    [WALENSTADT, "2026-10-10T16:52:43Z", "2026-10-10"],
    [SUBARU, "2026-10-11T03:51:54Z", "2026-10-09"],
    [SUBARU, "2026-10-11T03:51:55Z", "2026-10-10"],
    [-179.9, "2026-10-11T05:29:35Z", "2026-10-10"],
    [-179.9, "2026-10-11T05:29:37Z", "2026-10-11"],
    [179.9, "2026-10-11T05:30:23Z", "2026-10-10"],
    [179.9, "2026-10-11T05:30:25Z", "2026-10-11"],
    [0, "2026-10-11T17:29:59.999Z", "2026-10-10"],
    [0, "2026-10-11T17:30:00Z", "2026-10-11"],
  ];

  it.each(cases)("lon %d at %s gives %s", (lonDeg, iso, expected) => {
    expect(trueColorDateUtc(Date.parse(iso), lonDeg)).toBe(expected);
  });

  /** Local-frame reference: the local pass is local midnight + 13.5 h, at or before t − 4 h. */
  function referenceDate(timeMs: number, lonDeg: number): string {
    const DAY = 86_400_000;
    const zoneMs = (lonDeg / 15) * 3_600_000;
    const localMs = timeMs - 4 * 3_600_000 + zoneMs;
    let localPassMs = Math.floor(localMs / DAY) * DAY + 13.5 * 3_600_000;
    if (localPassMs > localMs) localPassMs -= DAY;
    return new Date(localPassMs - zoneMs).toISOString().slice(0, 10);
  }

  it("2,000 seeded pairs agree with a local-frame reference", () => {
    const rand = mulberry32(20261011);
    const startMs = Date.UTC(2026, 0, 1);
    const yearMs = Date.UTC(2027, 0, 1) - startMs;
    const mismatches: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const lonDeg = rand() * 360 - 180;
      const timeMs = startMs + Math.floor(rand() * yearMs);
      const got = trueColorDateUtc(timeMs, lonDeg);
      const want = referenceDate(timeMs, lonDeg);
      if (got !== want)
        mismatches.push(`${lonDeg} ${new Date(timeMs).toISOString()} ${got} ${want}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("memoises on the pass: a second call 1 s later does no formatting work", () => {
    // Strings have no observable identity (toBe compares them by value), so count the formatting calls instead.
    const t = Date.parse("2026-10-10T08:00:00Z");
    expect(trueColorDateUtc(t, MAUNAKEA)).toBe("2026-10-09");
    const spy = vi.spyOn(Date.prototype, "toISOString");
    try {
      expect(trueColorDateUtc(t + 1000, MAUNAKEA)).toBe("2026-10-09");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("formatZonedDateTime", () => {
  it("24-hour local time in an IANA zone", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(formatZonedDateTime(at("2026-10-10T03:30:00Z"), "Pacific/Honolulu")).toBe(
      "2026-10-09 17:30:00",
    );
    expect(formatZonedDateTime(at("2026-10-10T10:00:00Z"), "Pacific/Honolulu")).toBe(
      "2026-10-10 00:00:00",
    );
    expect(formatZonedDateTime(at("2026-10-10T03:30:00Z"), "Europe/Zurich")).toBe(
      "2026-10-10 05:30:00",
    );
    expect(formatZonedDateTime(at("2026-12-10T03:30:00Z"), "Europe/Zurich")).toBe(
      "2026-12-10 04:30:00",
    );
    expect(formatZonedDateTime(at("2026-10-10T22:00:00Z"), "Europe/Zurich")).toBe(
      "2026-10-11 00:00:00",
    );
  });
});

describe("SKY_RECOMPUTE_MS", () => {
  it("is 2 s of sim time", () => {
    expect(SKY_RECOMPUTE_MS).toBe(2_000);
  });
});

describe("formatUtcHhMm", () => {
  it("hours and minutes in UTC", () => {
    expect(formatUtcHhMm(T0)).toBe("03:20");
    expect(formatUtcHhMm(Date.parse("2026-10-10T00:00:00Z"))).toBe("00:00");
    expect(formatUtcHhMm(Date.parse("2026-10-10T15:53:03Z"))).toBe("15:53");
  });

  it("truncates to the minute, never rounds", () => {
    expect(formatUtcHhMm(T0 + 59_999)).toBe("03:20");
    // The civil dusk marker at 2026-10-10T04:24:58.9Z reads 04:24, not 04:25.
    expect(formatUtcHhMm(Date.parse("2026-10-10T04:24:58.900Z"))).toBe("04:24");
    expect(formatUtcHhMm(Date.parse("2026-12-31T23:59:59.999Z"))).toBe("23:59");
  });

  it("agrees with the local label, which also truncates", () => {
    const t = Date.parse("2026-10-11T04:24:59.999Z");
    expect(formatUtcHhMm(t)).toBe("04:24");
    expect(formatZonedDateTime(t, "Pacific/Honolulu").slice(11, 16)).toBe("18:24");
  });
});

describe("parseOmmEpochMs", () => {
  it("reads CelesTrak's zone-less EPOCH as UTC", () => {
    // ISS 25544 in the committed snapshot; sub-millisecond digits are truncated, as json2satrec's Date does.
    expect(parseOmmEpochMs("2026-10-09T22:48:38.797056")).toBe(
      Date.UTC(2026, 9, 9, 22, 48, 38, 797),
    );
    expect(parseOmmEpochMs("2026-10-11T03:50:21")).toBe(1791690621000);
  });

  it("does not depend on the machine's time zone (the Z is appended, never assumed local)", () => {
    expect(parseOmmEpochMs("2026-01-01T00:00:00.000000")).toBe(Date.UTC(2026, 0, 1));
    expect(parseOmmEpochMs("2026-07-01T12:00:00")).toBe(Date.UTC(2026, 6, 1, 12));
  });

  it("accepts an EPOCH that already ends in Z", () => {
    expect(parseOmmEpochMs("2026-10-09T22:48:38.797056Z")).toBe(
      parseOmmEpochMs("2026-10-09T22:48:38.797056"),
    );
  });

  it("gives NaN for anything that is not an ISO date-time", () => {
    for (const bad of [
      "",
      "No GP data found",
      "2026-10-09",
      "2026-10-09 22:48:38",
      "2026-283T22:48:38",
      "2026-10-09T22:48:38+02:00",
      "2026-13-09T22:48:38",
      "2026-10-09T25:48:38",
      "2026-10-09T24:00:00",
      "2026-02-30T00:00:00", // Date.parse would roll this over to 2026-03-02
      "2027-02-29T00:00:00",
      " 2026-10-09T22:48:38",
    ]) {
      expect(parseOmmEpochMs(bad), bad).toBeNaN();
    }
    expect(parseOmmEpochMs("2028-02-29T00:00:00")).toBe(Date.UTC(2028, 1, 29));
  });
});

describe("sampleStepMs", () => {
  it("is 100 ms × rate", () => {
    expect(BASE_SAMPLE_STEP_MS).toBe(100);
    expect(sampleStepMs(1)).toBe(100);
    expect(sampleStepMs(10)).toBe(1_000);
    expect(sampleStepMs(60)).toBe(6_000);
    expect(sampleStepMs(600)).toBe(60_000);
  });
});

describe("floorToStepMs", () => {
  it("snaps down to a multiple of the step", () => {
    expect(TRACK_STEP_MS).toBe(20_000);
    const t = Date.parse("2026-10-11T03:50:21Z");
    expect(floorToStepMs(t, TRACK_STEP_MS)).toBe(Date.parse("2026-10-11T03:50:20Z"));
    expect(floorToStepMs(Date.parse("2026-10-11T03:50:20Z"), TRACK_STEP_MS)).toBe(
      Date.parse("2026-10-11T03:50:20Z"),
    );
    expect(floorToStepMs(Date.parse("2026-10-11T03:50:39.999Z"), TRACK_STEP_MS)).toBe(
      Date.parse("2026-10-11T03:50:20Z"),
    );
    expect(floorToStepMs(t + 123, 100)).toBe(t + 100);
  });

  it("floors (never truncates) before 1970", () => {
    expect(floorToStepMs(-1, 20_000)).toBe(-20_000);
    expect(floorToStepMs(-20_000, 20_000)).toBe(-20_000);
  });
});
