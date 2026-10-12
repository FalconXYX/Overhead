// tests/helpers/satFrame.ts — a hand-built ephemeris catalog and frame (README section 6, src/state/ephemeris.ts
// shapes) for the map-layer and binding tests, so they run without a worker.
import type { SatCatalog, SatFrame } from "../../src/state/ephemeris";

export interface FakeSat {
  readonly norad: number;
  readonly name?: string;
  readonly group?: 0 | 1 | 2; // index into GP_GROUPS: stations, visual, starlink
  readonly azDeg?: number;
  readonly altDeg?: number; // apparent
  readonly valid?: boolean; // default true
  readonly sunlit?: boolean; // default true
  readonly dockedWith?: number; // host NORAD id
  readonly mercator?: readonly [x: number, y: number];
  readonly rangeKm?: number;
}

/** Flag bits of SatFrame.flags. */
export const FLAG_VALID = 1;
export const FLAG_SUNLIT = 2;
export const FLAG_ABOVE = 4;

export function fakeCatalog(sats: readonly FakeSat[]): SatCatalog {
  const n = sats.length;
  const catalog: SatCatalog = {
    count: n,
    noradIds: new Int32Array(n),
    names: [],
    groupIndex: new Uint8Array(n),
    epochMs: new Float64Array(n),
    dockedWith: new Int32Array(n).fill(-1),
    indexByNorad: new Map(),
  };
  sats.forEach((s, i) => {
    catalog.noradIds[i] = s.norad;
    catalog.names.push(s.name ?? `SAT ${s.norad}`);
    catalog.groupIndex[i] = s.group ?? 1;
    catalog.dockedWith[i] = s.dockedWith ?? -1;
    catalog.indexByNorad.set(s.norad, i);
  });
  return catalog;
}

export function fakeFrame(sats: readonly FakeSat[], timeMs: number, ready = true): SatFrame {
  const n = sats.length;
  const frame: SatFrame = {
    timeMs,
    ready,
    sunAltDeg: -16.2,
    enuKm: new Float64Array(3 * n),
    azAltDeg: new Float64Array(2 * n),
    rangeKm: new Float64Array(n),
    lonLatDeg: new Float64Array(2 * n),
    mercator: new Array<number>(2 * n).fill(0),
    flags: new Uint8Array(n),
  };
  sats.forEach((s, i) => {
    const valid = s.valid ?? true;
    const alt = s.altDeg ?? 45;
    frame.azAltDeg[2 * i] = s.azDeg ?? 90;
    frame.azAltDeg[2 * i + 1] = alt;
    frame.rangeKm[i] = s.rangeKm ?? 800;
    frame.mercator[2 * i] = s.mercator?.[0] ?? i * 1000;
    frame.mercator[2 * i + 1] = s.mercator?.[1] ?? 0;
    frame.flags[i] = valid
      ? FLAG_VALID | ((s.sunlit ?? true) ? FLAG_SUNLIT : 0) | (alt > 0 ? FLAG_ABOVE : 0)
      : 0;
  });
  return frame;
}
