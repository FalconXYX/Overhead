import { describe, expect, it } from "vitest";
import { createCameraModel, syntheticFisheyeCalibration } from "../../src/domain/camera";
import { createTracksLayer } from "../../src/map/ground/layers/tracks";
import {
  bindTracks,
  framedTrackIndices,
  MAX_TRACKED,
  MIN_REQUEST_INTERVAL_MS,
  RequestGate,
  type TrackDeps,
} from "../../src/map/sync/bindTracks";
import type { SatCatalog, SatFrame } from "../../src/state/ephemeris";
import type { ObjectId } from "../../src/state/types";
import type { TrackOut } from "../../src/workers/protocol";
import { type FakeSat, fakeCatalog, fakeFrame } from "../helpers/satFrame";
import { storeAt } from "../helpers/store";

const T0 = Date.parse("2026-10-11T15:09:50Z");
const model = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

const ids = (a: Int32Array, n: number): number[] => Array.from(a.subarray(0, n));

describe("RequestGate", () => {
  it("sends on a change of slot, selection or index set, at most once per 100 ms", () => {
    const gate = new RequestGate();
    const set = Int32Array.from([3, 5, 9]);
    // Nothing selected and nothing to track: nothing to ask for.
    expect(gate.offer(0, 1, -1, set, 0)).toBe(false);
    expect(gate.offer(0, 1, -1, set, 3)).toBe(true);
    expect(gate.offer(16, 1, -1, set, 3)).toBe(false); // unchanged
    expect(gate.offer(50, 2, -1, set, 3)).toBe(false); // changed, but only 50 ms after the last request
    expect(gate.offer(99, 2, -1, set, 3)).toBe(false);
    expect(gate.offer(100, 2, -1, set, 3)).toBe(true); // the change was kept until it could go
    expect(gate.offer(300, 2, 7, set, 3)).toBe(true); // selection
    expect(gate.offer(500, 2, 7, set, 2)).toBe(true); // set size
    set[1] = 6;
    expect(gate.offer(700, 2, 7, set, 2)).toBe(true); // set member
    expect(MIN_REQUEST_INTERVAL_MS).toBe(100);
  });

  it("keeps its own copy of the last set it sent", () => {
    const gate = new RequestGate();
    const set = Int32Array.from([1, 2]);
    expect(gate.offer(0, 0, -1, set, 2)).toBe(true);
    set[0] = 8;
    expect(gate.offer(200, 0, -1, set, 2)).toBe(true);
    expect(gate.offer(400, 0, -1, Int32Array.from([8, 2]), 2)).toBe(false);
  });

  it("sends one empty request to clear, then none while there is nothing to track", () => {
    const gate = new RequestGate();
    const set = Int32Array.from([4]);
    expect(gate.offer(0, 0, -1, set, 1)).toBe(true);
    expect(gate.offer(200, 0, -1, set, 0)).toBe(true);
    expect(gate.offer(400, 1, -1, set, 0)).toBe(false); // a new slot with nothing to track
    expect(gate.offer(600, 1, 4, set, 0)).toBe(true); // a selection alone is something to track
  });
});

describe("framedTrackIndices", () => {
  const sats: FakeSat[] = [
    { norad: 25544, group: 0, altDeg: 30 }, // 0 in frame
    { norad: 19046, group: 1, altDeg: 10 }, // 1 in frame
    { norad: 10114, group: 1, altDeg: -5 }, // 2 below the horizon
    { norad: 44713, group: 2, altDeg: 50 }, // 3 Starlink: only when selected
    { norad: 36086, group: 0, altDeg: 30, dockedWith: 25544 }, // 4 docked
    { norad: 22222, group: 1, altDeg: 40, valid: false }, // 5 invalid
    { norad: 33333, group: 1, altDeg: 60 }, // 6 in frame
    { norad: 44444, group: 1, altDeg: 70 }, // 7 in frame, selected
  ];
  const catalog = fakeCatalog(sats);
  const frame = fakeFrame(sats, T0);

  it("lists the stations and visual satellites inside the sky frame, without the selected one", () => {
    const out = new Int32Array(MAX_TRACKED);
    const n = framedTrackIndices(model, frame, catalog, 7, out, MAX_TRACKED);
    expect(ids(out, n)).toEqual([0, 1, 6]);
    const all = framedTrackIndices(model, frame, catalog, null, out, MAX_TRACKED);
    expect(ids(out, all)).toEqual([0, 1, 6, 7]);
  });

  it("stops at the cap", () => {
    const out = new Int32Array(MAX_TRACKED);
    expect(framedTrackIndices(model, frame, catalog, null, out, 2)).toBe(2);
    expect(ids(out, 2)).toEqual([0, 1]);
    expect(MAX_TRACKED).toBe(100);
  });

  it("is empty before the first ready frame", () => {
    const out = new Int32Array(MAX_TRACKED);
    expect(framedTrackIndices(model, fakeFrame(sats, T0, false), catalog, null, out, 100)).toBe(0);
  });
});

interface Harness {
  deps: TrackDeps;
  run(simTimeMs: number, wallMs: number): void;
  requests: { timeMs: number; selected: number | null; others: number[] }[];
  setFrame(frame: SatFrame): void;
  setTracks(tracks: TrackOut[]): void;
  registered(): boolean;
}

function harness(sats: FakeSat[]): Harness {
  const catalog: SatCatalog = fakeCatalog(sats);
  let frame = fakeFrame(sats, T0);
  let wall = 0;
  let updater: ((t: number) => void) | null = null;
  const requests: Harness["requests"] = [];
  const ephemeris = { catalog, tracks: new Map<number, TrackOut>(), pathsVersion: 0 };
  const deps: TrackDeps = {
    ephemeris,
    updateEphemerisFrame: () => frame,
    requestTracks: (timeMs, selected, others) =>
      requests.push({ timeMs, selected, others: Array.from(others) }),
    indexOfObjectId: (id: ObjectId) =>
      id.startsWith("sat:") ? (catalog.indexByNorad.get(Number(id.slice(4))) ?? null) : null,
    registerFrameUpdater: (fn) => {
      updater = fn;
      return () => {
        updater = null;
      };
    },
    nowMs: () => wall,
  };
  return {
    deps,
    requests,
    run(simTimeMs, wallMs) {
      wall = wallMs;
      updater?.(simTimeMs);
    },
    setFrame(next) {
      frame = next;
    },
    setTracks(tracks) {
      ephemeris.tracks = new Map(tracks.map((t) => [t.index, t]));
      ephemeris.pathsVersion++;
    },
    registered: () => updater !== null,
  };
}

const track = (index: number, lonLat: number[]): TrackOut => ({
  index,
  firstPointMs: 0,
  lonLatDeg: Float64Array.from(lonLat),
});

describe("bindTracks", () => {
  const sats: FakeSat[] = [
    { norad: 25544, group: 0, altDeg: 30 },
    { norad: 19046, group: 1, altDeg: 10 },
    { norad: 44713, group: 2, altDeg: 50 },
    { norad: 10114, group: 1, altDeg: -5 },
  ];

  it("requests on a 20 s slot change, a selection change and a set change, at most 10 per second", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const h = harness(sats);
    const tracks = createTracksLayer();
    const unbind = bindTracks(store, tracks, h.deps);
    expect(h.requests).toEqual([]);

    h.run(T0, 0);
    expect(h.requests).toEqual([{ timeMs: T0, selected: null, others: [0, 1] }]);
    h.run(T0 + 16, 16); // same slot, same set
    expect(h.requests.length).toBe(1);

    // Starlink is tracked only when selected.
    store.setState((s) => ({ selection: { ...s.selection, selectedId: "sat:44713" } }));
    h.run(T0 + 32, 32); // 32 ms after the last request: held
    expect(h.requests.length).toBe(1);
    h.run(T0 + 120, 120);
    expect(h.requests[1]).toEqual({ timeMs: T0 + 120, selected: 2, others: [0, 1] });

    // 15:09:50 is slot 89,584,547 (× 20 s = 15:09:40); 15:10:00 starts the next one.
    h.run(Date.parse("2026-10-11T15:09:59.9Z"), 300);
    expect(h.requests.length).toBe(2);
    h.run(Date.parse("2026-10-11T15:10:00Z"), 400);
    expect(h.requests.length).toBe(3);

    // The set changes when a satellite leaves the frame.
    const moved = sats.map((s) => (s.norad === 19046 ? { ...s, altDeg: -1 } : s));
    h.setFrame(fakeFrame(moved, T0));
    h.run(Date.parse("2026-10-11T15:10:00.1Z"), 600);
    expect(h.requests[3]?.others).toEqual([0]);

    unbind();
    expect(h.registered()).toBe(false);
  });

  it("tracks only the selected satellite while the satellites layer is off, and nothing before a ready frame", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const h = harness(sats);
    h.setFrame(fakeFrame(sats, T0, false));
    const unbind = bindTracks(store, createTracksLayer(), h.deps);
    h.run(T0, 0);
    expect(h.requests).toEqual([]);
    h.setFrame(fakeFrame(sats, T0));
    store.getState().actions.setLayer("satellites", false);
    store.setState((s) => ({ selection: { ...s.selection, selectedId: "sat:25544" } }));
    h.run(T0, 200);
    expect(h.requests).toEqual([{ timeMs: T0, selected: 0, others: [] }]);
    unbind();
  });

  it("redraws the layer when pathsVersion or the selection changes", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const h = harness(sats);
    const tracks = createTracksLayer();
    const unbind = bindTracks(store, tracks, h.deps);
    h.run(T0, 0);
    expect(tracks.source.getFeatures()).toEqual([]);
    h.setTracks([track(0, [170, 10, 175, 12, 181, 14]), track(1, [10, 0, 11, 1])]);
    h.run(T0 + 16, 16);
    const selectedOf = () =>
      tracks.source
        .getFeatures()
        .map((f) => [f.get("index"), f.get("selected")])
        .sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(selectedOf()).toEqual([
      [0, false],
      [1, false],
    ]);
    store.setState((s) => ({ selection: { ...s.selection, selectedId: "sat:19046" } }));
    h.run(T0 + 32, 32);
    expect(selectedOf()).toEqual([
      [0, false],
      [1, true],
    ]);
    unbind();
  });
});
