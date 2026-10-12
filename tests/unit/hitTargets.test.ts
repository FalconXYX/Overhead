// tests/unit/hitTargets.test.ts — the hit targets over a YouTube player (M5 step 8.3): one reusable target per drawn
// object, none created per frame, parked when unused or off, inside the frame only, the selected one placed last, and
// hover/select from the pointer. The DOM side (an ol/Overlay <button>) is replaced by fake views; e2e covers the DOM.
import type OlMap from "ol/Map";
import { describe, expect, it } from "vitest";
import type { CameraModel } from "../../src/domain/camera";
import {
  createHitTargets,
  type DrawnObjects,
  HIT_TARGET_MIN_PX,
  type HitTargetHandlers,
  type MakeHitTarget,
} from "../../src/map/sky/layers/hitTargets";
import type { ObjectId } from "../../src/state/types";
import { storeAt } from "../helpers/store";

interface FakeView {
  readonly handlers: HitTargetHandlers;
  label: string;
  at: [number, number] | null; // null: parked
  places: number;
}

function harness(objects: { id: ObjectId; name: string; x: number; y: number }[]) {
  const store = storeAt("2026-10-11T08:00:00Z");
  const views: FakeView[] = [];
  const makeTarget: MakeHitTarget = (handlers) => {
    const view: FakeView = { handlers, label: "", at: null, places: 0 };
    views.push(view);
    return {
      setLabel: (name) => {
        view.label = name;
      },
      place: (x, y) => {
        view.at = [x, y];
        view.places += 1;
      },
      park: () => {
        view.at = null;
      },
    };
  };
  const drawn: DrawnObjects = (visit) => {
    for (const o of objects) visit(o.id, o.name, o.x, o.y);
  };
  const targets = createHitTargets({} as OlMap, store, drawn, makeTarget);
  targets.setCameraModel({ widthPx: 3840, heightPx: 2160 } as CameraModel);
  return { store, views, targets, objects };
}

describe("createHitTargets", () => {
  it("is at least 24 CSS px", () => {
    expect(HIT_TARGET_MIN_PX).toBe(24);
  });

  it("does nothing until enabled, then places one named target per drawn object inside the frame", () => {
    const { views, targets } = harness([
      { id: "planet:Uranus", name: "Uranus", x: 1577, y: 2160 - 1206 },
      { id: "sat:25544", name: "ISS (ZARYA)", x: 10, y: 20 },
      { id: "star:3982", name: "Regulus", x: 3900, y: 100 }, // outside the frame: the player's bars
      { id: "moon", name: "Moon", x: 100, y: -1 },
    ]);
    targets.update(0);
    expect(views).toHaveLength(0);
    targets.setEnabled(true);
    expect(views.map((v) => [v.label, v.at])).toEqual([
      ["Uranus", [1577, 954]],
      ["ISS (ZARYA)", [10, 20]],
    ]);
  });

  it("reuses its targets every frame, moves only what moved, and parks the rest", () => {
    const { views, targets, objects } = harness([
      { id: "planet:Uranus", name: "Uranus", x: 100, y: 100 },
      { id: "sat:25544", name: "ISS (ZARYA)", x: 200, y: 200 },
    ]);
    targets.setEnabled(true);
    for (let frame = 0; frame < 10; frame++) targets.update(frame);
    expect(views).toHaveLength(2);
    expect(views.map((v) => v.places)).toEqual([1, 1]);
    const iss = objects[1];
    if (iss !== undefined) iss.x = 210;
    targets.update(11);
    expect(views.map((v) => v.places)).toEqual([1, 2]);
    objects.pop();
    targets.update(12);
    expect(views.map((v) => v.at)).toEqual([[100, 100], null]);
    objects.push({ id: "star:3982", name: "Regulus", x: 300, y: 300 });
    targets.update(13);
    expect(views).toHaveLength(2); // the parked target is reused
    expect(views[1]?.label).toBe("Regulus");
    expect(views[1]?.at).toEqual([300, 300]);
  });

  it("keeps the visit order, so the selected object (visited last) is the last target and wins overlaps", () => {
    const { views, targets } = harness([
      { id: "star:3982", name: "Regulus", x: 100, y: 100 },
      { id: "sat:25544", name: "ISS (ZARYA)", x: 101, y: 100 },
    ]);
    targets.setEnabled(true);
    expect(views.at(-1)?.label).toBe("ISS (ZARYA)");
  });

  it("parks every target when disabled, and places them again when enabled", () => {
    const { views, targets } = harness([{ id: "sun", name: "Sun", x: 5, y: 5 }]);
    targets.setEnabled(true);
    targets.setEnabled(false);
    expect(views.map((v) => v.at)).toEqual([null]);
    targets.update(1);
    expect(views.map((v) => v.at)).toEqual([null]);
    targets.setEnabled(true);
    expect(views.map((v) => v.at)).toEqual([[5, 5]]);
  });

  it("hovers on enter, unhovers on leave only if still hovered, and selects on click", () => {
    const { store, views, targets } = harness([
      { id: "planet:Uranus", name: "Uranus", x: 100, y: 100 },
    ]);
    targets.setEnabled(true);
    const view = views[0];
    if (view === undefined) throw new Error("no target");
    view.handlers.enter();
    expect(store.getState().selection.hoverId).toBe("planet:Uranus");
    view.handlers.leave();
    expect(store.getState().selection.hoverId).toBeNull();
    view.handlers.enter();
    store.getState().actions.hover("sun"); // something else took the hover meanwhile
    view.handlers.leave();
    expect(store.getState().selection.hoverId).toBe("sun");
    view.handlers.click();
    expect(store.getState().selection.selectedId).toBe("planet:Uranus");
  });

  it("places nothing before it has a camera model", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    let made = 0;
    const targets = createHitTargets(
      {} as OlMap,
      store,
      (visit) => visit("sun", "Sun", 1, 1),
      () => {
        made += 1;
        return { setLabel() {}, place() {}, park() {} };
      },
    );
    targets.setEnabled(true);
    expect(made).toBe(0);
  });
});
