// src/ui/controlBarText.ts — [Redesign] the control bar's words (redesign spec section 3): the local time at the
// camera in plain words. UTC goes only in the tooltip.
import { formatZonedDateTime } from "../domain/time";

/** A time zone as a place people know; else the zone's city ("America/New_York" → "New York"). */
const PLACES: Readonly<Record<string, string>> = {
  "Pacific/Honolulu": "Hawaii",
  "Europe/Zurich": "Switzerland",
  // [Polish] The coming StarCams: Kiso, Kōzushima and Fukushima in Japan; ALMA in Chile.
  "Asia/Tokyo": "Japan",
  "America/Santiago": "Chile",
};

export function placeOfZone(timeZone: string): string {
  return PLACES[timeZone] ?? (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
}

/** "05:10 in Hawaii": the camera's local time, to the minute (24-hour, truncated). */
export function localTimeWords(timeMs: number, timeZone: string): string {
  return `${formatZonedDateTime(timeMs, timeZone).slice(11, 16)} in ${placeOfZone(timeZone)}`;
}

/** The local time's tooltip: "2026-10-11 15:09:50 UTC". */
export function utcTooltip(timeMs: number): string {
  const iso = new Date(timeMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}
