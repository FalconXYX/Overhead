// src/ui/Timeline.tsx — the control bar under the video (M1 step 15; [M9] "Copy link"). [Redesign] A video player's
// bar (redesign spec section 2):
// - the recorded clip: play/pause, a scrubber over the clip, "1:35 / 8:00" and the local time at the camera in plain
//   words ("05:10 in Hawaii");
// - a live camera: a "● LIVE" badge and "about 50 s behind real time", with no rate, step or scrubber, and "Watch the
//   recorded ISS pass";
// - both: [In view (N)] (a popover with InViewList), [Fullscreen] and [Copy link].
// UTC is only in the local time's tooltip and its dateTime. Re-renders through useTick4Hz and reads the store during
// render (React rule 5).
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { watchRecordedPass } from "../app/activateCamera";
import { RECORDED_CLIP_ID } from "../app/cameras";
import { clipProgress, formatClipTime, seekClipTo } from "../app/clip";
import { shareUrl } from "../app/url";
import { isoUtcSeconds } from "../domain/time";
import { useActions, useAppState, useClockControls, useTick4Hz } from "../state/hooks";
import { selectActiveCamera, selectStreamDelayMs } from "../state/selectors";
import { store } from "../state/store";
import { localTimeWords, utcTooltip } from "./controlBarText";
import { InViewList } from "./InViewList";
import { inViewCount } from "./inView";
import { Popover } from "./Popover";
import { STAGE_COLUMN_ID } from "./shellIds";
import { behindRealTimeSec, liveDelayText } from "./videoPanelText";

function PlayIcon({ playing }: { readonly playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5" y="4" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2z"
        fill="currentColor"
      />
    </svg>
  );
}

/** The recorded clip's transport: play/pause, the scrubber over the clip, and "m:ss / m:ss". */
function ClipTransport() {
  // The scrubber is controlled: without a re-render in its own onChange the thumb waits for the next 4 Hz render, and
  // React resets it to the stale value after a drag.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const { playing } = useClockControls();
  const actions = useActions();
  const progress = clipProgress(store.getState());
  const positionS = progress?.positionS ?? 0;
  const durationS = progress?.durationS ?? 0;
  const pct = durationS > 0 ? (positionS / durationS) * 100 : 0;
  const position = formatClipTime(positionS);
  const duration = progress === null ? "–:––" : formatClipTime(durationS);
  return (
    <>
      <button
        type="button"
        className="cb-play btn-icon"
        disabled={progress === null}
        onClick={actions.togglePlay}
      >
        <PlayIcon playing={playing} />
        <span className="visually-hidden">{playing ? "Pause" : "Play"}</span>
      </button>
      <input
        type="range"
        className="cb-scrubber"
        aria-label="Position in the recording"
        min={0}
        max={Math.max(durationS, 0.1)}
        step={1}
        value={positionS}
        disabled={progress === null}
        aria-valuetext={`${position} of ${duration}`}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={(e) => {
          seekClipTo(store, Number(e.currentTarget.value));
          rerender();
        }}
      />
      <span className="cb-position" data-testid="clip-position">
        {progress === null ? "–:–– / –:––" : `${position} / ${duration}`}
      </span>
    </>
  );
}

/** A live camera: the badge and how far behind real time the picture is; "Back to live" after leaving live. */
function LiveStatus() {
  const actions = useActions();
  const mode = useAppState((s) => s.clock.mode);
  const status = useAppState((s) => s.video.status);
  const delayMs = useAppState(selectStreamDelayMs);
  // Computed when the status or the delay changes, never at 4 Hz: the extrapolated media time jitters.
  const behindSec = useMemo(
    () => (status === "playing" ? behindRealTimeSec(delayMs) : null),
    [status, delayMs],
  );
  if (mode !== "live") {
    return (
      <p className="cb-live">
        <span className="live-badge live-badge--off" data-testid="time-mode">
          Not live
        </span>
        <button
          type="button"
          onClick={() => {
            actions.jumpToNow();
            actions.setMode("live");
          }}
        >
          Back to live
        </button>
      </p>
    );
  }
  return (
    <p className="cb-live">
      <span className="live-badge" data-testid="time-mode">
        <span aria-hidden="true" className="live-dot" />
        Live
      </span>
      <span className="cb-behind">
        {behindSec === null ? "Waiting for the video…" : liveDelayText(behindSec)}
      </span>
    </p>
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
  // "Link copied" fades after a few seconds.
  useEffect(() => {
    if (state.kind !== "copied") return;
    const timer = setTimeout(() => setState({ kind: "idle" }), 3000);
    return () => clearTimeout(timer);
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
    <div className="cb-copy">
      <button type="button" onClick={copy}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        Copy link
      </button>
      {/* Always mounted: a status region must exist before its text changes to be announced. */}
      <span role="status" className="cb-toast" data-shown={state.kind === "copied"}>
        {state.kind === "copied" ? "Link copied" : ""}
      </span>
      {state.kind === "manual" ? (
        <label className="cb-manual">
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
    </div>
  );
}

function subscribeFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}
const getFullscreen = (): boolean =>
  document.fullscreenElement !== null &&
  document.fullscreenElement === document.getElementById(STAGE_COLUMN_ID);

/** Fullscreen for the video with its overlay and this bar (SkyView keeps the guard for the player's own). */
function FullscreenButton() {
  const on = useSyncExternalStore(subscribeFullscreen, getFullscreen, () => false);
  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={on ? "Exit fullscreen" : "Fullscreen"}
      title={on ? "Exit fullscreen" : "Fullscreen"}
      onClick={() => {
        if (on) {
          document.exitFullscreen().catch((error: unknown) => {
            console.warn("Could not leave fullscreen", error);
          });
          return;
        }
        document
          .getElementById(STAGE_COLUMN_ID)
          ?.requestFullscreen()
          .catch((error: unknown) => {
            console.warn("Fullscreen was refused", error);
          });
      }}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path
          d={
            on ? "M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" : "M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"
          }
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** [In view (N)]: the accessible list of what is drawn, with friendly names (InViewList), in a popover. */
function InViewButton() {
  const [open, setOpen] = useState(false);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);
  const count = inViewCount(store.getState());
  const text = count === null ? "In view" : `In view (${count})`;
  return (
    <Popover
      label={text}
      title="In view"
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      placement="above"
      className="in-view"
    >
      <h2 className="popover-title">In view now</h2>
      <InViewList />
    </Popover>
  );
}

export function Timeline() {
  useTick4Hz(); // time-varying readouts re-render at 4 Hz (React rule 5)
  const camera = useAppState(selectActiveCamera);
  const { simTimeMs } = store.getState().clock;
  const kind = camera?.kind;
  const iso = isoUtcSeconds(simTimeMs);
  const recorded = useAppState((s) => s.camera.registry[RECORDED_CLIP_ID] !== undefined);

  return (
    <div className="control-bar" data-kind={kind ?? "none"}>
      <div className="cb-main">
        {kind === "local-video" ? <ClipTransport /> : kind === "youtube" ? <LiveStatus /> : null}
        {camera === undefined ? null : (
          // No aria-live: four updates a second would flood a screen reader.
          <time
            className="cb-clock"
            data-testid="time-local"
            dateTime={iso}
            title={utcTooltip(simTimeMs)}
          >
            {localTimeWords(simTimeMs, camera.site.timeZone)}
          </time>
        )}
      </div>
      <div className="cb-tools">
        {kind === "youtube" && recorded ? (
          <button type="button" onClick={() => watchRecordedPass(store)}>
            Watch the recorded ISS pass
          </button>
        ) : null}
        <InViewButton />
        <FullscreenButton />
        <CopyLink />
      </div>
    </div>
  );
}
