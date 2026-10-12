// tests/unit/bindFootprint.test.ts — the footprint binding (M8 step 8.3, section 5): inputs, height choice, one change
// per recompute, footprintStatus, and following the selected satellite's height in the frame loop. heightKmOf and
// indexOfObjectId are mocked: the heights are the test's.
import { fromLonLat } from "ol/proj";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCameraModel,
  FOOTPRINT_SAMPLES_PER_EDGE,
  footprintLonLatDeg,
  footprintMaxPairs,
} from "../../src/domain/camera";
import { createFootprintLayer, footprintLabel } from "../../src/map/ground/layers/footprint";
import { bindFootprint } from "../../src/map/sync/bindFootprint";
import { startClockLoop } from "../../src/state/clockLoop";
import { footprintStatus } from "../../src/state/footprintStatus";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { Calibration, CameraConfig } from "../../src/state/types";
import { committedCameras } from "../helpers/store";

const ephemerisMock = vi.hoisted(() => ({
  heightKm: null as number | null,
  index: 0 as number | null,
  heightCalls: 0,
}));
vi.mock("../../src/state/ephemeris", () => ({
  heightKmOf: () => {
    ephemerisMock.heightCalls += 1;
    return ephemerisMock.heightKm;
  },
  indexOfObjectId: (id: string) => (id.startsWith("sat:") ? ephemerisMock.index : null),
  updateEphemerisFrame: () => undefined,
}));

const T = Date.parse("2026-10-11T15:09:22Z");
const SUBARU_ID = "subaru-starcam";
/** The inline "Subaru defaults" (the published pointing), not M5's committed star fit. */
const SUBARU_DEFAULTS: Calibration = {
  azDeg: 81.2,
  altDeg: 19.6,
  rollDeg: 0,
  focalPx: 2742,
  cxPx: 1920,
  cyPx: 1080,
  k1: 0,
  k2: 0,
  flipX: false,
  streamDelayMs: 50_000,
  rmsDeg: null,
  updatedAtMs: 0,
};

function subaruEntry(): CameraConfig {
  const committed = committedCameras()[SUBARU_ID];
  if (committed === undefined) throw new Error("no subaru-starcam in cameras.json");
  return { ...committed, defaults: SUBARU_DEFAULTS };
}

/** The ring footprintLonLatDeg gives for the entry at heightKm, as fromLonLat coordinates (closed). */
function expectedRing(
  camera: CameraConfig,
  calibration: Calibration,
  heightKm: number,
): number[][] {
  const out = new Float64Array(2 * footprintMaxPairs(FOOTPRINT_SAMPLES_PER_EDGE));
  const model = createCameraModel({
    lens: camera.lens,
    calibration,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
  });
  const n = footprintLonLatDeg(model, camera.site, heightKm, FOOTPRINT_SAMPLES_PER_EDGE, null, out);
  const ring: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const k = i === n ? 0 : i;
    ring.push(fromLonLat([out[2 * k] ?? Number.NaN, out[2 * k + 1] ?? Number.NaN]));
  }
  return ring;
}

interface Harness {
  store: AppStore;
  polygon: ReturnType<typeof createFootprintLayer>["polygon"];
  /** Source change events so far. */
  changes(): number;
  /** Runs one frame of the clock loop (the fake FrameScheduler). */
  frame(): void;
}

let stops: (() => void)[] = [];

function setup(): Harness {
  const store = createAppStore(initialState(T, SUBARU_ID));
  store.getState().actions.setRegistry({ [SUBARU_ID]: subaruEntry() });
  const { layer, polygon } = createFootprintLayer();
  let changes = 0;
  layer.getSource()?.on("change", () => {
    changes += 1;
  });
  stops.push(bindFootprint(store, polygon));
  let pending: ((wallMs: number) => void) | null = null;
  let wallMs = 0;
  stops.push(
    startClockLoop(store, {
      request: (cb) => {
        pending = cb;
        return 1;
      },
      cancel: () => {
        pending = null;
      },
    }),
  );
  return {
    store,
    polygon,
    changes: () => changes,
    frame() {
      const cb = pending;
      pending = null;
      wallMs += 16;
      cb?.(wallMs);
    },
  };
}

beforeEach(() => {
  ephemerisMock.heightKm = null;
  ephemerisMock.index = 0;
  ephemerisMock.heightCalls = 0;
});

afterEach(() => {
  for (const stop of stops.reverse()) stop();
  stops = [];
});

describe("bindFootprint", () => {
  it("draws nothing while the layer is off", () => {
    const h = setup();
    expect(h.polygon.getCoordinates()).toEqual([]);
    expect(footprintStatus).toEqual({ heightKm: null, source: "fallback", pairCount: 0 });
    h.store.getState().actions.setFootprintHeightKm(480); // the preset alone draws nothing
    h.frame();
    expect(h.polygon.getCoordinates()).toEqual([]);
    expect(footprintStatus.heightKm).toBeNull();
    expect(h.changes()).toBe(0);
  });

  it("draws one closed ring of 67 coordinates at the 480 km preset, with exactly one change", () => {
    const h = setup();
    const { actions } = h.store.getState();
    actions.setFootprintHeightKm(480);
    actions.toggleLayer("footprint");
    expect(h.changes()).toBe(1);
    expect(footprintStatus).toEqual({ heightKm: 480, source: "preset", pairCount: 66 });
    const rings = h.polygon.getCoordinates();
    expect(rings).toHaveLength(1);
    const ring = rings[0] ?? [];
    expect(ring).toHaveLength(67);
    expect(ring[66]).toEqual(ring[0]);
    const expected = expectedRing(subaruEntry(), SUBARU_DEFAULTS, 480);
    expect(expected).toHaveLength(67);
    let worstM = 0;
    for (let i = 0; i < 67; i++) {
      const [x = Number.NaN, y = Number.NaN] = ring[i] ?? [];
      const [ex = Number.NaN, ey = Number.NaN] = expected[i] ?? [];
      worstM = Math.max(worstM, Math.abs(x - ex), Math.abs(y - ey));
    }
    expect(worstM).toBeLessThanOrEqual(1e-6);
    // Frames change nothing with a preset.
    h.frame();
    h.frame();
    expect(h.changes()).toBe(1);
    expect(ephemerisMock.heightCalls).toBe(0);
  });

  it("recomputes once on a calibration change, and falls back to 420 km without a selection", () => {
    const h = setup();
    const { actions } = h.store.getState();
    actions.setFootprintHeightKm(480);
    actions.toggleLayer("footprint");
    const before = h.changes();
    actions.updateCalibration({ azDeg: 90 });
    expect(h.changes()).toBe(before + 1);
    actions.tick(T + 16); // a tick is not an input
    expect(h.changes()).toBe(before + 1);
    actions.setFootprintHeightKm(null);
    expect(footprintStatus).toEqual({ heightKm: 420, source: "fallback", pairCount: 66 });
    expect(h.changes()).toBe(before + 2);
    // A profile that hides every sample is an input too: nothing left to draw.
    actions.setHorizon(SUBARU_ID, { status: "ready", profileDeg: new Float32Array(360).fill(89) });
    expect(footprintStatus.pairCount).toBe(0);
    expect(h.polygon.getCoordinates()).toEqual([]);
    // Off again: cleared, height null.
    actions.toggleLayer("footprint");
    expect(footprintStatus).toEqual({ heightKm: null, source: "fallback", pairCount: 0 });
  });

  it("follows the selected satellite's height, recomputing only when it moved ≥ 1 km", () => {
    const h = setup();
    const { actions } = h.store.getState();
    actions.toggleLayer("footprint");
    expect(footprintStatus.source).toBe("fallback");
    const heights: number[] = [];
    h.polygon.on("change", () => heights.push(footprintStatus.heightKm ?? Number.NaN));
    ephemerisMock.heightKm = 433.7;
    actions.select("sat:25544");
    expect(footprintStatus).toEqual({ heightKm: 433.7, source: "selected", pairCount: 66 });
    h.frame();
    ephemerisMock.heightKm = 434.2;
    h.frame();
    ephemerisMock.heightKm = 434.8;
    h.frame();
    expect(heights).toEqual([433.7, 434.8]);
    expect(footprintStatus.heightKm).toBe(434.8);
  });

  it("starts following once the selected satellite's group has loaded", () => {
    const h = setup();
    const { actions } = h.store.getState();
    actions.toggleLayer("footprint");
    ephemerisMock.index = null; // its group has not loaded
    actions.select("sat:25544");
    h.frame();
    expect(footprintStatus).toMatchObject({ heightKm: 420, source: "fallback" });
    ephemerisMock.index = 0;
    ephemerisMock.heightKm = 425.1;
    h.frame();
    expect(footprintStatus).toMatchObject({ heightKm: 425.1, source: "selected" });
    // A preset wins over the selection; a star is not followed.
    actions.setFootprintHeightKm(420);
    expect(footprintStatus).toMatchObject({ heightKm: 420, source: "preset" });
    actions.setFootprintHeightKm(null);
    actions.select("star:424");
    expect(footprintStatus).toMatchObject({ heightKm: 420, source: "fallback" });
  });

  it("the disposer unsubscribes and unregisters the frame updater", () => {
    const h = setup();
    const { actions } = h.store.getState();
    actions.toggleLayer("footprint");
    actions.select("sat:25544");
    const stop = stops.shift(); // bindFootprint's
    stop?.();
    const changes = h.changes();
    ephemerisMock.heightKm = 500;
    h.frame();
    actions.setFootprintHeightKm(480);
    expect(h.changes()).toBe(changes);
  });
});

describe("createFootprintLayer", () => {
  it("is a canvas vector layer holding one empty polygon, labelled from footprintStatus", () => {
    const { layer, polygon } = createFootprintLayer();
    expect(layer.constructor.name).toBe("VectorLayer");
    expect(layer.getSource()?.getFeatures()).toHaveLength(1);
    expect(layer.getSource()?.getFeatures()[0]?.getGeometry()).toBe(polygon);
    expect(polygon.getCoordinates()).toEqual([]);
    expect(footprintLabel(422.4)).toBe("Camera view at 422 km");
    expect(footprintLabel(479.6)).toBe("Camera view at 480 km");
  });
});
