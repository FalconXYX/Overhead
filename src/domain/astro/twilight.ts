// src/domain/astro/twilight.ts — civil twilight (Sun's geometric altitude −6°) for the timeline markers.
import {
  type AstroTime,
  Body,
  Equator,
  Horizon,
  type Observer,
  SearchAltitude,
} from "astronomy-engine";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Civil twilight: the Sun's centre at −6° geometric (SearchAltitude's altitude is unrefracted). */
const CIVIL_TWILIGHT_ALT_DEG = -6;

/** Horizon(t, obs, ra, dec) with no refraction (the SearchAltitude convention). */
export function sunGeometricAltDeg(time: AstroTime, observer: Observer): number {
  const eq = Equator(Body.Sun, time, observer, true, true);
  return Horizon(time, observer, eq.ra, eq.dec).altitude;
}

/**
 * SearchAltitude(Body.Sun, obs, direction, start, limitDays, −6)?.date: −1 = civil dusk (the end of evening civil
 * twilight), +1 = civil dawn. A positive limitDays searches forward only; a negative one would search backward.
 */
export function civilTwilightMs(
  observer: Observer,
  startMs: number,
  direction: -1 | 1,
  limitDays: number,
): number | null {
  return (
    SearchAltitude(
      Body.Sun,
      observer,
      direction,
      new Date(startMs),
      limitDays,
      CIVIL_TWILIGHT_ALT_DEG,
    )?.date.getTime() ?? null
  );
}

/**
 * Every civil dusk and dawn inside [centerMs − halfRangeMs, centerMs + halfRangeMs], ascending. Searches forward
 * only, restarting 1 h after each hit (same-direction crossings are about 24 h apart, and a restart at the hit
 * itself can find it again). Polar day or night gives empty arrays. Call it when the range or the site changes,
 * never per frame.
 */
export function twilightMarkersMs(
  observer: Observer,
  centerMs: number,
  halfRangeMs: number,
): { duskMs: number[]; dawnMs: number[] } {
  const windowEnd = centerMs + halfRangeMs;
  const crossings = (direction: -1 | 1): number[] => {
    const hits: number[] = [];
    let searchStart = centerMs - halfRangeMs;
    // searchStart < windowEnd keeps limitDays positive: a negative value searches backward.
    while (searchStart < windowEnd) {
      const hit = civilTwilightMs(
        observer,
        searchStart,
        direction,
        (windowEnd - searchStart) / DAY_MS,
      );
      if (hit === null || hit > windowEnd) break;
      hits.push(hit);
      searchStart = Math.max(hit, searchStart) + HOUR_MS;
    }
    return hits;
  };
  return { duskMs: crossings(-1), dawnMs: crossings(1) };
}
