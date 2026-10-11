import { describe, expect, it } from "vitest";
import {
  advanceReplayMs,
  clampToScrubRangeMs,
  isoUtcSeconds,
  MAX_WALL_DELTA_MS,
  SCRUB_HALF_RANGE_MS,
} from "../../src/domain/time";

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
