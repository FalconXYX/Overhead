// src/state/objectId.ts — ObjectId strings: `?sel=`, picking and the Inspector (M3 step 12.3).
import { BODY_IDS } from "../domain/astro";
import type { ObjectId, SatId, StarId } from "./types";

/** NORAD_CAT_ID: 1–9 digits, no leading 0 (6-digit ids exist; never assume 5). */
const SAT_RE = /^sat:[1-9]\d{0,8}$/;
/** BSC5 HR number: 1–4 digits, no leading 0; isStarId adds the upper bound. */
const STAR_RE = /^star:[1-9]\d{0,3}$/;
const STAR_HR_MAX = 9110;

/** "sun", "moon" and "planet:<PlanetName>" in exact case: the same list the sky map draws. */
const BODY_ID_SET: ReadonlySet<string> = new Set(BODY_IDS);

function isBodyId(raw: string): raw is (typeof BODY_IDS)[number] {
  return BODY_ID_SET.has(raw);
}

function isSatId(raw: string): raw is SatId {
  return SAT_RE.test(raw);
}

function isStarId(raw: string): raw is StarId {
  return STAR_RE.test(raw) && Number(raw.slice(5)) <= STAR_HR_MAX;
}

/**
 * sat:<1–9 digits, no leading 0>, planet:<PlanetName> (exact case), star:<1–9110>, moon, sun; else null.
 * Returns the input itself, so a valid id round-trips through the URL unchanged.
 */
export function parseObjectId(raw: string): ObjectId | null {
  return isBodyId(raw) || isSatId(raw) || isStarId(raw) ? raw : null;
}

/** The NORAD id of a `sat:` id that parseObjectId accepts, else null. */
export function noradIdOf(id: ObjectId | null): number | null {
  return id !== null && isSatId(id) ? Number(id.slice(4)) : null;
}
