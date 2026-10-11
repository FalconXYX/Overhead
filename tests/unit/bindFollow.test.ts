import type OlMap from "ol/Map";
import View from "ol/View";
import ViewHint from "ol/ViewHint";
import { describe, expect, it } from "vitest";
import { WORLD_WIDTH_M } from "../../src/map/pick";
import { bindFollow, type FollowDeps } from "../../src/map/sync/bindFollow";
import type { SatFrame } from "../../src/state/ephemeris";
import type { ObjectId } from "../../src/state/types";
import { type FakeSat, fakeCatalog, fakeFrame } from "../helpers/satFrame";
import { storeAt } from "../helpers/store";

const T = Date.parse("2026-10-11T15:09:50Z");
const SATS: FakeSat[] = [
  { norad: 25544, mercator: [-17_303_000, 2_250_000] },
  { norad: 19046, mercator: [1_000, 2_000], valid: false },
];

/** Enough of an OpenLayers map: a real View, and pointerdrag listeners that the test fires. */
function fakeMap(view: View) {
  const drags = new Set<() => void>();
  const map = {
    getView: () => view,
    on: (type: string, fn: () => void) => {
      if (type === "pointerdrag") drags.add(fn);
    },
    un: (type: string, fn: () => void) => {
      if (type === "pointerdrag") drags.delete(fn);
    },
  };
  const drag = (): void => {
    for (const fn of drags) fn();
  };
  return { map: map as unknown as OlMap, drag, drags };
}

function setup(centre: [number, number] = [0, 0]) {
  const store = storeAt("2026-10-11T15:09:50Z");
  const catalog = fakeCatalog(SATS);
  let frame: SatFrame = fakeFrame(SATS, T);
  let updater: ((t: number) => void) | null = null;
  const deps: FollowDeps = {
    updateEphemerisFrame: () => frame,
    indexOfObjectId: (id: ObjectId) =>
      id.startsWith("sat:") ? (catalog.indexByNorad.get(Number(id.slice(4))) ?? null) : null,
    registerFrameUpdater: (fn) => {
      updater = fn;
      return () => {
        updater = null;
      };
    },
  };
  const view = new View({ center: centre, zoom: 6 });
  const fake = fakeMap(view);
  const unbind = bindFollow(store, fake.map, deps);
  const select = (id: ObjectId | null, follow: boolean) =>
    store.setState((s) => ({ selection: { ...s.selection, selectedId: id, follow } }));
  return {
    store,
    view,
    fake,
    unbind,
    select,
    run: () => updater?.(T),
    setFrame: (f: SatFrame) => {
      frame = f;
    },
    registered: () => updater !== null,
  };
}

describe("bindFollow", () => {
  it("keeps the selected satellite centred while follow is on", () => {
    const h = setup();
    h.select("sat:25544", false);
    h.run();
    expect(h.view.getCenter()).toEqual([0, 0]);
    h.select("sat:25544", true);
    h.run();
    expect(h.view.getCenter()).toEqual([-17_303_000, 2_250_000]);
    h.unbind();
  });

  it("goes to the world copy nearest the current centre (the view is not wrapped)", () => {
    const h = setup([WORLD_WIDTH_M / 2 - 10_000, 0]); // just west of the antimeridian, east side
    h.select("sat:25544", true);
    h.setFrame(
      fakeFrame(
        [{ norad: 25544, mercator: [-WORLD_WIDTH_M / 2 + 5_000, 0] }, SATS[1] ?? { norad: 1 }],
        T,
      ),
    );
    h.run();
    expect(h.view.getCenter()?.[0]).toBeCloseTo(WORLD_WIDTH_M / 2 + 5_000, 3);
    h.unbind();
  });

  it("does nothing without a position, for non-satellites, or before a ready frame", () => {
    const h = setup();
    h.select("sat:19046", true); // no position this frame
    h.run();
    h.select("planet:Jupiter", true);
    h.run();
    h.select("sat:25544", true);
    h.setFrame(fakeFrame(SATS, T, false));
    h.run();
    expect(h.view.getCenter()).toEqual([0, 0]);
    h.unbind();
  });

  it("does not fight an animation or a user interaction", () => {
    const h = setup();
    h.select("sat:25544", true);
    h.view.setHint(ViewHint.ANIMATING, 1); // "Show on map" animating
    h.run();
    expect(h.view.getCenter()).toEqual([0, 0]);
    h.view.setHint(ViewHint.ANIMATING, -1);
    h.view.setHint(ViewHint.INTERACTING, 1); // a pan in progress
    h.run();
    expect(h.view.getCenter()).toEqual([0, 0]);
    h.view.setHint(ViewHint.INTERACTING, -1);
    h.run();
    expect(h.view.getCenter()).toEqual([-17_303_000, 2_250_000]);
    h.unbind();
  });

  it("a drag on the map turns follow off; unbinding removes the updater and the listener", () => {
    const h = setup();
    h.select("sat:25544", true);
    h.fake.drag();
    expect(h.store.getState().selection.follow).toBe(false);
    h.unbind();
    expect(h.registered()).toBe(false);
    expect(h.fake.drags.size).toBe(0);
  });
});
