// src/domain/camera/fit.ts — calibration fit on star pairs, and the acceptance report. [M4]
//
// Levenberg–Marquardt on pixel residuals (M4 step 6). The state is the camera rotation R (the GeoPose matrix of the
// start: columns optical axis, image-left, image-up in ENU), focalPx, cxPx, cyPx and k1; k2 and flipX are never
// fitted. Each step is a body-axis rotation increment ω (R′ = R·Exp(ω), Rodrigues) plus Δf, Δcx, Δcy (+ Δk1):
// (az, alt, roll) is singular at the zenith, where az and roll are one rotation; an increment on R is not.
// The cost projects with the forward model's arithmetic but without its 1.05·rMaxUnit frame cull (gotcha G6);
// a trial that fails distortionValid, has f ≤ 0, puts a target behind a rectilinear camera or beyond 90° from a
// fisheye axis, or reaches g′(r) ≤ 0 at a target costs ∞.

import { angularSeparationDeg } from "../geo";
import { calibrationRotation, rotationToAzAltRoll } from "./geopose";
import { unprojectPixel } from "./inverse";
import {
  type Calibration,
  createCameraModel,
  distortionValid,
  type LensModel,
  lensRadiusUnit,
  normalizeCalibration,
} from "./lens";

export interface FitPair {
  readonly uPx: number;
  readonly vPx: number;
  readonly azDeg: number; // apparent ('normal' refraction), the same values the overlay draws
  readonly altDeg: number;
}

export interface FitOptions {
  readonly fitK1: boolean;
  readonly fitTilt: boolean; // frees a zenith-locked fisheye's axis; a tilted start always fits the full rotation
  readonly maxIterations: number; // Levenberg–Marquardt
  readonly rejectSigma: number; // 3: drop the worst pair beyond 3σ of the others and refit
}

export interface FitResult {
  readonly calibration: Calibration; // start values with fitted fields replaced, normalized
  readonly residualPx: Float64Array; // per pair, same order as the input
  readonly residualDeg: Float64Array;
  readonly rejected: Uint8Array; // 1 = dropped by the 3σ rule
  readonly rmsPx: number;
  readonly rmsDeg: number;
  readonly iterations: number;
}

export interface AcceptancePair {
  readonly kind: "star" | "planet";
  readonly named: boolean; // non-empty stars.json name
  readonly altDeg: number;
  readonly role: "fit" | "holdout";
  readonly rejected: boolean;
  readonly residualDeg: number;
}

export interface AcceptanceReport {
  readonly namedFitStars: number;
  readonly rmsDeg: number;
  readonly maxFitDeg: number;
  readonly holdoutStars: number;
  readonly holdoutPlanets: number;
  readonly maxHoldoutDeg: number | null;
  readonly pass: boolean;
}

const D2R = Math.PI / 180;
const HALF_PI = Math.PI / 2;

const MIN_PAIRS = 4;
const MAX_REJECT_ROUNDS = 10;
/** A residual below this is rounding, never an outlier (noise-free pairs would otherwise trip the 3σ rule). */
const REJECT_FLOOR_PX = 1e-3;

const LAMBDA_START = 1e-3;
const LAMBDA_MIN = 1e-12;
const LAMBDA_MAX = 1e12;
const LM_TRIES = 12;
const CONVERGED_REL = 1e-10;

const STEP_OMEGA_RAD = 1e-6;
const STEP_PX = 1e-3;
const STEP_K1 = 1e-7;

/** The fitted quantities. */
interface State {
  readonly m: Float64Array; // row-major rotation, columns F, image-left, image-up in ENU
  readonly f: number;
  readonly cx: number;
  readonly cy: number;
  readonly k1: number;
}

/** Which parameters a stage frees: rotation increments first, then f, cx, cy and optionally k1. */
interface Stage {
  readonly rollOnly: boolean; // ω about body x (the optical axis) only
  readonly fitK1: boolean;
}

/** out = a·b for row-major 3×3 matrices (out must not alias a or b). */
function mul3(a: Float64Array, b: Float64Array, out: Float64Array): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[3 * i + j] =
        (a[3 * i] ?? 0) * (b[j] ?? 0) +
        (a[3 * i + 1] ?? 0) * (b[3 + j] ?? 0) +
        (a[3 * i + 2] ?? 0) * (b[6 + j] ?? 0);
    }
  }
}

/** Rodrigues: Exp(ω) for a rotation vector ω (radians), row-major. */
function expSo3(wx: number, wy: number, wz: number, out: Float64Array): void {
  const t2 = wx * wx + wy * wy + wz * wz;
  const t = Math.sqrt(t2);
  // sin t / t and (1 − cos t)/t², by series below 1e-4 rad.
  const a = t < 1e-4 ? 1 - t2 / 6 : Math.sin(t) / t;
  const b = t < 1e-4 ? 0.5 - t2 / 24 : (1 - Math.cos(t)) / t2;
  out[0] = 1 - b * (wy * wy + wz * wz);
  out[1] = b * wx * wy - a * wz;
  out[2] = b * wx * wz + a * wy;
  out[3] = b * wx * wy + a * wz;
  out[4] = 1 - b * (wx * wx + wz * wz);
  out[5] = b * wy * wz - a * wx;
  out[6] = b * wx * wz - a * wy;
  out[7] = b * wy * wz + a * wx;
  out[8] = 1 - b * (wx * wx + wy * wy);
}

/**
 * Solves (A + λ·diag(A))δ = −g for symmetric A (n × n, row-major) by Gaussian elimination with partial pivoting
 * on the Jacobi-scaled system. A parameter whose diagonal is 0 (a zero Jacobian column) stays fixed.
 */
function solveDamped(
  a: Float64Array,
  g: Float64Array,
  n: number,
  lambda: number,
  delta: Float64Array,
): boolean {
  const scale = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const d = a[j * n + j] ?? 0;
    scale[j] = d > 0 ? Math.sqrt(d) : 0;
  }
  const w = n + 1;
  const mtx = new Float64Array(n * w);
  for (let i = 0; i < n; i++) {
    const si = scale[i] ?? 0;
    for (let j = 0; j < n; j++) {
      const sj = scale[j] ?? 0;
      if (si === 0 || sj === 0) mtx[i * w + j] = i === j ? 1 : 0;
      else mtx[i * w + j] = (a[i * n + j] ?? 0) / (si * sj) + (i === j ? lambda : 0);
    }
    mtx[i * w + n] = si === 0 ? 0 : -(g[i] ?? 0) / si;
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(mtx[r * w + col] ?? 0) > Math.abs(mtx[pivot * w + col] ?? 0)) pivot = r;
    }
    const p = mtx[pivot * w + col] ?? 0;
    if (!(Math.abs(p) > 0)) return false;
    if (pivot !== col) {
      for (let k = 0; k < w; k++) {
        const tmp = mtx[col * w + k] ?? 0;
        mtx[col * w + k] = mtx[pivot * w + k] ?? 0;
        mtx[pivot * w + k] = tmp;
      }
    }
    for (let r = col + 1; r < n; r++) {
      const factor = (mtx[r * w + col] ?? 0) / p;
      if (factor === 0) continue;
      for (let k = col; k < w; k++)
        mtx[r * w + k] = (mtx[r * w + k] ?? 0) - factor * (mtx[col * w + k] ?? 0);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = mtx[i * w + n] ?? 0;
    for (let k = i + 1; k < n; k++) sum -= (mtx[i * w + k] ?? 0) * (delta[k] ?? 0);
    delta[i] = sum / (mtx[i * w + i] ?? 1);
  }
  for (let j = 0; j < n; j++) {
    const sj = scale[j] ?? 0;
    delta[j] = sj === 0 ? 0 : (delta[j] ?? 0) / sj;
    if (!Number.isFinite(delta[j])) return false;
  }
  return true;
}

/** The fit problem: the pairs as ENU unit vectors and clicks, and the projection without the frame cull. */
class Problem {
  readonly n: number;
  private readonly lens: LensModel;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly start: Calibration;
  private readonly enu: Float64Array; // 3 per pair
  private readonly click: Float64Array; // 2 per pair
  private readonly sx: number;
  private readonly rectilinear: boolean;
  private readonly expScratch = new Float64Array(9);

  constructor(
    lens: LensModel,
    widthPx: number,
    heightPx: number,
    start: Calibration,
    pairs: readonly FitPair[],
  ) {
    this.lens = lens;
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.start = start;
    this.n = pairs.length;
    this.enu = new Float64Array(3 * this.n);
    this.click = new Float64Array(2 * this.n);
    pairs.forEach((p, i) => {
      const a = p.azDeg * D2R;
      const h = p.altDeg * D2R;
      this.enu[3 * i] = Math.cos(h) * Math.sin(a);
      this.enu[3 * i + 1] = Math.cos(h) * Math.cos(a);
      this.enu[3 * i + 2] = Math.sin(h);
      this.click[2 * i] = p.uPx;
      this.click[2 * i + 1] = p.vPx;
    });
    this.sx = start.flipX ? -1 : 1;
    this.rectilinear = lens === "rectilinear";
  }

  /** f > 0 and distortionValid for the trial's own rMaxUnit. */
  private valid(s: State): boolean {
    if (!(s.f > 0) || !Number.isFinite(s.cx) || !Number.isFinite(s.cy) || !Number.isFinite(s.k1))
      return false;
    const model = createCameraModel({
      lens: this.lens,
      calibration: { ...this.start, focalPx: s.f, cxPx: s.cx, cyPx: s.cy, k1: s.k1 },
      widthPx: this.widthPx,
      heightPx: this.heightPx,
    });
    return distortionValid(s.k1, this.start.k2, model.rMaxUnit);
  }

  /**
   * Target pixel of pair i minus its click into out[2i], out[2i + 1]; false when the target cannot be projected
   * (behind a rectilinear camera, beyond 90° from a fisheye axis, or g′ ≤ 0 there).
   */
  private residual(s: State, i: number, out: Float64Array): boolean {
    const m = s.m;
    const dE = this.enu[3 * i] ?? 0;
    const dN = this.enu[3 * i + 1] ?? 0;
    const dU = this.enu[3 * i + 2] ?? 0;
    const bx = (m[0] ?? 0) * dE + (m[3] ?? 0) * dN + (m[6] ?? 0) * dU; // along the optical axis: cos c
    const right = -((m[1] ?? 0) * dE + (m[4] ?? 0) * dN + (m[7] ?? 0) * dU);
    const up = (m[2] ?? 0) * dE + (m[5] ?? 0) * dN + (m[8] ?? 0) * dU;
    let x: number;
    let y: number;
    if (this.rectilinear) {
      if (!(bx > 0)) return false;
      x = right / bx;
      y = up / bx;
    } else {
      const hyp = Math.hypot(right, up);
      const theta = Math.atan2(hyp, bx);
      if (!(theta <= HALF_PI)) return false;
      const scale = hyp === 0 ? 0 : lensRadiusUnit(this.lens, theta) / hyp;
      x = right * scale;
      y = up * scale;
    }
    const k2 = this.start.k2;
    const r2 = x * x + y * y;
    if (!(1 + 3 * s.k1 * r2 + 5 * k2 * r2 * r2 > 0)) return false;
    const g = 1 + s.k1 * r2 + k2 * r2 * r2;
    out[2 * i] = s.cx + this.sx * s.f * g * x - (this.click[2 * i] ?? 0);
    out[2 * i + 1] = s.cy - s.f * g * y - (this.click[2 * i + 1] ?? 0);
    return true;
  }

  /** Σr² over the active pairs, residuals into out (0 for inactive pairs); ∞ for an invalid trial. */
  cost(s: State, active: Uint8Array, out: Float64Array): number {
    if (!this.valid(s)) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      if (active[i] !== 1) {
        out[2 * i] = 0;
        out[2 * i + 1] = 0;
        continue;
      }
      if (!this.residual(s, i, out)) return Number.POSITIVE_INFINITY;
      sum += (out[2 * i] ?? 0) ** 2 + (out[2 * i + 1] ?? 0) ** 2;
    }
    return Number.isFinite(sum) ? sum : Number.POSITIVE_INFINITY;
  }

  /** Pixel distance of every pair under s; NaN where the target does not project. */
  distances(s: State, out: Float64Array): void {
    const r = new Float64Array(2 * this.n);
    for (let i = 0; i < this.n; i++) {
      out[i] = this.residual(s, i, r) ? Math.hypot(r[2 * i] ?? 0, r[2 * i + 1] ?? 0) : Number.NaN;
    }
  }

  /** s ⊕ δ for a stage: R·Exp(ω), then f, cx, cy (and k1) increments. */
  apply(s: State, stage: Stage, delta: Float64Array): State {
    let k = 0;
    const wx = delta[k++] ?? 0;
    const wy = stage.rollOnly ? 0 : (delta[k++] ?? 0);
    const wz = stage.rollOnly ? 0 : (delta[k++] ?? 0);
    const m = new Float64Array(9);
    expSo3(wx, wy, wz, this.expScratch);
    mul3(s.m, this.expScratch, m);
    const f = s.f + (delta[k++] ?? 0);
    const cx = s.cx + (delta[k++] ?? 0);
    const cy = s.cy + (delta[k++] ?? 0);
    const k1 = stage.fitK1 ? s.k1 + (delta[k] ?? 0) : s.k1;
    return { m, f, cx, cy, k1 };
  }
}

function parameterCount(stage: Stage): number {
  return (stage.rollOnly ? 1 : 3) + 3 + (stage.fitK1 ? 1 : 0);
}

function stepSize(stage: Stage, j: number): number {
  const rot = stage.rollOnly ? 1 : 3;
  if (j < rot) return STEP_OMEGA_RAD;
  if (j < rot + 3) return STEP_PX;
  return STEP_K1;
}

/**
 * Levenberg–Marquardt from s over the active pairs. Returns the converged state and its iteration count, or null
 * when the start costs ∞ or maxIterations pass without convergence.
 */
function levenbergMarquardt(
  problem: Problem,
  s0: State,
  stage: Stage,
  active: Uint8Array,
  maxIterations: number,
): { state: State; iterations: number } | null {
  const rows = 2 * problem.n;
  const np = parameterCount(stage);
  const r0 = new Float64Array(rows);
  const rPlus = new Float64Array(rows);
  const rMinus = new Float64Array(rows);
  const trialR = new Float64Array(rows);
  const jac = new Float64Array(rows * np); // column-major: column j at j·rows
  const a = new Float64Array(np * np);
  const g = new Float64Array(np);
  const delta = new Float64Array(np);
  const probe = new Float64Array(np);

  let state = s0;
  let cost = problem.cost(state, active, r0);
  if (!Number.isFinite(cost)) return null;
  let lambda = LAMBDA_START;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Jacobian by central differences; one-sided when one side costs ∞, a zero column when both do.
    for (let j = 0; j < np; j++) {
      const h = stepSize(stage, j);
      probe.fill(0);
      probe[j] = h;
      const plus = problem.cost(problem.apply(state, stage, probe), active, rPlus);
      probe[j] = -h;
      const minus = problem.cost(problem.apply(state, stage, probe), active, rMinus);
      const okPlus = Number.isFinite(plus);
      const okMinus = Number.isFinite(minus);
      for (let i = 0; i < rows; i++) {
        let d = 0;
        if (okPlus && okMinus) d = ((rPlus[i] ?? 0) - (rMinus[i] ?? 0)) / (2 * h);
        else if (okPlus) d = ((rPlus[i] ?? 0) - (r0[i] ?? 0)) / h;
        else if (okMinus) d = ((r0[i] ?? 0) - (rMinus[i] ?? 0)) / h;
        jac[j * rows + i] = d;
      }
    }
    // Normal equations: A = JᵀJ, g = Jᵀr.
    for (let p = 0; p < np; p++) {
      let gp = 0;
      for (let i = 0; i < rows; i++) gp += (jac[p * rows + i] ?? 0) * (r0[i] ?? 0);
      g[p] = gp;
      for (let q = p; q < np; q++) {
        let apq = 0;
        for (let i = 0; i < rows; i++) apq += (jac[p * rows + i] ?? 0) * (jac[q * rows + i] ?? 0);
        a[p * np + q] = apq;
        a[q * np + p] = apq;
      }
    }
    let kept = false;
    for (let attempt = 0; attempt < LM_TRIES; attempt++) {
      if (solveDamped(a, g, np, lambda, delta)) {
        const trial = problem.apply(state, stage, delta);
        const trialCost = problem.cost(trial, active, trialR);
        if (trialCost < cost) {
          const relative = (cost - trialCost) / cost;
          state = trial;
          cost = trialCost;
          r0.set(trialR);
          lambda = Math.max(lambda / 10, LAMBDA_MIN);
          kept = true;
          if (relative < CONVERGED_REL) return { state, iterations: iteration };
          break;
        }
      }
      lambda = Math.min(lambda * 10, LAMBDA_MAX);
    }
    if (!kept) return { state, iterations: iteration };
  }
  return null;
}

/**
 * Fits the rotation, f, cx, cy (+ k1) on pixel residuals; a zenith-locked start fits roll only unless fitTilt.
 * Keeps distortionValid true at every accepted step. Returns null with fewer than 4 usable pairs or no convergence.
 */
export function fitCalibration(
  lens: LensModel,
  widthPx: number,
  heightPx: number,
  start: Calibration,
  pairs: readonly FitPair[],
  options: FitOptions,
): FitResult | null {
  const n = pairs.length;
  const active = new Uint8Array(n);
  let activeCount = 0;
  pairs.forEach((p, i) => {
    const usable =
      Number.isFinite(p.uPx) &&
      Number.isFinite(p.vPx) &&
      Number.isFinite(p.azDeg) &&
      Number.isFinite(p.altDeg);
    active[i] = usable ? 1 : 0;
    if (usable) activeCount++;
  });
  if (activeCount < MIN_PAIRS) return null;

  const startModel = createCameraModel({ lens, calibration: start, widthPx, heightPx });
  const locked = startModel.zenithLocked;
  const problem = new Problem(lens, widthPx, heightPx, start, pairs);
  const s0: State = {
    m: calibrationRotation(start, locked),
    f: start.focalPx,
    cx: start.cxPx,
    cy: start.cyPx,
    k1: start.k1,
  };
  // Stage A holds k1 (and a locked camera's axis); stage B frees everything requested.
  const stageA: Stage = { rollOnly: locked, fitK1: false };
  const stageB: Stage = { rollOnly: locked && !options.fitTilt, fitK1: options.fitK1 };

  const a = levenbergMarquardt(problem, s0, stageA, active, options.maxIterations);
  if (a === null) return null;
  let fit = levenbergMarquardt(problem, a.state, stageB, active, options.maxIterations);
  if (fit === null) return null;
  let iterations = a.iterations + fit.iterations;

  // 3σ rejection: one pair per round, against the RMS of the other active pairs (gotcha G7).
  const rejected = new Uint8Array(n);
  const dist = new Float64Array(n);
  for (let round = 0; round < MAX_REJECT_ROUNDS && activeCount > MIN_PAIRS; round++) {
    problem.distances(fit.state, dist);
    let worst = -1;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      if (active[i] !== 1) continue;
      const d = dist[i] ?? 0;
      sumSq += d * d;
      if (worst < 0 || d > (dist[worst] ?? 0)) worst = i;
    }
    const dWorst = dist[worst] ?? 0;
    const rmsOthers = Math.sqrt(Math.max(0, sumSq - dWorst * dWorst) / (activeCount - 1));
    if (!(dWorst > options.rejectSigma * rmsOthers && dWorst > REJECT_FLOOR_PX)) break;
    active[worst] = 0;
    rejected[worst] = 1;
    activeCount--;
    const refit = levenbergMarquardt(problem, fit.state, stageB, active, options.maxIterations);
    if (refit === null) return null;
    iterations += refit.iterations;
    fit = refit;
  }

  // Result: the fitted pose as (az, alt, roll); a locked roll-only fit keeps the axis at (0, 90).
  const angles = rotationToAzAltRoll(fit.state.m);
  const rollOnly = stageB.rollOnly;
  const calibration = normalizeCalibration(lens, {
    ...start,
    azDeg: rollOnly ? 0 : angles.azDeg,
    altDeg: rollOnly ? 90 : angles.altDeg,
    rollDeg: angles.rollDeg,
    focalPx: fit.state.f,
    cxPx: fit.state.cx,
    cyPx: fit.state.cy,
    k1: fit.state.k1,
    rmsDeg: null,
  });

  // Residuals under the stored calibration, so they match what the overlay draws.
  const model = createCameraModel({ lens, calibration, widthPx, heightPx });
  const finalState: State = {
    m: calibrationRotation(calibration, model.zenithLocked),
    f: calibration.focalPx,
    cx: calibration.cxPx,
    cy: calibration.cyPx,
    k1: calibration.k1,
  };
  const residualPx = new Float64Array(n);
  const residualDeg = new Float64Array(n);
  problem.distances(finalState, residualPx); // NaN for an unusable pair or a target that does not project
  const sky = new Float64Array(2);
  let sumPx = 0;
  let sumDeg = 0;
  pairs.forEach((p, i) => {
    residualDeg[i] = unprojectPixel(model, p.uPx, p.vPx, sky, 0)
      ? angularSeparationDeg(sky[0] ?? 0, sky[1] ?? 0, p.azDeg, p.altDeg)
      : Number.NaN;
    if (active[i] === 1) {
      sumPx += (residualPx[i] ?? 0) ** 2;
      sumDeg += (residualDeg[i] ?? 0) ** 2;
    }
  });
  const rmsPx = Math.sqrt(sumPx / activeCount);
  const rmsDeg = Math.sqrt(sumDeg / activeCount);
  return {
    calibration: { ...calibration, rmsDeg: Number.isFinite(rmsDeg) ? rmsDeg : null },
    residualPx,
    residualDeg,
    rejected,
    rmsPx,
    rmsDeg,
    iterations,
  };
}

/**
 * Pass: ≥ 10 named, non-rejected fit stars at alt ≥ minAltDeg (20 fisheye, 10 rectilinear); RMS ≤ 0.25° and each
 * ≤ 0.5° over the non-rejected fit pairs; ≥ 3 holdout stars and ≥ 1 holdout planet at alt ≥ minAltDeg, each ≤ 0.5°.
 */
export function calibrationAcceptance(
  lens: LensModel,
  pairs: readonly AcceptancePair[],
): AcceptanceReport {
  const minAltDeg = lens === "rectilinear" ? 10 : 20;
  let namedFitStars = 0;
  let fitCount = 0;
  let sumSq = 0;
  let maxFitDeg = 0;
  let holdoutStars = 0;
  let holdoutPlanets = 0;
  let maxHoldoutDeg: number | null = null;
  for (const p of pairs) {
    const high = p.altDeg >= minAltDeg;
    if (p.role === "fit") {
      if (p.rejected) continue;
      fitCount++;
      sumSq += p.residualDeg * p.residualDeg;
      // NaN must win: Math.max propagates it, so a non-finite residual fails the limit.
      maxFitDeg = Math.max(maxFitDeg, p.residualDeg);
      if (p.kind === "star" && p.named && high) namedFitStars++;
    } else if (high) {
      // Holdouts are measured, never rejected; only those at alt ≥ minAltDeg count.
      if (p.kind === "star") holdoutStars++;
      else holdoutPlanets++;
      maxHoldoutDeg =
        maxHoldoutDeg === null ? p.residualDeg : Math.max(maxHoldoutDeg, p.residualDeg);
    }
  }
  const rmsDeg = fitCount === 0 ? Number.NaN : Math.sqrt(sumSq / fitCount);
  if (fitCount === 0) maxFitDeg = Number.NaN;
  const pass =
    namedFitStars >= 10 &&
    rmsDeg <= 0.25 &&
    maxFitDeg <= 0.5 &&
    holdoutStars >= 3 &&
    holdoutPlanets >= 1 &&
    maxHoldoutDeg !== null &&
    maxHoldoutDeg <= 0.5;
  return { namedFitStars, rmsDeg, maxFitDeg, holdoutStars, holdoutPlanets, maxHoldoutDeg, pass };
}

// ---- [M5] Satellite check: a satellite marker measured against the picture by hand (M5 step 13).

/** [M5] One click on a satellite during the M5 acceptance check. */
export interface SatelliteCheckSample {
  readonly timeMs: number;
  readonly residualDeg: number;
}
export interface SatelliteCheckSummary {
  readonly count: number;
  readonly firstMs: number | null;
  readonly lastMs: number | null;
  readonly maxGapMs: number | null;
  readonly maxDeg: number | null;
  readonly medianDeg: number | null;
  readonly pass: boolean;
}

const SATELLITE_CHECK_MIN_SAMPLES = 10;
const SATELLITE_CHECK_MAX_GAP_MS = 2_500;

/**
 * [M5] pass: ≥ 10 samples, every residual finite and ≤ limitDeg, and no uncovered gap > 2,500 ms. A gap's uncovered
 * part is the time between consecutive samples minus its overlap with hiddenMs (stretches where the object is known
 * to be hidden, e.g. behind a dome; disjoint). maxGapMs is the largest uncovered gap. hiddenMs defaults to [].
 *
 * Samples may come in any order (they are sorted by time). maxDeg and medianDeg (the mean of the middle two for an
 * even count) cover the finite residuals; a non-finite residual or time fails the check. maxGapMs is null with
 * fewer than two samples.
 */
export function satelliteCheckSummary(
  samples: readonly SatelliteCheckSample[],
  limitDeg: number,
  hiddenMs: readonly (readonly [fromMs: number, toMs: number])[] = [],
): SatelliteCheckSummary {
  const count = samples.length;
  const times = samples.map((s) => s.timeMs).filter(Number.isFinite);
  times.sort((a, b) => a - b);
  const residuals = samples.map((s) => s.residualDeg).filter(Number.isFinite);
  residuals.sort((a, b) => a - b);

  let maxGapMs: number | null = null;
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1] ?? 0;
    const b = times[i] ?? 0;
    let hidden = 0;
    for (const [from, to] of hiddenMs) {
      const overlap = Math.min(b, to) - Math.max(a, from);
      if (overlap > 0) hidden += overlap; // also false for NaN
    }
    const uncovered = Math.max(b - a - hidden, 0);
    maxGapMs = maxGapMs === null ? uncovered : Math.max(maxGapMs, uncovered);
  }

  const n = residuals.length;
  const maxDeg = n === 0 ? null : (residuals[n - 1] ?? null);
  const medianDeg =
    n === 0
      ? null
      : n % 2 === 1
        ? (residuals[(n - 1) / 2] ?? null)
        : ((residuals[n / 2 - 1] ?? 0) + (residuals[n / 2] ?? 0)) / 2;
  const pass =
    count >= SATELLITE_CHECK_MIN_SAMPLES &&
    n === count &&
    times.length === count &&
    maxDeg !== null &&
    maxDeg <= limitDeg &&
    maxGapMs !== null &&
    maxGapMs <= SATELLITE_CHECK_MAX_GAP_MS;
  return {
    count,
    firstMs: times[0] ?? null,
    lastMs: times[times.length - 1] ?? null,
    maxGapMs,
    maxDeg,
    medianDeg,
    pass,
  };
}
