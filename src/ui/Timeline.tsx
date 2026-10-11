// src/ui/Timeline.tsx — live/replay, play/pause, rate, steps, the ±12 h scrubber, Now and the readouts (M1 step 15).
// Re-renders only through useTick4Hz (and its own scrubber input) and reads store.getState().clock during render.
import { type KeyboardEvent, useReducer } from "react";
import { formatZonedDateTime, isoUtcSeconds, SCRUB_HALF_RANGE_MS } from "../domain/time";
import { useActions, useClockControls, useTick4Hz } from "../state/hooks";
import { selectSite } from "../state/selectors";
import { store } from "../state/store";
import type { ClockRate } from "../state/types";

const RATES: readonly ClockRate[] = [1, 10, 60, 600];
const HALF_RANGE_SEC = SCRUB_HALF_RANGE_MS / 1000;
const STEPS = [
  { label: "Back 1 minute", deltaMs: -60_000 },
  { label: "Back 1 second", deltaMs: -1_000 },
  { label: "Forward 1 second", deltaMs: 1_000 },
  { label: "Forward 1 minute", deltaMs: 60_000 },
] as const;
/**
 * The scrubber's keys as steps from the store's sim time, in seconds (Chromium's native steps: 1, and a tenth of the
 * range for PageUp/PageDown). The native steps start from the thumb's DOM value, which lags the clock by up to one
 * 4 Hz render and drops the sub-second part of the offset, so a key would not add exactly 1 s.
 */
const SLIDER_KEY_STEP_SEC: ReadonlyMap<string, number> = new Map([
  ["ArrowRight", 1],
  ["ArrowUp", 1],
  ["ArrowLeft", -1],
  ["ArrowDown", -1],
  ["PageUp", (2 * HALF_RANGE_SEC) / 10],
  ["PageDown", -(2 * HALF_RANGE_SEC) / 10],
]);

/** Applies a scrubber key to the store; true when it was one (the caller then prevents the native step). */
function sliderKey(e: KeyboardEvent<HTMLInputElement>): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  const { clock, actions } = store.getState();
  if (e.key === "Home" || e.key === "End") {
    actions.seek(
      clock.rangeCenterMs + (e.key === "End" ? SCRUB_HALF_RANGE_MS : -SCRUB_HALF_RANGE_MS),
    );
    return true;
  }
  const stepSec = SLIDER_KEY_STEP_SEC.get(e.key);
  if (stepSec === undefined) return false;
  actions.stepBy(stepSec * 1000);
  return true;
}

export function Timeline() {
  useTick4Hz(); // time-varying readouts re-render at 4 Hz (React rule 5)
  // The scrubber is controlled: without a re-render in its own onKeyDown and onChange, the thumb waits for the next
  // 4 Hz render, and React resets it to the stale value after a drag (M1 step 15).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const { playing, rate, mode } = useClockControls();
  const actions = useActions();
  const state = store.getState();
  const { simTimeMs, rangeCenterMs } = state.clock;
  const site = selectSite(state);
  const iso = isoUtcSeconds(simTimeMs);
  const offsetSec = Math.round((simTimeMs - rangeCenterMs) / 1000);

  return (
    <div>
      <p>
        <button
          type="button"
          aria-pressed={mode === "live"}
          onClick={() => {
            if (mode === "live") {
              actions.setMode("replay");
            } else {
              actions.jumpToNow();
              actions.setMode("live");
            }
          }}
        >
          Live
        </button>{" "}
        Mode: <span data-testid="time-mode">{mode === "live" ? "Live" : "Replay"}</span>
      </p>
      <p>
        <button type="button" onClick={actions.togglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
      </p>
      <fieldset>
        <legend>Rate</legend>
        {RATES.map((r) => (
          <label key={r}>
            <input
              type="radio"
              name="rate"
              value={r}
              checked={rate === r}
              onChange={() => actions.setRate(r)}
            />
            {`${r}×`}
          </label>
        ))}
      </fieldset>
      <p>
        {STEPS.map(({ label, deltaMs }) => (
          <button key={label} type="button" onClick={() => actions.stepBy(deltaMs)}>
            {label}
          </button>
        ))}
      </p>
      <p>
        <input
          type="range"
          aria-label="Simulation time"
          min={-HALF_RANGE_SEC}
          max={HALF_RANGE_SEC}
          step={1}
          value={offsetSec}
          aria-valuetext={iso}
          onKeyDown={(e) => {
            if (!sliderKey(e)) return;
            e.preventDefault();
            rerender();
          }}
          // Pointer drags and set values: the thumb's position is absolute.
          onChange={(e) => {
            const centerMs = store.getState().clock.rangeCenterMs;
            actions.seek(centerMs + Number(e.currentTarget.value) * 1000);
            rerender();
          }}
        />{" "}
        <button type="button" onClick={actions.jumpToNow}>
          Now
        </button>
      </p>
      {/* No aria-live: four updates a second would flood a screen reader. */}
      <p>
        UTC{" "}
        <time data-testid="time-utc" dateTime={iso}>
          {iso}
        </time>
      </p>
      {site === null ? null : (
        <p>
          Local{" "}
          <span data-testid="time-local">{`${formatZonedDateTime(simTimeMs, site.timeZone)} ${site.timeZone}`}</span>
        </p>
      )}
    </div>
  );
}
