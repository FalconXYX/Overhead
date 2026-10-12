// src/ui/VideoPanel.tsx — the video's status and offers (M5 step 7): for a YouTube camera the status line, the rebuffer
// prompt, the embed-blocked fallback to replay and Retry; for a clip camera the clip controls (ClipControls, step 10).
// Renders nothing for synthetic and still-image cameras. The player itself sits in the sky stage (SkyView). Layout and
// look are visual design, settled from screenshots.
import { useEffect, useMemo, useRef, useState } from "react";
import { activateCamera } from "../app/activateCamera";
import { REBUFFER_WATCH_START, watchRebuffer } from "../app/youtube";
import { astroTimeAt, makeObserver, sunGeometricAltDeg } from "../domain/astro";
import { youtubeStallMs } from "../domain/time";
import { getMediaClock } from "../state/clockLoop";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera, selectStreamDelayMs } from "../state/selectors";
import { store } from "../state/store";
import type { CameraConfig, CameraSite } from "../state/types";
import { ClipControls } from "./ClipControls";
import { rebufferText, youtubeStatusLines, youtubeWatchUrl } from "./videoPanelText";

/** App's video-id resolution for the active YouTube camera (step 12.3). */
export interface VideoResolution {
  readonly cameraId: string;
  /** null while resolving. */
  readonly videoId: string | null;
  readonly source: "resolver" | "fallback" | null;
  readonly reason: string | null;
  /** The player was restarted with a new id found by its re-resolve. */
  readonly restarted: boolean;
}

/** App renders it with key={camera id}: every camera starts with fresh state. */
export interface VideoPanelProps {
  readonly resolution: VideoResolution | null;
  /** App re-resolves with "no-cache" and remounts the player. */
  readonly onRetry: () => void;
}

/** The daytime test runs at most once per this many ms (M4's wall-clock rule for stills). */
const DAYTIME_CHECK_MS = 60_000;

/** "Behind real time now", in whole seconds: the delay plus the stall since the anchor (step 1.3). */
function behindRealTimeSec(delayMs: number): number {
  const clock = getMediaClock();
  const anchor = clock?.kind === "youtube" ? clock.anchor() : null;
  const mediaSec = clock?.kind === "youtube" ? clock.mediaSec() : null;
  const stallMs =
    anchor === null || mediaSec === null
      ? 0
      : youtubeStallMs(anchor.wallMs, anchor.mediaSec, Date.now(), mediaSec);
  return Math.round((delayMs + stallMs) / 1000);
}

/** The enabled clip cameras recorded from `cameraId`, newest first (reverse cameras.json order). */
function recordedClipsOf(registry: Record<string, CameraConfig>, cameraId: string): CameraConfig[] {
  return Object.values(registry)
    .filter((c) => c.kind === "local-video" && c.source.sourceCameraId === cameraId)
    .reverse();
}

export function VideoPanel({ resolution, onRetry }: VideoPanelProps) {
  useTick4Hz(); // only the daytime test reads the wall clock; the status line changes on state changes only
  const camera = useAppState(selectActiveCamera);
  const registry = useAppState((s) => s.camera.registry);
  const status = useAppState((s) => s.video.status);
  const errorCode = useAppState((s) => s.video.errorCode);
  const cameraOffline = useAppState((s) => s.camera.status[s.camera.activeId] === "offline");
  const replay = useAppState((s) => s.clock.mode === "replay");
  const delayMs = useAppState(selectStreamDelayMs);
  const site = camera?.site ?? null;

  // Rebuffer prompt: store.subscribe on video.status, whose listeners run synchronously inside setVideoStatus. App
  // keys this component by camera id, so a new camera starts without a prompt.
  const [rebufferSec, setRebufferSec] = useState<number | null>(null);
  useEffect(() => {
    let watch = REBUFFER_WATCH_START;
    return store.subscribe(
      (s) => s.video.status,
      (next) => {
        const result = watchRebuffer(watch, next, Date.now());
        watch = result.watch;
        if (result.rebufferMs !== null) setRebufferSec(Math.round(result.rebufferMs / 1000));
      },
    );
  }, []);

  // N for "about N s behind real time": computed when the status or the delay changes, never at 4 Hz (the
  // extrapolated getCurrentTime() jitters, and a rounding flip would make the live region speak).
  const behindSec = useMemo(
    () => (status === "playing" ? behindRealTimeSec(delayMs) : null),
    [status, delayMs],
  );

  // Sun above 0° at the site by the wall clock, tested at most once per minute from the 4 Hz render.
  const daytime = useRef<{ site: CameraSite | null; atMs: number; value: boolean }>({
    site: null,
    atMs: Number.NEGATIVE_INFINITY,
    value: false,
  });
  const nowMs = Date.now();
  if (site !== daytime.current.site || nowMs - daytime.current.atMs >= DAYTIME_CHECK_MS) {
    daytime.current = {
      site,
      atMs: nowMs,
      value: site !== null && sunGeometricAltDeg(astroTimeAt(nowMs), makeObserver(site)) > 0,
    };
  }

  if (camera === undefined || camera.kind === "synthetic" || camera.kind === "still-image") {
    return null;
  }
  const label = `Video: ${camera.name}`;
  if (camera.kind === "local-video") {
    return (
      <section aria-label={label} className="video-panel">
        <ClipControls />
      </section>
    );
  }

  const ours = resolution !== null && resolution.cameraId === camera.id ? resolution : null;
  const lines = youtubeStatusLines({
    resolving: ours === null || ours.videoId === null,
    fallbackReason: ours?.source === "fallback" ? ours.reason : null,
    restarted: ours?.restarted ?? false,
    status,
    errorCode,
    cameraOffline,
    behindSec,
    daytime: daytime.current.value,
    replay,
  });
  const videoId = ours?.videoId ?? camera.source.youtubeVideoId;
  const blocked = status === "embed-blocked";
  const clips = blocked ? recordedClipsOf(registry, camera.id) : [];
  const localReplay = registry["local-replay"]?.kind === "local-video";

  return (
    <section aria-label={label} className="video-panel">
      <div role="status" data-testid="video-status" data-status={status}>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {rebufferSec !== null && status === "playing" ? (
          <p>
            {rebufferText(rebufferSec)}{" "}
            <button type="button" onClick={() => setRebufferSec(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
      </div>
      {blocked ? (
        <ul>
          <li>
            <a href={youtubeWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">
              Watch on YouTube
            </a>
          </li>
          {clips.map((clip) => (
            <li key={clip.id}>
              <button type="button" onClick={() => activateCamera(store, clip.id)}>
                {`Replay the recorded clip: ${clip.name}`}
              </button>
            </li>
          ))}
          {localReplay ? (
            <li>
              <button type="button" onClick={() => activateCamera(store, "local-replay")}>
                Replay a local clip
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {status === "error" || (status === "ended" && cameraOffline) ? (
        <p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
