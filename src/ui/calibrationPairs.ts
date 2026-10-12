// src/ui/calibrationPairs.ts — star pairs and the fit for the Calibration panel (M4 step 14, items 1, 4 and 5).
// Catalogue targets at the frame time, the 3 nearest to a pending point, the click rule, the panel's fit run with its
// holdouts and acceptance report, and "Compare lens models". Pure functions (no React, no OpenLayers, no store), kept
// out of the component file so it stays a React Fast Refresh boundary; the sky view's click wiring shares them.
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
  rotateStarsAzAltDeg,
  type StarRow,
  starUnitVectors,
} from "../domain/astro";
import {
  type AcceptancePair,
  type AcceptanceReport,
  type Calibration,
  type CameraModel,
  calibrationAcceptance,
  createCameraModel,
  type FitPair,
  fitCalibration,
  horizonRadiusUnit,
  type LensModel,
  projectAzAltDeg,
  unprojectPixel,
} from "../domain/camera";
import { angularSeparationDeg, type ObserverSite } from "../domain/geo";
import { starCountForLimit } from "../state/skyCache";
import type { CalibrationUiState, PlanetId, StarId, StarPair } from "../state/types";

/** Catalogue markers while calibrating: stars with V ≤ 4 (selectStarMagLimit) and the planets (M4 step 14). */
export const CALIBRATION_STAR_MAG_LIMIT = 4;
/** A click this close to a marker, in screen pixels, completes the pending pair (M4 step 14.4). */
export const PAIR_CLICK_RADIUS_SCREEN_PX = 6;
/** The panel lists this many catalogue objects nearest the pending point (M4 step 14.4). */
export const NEAREST_TARGET_COUNT = 3;
/** The Fit button needs this many fit pairs; below FREE_FIT_MIN_PAIRS the fit holds k1 and a locked tilt. */
export const FIT_MIN_PAIRS = 4;
export const FREE_FIT_MIN_PAIRS = 8;
/** The panel's fitCalibration options besides fitK1 and fitTilt (M4 step 14.5). */
export const PANEL_FIT_MAX_ITERATIONS = 100;
export const PANEL_FIT_REJECT_SIGMA = 3;

export interface CatalogTarget {
  readonly id: StarId | PlanetId;
  readonly name: string; // the stars.json name, else "HR n"; planets by name
  readonly kind: "star" | "planet";
  readonly named: boolean; // a non-empty stars.json name (calibrationAcceptance); planets count as named
  readonly azDeg: number; // apparent ('normal' refraction) at the frame time, as the overlay draws it
  readonly altDeg: number;
}

/** "planet:Saturn" → "Saturn"; "star:7001" → "HR 7001" (the panel's fallback when the catalogue has no row). */
export function targetFallbackName(id: StarId | PlanetId): string {
  return id.startsWith("planet:") ? id.slice("planet:".length) : `HR ${id.slice("star:".length)}`;
}

/**
 * The catalogue markers of the calibration overlay at timeMs (the frame time): stars with V ≤ 4 through
 * starUnitVectors and rotateStarsAzAltDeg, the six planets through computeBodies, both apparent (M4 step 14.5).
 * Stars first, brightest first, then planets in BODY_IDS order. About 500 stars: compute once per frame time.
 */
export function catalogTargetsAt(
  rows: readonly StarRow[],
  site: ObserverSite,
  timeMs: number,
): CatalogTarget[] {
  const time = astroTimeAt(timeMs);
  const observer = makeObserver(site);
  const count = starCountForLimit(rows, CALIBRATION_STAR_MAG_LIMIT); // rows are sorted by vmag
  const bright = rows.slice(0, count);
  const azAlt = new Float32Array(2 * count);
  rotateStarsAzAltDeg(time, observer, starUnitVectors(bright), count, azAlt);
  const targets: CatalogTarget[] = [];
  bright.forEach((row, i) => {
    const [, , , hr, name] = row;
    targets.push({
      id: `star:${hr}`,
      name: name === "" ? `HR ${hr}` : name,
      kind: "star",
      named: name !== "",
      azDeg: azAlt[2 * i] ?? Number.NaN,
      altDeg: azAlt[2 * i + 1] ?? Number.NaN,
    });
  });
  const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE);
  computeBodies(time, observer, bodies);
  BODY_IDS.forEach((id, i) => {
    if (!id.startsWith("planet:")) return; // pairs take stars and planets only (StarPair.targetId)
    const planetId = id as PlanetId;
    targets.push({
      id: planetId,
      name: targetFallbackName(planetId),
      kind: "planet",
      named: true,
      azDeg: bodies[i * BODY_STRIDE] ?? Number.NaN,
      altDeg: bodies[i * BODY_STRIDE + 1] ?? Number.NaN,
    });
  });
  return targets;
}

/** Targets by id, for the pair table and the fit. */
export function targetsById(
  targets: readonly CatalogTarget[],
): ReadonlyMap<StarId | PlanetId, CatalogTarget> {
  return new Map(targets.map((t) => [t.id, t]));
}

export interface ProjectedTarget {
  readonly target: CatalogTarget;
  readonly uPx: number;
  readonly vPx: number;
}

/** The targets that project into the frame under the model (projectAzAltDeg's culls apply), with their pixels. */
export function projectTargets(
  model: CameraModel,
  targets: readonly CatalogTarget[],
): ProjectedTarget[] {
  const uv = new Float64Array(2);
  const out: ProjectedTarget[] = [];
  for (const target of targets) {
    if (!projectAzAltDeg(model, target.azDeg, target.altDeg, uv, 0)) continue;
    out.push({ target, uPx: uv[0] ?? Number.NaN, vPx: uv[1] ?? Number.NaN });
  }
  return out;
}

export interface NearTarget extends ProjectedTarget {
  readonly distancePx: number; // image pixels from the point
}

/** The `count` projected targets nearest (uPx, vPx) in image pixels, nearest first; ties keep catalogue order. */
export function nearestTargets(
  projected: readonly ProjectedTarget[],
  uPx: number,
  vPx: number,
  count: number = NEAREST_TARGET_COUNT,
): NearTarget[] {
  return projected
    .map((p) => ({ ...p, distancePx: Math.hypot(p.uPx - uPx, p.vPx - vPx) }))
    .sort((a, b) => a.distancePx - b.distancePx)
    .slice(0, count);
}

export type PairClick =
  | { readonly kind: "ignore" }
  | { readonly kind: "add"; readonly uPx: number; readonly vPx: number }
  | { readonly kind: "complete"; readonly targetId: StarId | PlanetId };

/**
 * The calibration click rule (M4 step 14.4) for an image pixel (u, v) = (x, H − y) of a singleclick. Outside
 * [0, W] × [0, H]: ignore. With a point pending, a click within 6 screen px of a marker completes the pair with the
 * nearest such marker; any other click (re)places the pending point (addImagePoint replaces it).
 * imagePxPerScreenPx is the view's resolution.
 */
export function pairClick(
  uPx: number,
  vPx: number,
  widthPx: number,
  heightPx: number,
  pendingPx: CalibrationUiState["pendingPx"],
  projected: readonly ProjectedTarget[],
  imagePxPerScreenPx: number,
): PairClick {
  if (!(uPx >= 0 && uPx <= widthPx && vPx >= 0 && vPx <= heightPx)) return { kind: "ignore" };
  if (pendingPx !== null) {
    const [nearest] = nearestTargets(projected, uPx, vPx, 1);
    if (
      nearest !== undefined &&
      nearest.distancePx <= PAIR_CLICK_RADIUS_SCREEN_PX * imagePxPerScreenPx
    ) {
      return { kind: "complete", targetId: nearest.target.id };
    }
  }
  return { kind: "add", uPx, vPx };
}

/** "Point set at u 612.4, v 433.0. Choose its star." — the live-region text for a pending point (M4 step 14.7). */
export function pendingPointText(pendingPx: readonly [number, number]): string {
  return `Point set at u ${pendingPx[0].toFixed(1)}, v ${pendingPx[1].toFixed(1)}. Choose its star.`;
}

/** Pair indices in table order: as added, or by the last fit's pixel residual, largest first (no residual last). */
export function pairOrder(pairs: readonly StarPair[], byResidual: boolean): number[] {
  const order = pairs.map((_, i) => i);
  if (!byResidual) return order;
  const key = (i: number): number => {
    const r = pairs[i]?.residualPx;
    return r === null || r === undefined || Number.isNaN(r) ? Number.NEGATIVE_INFINITY : r;
  };
  return order.sort((a, b) => key(b) - key(a) || a - b);
}

export const countFitPairs = (pairs: readonly StarPair[]): number =>
  pairs.reduce((n, p) => n + (p.role === "fit" ? 1 : 0), 0);

// ---- The panel's fit (M4 step 14.5) ----

export interface PanelFitInput {
  readonly lens: LensModel;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly start: Calibration;
  readonly pairs: readonly StarPair[];
  readonly targets: ReadonlyMap<StarId | PlanetId, CatalogTarget>;
  readonly fitK1: boolean;
  readonly fitTilt: boolean;
}

export interface PanelFitSuccess {
  readonly ok: true;
  readonly calibration: Calibration; // for applyFit
  readonly residualPx: number[]; // aligned to the input pairs (holdouts measured too); NaN when not measurable
  readonly rejected: boolean[]; // aligned to the input pairs; holdouts are never rejected
  readonly residualDeg: number[]; // aligned to the input pairs; kept in component state
  readonly fit: NonNullable<CalibrationUiState["fit"]>;
  readonly report: AcceptanceReport;
  readonly heldK1: boolean; // "Fit k1" was on but fewer than 8 fit pairs held it
  readonly heldTilt: boolean; // "Fit tilt" was on a locked camera but fewer than 8 fit pairs held it
}

export interface PanelFitFailure {
  readonly ok: false;
  readonly reason: "too-few-pairs" | "behind-camera" | "no-convergence";
  readonly message: string; // "Fit failed: …"
}

export type PanelFitOutcome = PanelFitSuccess | PanelFitFailure;

const isFisheye = (lens: LensModel): boolean => lens !== "rectilinear";

/** True when the target is behind the camera for the fit: ≥ 90° from a rectilinear axis, > 90° from a fisheye's. */
function behindCamera(lens: LensModel, c: Calibration, target: CatalogTarget): boolean {
  const locked = isFisheye(lens) && c.altDeg === 90;
  const sep = angularSeparationDeg(
    locked ? 0 : c.azDeg,
    locked ? 90 : c.altDeg,
    target.azDeg,
    target.altDeg,
  );
  return isFisheye(lens) ? sep > 90 : sep >= 90;
}

/** Pixel distance between the target's projection and the click; NaN when the target does not project. */
function pixelResidual(
  model: CameraModel,
  pair: StarPair,
  target: CatalogTarget | undefined,
): number {
  if (target === undefined) return Number.NaN;
  const uv = new Float64Array(2);
  if (!projectAzAltDeg(model, target.azDeg, target.altDeg, uv, 0)) return Number.NaN;
  return Math.hypot(
    (uv[0] ?? Number.NaN) - pair.imagePx[0],
    (uv[1] ?? Number.NaN) - pair.imagePx[1],
  );
}

/** Angle between the click's unprojected direction and the target; NaN when the click does not unproject. */
function degreeResidual(
  model: CameraModel,
  pair: StarPair,
  target: CatalogTarget | undefined,
): number {
  if (target === undefined) return Number.NaN;
  const sky = new Float64Array(2);
  if (!unprojectPixel(model, pair.imagePx[0], pair.imagePx[1], sky, 0)) return Number.NaN;
  return angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, target.azDeg, target.altDeg);
}

/**
 * The panel's fit: fitCalibration on the fit pairs (maxIterations 100, rejectSigma 3), holding k1 and a locked
 * camera's tilt below 8 fit pairs; holdouts measured with unprojectPixel and angularSeparationDeg under the result;
 * residuals and rejected flags aligned to calibrationUi.pairs for applyFit; the acceptance report. A failure names
 * its reason: fewer than 4 fit pairs, a target behind the camera with the current pointing, or no convergence.
 */
export function runPanelFit(input: PanelFitInput): PanelFitOutcome {
  const { lens, widthPx, heightPx, start, pairs, targets } = input;
  const fitIndices: number[] = [];
  pairs.forEach((p, i) => {
    if (p.role === "fit" && targets.has(p.targetId)) fitIndices.push(i);
  });
  if (fitIndices.length < FIT_MIN_PAIRS) {
    return {
      ok: false,
      reason: "too-few-pairs",
      message: `Fit failed: fewer than ${FIT_MIN_PAIRS} fit pairs.`,
    };
  }
  for (const i of fitIndices) {
    const pair = pairs[i];
    const target = pair === undefined ? undefined : targets.get(pair.targetId);
    if (target !== undefined && behindCamera(lens, start, target)) {
      return {
        ok: false,
        reason: "behind-camera",
        message: `Fit failed: ${target.name} is behind the camera with the current pointing. Align roughly first.`,
      };
    }
  }

  const locked = isFisheye(lens) && start.altDeg === 90;
  const free = fitIndices.length >= FREE_FIT_MIN_PAIRS;
  const fitPairs: FitPair[] = fitIndices.map((i) => {
    const pair = pairs[i] as StarPair; // an index of pairs
    const target = targets.get(pair.targetId) as CatalogTarget; // filtered above
    return {
      uPx: pair.imagePx[0],
      vPx: pair.imagePx[1],
      azDeg: target.azDeg,
      altDeg: target.altDeg,
    };
  });
  const result = fitCalibration(lens, widthPx, heightPx, start, fitPairs, {
    fitK1: input.fitK1 && free,
    fitTilt: input.fitTilt && free,
    maxIterations: PANEL_FIT_MAX_ITERATIONS,
    rejectSigma: PANEL_FIT_REJECT_SIGMA,
  });
  if (result === null) {
    return {
      ok: false,
      reason: "no-convergence",
      message: "Fit failed: the fit did not converge.",
    };
  }

  const model = createCameraModel({ lens, calibration: result.calibration, widthPx, heightPx });
  const residualPx = pairs.map((p) => pixelResidual(model, p, targets.get(p.targetId)));
  const residualDeg = pairs.map((p) => degreeResidual(model, p, targets.get(p.targetId)));
  const rejected = pairs.map(() => false);
  fitIndices.forEach((pairIndex, j) => {
    residualPx[pairIndex] = result.residualPx[j] ?? Number.NaN;
    residualDeg[pairIndex] = result.residualDeg[j] ?? Number.NaN;
    rejected[pairIndex] = result.rejected[j] === 1;
  });

  const acceptancePairs: AcceptancePair[] = [];
  let maxFitDeg = 0;
  let maxHoldoutDeg: number | null = null;
  pairs.forEach((p, i) => {
    const target = targets.get(p.targetId);
    const deg = residualDeg[i] ?? Number.NaN;
    if (p.role === "fit") {
      if (target === undefined || rejected[i]) return;
      maxFitDeg = Math.max(maxFitDeg, deg); // NaN wins: a click that does not unproject is no pass
    } else {
      maxHoldoutDeg = maxHoldoutDeg === null ? deg : Math.max(maxHoldoutDeg, deg);
    }
    if (target === undefined) return;
    acceptancePairs.push({
      kind: target.kind,
      named: target.named,
      altDeg: target.altDeg,
      role: p.role,
      rejected: rejected[i] ?? false,
      residualDeg: deg,
    });
  });

  return {
    ok: true,
    calibration: result.calibration,
    residualPx,
    rejected,
    residualDeg,
    fit: { rmsPx: result.rmsPx, rmsDeg: result.rmsDeg, maxFitDeg, maxHoldoutDeg },
    report: calibrationAcceptance(lens, acceptancePairs),
    heldK1: input.fitK1 && !free,
    heldTilt: input.fitTilt && locked && !free,
  };
}

// ---- Acceptance checklist (M4 step 14.5; DECISIONS "Calibration acceptance") ----

export interface ChecklistLine {
  readonly text: string; // the line, with its count or value and its threshold
  readonly pass: boolean;
}

/** Lowest target altitude that counts: 20° on fisheyes, 10° on rectilinear lenses (calibrationAcceptance). */
export const acceptanceMinAltDeg = (lens: LensModel): number => (isFisheye(lens) ? 20 : 10);

const degText = (deg: number | null): string =>
  deg === null || Number.isNaN(deg) ? "none" : `${deg.toFixed(3)}°`;

/** One line per acceptance threshold, each with its count or value and the threshold. */
export function acceptanceChecklist(lens: LensModel, r: AcceptanceReport): ChecklistLine[] {
  const minAlt = acceptanceMinAltDeg(lens);
  return [
    {
      text: `Named fit stars at altitude ≥ ${minAlt}°: ${r.namedFitStars} (at least 10)`,
      pass: r.namedFitStars >= 10,
    },
    { text: `Fit RMS: ${degText(r.rmsDeg)} (at most 0.25°)`, pass: r.rmsDeg <= 0.25 },
    { text: `Largest fit error: ${degText(r.maxFitDeg)} (at most 0.5°)`, pass: r.maxFitDeg <= 0.5 },
    {
      text: `Holdout stars at altitude ≥ ${minAlt}°: ${r.holdoutStars} (at least 3)`,
      pass: r.holdoutStars >= 3,
    },
    {
      text: `Holdout planets at altitude ≥ ${minAlt}°: ${r.holdoutPlanets} (at least 1)`,
      pass: r.holdoutPlanets >= 1,
    },
    {
      text: `Largest holdout error: ${degText(r.maxHoldoutDeg)} (at most 0.5°)`,
      pass: r.maxHoldoutDeg !== null && r.maxHoldoutDeg <= 0.5,
    },
  ];
}

/** The live-region summary of a fit: "Fit done: RMS 1.23 px, 0.041°. Acceptance: pass." plus any held parameter. */
export function fitResultText(outcome: PanelFitOutcome): string {
  if (!outcome.ok) return outcome.message;
  const held: string[] = [];
  if (outcome.heldK1) held.push("k1");
  if (outcome.heldTilt) held.push("the tilt");
  const heldText =
    held.length === 0
      ? ""
      : ` Fewer than ${FREE_FIT_MIN_PAIRS} fit pairs: ${held.join(" and ")} held.`;
  const rejected = outcome.rejected.filter(Boolean).length;
  const rejectedText = rejected === 0 ? "" : ` ${rejected} rejected by the 3σ rule.`;
  return `Fit done: RMS ${outcome.fit.rmsPx.toFixed(2)} px, ${outcome.fit.rmsDeg.toFixed(3)}°.${rejectedText}${heldText} Acceptance: ${outcome.report.pass ? "pass" : "fail"}.`;
}

// ---- Compare lens models (M4 step 14.1) ----

export const FISHEYE_LENSES: readonly LensModel[] = [
  "fisheye-equidistant",
  "fisheye-equisolid",
  "fisheye-stereographic",
  "fisheye-orthographic",
];

export interface LensComparisonRow {
  readonly lens: LensModel;
  readonly outcome: PanelFitOutcome;
}

/**
 * Fits every fisheye lens from the current calibration with focalPx scaled by the ratio of horizon radii (the same
 * image radius at the horizon) and k1 0, and returns each outcome. Changes nothing: the registry keeps its lens.
 */
export function compareLensModels(input: PanelFitInput): LensComparisonRow[] {
  const hNow = horizonRadiusUnit(input.lens);
  return FISHEYE_LENSES.map((lens) => {
    const start: Calibration = {
      ...input.start,
      focalPx: (input.start.focalPx * hNow) / horizonRadiusUnit(lens),
      k1: 0,
    };
    return { lens, outcome: runPanelFit({ ...input, lens, start }) };
  });
}
