// M4 acceptance on a real frame (M4 step 18, section 5 "calibrationFixture.test.ts"; DECISIONS "Calibration
// acceptance"): the star pairs measured on the recorded Subaru StarCam clip of 2026-10-11 are refitted with the
// project's own fit from the provisional Subaru defaults, holdouts are measured under the result, and
// calibrationAcceptance must pass. Targets are recomputed at each epoch's frameTimeMs from public/data/stars.json
// (starUnitVectors, rotateStarsAzAltDeg) and computeBodies, at the registry site; nothing is taken from the fixture
// but the clicks, the ids, the roles, the times and the start.
//
// The fixture is rebuilt by scripts/fixtures/clip-pairs.ts from the gitignored clip. The StarCam is rectilinear, so
// the altitude floor is 10°.
// TODO(M4 step 18): tests/fixtures/calibration/cfht-nanaao-pairs.json, exported from the panel on a real Nānā ao
// frame on a clear night with the hatch open, through the same checks with the fisheye floor of 20°.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
  rotateStarsAzAltDeg,
  type StarRow,
  starUnitVectors,
} from "../../src/domain/astro";
import {
  type AcceptancePair,
  type AcceptanceReport,
  type Calibration,
  type CameraModel,
  calibrationAcceptance,
  createCameraModel,
  type FitPair,
  type FitResult,
  fitCalibration,
  type LensModel,
  unprojectPixel,
} from "../../src/domain/camera";
import { angularSeparationDeg } from "../../src/domain/geo";
import { parseObjectId } from "../../src/state/objectId";
import type { PlanetId, StarId, StarPair } from "../../src/state/types";
import {
  acceptanceMinAltDeg,
  PANEL_FIT_MAX_ITERATIONS,
  PANEL_FIT_REJECT_SIGMA,
} from "../../src/ui/calibrationPairs";
import { committedCameras } from "../helpers/store";

interface FixturePair {
  readonly imagePx: readonly [uPx: number, vPx: number];
  readonly targetId: StarId | PlanetId;
  readonly role: StarPair["role"];
}

interface FixtureEpoch {
  readonly mediaS: number;
  readonly firstFrame: number;
  readonly frameCount: number;
  readonly frameTimeMs: number;
  readonly frameTimeUtc: string;
  readonly pairs: readonly FixturePair[];
}

interface ClipPairsFixture {
  readonly cameraId: string;
  readonly lens: LensModel;
  readonly imageSize: { readonly widthPx: number; readonly heightPx: number };
  readonly calibration: Calibration; // the start: the provisional Subaru defaults at the clip's size
  readonly epochs: readonly FixtureEpoch[];
}

/** One pair with its target at its epoch's frame time. */
interface Measured {
  readonly epoch: number;
  readonly pair: FixturePair;
  readonly kind: "star" | "planet";
  readonly named: boolean;
  readonly name: string;
  readonly azDeg: number;
  readonly altDeg: number;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("../fixtures/calibration/subaru-clip-pairs.json", import.meta.url), "utf8"),
) as ClipPairsFixture;
const ROWS = JSON.parse(
  readFileSync(new URL("../../public/data/stars.json", import.meta.url), "utf8"),
) as StarRow[];
const CAMERA = committedCameras()[FIXTURE.cameraId];
const { widthPx: W, heightPx: H } = FIXTURE.imageSize;
const LENS = FIXTURE.lens;
const MIN_ALT_DEG = acceptanceMinAltDeg(LENS);

/** The 2026-10-11 star fit of the same clip by an independent script (DECISIONS O2), at 1920 × 1080. */
const INDEPENDENT_FIT: Calibration = {
  ...FIXTURE.calibration,
  azDeg: 81.2322,
  altDeg: 19.6185,
  rollDeg: 0.7698,
  focalPx: 2525.93 / 2,
  cxPx: 960,
  cyPx: 540,
  k1: -0.00992,
  k2: 0,
};

/** Every pair with its target recomputed at the epoch's frameTimeMs, in fixture order. */
function measuredPairs(): Measured[] {
  const site = CAMERA?.site;
  if (site === undefined) throw new Error(`camera ${FIXTURE.cameraId} is not in cameras.json`);
  const observer = makeObserver(site);
  const rowsByHr = new Map(ROWS.map((row) => [row[3], row]));
  const out: Measured[] = [];
  FIXTURE.epochs.forEach((epoch, e) => {
    const time = astroTimeAt(epoch.frameTimeMs);
    const starPairs = epoch.pairs.filter((p) => p.targetId.startsWith("star:"));
    const rows = starPairs.map((p) => {
      const row = rowsByHr.get(Number(p.targetId.slice("star:".length)));
      if (row === undefined) throw new Error(`${p.targetId} is not in stars.json`);
      return row;
    });
    const azAlt = new Float32Array(2 * rows.length);
    rotateStarsAzAltDeg(time, observer, starUnitVectors(rows), rows.length, azAlt);
    const starIndex = new Map(starPairs.map((p, i) => [p, i]));
    const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE);
    computeBodies(time, observer, bodies);
    for (const pair of epoch.pairs) {
      const i = starIndex.get(pair);
      if (i !== undefined) {
        const name = rows[i]?.[4] ?? "";
        out.push({
          epoch: e,
          pair,
          kind: "star",
          named: name !== "",
          name: name === "" ? `HR ${pair.targetId.slice("star:".length)}` : name,
          azDeg: azAlt[2 * i] ?? Number.NaN,
          altDeg: azAlt[2 * i + 1] ?? Number.NaN,
        });
        continue;
      }
      const b = (BODY_IDS as readonly string[]).indexOf(pair.targetId);
      if (b < 0) throw new Error(`${pair.targetId} is neither a star nor a planet`);
      out.push({
        epoch: e,
        pair,
        kind: "planet",
        named: true,
        name: pair.targetId.slice("planet:".length),
        azDeg: bodies[b * BODY_STRIDE] ?? Number.NaN,
        altDeg: bodies[b * BODY_STRIDE + 1] ?? Number.NaN,
      });
    }
  });
  return out;
}

/** Angle between the click's unprojected direction and the target; NaN when the click does not unproject. */
function residualDeg(model: CameraModel, m: Measured): number {
  const sky = new Float64Array(2);
  if (!unprojectPixel(model, m.pair.imagePx[0], m.pair.imagePx[1], sky, 0)) return Number.NaN;
  return angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, m.azDeg, m.altDeg);
}

interface FixtureFit {
  readonly fit: FitResult;
  readonly model: CameraModel;
  readonly fitPairs: readonly Measured[];
  readonly holdouts: readonly Measured[];
  readonly report: AcceptanceReport;
  readonly acceptance: readonly AcceptancePair[];
}

/** The panel's fit (k1 free, maxIterations 100, 3σ) on the fit pairs from `start`; holdouts measured under it. */
function runFit(all: readonly Measured[], start: Calibration): FixtureFit {
  const fitPairs = all.filter((m) => m.pair.role === "fit");
  const holdouts = all.filter((m) => m.pair.role === "holdout");
  const input: FitPair[] = fitPairs.map((m) => ({
    uPx: m.pair.imagePx[0],
    vPx: m.pair.imagePx[1],
    azDeg: m.azDeg,
    altDeg: m.altDeg,
  }));
  const fit = fitCalibration(LENS, W, H, start, input, {
    fitK1: true,
    fitTilt: false,
    maxIterations: PANEL_FIT_MAX_ITERATIONS,
    rejectSigma: PANEL_FIT_REJECT_SIGMA,
  });
  if (fit === null) throw new Error("the fit did not converge");
  const model = createCameraModel({
    lens: LENS,
    calibration: fit.calibration,
    widthPx: W,
    heightPx: H,
  });
  const acceptance: AcceptancePair[] = [
    ...fitPairs.map((m, i) => ({
      kind: m.kind,
      named: m.named,
      altDeg: m.altDeg,
      role: "fit" as const,
      rejected: fit.rejected[i] === 1,
      residualDeg: fit.residualDeg[i] ?? Number.NaN,
    })),
    ...holdouts.map((m) => ({
      kind: m.kind,
      named: m.named,
      altDeg: m.altDeg,
      role: "holdout" as const,
      rejected: false,
      residualDeg: residualDeg(model, m),
    })),
  ];
  return {
    fit,
    model,
    fitPairs,
    holdouts,
    report: calibrationAcceptance(LENS, acceptance),
    acceptance,
  };
}

let cached: { all: Measured[]; first: FixtureFit } | null = null;
function fixtureFit(): { all: Measured[]; first: FixtureFit } {
  if (cached === null) {
    const all = measuredPairs();
    cached = { all, first: runFit(all, FIXTURE.calibration) };
  }
  return cached;
}

const fmt = (deg: number | null, digits = 3): string =>
  deg === null ? "none" : `${deg.toFixed(digits)}°`;

describe("calibration fixture: Subaru StarCam clip, 2026-10-11", () => {
  it("is a rectilinear 1920 × 1080 copy of the registry camera, started from the provisional defaults", () => {
    expect(CAMERA).toBeDefined();
    expect(FIXTURE.cameraId).toBe("subaru-starcam");
    expect(LENS).toBe(CAMERA?.lens);
    expect(LENS).toBe("rectilinear");
    expect([W, H]).toEqual([1920, 1080]);
    // The clip is the stream at half size: same aspect as the registry's 3840 × 2160.
    expect(W * (CAMERA?.imageSize.heightPx ?? 0)).toBe(H * (CAMERA?.imageSize.widthPx ?? 0));
    // DECISIONS O2: fixtures naming the Subaru defaults keep az 81.2, alt 19.6, roll 0, f 2742 (here × 1920/3840).
    expect(FIXTURE.calibration).toMatchObject({
      azDeg: 81.2,
      altDeg: 19.6,
      rollDeg: 0,
      focalPx: 1371,
      cxPx: 960,
      cyPx: 540,
      k1: 0,
      k2: 0,
      flipX: false,
    });
    expect(FIXTURE.epochs.length).toBeGreaterThanOrEqual(1);
    for (const epoch of FIXTURE.epochs) {
      expect(epoch.frameTimeMs).toBe(Date.parse(epoch.frameTimeUtc));
      const ids = epoch.pairs.map((p) => p.targetId);
      expect(new Set(ids).size).toBe(ids.length); // one pair per target per epoch
      for (const p of epoch.pairs) {
        expect(parseObjectId(p.targetId)).toBe(p.targetId);
        expect(["fit", "holdout"]).toContain(p.role);
        const [u, v] = p.imagePx;
        expect(u >= 0 && u <= W && v >= 0 && v <= H).toBe(true);
      }
    }
  });

  it("passes calibrationAcceptance after the project's fit, with distinct named stars and holdouts", () => {
    const { all, first } = fixtureFit();
    const { fit, fitPairs, holdouts, report } = first;
    const c = fit.calibration;
    const rejected = fit.rejected.reduce((n, r) => n + r, 0);
    const named = new Set<string>();
    fitPairs.forEach((m, i) => {
      if (fit.rejected[i] !== 1 && m.kind === "star" && m.named && m.altDeg >= MIN_ALT_DEG)
        named.add(m.pair.targetId);
    });
    const holdoutStars = new Set(
      holdouts
        .filter((m) => m.kind === "star" && m.altDeg >= MIN_ALT_DEG)
        .map((m) => m.pair.targetId),
    );
    const holdoutText = holdouts
      .map((m) => `${m.name} (epoch ${m.epoch}) ${fmt(residualDeg(first.model, m))}`)
      .join(", ");
    console.log(
      [
        `Subaru clip fixture: ${all.length} pairs over ${FIXTURE.epochs.length} epochs ` +
          `(${new Set(all.map((m) => m.pair.targetId)).size} targets); ` +
          `${fitPairs.length} fit, ${rejected} rejected, ${holdouts.length} holdouts.`,
        `Fit: az ${c.azDeg.toFixed(4)}, alt ${c.altDeg.toFixed(4)}, roll ${c.rollDeg.toFixed(4)}, ` +
          `f ${c.focalPx.toFixed(2)} px, c (${c.cxPx.toFixed(2)}, ${c.cyPx.toFixed(2)}), k1 ${c.k1.toFixed(5)}; ` +
          `RMS ${fit.rmsPx.toFixed(3)} px = ${fmt(fit.rmsDeg, 4)}; ${fit.iterations} iterations.`,
        `Acceptance: ${report.namedFitStars} named fit pairs (${named.size} distinct stars) at alt ≥ ` +
          `${MIN_ALT_DEG}°, RMS ${fmt(report.rmsDeg, 4)}, worst fit ${fmt(report.maxFitDeg)}, ` +
          `${report.holdoutStars} holdout star pairs (${holdoutStars.size} stars), ` +
          `${report.holdoutPlanets} holdout planet pairs, worst holdout ${fmt(report.maxHoldoutDeg)}; ` +
          `pass ${report.pass}.`,
        `Holdouts: ${holdoutText}.`,
      ].join("\n"),
    );

    expect(report.namedFitStars).toBeGreaterThanOrEqual(10);
    expect(named.size).toBeGreaterThanOrEqual(10); // ≥ 10 named stars, not one star at 10 epochs
    expect(report.rmsDeg).toBeLessThanOrEqual(0.25);
    expect(report.maxFitDeg).toBeLessThanOrEqual(0.5);
    expect(report.holdoutStars).toBeGreaterThanOrEqual(3);
    expect(holdoutStars.size).toBeGreaterThanOrEqual(3);
    // Jupiter is in the frame at every epoch (alt 40–42°, the bright blob at the top edge).
    expect(report.holdoutPlanets).toBeGreaterThanOrEqual(1);
    expect(report.maxHoldoutDeg).not.toBeNull();
    expect(report.maxHoldoutDeg ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(0.5);
    expect(report.pass).toBe(true);
    // Every star within 0.5° holds even for the pairs the 3σ rule set aside (edge stars, k1 only).
    for (const deg of fit.residualDeg) expect(deg).toBeLessThanOrEqual(0.5);
  });

  it("refits to the same calibration from roll + 3° and f × 1.02 (within 0.01° on every pair)", () => {
    const { all, first } = fixtureFit();
    const c = first.fit.calibration;
    const second = runFit(all, { ...c, rollDeg: c.rollDeg + 3, focalPx: c.focalPx * 1.02 });
    for (const m of all) {
      const a = new Float64Array(2);
      const b = new Float64Array(2);
      const [u, v] = m.pair.imagePx;
      expect(unprojectPixel(first.model, u, v, a, 0)).toBe(true);
      expect(unprojectPixel(second.model, u, v, b, 0)).toBe(true);
      expect(angularSeparationDeg(a[0] ?? 0, a[1] ?? 0, b[0] ?? 0, b[1] ?? 0)).toBeLessThanOrEqual(
        0.01,
      );
    }
  });

  // The independent fit held the principal point at the centre and used other centroids; this fit frees cx and cy,
  // so the two part most at the frame edges.
  it("agrees with the independent star fit of the same clip within 0.1° at every pair", () => {
    const { all, first } = fixtureFit();
    const independent = createCameraModel({
      lens: LENS,
      calibration: INDEPENDENT_FIT,
      widthPx: W,
      heightPx: H,
    });
    for (const m of all) {
      const a = new Float64Array(2);
      const b = new Float64Array(2);
      const [u, v] = m.pair.imagePx;
      expect(unprojectPixel(first.model, u, v, a, 0)).toBe(true);
      expect(unprojectPixel(independent, u, v, b, 0)).toBe(true);
      expect(angularSeparationDeg(a[0] ?? 0, a[1] ?? 0, b[0] ?? 0, b[1] ?? 0)).toBeLessThanOrEqual(
        0.1,
      );
    }
  });
});
