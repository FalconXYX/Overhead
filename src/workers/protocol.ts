// src/workers/protocol.ts — message types shared by the main thread and the workers. Types and constants only.
import type { CameraModelInput } from "../domain/camera";
import type { ObserverSite } from "../domain/geo";
import type { GpGroup, GroupMask } from "../domain/orbits";

// ---- propagation.worker.ts ----
export type PropagationIn =
  /** First message. generation starts at 0. */
  | { type: "init"; site: ObserverSite; generation: number }
  /** Fetch and parse public/data/gp/<group>.json (absolute URL) in the worker; appended after already-loaded groups. */
  | { type: "loadGroup"; group: GpGroup; url: string }
  /** Camera switch: new observer. The main thread bumps generation and discards older samples. Resets the horizon profile to null. */
  | { type: "setSite"; site: ObserverSite; generation: number }
  /** [M8] Camera model for the incoming check; null disables it. */
  | { type: "setCamera"; camera: CameraModelInput | null }
  /** [M8] Terrain profile for the incoming check (a structured-clone copy, never transferred); null = geometric horizon. */
  | { type: "setHorizonProfile"; profileDeg: Float32Array | null }
  /**
   * Compute sample k at t_k = k × stepMs into `buffer` (Float32Array(count × SAMPLE_STRIDE)), transferred.
   * Objects outside `groups` get valid = 0.
   */
  | {
      type: "sample";
      generation: number;
      k: number;
      stepMs: number;
      groups: GroupMask;
      buffer: ArrayBuffer;
    }
  /** Rebuild the requested tracks: selected ±10 min, others ±3 min, on the absolute 20 s grid. */
  | {
      type: "tracks";
      requestId: number;
      timeMs: number;
      selectedIndex: number | null;
      otherIndices: Int32Array;
    }
  /** [M3] ENU paths on the absolute SKY_PATH_STEP_MS grid in [fromMs, toMs]: trails and the selected 2-minute path. */
  | {
      type: "skyPaths";
      requestId: number;
      generation: number;
      fromMs: number;
      toMs: number;
      indices: Int32Array;
    }
  /** [M4] Exposure arc: `steps` samples from startMs, stepMs apart; step s, object i at (s × count + i) × SAMPLE_STRIDE. */
  | {
      type: "arc";
      requestId: number;
      startMs: number;
      stepMs: number;
      steps: number;
      groups: GroupMask;
      buffer: ArrayBuffer;
    }
  /** [M8] At most once per wall-clock second: which satellites enter the frame within 60 s. */
  | { type: "incoming"; requestId: number; timeMs: number; groups: GroupMask };

/** [M3] Grid of sky-path points, absolute multiples of this many ms. */
export const SKY_PATH_STEP_MS = 2_000;

/** Appended catalog rows; satrec index = firstIndex + i. */
export interface CatalogDelta {
  firstIndex: number;
  noradIds: Int32Array;
  names: string[];
  groupIndex: Uint8Array; // index into GP_GROUPS
  epochMs: Float64Array;
  dockedWith: Int32Array; // host NORAD id, or −1
}
export interface TrackOut {
  index: number;
  firstPointMs: number; // multiple of TRACK_STEP_MS
  lonLatDeg: Float64Array; // [lon, lat] pairs, longitudes unwrapped
}
export interface SkyPathOut {
  index: number;
  firstPointMs: number; // multiple of SKY_PATH_STEP_MS
  enuKm: Float32Array; // [e, n, u] triples; ends early at the first failed propagation
}
export interface IncomingEntry {
  index: number;
  etaSec: number; // 5, 10, … 60
}

export type PropagationOut =
  | {
      type: "groupLoaded";
      group: GpGroup;
      totalCount: number;
      fetchedAtMs: number | null;
      catalog: CatalogDelta;
    }
  | { type: "groupError"; group: GpGroup; message: string }
  /** Same buffer back, transferred. timeMs = k × stepMs, a plain number (never Float32). */
  | {
      type: "sample";
      generation: number;
      k: number;
      timeMs: number;
      sunAltDeg: number;
      computeMs: number;
      buffer: ArrayBuffer;
    }
  | { type: "tracks"; requestId: number; tracks: TrackOut[] }
  | { type: "skyPaths"; requestId: number; generation: number; paths: SkyPathOut[] }
  /** Same buffer back, transferred. */
  | {
      type: "arc";
      requestId: number;
      startMs: number;
      stepMs: number;
      steps: number;
      buffer: ArrayBuffer;
    }
  /** computeMs: performance.now() around collectIncoming; entries sorted by etaSec, then index. */
  | {
      type: "incoming";
      requestId: number;
      timeMs: number;
      computeMs: number;
      entries: IncomingEntry[];
    }
  | { type: "error"; message: string };

// ---- horizon.worker.ts ----
export interface HorizonIn {
  type: "compute";
  requestId: number;
  cameraId: string;
  latDeg: number;
  lonDeg: number;
  mastM: number; // z0 = DEM ground at the site (z14) + mastM
}
export type HorizonOut =
  | {
      type: "progress";
      requestId: number;
      cameraId: string;
      tilesDone: number;
      tilesTotal: number;
    }
  | {
      type: "done";
      requestId: number;
      cameraId: string;
      profileDeg: Float32Array; // 360 values, transferred
      groundM: number;
      z0M: number;
      limitM: number;
      imagerySources: string[]; // dataset prefixes, sorted
    }
  | { type: "error"; requestId: number; cameraId: string; message: string };
