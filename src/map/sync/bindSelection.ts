// src/map/sync/bindSelection.ts — the selected and hovered ids for both maps' highlight layers (README Binding rules).
import { shallow } from "zustand/vanilla/shallow";
import type { AppStore } from "../../state/store";
import type { ObjectId } from "../../state/types";

/** Calls apply now and whenever selection or hover changes. Returns the unsubscribe function. */
export function bindSelection(
  store: AppStore,
  apply: (selectedId: ObjectId | null, hoverId: ObjectId | null) => void,
): () => void {
  return store.subscribe(
    (s) => [s.selection.selectedId, s.selection.hoverId] as const,
    ([selectedId, hoverId]) => apply(selectedId, hoverId),
    { equalityFn: shallow, fireImmediately: true },
  );
}
