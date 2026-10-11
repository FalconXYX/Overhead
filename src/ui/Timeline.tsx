// src/ui/Timeline.tsx — live/replay, play/pause, rate, steps, the ±12 h scrubber, Now and the readouts (M1 step 15),
// and the civil twilight markers along the scrubber (M2 step 10).
// Re-renders only through useTick4Hz (and its own scrubber input) and reads store.getState().clock during render.
import { type CSSProperties, type KeyboardEvent, useMemo, useReducer } from "react";
import { makeObserver, twilightMarkersMs } from "../domain/astro";
import {
  formatUtcHhMm,
  formatZonedDateTime,
  isoUtcSeconds,
  SCRUB_HALF_RANGE_MS,
} from "../domain/time";
import { useActions, useAppState, useClockControls, useTick4Hz } from "../state/hooks";
import { selectSite } from "../state/selectors";
import { store } from "../state/store";
import type { CameraSite, ClockRate } from "../state/types";

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

interface TwilightMarker {
  readonly timeMs: number;
  readonly name: string; // "Civil dusk 04:24 UTC (18:24 local)"
  readonly label: string; // short visible text ("Dusk", "Dawn"), contained in the name; short enough not to overlap
  readonly fraction: number; // position along the scrubber, 0 at its left end
}

/**
 * Civil dusks and dawns inside the scrubber's ± 12 h range, ascending. Both times truncate to the minute, so the UTC
 * and local labels agree. Costs about 0.1–5 ms: compute it only when the range centre or the site changes.
 */
function twilightMarkers(site: CameraSite | null, rangeCenterMs: number): TwilightMarker[] {
  if (site === null) return [];
  const { duskMs, dawnMs } = twilightMarkersMs(
    makeObserver(site),
    rangeCenterMs,
    SCRUB_HALF_RANGE_MS,
  );
  const startMs = rangeCenterMs - SCRUB_HALF_RANGE_MS;
  const marker = (timeMs: number, kind: "dusk" | "dawn"): TwilightMarker => ({
    timeMs,
    name: `Civil ${kind} ${formatUtcHhMm(timeMs)} UTC (${formatZonedDateTime(timeMs, site.timeZone).slice(11, 16)} local)`,
    label: kind === "dusk" ? "Dusk" : "Dawn",
    fraction: (timeMs - startMs) / (2 * SCRUB_HALF_RANGE_MS),
  });
  return [...duskMs.map((t) => marker(t, "dusk")), ...dawnMs.map((t) => marker(t, "dawn"))].sort(
    (a, b) => a.timeMs - b.timeMs,
  );
}

// Layout needed to place the markers along the scrubber: the box is as wide as the scrubber, and each marker is
// centred on its time. Everything else (sizes, colours) is visual design, settled from screenshots.
const SCRUBBER_BOX: CSSProperties = { display: "inline-block", verticalAlign: "top" };
const MARKER_ROW: CSSProperties = { display: "block", position: "relative", minHeight: "2em" };
const markerStyle = (fraction: number): CSSProperties => ({
  position: "absolute",
  left: `${fraction * 100}%`,
  transform: "translateX(-50%)",
  whiteSpace: "nowrap",
});

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
  const { simTimeMs } = store.getState().clock;
  // Both change rarely: the twilight search reruns only when one of them does, never per tick.
  const rangeCenterMs = useAppState((s) => s.clock.rangeCenterMs);
  const site = useAppState(selectSite); // a stable reference from the registry
  const markers = useMemo(() => twilightMarkers(site, rangeCenterMs), [site, rangeCenterMs]);
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
        <span style={SCRUBBER_BOX}>
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
          />
          {/* Twilight markers: buttons in the Tab order, so Enter and Space seek (keyboard.ts skips Space on a
              button). The browser's focus ring is kept. */}
          <span style={MARKER_ROW}>
            {markers.map((m) => (
              <button
                key={m.timeMs}
                type="button"
                aria-label={m.name}
                title={m.name}
                style={markerStyle(m.fraction)}
                onClick={() => actions.seek(m.timeMs)}
              >
                {m.label}
              </button>
            ))}
          </span>
        </span>{" "}
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
