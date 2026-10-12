// src/app/App.tsx — the shell: three named panes and the Inspector (M3), each inside its own error boundary, and the
// credits; [M5] the video-id resolution of the active YouTube camera (step 12.3) and the VideoPanel; [M8] the incoming
// chip; [M9] the tour's region (lazy, only while the tour runs) and the keyboard shortcuts list. Placement is visual
// design, settled from screenshots.
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { useAppState } from "../state/hooks";
import { selectActiveCamera } from "../state/selectors";
import { store } from "../state/store";
import type { YoutubeCamera } from "../state/types";
import { CalibrationPanel } from "../ui/CalibrationPanel";
import { CameraPicker } from "../ui/CameraPicker";
import { Credits } from "../ui/Credits";
import { GroundView } from "../ui/GroundView";
import { IncomingChip } from "../ui/IncomingChip";
import { Inspector } from "../ui/Inspector";
import { KeyboardShortcuts } from "../ui/KeyboardShortcuts";
import { LayerToggles } from "../ui/LayerToggles";
import { SkyView } from "../ui/SkyView";
import { Timeline } from "../ui/Timeline";
import { VideoPanel, type VideoResolution } from "../ui/VideoPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { resolveYoutubeVideoId } from "./youtube";

// [M9] The tour's captions come with demo.ts in a lazy chunk: only ?demo=1 loads them (main.tsx).
const DemoCaptions = lazy(() =>
  import("../ui/DemoCaptions").then((m) => ({ default: m.DemoCaptions })),
);

function Pane({
  name,
  className,
  children,
}: {
  name: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={name} className={`pane ${className}`}>
      <h2 className="pane-title">{name}</h2>
      <ErrorBoundary pane={name}>{children}</ErrorBoundary>
    </section>
  );
}

/** [M5] The active camera's YouTube source, an existing registry reference; null for other kinds. */
const selectYoutubeSource = (s: Parameters<typeof selectActiveCamera>[0]) => {
  const camera = selectActiveCamera(s);
  return camera?.kind === "youtube" ? camera.source : null;
};

/**
 * [M5] Resolves the active YouTube camera's video id once per activation (and again on Retry, with "no-cache": the
 * resolver pages send max-age=600). A camera change clears the state; App re-renders only when it changes.
 */
function useVideoResolution(): {
  resolution: VideoResolution | null;
  onRestart: (newId: string) => void;
  onRetry: () => void;
} {
  const activeId = useAppState((s) => s.camera.activeId);
  const source: YoutubeCamera["source"] | null = useAppState(selectYoutubeSource);
  const [resolution, setResolution] = useState<VideoResolution | null>(null);
  const [retry, setRetry] = useState<{ cameraId: string; count: number }>({
    cameraId: "",
    count: 0,
  });
  const retries = retry.cameraId === activeId ? retry.count : 0;

  useEffect(() => {
    if (source === null) {
      setResolution(null);
      return;
    }
    let cancelled = false;
    setResolution({
      cameraId: activeId,
      videoId: null,
      source: null,
      reason: null,
      restarted: false,
    });
    const cache: RequestCache = retries > 0 ? "no-cache" : "default";
    void resolveYoutubeVideoId(source.resolverUrl, source.youtubeVideoId, fetch, 5000, cache).then(
      (result) => {
        if (cancelled) return;
        setResolution({
          cameraId: activeId,
          videoId: result.id,
          source: result.source,
          reason: result.source === "fallback" ? result.reason : null,
          restarted: false,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeId, source, retries]);

  // The player's re-resolve found a new id: a new player and a new anchor (step 5.8).
  const onRestart = useCallback((newId: string) => {
    setResolution((r) => (r === null ? r : { ...r, videoId: newId, restarted: true }));
  }, []);
  const onRetry = useCallback(() => {
    // Resolving again, in the same render as the status change: no player mounts with the old id meanwhile.
    setResolution((r) => (r === null ? r : { ...r, videoId: null }));
    store.getState().actions.setVideoStatus("idle");
    const cameraId = store.getState().camera.activeId;
    setRetry((r) => ({ cameraId, count: r.cameraId === cameraId ? r.count + 1 : 1 }));
  }, []);
  return { resolution, onRestart, onRetry };
}

export function App() {
  const activeId = useAppState((s) => s.camera.activeId);
  const demoActive = useAppState((s) => s.ui.demo.active); // [M9]
  const { resolution, onRestart, onRetry } = useVideoResolution();
  const player =
    resolution === null || resolution.videoId === null
      ? null
      : {
          cameraId: resolution.cameraId,
          videoId: resolution.videoId,
          restarted: resolution.restarted,
        };
  // [M9] Layout (visual design, step 12): the header, the sky and ground panes side by side, the timeline bar, and a
  // sidebar (src/app/layout.css). DOM order is reading order below 900 px: sky, ground, timeline, then the sidebar.
  return (
    <>
      <main className="app">
        {/* [M8] The incoming chip is its own region, "Incoming satellites", mounted at all times outside the sky stage,
            so it never covers the player's controls (O1). [M9] The on-screen key list (step 9), from KEY_MAP. */}
        <header className="app-header">
          <h1 className="app-title">Overhead</h1>
          <ErrorBoundary pane="Incoming satellites">
            <IncomingChip />
          </ErrorBoundary>
          <KeyboardShortcuts />
        </header>
        {/* [M9] Not a Pane: DemoCaptions is its own region, "Tour", outside the sky stage, so it never covers the
            player (M9 step 10 rule 8). */}
        {demoActive ? (
          <ErrorBoundary pane="Tour">
            <Suspense fallback={null}>
              <DemoCaptions />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        <Pane name="Sky view" className="pane-sky">
          <SkyView player={player} onRestart={onRestart} />
        </Pane>
        <Pane name="Ground map" className="pane-ground">
          <GroundView />
        </Pane>
        <Pane name="Timeline" className="pane-timeline">
          <Timeline />
        </Pane>
        <div className="sidebar">
          <div className="sidebar-scroll">
            {/* The Layers button and its region, "Layers" (a Pane would name a second one). First, so the panel the L
                key opens is in view. */}
            <ErrorBoundary pane="Layers">
              <LayerToggles />
            </ErrorBoundary>
            {/* [M5] Not a Pane: VideoPanel is its own region, "Video: <camera name>", and renders nothing for cameras
                without a video. Keyed by camera, so each camera starts with fresh panel state. */}
            <ErrorBoundary pane="Video">
              <VideoPanel key={activeId} resolution={resolution} onRetry={onRetry} />
            </ErrorBoundary>
            {/* [M4] The camera list and the sensor controls. CalibrationPanel carries its own toggle (the on-screen C). */}
            <Pane name="Camera" className="pane-camera">
              <CameraPicker />
              <CalibrationPanel />
            </Pane>
          </div>
          {/* Not a Pane: the Inspector is its own region named "Inspector", and a Pane would name a second one. */}
          <ErrorBoundary pane="Inspector">
            <Inspector />
          </ErrorBoundary>
        </div>
      </main>
      <Credits />
    </>
  );
}
