// src/domain/orbits/cull.ts — Starlink culling for the 10 Hz sample (M9 step 2; DECISIONS, "Satellites" and
// "Satellite contracts"). Each sample propagates every non-culled object, one tenth of the culled ones (their slice,
// i mod 10 = k mod 10) and every culled "candidate" (within cullLimitKm at its last slice). Every other culled row is
// its held slice row moved along its held Earth-fixed velocity (gotcha 8).
import type { SatRec } from "satellite.js";
import { type PropagationContext, SAMPLE_STRIDE, SampleField, writeSample } from "./sample";

export const CULL_SLICES = 10;
/** Slant range at −10° elevation from 4,204 m to a 600 km orbit is 4,136–4,144 km (by Earth radius); the highest Starlink apogee is 576.8 km. */
export const CULL_RANGE_KM = 4150;
/** Upper bound on a Starlink's Earth-fixed speed (7.902–7.910 km/s measured over 24 h of the snapshot). */
export const CULL_SPEED_KM_S = 8.0;

/** Range beyond which a Starlink cannot climb above −10° before its slice comes round again (window = 12 samples). */
export function cullLimitKm(stepMs: number): number {
  return CULL_RANGE_KM + (CULL_SPEED_KM_S * (CULL_SLICES + 2) * stepMs) / 1000;
}

export interface CullState {
  readonly held: Float32Array; // last slice row per object (position, Earth-fixed velocity, flags)
  readonly heldTimeMs: Float64Array; // sim time of each slice's last refresh
  readonly candidate: Uint8Array; // 1 = propagate every sample
  lastGeneration: number;
  lastK: number;
}

/** One per catalogue size: the worker makes a new one on every groupLoaded. The first sample is a full pass. */
export function createCullState(count: number): CullState {
  return {
    held: new Float32Array(count * SAMPLE_STRIDE),
    heldTimeMs: new Float64Array(CULL_SLICES),
    candidate: new Uint8Array(count),
    lastGeneration: -1,
    lastK: -1,
  };
}

/** Forces the next sample to be a full pass (the worker calls it when the observer moves: held rows are ENU). */
export function resetCullState(state: CullState): void {
  state.lastGeneration = -1;
  state.lastK = -1;
}

/**
 * Writes sample k like a full pass, except that a culled object (cull[i] = 1) is propagated only on its slice
 * (i mod 10 = k mod 10) or while it is a candidate. Other culled rows are the held row moved along its held
 * velocity. A new generation, or a k that does not follow the last one, forces a full pass. Skipped objects
 * (skip[i] = 1) get the whole slot zeroed (valid = 0). Rows past min(satrecs, out rows) are not touched.
 * `onFailed(i)` runs for each object whose propagation failed in this call (its slot is zeroed, valid = 0).
 * Returns the number of objects propagated. Allocates nothing beyond what satellite.js propagate returns.
 */
export function writeCulledSample(
  state: CullState,
  satrecs: readonly SatRec[],
  skip: Uint8Array,
  cull: Uint8Array,
  ctx: PropagationContext,
  out: Float32Array,
  k: number,
  stepMs: number,
  generation: number,
  onFailed?: (index: number) => void,
): number {
  const { held, heldTimeMs, candidate } = state;
  const fullPass = generation !== state.lastGeneration || k !== state.lastK + 1;
  state.lastGeneration = generation;
  state.lastK = k;
  const limitKm = cullLimitKm(stepMs);
  // ((k mod 10) + 10) mod 10: a negative k (sim time before 1970) still names a slice in [0, 9].
  const slice = ((k % CULL_SLICES) + CULL_SLICES) % CULL_SLICES;
  if (fullPass) heldTimeMs.fill(ctx.timeMs);
  else heldTimeMs[slice] = ctx.timeMs;
  const n = Math.min(satrecs.length, out.length / SAMPLE_STRIDE, held.length / SAMPLE_STRIDE);
  let computed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * SAMPLE_STRIDE;
    const rec = satrecs[i];
    if (rec === undefined || skip[i] === 1) {
      out.fill(0, o, o + SAMPLE_STRIDE);
    } else if (cull[i] !== 1) {
      if (!writeSample(rec, ctx, out, i)) onFailed?.(i);
      computed++;
    } else if (fullPass || i % CULL_SLICES === slice) {
      if (!writeSample(rec, ctx, out, i)) onFailed?.(i);
      computed++;
      for (let q = 0; q < SAMPLE_STRIDE; q++) held[o + q] = out[o + q] ?? 0;
      const rangeKm = Math.hypot(out[o] ?? 0, out[o + 1] ?? 0, out[o + 2] ?? 0);
      candidate[i] = out[o + SampleField.valid] === 1 && rangeKm <= limitKm ? 1 : 0;
    } else if (candidate[i] === 1) {
      if (!writeSample(rec, ctx, out, i)) onFailed?.(i);
      computed++;
    } else {
      const dtSec = (ctx.timeMs - (heldTimeMs[i % CULL_SLICES] ?? ctx.timeMs)) / 1000;
      for (let q = 0; q < 3; q++) out[o + q] = (held[o + q] ?? 0) + (held[o + 3 + q] ?? 0) * dtSec;
      for (let q = 3; q < SAMPLE_STRIDE; q++) out[o + q] = held[o + q] ?? 0;
    }
  }
  return computed;
}
