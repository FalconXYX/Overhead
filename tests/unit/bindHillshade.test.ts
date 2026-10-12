// tests/unit/bindHillshade.test.ts — M6 step 11: the hillshade's Sun at most once per second (leading and trailing,
// the last state always lands; 315°/45° below the horizon; nothing while off) and the texel ground size per tile
// zoom (pushed on moveend and only when the tile zoom changes; the switch is at z + 0.415, not z + 0.5).
import type OlMap from "ol/Map";
import Observable from "ol/Observable";
import { fromLonLat } from "ol/proj";
import View from "ol/View";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { astroTimeAt, BODY_STRIDE, computeBodies, makeObserver } from "../../src/domain/astro";
import { createHillshadeLayer } from "../../src/map/ground/layers/hillshade";
import {
  bindHillshadeSun,
  bindHillshadeTexel,
  HILLSHADE_SUN_INTERVAL_MS,
} from "../../src/map/sync/bindHillshade";
import type { AppStore } from "../../src/state/store";
import { storeAt } from "../helpers/store";

const WALENSTADT = "synthetic-walenstadt";
const DAY = "2026-10-11T15:20:00Z";
const NIGHT = "2026-10-11T22:00:00Z";
const SITE = { latDeg: 47.1236, lonDeg: 9.3242, heightM: 467.6 };

type Vars = Record<string, number>;

function setup(iso: string, hillshade = true) {
  const store: AppStore = storeAt(iso);
  store.getState().actions.setActiveCamera(WALENSTADT);
  store.getState().actions.setLayer("hillshade", hillshade);
  const { layer } = createHillshadeLayer();
  const push = vi.spyOn(layer, "updateStyleVariables");
  const pushes = (): Vars[] => push.mock.calls.map(([vars]) => vars as Vars);
  return { store, layer, push, pushes };
}

/** The Sun's azimuth and apparent altitude at Walenstadt, as computeBodies gives them. */
function sunAt(timeMs: number): { sunAzDeg: number; sunAltDeg: number } {
  const out = new Float64Array(8 * BODY_STRIDE);
  computeBodies(astroTimeAt(timeMs), makeObserver(SITE), out);
  return { sunAzDeg: out[0] ?? Number.NaN, sunAltDeg: out[1] ?? Number.NaN };
}

beforeEach(() => {
  vi.useFakeTimers(); // it advances performance.now() too
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bindHillshadeSun", () => {
  it("15:20:00Z at Walenstadt pushes the Sun: az 244.56°, alt 12.69°", () => {
    const { store, layer, pushes } = setup(DAY);
    const stop = bindHillshadeSun(store, layer);
    expect(pushes()).toHaveLength(1);
    const [vars] = pushes();
    expect(vars?.sunAzDeg).toBeCloseTo(244.56, 2);
    expect(vars?.sunAltDeg).toBeCloseTo(12.69, 2);
    expect(Object.keys(vars ?? {}).sort()).toEqual(["sunAltDeg", "sunAzDeg"]);
    stop();
  });

  it("22:00:00Z (Sun at −47.19°) pushes the fixed night lighting, 315°/45°", () => {
    const { store, layer, pushes } = setup(NIGHT);
    expect(sunAt(Date.parse(NIGHT)).sunAltDeg).toBeCloseTo(-47.19, 2);
    const stop = bindHillshadeSun(store, layer);
    expect(pushes()).toEqual([{ sunAzDeg: 315, sunAltDeg: 45 }]);
    stop();
  });

  it("60 ticks in 1 s give at most 2 Sun pushes; the trailing push carries the final time", () => {
    const { store, layer, pushes } = setup(DAY);
    const t0 = Date.parse(DAY);
    const stop = bindHillshadeSun(store, layer); // the leading push
    for (let i = 1; i <= 60; i++) {
      vi.advanceTimersByTime(1000 / 60);
      store.getState().actions.tick(t0 + i * 1_000); // 60× replay
    }
    expect(pushes().length).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(HILLSHADE_SUN_INTERVAL_MS);
    const last = pushes().at(-1);
    const expected = sunAt(t0 + 60_000);
    expect(last?.sunAzDeg).toBeCloseTo(expected.sunAzDeg, 9);
    expect(last?.sunAltDeg).toBeCloseTo(expected.sunAltDeg, 9);
    // Nothing more is pending.
    const count = pushes().length;
    vi.advanceTimersByTime(5 * HILLSHADE_SUN_INTERVAL_MS);
    expect(pushes()).toHaveLength(count);
    stop();
  });

  it("does nothing while the hillshade is off, and turning it off cancels a pending push", () => {
    const { store, layer, pushes } = setup(DAY, false);
    const t0 = Date.parse(DAY);
    const stop = bindHillshadeSun(store, layer);
    store.getState().actions.tick(t0 + 1_000);
    vi.advanceTimersByTime(3 * HILLSHADE_SUN_INTERVAL_MS);
    expect(pushes()).toHaveLength(0);

    store.getState().actions.setLayer("hillshade", true); // leading push at once
    expect(pushes()).toHaveLength(1);
    store.getState().actions.tick(t0 + 2_000); // within the second: a trailing push is scheduled
    store.getState().actions.setLayer("hillshade", false);
    vi.advanceTimersByTime(3 * HILLSHADE_SUN_INTERVAL_MS);
    expect(pushes()).toHaveLength(1);
    stop();
  });

  it("skips while the active camera is not in the registry; cleanup clears the pending push", () => {
    const { store, layer, pushes } = setup(DAY);
    const { registry } = store.getState().camera;
    store.getState().actions.setRegistry({});
    const stop = bindHillshadeSun(store, layer);
    expect(pushes()).toHaveLength(0);
    store.getState().actions.setRegistry(registry);
    expect(pushes()).toHaveLength(1);
    store.getState().actions.tick(Date.parse(DAY) + 1_000); // scheduled
    stop();
    vi.advanceTimersByTime(3 * HILLSHADE_SUN_INTERVAL_MS);
    expect(pushes()).toHaveLength(1);
  });
});

describe("bindHillshadeTexel", () => {
  /** Enough of a map: a real View and real OpenLayers listeners for moveend. */
  function fakeMap(view: View): OlMap {
    return Object.assign(new Observable(), { getView: () => view }) as unknown as OlMap;
  }

  it("pushes the ground size of a texel of the tile zoom being drawn: once when bound, on a tile-zoom change, on moveend", () => {
    const { layer, source } = createHillshadeLayer();
    const push = vi.spyOn(layer, "updateStyleVariables");
    const texels = (): number[] => push.mock.calls.map(([vars]) => Number(vars.texelGroundM));
    const view = new View({ center: fromLonLat([9.3242, 47.1236]), zoom: 10 });
    const map = fakeMap(view);
    const stop = bindHillshadeTexel(map, layer, source);
    expect(texels()).toHaveLength(1);
    expect(texels()[0]).toBeCloseTo(104.02, 2);

    view.setZoom(11.3); // tile zoom 11
    view.setZoom(11.41); // still 11: the switch is at 11.415
    view.setZoom(11.42); // 12
    view.setZoom(12.41); // still 12
    view.setZoom(12.9); // 13
    expect(
      texels()
        .slice(1)
        .map((m) => Math.round(m * 100) / 100),
    ).toEqual([52.01, 26, 13]);

    map.dispatchEvent("moveend"); // forced, even without a tile-zoom change
    expect(texels()).toHaveLength(5);
    stop();
    view.setZoom(10);
    map.dispatchEvent("moveend");
    expect(texels()).toHaveLength(5);
  });
});
