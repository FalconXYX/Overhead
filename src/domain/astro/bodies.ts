// src/domain/astro/bodies.ts — Sun, Moon and planets: apparent az/alt, magnitude and phase per pass.
import {
  type AstroTime,
  Body,
  Equator,
  Horizon,
  Illumination,
  MakeTime,
  Observer,
} from "astronomy-engine";
import type { ObserverSite } from "../geo";

/** Fixed body order for every body array: sun, moon, then planets. */
export const BODY_IDS = [
  "sun",
  "moon",
  "planet:Mercury",
  "planet:Venus",
  "planet:Mars",
  "planet:Jupiter",
  "planet:Saturn",
  "planet:Uranus",
] as const;

/** Fields per body in a body array: [azDeg, altDeg (apparent, 'normal'), mag, phaseFraction]. */
export const BODY_STRIDE = 4;

/** astronomy-engine bodies in BODY_IDS order. */
const BODIES: readonly Body[] = [
  Body.Sun,
  Body.Moon,
  Body.Mercury,
  Body.Venus,
  Body.Mars,
  Body.Jupiter,
  Body.Saturn,
  Body.Uranus,
];

/** Build once per site, not per pass. heightM is the lens height above mean sea level. */
export function makeObserver(site: ObserverSite): Observer {
  return new Observer(site.latDeg, site.lonDeg, site.heightM);
}

/** MakeTime(new Date(timeMs)). Build one per pass and reuse it: a bare number means days since J2000. */
export function astroTimeAt(timeMs: number): AstroTime {
  return MakeTime(new Date(timeMs));
}

/**
 * Equator(body, t, obs, true, true) then Horizon(..., 'normal') and Illumination for all BODY_IDS, written into
 * out (length 8 × BODY_STRIDE) as [azDeg, altDeg, mag, phaseFraction]. The library allocates per body; for 8
 * bodies that is accepted.
 */
export function computeBodies(time: AstroTime, observer: Observer, out: Float64Array): void {
  for (let i = 0; i < BODIES.length; i++) {
    const body = BODIES[i];
    if (body === undefined) continue;
    const eq = Equator(body, time, observer, true, true);
    const hor = Horizon(time, observer, eq.ra, eq.dec, "normal");
    const illum = Illumination(body, time);
    const o = i * BODY_STRIDE;
    out[o] = hor.azimuth;
    out[o + 1] = hor.altitude;
    out[o + 2] = illum.mag;
    out[o + 3] = illum.phase_fraction;
  }
}

/**
 * The same pipeline with no refraction argument (airless), for the Horizons AIRLESS fixture.
 * Writes [azDeg, altDeg] at out[offset]. Throws RangeError for an index outside 0–7.
 */
export function bodyAirlessAzAltDeg(
  bodyIndex: number,
  time: AstroTime,
  observer: Observer,
  out: Float64Array,
  offset: number,
): void {
  const body = Number.isInteger(bodyIndex) ? BODIES[bodyIndex] : undefined;
  if (body === undefined) throw new RangeError(`body index ${bodyIndex} is outside 0–7`);
  const eq = Equator(body, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec);
  out[offset] = hor.azimuth;
  out[offset + 1] = hor.altitude;
}
