// src/workers/bulk.ts — BulkPropagator fallback for Starlink, same row layout as writeSample (M9 step 3). [M9]
//
// Not shipped: propagation.worker.ts never imports this file, so it reaches no bundle. DECISIONS ("Satellites")
// says to try BulkPropagator only if culling is not enough; ship it only if tests/perf/propagation.perf.ts shows a
// culled Starlink p95 over 10 ms on a target laptop and tests/perf/bulk.perf.ts shows a bulk run beating culling
// there. tests/perf/bench/propagators.worker.ts measures it in a Chromium worker against the plain loop and culling.
//
// The call shape is M9 step 3's, verified there: rows matched writeSample for every object above −5° at 60× and 600×
// (position within 1e-3 km, velocity within 1e-6 km/s, sunlit flags equal). Gotcha 6: createWasmModule does not
// exist; run() is synchronous on the single-thread runtime; raw outputs are views the next run() overwrites; dispose()
// is mandatory; never createMultiThreadRuntime (it needs COOP/COEP).
import {
  BulkPropagator,
  createSingleThreadRuntime,
  EciBaseCalculator,
  type SatRec,
  ShadowFractionCalculator,
  SunPositionCalculator,
} from "satellite.js";
import { EARTH_ROTATION_RAD_S } from "../domain/geo";
import { type PropagationContext, SAMPLE_STRIDE } from "../domain/orbits";

/** Once per group load. Never createMultiThreadRuntime: it needs COOP/COEP. */
export async function createStarlinkBulk(recs: SatRec[]) {
  const runtime = await createSingleThreadRuntime();
  const bulk = new BulkPropagator({
    runtime,
    calculators: [
      new EciBaseCalculator(),
      new SunPositionCalculator(),
      new ShadowFractionCalculator(),
    ],
    satRecsCount: recs.length,
    datesCount: 1,
  });
  bulk.setSatRecs(recs);
  return bulk; // bulk.dispose() when the group or the worker goes away
}
export type StarlinkBulk = Awaited<ReturnType<typeof createStarlinkBulk>>;

/** Row j of the bulk output goes to object rows[j] of `out`. */
export function writeBulkSample(
  bulk: StarlinkBulk,
  rows: Int32Array,
  ctx: PropagationContext,
  out: Float32Array,
): void {
  bulk.setDates([ctx.date]);
  bulk.run(); // single-thread runtime: synchronous
  const { eci, shadowFraction } = bulk.getRawOutput(); // views on WASM memory: read now, never keep or post
  const c = Math.cos(ctx.gmstRad);
  const s = Math.sin(ctx.gmstRad);
  const m = ctx.enuToEcef;
  const ob = ctx.observerEcefKm;
  for (let j = 0; j < rows.length; j++) {
    const o = (rows[j] ?? 0) * SAMPLE_STRIDE;
    if (eci.error[j] !== 0) {
      out.fill(0, o, o + SAMPLE_STRIDE);
      continue;
    }
    const px = eci.position[3 * j] ?? 0;
    const py = eci.position[3 * j + 1] ?? 0;
    const pz = eci.position[3 * j + 2] ?? 0;
    const qx = eci.velocity[3 * j] ?? 0;
    const qy = eci.velocity[3 * j + 1] ?? 0;
    const rx = px * c + py * s; // TEME -> ECEF by GMST, as eciToEcf
    const ry = -px * s + py * c;
    const vx = qx * c + qy * s + EARTH_ROTATION_RAD_S * ry; // Earth-fixed velocity: also subtract ω × r
    const vy = -qx * s + qy * c - EARTH_ROTATION_RAD_S * rx;
    const vz = eci.velocity[3 * j + 2] ?? 0;
    const dx = rx - (ob[0] ?? 0);
    const dy = ry - (ob[1] ?? 0);
    const dz = pz - (ob[2] ?? 0);
    for (let a = 0; a < 3; a++) {
      const m0 = m[a] ?? 0;
      const m1 = m[3 + a] ?? 0;
      const m2 = m[6 + a] ?? 0;
      out[o + a] = m0 * dx + m1 * dy + m2 * dz; // ENU = Mᵀ (r − O)
      out[o + 3 + a] = m0 * vx + m1 * vy + m2 * vz;
    }
    out[o + 6] = (shadowFraction[j] ?? 1) < 0.5 ? 1 : 0;
    out[o + 7] = 1;
  }
}
