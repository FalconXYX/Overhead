// src/ui/Timeline.tsx — live/replay, play/pause, rate, steps, the ±12 h scrubber, Now and the readouts (M1 step 15),
// the civil twilight markers along the scrubber (M2 step 10), the GOES availability ticks (M7 step 7) and [M9] "Copy
// link" (step 8).
// Re-renders only through useTick4Hz (and its own scrubber input) and reads store.getState().clock during render.
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { offeredRates } from "../app/clip";
import { shareUrl } from "../app/url";
import { makeObserver, twilightMarkersMs } from "../domain/astro";
import {
  formatUtcHhMm,
  formatZonedDateTime,
  goesStepsInRange,
  isoUtcSeconds,
  SCRUB_HALF_RANGE_MS,
} from "../domain/time";
import { useActions, useAppState, useClockControls, useTick4Hz } from "../state/hooks";
import { selectActiveCamera, selectLiveLocked, selectSite } from "../state/selectors";
import { store } from "../state/store";
import type { CameraSite } from "../state/types";

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

// Layout needed to place the markers along the scrubber: each marker is centred on its time. The box (as wide as the
// scrubber) and the marker row are in src/app/layout.css, with the rest of the visual design (M9 step 12).
const markerStyle = (fraction: number): CSSProperties => ({
  position: "absolute",
  left: `${fraction * 100}%`,
  transform: "translateX(-50%)",
  whiteSpace: "nowrap",
});
// [M7] One bar per run of listed GOES steps, placed by time: a gap is a space between bars, not a colour. The row is
// the class tl-goes (layout.css).
const goesTickStyle = (fromFraction: number, toFraction: number): CSSProperties => ({
  position: "absolute",
  top: 0,
  bottom: 0,
  left: `${fromFraction * 100}%`,
  width: `${(toFraction - fromFraction) * 100}%`,
  minWidth: "1px",
  background: "currentColor",
});

/**
 * [M7] Where GOES-West imagery exists inside the ± 12 h range, while the layer is on and availability is ready.
 * Re-rendered with Timeline at 4 Hz and reads the store during render; the segments are recomputed only when the
 * intervals, the confirmed newest step or the range centre change. aria-hidden: the GOES caption is the accessible text.
 */
function GoesTicks({ rangeCenterMs }: { rangeCenterMs: number }) {
  const { layers, data } = store.getState();
  const { status, intervals, latestStepMs } = data.goes;
  const startMs = rangeCenterMs - SCRUB_HALF_RANGE_MS;
  const segments = useMemo(
    () => goesStepsInRange(intervals, latestStepMs, startMs, startMs + 2 * SCRUB_HALF_RANGE_MS),
    [intervals, latestStepMs, startMs],
  );
  if (!layers.goesIr || status !== "ready") return null;
  const fraction = (timeMs: number): number => (timeMs - startMs) / (2 * SCRUB_HALF_RANGE_MS);
  return (
    <span data-testid="goes-ticks" aria-hidden="true" className="tl-goes">
      {segments.map(([fromMs, toMs]) => (
        <span
          key={fromMs}
          data-from={isoUtcSeconds(fromMs)}
          data-to={isoUtcSeconds(toMs)}
          style={goesTickStyle(fraction(fromMs), fraction(toMs))}
        />
      ))}
    </span>
  );
}

/** [M9] What "Copy link" shows: nothing yet, "Link copied", or the link in a selected read-only field. */
type CopyLinkState =
  | { readonly kind: "idle" }
  | { readonly kind: "copied" }
  | { readonly kind: "manual"; readonly url: string };

/**
 * [M9] "Copy link" (M9 step 8): the link comes from the store through shareUrl, never from location.href, whose t is
 * stale while playing (gotcha 17). writeText runs inside the click (a user gesture). Where the clipboard is missing
 * (an http page is not a secure context, gotcha 16) or refuses, the link shows in a read-only field, selected.
 */
function CopyLink() {
  const [state, setState] = useState<CopyLinkState>({ kind: "idle" });
  const fieldRef = useRef<HTMLInputElement>(null);
  // Focused and selected, so Cmd/Ctrl+C copies it at once (the key handler leaves a focused input alone).
  useEffect(() => {
    if (state.kind !== "manual") return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [state]);
  const copy = (): void => {
    const url = shareUrl(store.getState(), location.href);
    const clipboard: Partial<Clipboard> | undefined = navigator.clipboard;
    if (clipboard?.writeText === undefined) {
      setState({ kind: "manual", url });
      return;
    }
    clipboard.writeText(url).then(
      () => setState({ kind: "copied" }),
      () => setState({ kind: "manual", url }),
    );
  };
  return (
    <p className="tl-copy">
      <button type="button" onClick={copy}>
        Copy link
      </button>{" "}
      {/* Always mounted: a status region must exist before its text changes to be announced. */}
      <span role="status">{state.kind === "copied" ? "Link copied" : ""}</span>
      {state.kind === "manual" ? (
        <label>
          Link to this view{" "}
          <input
            ref={fieldRef}
            type="text"
            readOnly
            value={state.url}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      ) : null}
    </p>
  );
}

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
  // [M5] A clip is always replay, at 1× or 10× only (M5 step 12.1).
  const clip = useAppState((s) => selectActiveCamera(s)?.kind === "local-video");
  const rates = offeredRates(clip ? "local-video" : undefined);
  const noLiveId = useId();
  // [M5] Live on a YouTube camera follows the player's media clock (step 12.1).
  const liveLocked = useAppState(selectLiveLocked);
  const followsId = useId();
  const iso = isoUtcSeconds(simTimeMs);
  const offsetSec = Math.round((simTimeMs - rangeCenterMs) / 1000);

  return (
    <div className="timeline">
      <p className="tl-mode">
        <button
          type="button"
          aria-pressed={mode === "live"}
          aria-disabled={clip ? true : undefined}
          aria-describedby={clip ? noLiveId : undefined}
          onClick={() => {
            if (clip) return;
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
        {clip ? <span id={noLiveId}>A clip has no live mode. </span> : null}
        Mode:{" "}
        <span data-testid="time-mode" aria-describedby={liveLocked ? followsId : undefined}>
          {mode === "live" ? "Live" : "Replay"}
        </span>
        {liveLocked ? (
          <>
            {" "}
            (<span id={followsId}>Follows the video</span>)
          </>
        ) : null}
      </p>
      <p className="tl-play">
        <button type="button" onClick={actions.togglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
      </p>
      <fieldset className="tl-rate">
        <legend>Rate</legend>
        {rates.map((r) => (
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
      <p className="tl-steps">
        {STEPS.map(({ label, deltaMs }) => (
          <button key={label} type="button" onClick={() => actions.stepBy(deltaMs)}>
            {label}
          </button>
        ))}
      </p>
      <p className="tl-scrub">
        <span className="tl-scrubber">
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
          <GoesTicks rangeCenterMs={rangeCenterMs} />
          {/* Twilight markers: buttons in the Tab order, so Enter and Space seek (keyboard.ts skips Space on a
              button). The browser's focus ring is kept. */}
          <span className="tl-markers">
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
      <div className="tl-clock">
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
      <CopyLink />
    </div>
  );
}
