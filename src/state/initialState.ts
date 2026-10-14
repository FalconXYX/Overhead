// src/state/initialState.ts
import type { StateData } from "./types";

/** [Redesign] The recorded ISS pass (src/app/cameras.ts RECORDED_CLIP_ID): the site opens on it. */
export const DEFAULT_CAMERA_ID = "subaru-2026-10-11-iss";

const idleGroup = { status: "idle", fetchedAtMs: null, count: 0 } as const;

export function initialState(nowMs: number, activeId: string): StateData {
  return {
    clock: { mode: "replay", playing: false, rate: 1, simTimeMs: nowMs, rangeCenterMs: nowMs },
    camera: { activeId, registry: {}, calibration: {}, status: {}, frameTimeMs: null },
    selection: { selectedId: null, hoverId: null, follow: false },
    layers: {
      trueColor: true,
      coastlines: true,
      goesIr: false,
      hillshade: false,
      footprint: false,
      stars: true,
      planets: true,
      satellites: true,
      starlink: false,
      trails: true,
      tracks: true, // [Redesign]
      grid: true,
      horizon: true,
      footprintHeightKm: null,
      starMagLimit: 4.5,
      video: { starlink: false, grid: false, denseLabels: false },
    },
    data: {
      cameras: "idle",
      gibs: "idle",
      stars: "idle",
      gp: { stations: { ...idleGroup }, visual: { ...idleGroup }, starlink: { ...idleGroup } },
      horizon: {},
      goes: { status: "idle", intervals: [], latestStepMs: null },
    },
    calibrationUi: { pairs: [], pendingPx: null, fit: null },
    video: { status: "idle", errorCode: null },
    ui: { panel: null, demo: { active: false, step: 0, paused: false } },
  };
}
