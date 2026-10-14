// src/ui/DemoCaptions.tsx — the tour's region (M9 step 10 rule 7): "Step n of N", the caption in its one polite live
// region, the intro's status line and "Start the tour", and Previous, "Pause tour", Next and "Exit tour" (Restart on
// the last step). App renders it, lazily, only while the tour runs, outside the sky stage (rule 8), so it never covers
// the player. [Redesign] Five plain steps, the last one live; the GeoPose step is gone.
import { useEffect, useRef } from "react";
import { DEMO_STEPS, demoContext, demoIntroState, demoStepNumber } from "../app/demo";
import { useActions, useAppState } from "../state/hooks";
import { store } from "../state/store";

const INTRO_LOADING = "Loading the recorded video…";
const INTRO_NO_CLIP =
  "The recorded video is not included in this copy of the site, so the tour goes straight to the live camera.";

export function DemoCaptions() {
  const actions = useActions();
  const demo = useAppState((s) => s.ui.demo);
  const intro = useAppState(demoIntroState);
  // Re-render when the clip loads or the registry changes (the step count reads them), and on the video's status (the
  // live step's caption says when the stream cannot play).
  useAppState((s) => s.camera.registry);
  useAppState((s) => s.video.status);
  const ctx = demoContext(store);
  const step = DEMO_STEPS[demo.step];
  const number = demoStepNumber(ctx, demo.step);
  const isIntro = step?.id === "intro";
  const isEnd = demo.step === DEMO_STEPS.length - 1;
  const startDisabled = intro === "loading";

  // Focus moves once to "Start the tour" when it becomes enabled; again after Restart tour.
  const startRef = useRef<HTMLButtonElement>(null);
  const focusedStart = useRef(false);
  useEffect(() => {
    if (!isIntro) {
      focusedStart.current = false;
      return;
    }
    if (startDisabled || focusedStart.current) return;
    focusedStart.current = true;
    startRef.current?.focus();
  }, [isIntro, startDisabled]);

  return (
    <section aria-label="Tour" className="tour">
      <h2 className="tour-title">Tour</h2>
      {number === null ? null : (
        <p className="tour-step">{`Step ${number.n} of ${number.total}`}</p>
      )}
      {/* The one live region: it announces each step's caption, never a ticking value. */}
      <p aria-live="polite">{step?.caption(ctx) ?? ""}</p>
      {isIntro ? (
        <>
          <p>{intro === "loading" ? INTRO_LOADING : intro === "missing" ? INTRO_NO_CLIP : ""}</p>
          <p>
            <button
              ref={startRef}
              type="button"
              className="btn-primary"
              disabled={startDisabled}
              onClick={() => actions.setDemoStep(1)}
            >
              Start the tour
            </button>
          </p>
        </>
      ) : null}
      <p className="tour-actions">
        {isIntro ? null : (
          <button type="button" onClick={() => actions.setDemoStep(demo.step - 1)}>
            Previous
          </button>
        )}{" "}
        {isIntro || isEnd ? null : (
          <>
            {/* A toggle: its label never changes, aria-pressed says the state. */}
            <button
              type="button"
              aria-pressed={demo.paused}
              onClick={() => actions.setDemoPaused(!demo.paused)}
            >
              Pause tour
            </button>{" "}
            <button type="button" onClick={() => actions.setDemoStep(demo.step + 1)}>
              Next
            </button>{" "}
          </>
        )}
        {isEnd ? (
          <>
            <button type="button" onClick={() => actions.setDemoStep(0)}>
              Restart tour
            </button>{" "}
          </>
        ) : null}
        <button type="button" onClick={actions.stopDemo}>
          Exit tour
        </button>
      </p>
    </section>
  );
}
