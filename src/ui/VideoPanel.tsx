// src/ui/VideoPanel.tsx — the video's status and offers (M5 step 7): for a YouTube camera the status line, the rebuffer
// prompt, Retry and, [Redesign] when the live stream cannot play, "Watch on YouTube" and "Watch the recorded ISS pass"
// (never "Replay a local clip"); for a clip camera the clip's status (ClipControls, step 10), which offers "Watch live"
// when the clip is missing. Renders nothing for synthetic and still-image cameras (test-only now). The player itself
// sits in the sky stage (SkyView).
import { useEffect, useMemo, useRef, useState } from "react";
import { watchRecordedPass } from "../app/activateCamera";
import { RECORDED_CLIP_ID } from "../app/cameras";
import { REBUFFER_WATCH_START, watchRebuffer } from "../app/youtube";
import { astroTimeAt, makeObserver, sunGeometricAltDeg } from "../domain/astro";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera, selectStreamDelayMs } from "../state/selectors";
import { store } from "../state/store";
import type { CameraSite } from "../state/types";
import { ClipControls } from "./ClipControls";
import {
  behindRealTimeSec,
  rebufferText,
  youtubeStatusLines,
  youtubeWatchUrl,
} from "./videoPanelText";

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

export function VideoPanel({ resolution, onRetry }: VideoPanelProps) {
  useTick4Hz(); // only the daytime test reads the wall clock; the status line changes on state changes only
  const camera = useAppState(selectActiveCamera);
  const recordedAvailable = useAppState(
    (s) => s.camera.registry[RECORDED_CLIP_ID]?.kind === "local-video",
  );
  const status = useAppState((s) => s.video.status);
  const errorCode = useAppState((s) => s.video.errorCode);
  const cameraOffline = useAppState((s) => s.camera.status[s.camera.activeId] === "offline");
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
    cameraOffline,
    behindSec,
    daytime: daytime.current.value,
  });
  const videoId = ours?.videoId ?? camera.source.youtubeVideoId;
  const blocked = status === "embed-blocked";
  const failed = status === "error" || (status === "ended" && cameraOffline);

  return (
    <section aria-label={label} className="video-panel">
      <div
        role="status"
        data-testid="video-status"
        data-status={status}
        data-error-code={errorCode ?? undefined}
      >
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
      {blocked || failed ? (
        <p className="video-offers">
          {blocked ? (
            <>
              <a href={youtubeWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">
                Watch on YouTube
              </a>{" "}
            </>
          ) : null}
          {failed ? (
            <>
              <button type="button" onClick={onRetry}>
                Retry
              </button>{" "}
            </>
          ) : null}
          {recordedAvailable ? (
            <button type="button" className="btn-primary" onClick={() => watchRecordedPass(store)}>
              Watch the recorded ISS pass
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
