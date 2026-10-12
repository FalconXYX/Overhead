// tests/unit/incoming.test.ts — the incoming check (M8 step 4, section 5): incomingEtaSec and collectIncoming on the
// committed snapshot. The visible-in-frame predicate is rebuilt here from the public M3/M4 pieces, so the module is
// checked against an independent copy, not against itself.
import { readFileSync } from "node:fs";
import { json2satrec, type OMMJsonObject, propagate, type SatRec } from "satellite.js";
import { describe, expect, it } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import {
  type CameraModel,
  createCameraModel,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
} from "../../src/domain/camera";
import { enuToAzAltDeg, type ObserverSite } from "../../src/domain/geo";
import {
  appendGroup,
  type CatalogEntry,
  collectIncoming,
  createPropagationContext,
  GP_GROUPS,
  INCOMING_MIN_ALT_DEG,
  INCOMING_STEP_MS,
  INCOMING_STEPS,
  incomingEtaSec,
  parseGpFile,
  SAMPLE_STRIDE,
  SampleField,
  writeSample,
} from "../../src/domain/orbits";
import { horizonAltAtAzDeg } from "../../src/domain/terrain";

// ---- fixtures (M8 section 5)

/** "Subaru": the inline Subaru defaults (the published pointing). One object, so the context cache keys on it. */
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
/** "Fisheye": synthetic-maunakea. */
const FISHEYE_SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const FISHEYE: CameraModel = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

const DOCKED_WITH_ISS = [36086, 49044, 68837, 100057, 100712, 100882] as const;

function readGroup(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8"));
}

/** Stations + visual through appendGroup, as the worker holds them: satrecs, groupIndex and the docked flags. */
function loadCatalog(): {
  entries: CatalogEntry[];
  satrecs: SatRec[];
  groupIndex: Uint8Array;
  skip: Uint8Array;
} {
  const seen = new Set<number>();
  const entries = [
    ...appendGroup(seen, "stations", parseGpFile(readGroup("stations.json"))),
    ...appendGroup(seen, "visual", parseGpFile(readGroup("visual.json"))),
  ];
  return {
    entries,
    satrecs: entries.map((e) => json2satrec(e.omm)),
    groupIndex: Uint8Array.from(entries, (e) => GP_GROUPS.indexOf(e.group)),
    skip: Uint8Array.from(entries, (e) => (e.dockedWith === null ? 0 : 1)),
  };
}

const CATALOG = loadCatalog();
const ISS_INDEX = CATALOG.entries.findIndex((e) => e.noradId === 25544);
const ISS = CATALOG.satrecs[ISS_INDEX] as SatRec;

const sample = new Float32Array(SAMPLE_STRIDE);
const azAlt = new Float64Array(2);
const uv = new Float64Array(2);

/** The visible-in-frame predicate (M8 step 4.2) at one time: sunlit, above the terrain horizon, inside the frame. */
function visibleInFrame(
  satrec: SatRec,
  site: ObserverSite,
  camera: CameraModel,
  timeMs: number,
  profile: Float32Array | null = null,
): boolean {
  const ctx = createPropagationContext(timeMs, site);
  if (!writeSample(satrec, ctx, sample, 0)) throw new Error("propagation failed");
  if (sample[SampleField.sunlit] !== 1) return false;
  enuToAzAltDeg(sample[0] ?? 0, sample[1] ?? 0, sample[2] ?? 0, azAlt, 0);
  const az = azAlt[0] ?? Number.NaN;
  const alt = apparentAltDeg(azAlt[1] ?? Number.NaN);
  if (!(alt > horizonAltAtAzDeg(profile, az))) return false;
  if (!projectAzAltDeg(camera, az, alt, uv, 0)) return false;
  const u = uv[0] ?? Number.NaN;
  const v = uv[1] ?? Number.NaN;
  return u >= 0 && u <= camera.widthPx && v >= 0 && v <= camera.heightPx;
}

/**
 * First whole ms in (loMs, hiMs] where test turns true. Throws unless test(loMs) is false and test(hiMs) true, so a
 * changed snapshot fails loudly instead of bisecting nonsense.
 */
function bisectFirstMs(loMs: number, hiMs: number, test: (timeMs: number) => boolean): number {
  if (test(loMs) || !test(hiMs)) {
    throw new Error(
      `no false → true change in [${new Date(loMs).toISOString()}, ${new Date(hiMs).toISOString()}]`,
    );
  }
  let lo = loMs;
  let hi = hiMs;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (test(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** [noradId, etaSec] pairs of a collectIncoming result. */
function listed(
  site: ObserverSite,
  camera: CameraModel,
  iso: string,
  groups = 0b011,
  skip = CATALOG.skip,
): [number, number][] {
  return collectIncoming(
    CATALOG.satrecs,
    CATALOG.groupIndex,
    skip,
    groups,
    site,
    camera,
    Date.parse(iso),
    null,
  ).map((h) => [CATALOG.entries[h.index]?.noradId ?? -1, h.etaSec]);
}

// ---- tests

describe("incoming constants", () => {
  it("look 60 s ahead in 5 s steps and ignore objects at or below −5°", () => {
    expect(INCOMING_STEP_MS).toBe(5000);
    expect(INCOMING_STEPS).toBe(12);
    expect(INCOMING_MIN_ALT_DEG).toBe(-5);
  });

  it("load the stations + visual catalogue with the ISS and its docked modules", () => {
    expect(ISS_INDEX).toBeGreaterThanOrEqual(0);
    for (const id of DOCKED_WITH_ISS) {
      const entry = CATALOG.entries.find((e) => e.noradId === id);
      expect(entry?.dockedWith, `${id}`).toBe(25544);
    }
  });
});

describe("incomingEtaSec · synthetic pass, frame entry (ISS, Subaru)", () => {
  const entryMs = bisectFirstMs(
    Date.parse("2026-10-11T15:09:50Z"),
    Date.parse("2026-10-11T15:10:00Z"),
    (t) => visibleInFrame(ISS, SUBARU_SITE, SUBARU, t),
  );

  it("bisects the entry to 2026-10-11T15:09:54.955Z with the Sun at −16.19°", () => {
    expect(Math.abs(entryMs - Date.parse("2026-10-11T15:09:54.955Z"))).toBeLessThanOrEqual(2);
    const sunAltDeg = createPropagationContext(entryMs, SUBARU_SITE).sunAltDeg;
    expect(Math.abs(sunAltDeg - -16.19)).toBeLessThan(0.01);
  });

  it("is null from 61 to 70 s before the entry", () => {
    for (let k = 61; k <= 70; k++) {
      expect(incomingEtaSec(ISS, SUBARU_SITE, SUBARU, entryMs - 1000 * k, null), `E − ${k} s`).toBe(
        null,
      );
    }
  });

  it("brackets the entry within one 5 s step from 1 to 60 s before it", () => {
    for (let k = 1; k <= 60; k++) {
      const t = entryMs - 1000 * k;
      const eta = incomingEtaSec(ISS, SUBARU_SITE, SUBARU, t, null);
      expect(eta, `E − ${k} s`).not.toBeNull();
      const etaSec = eta ?? Number.NaN;
      expect(etaSec % 5, `E − ${k} s`).toBe(0);
      expect(etaSec).toBeGreaterThanOrEqual(5);
      expect(etaSec).toBeLessThanOrEqual(60);
      const late = t + 1000 * etaSec - entryMs;
      expect(late, `E − ${k} s`).toBeGreaterThanOrEqual(0);
      expect(late, `E − ${k} s`).toBeLessThan(5000);
    }
  });

  it("does not list the ISS 1 s after the entry: it is visible now", () => {
    const hits = collectIncoming(
      CATALOG.satrecs,
      CATALOG.groupIndex,
      CATALOG.skip,
      0b011,
      SUBARU_SITE,
      SUBARU,
      entryMs + 1000,
      null,
    );
    expect(hits.some((h) => h.index === ISS_INDEX)).toBe(false);
    // ... though it is listed 30 s before.
    const before = collectIncoming(
      CATALOG.satrecs,
      CATALOG.groupIndex,
      CATALOG.skip,
      0b011,
      SUBARU_SITE,
      SUBARU,
      entryMs - 30_000,
      null,
    );
    expect(before.some((h) => h.index === ISS_INDEX)).toBe(true);
  });
});

describe("incomingEtaSec · synthetic pass, shadow exit (ISS, fisheye; gotcha 7)", () => {
  const exitMs = bisectFirstMs(
    Date.parse("2026-10-11T15:04:30Z"),
    Date.parse("2026-10-11T15:06:00Z"),
    (t) => visibleInFrame(ISS, FISHEYE_SITE, FISHEYE, t),
  );

  it("rises in shadow at 15:04:25.874Z and leaves the shadow inside the frame at 15:05:39.300Z", () => {
    const riseMs = bisectFirstMs(
      Date.parse("2026-10-11T15:04:00Z"),
      Date.parse("2026-10-11T15:04:30Z"),
      (t) => {
        const ctx = createPropagationContext(t, FISHEYE_SITE);
        writeSample(ISS, ctx, sample, 0);
        enuToAzAltDeg(sample[0] ?? 0, sample[1] ?? 0, sample[2] ?? 0, azAlt, 0);
        return apparentAltDeg(azAlt[1] ?? Number.NaN) > 0;
      },
    );
    expect(Math.abs(riseMs - Date.parse("2026-10-11T15:04:25.874Z"))).toBeLessThanOrEqual(2);
    expect(Math.abs(exitMs - Date.parse("2026-10-11T15:05:39.300Z"))).toBeLessThanOrEqual(2);
    const sunAltDeg = createPropagationContext(exitMs, FISHEYE_SITE).sunAltDeg;
    expect(Math.abs(sunAltDeg - -17.18)).toBeLessThan(0.01);
  });

  it("is 35 s at exit − 32.5 s while the ISS is still in shadow, 60 s at exit − 60 s, null at exit − 62.5 s", () => {
    expect(incomingEtaSec(ISS, FISHEYE_SITE, FISHEYE, exitMs - 32_500, null)).toBe(35);
    expect(incomingEtaSec(ISS, FISHEYE_SITE, FISHEYE, exitMs - 60_000, null)).toBe(60);
    expect(incomingEtaSec(ISS, FISHEYE_SITE, FISHEYE, exitMs - 62_500, null)).toBeNull();
    writeSample(ISS, createPropagationContext(exitMs - 32_500, FISHEYE_SITE), sample, 0);
    expect(sample[SampleField.valid]).toBe(1);
    expect(sample[SampleField.sunlit]).toBe(0);
  });
});

describe("incomingEtaSec · horizon profile", () => {
  it("uses the terrain horizon at the satellite's azimuth (fisheye, 15:05:07Z)", () => {
    const t = Date.parse("2026-10-11T15:05:07Z");
    expect(incomingEtaSec(ISS, FISHEYE_SITE, FISHEYE, t, null)).toBe(35);
    expect(incomingEtaSec(ISS, FISHEYE_SITE, FISHEYE, t, new Float32Array(360).fill(-0.27))).toBe(
      35,
    );
    expect(
      incomingEtaSec(ISS, FISHEYE_SITE, FISHEYE, t, new Float32Array(360).fill(30)),
    ).toBeNull();
  });
});

describe("collectIncoming", () => {
  it("lists the ISS and SL-3 R/B 19046 on the fisheye at 15:05:07Z", () => {
    expect(listed(FISHEYE_SITE, FISHEYE, "2026-10-11T15:05:07Z")).toEqual([
      [25544, 35],
      [19046, 55],
    ]);
  });

  it("lists SL-3 R/B 10114 on the fisheye at 15:06:07Z", () => {
    expect(listed(FISHEYE_SITE, FISHEYE, "2026-10-11T15:06:07Z")).toEqual([[10114, 50]]);
  });

  it("lists only the ISS for Subaru at 15:09:22Z, never its docked modules (gotcha 16)", () => {
    const hits = listed(SUBARU_SITE, SUBARU, "2026-10-11T15:09:22Z");
    expect(hits).toEqual([[25544, 35]]);
    // Without the docked flags the six modules would duplicate the ISS with its ETA.
    const unskipped = listed(
      SUBARU_SITE,
      SUBARU,
      "2026-10-11T15:09:22Z",
      0b011,
      new Uint8Array(CATALOG.satrecs.length),
    );
    for (const id of DOCKED_WITH_ISS) expect(unskipped, `${id}`).toContainEqual([id, 35]);
  });

  it("returns [] in daylight without touching a satellite (Subaru, 22:00Z, every group)", () => {
    expect(listed(SUBARU_SITE, SUBARU, "2026-10-11T22:00:00Z", 0b111)).toEqual([]);
  });

  it("covers only the groups in the mask", () => {
    expect(listed(FISHEYE_SITE, FISHEYE, "2026-10-11T15:05:07Z", 0b001)).toEqual([[25544, 35]]);
    expect(listed(FISHEYE_SITE, FISHEYE, "2026-10-11T15:05:07Z", 0b010)).toEqual([[19046, 55]]);
    expect(listed(FISHEYE_SITE, FISHEYE, "2026-10-11T15:05:07Z", 0b100)).toEqual([]);
    expect(listed(FISHEYE_SITE, FISHEYE, "2026-10-11T15:05:07Z", 0)).toEqual([]);
  });

  it("sorts by etaSec, then index", () => {
    const hits = collectIncoming(
      CATALOG.satrecs,
      CATALOG.groupIndex,
      new Uint8Array(CATALOG.satrecs.length),
      0b011,
      SUBARU_SITE,
      SUBARU,
      Date.parse("2026-10-11T15:09:22Z"),
      null,
    );
    expect(hits.length).toBe(7);
    for (let i = 1; i < hits.length; i++) {
      const a = hits[i - 1];
      const b = hits[i];
      if (a === undefined || b === undefined) throw new Error("hole in the hit list");
      expect(a.etaSec < b.etaSec || (a.etaSec === b.etaSec && a.index < b.index)).toBe(true);
    }
  });
});

describe("incoming · propagation failure", () => {
  const issOmm = (readGroup("stations.json") as OMMJsonObject[]).find(
    (r) => Number(r.NORAD_CAT_ID) === 25544,
  );
  if (issOmm === undefined) throw new Error("ISS missing from the snapshot");
  const t = Date.parse("2026-10-11T15:09:22Z");

  it("returns null for an ISS OMM with ECCENTRICITY 1.2", () => {
    const bad = json2satrec({ ...issOmm, ECCENTRICITY: 1.2 });
    expect(propagate(bad, new Date(t))).toBeNull();
    expect(bad.error).toBe(1);
    expect(incomingEtaSec(bad, SUBARU_SITE, SUBARU, t, null)).toBeNull();
  });

  it("skips a failing object in collectIncoming", () => {
    const bad = json2satrec({ ...issOmm, ECCENTRICITY: 1.2 });
    const hits = collectIncoming(
      [bad, ISS],
      new Uint8Array([0, 0]),
      new Uint8Array([0, 0]),
      0b011,
      SUBARU_SITE,
      SUBARU,
      t,
      null,
    );
    expect(hits).toEqual([{ index: 1, etaSec: 35 }]);
  });
});
