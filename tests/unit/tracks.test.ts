// tests/unit/tracks.test.ts — M3 step 7: ground tracks on the absolute 20 s grid with unwrapped longitudes.
import { readFileSync } from "node:fs";
import { eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from "satellite.js";
import { describe, expect, it } from "vitest";
import { unwrapLonDeg, wrap180 } from "../../src/domain/geo";
import { ISS_NORAD_ID, parseGpFile, trackLonLatDeg } from "../../src/domain/orbits";
import { TRACK_STEP_MS } from "../../src/domain/time";

const R2D = 180 / Math.PI;

function issOmm() {
  const url = new URL("../fixtures/gp/stations.json", import.meta.url);
  const omm = parseGpFile(JSON.parse(readFileSync(url, "utf8"))).find(
    (o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID,
  );
  if (omm === undefined) throw new Error("ISS missing from tests/fixtures/gp/stations.json");
  return omm;
}

const ISS_OMM = issOmm();
const ISS: SatRec = json2satrec(ISS_OMM);
const FETCH_MS = Date.parse("2026-10-11T03:50:21Z"); // the snapshot's fetch time
const SLOT_MS = Date.parse("2026-10-11T03:50:20Z"); // its 20 s slot
const TEN_MIN = 600_000;
const THREE_MIN = 180_000;
const DAY = 86_400_000;

function track(centerMs: number, halfSpanMs: number, satrec: SatRec = ISS): Float64Array {
  const out = new Float64Array(2 * (2 * Math.floor(halfSpanMs / TRACK_STEP_MS) + 1));
  const count = trackLonLatDeg(satrec, centerMs, halfSpanMs, out);
  return out.slice(0, 2 * count);
}

/** Sub-point by satellite.js's own iterative geodetic: [lonDeg, latDeg], lon in (−180, 180]. */
function referenceLonLat(satrec: SatRec, timeMs: number): [number, number] {
  const date = new Date(timeMs);
  const pv = propagate(satrec, date);
  if (pv === null) throw new Error(`propagation failed at ${timeMs}`);
  const g = eciToGeodetic(pv.position, gstime(date));
  return [g.longitude * R2D, g.latitude * R2D];
}

/** Antimeridian crossings and the largest longitude step of an unwrapped track. */
function crossings(lonLat: Float64Array): { count: number; maxStepDeg: number } {
  let count = 0;
  let maxStepDeg = 0;
  for (let i = 1; 2 * i < lonLat.length; i++) {
    const prev = lonLat[2 * i - 2] ?? 0;
    const lon = lonLat[2 * i] ?? 0;
    maxStepDeg = Math.max(maxStepDeg, Math.abs(lon - prev));
    if (Math.floor((prev + 180) / 360) !== Math.floor((lon + 180) / 360)) count++;
  }
  return { count, maxStepDeg };
}

describe("trackLonLatDeg", () => {
  it("writes 61 points for ±10 min and 19 for ±3 min", () => {
    expect(track(FETCH_MS, TEN_MIN).length).toBe(2 * 61);
    expect(track(FETCH_MS, THREE_MIN).length).toBe(2 * 19);
    expect(track(FETCH_MS, 0).length).toBe(2);
  });

  it("is identical for any centre in the same 20 s slot", () => {
    const reference = Array.from(track(SLOT_MS, TEN_MIN));
    for (const center of [SLOT_MS, FETCH_MS, SLOT_MS + 19_999]) {
      expect(Array.from(track(center, TEN_MIN))).toEqual(reference);
    }
    expect(Array.from(track(SLOT_MS + 20_000, TEN_MIN))).not.toEqual(reference);
  });

  it("puts point i at the absolute grid time first + 20 s·i (vs eciToGeodetic: lat 1e-6°, lon 1e-9°)", () => {
    for (const center of [FETCH_MS, Date.parse("2026-10-11T15:09:50Z")]) {
      const lonLat = track(center, TEN_MIN);
      expect(lonLat.length).toBe(2 * 61);
      const first = Math.floor(center / TRACK_STEP_MS) * TRACK_STEP_MS - TEN_MIN;
      for (let i = 0; 2 * i < lonLat.length; i++) {
        const [lon, lat] = referenceLonLat(ISS, first + i * TRACK_STEP_MS);
        expect(Math.abs((lonLat[2 * i + 1] ?? 0) - lat)).toBeLessThan(1e-6);
        expect(Math.abs(wrap180((lonLat[2 * i] ?? 0) - lon))).toBeLessThan(1e-9);
      }
    }
  });

  it("starts in [−180, 180) and unwraps every later point against the previous one", () => {
    // The second fixture pass rises over Maunakea at 16:45:01Z; the ISS crossed the antimeridian at 16:40:20Z.
    const lonLat = track(Date.parse("2026-10-11T16:45:01Z"), TEN_MIN);
    expect(lonLat.length).toBe(2 * 61);
    expect(lonLat[0]).toBeGreaterThanOrEqual(-180);
    expect(lonLat[0]).toBeLessThan(180);
    expect(crossings(lonLat).count).toBe(1);
    expect(lonLat[2 * 60]).toBeGreaterThan(180); // drawn east of the antimeridian, not wrapped to −180
    for (let i = 1; 2 * i < lonLat.length; i++) {
      const prev = lonLat[2 * i - 2] ?? 0;
      const lon = lonLat[2 * i] ?? 0;
      expect(Math.abs(unwrapLonDeg(prev, wrap180(lon)) - lon)).toBeLessThan(1e-9);
      expect(Math.abs(lon - prev)).toBeLessThan(180);
    }
  });

  it("unwraps across the antimeridian like unwrapLonDeg", () => {
    expect(Math.abs(unwrapLonDeg(179.949, -179.962) - 180.038)).toBeLessThan(1e-9);
    expect(Math.abs(unwrapLonDeg(-179.962, 179.949) - -180.051)).toBeLessThan(1e-9);
  });

  it("over 24 h from 03:50:20Z crosses the antimeridian 14 times, every step < 180° (largest 1.996°)", () => {
    const lonLat = track(SLOT_MS + DAY / 2, DAY / 2);
    expect(lonLat.length).toBe(2 * (DAY / TRACK_STEP_MS + 1));
    const { count, maxStepDeg } = crossings(lonLat);
    console.log(`24 h ISS track: ${count} antimeridian crossings, largest step ${maxStepDeg}°`);
    expect(count).toBe(14);
    expect(maxStepDeg).toBeLessThan(180);
    expect(Math.abs(maxStepDeg - 1.996)).toBeLessThan(0.0005);
  });

  it("keeps every ±10 min track within ±300°, inside the canvas renderer's ±540°", () => {
    let widest = 0;
    for (let center = SLOT_MS; center < SLOT_MS + DAY; center += 300_000) {
      const lonLat = track(center, TEN_MIN);
      expect(lonLat.length).toBe(2 * 61);
      for (let i = 0; 2 * i < lonLat.length; i++) {
        widest = Math.max(widest, Math.abs(lonLat[2 * i] ?? 0));
      }
    }
    expect(widest).toBeLessThan(300);
  });

  it("stops at the first failed propagation and returns the count", () => {
    // M3 step 5's bad elements: BSTAR 0.05 and MEAN_MOTION_DOT 0.1 decay well before 2027-01-01.
    const decaying = json2satrec({ ...ISS_OMM, BSTAR: 0.05, MEAN_MOTION_DOT: 0.1 });
    expect(propagate(decaying, new Date("2027-01-01T00:00:00Z"))).toBeNull();
    // First failing 20 s grid time, searched by bisection between the fetch and 2027-01-01.
    let ok = SLOT_MS;
    let bad = Date.parse("2027-01-01T00:00:00Z");
    expect(propagate(decaying, new Date(ok))).not.toBeNull();
    while (bad - ok > TRACK_STEP_MS) {
      const mid = Math.floor((ok + bad) / 2 / TRACK_STEP_MS) * TRACK_STEP_MS;
      if (propagate(decaying, new Date(mid)) === null) bad = mid;
      else ok = mid;
    }
    const center = bad + 5 * TRACK_STEP_MS; // the 26th point (index 25) is the first failure
    const out = new Float64Array(2 * 61).fill(Number.NaN);
    expect(propagate(decaying, new Date(bad - TRACK_STEP_MS))).not.toBeNull();
    const count = trackLonLatDeg(decaying, center, TEN_MIN, out);
    expect(count).toBe(25);
    expect(out.slice(0, 2 * count).every(Number.isFinite)).toBe(true);
    expect(out.slice(2 * count).every(Number.isNaN)).toBe(true);
  });

  it("writes no more pairs than `out` holds, and nothing for a non-finite input or a negative span", () => {
    const small = new Float64Array(2 * 10 + 1).fill(Number.NaN);
    expect(trackLonLatDeg(ISS, FETCH_MS, TEN_MIN, small)).toBe(10);
    expect(Array.from(small.subarray(0, 20))).toEqual(
      Array.from(track(FETCH_MS, TEN_MIN).subarray(0, 20)),
    );
    expect(small[20]).toBeNaN();
    const out = new Float64Array(2 * 61).fill(Number.NaN);
    expect(trackLonLatDeg(ISS, Number.NaN, TEN_MIN, out)).toBe(0);
    expect(trackLonLatDeg(ISS, FETCH_MS, Number.NaN, out)).toBe(0);
    expect(trackLonLatDeg(ISS, FETCH_MS, Number.POSITIVE_INFINITY, out)).toBe(0);
    expect(trackLonLatDeg(ISS, Number.POSITIVE_INFINITY, TEN_MIN, out)).toBe(0);
    expect(trackLonLatDeg(ISS, FETCH_MS, -1, out)).toBe(0);
    expect(out.every(Number.isNaN)).toBe(true);
  });
});
