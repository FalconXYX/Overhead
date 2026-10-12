// src/state/actions.ts — all 45 actions from M0 (README section 4, actions). Until M9 an action whose milestone had
// not landed threw; [M9] the last four (the tour) have landed, so no placeholder is left.
import type { StoreApi } from "zustand/vanilla";
import { clampStreamDelayMs, clampToScrubRangeMs } from "../domain/time";
import { appliedFitPatch, calibrationPatch, emptyCalibrationUi } from "./calibrationWrite";
import {
  type Actions,
  type AppState,
  type ClockState,
  DEMO_STEP_COUNT,
  type GroupData,
  type HorizonData,
} from "./types";

/** setStarMagLimit's range: 6.5 is the cut of stars.json (M2 step 2). */
const STAR_MAG_LIMIT_MIN = 1;
const STAR_MAG_LIMIT_MAX = 6.5;

type SetState = StoreApi<AppState>["setState"];
type GetState = StoreApi<AppState>["getState"];

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
      set((s) => ({
        camera: { ...s.camera, activeId: id, frameTimeMs: null },
        calibrationUi: emptyCalibrationUi(), // [M4] pairs belong to one frame
        video: { status: "idle", errorCode: null }, // [M5] a new camera has no player or clip yet
      })),
    setCameraStatus: (id, status) =>
      set((s) =>
        s.camera.status[id] === status
          ? s
          : { camera: { ...s.camera, status: { ...s.camera.status, [id]: status } } },
      ),
    setFrameTimeMs: (timeMs) => {
      if (timeMs !== null && !Number.isFinite(timeMs)) return;
      set((s) =>
        s.camera.frameTimeMs === timeMs ? s : { camera: { ...s.camera, frameTimeMs: timeMs } },
      );
    },
    updateCalibration: (patch) => {
      const s = get();
      const id = s.camera.activeId;
      const current = s.camera.calibration[id] ?? s.camera.registry[id]?.defaults;
      if (current === undefined) return;
      const next = calibrationPatch(s, id, { ...current, ...patch, updatedAtMs: Date.now() });
      if (next !== null) set(next);
    },
    // [M5] The only writer of the delay: YouTube cameras only, clamped to [0, 120 s] in whole ms.
    setStreamDelayMs: (ms) => {
      if (!Number.isFinite(ms)) return;
      const s = get();
      if (s.camera.registry[s.camera.activeId]?.kind !== "youtube") return;
      s.actions.updateCalibration({ streamDelayMs: clampStreamDelayMs(ms) });
    },
    resetCalibration: () =>
      set((s) => {
        const { [s.camera.activeId]: removed, ...rest } = s.camera.calibration;
        return removed === undefined ? s : { camera: { ...s.camera, calibration: rest } };
      }),
    importCalibration: (id, calibration) => {
      const next = calibrationPatch(get(), id, calibration);
      if (next !== null) set(next);
    },
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
    // [M8] null follows the selected satellite; otherwise a finite height > 0. Anything else is ignored, and the same
    // state comes back for a no-op (as setLayer).
    setFootprintHeightKm: (km) => {
      if (km !== null && !(Number.isFinite(km) && km > 0)) return;
      set((s) =>
        s.layers.footprintHeightKm === km ? s : { layers: { ...s.layers, footprintHeightKm: km } },
      );
    },
    setStarMagLimit: (vmag) => {
      if (!Number.isFinite(vmag)) return;
      const limit = Math.min(Math.max(vmag, STAR_MAG_LIMIT_MIN), STAR_MAG_LIMIT_MAX);
      set((s) =>
        s.layers.starMagLimit === limit ? s : { layers: { ...s.layers, starMagLimit: limit } },
      );
    },
    // [M5] A new layers.video object; the same state for a no-op (as setLayer).
    setVideoLayer: (key, on) =>
      set((s) =>
        s.layers.video[key] === on
          ? s
          : { layers: { ...s.layers, video: { ...s.layers.video, [key]: on } } },
      ),
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
    // [M6] From the idle default; key by key, as setGroupData, so an explicit undefined never erases a field.
    setHorizon: (cameraId, patch) =>
      set((s) => {
        const prev = s.data.horizon[cameraId];
        const base: HorizonData = prev ?? { status: "idle", profileDeg: null, imagerySources: [] };
        let changed = prev === undefined;
        const merged: HorizonData = { ...base };
        if (patch.status !== undefined && patch.status !== base.status) {
          merged.status = patch.status;
          changed = true;
        }
        if (patch.profileDeg !== undefined && patch.profileDeg !== base.profileDeg) {
          merged.profileDeg = patch.profileDeg;
          changed = true;
        }
        if (patch.imagerySources !== undefined && patch.imagerySources !== base.imagerySources) {
          merged.imagerySources = patch.imagerySources;
          changed = true;
        }
        return changed
          ? { data: { ...s.data, horizon: { ...s.data.horizon, [cameraId]: merged } } }
          : s;
      }),
    // [M7] The array is stored by reference: removeGoesStep and mergeGoesIntervals return their input for a no-op.
    setGoesDomain: (intervals, latestStepMs) =>
      set((s) =>
        s.data.goes.intervals === intervals && s.data.goes.latestStepMs === latestStepMs
          ? s
          : { data: { ...s.data, goes: { ...s.data.goes, intervals, latestStepMs } } },
      ),
    setGoesStatus: (status) =>
      set((s) =>
        s.data.goes.status === status
          ? s
          : { data: { ...s.data, goes: { ...s.data.goes, status } } },
      ),
    addImagePoint: (uPx, vPx) => {
      if (!Number.isFinite(uPx) || !Number.isFinite(vPx)) return;
      set((s) => ({ calibrationUi: { ...s.calibrationUi, pendingPx: [uPx, vPx] } }));
    },
    completePair: (targetId) =>
      set((s) => {
        const { pairs, pendingPx } = s.calibrationUi;
        if (pendingPx === null) return s;
        const same = pairs.findIndex((p) => p.targetId === targetId);
        const pair = {
          imagePx: pendingPx,
          targetId,
          role: pairs[same]?.role ?? ("fit" as const), // a re-clicked target keeps its role
          residualPx: null,
          rejected: false,
        };
        const next = same === -1 ? [...pairs, pair] : pairs.map((p, i) => (i === same ? pair : p));
        return { calibrationUi: { ...s.calibrationUi, pairs: next, pendingPx: null } };
      }),
    setPairRole: (index, role) =>
      set((s) => {
        const { pairs } = s.calibrationUi;
        const pair = pairs[index];
        if (pair === undefined || pair.role === role) return s;
        const next = pairs.map((p, i) => (i === index ? { ...p, role } : p));
        return { calibrationUi: { ...s.calibrationUi, pairs: next } };
      }),
    removePair: (index) =>
      set((s) => {
        const { pairs } = s.calibrationUi;
        if (pairs[index] === undefined) return s;
        return {
          calibrationUi: { ...s.calibrationUi, pairs: pairs.filter((_, i) => i !== index) },
        };
      }),
    clearPairs: () =>
      set((s) => {
        const { pairs, pendingPx, fit } = s.calibrationUi;
        return pairs.length === 0 && pendingPx === null && fit === null
          ? s
          : { calibrationUi: emptyCalibrationUi() };
      }),
    cancelImagePoint: () =>
      set((s) =>
        s.calibrationUi.pendingPx === null
          ? s
          : { calibrationUi: { ...s.calibrationUi, pendingPx: null } },
      ),
    applyFit: (calibration, residualPx, rejected, fit) => {
      const next = appliedFitPatch(get(), calibration, residualPx, rejected, fit, Date.now());
      if (next !== null) set(next);
    },
    // [M5] From the YouTube player or the clip's <video>; the same state when nothing changes.
    setVideoStatus: (status, errorCode = null) =>
      set((s) =>
        s.video.status === status && s.video.errorCode === errorCode
          ? s
          : { video: { status, errorCode } },
      ),
    openPanel: (panel) => set((s) => ({ ui: { ...s.ui, panel } })),
    togglePanel: (panel) =>
      set((s) => ({ ui: { ...s.ui, panel: s.ui.panel === panel ? null : panel } })),
    // [M9] The tour (M9 step 10). startDemo and stopDemo write a fresh object; setDemoStep clamps to the steps of
    // DEMO_STEPS (whole numbers, non-finite ignored); each returns the same state for a no-op (as setLayer).
    startDemo: () =>
      set((s) => ({ ui: { ...s.ui, demo: { active: true, step: 0, paused: false } } })),
    setDemoStep: (step) => {
      if (!Number.isFinite(step)) return;
      const clamped = Math.min(DEMO_STEP_COUNT - 1, Math.max(0, Math.trunc(step)));
      set((s) =>
        s.ui.demo.step === clamped ? s : { ui: { ...s.ui, demo: { ...s.ui.demo, step: clamped } } },
      );
    },
    stopDemo: () =>
      set((s) => {
        const { active, step, paused } = s.ui.demo;
        return !active && step === 0 && !paused
          ? s
          : { ui: { ...s.ui, demo: { active: false, step: 0, paused: false } } };
      }),
    setDemoPaused: (paused) =>
      set((s) =>
        s.ui.demo.paused === paused ? s : { ui: { ...s.ui, demo: { ...s.ui.demo, paused } } },
      ),
  };
}
