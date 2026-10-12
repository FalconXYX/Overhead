// src/ui/streamDelayText.ts — the stream-delay section's readouts and its two delay calculations (M5 step 9), as
// plain functions, so StreamDelaySection stays a React Fast Refresh boundary and the arithmetic is unit-tested.
import {
  formatZonedDateTime,
  localDateTimeToUtcMs,
  STREAM_DELAY_MAX_MS,
  streamDelayForFrameMs,
  youtubeStallMs,
} from "../domain/time";

/** The YouTube media clock's anchor (step 5.6). */
export interface DelayAnchor {
  readonly wallMs: number;
  readonly mediaSec: number;
}

/** A burned-in second is shown for a whole second: its reading is the middle of it (DECISIONS, M5). */
export const BURNED_IN_CLOCK_OFFSET_MS = 500;

/** "50.0" for 50,000 ms: one decimal, as every delay readout and aria-valuetext shows it. */
export function secondsText(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** "50.0 seconds", the aria-valuetext of the delay inputs. */
export function secondsValueText(ms: number): string {
  return `${secondsText(ms)} seconds`;
}

/** The pauses and buffering since the anchor, ms; 0 before it or while the media time is unknown. */
export function stallSinceAnchorMs(
  anchor: DelayAnchor | null,
  mediaSec: number | null,
  nowMs: number,
): number {
  return anchor === null || mediaSec === null
    ? 0
    : youtubeStallMs(anchor.wallMs, anchor.mediaSec, nowMs, mediaSec);
}

/** "Behind real time now: 60.0 s (10.0 s of pauses and buffering)". */
export function behindRealTimeText(delayMs: number, stallMs: number): string {
  return `Behind real time now: ${secondsText(delayMs + stallMs)} s (${secondsText(stallMs)} s of pauses and buffering)`;
}

const zoneNames = new Map<string, Intl.DateTimeFormat>();

/** "HST" for Pacific/Honolulu at that time (the zone's short name); "" when the runtime has none. */
function zoneAbbreviation(timeMs: number, timeZone: string): string {
  let format = zoneNames.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" });
    zoneNames.set(timeZone, format);
  }
  return format.formatToParts(new Date(timeMs)).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** "Sky time: 21:59:10 HST" in the site's zone: compare it with the burned-in clock on the video. */
export function skyTimeText(simTimeMs: number, timeZone: string): string {
  const clock = formatZonedDateTime(simTimeMs, timeZone).slice(11, 19);
  const zone = zoneAbbreviation(simTimeMs, timeZone);
  return `Sky time: ${clock}${zone === "" ? "" : ` ${zone}`}`;
}

/** The datetime-local value for a time in an IANA zone: "2026-10-10T21:59:10". */
export function zonedInputValue(timeMs: number, timeZone: string): string {
  return formatZonedDateTime(timeMs, timeZone).replace(" ", "T");
}

/** What applying a burned-in clock reading gives (step 9.5). */
export type ClockEntryResult =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "out-of-range"; readonly message: string }
  | { readonly kind: "ok"; readonly delayMs: number };

/**
 * The delay that puts the sky at the burned-in clock reading `localValue` (site zone, + 500 ms) for the frame shown at
 * `mediaSec`. A reading that does not parse, or a delay outside [0, 120 s], changes nothing.
 */
export function delayFromClockEntry(
  localValue: string,
  timeZone: string,
  anchor: DelayAnchor,
  mediaSec: number,
): ClockEntryResult {
  const readingMs = localDateTimeToUtcMs(localValue, timeZone);
  if (readingMs === null) return { kind: "invalid", message: "Enter a valid date and time" };
  const delayMs = streamDelayForFrameMs(
    anchor.wallMs,
    anchor.mediaSec,
    mediaSec,
    readingMs + BURNED_IN_CLOCK_OFFSET_MS,
  );
  if (!(delayMs >= 0 && delayMs <= STREAM_DELAY_MAX_MS)) {
    return {
      kind: "out-of-range",
      message: `That gives a delay of ${secondsText(delayMs)} s; check the time`,
    };
  }
  return { kind: "ok", delayMs };
}

/**
 * The player's suggestion from getMediaReferenceTime (undocumented, step 9.6), rounded to 0.1 s: it equals
 * (now − mrt) − stall. Null without an anchor, a media time or a reference time.
 */
export function suggestedDelayMs(
  anchor: DelayAnchor | null,
  mediaSec: number | null,
  mediaReferenceMs: number | null,
): number | null {
  if (anchor === null || mediaSec === null || mediaReferenceMs === null) return null;
  const ms = streamDelayForFrameMs(anchor.wallMs, anchor.mediaSec, mediaSec, mediaReferenceMs);
  return Number.isFinite(ms) ? Math.round(ms / 100) * 100 : null;
}
