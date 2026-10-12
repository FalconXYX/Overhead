// src/domain/orbits/tracks.ts — ground tracks for the canvas tracks layer (README section 5, "tracks and incoming").
import { gstime, propagate, type SatRec } from "satellite.js";
import { ecefToLatLonDeg, unwrapLonDeg, wrap180 } from "../geo";
import { floorToStepMs, TRACK_STEP_MS } from "../time";

/** Bowring output [latDeg, lonDeg], reused across calls (the worker is single-threaded). */
const latLon = new Float64Array(2);
/** One Date per call, moved with setTime: propagate and gstime only read it. */
const date = new Date(0);

/**
 * Ground-track points on the absolute 20 s grid (multiples of TRACK_STEP_MS) covering
 * [centerMs − halfSpanMs, centerMs + halfSpanMs]. Writes unwrapped [lonDeg, latDeg] pairs; returns the pair count.
 *
 * The centre snaps down to the grid, c = floor(centerMs / 20 s) × 20 s, and points run from c − h to c + h with
 * h = floor(halfSpanMs / 20 s) × 20 s: 61 points for ±10 min, 19 for ±3 min, identical for any centre in the same
 * 20 s slot. Per point: propagate, rotate TEME → ECEF by GMST, one-step Bowring (never eciToGeodetic, gotcha 1).
 * The first longitude is wrapped into [−180, 180) and each later one unwrapped against the previous point, so a
 * track crossing the antimeridian stays continuous (the ISS moves at most 1.996° per 20 s). Stops at the first
 * failed propagation, and when `out` is full. A non-finite centre or span writes nothing.
 */
export function trackLonLatDeg(
  satrec: SatRec,
  centerMs: number,
  halfSpanMs: number,
  out: Float64Array,
): number {
  const c = floorToStepMs(centerMs, TRACK_STEP_MS);
  const h = floorToStepMs(halfSpanMs, TRACK_STEP_MS);
  if (!Number.isFinite(c) || !Number.isFinite(h)) return 0;
  const capacity = Math.floor(out.length / 2);
  const steps = 2 * (h / TRACK_STEP_MS) + 1; // < 1 for a negative span: nothing is written
  let count = 0;
  let prevLonDeg = 0;
  for (let i = 0; i < steps && count < capacity; i++) {
    date.setTime(c - h + i * TRACK_STEP_MS);
    const pv = propagate(satrec, date);
    if (pv === null) break;
    const g = gstime(date);
    const cg = Math.cos(g);
    const sg = Math.sin(g);
    const { x, y, z } = pv.position;
    ecefToLatLonDeg(x * cg + y * sg, -x * sg + y * cg, z, latLon, 0);
    const lonDeg = latLon[1] ?? 0;
    prevLonDeg = count === 0 ? wrap180(lonDeg) : unwrapLonDeg(prevLonDeg, lonDeg);
    out[2 * count] = prevLonDeg;
    out[2 * count + 1] = latLon[0] ?? 0;
    count++;
  }
  return count;
}
