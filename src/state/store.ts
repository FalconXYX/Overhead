// src/state/store.ts
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { createActions } from "./actions";
import { DEFAULT_CAMERA_ID, initialState } from "./initialState";
import type { AppState, StateData } from "./types";

export function createAppStore(initial: StateData) {
  // The annotated return type is required: a bare `() => ({...})` fails with TS2345.
  return createStore<AppState>()(
    subscribeWithSelector(
      (set, get): AppState => ({ ...initial, actions: createActions(set, get) }),
    ),
  );
}
export type AppStore = ReturnType<typeof createAppStore>;

/** The app singleton. main.tsx applies URL state through actions before the first render. Tests use createAppStore. */
export const store: AppStore = createAppStore(initialState(Date.now(), DEFAULT_CAMERA_ID));
