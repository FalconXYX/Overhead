import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  advanceReplayMs,
  BASE_SAMPLE_STEP_MS,
  clampStreamDelayMs,
  clampToScrubRangeMs,
  clipStartUtcMs,
  floorToStepMs,
  formatUtcHhMm,
  formatZonedDateTime,
  GOES_RETENTION_MS,
  GOES_STEP_MS,
  goesStepMs,
  goesStepsInRange,
  isoDateUtc,
  isoUtcSeconds,
  localVideoTimeMs,
  MAX_WALL_DELTA_MS,
  mergeGoesIntervals,
  parseGoesDomain,
  parseOmmEpochMs,
  removeGoesStep,
  SCRUB_HALF_RANGE_MS,
  SKY_RECOMPUTE_MS,
  STREAM_DELAY_FINE_MS,
  STREAM_DELAY_MAX_MS,
  sampleStepMs,
  streamDelayForFrameMs,
  type TimeInterval,
  TRACK_STEP_MS,
  trueColorDateUtc,
  youtubeLiveTimeMs,
  youtubeStallMs,
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

describe("GOES availability [M7]", () => {
  const at = (iso: string): number => Date.parse(iso);
  const iv = (fromIso: string, toIso: string): TimeInterval => [at(fromIso), at(toIso)];
  /** The committed DescribeDomains response (M7 step 1), read the way goes.ts's domainTextFromXml does. */
  const fixtureXml = readFileSync(
    new URL("../fixtures/gibs/goes-domain.xml", import.meta.url),
    "utf8",
  );
  const fixtureDomain = /<Domain>([^<]*)<\/Domain>/.exec(fixtureXml)?.[1] ?? null;
  const FIXTURE: readonly TimeInterval[] = [
    iv("2026-10-07T12:00:00Z", "2026-10-07T19:20:00Z"),
    iv("2026-10-07T19:40:00Z", "2026-10-07T21:00:00Z"),
    iv("2026-10-07T21:20:00Z", "2026-10-11T00:00:00Z"),
  ];
  const LATEST = at("2026-10-11T00:00:00Z");

  it("steps are 10 minutes and retention is 90 days", () => {
    expect(GOES_STEP_MS).toBe(600_000);
    expect(GOES_RETENTION_MS).toBe(7_776_000_000);
    expect(GOES_RETENTION_MS).toBe(90 * 86_400_000);
  });

  describe("parseGoesDomain", () => {
    it("the committed fixture: the 19:30 and 21:10 gaps and a bare-date midnight", () => {
      expect(fixtureDomain).toBe(
        "2026-10-07T12:00:00Z/2026-10-07T19:20:00Z/PT10M,2026-10-07T19:40:00Z/2026-10-07T21:00:00Z/PT10M,2026-10-07T21:20:00Z/2026-10-11/PT10M",
      );
      expect(parseGoesDomain(fixtureDomain ?? "")).toEqual(FIXTURE);
    });

    it('"" gives []', () => {
      expect(parseGoesDomain("")).toEqual([]);
    });

    it("a bare date is 00:00:00Z", () => {
      expect(parseGoesDomain("2026-10-10/2026-10-10/PT10M")).toEqual([
        iv("2026-10-10T00:00:00Z", "2026-10-10T00:00:00Z"),
      ]);
      expect(parseGoesDomain("2026-10-10/2026-10-10T06:00:00Z/PT10M")).toEqual([
        iv("2026-10-10T00:00:00Z", "2026-10-10T06:00:00Z"),
      ]);
    });

    it("snaps starts up and ends down to the grid, and drops items left empty", () => {
      expect(parseGoesDomain("2026-10-10T09:47:00Z/2026-10-10T11:03:00Z")).toEqual([
        iv("2026-10-10T09:50:00Z", "2026-10-10T11:00:00Z"),
      ]);
      expect(parseGoesDomain("2026-10-10T09:41:00Z/2026-10-10T09:49:00Z")).toEqual([]);
      expect(parseGoesDomain("2026-10-10T09:55:00Z")).toEqual([]);
      expect(parseGoesDomain("2026-10-10T11:00:00Z/2026-10-10T10:00:00Z/PT10M")).toEqual([]);
    });

    it("a bare time is one step", () => {
      expect(parseGoesDomain("2026-10-10T09:50:00Z")).toEqual([
        iv("2026-10-10T09:50:00Z", "2026-10-10T09:50:00Z"),
      ]);
    });

    it("sorts the items and joins any that overlap or touch", () => {
      const domain = [
        "2026-10-10T12:00:00Z/2026-10-10T13:00:00Z/PT10M",
        "2026-10-10T09:00:00Z/2026-10-10T10:00:00Z/PT10M",
        "2026-10-10T10:10:00Z/2026-10-10T11:00:00Z/PT10M", // touches 09:00–10:00
        "2026-10-10T10:30:00Z/2026-10-10T10:40:00Z", // inside 10:10–11:00
        "2026-10-10T11:20:00Z", // after the 11:10 gap
      ].join(",");
      expect(parseGoesDomain(domain)).toEqual([
        iv("2026-10-10T09:00:00Z", "2026-10-10T11:00:00Z"),
        iv("2026-10-10T11:20:00Z", "2026-10-10T11:20:00Z"),
        iv("2026-10-10T12:00:00Z", "2026-10-10T13:00:00Z"),
      ]);
    });

    it("throws on a malformed time or a period other than PT10M", () => {
      for (const bad of [
        "2026-10-10T03:30Z/2026-10-10T04:00:00Z/PT10M",
        "2026-10-10/2026-10-11/P1D",
        "2026-13-45T99:99:00Z/2026-10-10T04:00:00Z/PT10M",
        "2026-02-30/2026-03-01/PT10M", // Date.UTC would roll this over to March
        "2026-10-10T24:00:00Z",
        "2026-10-10T09:50:00.000Z",
        "2026-10-10T09:50:00+00:00",
        "2026-10-10T09:50:00Z/2026-10-10T10:00:00Z/PT10M/PT10M",
        "2026-10-10T09:50:00Z,",
        "time",
      ]) {
        expect(() => parseGoesDomain(bad), bad).toThrow();
      }
    });
  });

  describe("goesStepMs", () => {
    const step = (iso: string, latestStepMs: number | null = LATEST): number | null =>
      goesStepMs(at(iso), FIXTURE, latestStepMs);

    it("floors to the 10-minute step", () => {
      expect(step("2026-10-10T09:58:00Z")).toBe(at("2026-10-10T09:50:00Z"));
      expect(step("2026-10-10T09:59:59.999Z")).toBe(at("2026-10-10T09:50:00Z"));
      expect(step("2026-10-10T10:00:00Z")).toBe(at("2026-10-10T10:00:00Z"));
    });

    it("in a gap gives the last step before the gap", () => {
      expect(step("2026-10-07T19:35:00Z")).toBe(at("2026-10-07T19:20:00Z"));
      expect(step("2026-10-07T19:39:59Z")).toBe(at("2026-10-07T19:20:00Z"));
      expect(step("2026-10-07T19:40:00Z")).toBe(at("2026-10-07T19:40:00Z"));
      expect(step("2026-10-07T21:10:00Z")).toBe(at("2026-10-07T21:00:00Z"));
    });

    it("before the first listed step gives null", () => {
      expect(step("2026-10-07T11:59:59Z")).toBeNull();
      expect(step("2026-10-07T12:00:00Z")).toBe(at("2026-10-07T12:00:00Z"));
    });

    it("never passes latestStepMs", () => {
      expect(step("2026-10-11T09:52:00Z")).toBe(LATEST);
      expect(step("2026-10-11T09:52:00Z", at("2026-10-10T23:40:00Z"))).toBe(
        at("2026-10-10T23:40:00Z"),
      );
      // A latest step inside a gap gives the step before the gap.
      expect(step("2026-10-07T20:00:00Z", at("2026-10-07T19:30:00Z"))).toBe(
        at("2026-10-07T19:20:00Z"),
      );
      expect(step("2026-10-08T00:00:00Z", at("2026-10-07T11:50:00Z"))).toBeNull();
    });

    it("a null latestStepMs means no cap", () => {
      expect(step("2026-10-12T00:00:00Z", null)).toBe(LATEST);
      expect(step("2026-10-10T09:58:00Z", null)).toBe(at("2026-10-10T09:50:00Z"));
    });

    it("no intervals give null", () => {
      expect(goesStepMs(at("2026-10-10T09:58:00Z"), [], null)).toBeNull();
      expect(goesStepMs(at("2026-10-10T09:58:00Z"), [], LATEST)).toBeNull();
    });

    it("stepping 09:58:00 → 10:02:00 in 1 s steps gives exactly [09:50, 10:00]", () => {
      const distinct: (number | null)[] = [];
      for (let t = at("2026-10-10T09:58:00Z"); t <= at("2026-10-10T10:02:00Z"); t += 1000) {
        const s = goesStepMs(t, FIXTURE, LATEST);
        if (distinct.length === 0 || distinct[distinct.length - 1] !== s) distinct.push(s);
      }
      expect(distinct).toEqual([at("2026-10-10T09:50:00Z"), at("2026-10-10T10:00:00Z")]);
    });

    it("the poll's fallback for an unconfirmed newest step is the listed step before it", () => {
      // M7 step 5.7: goesStepMs(newest − GOES_STEP_MS, draft, null).
      expect(goesStepMs(LATEST - GOES_STEP_MS, FIXTURE, null)).toBe(at("2026-10-10T23:50:00Z"));
      const draft = [...FIXTURE.slice(0, 1), iv("2026-10-07T19:40:00Z", "2026-10-07T19:40:00Z")];
      expect(goesStepMs(at("2026-10-07T19:40:00Z") - GOES_STEP_MS, draft, null)).toBe(
        at("2026-10-07T19:20:00Z"),
      );
    });
  });

  describe("mergeGoesIntervals", () => {
    it("keeps the larger end when the fresh poll lags (next ends 08:40, prev 09:30)", () => {
      const prev = [iv("2026-10-11T00:00:00Z", "2026-10-11T09:30:00Z")];
      const next = [iv("2026-10-11T00:00:00Z", "2026-10-11T08:40:00Z")];
      expect(mergeGoesIntervals(prev, next)).toEqual([
        iv("2026-10-11T00:00:00Z", "2026-10-11T09:30:00Z"),
      ]);
    });

    it("keeps prev's steps and gaps after next's last step", () => {
      const prev = [
        iv("2026-10-11T00:00:00Z", "2026-10-11T09:00:00Z"),
        iv("2026-10-11T09:20:00Z", "2026-10-11T09:40:00Z"),
      ];
      const next = [iv("2026-10-11T00:10:00Z", "2026-10-11T08:40:00Z")];
      expect(mergeGoesIntervals(prev, next)).toEqual([
        iv("2026-10-11T00:10:00Z", "2026-10-11T09:00:00Z"),
        iv("2026-10-11T09:20:00Z", "2026-10-11T09:40:00Z"),
      ]);
    });

    it("takes every step up to next's last step from next", () => {
      const full = [iv("2026-10-11T00:00:00Z", "2026-10-11T09:30:00Z")];
      // Next refills a removed step.
      const removed = removeGoesStep(full, at("2026-10-11T09:00:00Z"));
      expect(removed).toHaveLength(2);
      expect(mergeGoesIntervals(removed, full)).toEqual(full);
      // Next's gaps win over prev up to next's last step.
      expect(
        mergeGoesIntervals(full, [
          iv("2026-10-11T00:00:00Z", "2026-10-11T08:00:00Z"),
          iv("2026-10-11T08:20:00Z", "2026-10-11T09:00:00Z"),
        ]),
      ).toEqual([
        iv("2026-10-11T00:00:00Z", "2026-10-11T08:00:00Z"),
        iv("2026-10-11T08:20:00Z", "2026-10-11T09:30:00Z"),
      ]);
      // Prev's steps before next's first step are dropped.
      expect(
        mergeGoesIntervals(
          [iv("2026-10-01T00:00:00Z", "2026-10-05T00:00:00Z")],
          [iv("2026-10-06T00:00:00Z", "2026-10-07T00:00:00Z")],
        ),
      ).toEqual([iv("2026-10-06T00:00:00Z", "2026-10-07T00:00:00Z")]);
    });

    it("an empty next returns prev itself", () => {
      expect(mergeGoesIntervals(FIXTURE, [])).toBe(FIXTURE);
      const none: readonly TimeInterval[] = [];
      expect(mergeGoesIntervals(none, [])).toBe(none);
    });

    it("the fixture merged with itself is unchanged", () => {
      expect(mergeGoesIntervals(FIXTURE, FIXTURE)).toEqual(FIXTURE);
      expect(mergeGoesIntervals([], FIXTURE)).toEqual(FIXTURE);
    });

    it("clips to 90 days before the newest listed step, not the clock", () => {
      expect(mergeGoesIntervals([], [iv("2026-07-01T00:00:00Z", "2026-10-11T09:30:00Z")])).toEqual([
        iv("2026-07-13T09:30:00Z", "2026-10-11T09:30:00Z"),
      ]);
      expect(
        mergeGoesIntervals(
          [],
          [
            iv("2026-07-01T00:00:00Z", "2026-07-05T00:00:00Z"),
            iv("2026-07-10T00:00:00Z", "2026-10-11T09:30:00Z"),
          ],
        ),
      ).toEqual([iv("2026-07-13T09:30:00Z", "2026-10-11T09:30:00Z")]);
      // The newest end may come from prev.
      expect(
        mergeGoesIntervals(
          [iv("2026-07-13T09:00:00Z", "2026-10-11T09:40:00Z")],
          [iv("2026-07-13T09:00:00Z", "2026-10-11T09:30:00Z")],
        ),
      ).toEqual([iv("2026-07-13T09:40:00Z", "2026-10-11T09:40:00Z")]);
    });

    it("does not mutate its inputs", () => {
      const prev = [iv("2026-10-11T00:00:00Z", "2026-10-11T09:30:00Z")];
      const next = [iv("2026-10-11T00:00:00Z", "2026-10-11T08:40:00Z")];
      const prevCopy = structuredClone(prev);
      const nextCopy = structuredClone(next);
      mergeGoesIntervals(prev, next);
      expect(prev).toEqual(prevCopy);
      expect(next).toEqual(nextCopy);
    });
  });

  describe("removeGoesStep", () => {
    it("a single-step interval disappears", () => {
      const single = [iv("2026-10-10T09:50:00Z", "2026-10-10T09:50:00Z")];
      expect(removeGoesStep(single, at("2026-10-10T09:50:00Z"))).toEqual([]);
    });

    it("returns the same reference when the step is not listed", () => {
      for (const iso of [
        "2026-10-07T19:30:00Z", // in a gap
        "2026-10-07T19:25:00Z", // off the grid, in a gap
        "2026-10-07T13:05:00Z", // off the grid, inside an interval
        "2026-10-07T11:50:00Z", // before the first step
        "2026-10-11T00:10:00Z", // after the newest step
      ]) {
        expect(removeGoesStep(FIXTURE, at(iso)), iso).toBe(FIXTURE);
      }
      const none: readonly TimeInterval[] = [];
      expect(removeGoesStep(none, at("2026-10-07T12:00:00Z"))).toBe(none);
    });

    it("the newest step trims the last interval to 23:50", () => {
      expect(removeGoesStep(FIXTURE, LATEST)).toEqual([
        FIXTURE[0],
        FIXTURE[1],
        iv("2026-10-07T21:20:00Z", "2026-10-10T23:50:00Z"),
      ]);
    });

    it("the first step trims the start to 12:10", () => {
      expect(removeGoesStep(FIXTURE, at("2026-10-07T12:00:00Z"))).toEqual([
        iv("2026-10-07T12:10:00Z", "2026-10-07T19:20:00Z"),
        FIXTURE[1],
        FIXTURE[2],
      ]);
    });

    it("a step inside an interval splits it", () => {
      expect(removeGoesStep(FIXTURE, at("2026-10-08T00:00:00Z"))).toEqual([
        FIXTURE[0],
        FIXTURE[1],
        iv("2026-10-07T21:20:00Z", "2026-10-07T23:50:00Z"),
        iv("2026-10-08T00:10:00Z", "2026-10-11T00:00:00Z"),
      ]);
    });

    it("does not mutate its input", () => {
      const copy = structuredClone(FIXTURE);
      removeGoesStep(FIXTURE, at("2026-10-08T00:00:00Z"));
      expect(FIXTURE).toEqual(copy);
    });
  });

  describe("goesStepsInRange", () => {
    const center = at("2026-10-07T19:35:00Z");
    const from = center - SCRUB_HALF_RANGE_MS;
    const to = center + SCRUB_HALF_RANGE_MS;

    it("±12 h around 2026-10-07T19:35Z gives the timeline's three segments", () => {
      expect(goesStepsInRange(FIXTURE, LATEST, from, to)).toEqual([
        iv("2026-10-07T12:00:00Z", "2026-10-07T19:20:00Z"),
        iv("2026-10-07T19:40:00Z", "2026-10-07T21:00:00Z"),
        iv("2026-10-07T21:20:00Z", "2026-10-08T07:30:00Z"),
      ]);
    });

    it("caps at latestStepMs; null means no cap", () => {
      expect(goesStepsInRange(FIXTURE, at("2026-10-07T20:00:00Z"), from, to)).toEqual([
        iv("2026-10-07T12:00:00Z", "2026-10-07T19:20:00Z"),
        iv("2026-10-07T19:40:00Z", "2026-10-07T20:00:00Z"),
      ]);
      expect(goesStepsInRange(FIXTURE, at("2026-10-07T19:30:00Z"), from, to)).toEqual([
        iv("2026-10-07T12:00:00Z", "2026-10-07T19:20:00Z"),
      ]);
      expect(goesStepsInRange(FIXTURE, at("2026-10-07T11:50:00Z"), from, to)).toEqual([]);
      expect(goesStepsInRange(FIXTURE, null, from, to)).toEqual(
        goesStepsInRange(FIXTURE, LATEST, from, to),
      );
    });

    it("rounds the range inward to whole steps", () => {
      expect(
        goesStepsInRange(FIXTURE, null, at("2026-10-07T19:05:00Z"), at("2026-10-07T19:15:00Z")),
      ).toEqual([iv("2026-10-07T19:10:00Z", "2026-10-07T19:10:00Z")]);
      expect(
        goesStepsInRange(FIXTURE, null, at("2026-10-07T19:11:00Z"), at("2026-10-07T19:19:00Z")),
      ).toEqual([]);
      expect(
        goesStepsInRange(FIXTURE, null, at("2026-10-07T19:21:00Z"), at("2026-10-07T19:39:00Z")),
      ).toEqual([]);
    });

    it("a range outside the listed window gives no ticks", () => {
      const before = at("2026-10-06T12:00:00Z");
      expect(
        goesStepsInRange(
          FIXTURE,
          LATEST,
          before - SCRUB_HALF_RANGE_MS,
          before + SCRUB_HALF_RANGE_MS,
        ),
      ).toEqual([]);
      expect(goesStepsInRange([], null, from, to)).toEqual([]);
    });
  });

  it('the "Imagery as of" time truncates to the minute', () => {
    expect(formatUtcHhMm(at("2026-10-10T09:50:59.999Z"))).toBe("09:50");
    expect(formatUtcHhMm(at("2026-10-10T23:40:00Z"))).toBe("23:40");
  });

  describe("seeded random domains agree with a step-set reference", () => {
    const BASE = at("2026-06-01T00:00:00Z");
    const N = 20_000; // steps (about 139 days): wider than the 90-day retention
    const RETENTION_STEPS = GOES_RETENTION_MS / GOES_STEP_MS;
    const stepAt = (i: number): number => BASE + i * GOES_STEP_MS;

    /** Runs of listed steps separated by gaps of 1–60 steps (live gaps reach 51). */
    function randomSteps(rand: () => number): Uint8Array {
      const on = new Uint8Array(N);
      if (rand() < 0.05) return on;
      let i = Math.floor(rand() * 200);
      while (i < N) {
        const len = 1 + Math.floor(rand() * (rand() < 0.3 ? 5 : 3000));
        on.fill(1, i, Math.min(N, i + len));
        i += len + 1 + Math.floor(rand() * 60);
      }
      return on;
    }

    function toIntervals(on: Uint8Array): TimeInterval[] {
      const out: TimeInterval[] = [];
      let start = -1;
      for (let i = 0; i <= on.length; i += 1) {
        if (i < on.length && on[i] === 1) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          out.push([stepAt(start), stepAt(i - 1)]);
          start = -1;
        }
      }
      return out;
    }

    const lastOn = (on: Uint8Array, atOrBefore: number): number => {
      for (let i = Math.min(atOrBefore, N - 1); i >= 0; i -= 1) if (on[i] === 1) return i;
      return -1;
    };

    /** "a/b/PT10M", "a/b" or "a", with a bare date for midnight half the time. */
    function domainText(intervals: readonly TimeInterval[], rand: () => number): string {
      const fmt = (ms: number): string =>
        ms % 86_400_000 === 0 && rand() < 0.5 ? isoDateUtc(ms) : isoUtcSeconds(ms);
      const items: string[] = [];
      for (const [a, b] of intervals) {
        if (a === b && rand() < 0.5) {
          items.push(fmt(a));
        } else if (b - a >= 2 * GOES_STEP_MS && rand() < 0.3) {
          // Split into two touching or overlapping items.
          const m = a + GOES_STEP_MS * Math.floor(rand() * ((b - a) / GOES_STEP_MS));
          const overlap = rand() < 0.5 ? 0 : GOES_STEP_MS;
          items.push(`${fmt(a)}/${fmt(m)}/PT10M`, `${fmt(m + GOES_STEP_MS - overlap)}/${fmt(b)}`);
        } else {
          items.push(`${fmt(a)}/${fmt(b)}/PT10M`);
        }
      }
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = items[i] as string;
        items[i] = items[j] as string;
        items[j] = tmp;
      }
      return items.join(",");
    }

    it("300 cases of parse, step, merge, remove and ticks", () => {
      const rand = mulberry32(20261011);
      const mismatches: string[] = [];
      // How often each branch ran, so the seed keeps exercising all of them.
      const seen = { nullStep: 0, listedRemove: 0, emptyNext: 0, clippedMerge: 0, splitTicks: 0 };
      for (let c = 0; c < 300; c += 1) {
        const prevOn = randomSteps(rand);
        const nextOn = randomSteps(rand);
        const prev = toIntervals(prevOn);
        const next = toIntervals(nextOn);
        const latestIndex = rand() < 0.3 ? null : Math.floor(rand() * (N + 20)) - 10;
        const latest = latestIndex === null ? null : stepAt(latestIndex);
        const cap = latestIndex ?? N;

        // parseGoesDomain round trip.
        const parsed = parseGoesDomain(domainText(prev, rand));
        if (JSON.stringify(parsed) !== JSON.stringify(prev)) mismatches.push(`${c} parse`);

        // goesStepMs.
        const t = BASE + Math.floor(rand() * (N + 20) * GOES_STEP_MS) - 10 * GOES_STEP_MS;
        const want = lastOn(prevOn, Math.min(Math.floor((t - BASE) / GOES_STEP_MS), cap));
        const got = goesStepMs(t, prev, latest);
        if (got !== (want < 0 ? null : stepAt(want))) mismatches.push(`${c} step ${t}`);
        if (want < 0) seen.nullStep += 1;

        // removeGoesStep: listed, unlisted and off-grid steps.
        const ri = Math.floor(rand() * (N + 10)) - 5;
        const offGrid = rand() < 0.1;
        const removed = removeGoesStep(prev, stepAt(ri) + (offGrid ? 300_000 : 0));
        if (offGrid || ri < 0 || ri >= N || prevOn[ri] !== 1) {
          if (removed !== prev) mismatches.push(`${c} remove unlisted ${ri}`);
        } else {
          seen.listedRemove += 1;
          const after = prevOn.slice();
          after[ri] = 0;
          if (JSON.stringify(removed) !== JSON.stringify(toIntervals(after)))
            mismatches.push(`${c} remove ${ri}`);
        }

        // mergeGoesIntervals.
        const merged = mergeGoesIntervals(prev, next);
        const nextLast = lastOn(nextOn, N - 1);
        if (nextLast < 0) {
          if (merged !== prev) mismatches.push(`${c} merge empty next`);
          seen.emptyNext += 1;
        } else {
          const result = new Uint8Array(N);
          for (let i = 0; i < N; i += 1) result[i] = (i <= nextLast ? nextOn[i] : prevOn[i]) ?? 0;
          const clip = lastOn(result, N - 1) - RETENTION_STEPS;
          if (clip > 0 && result.subarray(0, clip).includes(1)) seen.clippedMerge += 1;
          if (clip > 0) result.fill(0, 0, clip);
          if (JSON.stringify(merged) !== JSON.stringify(toIntervals(result)))
            mismatches.push(`${c} merge`);
        }

        // goesStepsInRange over a ± 12 h window, half the time within 6 h of a listed end.
        const nearEnd = prev[Math.floor(rand() * prev.length)];
        const center =
          nearEnd !== undefined && rand() < 0.5
            ? nearEnd[1] + Math.floor((rand() - 0.5) * SCRUB_HALF_RANGE_MS)
            : BASE + Math.floor(rand() * (N + 200) * GOES_STEP_MS) - 100 * GOES_STEP_MS;
        const lo = Math.ceil((center - SCRUB_HALF_RANGE_MS - BASE) / GOES_STEP_MS);
        const hi = Math.min(Math.floor((center + SCRUB_HALF_RANGE_MS - BASE) / GOES_STEP_MS), cap);
        const inRange = new Uint8Array(N);
        for (let i = Math.max(lo, 0); i <= Math.min(hi, N - 1); i += 1) inRange[i] = prevOn[i] ?? 0;
        const ticks = goesStepsInRange(
          prev,
          latest,
          center - SCRUB_HALF_RANGE_MS,
          center + SCRUB_HALF_RANGE_MS,
        );
        if (JSON.stringify(ticks) !== JSON.stringify(toIntervals(inRange)))
          mismatches.push(`${c} ticks`);
        if (ticks.length > 1) seen.splitTicks += 1;
      }
      expect(mismatches).toEqual([]);
      expect(seen.nullStep).toBeGreaterThanOrEqual(5);
      expect(seen.listedRemove).toBeGreaterThanOrEqual(100);
      expect(seen.emptyNext).toBeGreaterThanOrEqual(5);
      expect(seen.clippedMerge).toBeGreaterThanOrEqual(100);
      expect(seen.splitTicks).toBeGreaterThanOrEqual(40);
    });
  });
});

describe("live video and clip time [M5]", () => {
  // M5 section 5: anchor wall T = 2026-10-11T08:00:00Z, anchor media 4,399,105.5 s, delay 50,000 ms.
  const T = Date.parse("2026-10-11T08:00:00Z");
  const aM = 4_399_105.5;
  const DELAY = 50_000;

  it("has the 0–120 s range and the ± 10 s fine control", () => {
    expect(STREAM_DELAY_MAX_MS).toBe(120_000);
    expect(STREAM_DELAY_FINE_MS).toBe(10_000);
  });

  describe("youtubeLiveTimeMs", () => {
    it("is the anchor's wall time minus the delay at the anchor, then follows the media clock", () => {
      expect(youtubeLiveTimeMs(T, aM, aM, DELAY)).toBe(Date.parse("2026-10-11T07:59:10.000Z"));
      expect(youtubeLiveTimeMs(T, aM, aM + 20.25, DELAY)).toBe(
        Date.parse("2026-10-11T07:59:30.250Z"),
      );
    });

    it("is exact for media times that are not binary fractions", () => {
      // 4,399,125.8 − 4,399,105.8 is not exactly 20 in binary; the result still lands on the ms.
      expect(youtubeLiveTimeMs(T, 4_399_105.8, 4_399_125.8, DELAY)).toBe(T + 20_000 - 50_000);
    });

    it("freezes while the media clock stands still and goes back on a DVR rewind", () => {
      const frozen = youtubeLiveTimeMs(T, aM, aM + 7, DELAY);
      expect(youtubeLiveTimeMs(T, aM, aM + 7, DELAY)).toBe(frozen); // wall time is not an input
      expect(youtubeLiveTimeMs(T, aM, aM - 30, DELAY)).toBe(T - 30_000 - DELAY);
    });
  });

  describe("youtubeStallMs", () => {
    it("adds pauses and stalls and subtracts a skip forward", () => {
      expect(youtubeStallMs(T, aM, T + 30_000, aM + 20)).toBe(10_000);
      expect(youtubeStallMs(T, aM, T + 10_000, aM + 13)).toBe(-3_000);
      expect(youtubeStallMs(T, aM, T, aM)).toBe(0);
    });

    it("plus the delay is how far the sky is behind real time", () => {
      const nowMs = T + 30_000;
      const mediaSec = aM + 20;
      const behindMs = DELAY + youtubeStallMs(T, aM, nowMs, mediaSec);
      expect(nowMs - youtubeLiveTimeMs(T, aM, mediaSec, DELAY)).toBe(behindMs); // 60 s
      expect(behindMs).toBe(60_000);
    });
  });

  describe("streamDelayForFrameMs", () => {
    it("gives the delay that puts the frame on screen at its known UTC", () => {
      const frameUtcMs = T - 61_250;
      const delay = streamDelayForFrameMs(T, aM, aM + 20.25, frameUtcMs);
      expect(delay).toBe(81_500);
      expect(youtubeLiveTimeMs(T, aM, aM + 20.25, delay)).toBe(frameUtcMs);
    });

    it("round-trips exactly through youtubeLiveTimeMs for awkward media times", () => {
      const rand = mulberry32(5);
      for (let i = 0; i < 1_000; i += 1) {
        const anchorMediaSec = 4_000_000 + rand() * 1_000_000;
        const mediaSec = anchorMediaSec + (rand() - 0.2) * 7_200;
        const frameUtcMs = T - 120_000 + Math.round(rand() * 7_200_000) + 0.5;
        const delay = streamDelayForFrameMs(T, anchorMediaSec, mediaSec, frameUtcMs);
        expect(youtubeLiveTimeMs(T, anchorMediaSec, mediaSec, delay)).toBe(frameUtcMs);
      }
    });

    it("equals (now − frame time) − stall, the suggestion's formula", () => {
      const nowMs = T + 40_000;
      const mediaSec = aM + 30;
      const mrtMs = T + 19_100; // a getMediaReferenceTime reading
      expect(streamDelayForFrameMs(T, aM, mediaSec, mrtMs)).toBe(
        nowMs - mrtMs - youtubeStallMs(T, aM, nowMs, mediaSec),
      );
    });
  });

  describe("clampStreamDelayMs", () => {
    it("rounds to whole ms and clamps to [0, 120 s]", () => {
      expect(clampStreamDelayMs(-5)).toBe(0);
      expect(clampStreamDelayMs(130_000)).toBe(120_000);
      expect(clampStreamDelayMs(50_000.4)).toBe(50_000);
      expect(clampStreamDelayMs(49_999.5)).toBe(50_000);
      expect(clampStreamDelayMs(0)).toBe(0);
      expect(clampStreamDelayMs(120_000)).toBe(120_000);
    });

    it("never returns −0", () => {
      expect(Object.is(clampStreamDelayMs(-0.4), 0)).toBe(true);
      expect(Object.is(clampStreamDelayMs(-0), 0)).toBe(true);
    });

    it("clamps the fine control's ends: centre ± 10 s stays inside the slider range", () => {
      expect(clampStreamDelayMs(5_000 - STREAM_DELAY_FINE_MS)).toBe(0);
      expect(clampStreamDelayMs(115_000 + STREAM_DELAY_FINE_MS)).toBe(STREAM_DELAY_MAX_MS);
      expect(clampStreamDelayMs(50_000 + 0.1 * 1_000)).toBe(50_100);
    });
  });

  describe("localVideoTimeMs and clipStartUtcMs", () => {
    const S = Date.parse("2026-10-11T08:00:00.000Z");

    it("maps media seconds to UTC from the clip's start", () => {
      expect(localVideoTimeMs(S, 2.25)).toBe(Date.parse("2026-10-11T08:00:02.250Z"));
      expect(localVideoTimeMs(S, 0)).toBe(S);
      expect(localVideoTimeMs(S, 7)).toBe(S + 7_000);
    });

    it("recovers the start from one frame whose UTC is known", () => {
      expect(clipStartUtcMs(Date.parse("2026-10-11T08:00:12.500Z"), 12.5)).toBe(S);
      // The 2026-10-11 clip: 05:08:31 HST begins at media 0.816667 s (README "Recorded clips").
      const start = clipStartUtcMs(Date.parse("2026-10-11T15:08:31.000Z"), 0.816667);
      expect(Math.abs(start - 1_791_731_310_183)).toBeLessThanOrEqual(1);
    });

    it("inverts localVideoTimeMs", () => {
      const start = 1_791_731_310_183;
      for (const mediaSec of [0, 0.8, 0.833333, 150.833333, 479.933333]) {
        const utcMs = localVideoTimeMs(start, mediaSec);
        expect(clipStartUtcMs(utcMs, mediaSec)).toBeCloseTo(start, 6);
      }
    });
  });
});
