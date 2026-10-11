// src/app/testHooks.ts — read-only hooks for Playwright (M3 step 16; README section 6). main.tsx creates and installs
// them only when navigator.webdriver is true, so e2e reads object positions and draw frames without reading pixels.
import type OlMap from "ol/Map";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../domain/astro";
import {
  type CameraModel,
  createCameraModel,
  projectAzAltDeg,
  toSkyMapCoord,
} from "../domain/camera";
import type { MapId } from "../map/registry";
import { frameCount, registerFrameUpdater } from "../state/clockLoop";
import { selectActiveCamera, selectCalibration } from "../state/selectors";
import type { AppStore } from "../state/store";
import type { ObjectId } from "../state/types";

export type ViewId = MapId; // "sky" | "ground"

export interface OverheadTestHooks {
  frame(): number; // frameCount()
  readyFrame(): number | null; // first frame in which the sample client returned a pair
  selectionFrame(): number | null; // frame in which selection.selectedId last changed
  highlight(view: ViewId): { id: ObjectId | null; frame: number | null }; // last drawn, and since when
  clientPoint(view: ViewId, id: ObjectId): { x: number; y: number } | null; // viewport CSS px
}

declare global {
  interface Window {
    __overhead?: OverheadTestHooks;
  }
}

/** The parts of ephemeris.ts's SatFrame the hooks read. */
export interface SatPositionsView {
  readonly ready: boolean; // this frame's positions come from a sample pair
  readonly azAltDeg: ArrayLike<number>; // altitude apparent
  readonly mercator: ArrayLike<number>; // EPSG:3857 [x, y] per index
  readonly flags: ArrayLike<number>; // bit 0 valid
}

/** What the hooks read. main.tsx passes ephemeris.ts, skyCache and the map registry; unit tests pass fakes. */
export interface TestHookSources {
  readonly store: AppStore;
  /** updateEphemerisFrame: computes once per frameCount(), so calling it again in the same frame is free. */
  updateSatFrame(simTimeMs: number): SatPositionsView;
  /** Docked ids map to their host's index. */
  indexOfObjectId(id: ObjectId): number | null;
  readonly sky: {
    readonly rows: readonly StarRow[];
    readonly starCount: number;
    readonly starAzAltDeg: ArrayLike<number>;
    readonly bodies: ArrayLike<number>;
  };
  readonly maps: ReadonlyMap<ViewId, OlMap>;
}

const FLAG_VALID = 1;

interface HighlightRecord {
  id: ObjectId | null;
  frame: number | null;
}

/** Written by recordHighlight while hooks exist; read by hooks.highlight. */
const highlights: Record<ViewId, HighlightRecord> = {
  sky: { id: null, frame: null },
  ground: { id: null, frame: null },
};
let recording = false;

function clearHighlights(): void {
  for (const record of Object.values(highlights)) {
    record.id = null;
    record.frame = null;
  }
}

/**
 * Called from each selection layer's postrender with the id it drew (null: none). The frame is kept until the drawn
 * id changes, so highlight() reports since when. A cheap no-op while no hooks exist (production).
 */
export function recordHighlight(view: ViewId, id: ObjectId | null): void {
  if (!recording) return;
  const record = highlights[view];
  if (record.frame !== null && record.id === id) return;
  record.id = id;
  record.frame = frameCount();
}

/** main.tsx installs the hooks only when navigator.webdriver is true. */
export function installTestHooks(hooks: OverheadTestHooks): void {
  window.__overhead = hooks;
}

const scratch = new Float64Array(2);

/**
 * Builds the hooks: registers a frame updater (readyFrame) and a selection listener (selectionFrame), and turns
 * recordHighlight on. dispose() undoes all three.
 */
export function createTestHooks(sources: TestHookSources): {
  hooks: OverheadTestHooks;
  dispose: () => void;
} {
  const { store } = sources;
  let lastFrame: SatPositionsView | null = null;
  let readyFrame: number | null = null;
  let selectionFrame: number | null =
    store.getState().selection.selectedId === null ? null : frameCount();

  const unregister = registerFrameUpdater((simTimeMs) => {
    lastFrame = sources.updateSatFrame(simTimeMs);
    if (readyFrame === null && lastFrame.ready) readyFrame = frameCount();
  });
  // Listeners run synchronously inside the action, so a click between frames records the last frame started.
  const unsubscribe = store.subscribe(
    (s) => s.selection.selectedId,
    () => {
      selectionFrame = frameCount();
    },
  );
  clearHighlights();
  recording = true;

  // One camera model per active camera and calibration, as bindSkyCamera builds it.
  let modelKey: readonly [unknown, unknown] | null = null;
  let model: CameraModel | null = null;
  const cameraModel = (): CameraModel | null => {
    const state = store.getState();
    const camera = selectActiveCamera(state);
    const calibration = selectCalibration(state);
    if (modelKey === null || modelKey[0] !== camera || modelKey[1] !== calibration) {
      modelKey = [camera, calibration];
      model = null;
      if (camera !== undefined && calibration !== undefined) {
        try {
          model = createCameraModel({
            lens: camera.lens,
            calibration,
            widthPx: camera.imageSize.widthPx,
            heightPx: camera.imageSize.heightPx,
          });
        } catch {
          model = null; // a lens this milestone cannot project: the sky view draws nothing either
        }
      }
    }
    return model;
  };

  /** Index of a drawn satellite in this frame (valid; the host's for a docked id), or null. */
  const satIndex = (id: ObjectId): number | null => {
    if (!id.startsWith("sat:") || lastFrame === null || !lastFrame.ready) return null;
    const i = sources.indexOfObjectId(id);
    if (i === null || ((lastFrame.flags[i] ?? 0) & FLAG_VALID) === 0) return null;
    return i;
  };

  /** Apparent az/alt of the object in the sky view's current data, or null. */
  const azAltDeg = (id: ObjectId): readonly [number, number] | null => {
    if (id.startsWith("sat:")) {
      const i = satIndex(id);
      if (i === null || lastFrame === null) return null;
      const alt = lastFrame.azAltDeg[2 * i + 1] ?? Number.NaN;
      // The sky view draws satellites only above the (geometric, until M6) horizon.
      return alt > 0 ? [lastFrame.azAltDeg[2 * i] ?? Number.NaN, alt] : null;
    }
    const { sky } = sources;
    if (id.startsWith("star:")) {
      const hr = Number(id.slice(5));
      const row = sky.rows.findIndex((r) => r[3] === hr);
      // Only the magnitude prefix is rotated and drawn.
      if (row < 0 || row >= sky.starCount) return null;
      return [sky.starAzAltDeg[2 * row] ?? Number.NaN, sky.starAzAltDeg[2 * row + 1] ?? Number.NaN];
    }
    const body = (BODY_IDS as readonly string[]).indexOf(id);
    if (body < 0) return null;
    const o = body * BODY_STRIDE;
    return [sky.bodies[o] ?? Number.NaN, sky.bodies[o + 1] ?? Number.NaN];
  };

  /** The object's coordinate in the view's projection, or null where that view does not draw it. */
  const coordinate = (view: ViewId, id: ObjectId): number[] | null => {
    if (view === "ground") {
      const i = satIndex(id); // the ground map draws satellites only
      if (i === null || lastFrame === null) return null;
      return [lastFrame.mercator[2 * i] ?? Number.NaN, lastFrame.mercator[2 * i + 1] ?? Number.NaN];
    }
    const azAlt = azAltDeg(id);
    const m = cameraModel();
    if (azAlt === null || m === null || !projectAzAltDeg(m, azAlt[0], azAlt[1], scratch, 0)) {
      return null;
    }
    const out = [0, 0];
    toSkyMapCoord(m, scratch[0] ?? 0, scratch[1] ?? 0, out, 0);
    return out;
  };

  const hooks: OverheadTestHooks = {
    frame: frameCount,
    readyFrame: () => readyFrame,
    selectionFrame: () => selectionFrame,
    highlight: (view) => ({ id: highlights[view].id, frame: highlights[view].frame }),
    clientPoint: (view, id) => {
      const map = sources.maps.get(view);
      const c = coordinate(view, id);
      if (map === undefined || c === null || !c.every(Number.isFinite)) return null;
      // The ground view is not wrapped: pick the world copy nearest the view centre.
      const pixel: number[] | null = map.getPixelFromCoordinate(
        c,
        view === "ground" ? { wrapX: true } : undefined,
      );
      const target = map.getTargetElement();
      if (pixel === null || target === null || target === undefined) return null;
      const [px, py] = pixel;
      const rect = target.getBoundingClientRect();
      // A point outside the map's box cannot be clicked there.
      if (px === undefined || py === undefined || !(px >= 0 && px <= rect.width)) return null;
      if (!(py >= 0 && py <= rect.height)) return null;
      return { x: rect.left + px, y: rect.top + py };
    },
  };

  return {
    hooks,
    dispose: () => {
      unregister();
      unsubscribe();
      recording = false;
      clearHighlights();
    },
  };
}
