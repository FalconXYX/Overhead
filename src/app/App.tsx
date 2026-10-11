// src/app/App.tsx — the shell: three named panes, each inside its own error boundary.
import type { ReactNode } from "react";
import { isoUtcSeconds } from "../domain/time";
import { useActions, useClockControls, useTick4Hz } from "../state/hooks";
import { store } from "../state/store";
import { ErrorBoundary } from "./ErrorBoundary";

function Pane({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={name}>
      <h2>{name}</h2>
      <ErrorBoundary pane={name}>{children}</ErrorBoundary>
    </section>
  );
}

/** M0 placeholder for the Timeline; M1's Timeline.tsx replaces it. */
function ClockStatus() {
  useTick4Hz(); // re-renders at 4 Hz; the time is read during render (React rule 5)
  const { playing, rate, mode } = useClockControls();
  const { togglePlay } = useActions();
  const iso = isoUtcSeconds(store.getState().clock.simTimeMs);
  return (
    <div>
      <button type="button" onClick={togglePlay}>
        {playing ? "Pause" : "Play"}
      </button>
      <p>
        {mode === "live" ? "Live" : "Replay"}, {rate}×, UTC <time dateTime={iso}>{iso}</time>
      </p>
    </div>
  );
}

export function App() {
  return (
    <main>
      <h1>Overhead</h1>
      <Pane name="Sky view">
        <p>The computed sky arrives in M2.</p>
      </Pane>
      <Pane name="Ground map">
        <p>The ground map arrives in M1.</p>
      </Pane>
      <Pane name="Timeline">
        <ClockStatus />
      </Pane>
    </main>
  );
}
