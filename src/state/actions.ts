// src/state/actions.ts — all 45 actions from M0 (README section 4, actions). An action whose milestone has
// not landed throws; each milestone replaces its own placeholders, test first.
import type { StoreApi } from "zustand/vanilla";
import type { Actions, AppState } from "./types";

type SetState = StoreApi<AppState>["setState"];
type GetState = StoreApi<AppState>["getState"];

/** Stands in for an action whose milestone has not landed. Calling it is a programmer error. */
function notYet(name: keyof Actions, milestone: `M${number}`): () => never {
  return () => {
    throw new Error(`actions.${name} lands in ${milestone}`);
  };
}

export function createActions(set: SetState, get: GetState): Actions {
  return {
    tick: (simTimeMs) => set((s) => ({ clock: { ...s.clock, simTimeMs } })),
    play: () => set((s) => ({ clock: { ...s.clock, playing: true } })),
    pause: () => set((s) => ({ clock: { ...s.clock, playing: false, mode: "replay" } })),
    togglePlay: () => (get().clock.playing ? get().actions.pause() : get().actions.play()),
    setMode: notYet("setMode", "M1"),
    setRate: notYet("setRate", "M1"),
    stepBy: notYet("stepBy", "M1"),
    seek: notYet("seek", "M1"),
    jumpToNow: notYet("jumpToNow", "M1"),
    recenter: notYet("recenter", "M1"),
    setRegistry: notYet("setRegistry", "M1"),
    setActiveCamera: notYet("setActiveCamera", "M1"),
    setCameraStatus: notYet("setCameraStatus", "M4"),
    setFrameTimeMs: notYet("setFrameTimeMs", "M4"),
    updateCalibration: notYet("updateCalibration", "M4"),
    setStreamDelayMs: notYet("setStreamDelayMs", "M5"),
    resetCalibration: notYet("resetCalibration", "M4"),
    importCalibration: notYet("importCalibration", "M4"),
    select: notYet("select", "M3"),
    hover: notYet("hover", "M3"),
    setFollow: notYet("setFollow", "M3"),
    setLayer: notYet("setLayer", "M1"),
    toggleLayer: notYet("toggleLayer", "M1"),
    setFootprintHeightKm: notYet("setFootprintHeightKm", "M8"),
    setStarMagLimit: notYet("setStarMagLimit", "M2"),
    setVideoLayer: notYet("setVideoLayer", "M5"),
    setLoadStatus: notYet("setLoadStatus", "M1"),
    setGroupData: notYet("setGroupData", "M3"),
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
    openPanel: notYet("openPanel", "M1"),
    togglePanel: notYet("togglePanel", "M1"),
    startDemo: notYet("startDemo", "M9"),
    setDemoStep: notYet("setDemoStep", "M9"),
    stopDemo: notYet("stopDemo", "M9"),
    setDemoPaused: notYet("setDemoPaused", "M9"),
  };
}
