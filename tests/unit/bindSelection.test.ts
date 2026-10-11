import { describe, expect, it } from "vitest";
import { bindSelection } from "../../src/map/sync/bindSelection";
import type { AppStore } from "../../src/state/store";
import type { ObjectId } from "../../src/state/types";
import { storeAt } from "../helpers/store";

type Call = readonly [ObjectId | null, ObjectId | null];

/** Writes the slice directly, so the test does not depend on how select and hover are implemented. */
function setSelection(
  store: AppStore,
  patch: { selectedId?: ObjectId | null; hoverId?: ObjectId | null },
) {
  store.setState((s) => ({ selection: { ...s.selection, ...patch } }));
}

describe("bindSelection", () => {
  it("fires [null, null] at subscribe, once per selection or hover change, never on tick or after unsubscribe", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const calls: Call[] = [];
    const unbind = bindSelection(store, (selectedId, hoverId) => calls.push([selectedId, hoverId]));
    expect(calls).toEqual([[null, null]]);

    setSelection(store, { selectedId: "sat:25544" });
    setSelection(store, { hoverId: "planet:Jupiter" });
    setSelection(store, { hoverId: "planet:Jupiter" }); // unchanged: no call
    setSelection(store, { selectedId: "star:424", hoverId: null });
    expect(calls).toEqual([
      [null, null],
      ["sat:25544", null],
      ["sat:25544", "planet:Jupiter"],
      ["star:424", null],
    ]);

    const before = calls.length;
    const { actions } = store.getState();
    actions.tick(Date.parse("2026-10-11T15:09:51Z"));
    actions.tick(Date.parse("2026-10-11T15:09:52Z"));
    // Other selection fields do not fire it either.
    store.setState((s) => ({ selection: { ...s.selection, follow: true } }));
    expect(calls.length).toBe(before);

    unbind();
    setSelection(store, { selectedId: null });
    expect(calls.length).toBe(before);
  });

  it("listeners run synchronously inside setState, so every map sees a change in the same frame", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const seen: (ObjectId | null)[] = [];
    const unbindA = bindSelection(store, (id) => seen.push(id));
    const unbindB = bindSelection(store, (id) => seen.push(id));
    seen.length = 0;
    setSelection(store, { selectedId: "moon" });
    expect(seen).toEqual(["moon", "moon"]);
    unbindA();
    unbindB();
  });
});
