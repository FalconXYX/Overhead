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
export const STREAM_DELAY_MAX_MS = 120_000; // [M5]
export const STREAM_DELAY_FINE_MS = 10_000; // [M5]

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

// [M5] Live YouTube and local clips (M5 step 1). Wall-clock and UTC times in epoch ms, media times in seconds.
// The anchor is the first PLAYING with a finite getCurrentTime() > 0; streamDelayMs is the latency there.

/** [M5] Live YouTube: anchorWallMs + (mediaSec − anchorMediaSec) × 1000 − streamDelayMs. Freezes while the player stalls. */
export function youtubeLiveTimeMs(
  anchorWallMs: number,
  anchorMediaSec: number,
  mediaSec: number,
  streamDelayMs: number,
): number {
  return anchorWallMs + (mediaSec - anchorMediaSec) * 1000 - streamDelayMs;
}

/** [M5] Rounds to whole ms and clamps to [0, STREAM_DELAY_MAX_MS]. Callers drop non-finite input first. */
export function clampStreamDelayMs(ms: number): number {
  // Math.max(−0, 0) is +0, so a tiny negative input never comes back as −0.
  return Math.min(Math.max(Math.round(ms), 0), STREAM_DELAY_MAX_MS);
}

/** [M5] (nowMs − anchorWallMs) − (mediaSec − anchorMediaSec) × 1000: pauses and stalls add, a skip forward subtracts. */
export function youtubeStallMs(
  anchorWallMs: number,
  anchorMediaSec: number,
  nowMs: number,
  mediaSec: number,
): number {
  return nowMs - anchorWallMs - (mediaSec - anchorMediaSec) * 1000;
}

/** [M5] The streamDelayMs that makes youtubeLiveTimeMs(...) equal frameUtcMs for the frame shown at mediaSec. */
export function streamDelayForFrameMs(
  anchorWallMs: number,
  anchorMediaSec: number,
  mediaSec: number,
  frameUtcMs: number,
): number {
  // The same expression youtubeLiveTimeMs evaluates, so feeding the result back returns frameUtcMs exactly:
  // x − (x − f) is exact for epoch-ms values within a factor of 2 of each other (Sterbenz).
  return youtubeLiveTimeMs(anchorWallMs, anchorMediaSec, mediaSec, 0) - frameUtcMs;
}

/** [M5] Local video: startUtcMs + mediaTimeSec × 1000. */
export function localVideoTimeMs(startUtcMs: number, mediaTimeSec: number): number {
  return startUtcMs + mediaTimeSec * 1000;
}

/** [M5] UTC of media time 0 from one frame whose UTC is known. */
export function clipStartUtcMs(frameUtcMs: number, mediaSec: number): number {
  return frameUtcMs - mediaSec * 1000;
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

// [M7] GOES-West availability from GIBS DescribeDomains. Every list of TimeIntervals here is sorted, disjoint and on
// the 10-minute grid, with at least one missing step between neighbours; the functions keep it that way.

export const GOES_STEP_MS = 600_000; // [M7]
export const GOES_RETENTION_MS = 7_776_000_000; // [M7] 90 days

/** Smallest multiple of GOES_STEP_MS ≥ timeMs. */
function ceilToGoesStepMs(timeMs: number): number {
  return -floorToStepMs(-timeMs, GOES_STEP_MS);
}

/** "YYYY-MM-DDThh:mm:ssZ" or a bare "YYYY-MM-DD" (00:00:00Z), as GIBS writes them. */
const GOES_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z)?$/;

/** Epoch ms of one DescribeDomains time; throws unless it round-trips (Date.UTC would roll 2026-13-45 over). */
function parseGoesTimeMs(text: string): number {
  const m = GOES_TIME_RE.exec(text);
  if (m !== null) {
    const timeMs = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    );
    const canonical = m[4] === undefined ? `${text}T00:00:00Z` : text;
    if (Number.isFinite(timeMs) && isoUtcSeconds(timeMs) === canonical) return timeMs;
  }
  throw new Error(`GOES domain: malformed time "${text}"`);
}

/** Joins intervals sorted by start that overlap or touch (no missing step between them). */
function joinSortedIntervals(sorted: readonly TimeInterval[]): TimeInterval[] {
  const out: TimeInterval[] = [];
  let last: TimeInterval | undefined;
  for (const interval of sorted) {
    if (last !== undefined && interval[0] <= last[1] + GOES_STEP_MS) {
      if (interval[1] > last[1]) {
        last = [last[0], interval[1]];
        out[out.length - 1] = last;
      }
    } else {
      last = interval;
      out.push(interval);
    }
  }
  return out;
}

/** Index of the last interval whose start is ≤ timeMs, or −1 (binary search). */
function lastStartingAtOrBefore(intervals: readonly TimeInterval[], timeMs: number): number {
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const interval = intervals[mid];
    if (interval !== undefined && interval[0] <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * [M7] Parses a GIBS <Domain> text "a/b/PT10M,c/d/PT10M,..." (items may also be "a/b" or "a"). A bare
 * "YYYY-MM-DD" is 00:00:00Z. Starts snap up and ends down to the 10-minute grid; empty items drop; the rest
 * are sorted and touching intervals joined. "" gives []. Throws on a malformed time or a period other than PT10M.
 */
export function parseGoesDomain(domain: string): TimeInterval[] {
  const text = domain.trim();
  if (text === "") return [];
  const items: TimeInterval[] = [];
  for (const item of text.split(",")) {
    const parts = item.trim().split("/");
    if (parts.length > 3 || (parts.length === 3 && parts[2] !== "PT10M"))
      throw new Error(`GOES domain: unsupported item "${item}"`);
    const startText = parts[0] ?? "";
    const startMs = ceilToGoesStepMs(parseGoesTimeMs(startText));
    const endMs = floorToStepMs(parseGoesTimeMs(parts[1] ?? startText), GOES_STEP_MS);
    if (startMs <= endMs) items.push([startMs, endMs]);
  }
  items.sort((a, b) => a[0] - b[0]);
  return joinSortedIntervals(items);
}

/**
 * [M7] Latest step ≤ floor10(timeMs) that lies inside an interval and ≤ latestStepMs (null: no cap); null if none.
 * In a gap it gives the last step before the gap.
 */
export function goesStepMs(
  timeMs: number,
  intervals: readonly TimeInterval[],
  latestStepMs: number | null,
): number | null {
  let stepMs = floorToStepMs(timeMs, GOES_STEP_MS);
  if (latestStepMs !== null) stepMs = Math.min(stepMs, floorToStepMs(latestStepMs, GOES_STEP_MS));
  const interval = intervals[lastStartingAtOrBefore(intervals, stepMs)];
  if (interval === undefined) return null;
  return stepMs <= interval[1] ? stepMs : interval[1];
}

/**
 * [M7] A fresh poll merged into the stored domain: steps up to next's last step come from next, later steps of prev
 * are kept (a lagging replica never shrinks the end), touching intervals join, and the result is clipped to steps
 * ≥ ceil10(newest end − GOES_RETENTION_MS). An empty next returns prev itself.
 */
export function mergeGoesIntervals(
  prev: readonly TimeInterval[],
  next: readonly TimeInterval[],
): readonly TimeInterval[] {
  if (next.length === 0) return prev;
  let nextLastMs = Number.NEGATIVE_INFINITY;
  for (const interval of next) nextLastMs = Math.max(nextLastMs, interval[1]);
  const items: TimeInterval[] = [...next];
  const firstKeptMs = nextLastMs + GOES_STEP_MS;
  for (const interval of prev) {
    if (interval[1] < firstKeptMs) continue;
    items.push(interval[0] >= firstKeptMs ? interval : [firstKeptMs, interval[1]]);
  }
  items.sort((a, b) => a[0] - b[0]);
  const joined = joinSortedIntervals(items);
  const newest = joined[joined.length - 1];
  if (newest === undefined) return joined;
  const minStartMs = ceilToGoesStepMs(newest[1] - GOES_RETENTION_MS);
  const out: TimeInterval[] = [];
  for (const interval of joined) {
    if (interval[1] < minStartMs) continue;
    out.push(interval[0] >= minStartMs ? interval : [minStartMs, interval[1]]);
  }
  return out;
}

/** [M7] Splits the interval that lists stepMs; returns the same reference when stepMs is not a listed step. */
export function removeGoesStep(
  intervals: readonly TimeInterval[],
  stepMs: number,
): readonly TimeInterval[] {
  if (floorToStepMs(stepMs, GOES_STEP_MS) !== stepMs) return intervals;
  const index = lastStartingAtOrBefore(intervals, stepMs);
  const interval = intervals[index];
  if (interval === undefined || stepMs > interval[1]) return intervals;
  const parts: TimeInterval[] = [];
  if (interval[0] < stepMs) parts.push([interval[0], stepMs - GOES_STEP_MS]);
  if (stepMs < interval[1]) parts.push([stepMs + GOES_STEP_MS, interval[1]]);
  return [...intervals.slice(0, index), ...parts, ...intervals.slice(index + 1)];
}

/** [M7] Timeline ticks: each interval clipped to [ceil10(fromMs), floor10(toMs)] and ≤ latestStepMs (null: no cap). */
export function goesStepsInRange(
  intervals: readonly TimeInterval[],
  latestStepMs: number | null,
  fromMs: number,
  toMs: number,
): TimeInterval[] {
  const loMs = ceilToGoesStepMs(fromMs);
  let hiMs = floorToStepMs(toMs, GOES_STEP_MS);
  if (latestStepMs !== null) hiMs = Math.min(hiMs, floorToStepMs(latestStepMs, GOES_STEP_MS));
  const out: TimeInterval[] = [];
  if (!(loMs <= hiMs)) return out;
  for (let i = Math.max(lastStartingAtOrBefore(intervals, loMs), 0); i < intervals.length; i += 1) {
    const interval = intervals[i];
    if (interval === undefined || interval[0] > hiMs) break;
    if (interval[1] < loMs) continue;
    out.push([Math.max(interval[0], loMs), Math.min(interval[1], hiMs)]);
  }
  return out;
}

/**
 * [M4] "2026-10-11T06:04:01" (seconds optional) read off a burned-in clock in an IANA zone → epoch ms.
 * null if malformed, an impossible date, an unknown zone, or a wall time skipped by a DST change;
 * an ambiguous wall time (the repeated autumn hour) gives the earlier instant.
 */
export function localDateTimeToUtcMs(localIso: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localIso);
  if (m === null) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(y, mo - 1, d, h, mi, s); // the wall-clock fields read as if they were UTC
  const back = new Date(wall);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    s > 59
  )
    return null; // 2026-02-30 rolls over
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null; // RangeError: unknown time zone
  }
  /** The zone's wall clock at instant t, read as if it were UTC. */
  const wallAt = (t: number): number => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(t)) {
      if (part.type !== "literal") p[part.type] = Number(part.value);
    }
    return Date.UTC(
      p.year ?? 0,
      (p.month ?? 1) - 1,
      p.day ?? 1,
      p.hour ?? 0,
      p.minute ?? 0,
      p.second ?? 0,
    );
  };
  // The zone offsets a day either side cover any DST change; keep the earliest instant whose wall clock matches.
  const day = 86_400_000;
  const candidates = [
    wall - (wallAt(wall - day) - (wall - day)),
    wall - (wallAt(wall + day) - (wall + day)),
  ];
  const hits = candidates.filter((t) => wallAt(t) === wall);
  return hits.length === 0 ? null : Math.min(...hits);
}
