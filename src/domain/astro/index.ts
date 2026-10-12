// src/domain/astro/index.ts — Sun, Moon, planets, stars, twilight. PlanetName lands in M0, everything else in M2.
// Every astronomy-engine call gets a Date or an AstroTime, never a number (a number means days since J2000).

export type PlanetName = "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn" | "Uranus";

export {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  bodyAirlessAzAltDeg,
  computeBodies,
  makeObserver,
} from "./bodies";
export {
  apparentAltDeg,
  geometricAltDeg,
  needsSkyRecompute,
  rotateStarsAzAltDeg,
  type StarRow,
  starUnitVectors,
} from "./stars";
export { civilTwilightMs, sunGeometricAltDeg, twilightMarkersMs } from "./twilight";
