// src/app/keyboard.ts — the one keydown handler (M1 step 7; README Keyboard); Esc in M3; C, the calibration nudges and
// Esc on a pending calibration point in M4 (step 15); [M9] Esc ends the tour first, and KEY_MAP (step 9). Every key has
// an on-screen control (Esc: the tour's "Exit tour", the Inspector's "Clear selection" and the panel's "Cancel point";
// the nudges: the panel's pointing fields).
import { selectActiveCamera, selectCalibration } from "../state/selectors";
import type { AppStore } from "../state/store";
import type { ClockRate } from "../state/types";
import { calibrationNudge } from "../ui/calibrationFields";
import { offeredRates } from "./clip";

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

/** The next of the rates the Timeline offers ([M5] only 1× and 10× with a clip), clamped at the ends. */
function nextRate(rates: readonly ClockRate[], rate: ClockRate, step: 1 | -1): ClockRate {
  const index = Math.max(0, rates.indexOf(rate));
  return rates[Math.min(rates.length - 1, Math.max(0, index + step))] ?? rate;
}

/**
 * [M4] An arrow key while the Calibration panel is open: ← → azDeg (rollDeg on a zenith-locked fisheye), ↑ ↓ altDeg,
 * 0.05° or 0.5° with Shift (calibrationNudge), through updateCalibration. A nudge that changes nothing (↑ at 90°) is
 * handled without a write. false before the camera list has loaded: there is nothing to nudge, and the clock stays.
 */
function nudgeCalibration(store: AppStore, key: string, shiftKey: boolean): boolean {
  const s = store.getState();
  const camera = selectActiveCamera(s);
  const calibration = selectCalibration(s);
  if (camera === undefined || calibration === undefined) return false;
  const patch = calibrationNudge(camera.lens, calibration, key, shiftKey);
  if (patch === null) return false;
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
    (k) => patch[k] !== calibration[k],
  );
  if (changed) s.actions.updateCalibration(patch);
  return true;
}

/**
 * true when handled. Ignores inputs, a focused map (except Esc), defaultPrevented events, Alt/Ctrl/Meta chords and
 * Space on a button. While the Calibration panel is open the arrows nudge the calibration instead of stepping time.
 */
export function handleKeyDown(store: AppStore, e: KeyLike): boolean {
  const { tagName, isContentEditable, inMap } = targetInfo(e.target);
  // Sliders, selects and text fields keep their own keys.
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return false;
  if (isContentEditable === true) return false;
  // A focused map keeps its keys: KeyboardPan's noModifierKeys condition lets Shift+arrows through unprevented.
  // Escape is not one of them (no OpenLayers interaction reads it), and a click on the ground map both selects and
  // focuses the map, so Esc must still clear that selection there.
  if (inMap && e.key !== "Escape") return false;
  // OpenLayers KeyboardPan on a focused map calls preventDefault() before the event reaches window.
  if (e.defaultPrevented) return false;
  // Cmd+[ is browser Back.
  if (e.altKey || e.ctrlKey || e.metaKey) return false;

  const { actions, clock, ui, calibrationUi } = store.getState();
  // [M4] While the Calibration panel is open the arrows nudge the pointing; time stepping is off.
  if (
    ui.panel === "calibration" &&
    (e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown")
  ) {
    return nudgeCalibration(store, e.key, e.shiftKey);
  }
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
      const rates = offeredRates(selectActiveCamera(store.getState())?.kind);
      const rate = nextRate(rates, clock.rate, e.key === "[" ? -1 : 1);
      if (rate !== clock.rate) actions.setRate(rate);
      return true;
    }
    case "l":
    case "L":
      actions.togglePanel("layers");
      return true;
    case "c":
    case "C":
      actions.togglePanel("calibration");
      return true;
    case "Escape":
      // First match only (README Keyboard): stopDemo while the tour runs (M9), cancelImagePoint while a calibration
      // point is pending (M4), else clear the selection.
      if (ui.demo.active) {
        actions.stopDemo();
        return true;
      }
      if (calibrationUi.pendingPx !== null) {
        actions.cancelImagePoint();
        return true;
      }
      actions.select(null);
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

/** [M9] One row per shortcut, rendered by KeyboardShortcuts.tsx, so the list and the handler cannot drift. */
export interface KeyMapRow {
  readonly keys: string;
  readonly effect: string;
  readonly notes: string;
}

/** [M9] README Keyboard and M9 step 9, in that order, in words for people; handleKeyDown above is the behaviour. */
export const KEY_MAP: readonly KeyMapRow[] = [
  {
    keys: "Space",
    effect: "Play or pause",
    notes: "On a focused button, Space presses the button",
  },
  {
    keys: "← / →",
    effect: "Step back or forward 1 second",
    notes: "Shift: 1 minute. Off while the Calibration panel is open",
  },
  {
    keys: "[ / ]",
    effect: "Previous or next rate",
    notes: "1×, 10×, 60× and 600×; 1× and 10× with a recorded clip",
  },
  { keys: "L", effect: "Open or close the Layers panel", notes: "" },
  { keys: "C", effect: "Open or close the Calibration panel", notes: "" },
  {
    keys: "← → ↑ ↓ with the Calibration panel open",
    effect:
      "← → turn the azimuth by 0.05° (the roll on a zenith-locked fisheye); ↑ ↓ raise or lower the altitude by 0.05°",
    notes: "Shift: 0.5°",
  },
  {
    keys: "Esc",
    effect: "Exit the tour; else cancel a pending calibration point; else clear the selection",
    notes: "First match only",
  },
  {
    keys: "Arrows, + and − on a focused map",
    effect: "Pan and zoom the map",
    notes: "OpenLayers keyboard pan and zoom; the other keys do nothing there, except Esc",
  },
];
