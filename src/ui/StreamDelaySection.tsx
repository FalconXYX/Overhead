// src/ui/StreamDelaySection.tsx — the Calibration panel's "Stream delay" section for YouTube cameras (M5 step 9): the
// coarse, fine and exact delay inputs, the readouts from the player's media clock, the video's burned-in clock, the
// player's undocumented suggestion and the satellite step. Results go to the panel's aria-live region through
// `announce`; the readouts (re-rendered at 4 Hz) stay outside it. The global key handler ignores these inputs, so the
// arrow keys stay native. Layout and look are visual design, settled from screenshots.
import { type FormEvent, useId, useRef, useState } from "react";
import { STREAM_DELAY_FINE_MS, STREAM_DELAY_MAX_MS } from "../domain/time";
import { getMediaClock } from "../state/clockLoop";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectStreamDelayMs } from "../state/selectors";
import { store } from "../state/store";
import type { Actions, YoutubeCamera } from "../state/types";
import {
  behindRealTimeText,
  delayFromClockEntry,
  secondsText,
  secondsValueText,
  skyTimeText,
  stallSinceAnchorMs,
  suggestedDelayMs,
  zonedInputValue,
} from "./streamDelayText";

export interface StreamDelaySectionProps {
  readonly camera: YoutubeCamera;
  readonly actions: Actions;
  /** The panel's aria-live region. */
  readonly announce: (text: string) => void;
}

export function StreamDelaySection({ camera, actions, announce }: StreamDelaySectionProps) {
  useTick4Hz(); // the readouts follow the media clock (React rule 5)
  const id = useId();
  const delayMs = useAppState(selectStreamDelayMs);
  const timeZone = camera.site.timeZone;

  // Read during render: the media clock is not React state.
  const media = getMediaClock();
  const player = media?.kind === "youtube" ? media : null;
  const anchor = player?.anchor() ?? null;
  const mediaSec = player?.mediaSec() ?? null;
  const stallMs = stallSinceAnchorMs(anchor, mediaSec, Date.now());
  const { simTimeMs } = store.getState().clock;
  const suggestionMs = suggestedDelayMs(anchor, mediaSec, player?.mediaReferenceTimeMs() ?? null);

  // Fine adjust: centred on the delay when grabbed or focused; back to 0 on release or blur.
  const [fineSec, setFineSec] = useState(0);
  const fineCentreMs = useRef<number | null>(null);
  const grabFine = (): void => {
    fineCentreMs.current ??= selectStreamDelayMs(store.getState());
  };
  const releaseFine = (): void => {
    fineCentreMs.current = null;
    setFineSec(0);
  };

  // The exact input keeps the typed text while focused (as M4's number inputs).
  const [exactDraft, setExactDraft] = useState<string | null>(null);
  // The video's clock: prefilled with the sky time until the user edits it.
  const [clockDraft, setClockDraft] = useState<string | null>(null);
  const clockValue = clockDraft ?? zonedInputValue(simTimeMs, timeZone);

  const applyClock = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (anchor === null || mediaSec === null) return;
    const result = delayFromClockEntry(clockValue, timeZone, anchor, mediaSec);
    if (result.kind !== "ok") {
      announce(result.message);
      return;
    }
    actions.setStreamDelayMs(result.delayMs);
    setClockDraft(null);
    announce(`Stream delay set to ${secondsText(result.delayMs)} s from the video's clock.`);
  };

  return (
    <>
      <h3>Stream delay</h3>
      <p>
        <label htmlFor={`${id}-coarse`}>Stream delay, seconds</label>{" "}
        <input
          id={`${id}-coarse`}
          type="range"
          min={0}
          max={STREAM_DELAY_MAX_MS / 1000}
          step={1}
          value={Math.round(delayMs / 1000)}
          aria-valuetext={secondsValueText(delayMs)}
          onChange={(e) => actions.setStreamDelayMs(Number(e.currentTarget.value) * 1000)}
        />
      </p>
      <p>
        <label htmlFor={`${id}-fine`}>Fine adjust, seconds</label>{" "}
        <input
          id={`${id}-fine`}
          type="range"
          min={-STREAM_DELAY_FINE_MS / 1000}
          max={STREAM_DELAY_FINE_MS / 1000}
          step={0.1}
          value={fineSec}
          aria-valuetext={secondsValueText(fineSec * 1000)}
          onPointerDown={grabFine}
          onFocus={grabFine}
          onPointerUp={releaseFine}
          onBlur={releaseFine}
          onChange={(e) => {
            grabFine();
            const sec = Number(e.currentTarget.value);
            setFineSec(sec);
            actions.setStreamDelayMs((fineCentreMs.current ?? 0) + sec * 1000);
          }}
        />
      </p>
      <p>
        <label htmlFor={`${id}-exact`}>Stream delay (exact), seconds</label>{" "}
        <input
          id={`${id}-exact`}
          type="number"
          min={0}
          max={STREAM_DELAY_MAX_MS / 1000}
          step={0.1}
          value={exactDraft ?? secondsText(delayMs)}
          aria-valuetext={secondsValueText(delayMs)}
          onChange={(e) => {
            const text = e.currentTarget.value;
            setExactDraft(text);
            const sec = Number(text);
            if (text.trim() !== "" && Number.isFinite(sec)) actions.setStreamDelayMs(sec * 1000);
          }}
          onBlur={() => setExactDraft(null)}
        />
      </p>
      <div>
        <p>{`Delay at start of playback: ${secondsText(delayMs)} s`}</p>
        <p>{behindRealTimeText(delayMs, stallMs)}</p>
        <p>{skyTimeText(simTimeMs, timeZone)}</p>
      </div>
      <form onSubmit={applyClock}>
        <p>
          Pause the video with its own controls, then enter the time its clock shows. The sky keeps
          following the paused video.
        </p>
        <label htmlFor={`${id}-clock`}>{`Video clock (${timeZone})`}</label>{" "}
        <input
          id={`${id}-clock`}
          type="datetime-local"
          step={1}
          value={clockValue}
          disabled={anchor === null}
          onChange={(e) => setClockDraft(e.currentTarget.value)}
        />{" "}
        <button type="submit" disabled={anchor === null}>
          Apply video clock
        </button>
        {anchor === null ? <span> Available once the video plays.</span> : null}
      </form>
      {suggestionMs === null ? null : (
        <p>
          {`The player suggests ${secondsText(suggestionMs)} s (undocumented API)`}{" "}
          <button
            type="button"
            onClick={() => {
              actions.setStreamDelayMs(suggestionMs);
              announce(
                `Stream delay set to ${secondsText(suggestionMs)} s, as the player suggests.`,
              );
            }}
          >
            Apply suggestion
          </button>
        </p>
      )}
      <p>
        Wait for a bright satellite or the ISS. Drag the delay until its marker sits on the dot in
        the video.
      </p>
    </>
  );
}
