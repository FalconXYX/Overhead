// src/ui/ClipControls.tsx — a local-video camera's clip (M5 step 10): the status line, the file picker (local-replay),
// the sidecar's problems and the load notes, the clip information, "Save sidecar" and the "Replay a local clip" offer.
// VideoPanel renders it for local-video cameras. CopyClipPointing ("Copy pointing to <source camera>", step 10.7) is
// rendered by the Calibration panel, next to the pointing it copies. Layout and look are visual design, settled from
// screenshots.
import { useEffect, useId, useSyncExternalStore } from "react";
import { activateCamera } from "../app/activateCamera";
import {
  CLIP_TEXT,
  type ClipLoadState,
  type ClipTimingMethod,
  cannotPlayText,
  copyClipPointing,
  formatClipDuration,
  getClipLoadState,
  LOCAL_REPLAY_ID,
  loadClip,
  loadClipFromSidecarUrl,
  sidecarFileName,
  sidecarToSave,
  subscribeClipLoads,
} from "../app/clip";
import { downloadJsonFile } from "../app/persist";
import { formatZonedDateTime, isoUtcSeconds, localVideoTimeMs } from "../domain/time";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera } from "../state/selectors";
import { store } from "../state/store";
import type { CameraConfig, Credit, LocalVideoCamera, VideoState } from "../state/types";

type VideoStatus = VideoState["status"];

/** How the clip's start was measured, for people (README "Recorded clips"). */
const TIMING_TEXT: Readonly<Record<ClipTimingMethod, string>> = {
  "burned-in-clock": "from the burned-in clock",
  "hls-program-date-time": "from the stream's PROGRAM-DATE-TIME",
  satellite: "from a satellite track",
  manual: "set by hand",
};

/**
 * The status line: a failed load's message, "Loading the clip…", the picker's prompt on local-replay, or the video's
 * state. It changes only with the load state and video.status, never at 4 Hz (it sits in a live region).
 */
export function clipStatusText(
  camera: LocalVideoCamera,
  videoStatus: VideoStatus,
  load: ClipLoadState | undefined,
): string {
  const failure = load?.failure ?? null;
  if (failure !== null) return failure.message;
  if (load?.loading === true) return CLIP_TEXT.loading;
  const clip = load?.clip ?? null;
  if (clip === null || camera.source.videoUrl === null) {
    return camera.source.sidecarUrl === null
      ? "Pick a clip and its .json sidecar together."
      : CLIP_TEXT.loading;
  }
  switch (videoStatus) {
    case "playing":
      return "Playing. The sky follows the clip.";
    case "buffering":
      return "Buffering. The sky waits for the clip.";
    case "ended":
      return "The clip ended. Play starts it again.";
    case "error":
      return cannotPlayText(clip.fileName);
    case "loading":
      return CLIP_TEXT.loading;
    default:
      return "Paused. The sky shows the frame on screen.";
  }
}

function CreditText({ credit }: { credit: Credit }) {
  const licence =
    credit.licence === null ? null : credit.licenceHref === null ? (
      credit.licence
    ) : (
      <a href={credit.licenceHref} target="_blank" rel="noopener noreferrer">
        {credit.licence}
      </a>
    );
  return (
    <>
      {credit.href === null ? (
        credit.text
      ) : (
        <a href={credit.href} target="_blank" rel="noopener noreferrer">
          {credit.text}
        </a>
      )}
      {licence === null ? null : <> ({licence})</>}
    </>
  );
}

export interface ClipControlsViewProps {
  readonly camera: LocalVideoCamera;
  readonly videoStatus: VideoStatus;
  readonly load: ClipLoadState | undefined;
  readonly simTimeMs: number; // read during the 4 Hz render, for the position readout
  readonly localReplayAvailable: boolean; // offer "Replay a local clip" after a failed sidecar load
  readonly onPickFiles: (files: File[]) => void;
  readonly onReplayLocal: () => void;
  readonly onSaveSidecar: () => void;
}

/** The clip's controls and information, from props (unit-tested with renderToStaticMarkup). */
export function ClipControlsView(props: ClipControlsViewProps) {
  const { camera, videoStatus, load, simTimeMs, localReplayAvailable } = props;
  const id = useId();
  const clip = camera.source.videoUrl === null ? null : (load?.clip ?? null);
  const startUtcMs = camera.source.startUtcMs;
  const { timeZone } = camera.site;
  const picker = camera.source.sidecarUrl === null;
  const failure = load?.failure ?? null;
  const at = (timeMs: number): string =>
    `${isoUtcSeconds(timeMs)} (${formatZonedDateTime(timeMs, timeZone)} ${timeZone})`;

  return (
    <div>
      <p role="status" data-testid="video-status" data-status={videoStatus}>
        {clipStatusText(camera, videoStatus, load)}
      </p>
      {failure === null || failure.problems.length === 0 ? null : (
        <ul aria-label="Sidecar problems">
          {failure.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {failure !== null && !picker && localReplayAvailable ? (
        <p>
          <button type="button" onClick={props.onReplayLocal}>
            Replay a local clip
          </button>
        </p>
      ) : null}
      {picker ? (
        <p>
          <label htmlFor={`${id}-files`}>Clip and its .json sidecar</label>{" "}
          <input
            id={`${id}-files`}
            type="file"
            accept="video/*,.json,application/json"
            multiple
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = ""; // the same files can be picked again
              props.onPickFiles(files);
            }}
          />{" "}
          <span>Played from this device only; never uploaded.</span>
        </p>
      ) : null}
      {clip === null || clip.notes.length === 0 ? null : (
        <ul aria-label="Clip notes">
          {clip.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {clip === null || startUtcMs === null ? null : (
        <section aria-labelledby={`${id}-info`}>
          <h3 id={`${id}-info`}>Clip information</h3>
          <dl>
            <dt>File</dt>
            <dd>{clip.fileName}</dd>
            <dt>Duration</dt>
            <dd>{formatClipDuration(clip.probe.durationS)}</dd>
            <dt>Position</dt>
            <dd>
              {formatClipDuration(
                Math.min(Math.max((simTimeMs - startUtcMs) / 1000, 0), clip.probe.durationS),
              )}
            </dd>
            <dt>Size</dt>
            <dd>{`${clip.probe.widthPx} × ${clip.probe.heightPx} px`}</dd>
            <dt>Start</dt>
            <dd data-testid="clip-start">{at(startUtcMs)}</dd>
            <dt>End</dt>
            <dd data-testid="clip-end">{at(localVideoTimeMs(startUtcMs, clip.probe.durationS))}</dd>
            <dt>Start time</dt>
            <dd>
              {`± ${clip.sidecar.startUncertaintyS} s, ${TIMING_TEXT[clip.sidecar.timingSource.method]} (${clip.sidecar.timingSource.method})`}
            </dd>
            <dt>Status</dt>
            <dd>{videoStatus}</dd>
            <dt>Credit</dt>
            <dd>
              <CreditText credit={clip.sidecar.credit} />
            </dd>
          </dl>
          <p>
            <button type="button" onClick={props.onSaveSidecar}>
              Save sidecar
            </button>{" "}
            <span>{`Saves ${sidecarFileName(clip.sidecar.videoFile)} with the current calibration.`}</span>
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * The clip of the active local-video camera. A clip camera with a sidecarUrl and no videoUrl loads it on activation
 * (one AbortController per activation, keyed by camera id); local-replay takes picked files. A loaded clip that is
 * activated again recentres when the clock is outside it.
 */
export function ClipControls() {
  useTick4Hz(); // the clip information's position (React rule 5)
  const camera = useAppState(selectActiveCamera);
  const videoStatus = useAppState((s) => s.video.status);
  const localReplayAvailable = useAppState(
    (s) => s.camera.registry[LOCAL_REPLAY_ID]?.kind === "local-video",
  );
  const cameraId = camera?.id ?? "";
  const load = useSyncExternalStore(
    subscribeClipLoads,
    () => getClipLoadState(cameraId),
    () => getClipLoadState(cameraId),
  );
  const needsLoad =
    camera?.kind === "local-video" &&
    camera.source.sidecarUrl !== null &&
    camera.source.videoUrl === null;

  // Step 10.4: from the sidecar URL, once per activation; a camera change aborts it.
  useEffect(() => {
    if (!needsLoad) return;
    const controller = new AbortController();
    void loadClipFromSidecarUrl(store, cameraId, fetch, {
      signal: controller.signal,
      baseHref: new URL(import.meta.env.BASE_URL, location.href).href,
    });
    return () => controller.abort();
  }, [cameraId, needsLoad]);

  // A clip loaded on an earlier activation: bring the clock back to it when it is elsewhere.
  useEffect(() => {
    const s = store.getState();
    const active = s.camera.registry[cameraId];
    const clip = getClipLoadState(cameraId)?.clip;
    if (active?.kind !== "local-video" || clip === undefined || clip === null) return;
    const start = active.source.startUtcMs;
    if (start === null || active.source.videoUrl === null) return;
    const { simTimeMs } = s.clock;
    if (simTimeMs < start || simTimeMs > localVideoTimeMs(start, clip.probe.durationS))
      s.actions.recenter(start);
  }, [cameraId]);

  if (camera?.kind !== "local-video") return null;
  return (
    <ClipControlsView
      camera={camera}
      videoStatus={videoStatus}
      load={load}
      simTimeMs={store.getState().clock.simTimeMs}
      localReplayAvailable={localReplayAvailable}
      onPickFiles={(files) => void loadClip(files, store)}
      onReplayLocal={() => activateCamera(store, LOCAL_REPLAY_ID)}
      onSaveSidecar={() => {
        const clip = getClipLoadState(camera.id)?.clip;
        if (clip === undefined || clip === null) return;
        const s = store.getState();
        const calibration = s.camera.calibration[camera.id] ?? camera.defaults;
        downloadJsonFile(
          sidecarFileName(clip.sidecar.videoFile),
          sidecarToSave(clip.sidecarJson, calibration),
        );
      }}
    />
  );
}

/**
 * [M5] "Copy pointing to <source camera name>" for a clip camera whose source camera is known (M5 step 10.7): the
 * clip's calibration goes to the source camera, which keeps its stream delay. The Calibration panel renders it.
 */
export function CopyClipPointing({
  camera,
  announce,
}: {
  readonly camera: CameraConfig;
  /** The Calibration panel's one polite live region. */
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
