import type OlMap from "ol/Map";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestHooks,
  installTestHooks,
  type OverheadTestHooks,
  recordCommit,
  recordHighlight,
  type SatPositionsView,
  type TestHookSources,
  type ViewId,
} from "../../src/app/testHooks";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../../src/domain/astro";
import { type FrameScheduler, frameCount, startClockLoop } from "../../src/state/clockLoop";
import type { FootprintStatus } from "../../src/state/footprintStatus";
import type { AppStore } from "../../src/state/store";
import type { ObjectId } from "../../src/state/types";
import { storeAt } from "../helpers/store";

/** Like requestAnimationFrame: at most one pending callback. frame() runs it. */
class ManualScheduler implements FrameScheduler {
  private pending: ((wallMs: number) => void) | null = null;
  private wallMs = 0;
  request(callback: (wallMs: number) => void): number {
    this.pending = callback;
    return 1;
  }
  cancel(): void {
    this.pending = null;
  }
  frame(): void {
    const callback = this.pending;
    if (callback === null) throw new Error("no frame is pending");
    this.pending = null;
    this.wallMs += 16;
    callback(this.wallMs);
  }
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

/** Satrec indices: 0 the ISS (az 90°, alt 45°), 1 a satellite below the horizon, 2 one whose propagation failed. */
interface MutableFrame {
  ready: boolean;
  azAltDeg: Float64Array;
  mercator: number[];
  flags: Uint8Array;
}

function satFrame(): MutableFrame {
  return {
    ready: false,
    azAltDeg: Float64Array.from([90, 45, 200, -3, 0, 0]),
    mercator: [-17_303_000, 2_250_000, 1_000, 2_000, 0, 0],
    flags: Uint8Array.from([0b1111, 0b0011, 0]),
  };
}

const INDEX: Readonly<Record<string, number>> = { "sat:25544": 0, "sat:36086": 0, "sat:1": 1 };
const POLARIS: StarRow = [37.95456, 89.26411, 2.02, 424, "Polaris"];
const FAINT: StarRow = [10, 10, 5.5, 7001, ""];

interface FakeMap {
  readonly calls: { coordinate: number[]; wrapX: boolean }[];
  pixelOf: (coordinate: number[]) => number[] | null;
}

/** getPixelFromCoordinate: x / 2 and (1024 − y) / 2, as a 512 px map showing the whole 1024 px frame would. */
function fakeMap(rect = { left: 10, top: 20, width: 512, height: 512 }): OlMap & FakeMap {
  const fake: FakeMap = {
    calls: [],
    pixelOf: (c) => [(c[0] ?? 0) / 2, (1024 - (c[1] ?? 0)) / 2],
  };
  const map = {
    ...fake,
    getPixelFromCoordinate(coordinate: number[], options?: { wrapX?: boolean }) {
      fake.calls.push({ coordinate: [...coordinate], wrapX: options?.wrapX === true });
      return fake.pixelOf(coordinate);
    },
    getTargetElement: () => ({ getBoundingClientRect: () => rect }),
    getView: () => ({ getZoom: () => 6, getAnimating: () => false }),
  };
  Object.defineProperty(map, "calls", { get: () => fake.calls });
  Object.defineProperty(map, "pixelOf", {
    get: () => fake.pixelOf,
    set: (f: FakeMap["pixelOf"]) => {
      fake.pixelOf = f;
    },
  });
  return map as unknown as OlMap & FakeMap;
}

function setup(store: AppStore = storeAt("2026-10-11T15:09:50Z")) {
  const frame = satFrame();
  const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN);
  bodies.set([0, 90, -26.7, 1], 0); // the Sun at the zenith
  const maps = new Map<ViewId, OlMap>([
    ["sky", fakeMap()],
    ["ground", fakeMap()],
  ]);
  const updates: number[] = [];
  // [M8] What bindFootprint and the incoming client would hold.
  const footprint: FootprintStatus = { heightKm: null, source: "fallback", pairCount: 0 };
  const satellites: {
    incoming: TestHookSources["satellites"]["incoming"];
    catalog: { noradIds: Int32Array };
  } = {
    incoming: null,
    catalog: { noradIds: Int32Array.from([25544, 19046, 10114]) },
  };
  const sources: TestHookSources = {
    store,
    updateSatFrame: (simTimeMs): SatPositionsView => {
      updates.push(simTimeMs);
      return frame;
    },
    indexOfObjectId: (id: ObjectId) => INDEX[id] ?? null,
    sky: {
      rows: [POLARIS, FAINT],
      starCount: 1,
      starAzAltDeg: Float32Array.from([0, 45, 0, 0]),
      bodies,
    },
    maps,
    footprint,
    satellites,
  };
  const { hooks, dispose } = createTestHooks(sources);
  cleanups.push(dispose);
  const scheduler = new ManualScheduler();
  cleanups.push(startClockLoop(store, scheduler));
  return { hooks, frame, maps, scheduler, store, updates, footprint, satellites };
}

const mapOf = (maps: Map<ViewId, OlMap>, view: ViewId) => maps.get(view) as OlMap & FakeMap;

describe("frame and readyFrame", () => {
  it("frame() is frameCount(); readyFrame is the first frame whose sample pair existed", () => {
    const { hooks, frame, scheduler, updates } = setup();
    expect(hooks.frame()).toBe(frameCount());
    expect(hooks.readyFrame()).toBeNull();
    scheduler.frame();
    scheduler.frame();
    expect(hooks.readyFrame()).toBeNull();
    expect(updates).toHaveLength(2); // the hooks' updater asks ephemeris for this frame
    frame.ready = true;
    scheduler.frame();
    const ready = frameCount();
    expect(hooks.readyFrame()).toBe(ready);
    expect(hooks.frame()).toBe(ready);
    frame.ready = false; // a later flush (seek) does not move it
    scheduler.frame();
    frame.ready = true;
    scheduler.frame();
    expect(hooks.readyFrame()).toBe(ready);
  });
});

describe("selectionFrame", () => {
  it("records the frame in which selectedId last changed, not hover or follow", () => {
    const { hooks, scheduler, store } = setup();
    const { actions } = store.getState();
    expect(hooks.selectionFrame()).toBeNull();
    scheduler.frame();
    actions.select("sat:25544"); // a click between frame callbacks
    const clicked = frameCount();
    expect(hooks.selectionFrame()).toBe(clicked);
    scheduler.frame();
    actions.hover("moon");
    actions.setFollow(true);
    actions.select("sat:25544");
    expect(hooks.selectionFrame()).toBe(clicked);
    scheduler.frame();
    actions.select(null);
    expect(hooks.selectionFrame()).toBe(frameCount());
  });

  it("a selection applied before the hooks start (?sel=) counts from their start", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    store.getState().actions.select("sat:25544");
    const { hooks } = setup(store);
    expect(hooks.selectionFrame()).toBe(frameCount());
  });
});

describe("highlight and recordHighlight", () => {
  it("is nothing before the first postrender, then the id drawn and since when, per view", () => {
    const { hooks, scheduler } = setup();
    expect(hooks.highlight("ground")).toEqual({ id: null, frame: null });
    scheduler.frame();
    recordHighlight("ground", null);
    const first = frameCount();
    expect(hooks.highlight("ground")).toEqual({ id: null, frame: first });
    scheduler.frame();
    recordHighlight("ground", "sat:25544");
    const drawn = frameCount();
    expect(hooks.highlight("ground")).toEqual({ id: "sat:25544", frame: drawn });
    expect(hooks.highlight("sky")).toEqual({ id: null, frame: null });
    scheduler.frame();
    recordHighlight("ground", "sat:25544"); // every postrender: the "since" frame stays
    expect(hooks.highlight("ground")).toEqual({ id: "sat:25544", frame: drawn });
    recordHighlight("sky", "sat:25544");
    expect(hooks.highlight("sky")).toEqual({ id: "sat:25544", frame: frameCount() });
    scheduler.frame();
    recordHighlight("ground", null); // Esc
    expect(hooks.highlight("ground")).toEqual({ id: null, frame: frameCount() });
  });

  it("returns a copy, and records nothing while no hooks exist", () => {
    recordHighlight("sky", "moon"); // production: no hooks, a cheap no-op
    const { hooks } = setup();
    expect(hooks.highlight("sky")).toEqual({ id: null, frame: null });
    recordHighlight("sky", "moon");
    const copy = hooks.highlight("sky");
    copy.id = "sun";
    expect(hooks.highlight("sky").id).toBe("moon");
  });
});

describe("clientPoint", () => {
  it("ground: the satellite's EPSG:3857 position in this frame, nearest world copy, viewport px", () => {
    const { hooks, frame, maps, scheduler } = setup();
    scheduler.frame();
    expect(hooks.clientPoint("ground", "sat:25544")).toBeNull(); // no sample pair yet
    frame.ready = true;
    scheduler.frame();
    const ground = mapOf(maps, "ground");
    ground.pixelOf = () => [100.5, 200.25];
    expect(hooks.clientPoint("ground", "sat:25544")).toEqual({ x: 110.5, y: 220.25 });
    expect(ground.calls.at(-1)).toEqual({ coordinate: [-17_303_000, 2_250_000], wrapX: true });
    // A docked id resolves to its host (indexOfObjectId); a satellite below the horizon is still on the ground map.
    expect(hooks.clientPoint("ground", "sat:36086")).toEqual({ x: 110.5, y: 220.25 });
    expect(hooks.clientPoint("ground", "sat:1")).toEqual({ x: 110.5, y: 220.25 });
  });

  it("ground: null for stars, bodies, unknown or invalid satellites and off-map points", () => {
    const { hooks, frame, maps, scheduler } = setup();
    frame.ready = true;
    scheduler.frame();
    const ground = mapOf(maps, "ground");
    ground.pixelOf = () => [100, 100];
    for (const id of ["star:424", "moon", "planet:Jupiter", "sat:99999"] as const) {
      expect(hooks.clientPoint("ground", id), id).toBeNull();
    }
    frame.flags[0] = 0; // propagation failed
    expect(hooks.clientPoint("ground", "sat:25544")).toBeNull();
    frame.flags[0] = 0b1111;
    ground.pixelOf = () => [600, 100]; // right of the 512 px target
    expect(hooks.clientPoint("ground", "sat:25544")).toBeNull();
    ground.pixelOf = () => null; // not rendered yet
    expect(hooks.clientPoint("ground", "sat:25544")).toBeNull();
    maps.delete("ground");
    expect(hooks.clientPoint("ground", "sat:25544")).toBeNull();
  });

  it("sky: through the active camera model (zenith fisheye, 1024 px, east left)", () => {
    const { hooks, frame, maps, scheduler } = setup();
    frame.ready = true;
    scheduler.frame();
    const sky = mapOf(maps, "sky");
    // The ISS at az 90°, alt 45°: θ = 45° → 256 px left of the centre, map coordinate [256, 512].
    const iss = hooks.clientPoint("sky", "sat:25544");
    expect(sky.calls.at(-1)?.wrapX).toBe(false);
    expect(sky.calls.at(-1)?.coordinate[0]).toBeCloseTo(256, 9);
    expect(sky.calls.at(-1)?.coordinate[1]).toBeCloseTo(512, 9);
    expect(iss?.x).toBeCloseTo(10 + 128, 9);
    expect(iss?.y).toBeCloseTo(20 + 256, 9);
    // The Sun at the zenith: the frame centre.
    const sun = hooks.clientPoint("sky", "sun");
    expect(sun?.x).toBeCloseTo(10 + 256, 9);
    expect(sun?.y).toBeCloseTo(20 + 256, 9);
    // Polaris (row 0, inside the magnitude prefix) at az 0°, alt 45°: 256 px above the centre.
    const polaris = hooks.clientPoint("sky", "star:424");
    expect(polaris?.x).toBeCloseTo(10 + 256, 9);
    expect(polaris?.y).toBeCloseTo(20 + 128, 9);
  });

  it("sky: null below the horizon, outside the magnitude prefix, before a pass, and when not ready", () => {
    const { hooks, frame, scheduler } = setup();
    scheduler.frame();
    expect(hooks.clientPoint("sky", "sat:25544")).toBeNull();
    frame.ready = true;
    scheduler.frame();
    expect(hooks.clientPoint("sky", "sat:1")).toBeNull(); // apparent alt −3°
    expect(hooks.clientPoint("sky", "star:7001")).toBeNull(); // fainter than the limit
    expect(hooks.clientPoint("sky", "star:1")).toBeNull(); // not in the catalogue
    expect(hooks.clientPoint("sky", "moon")).toBeNull(); // NaN: no pass yet
    expect(hooks.clientPoint("sky", "sat:99999")).toBeNull();
  });

  it("sky: null while the registry has no active camera", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    store.getState().actions.setRegistry({});
    const { hooks } = setup(store);
    expect(hooks.clientPoint("sky", "sun")).toBeNull();
  });
});

describe("installTestHooks", () => {
  it("exposes the hooks as window.__overhead", () => {
    const fakeWindow: { __overhead?: OverheadTestHooks } = {};
    vi.stubGlobal("window", fakeWindow);
    const { hooks } = setup();
    installTestHooks(hooks);
    expect(fakeWindow.__overhead).toBe(hooks);
  });
});

describe("footprint and incoming (M8)", () => {
  it("footprint() is a snapshot of footprintStatus", () => {
    const { hooks, footprint } = setup();
    expect(hooks.footprint()).toEqual({ heightKm: null, source: "fallback", pairCount: 0 });
    footprint.heightKm = 422.4;
    footprint.source = "selected";
    footprint.pairCount = 64;
    const snapshot = hooks.footprint();
    expect(snapshot).toEqual({ heightKm: 422.4, source: "selected", pairCount: 64 });
    footprint.pairCount = 0;
    expect(snapshot.pairCount).toBe(64);
  });

  it("incoming() maps catalogue indices to NORAD ids, or is null without a reply", () => {
    const { hooks, satellites } = setup();
    expect(hooks.incoming()).toBeNull();
    satellites.incoming = {
      timeMs: Date.parse("2026-10-11T15:05:07Z"),
      computeMs: 0.4,
      entries: [
        { index: 0, etaSec: 35 },
        { index: 1, etaSec: 55 },
      ],
    };
    expect(hooks.incoming()).toEqual({
      timeMs: Date.parse("2026-10-11T15:05:07Z"),
      computeMs: 0.4,
      entries: [
        { noradId: 25544, etaSec: 35 },
        { noradId: 19046, etaSec: 55 },
      ],
    });
  });
});

describe("commits (M9 step 5)", () => {
  it("counts every recordCommit call (main.tsx's <Profiler> onRender) since the app started", () => {
    const { hooks } = setup();
    const before = hooks.commits();
    recordCommit();
    recordCommit();
    expect(hooks.commits()).toBe(before + 2);
  });
});

describe("[Redesign] clock and playReplay", () => {
  it("clock() reads the clock; playReplay plays replay at a rate from the start of a ±12 h range", () => {
    const { hooks, store } = setup();
    const t = Date.parse("2026-10-11T15:09:50Z");
    expect(hooks.clock()).toEqual({ mode: "replay", playing: false, rate: 1, simTimeMs: t });
    hooks.playReplay(600, t - 3_600_000);
    expect(hooks.clock()).toEqual({
      mode: "replay",
      playing: true,
      rate: 600,
      simTimeMs: t - 3_600_000,
    });
    expect(store.getState().clock.rangeCenterMs).toBe(t - 3_600_000 + 43_200_000);
    hooks.playReplay(60); // from the clock's own time
    expect(hooks.clock()).toMatchObject({ playing: true, rate: 60, simTimeMs: t - 3_600_000 });
  });
});

describe("[Redesign] view", () => {
  it("reads a map view's zoom and animation state; null for a map that is not registered", () => {
    const { hooks, maps } = setup();
    expect(hooks.view("ground")).toEqual({ zoom: 6, animating: false });
    maps.delete("sky");
    expect(hooks.view("sky")).toBeNull();
  });
});
