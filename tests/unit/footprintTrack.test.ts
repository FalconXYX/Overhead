// tests/unit/footprintTrack.test.ts — the footprint at the satellite's geodetic height agrees with the frame
// (M8 step 2 and section 5): the ISS sub-point enters the polygon within 2 s of the ISS entering the frame.
import { readFileSync } from "node:fs";
import { gstime, json2satrec, type OMMJsonObject, propagate } from "satellite.js";
import { describe, expect, it } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import {
  type CameraModel,
  createCameraModel,
  FOOTPRINT_SAMPLES_PER_EDGE,
  footprintLonLatDeg,
  footprintMaxPairs,
  projectAzAltDeg,
} from "../../src/domain/camera";
import {
  ecefToEnu,
  ecefToLatLonDeg,
  enuToAzAltDeg,
  enuToEcefMatrix,
  geodeticHeightKm,
  geodeticToEcefKm,
  type ObserverSite,
  unwrapLonDeg,
} from "../../src/domain/geo";

const SUBARU_SITE: ObserverSite = { latDeg: 19.82552, lonDeg: -155.47587, heightM: 4148 };
const SUBARU: CameraModel = createCameraModel({
  lens: "rectilinear",
  calibration: {
    azDeg: 81.2,
    altDeg: 19.6,
    rollDeg: 0,
    focalPx: 2742,
    cxPx: 1920,
    cyPx: 1080,
    k1: 0,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: null,
    updatedAtMs: 0,
  },
  widthPx: 3840,
  heightPx: 2160,
});

/** Frame-entry neighbourhoods of the ISS for the Subaru defaults over the 2026-10-11 snapshot. */
const WINDOW_CENTRES = [
  "2026-10-11T00:11:33Z",
  "2026-10-11T15:09:55Z",
  "2026-10-11T23:24:30Z",
  "2026-10-12T01:01:28Z",
  "2026-10-12T14:22:56Z",
] as const;

function iss(): OMMJsonObject {
  // Test-only cast: the shape is checked by orbits.test.ts (parseGpFile) and gpData.test.ts.
  const records = JSON.parse(
    readFileSync(new URL("../fixtures/gp/stations.json", import.meta.url), "utf8"),
  ) as OMMJsonObject[];
  const omm = records.find((r) => Number(r.NORAD_CAT_ID) === 25544);
  if (omm === undefined) throw new Error("ISS missing from the snapshot");
  return omm;
}

/** Ray casting in lon/lat over an open ring of pairCount [lon, lat] pairs; the point's lon is moved within 180° of vertex 0. */
function insideRing(
  ring: Float64Array,
  pairCount: number,
  lonDeg: number,
  latDeg: number,
): boolean {
  const x = unwrapLonDeg(ring[0] ?? 0, lonDeg);
  let inside = false;
  for (let i = 0, j = pairCount - 1; i < pairCount; j = i++) {
    const xi = ring[2 * i] ?? 0;
    const yi = ring[2 * i + 1] ?? 0;
    const xj = ring[2 * j] ?? 0;
    const yj = ring[2 * j + 1] ?? 0;
    if (yi > latDeg !== yj > latDeg && x < ((xj - xi) * (latDeg - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

describe("footprint at the geodetic height vs the frame (ISS, Subaru defaults)", () => {
  it("enters the polygon within ± 2 s of the frame in each of five windows", () => {
    const satrec = json2satrec(iss());
    const o = new Float64Array(3);
    geodeticToEcefKm(SUBARU_SITE.latDeg, SUBARU_SITE.lonDeg, SUBARU_SITE.heightM, o, 0);
    const m = enuToEcefMatrix(SUBARU_SITE.latDeg, SUBARU_SITE.lonDeg);
    const enu = new Float64Array(3);
    const azAlt = new Float64Array(2);
    const uv = new Float64Array(2);
    const sub = new Float64Array(2);
    const ring = new Float64Array(2 * footprintMaxPairs(FOOTPRINT_SAMPLES_PER_EDGE));
    const gaps: number[] = [];
    for (const centre of WINDOW_CENTRES) {
      const centreMs = Date.parse(centre);
      let frameEntryMs: number | null = null;
      let polygonEntryMs: number | null = null;
      for (let t = centreMs - 120_000; t <= centreMs + 120_000; t += 500) {
        const date = new Date(t);
        const pv = propagate(satrec, date);
        if (pv === null) throw new Error(`ISS propagation failed at ${date.toISOString()}`);
        const gmst = gstime(date);
        const c = Math.cos(gmst);
        const s = Math.sin(gmst);
        const r = pv.position;
        const x = r.x * c + r.y * s;
        const y = -r.x * s + r.y * c;
        const z = r.z;
        ecefToEnu(m, x - (o[0] ?? 0), y - (o[1] ?? 0), z - (o[2] ?? 0), enu, 0);
        enuToAzAltDeg(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, azAlt, 0);
        const alt = apparentAltDeg(azAlt[1] ?? Number.NaN);
        const inFrame =
          alt > 0 &&
          projectAzAltDeg(SUBARU, azAlt[0] ?? Number.NaN, alt, uv, 0) &&
          (uv[0] ?? -1) >= 0 &&
          (uv[0] ?? -1) <= 3840 &&
          (uv[1] ?? -1) >= 0 &&
          (uv[1] ?? -1) <= 2160;
        const n = footprintLonLatDeg(
          SUBARU,
          SUBARU_SITE,
          geodeticHeightKm(x, y, z),
          FOOTPRINT_SAMPLES_PER_EDGE,
          null,
          ring,
        );
        ecefToLatLonDeg(x, y, z, sub, 0);
        const inPolygon = n >= 3 && insideRing(ring, n, sub[1] ?? Number.NaN, sub[0] ?? Number.NaN);
        if (t === centreMs - 120_000) {
          expect(inFrame, `${centre}: in frame at the window start`).toBe(false);
          expect(inPolygon, `${centre}: in the polygon at the window start`).toBe(false);
        }
        if (inFrame && frameEntryMs === null) frameEntryMs = t;
        if (inPolygon && polygonEntryMs === null) polygonEntryMs = t;
      }
      expect(frameEntryMs, `${centre}: frame entry`).not.toBeNull();
      expect(polygonEntryMs, `${centre}: polygon entry`).not.toBeNull();
      const gapS = ((polygonEntryMs ?? Number.NaN) - (frameEntryMs ?? Number.NaN)) / 1000;
      gaps.push(gapS);
      expect(Math.abs(gapS), `${centre}: polygon entry − frame entry`).toBeLessThanOrEqual(2);
    }
    console.log(`polygon entry − frame entry (s): ${gaps.join(", ")}`); // measured +0.5 to +1.0 s
  });
});
