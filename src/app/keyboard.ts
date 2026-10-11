// src/app/keyboard.ts — the one keydown handler (M1 step 7; README Keyboard). Every key has an on-screen control.
import type { AppStore } from "../state/store";
import type { ClockRate } from "../state/types";

/** The parts of a KeyboardEvent the handler reads; Node tests pass plain objects. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
}

/** A focused keyboard-pannable map, or anything inside one. */
export const MAP_SELECTOR = '[role="application"]';

/** The rates the Timeline offers, in order ([ and ] walk them, clamped at the ends). */
const RATES: readonly ClockRate[] = [1, 10, 60, 600];

function targetInfo(target: unknown): {
  tagName: unknown;
  isContentEditable: unknown;
  inMap: boolean;
} {
  if (typeof target !== "object" || target === null)
    return { tagName: null, isContentEditable: false, inMap: false };
  const { tagName, isContentEditable, closest } = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: unknown;
  };
  // A map that takes keyboard pan and zoom is role="application" (README Accessibility rule 5). Element#closest also
  // matches the element itself.
  const mapContainer: unknown =
    typeof closest === "function" ? closest.call(target, MAP_SELECTOR) : null;
  return {
    tagName,
    isContentEditable,
    inMap: mapContainer !== null && mapContainer !== undefined,
  };
}

function nextRate(rate: ClockRate, step: 1 | -1): ClockRate {
  const index = Math.max(0, RATES.indexOf(rate));
  return RATES[Math.min(RATES.length - 1, Math.max(0, index + step))] ?? rate;
}

/**
 * true when handled. Ignores inputs, a focused map, defaultPrevented events, Alt/Ctrl/Meta chords and Space on a
 * button.
 */
export function handleKeyDown(store: AppStore, e: KeyLike): boolean {
  const { tagName, isContentEditable, inMap } = targetInfo(e.target);
  // Sliders, selects and text fields keep their own keys.
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return false;
  if (isContentEditable === true) return false;
  // A focused map keeps every key: KeyboardPan's noModifierKeys condition lets Shift+arrows through unprevented.
  if (inMap) return false;
  // OpenLayers KeyboardPan on a focused map calls preventDefault() before the event reaches window.
  if (e.defaultPrevented) return false;
  // Cmd+[ is browser Back.
  if (e.altKey || e.ctrlKey || e.metaKey) return false;

  const { actions, clock } = store.getState();
  switch (e.key) {
    case " ":
      // Our preventDefault() would cancel the focused button's own activation.
      if (tagName === "BUTTON") return false;
      actions.togglePlay();
      return true;
    case "ArrowLeft":
      actions.stepBy(e.shiftKey ? -60_000 : -1_000);
      return true;
    case "ArrowRight":
      actions.stepBy(e.shiftKey ? 60_000 : 1_000);
      return true;
    case "[":
    case "]": {
      // Clamped at the ends: no setRate there, which would also leave Live.
      const rate = nextRate(clock.rate, e.key === "[" ? -1 : 1);
      if (rate !== clock.rate) actions.setRate(rate);
      return true;
    }
    case "l":
    case "L":
      actions.togglePanel("layers");
      return true;
    default:
      return false;
  }
}

/** One keydown listener on window; preventDefault() when handled. Returns the remover. */
export function installKeyboard(store: AppStore): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (handleKeyDown(store, event)) event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
