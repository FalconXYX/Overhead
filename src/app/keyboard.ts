// src/app/keyboard.ts — the one keydown handler (M1 step 7; README Keyboard); Esc in M3; C, the calibration nudges and
// Esc on a pending calibration point in M4 (step 15); [M9] Esc ends the tour first, and KEY_MAP (step 9). Every key has
// an on-screen control (Esc: the tour's "Exit tour", the object card's close button and the alignment panel's "Cancel
// point"; the nudges: the panel's pointing fields). [Redesign] Space, the arrows and [ ] are the recorded clip's only:
// a live camera has no time controls, so they do nothing there; [ and ] pick 1× or 10× (60× and 600× are gone).
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

/** The next of the offered rates ([Redesign] 1× and 10×; none on a live camera), clamped at the ends. */
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
 * [Redesign] On a live (youtube) camera Space, ← → and [ ] are not handled: live has no time controls, and pausing
 * the clock there would leave the sky behind the video with no way back.
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
  const kind = selectActiveCamera(store.getState())?.kind;
  const live = kind === "youtube";
  switch (e.key) {
    case " ":
      // Our preventDefault() would cancel the focused button's own activation.
      if (tagName === "BUTTON" || live) return false;
      actions.togglePlay();
      return true;
    case "ArrowLeft":
    case "ArrowRight":
      if (live) return false;
      actions.stepBy((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 60_000 : 1_000));
      return true;
    case "[":
    case "]": {
      const rates = offeredRates(kind);
      if (rates.length === 0) return false; // live, or no camera yet
      // Clamped at the ends: no setRate there.
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

/**
 * [M9] README Keyboard and M9 step 9, in that order, in words for people; handleKeyDown above is the behaviour.
 * [Redesign] Plain words; the time keys are the recorded video's only.
 */
export const KEY_MAP: readonly KeyMapRow[] = [
  {
    keys: "Space",
    effect: "Play or pause the recorded video",
    notes: "Not on live cameras. On a focused button, Space presses the button",
  },
  {
    keys: "← / →",
    effect: "Back or forward 1 second in the recorded video",
    notes: "Shift: 1 minute. Not on live cameras, or while Camera alignment is open",
  },
  {
    keys: "[ / ]",
    effect: "Normal speed or 10 times faster",
    notes: "Recorded video only",
  },
  { keys: "L", effect: "Open or close Layers", notes: "" },
  { keys: "C", effect: "Open or close Camera alignment (advanced)", notes: "" },
  {
    keys: "← → ↑ ↓ with Camera alignment open",
    effect:
      "← → turn the camera's view left or right; ↑ ↓ tilt it up or down (0.05° a press; the roll on an all-sky lens pointing straight up)",
    notes: "Shift: 0.5°",
  },
  {
    keys: "Esc",
    effect: "Exit the tour; else cancel an alignment point; else close the object card",
    notes: "First match only",
  },
  {
    keys: "Arrows, + and − on a focused map",
    effect: "Move and zoom the map",
    notes: "The other keys do nothing there, except Esc",
  },
];
