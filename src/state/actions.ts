// src/state/actions.ts — all 45 actions from M0 (README section 4, actions). An action whose milestone has
// not landed throws; each milestone replaces its own placeholders, test first.
import type { StoreApi } from "zustand/vanilla";
import { clampToScrubRangeMs } from "../domain/time";
import type { Actions, AppState, ClockState, GroupData } from "./types";

/** setStarMagLimit's range: 6.5 is the cut of stars.json (M2 step 2). */
const STAR_MAG_LIMIT_MIN = 1;
const STAR_MAG_LIMIT_MAX = 6.5;

type SetState = StoreApi<AppState>["setState"];
type GetState = StoreApi<AppState>["getState"];

/** Stands in for an action whose milestone has not landed. Calling it is a programmer error. */
function notYet(name: keyof Actions, milestone: `M${number}`): () => never {
  return () => {
    throw new Error(`actions.${name} lands in ${milestone}`);
  };
}

export function createActions(set: SetState, get: GetState): Actions {
  /** stepBy and seek: switch to replay, keep `playing`, clamp to ± 12 h of rangeCenterMs. */
  const moveTo = (clock: ClockState, timeMs: number): ClockState => ({
    ...clock,
    mode: "replay",
    simTimeMs: clampToScrubRangeMs(timeMs, clock.rangeCenterMs),
  });

  return {
    tick: (simTimeMs) => set((s) => ({ clock: { ...s.clock, simTimeMs } })),
    play: () => set((s) => ({ clock: { ...s.clock, playing: true } })),
    pause: () => set((s) => ({ clock: { ...s.clock, playing: false, mode: "replay" } })),
    togglePlay: () => (get().clock.playing ? get().actions.pause() : get().actions.play()),
    setMode: (mode) =>
      set((s) => ({
        clock:
          mode === "live"
            ? { ...s.clock, mode, rate: 1, playing: true }
            : { ...s.clock, mode: "replay" },
      })),
    setRate: (rate) => set((s) => ({ clock: { ...s.clock, mode: "replay", rate } })),
    stepBy: (deltaMs) => set((s) => ({ clock: moveTo(s.clock, s.clock.simTimeMs + deltaMs) })),
    seek: (timeMs) => set((s) => ({ clock: moveTo(s.clock, timeMs) })),
    jumpToNow: () => {
      const now = Date.now();
      set((s) => ({ clock: { ...s.clock, simTimeMs: now, rangeCenterMs: now } }));
    },
    recenter: (timeMs) =>
      set((s) => ({
        clock: {
          ...s.clock,
          mode: "replay",
          playing: false,
          simTimeMs: timeMs,
          rangeCenterMs: timeMs,
        },
      })),
    setRegistry: (registry) => set((s) => ({ camera: { ...s.camera, registry } })),
    setActiveCamera: (id) =>
      set((s) => ({ camera: { ...s.camera, activeId: id, frameTimeMs: null } })),
    setCameraStatus: notYet("setCameraStatus", "M4"),
    setFrameTimeMs: notYet("setFrameTimeMs", "M4"),
    updateCalibration: notYet("updateCalibration", "M4"),
    setStreamDelayMs: notYet("setStreamDelayMs", "M5"),
    resetCalibration: notYet("resetCalibration", "M4"),
    importCalibration: notYet("importCalibration", "M4"),
    // Each returns the same state for a no-op, so subscribers never fire for one (as setLayer).
    select: (id) =>
      set((s) => {
        const follow = id === null ? false : s.selection.follow; // null also turns follow off
        return s.selection.selectedId === id && s.selection.follow === follow
          ? s
          : { selection: { ...s.selection, selectedId: id, follow } };
      }),
    hover: (id) =>
      set((s) => (s.selection.hoverId === id ? s : { selection: { ...s.selection, hoverId: id } })),
    setFollow: (on) =>
      set((s) => (s.selection.follow === on ? s : { selection: { ...s.selection, follow: on } })),
    setLayer: (key, on) =>
      set((s) => (s.layers[key] === on ? s : { layers: { ...s.layers, [key]: on } })),
    toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
    setFootprintHeightKm: notYet("setFootprintHeightKm", "M8"),
    setStarMagLimit: (vmag) => {
      if (!Number.isFinite(vmag)) return;
      const limit = Math.min(Math.max(vmag, STAR_MAG_LIMIT_MIN), STAR_MAG_LIMIT_MAX);
      set((s) =>
        s.layers.starMagLimit === limit ? s : { layers: { ...s.layers, starMagLimit: limit } },
      );
    },
    setVideoLayer: notYet("setVideoLayer", "M5"),
    setLoadStatus: (key, status) => set((s) => ({ data: { ...s.data, [key]: status } })),
    setGroupData: (group, patch) =>
      set((s) => {
        const prev = s.data.gp[group];
        const next: GroupData = { ...prev };
        let changed = false;
        // Key by key: Partial<GroupData> admits an explicit undefined, which must never erase a field.
        if (patch.status !== undefined && patch.status !== prev.status) {
          next.status = patch.status;
          changed = true;
        }
        if (patch.fetchedAtMs !== undefined && patch.fetchedAtMs !== prev.fetchedAtMs) {
          next.fetchedAtMs = patch.fetchedAtMs;
          changed = true;
        }
        if (patch.count !== undefined && patch.count !== prev.count) {
          next.count = patch.count;
          changed = true;
        }
        return changed ? { data: { ...s.data, gp: { ...s.data.gp, [group]: next } } } : s;
      }),
    setHorizon: notYet("setHorizon", "M6"),
    setGoesDomain: notYet("setGoesDomain", "M7"),
    setGoesStatus: notYet("setGoesStatus", "M7"),
    addImagePoint: notYet("addImagePoint", "M4"),
    completePair: notYet("completePair", "M4"),
    setPairRole: notYet("setPairRole", "M4"),
    removePair: notYet("removePair", "M4"),
    clearPairs: notYet("clearPairs", "M4"),
    cancelImagePoint: notYet("cancelImagePoint", "M4"),
    applyFit: notYet("applyFit", "M4"),
    setVideoStatus: notYet("setVideoStatus", "M5"),
    openPanel: (panel) => set((s) => ({ ui: { ...s.ui, panel } })),
    togglePanel: (panel) =>
      set((s) => ({ ui: { ...s.ui, panel: s.ui.panel === panel ? null : panel } })),
    startDemo: notYet("startDemo", "M9"),
    setDemoStep: notYet("setDemoStep", "M9"),
    stopDemo: notYet("stopDemo", "M9"),
    setDemoPaused: notYet("setDemoPaused", "M9"),
  };
}
