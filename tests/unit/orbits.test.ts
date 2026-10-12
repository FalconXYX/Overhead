// tests/unit/orbits.test.ts — OMM handling (omm.ts) and samples (sample.ts): M3 steps 3 and 5, section 5.
// Interpolation, visibility and ground tracks have their own files (interpolate.test.ts, tracks.test.ts).
import { readFileSync } from "node:fs";
import { geodeticToEcf, gstime, json2satrec, type OMMJsonObject, propagate } from "satellite.js";
import { describe, expect, it } from "vitest";
import { astroTimeAt, makeObserver, sunGeometricAltDeg } from "../../src/domain/astro";
import {
  angularSeparationDeg,
  ecefToLatLonDeg,
  enuToAzAltDeg,
  enuToEcef,
  enuToEcefMatrix,
  type ObserverSite,
  wrap180,
} from "../../src/domain/geo";
import {
  appendGroup,
  type CatalogEntry,
  createPropagationContext,
  elementAgeDays,
  GP_GROUPS,
  type GpGroup,
  ISS_NORAD_ID,
  parseGpFile,
  SAMPLE_STRIDE,
  SampleField,
  STALE_ELEMENTS_DAYS,
  writeSample,
} from "../../src/domain/orbits";
import { parseOmmEpochMs } from "../../src/domain/time";

const D2R = Math.PI / 180;
/** The orbit-test site (M3 section 5): the Polaris site. */
const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
/** The snapshot's fetch time, 2026-10-11T03:50:21Z (meta.json fetchedAtMs). */
const SNAPSHOT_MS = 1791690621000;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8"));
}

const snapshot: Record<GpGroup, OMMJsonObject[]> = {
  stations: parseGpFile(readJson("gp/stations.json")),
  visual: parseGpFile(readJson("gp/visual.json")),
  starlink: parseGpFile(readJson("gp/starlink.json")),
};

function issOmm(): OMMJsonObject {
  const iss = snapshot.stations.find((r) => Number(r.NORAD_CAT_ID) === ISS_NORAD_ID);
  if (iss === undefined) throw new Error("ISS missing from the snapshot");
  return iss;
}

/** A copy of the ISS record with some fields replaced (or removed with undefined). */
function issWith(patch: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...issOmm() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete copy[key];
    else copy[key] = value;
  }
  return copy;
}

describe("orbit constants", () => {
  it("match README section 6", () => {
    expect(GP_GROUPS).toEqual(["stations", "visual", "starlink"]);
    expect(ISS_NORAD_ID).toBe(25544);
    expect(STALE_ELEMENTS_DAYS).toBe(7);
    expect(SAMPLE_STRIDE).toBe(8);
    expect(SampleField).toEqual({
      eKm: 0,
      nKm: 1,
      uKm: 2,
      veKmS: 3,
      vnKmS: 4,
      vuKmS: 5,
      sunlit: 6,
      valid: 7,
    });
  });
});

describe("parseGpFile", () => {
  it("accepts the committed snapshot, record for record", () => {
    expect(snapshot.stations).toHaveLength(22);
    expect(snapshot.visual).toHaveLength(156);
    expect(snapshot.starlink).toHaveLength(11_102);
    const raw = readJson("gp/stations.json");
    expect(parseGpFile(raw)).toEqual(raw);
  });

  it("gives [] for []: an empty file is valid here (fetch-gp.ts rejects it)", () => {
    expect(parseGpFile([])).toEqual([]);
  });

  it("throws on anything that is not an array", () => {
    expect(() => parseGpFile({})).toThrow();
    expect(() => parseGpFile("No GP data found")).toThrow();
    expect(() => parseGpFile(null)).toThrow();
    expect(() => parseGpFile(undefined)).toThrow();
  });

  it("throws when any record is not a usable OMM", () => {
    const bad: readonly (readonly [string, unknown])[] = [
      ["a missing EPOCH", issWith({ EPOCH: undefined })],
      ["NORAD_CAT_ID 0", issWith({ NORAD_CAT_ID: 0 })],
      ['CLASSIFICATION_TYPE "S"', issWith({ CLASSIFICATION_TYPE: "S" })],
      ["a negative NORAD id", issWith({ NORAD_CAT_ID: -5 })],
      ["a fractional NORAD id", issWith({ NORAD_CAT_ID: 25544.5 })],
      ["a NORAD id string with a fraction", issWith({ NORAD_CAT_ID: "25544.0" })],
      ["an empty NORAD id string", issWith({ NORAD_CAT_ID: "" })],
      ["an EPOCH that is no date", issWith({ EPOCH: "yesterday" })],
      ["a numeric EPOCH", issWith({ EPOCH: 1791586118797 })],
      ["a missing OBJECT_NAME", issWith({ OBJECT_NAME: undefined })],
      ["a numeric OBJECT_ID", issWith({ OBJECT_ID: 1998 })],
      ["a missing MEAN_MOTION", issWith({ MEAN_MOTION: undefined })],
      ["a non-numeric ECCENTRICITY string", issWith({ ECCENTRICITY: "abc" })],
      ["a blank INCLINATION string", issWith({ INCLINATION: " " })],
      ["a non-finite BSTAR", issWith({ BSTAR: Number.POSITIVE_INFINITY })],
      ["a null MEAN_MOTION_DDOT", issWith({ MEAN_MOTION_DDOT: null })],
      ["a boolean ELEMENT_SET_NO", issWith({ ELEMENT_SET_NO: true })],
      ["EPHEMERIS_TYPE 2", issWith({ EPHEMERIS_TYPE: 2 })],
      ['CCSDS_OMM_VERS "2.0"', issWith({ CCSDS_OMM_VERS: "2.0" })],
      ['CENTER_NAME "MOON"', issWith({ CENTER_NAME: "MOON" })],
      ['REF_FRAME "ITRF"', issWith({ REF_FRAME: "ITRF" })],
      ['TIME_SYSTEM "TAI"', issWith({ TIME_SYSTEM: "TAI" })],
      ['MEAN_ELEMENT_THEORY "SDP4"', issWith({ MEAN_ELEMENT_THEORY: "SDP4" })],
      ["a null record", null],
      ["a string record", "ISS (ZARYA)"],
      ["an array record", [issOmm()]],
    ];
    for (const [what, record] of bad) {
      expect(() => parseGpFile([issOmm(), record]), what).toThrow();
    }
  });

  it("accepts Space-Track style numeric strings, the OMM 3 header and 6-digit ids", () => {
    const record = issWith({
      NORAD_CAT_ID: "100057",
      MEAN_MOTION: "15.4879578",
      ECCENTRICITY: ".00066723",
      INCLINATION: "51.6315",
      RA_OF_ASC_NODE: "92.1575",
      ARG_OF_PERICENTER: "244.0714",
      MEAN_ANOMALY: "115.9587",
      BSTAR: "1.3073644E-4",
      MEAN_MOTION_DOT: "-6.711e-5",
      MEAN_MOTION_DDOT: "0",
      ELEMENT_SET_NO: "999",
      EPHEMERIS_TYPE: "0",
      CLASSIFICATION_TYPE: "C",
      CCSDS_OMM_VERS: "3.0",
      CENTER_NAME: "EARTH",
      REF_FRAME: "TEME",
      TIME_SYSTEM: "UTC",
      MEAN_ELEMENT_THEORY: "SGP4",
    });
    expect(parseGpFile([record])).toEqual([record]);
    // CelesTrak's own layout: no header fields, no EPHEMERIS_TYPE or CLASSIFICATION_TYPE at all.
    const bare = issWith({ EPHEMERIS_TYPE: undefined, CLASSIFICATION_TYPE: undefined });
    expect(parseGpFile([bare])).toEqual([bare]);
  });
});

describe("appendGroup on the snapshot (load order stations, visual, starlink)", () => {
  const seen = new Set<number>();
  const t0 = performance.now();
  const stations = appendGroup(seen, "stations", snapshot.stations);
  const afterStations = seen.size;
  const visual = appendGroup(seen, "visual", snapshot.visual);
  const afterVisual = seen.size;
  const starlink = appendGroup(seen, "starlink", snapshot.starlink);
  const elapsedMs = performance.now() - t0;
  const docked = (entries: readonly CatalogEntry[]): [number, number | null][] =>
    entries.filter((e) => e.dockedWith !== null).map((e) => [e.noradId, e.dockedWith]);

  it("stations: 22 entries, 10 docked (6 on the ISS, 4 on Tiangong), 12 drawn", () => {
    console.log(`appendGroup × 3 on the snapshot: ${elapsedMs.toFixed(1)} ms`);
    expect(stations).toHaveLength(22);
    expect(afterStations).toBe(22);
    expect(docked(stations).sort((a, b) => a[0] - b[0])).toEqual([
      [36086, 25544],
      [49044, 25544],
      [53239, 48274],
      [54216, 48274],
      [68837, 25544],
      [69049, 48274],
      [69180, 48274],
      [100057, 25544],
      [100712, 25544],
      [100882, 25544], // CREW DRAGON 13: its own element set, within 0.611 km (gotcha 13)
    ]);
    expect(stations.filter((e) => e.dockedWith === null)).toHaveLength(12);
  });

  it("visual: 153 new entries (25544, 48274 and 66515 stay in stations), none docked", () => {
    expect(visual).toHaveLength(153);
    expect(afterVisual).toBe(22 + 153);
    const visualIds = new Set(visual.map((e) => e.noradId));
    for (const id of [25544, 48274, 66515]) {
      expect(visualIds.has(id)).toBe(false);
      expect(stations.find((e) => e.noradId === id)?.group).toBe("stations");
    }
    expect(docked(visual)).toEqual([]);
  });

  it("starlink: 11,102 entries, none docked; 11,277 unique ids in all", () => {
    expect(starlink).toHaveLength(11_102);
    expect(docked(starlink)).toEqual([]);
    expect(seen.size).toBe(11_277);
  });

  it("keeps file order and fills every field from the record", () => {
    const keptStations = snapshot.stations;
    expect(stations.map((e) => e.noradId)).toEqual(keptStations.map((r) => Number(r.NORAD_CAT_ID)));
    const iss = stations[0];
    expect(iss?.noradId).toBe(ISS_NORAD_ID);
    expect(iss?.name).toBe("ISS (ZARYA)");
    expect(iss?.group).toBe("stations");
    expect(iss?.epochMs).toBe(Date.UTC(2026, 9, 9, 22, 48, 38, 797));
    expect(iss?.dockedWith).toBeNull();
    expect(iss?.omm).toBe(keptStations[0]);
    for (const [group, entries] of [
      ["stations", stations],
      ["visual", visual],
      ["starlink", starlink],
    ] as const) {
      for (const e of entries) {
        expect(e.group).toBe(group);
        expect(e.epochMs).toBe(parseOmmEpochMs(e.omm.EPOCH));
        expect(e.name).toBe(e.omm.OBJECT_NAME);
      }
    }
  });

  it("stale elements at fetch time: exactly Starlink 48408 (19.92 d) and 58885 (8.40 d)", () => {
    const stale = [...stations, ...visual, ...starlink].filter(
      (e) => Math.abs(elementAgeDays(e.epochMs, SNAPSHOT_MS)) > STALE_ELEMENTS_DAYS,
    );
    expect(stale.map((e) => [e.group, e.noradId])).toEqual([
      ["starlink", 48408],
      ["starlink", 58885],
    ]);
    const ages = stale.map((e) => elementAgeDays(e.epochMs, SNAPSHOT_MS));
    expect(ages[0]).toBeCloseTo(19.92, 2);
    expect(ages[1]).toBeCloseTo(8.4, 2);
  });
});

describe("appendGroup rules", () => {
  /** The ISS record with a new id and optional element changes. */
  const variant = (noradId: number, patch: Record<string, unknown> = {}): OMMJsonObject => {
    const [omm] = parseGpFile([
      issWith({ NORAD_CAT_ID: noradId, OBJECT_NAME: `T${noradId}`, ...patch }),
    ]);
    if (omm === undefined) throw new Error("variant rejected");
    return omm;
  };

  it("drops ids already seen, across groups and within one group", () => {
    const seen = new Set<number>([5]);
    const out = appendGroup(seen, "visual", [
      variant(5),
      variant(7, { MEAN_ANOMALY: 10 }),
      variant(7),
    ]);
    expect(out.map((e) => e.noradId)).toEqual([7]);
    expect(out[0]?.omm.MEAN_ANOMALY).toBe(10); // the first record of an id wins
    expect([...seen].sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it("gives [] for [] and leaves seen alone", () => {
    const seen = new Set<number>([1]);
    expect(appendGroup(seen, "starlink", [])).toEqual([]);
    expect([...seen]).toEqual([1]);
  });

  it("docks a cluster on its lowest id, whatever the file order", () => {
    const out = appendGroup(new Set(), "stations", [variant(900), variant(30), variant(500)]);
    expect(out.map((e) => [e.noradId, e.dockedWith])).toEqual([
      [900, 30],
      [30, null],
      [500, 30],
    ]);
  });

  it("does not dock near-identical elements more than 1 km apart", () => {
    // 0.02° of mean anomaly is about 2.4 km along the ISS orbit: inside the 0.05° window, outside 1 km.
    const m = Number(issOmm().MEAN_ANOMALY);
    const out = appendGroup(new Set(), "stations", [
      variant(10),
      variant(11, { MEAN_ANOMALY: m + 0.02 }),
    ]);
    expect(out.map((e) => e.dockedWith)).toEqual([null, null]);
  });

  /** Distance between two records' positions at timeMs, km. */
  const apartKm = (a: OMMJsonObject, b: OMMJsonObject, timeMs: number): number => {
    const pa = propagate(json2satrec(a), new Date(timeMs));
    const pb = propagate(json2satrec(b), new Date(timeMs));
    if (pa === null || pb === null) throw new Error("propagation failed");
    return Math.hypot(
      pa.position.x - pb.position.x,
      pa.position.y - pb.position.y,
      pa.position.z - pb.position.z,
    );
  };
  const epochMs = (): number => parseOmmEpochMs(issOmm().EPOCH);
  const AFTER_MS = 45 * 60_000;

  it("needs |Δi| ≤ 0.05° even when the positions stay within 1 km", () => {
    // Both at the ascending node (u = ω + M = 0) at epoch, inclinations 0.06° apart: 0 km at epoch, about 0.7 km
    // 45 min later (u ≈ 174°), so only the element limit keeps them apart.
    const m0 = 360 - Number(issOmm().ARG_OF_PERICENTER);
    const a = variant(10, { MEAN_ANOMALY: m0 });
    const tilted = (di: number): OMMJsonObject =>
      variant(11, { MEAN_ANOMALY: m0, INCLINATION: Number(issOmm().INCLINATION) + di });
    for (const [di, docked] of [
      [0.06, false],
      [0.04, true],
    ] as const) {
      const b = tilted(di);
      expect(apartKm(a, b, epochMs())).toBeLessThan(1);
      expect(apartKm(a, b, epochMs() + AFTER_MS)).toBeLessThan(1);
      const out = appendGroup(new Set(), "stations", [a, b]);
      expect(
        out.map((e) => e.dockedWith),
        `Δi ${di}`,
      ).toEqual([null, docked ? 10 : null]);
    }
  });

  it("needs |Δn| ≤ 0.001 rev/day even when the positions stay within 1 km", () => {
    // Δn 0.0011 rev/day drifts 0.0124° (about 1.5 km) in 45 min; starting 0.0062° behind keeps both checks
    // within 1 km, so only the element limit keeps them apart.
    const iss = issOmm();
    const a = variant(10);
    const b = variant(11, {
      MEAN_MOTION: Number(iss.MEAN_MOTION) + 0.0011,
      MEAN_ANOMALY: Number(iss.MEAN_ANOMALY) - 0.0062,
    });
    expect(apartKm(a, b, epochMs())).toBeLessThan(1);
    expect(apartKm(a, b, epochMs() + AFTER_MS)).toBeLessThan(1);
    expect(appendGroup(new Set(), "stations", [a, b]).map((e) => e.dockedWith)).toEqual([
      null,
      null,
    ]);
  });

  /**
   * A pair at u = 90° on planes dΩ apart, the second moved back along the track by dΩ·cos i: a node shift moves a
   * point r·dΩ·cos i along the track and r·dΩ·sin i·|cos u| across it, so the pair is 0 km apart at epoch and
   * about 9.3 km × dΩ apart 45 min later (u ≈ 264°).
   */
  const nodePair = (raanA: number, dRaan: number): [OMMJsonObject, OMMJsonObject] => {
    const iss = issOmm();
    const mA = (450 - Number(iss.ARG_OF_PERICENTER)) % 360;
    const cosI = Math.cos(Number(iss.INCLINATION) * D2R);
    return [
      variant(10, { RA_OF_ASC_NODE: raanA, MEAN_ANOMALY: mA }),
      variant(11, {
        RA_OF_ASC_NODE: (raanA + dRaan + 360) % 360,
        MEAN_ANOMALY: mA - dRaan * cosI,
      }),
    ];
  };

  it("needs |ΔΩ| ≤ 0.05° even when the positions stay within 1 km", () => {
    for (const [dRaan, docked] of [
      [0.06, false],
      [0.04, true],
    ] as const) {
      const [a, b] = nodePair(Number(issOmm().RA_OF_ASC_NODE), dRaan);
      expect(apartKm(a, b, epochMs())).toBeLessThan(1);
      expect(apartKm(a, b, epochMs() + AFTER_MS)).toBeLessThan(1);
      const out = appendGroup(new Set(), "stations", [a, b]);
      expect(
        out.map((e) => e.dockedWith),
        `ΔΩ ${dRaan}`,
      ).toEqual([null, docked ? 10 : null]);
    }
  });

  it("takes ΔΩ across 0°/360°", () => {
    const [a, b] = nodePair(359.98, 0.04); // Ω 359.98° and 0.02°
    expect(b.RA_OF_ASC_NODE).toBeCloseTo(0.02, 9);
    expect(apartKm(a, b, epochMs() + AFTER_MS)).toBeLessThan(1);
    expect(appendGroup(new Set(), "stations", [b, a]).map((e) => e.dockedWith)).toEqual([10, null]);
  });

  it("takes Δu across 0°/360°", () => {
    // u = ω + M: 359.997° against 0.002° (0.005° apart, about 0.6 km); at most one sweep step wraps.
    const w = Number(issOmm().ARG_OF_PERICENTER);
    const out = appendGroup(new Set(), "stations", [
      variant(20, { MEAN_ANOMALY: 359.997 - w }),
      variant(21, { MEAN_ANOMALY: 360.002 - w }),
      variant(22, { MEAN_ANOMALY: 180 - w }), // far away on the orbit: never a candidate
    ]);
    expect(out.map((e) => e.dockedWith)).toEqual([null, 20, null]);
  });

  it("is within 1 km at the later epoch but not 45 min later: not docked", () => {
    // Δn 0.0009 rev/day (inside the limit), same u at epoch: 0 km at epoch, about 1.2 km 45 min later.
    const iss = issOmm();
    const a = variant(10);
    const b = variant(11, { MEAN_MOTION: Number(iss.MEAN_MOTION) + 0.0009 });
    expect(apartKm(a, b, epochMs())).toBeLessThan(1);
    expect(apartKm(a, b, epochMs() + AFTER_MS)).toBeGreaterThan(1);
    expect(appendGroup(new Set(), "stations", [a, b]).map((e) => e.dockedWith)).toEqual([
      null,
      null,
    ]);
    // Δn 0.0004 rev/day stays within 1 km at both checks: docked.
    const c = variant(12, { MEAN_MOTION: Number(iss.MEAN_MOTION) + 0.0004 });
    expect(apartKm(a, c, epochMs() + AFTER_MS)).toBeLessThan(1);
    expect(appendGroup(new Set(), "stations", [a, c]).map((e) => e.dockedWith)).toEqual([null, 10]);
  });
});

describe("elementAgeDays", () => {
  it("is (timeMs − epochMs) / 1 day, signed", () => {
    const epoch = Date.UTC(2026, 9, 9, 22, 48, 38, 797);
    expect(elementAgeDays(epoch, epoch + 1.5 * 86_400_000)).toBe(1.5);
    expect(elementAgeDays(epoch, epoch - 86_400_000)).toBe(-1);
    expect(elementAgeDays(epoch, epoch)).toBe(0);
  });
});

describe("createPropagationContext", () => {
  it("builds the per-tick constants once", () => {
    const ctx = createPropagationContext(SNAPSHOT_MS, SITE);
    expect(ctx.timeMs).toBe(SNAPSHOT_MS);
    expect(ctx.date.getTime()).toBe(SNAPSHOT_MS);
    expect(ctx.gmstRad).toBe(gstime(new Date(SNAPSHOT_MS)));
    expect(ctx.gmstRad).toBeCloseTo(1.3499115, 7); // docs/verification/satellite-js.md #7
    const ref = geodeticToEcf({
      latitude: SITE.latDeg * D2R,
      longitude: SITE.lonDeg * D2R,
      height: SITE.heightM / 1000,
    });
    expect(ctx.observerEcefKm[0]).toBeCloseTo(ref.x, 9);
    expect(ctx.observerEcefKm[1]).toBeCloseTo(ref.y, 9);
    expect(ctx.observerEcefKm[2]).toBeCloseTo(ref.z, 9);
    expect([...ctx.enuToEcef]).toEqual([...enuToEcefMatrix(SITE.latDeg, SITE.lonDeg)]);
  });

  it("gives the Sun's geometric altitude within 0.01° of astronomy-engine every 10 min on 2026-10-11", () => {
    const observer = makeObserver(SITE);
    const dayMs = Date.UTC(2026, 9, 11);
    let worst = 0;
    for (let t = dayMs; t < dayMs + 86_400_000; t += 600_000) {
      const ctx = createPropagationContext(t, SITE);
      worst = Math.max(
        worst,
        Math.abs(ctx.sunAltDeg - sunGeometricAltDeg(astroTimeAt(t), observer)),
      );
    }
    console.log(`sunAltDeg vs astronomy-engine: max ${worst.toFixed(4)}° over 144 samples`);
    expect(worst).toBeLessThan(0.01); // measured 0.0046°
  });

  it("puts the Sun at −16.2° at the e2e instant 2026-10-11T15:09:50Z", () => {
    const ctx = createPropagationContext(Date.parse("2026-10-11T15:09:50Z"), SITE);
    expect(ctx.sunAltDeg).toBeCloseTo(-16.2, 1);
  });
});

interface IssFixture {
  noradId: number;
  site: { latDeg: number; lonDeg: number; heightM: number };
  columns: string[];
  samples: [number, number, number, number, number, number, boolean][];
  shadowTransitions: [number, boolean][];
}

describe("writeSample: ISS vs Skyfield (iss-pass-maunakea.json)", () => {
  const fixture = readJson("iss-pass-maunakea.json") as IssFixture;
  const satrec = json2satrec(issOmm());

  it("uses the orbit-test site and the documented columns", () => {
    expect(fixture.noradId).toBe(ISS_NORAD_ID);
    expect(fixture.site).toEqual(SITE);
    expect(fixture.columns).toEqual([
      "timeMs",
      "azDeg",
      "altDeg",
      "rangeKm",
      "subLatDeg",
      "subLonDeg",
      "sunlit",
    ]);
    expect(fixture.samples).toHaveLength(93);
    expect(fixture.shadowTransitions).toHaveLength(31);
  });

  it("matches az/alt within 0.05°, range within 0.1 km and the sub-point within 0.005° on all 93 rows", () => {
    const out = new Float32Array(3 * SAMPLE_STRIDE);
    const azAlt = new Float64Array(2);
    const ecef = new Float64Array(3);
    const latLon = new Float64Array(2);
    let worstDeg = 0;
    let worstKm = 0;
    let worstSubDeg = 0;
    for (const [timeMs, azDeg, altDeg, rangeKm, subLatDeg, subLonDeg] of fixture.samples) {
      const ctx = createPropagationContext(timeMs, SITE);
      expect(writeSample(satrec, ctx, out, 1)).toBe(true);
      const o = SAMPLE_STRIDE;
      const e = out[o + SampleField.eKm] ?? Number.NaN;
      const n = out[o + SampleField.nKm] ?? Number.NaN;
      const u = out[o + SampleField.uKm] ?? Number.NaN;
      expect(out[o + SampleField.valid]).toBe(1);
      enuToAzAltDeg(e, n, u, azAlt, 0);
      worstDeg = Math.max(
        worstDeg,
        angularSeparationDeg(azAlt[0] ?? Number.NaN, azAlt[1] ?? Number.NaN, azDeg, altDeg),
      );
      worstKm = Math.max(worstKm, Math.abs(Math.hypot(e, n, u) - rangeKm));
      // Ground point: ECEF = O + M · ENU, then Bowring.
      enuToEcef(ctx.enuToEcef, e, n, u, ecef, 0);
      const O = ctx.observerEcefKm;
      ecefToLatLonDeg(
        (ecef[0] ?? 0) + (O[0] ?? 0),
        (ecef[1] ?? 0) + (O[1] ?? 0),
        (ecef[2] ?? 0) + (O[2] ?? 0),
        latLon,
        0,
      );
      worstSubDeg = Math.max(
        worstSubDeg,
        Math.abs((latLon[0] ?? Number.NaN) - subLatDeg),
        Math.abs(wrap180((latLon[1] ?? Number.NaN) - subLonDeg)),
      );
    }
    // Neighbouring slots stay untouched.
    expect(out.subarray(0, SAMPLE_STRIDE).every((v) => v === 0)).toBe(true);
    expect(out.subarray(2 * SAMPLE_STRIDE).every((v) => v === 0)).toBe(true);
    console.log(
      `ISS vs Skyfield, 93 rows: az/alt ${worstDeg.toFixed(4)}°, range ${worstKm.toFixed(3)} km, sub-point ${worstSubDeg.toFixed(5)}°`,
    );
    expect(worstDeg).toBeLessThanOrEqual(0.05); // measured 0.0038°
    expect(worstKm).toBeLessThanOrEqual(0.1); // measured 0.037 km
    expect(worstSubDeg).toBeLessThanOrEqual(0.005); // measured 0.00038°
  });

  it("flips the sunlit flag within 2 s of each of Skyfield's 31 shadow transitions", () => {
    const out = new Float32Array(SAMPLE_STRIDE);
    const litAt = (timeMs: number): boolean => {
      expect(writeSample(satrec, createPropagationContext(timeMs, SITE), out, 0)).toBe(true);
      return out[SampleField.sunlit] === 1;
    };
    let worstMs = 0;
    for (const [flipMs, newState] of fixture.shadowTransitions) {
      // Scan ±10 s at 1 s: old state at the start, new state at the end, exactly one change between.
      let changeMs: number | null = null;
      let prev = litAt(flipMs - 10_000);
      expect(prev, `before ${new Date(flipMs).toISOString()}`).toBe(!newState);
      for (let t = flipMs - 9_000; t <= flipMs + 10_000; t += 1_000) {
        const lit = litAt(t);
        if (lit !== prev) {
          expect(changeMs, "a single flip").toBeNull();
          changeMs = t;
        }
        prev = lit;
      }
      expect(prev, `after ${new Date(flipMs).toISOString()}`).toBe(newState);
      worstMs = Math.max(worstMs, Math.abs((changeMs ?? Number.POSITIVE_INFINITY) - flipMs));
    }
    console.log(`sunlit flips vs Skyfield: worst ${worstMs} ms over 31 transitions`);
    expect(worstMs).toBeLessThanOrEqual(2_000); // measured ≤ 1 s
  });
});

describe("writeSample", () => {
  it("writes the Earth-fixed velocity in ENU (the derivative of the ENU position)", () => {
    const satrec = json2satrec(issOmm());
    const t = Date.parse("2026-10-12T01:00:58.527Z"); // the zenith pass of interpolate.test.ts
    const h = 5_000;
    const out = new Float32Array(3 * SAMPLE_STRIDE);
    writeSample(satrec, createPropagationContext(t - h, SITE), out, 0);
    writeSample(satrec, createPropagationContext(t, SITE), out, 1);
    writeSample(satrec, createPropagationContext(t + h, SITE), out, 2);
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const central = ((out[2 * SAMPLE_STRIDE + k] ?? 0) - (out[k] ?? 0)) / ((2 * h) / 1000);
      worst = Math.max(worst, Math.abs((out[SAMPLE_STRIDE + 3 + k] ?? Number.NaN) - central));
    }
    // ω × r is about 0.5 km/s here: an inertial (un-corrected) velocity fails by orders of magnitude.
    expect(worst).toBeLessThan(1e-3);
  });

  it("zeroes the slot and returns false for elements SGP4 rejects (BSTAR 0.05, MEAN_MOTION_DOT 0.1, at 2027-01-01)", () => {
    const [bad] = parseGpFile([issWith({ BSTAR: 0.05, MEAN_MOTION_DOT: 0.1 })]);
    if (bad === undefined) throw new Error("bad elements rejected by parseGpFile");
    const satrec = json2satrec(bad);
    const out = new Float32Array(3 * SAMPLE_STRIDE).fill(7);
    const ctx = createPropagationContext(Date.UTC(2027, 0, 1), SITE);
    expect(writeSample(satrec, ctx, out, 1)).toBe(false);
    expect(satrec.error).toBe(1);
    expect([...out.subarray(SAMPLE_STRIDE, 2 * SAMPLE_STRIDE)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(out.subarray(0, SAMPLE_STRIDE).every((v) => v === 7)).toBe(true);
    expect(out.subarray(2 * SAMPLE_STRIDE).every((v) => v === 7)).toBe(true);
  });

  it("marks the ISS in Earth's shadow at the snapshot time and sunlit at the e2e instant", () => {
    const satrec = json2satrec(issOmm());
    const out = new Float32Array(SAMPLE_STRIDE);
    // 2026-10-11T05:19:30Z: inside the shadow entered at 05:18:57Z.
    writeSample(satrec, createPropagationContext(Date.parse("2026-10-11T05:19:30Z"), SITE), out, 0);
    expect(out[SampleField.sunlit]).toBe(0);
    expect(out[SampleField.valid]).toBe(1);
    writeSample(satrec, createPropagationContext(Date.parse("2026-10-11T15:09:50Z"), SITE), out, 0);
    expect(out[SampleField.sunlit]).toBe(1);
    const azAlt = new Float64Array(2);
    enuToAzAltDeg(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, azAlt, 0);
    // satellite.js at 15:09:50Z: az 123.812°, geometric alt 28.841°, range 794.522 km (M3 section 5).
    expect(azAlt[0]).toBeCloseTo(123.812, 2);
    expect(azAlt[1]).toBeCloseTo(28.841, 2);
    expect(Math.hypot(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)).toBeCloseTo(794.522, 1);
  });
});
