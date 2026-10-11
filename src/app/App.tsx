// src/app/App.tsx — the shell: three named panes, each inside its own error boundary, and the credits.
// Placement is visual design, settled from screenshots.
import type { ReactNode } from "react";
import { Credits } from "../ui/Credits";
import { GroundView } from "../ui/GroundView";
import { LayerToggles } from "../ui/LayerToggles";
import { Timeline } from "../ui/Timeline";
import { ErrorBoundary } from "./ErrorBoundary";

function Pane({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={name}>
      <h2>{name}</h2>
      <ErrorBoundary pane={name}>{children}</ErrorBoundary>
    </section>
  );
}

export function App() {
  return (
    <>
      <main>
        <h1>Overhead</h1>
        <Pane name="Sky view">
          <p>The computed sky arrives in M2.</p>
        </Pane>
        <Pane name="Ground map">
          <LayerToggles />
          <GroundView />
        </Pane>
        <Pane name="Timeline">
          <Timeline />
        </Pane>
      </main>
      <Credits />
    </>
  );
}
