// src/ui/ClipControls.tsx — the recorded clip's status (M5 step 10), [Redesign] in plain words: one status line, and
// when the clip cannot load or play, a plain message, "Watch live" and the technical details behind a disclosure; once
// loaded, "About this recording" (closed). The file picker, "Save sidecar" and "Replay a local clip" are gone, and the
// clip now loads from main.tsx (startClipLoader), not from here. Play, pause, the scrubber and "1:35 / 8:00" are the
// control bar's. VideoPanel renders it for local-video cameras. CopyClipPointing ("Copy pointing to <source camera>",
// step 10.7) is rendered by the camera alignment panel, next to the pointing it copies.
import { useId, useSyncExternalStore } from "react";
import { watchLive } from "../app/activateCamera";
import { LIVE_CAMERA_ID } from "../app/cameras";
import {
  CLIP_TEXT,
  type ClipLoadState,
  type ClipTimingMethod,
  copyClipPointing,
  formatClipTime,
  getClipLoadState,
  subscribeClipLoads,
} from "../app/clip";
import { formatZonedDateTime, isoUtcSeconds } from "../domain/time";
import { useAppState } from "../state/hooks";
import { selectActiveCamera } from "../state/selectors";
import { store } from "../state/store";
import type { CameraConfig, LocalVideoCamera, VideoState } from "../state/types";

type VideoStatus = VideoState["status"];

/** How the clip's start was measured, for people (README "Recorded clips"). */
const TIMING_TEXT: Readonly<Record<ClipTimingMethod, string>> = {
  "burned-in-clock": "from the camera's on-screen clock",
  "hls-program-date-time": "from the stream's timestamps",
  satellite: "from a satellite's track",
  manual: "set by hand",
};

/**
 * The status line, in plain words: missing or failed, "Loading the recorded video…", or the video's state. It changes
 * only with the load state and video.status, never at 4 Hz (it sits in a live region).
 */
export function clipStatusText(
  camera: LocalVideoCamera,
  videoStatus: VideoStatus,
  load: ClipLoadState | undefined,
): string {
  const failure = load?.failure ?? null;
  if (failure !== null)
    return failure.message === CLIP_TEXT.notInBuild ? CLIP_TEXT.notInBuild : CLIP_TEXT.failed;
  if (load?.loading === true) return CLIP_TEXT.loading;
  const clip = load?.clip ?? null;
  if (clip === null || camera.source.videoUrl === null) return CLIP_TEXT.loading;
  switch (videoStatus) {
    case "playing":
      return "Playing. The labels follow the video.";
    case "buffering":
      return "Buffering…";
    case "ended":
      return "The video ended. Press play to watch it again.";
    case "error":
      return CLIP_TEXT.cannotPlay;
    case "loading":
      return CLIP_TEXT.loading;
    default:
      return "Paused. Press play to start the video.";
  }
}

export interface ClipControlsViewProps {
  readonly camera: LocalVideoCamera;
  readonly videoStatus: VideoStatus;
  readonly load: ClipLoadState | undefined;
  /** Offer "Watch live" when the clip cannot load or play: the live camera is in the registry. */
  readonly liveAvailable: boolean;
  readonly onWatchLive: () => void;
}

/** The clip's status and information, from props (unit-tested with renderToStaticMarkup). */
export function ClipControlsView(props: ClipControlsViewProps) {
  const { camera, videoStatus, load, liveAvailable } = props;
  const id = useId();
  const clip = camera.source.videoUrl === null ? null : (load?.clip ?? null);
  const startUtcMs = camera.source.startUtcMs;
  const { timeZone } = camera.site;
  const failure = load?.failure ?? null;
  const failed = failure !== null || (clip !== null && videoStatus === "error");
  const technical =
    failure === null || failure.message === CLIP_TEXT.notInBuild ? [] : [failure.message];
  const at = (timeMs: number): string =>
    `${formatZonedDateTime(timeMs, timeZone)} ${timeZone} (${isoUtcSeconds(timeMs)})`;

  return (
    <div>
      <p role="status" data-testid="video-status" data-status={videoStatus}>
        {clipStatusText(camera, videoStatus, load)}
      </p>
      {failed && liveAvailable ? (
        <p>
          <button type="button" className="btn-primary" onClick={props.onWatchLive}>
            Watch live
          </button>
        </p>
      ) : null}
      {technical.length === 0 ? null : (
        <details>
          <summary>Details</summary>
          <p>{technical[0]}</p>
          {failure === null || failure.problems.length === 0 ? null : (
            <ul aria-label="Sidecar problems">
              {failure.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      {clip === null || startUtcMs === null ? null : (
        <details>
          <summary id={`${id}-info`}>About this recording</summary>
          <dl aria-labelledby={`${id}-info`}>
            <dt>Recorded</dt>
            <dd data-testid="clip-start">{at(startUtcMs)}</dd>
            <dt>Length</dt>
            <dd>{formatClipTime(clip.probe.durationS)}</dd>
            <dt>Time</dt>
            <dd>
              {`${TIMING_TEXT[clip.sidecar.timingSource.method]}, to within ${clip.sidecar.startUncertaintyS} s`}
            </dd>
            <dt>Video</dt>
            <dd>{`${clip.fileName}, ${clip.probe.widthPx} × ${clip.probe.heightPx} px`}</dd>
          </dl>
          {clip.notes.length === 0 ? null : (
            <ul aria-label="Clip notes">
              {clip.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

/** The status of the active local-video camera's clip; main.tsx's startClipLoader loads it. */
export function ClipControls() {
  const camera = useAppState(selectActiveCamera);
  const videoStatus = useAppState((s) => s.video.status);
  const liveAvailable = useAppState((s) => s.camera.registry[LIVE_CAMERA_ID]?.kind === "youtube");
  const cameraId = camera?.id ?? "";
  const load = useSyncExternalStore(
    subscribeClipLoads,
    () => getClipLoadState(cameraId),
    () => getClipLoadState(cameraId),
  );
  if (camera?.kind !== "local-video") return null;
  return (
    <ClipControlsView
      camera={camera}
      videoStatus={videoStatus}
      load={load}
      liveAvailable={liveAvailable}
      onWatchLive={() => watchLive(store)}
    />
  );
}

/**
 * [M5] "Copy pointing to <source camera name>" for a clip camera whose source camera is known (M5 step 10.7): the
 * clip's calibration goes to the source camera, which keeps its stream delay. The camera alignment panel renders it.
 */
export function CopyClipPointing({
  camera,
  announce,
}: {
  readonly camera: CameraConfig;
  /** The alignment panel's one polite live region. */
  readonly announce: (text: string) => void;
}) {
  const sourceId = camera.kind === "local-video" ? camera.source.sourceCameraId : null;
  const sourceName = useAppState((s) =>
    sourceId === null ? null : (s.camera.registry[sourceId]?.name ?? null),
  );
  if (sourceName === null) return null;
  return (
    <p>
      <button
        type="button"
        onClick={() =>
          announce(
            copyClipPointing(store, camera.id)
              ? `Pointing copied to ${sourceName}; its stream delay is unchanged.`
              : `${sourceName} kept its pointing.`,
          )
        }
      >
        {`Copy pointing to ${sourceName}`}
      </button>
    </p>
  );
}
