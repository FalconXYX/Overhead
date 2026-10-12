// localDateTimeToUtcMs (M4 step 7): burned-in clocks read in an IANA zone. The M4 section 5 "time.test.ts" row,
// kept in its own file so the M4 work merges without touching time.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { localDateTimeToUtcMs } from "../../src/domain/time";

const at = (iso: string): number => Date.parse(iso);

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Every case of the section 5 row: [localIso, zone, expected epoch ms or null]. */
const CASES: readonly (readonly [string, string, number | null])[] = [
  ["2026-10-11T06:04:01", "Europe/Vaduz", at("2026-10-11T04:04:01Z")],
  ["2025-07-15T20:47", "Pacific/Honolulu", at("2025-07-16T06:47:00Z")],
  // ASK053's frame fetched 2026-10-11T10:09:27Z showed "11-10-2026 12:08:01"
  ["2026-10-11T12:08:01", "Europe/Vaduz", at("2026-10-11T10:08:01Z")],
  // Spring forward in Vaduz: 02:00–02:59 does not exist on 2026-03-29
  ["2026-03-29T02:30", "Europe/Vaduz", null],
  ["2026-03-29T03:00", "Europe/Vaduz", at("2026-03-29T01:00:00Z")],
  // Fall back: 02:00–02:59 happens twice on 2026-10-25; the earlier instant wins
  ["2026-10-25T02:30", "Europe/Vaduz", at("2026-10-25T00:30:00Z")],
  ["2026-10-25T03:00", "Europe/Vaduz", at("2026-10-25T02:00:00Z")],
  // Malformed, impossible, unknown zone
  ["11-10-2026 06:04:01", "Europe/Vaduz", null],
  ["2026-02-30T00:00", "Europe/Vaduz", null],
  ["2026-10-11T24:00", "Europe/Vaduz", null],
  ["2026-10-11T23:60", "Europe/Vaduz", null],
  ["2026-10-11T23:59:60", "Europe/Vaduz", null],
  ["2026-10-11 06:04", "Europe/Vaduz", null],
  ["2026-10-11T06:04:01.5", "Europe/Vaduz", null],
  ["2026-10-11T06:04:01", "Not/AZone", null],
  ["2026-10-11T06:04:01", "", null],
];

describe("localDateTimeToUtcMs", () => {
  it("reads every case of the M4 section 5 row exactly", () => {
    for (const [localIso, zone, expected] of CASES) {
      expect([localIso, zone, localDateTimeToUtcMs(localIso, zone)]).toEqual([
        localIso,
        zone,
        expected,
      ]);
    }
  });

  it("gives the same results whatever the process time zone (Honolulu, Kolkata)", () => {
    for (const tz of ["Pacific/Honolulu", "Asia/Kolkata", "UTC"]) {
      process.env.TZ = tz;
      for (const [localIso, zone, expected] of CASES) {
        expect([tz, localIso, localDateTimeToUtcMs(localIso, zone)]).toEqual([
          tz,
          localIso,
          expected,
        ]);
      }
    }
  });

  it("Honolulu has no DST: every wall minute of a day maps to exactly +10 h", () => {
    const base = at("2026-10-11T00:00:00Z");
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const hh = String(Math.floor(minute / 60)).padStart(2, "0");
      const mm = String(minute % 60).padStart(2, "0");
      expect(localDateTimeToUtcMs(`2026-10-11T${hh}:${mm}`, "Pacific/Honolulu")).toBe(
        base + minute * 60_000 + 10 * 3_600_000,
      );
    }
  });
});
