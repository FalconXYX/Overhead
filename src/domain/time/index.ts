// src/domain/time/index.ts — epoch-ms arithmetic. No Date objects leave this module.
// M0–M3 subset; the rest of the README section 6 API lands with its first user.

export type ClockRate = 1 | 10 | 60 | 600;
/** Closed interval of available imagery steps, epoch ms: [firstStepMs, lastStepMs]. */
export type TimeInterval = readonly [startMs: number, endMs: number];

export const MAX_WALL_DELTA_MS = 250; // [M0]
export const SCRUB_HALF_RANGE_MS = 43_200_000; // [M0]
export const SKY_RECOMPUTE_MS = 2_000; // [M2]
export const BASE_SAMPLE_STEP_MS = 100; // [M3]
export const TRACK_STEP_MS = 20_000; // [M3]

/** [M3] Propagation grid spacing D = 100 ms × rate (live mode passes rate 1). */
export function sampleStepMs(rate: ClockRate): number {
  return BASE_SAMPLE_STEP_MS * rate;
}

/** [M3] Math.floor(timeMs / stepMs) × stepMs. */
export function floorToStepMs(timeMs: number, stepMs: number): number {
  return Math.floor(timeMs / stepMs) * stepMs;
}

/** OMM EPOCH: "YYYY-MM-DDThh:mm:ss" with optional fractional seconds and an optional trailing Z. */
const OMM_EPOCH_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * [M3] CelesTrak EPOCH has no zone suffix: append "Z" before parsing. Sub-millisecond digits are truncated, like the
 * `new Date(EPOCH + "Z")` inside satellite.js json2satrec. NaN for anything else, including impossible calendar dates
 * (Date.parse would roll 2026-02-30 over to March).
 */
export function parseOmmEpochMs(epoch: string): number {
  const m = OMM_EPOCH_RE.exec(epoch);
  if (m === null) return Number.NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthDays = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day < 1 || day > monthDays || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59)
    return Number.NaN;
  return Date.parse(epoch.endsWith("Z") ? epoch : `${epoch}Z`);
}

/** [M0] Replay without video: simTimeMs + min(max(wallDeltaMs, 0), 250) × rate. */
export function advanceReplayMs(simTimeMs: number, wallDeltaMs: number, rate: ClockRate): number {
  return simTimeMs + Math.min(Math.max(wallDeltaMs, 0), MAX_WALL_DELTA_MS) * rate;
}

/** [M0] Clamps into [centerMs − 12 h, centerMs + 12 h], inclusive. */
export function clampToScrubRangeMs(timeMs: number, centerMs: number): number {
  return Math.min(Math.max(timeMs, centerMs - SCRUB_HALF_RANGE_MS), centerMs + SCRUB_HALF_RANGE_MS);
}

/** [M0] "2026-10-11T03:20:00Z" (seconds, truncated, never rounded; GIBS rejects "hh:mmZ"). */
export function isoUtcSeconds(timeMs: number): string {
  return `${new Date(timeMs).toISOString().slice(0, 19)}Z`;
}

/** [M1] "2026-10-11". */
export function isoDateUtc(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

/** [M2] "03:20" for twilight markers and the "Imagery as of HH:MM UTC" label; truncates to the minute. */
export function formatUtcHhMm(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(11, 16);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** NOAA-20's afternoon pass: 13:30 local mean solar time. */
const TRUE_COLOR_PASS_LOCAL_H = 13.5;
/** Imagery is requested only for a pass at least this old (observed latency 2–3.5 h). */
const TRUE_COLOR_LATENCY_MS = 4 * HOUR_MS;

// One-entry cache: the per-frame selector allocates nothing while the pass is unchanged.
let lastPassMs = Number.NaN;
let lastPassDate = "";

/**
 * [M1] UTC date of the latest 13:30 local-mean-solar-time pass (NOAA-20's afternoon pass, local time = UTC + lon/15 h)
 * at siteLonDeg that is at least 4 h before timeMs. Flips at 03:51:52.536Z at Maunakea.
 */
export function trueColorDateUtc(timeMs: number, siteLonDeg: number): string {
  // The pass's UTC time of day; may be negative or above 24 h.
  const passOffsetMs = (TRUE_COLOR_PASS_LOCAL_H - siteLonDeg / 15) * HOUR_MS;
  const passMs =
    Math.floor((timeMs - TRUE_COLOR_LATENCY_MS - passOffsetMs) / DAY_MS) * DAY_MS + passOffsetMs;
  if (passMs !== lastPassMs) {
    lastPassMs = passMs;
    lastPassDate = isoDateUtc(passMs);
  }
  return lastPassDate;
}

const zonedFormats = new Map<string, Intl.DateTimeFormat>();

/** [M1] "2026-10-09 17:30:00" (24-hour) in an IANA zone; one cached Intl.DateTimeFormat per zone. */
export function formatZonedDateTime(timeMs: number, timeZone: string): string {
  let format = zonedFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormats.set(timeZone, format);
  }
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of format.formatToParts(new Date(timeMs))) part[type] = value;
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
}
