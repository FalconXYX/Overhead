// src/ui/DemoCaptions.tsx — the tour's region (M9 step 10 rule 7): "Step n of N", the caption in its one polite live
// region, the intro's status line and "Start the tour", the GeoPose of the OGC step, and Previous, "Pause tour", Next
// and "Exit tour" (Restart on the last step). App renders it, lazily, only while the tour runs, outside the sky stage
// (rule 8), so it never covers the player. Layout and look are visual design, settled from screenshots.
import { useEffect, useRef, useState } from "react";
import { DEMO_STEPS, demoContext, demoIntroState, demoStepNumber } from "../app/demo";
import { buildGeoPoseExport } from "../app/persist";
import { useActions, useAppState } from "../state/hooks";
import { selectActiveCamera, selectCalibration } from "../state/selectors";
import { store } from "../state/store";

const INTRO_LOADING = "Loading the recorded clip…";
const INTRO_NO_CLIP =
  "The recorded clip is not part of this build, so the tour runs on the computed sky.";

/** What buildGeoPoseExport gives, whether it answers at once or (with ajv in its own chunk, M9 step 7) later. */
export type GeoPoseResult = Awaited<ReturnType<typeof buildGeoPoseExport>>;

/** The OGC step's pose and the schema check's result; null while the check runs. Props only (unit-tested). */
export function GeoPoseResultView({ result }: { readonly result: GeoPoseResult | null }) {
  if (result === null) return <p>Validating the pose against the official schema…</p>;
  if (!result.ok) {
    return (
      <div>
        <p>The pose does not validate:</p>
        <ul>
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      <p>{`Valid against the OGC GeoPose 1.0 Basic-YPR schema (${result.pose["x-overhead"].cameraId}).`}</p>
      {/* Wrapped, never a horizontal scroller (a scroller would become an extra Tab stop). */}
      <pre className="geopose">{JSON.stringify(result.pose, null, 2)}</pre>
    </div>
  );
}

/** The OGC step: the active camera's pose as the Calibration panel exports it, validated once per pointing. */
function GeoPoseBlock() {
  const camera = useAppState(selectActiveCamera);
  const calibration = useAppState(selectCalibration);
  const [shown, setShown] = useState<{
    readonly camera: unknown;
    readonly calibration: unknown;
    readonly result: GeoPoseResult;
  } | null>(null);
  useEffect(() => {
    if (camera === undefined || calibration === undefined) return;
    let cancelled = false;
    void Promise.resolve(buildGeoPoseExport(camera, calibration)).then((result) => {
      if (!cancelled) setShown({ camera, calibration, result });
    });
    return () => {
      cancelled = true;
    };
  }, [camera, calibration]);
  // A result for an earlier pointing is not shown.
  const current = shown?.camera === camera && shown?.calibration === calibration ? shown : null;
  return <GeoPoseResultView result={current?.result ?? null} />;
}

export function DemoCaptions() {
  const actions = useActions();
  const demo = useAppState((s) => s.ui.demo);
  const intro = useAppState(demoIntroState);
  // Re-render when the clip loads or the registry changes: the caption and the step count read them.
  useAppState((s) => s.camera.registry);
  const ctx = demoContext(store);
  const step = DEMO_STEPS[demo.step];
  const number = demoStepNumber(ctx, demo.step);
  const isIntro = step?.id === "intro";
  const isEnd = step?.id === "end";
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
          <p>
            {intro === "loading" ? INTRO_LOADING : intro === "computed-sky" ? INTRO_NO_CLIP : ""}
          </p>
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
      {step?.id === "ogc" ? <GeoPoseBlock /> : null}
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
