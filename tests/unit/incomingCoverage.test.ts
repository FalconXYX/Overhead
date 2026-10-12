// tests/unit/incomingCoverage.test.ts — nothing missed (M8 section 5 and acceptance 4): over 12 hours every
// appearance in the frame (an edge entry or a shadow exit) is listed by collectIncoming 55 s before it.
import { readFileSync } from "node:fs";
import { json2satrec, type SatRec } from "satellite.js";
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
  collectIncoming,
  createPropagationContext,
  GP_GROUPS,
  type PropagationContext,
  parseGpFile,
  SAMPLE_STRIDE,
  SampleField,
  writeSample,
} from "../../src/domain/orbits";

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
const FISHEYE_SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const FISHEYE: CameraModel = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

const FROM_MS = Date.parse("2026-10-11T04:00:00Z");
const TO_MS = Date.parse("2026-10-11T16:00:00Z");
const STEP_MS = 5000;
const SUN_CUTOFF = -6; // stations and visual

function readGroup(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8"));
}

const seen = new Set<number>();
const ENTRIES = [
  ...appendGroup(seen, "stations", parseGpFile(readGroup("stations.json"))),
  ...appendGroup(seen, "visual", parseGpFile(readGroup("visual.json"))),
];
const SATRECS: SatRec[] = ENTRIES.map((e) => json2satrec(e.omm));
const GROUP_INDEX = Uint8Array.from(ENTRIES, (e) => GP_GROUPS.indexOf(e.group));
const SKIP = Uint8Array.from(ENTRIES, (e) => (e.dockedWith === null ? 0 : 1));

const sample = new Float32Array(SAMPLE_STRIDE);
const azAlt = new Float64Array(2);
const uv = new Float64Array(2);

/** The visible-in-frame predicate with a null profile (M8 step 4.2); a propagation failure counts as not visible. */
function visibleInFrame(satrec: SatRec, ctx: PropagationContext, camera: CameraModel): boolean {
  if (!writeSample(satrec, ctx, sample, 0)) return false;
  if (sample[SampleField.sunlit] !== 1) return false;
  enuToAzAltDeg(sample[0] ?? 0, sample[1] ?? 0, sample[2] ?? 0, azAlt, 0);
  const az = azAlt[0] ?? Number.NaN;
  const alt = apparentAltDeg(azAlt[1] ?? Number.NaN);
  if (!(alt > 0)) return false;
  if (!projectAzAltDeg(camera, az, alt, uv, 0)) return false;
  const u = uv[0] ?? Number.NaN;
  const v = uv[1] ?? Number.NaN;
  return u >= 0 && u <= camera.widthPx && v >= 0 && v <= camera.heightPx;
}

interface Coverage {
  appearances: number;
  listed: number;
  missed: string[];
}

function coverage(site: ObserverSite, camera: CameraModel): Coverage {
  const count = SATRECS.length;
  const prev = new Uint8Array(count);
  const first = createPropagationContext(FROM_MS, site);
  for (let i = 0; i < count; i++) {
    const satrec = SATRECS[i];
    if (SKIP[i] === 1 || satrec === undefined) continue;
    prev[i] = visibleInFrame(satrec, first, camera) ? 1 : 0;
  }
  const result: Coverage = { appearances: 0, listed: 0, missed: [] };
  for (let t = FROM_MS + STEP_MS; t <= TO_MS; t += STEP_MS) {
    const ctx = createPropagationContext(t, site);
    const dark =
      ctx.sunAltDeg <= SUN_CUTOFF &&
      createPropagationContext(t - 60_000, site).sunAltDeg <= SUN_CUTOFF;
    for (let i = 0; i < count; i++) {
      const satrec = SATRECS[i];
      if (SKIP[i] === 1 || satrec === undefined) continue;
      const now = visibleInFrame(satrec, ctx, camera);
      const appeared = now && prev[i] === 0;
      prev[i] = now ? 1 : 0;
      if (!appeared || !dark) continue;
      // Refine to 1 s: the first whole second in (t − 5 s, t] at which the predicate holds.
      let entryMs = t;
      for (let s = t - 4000; s < t; s += 1000) {
        if (visibleInFrame(satrec, createPropagationContext(s, site), camera)) {
          entryMs = s;
          break;
        }
      }
      result.appearances += 1;
      const askMs = entryMs - 55_000;
      const hit = collectIncoming(
        SATRECS,
        GROUP_INDEX,
        SKIP,
        0b011,
        site,
        camera,
        askMs,
        null,
      ).find((h) => h.index === i);
      const atMs = hit === undefined ? Number.NaN : askMs + 1000 * hit.etaSec;
      if (atMs >= entryMs - 1000 && atMs < entryMs + 5000) {
        result.listed += 1;
      } else {
        result.missed.push(
          `${ENTRIES[i]?.noradId} at ${new Date(entryMs).toISOString()}: ${hit === undefined ? "not listed" : `eta ${hit.etaSec} s`}`,
        );
      }
    }
  }
  return result;
}

describe("collectIncoming misses nothing over 2026-10-11T04:00Z–16:00Z (stations + visual)", () => {
  it("lists all 58 appearances in the Subaru frame", { timeout: 120_000 }, () => {
    const c = coverage(SUBARU_SITE, SUBARU);
    console.log(`Subaru: ${c.listed}/${c.appearances}`);
    expect(c.missed).toEqual([]);
    expect(c.appearances).toBe(58);
    expect(c.listed).toBe(58);
  });

  it("lists all 167 appearances on the synthetic fisheye", { timeout: 120_000 }, () => {
    const c = coverage(FISHEYE_SITE, FISHEYE);
    console.log(`fisheye: ${c.listed}/${c.appearances}`);
    expect(c.missed).toEqual([]);
    expect(c.appearances).toBe(167);
    expect(c.listed).toBe(167);
  });
});
