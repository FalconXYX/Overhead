// src/state/hooks.ts
import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { store } from "./store";
import type { Actions, AppState } from "./types";

/** Primitive or existing-reference selectors only. */
export const useAppState = <T>(selector: (s: AppState) => T): T => useStore(store, selector);
/** One stable reference for every action. */
export const useActions = (): Actions => useStore(store, (s) => s.actions);
/** Several fields at once: useShallow, or React throws error #185 in zustand 5. */
export const useClockControls = () =>
  useStore(
    store,
    useShallow((s: AppState) => ({
      playing: s.clock.playing,
      rate: s.clock.rate,
      mode: s.clock.mode,
    })),
  );

// One shared 4 Hz ticker: every subscriber re-renders in the same commit.
const listeners = new Set<() => void>();
let tickCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
function subscribeTick(onTick: () => void): () => void {
  listeners.add(onTick);
  if (timer === null) {
    timer = setInterval(() => {
      tickCount += 1;
      for (const l of listeners) l();
    }, 250);
  }
  return () => {
    listeners.delete(onTick);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const getTick = (): number => tickCount;
/** Re-renders the caller at 4 Hz; read live values (store.getState(), ephemeris) during render. */
export const useTick4Hz = (): number => useSyncExternalStore(subscribeTick, getTick, getTick);
