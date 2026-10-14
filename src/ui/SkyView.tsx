// src/ui/SkyView.tsx — the sky map container, its lifecycle, its load states and its text alternative (M2 step 9), the
// satellite list and the hover card's portal (M3 step 13); for image cameras the still-image background, its size
// notice and replay caption, "Fit frame", the focusable map and the calibration crosshair (M4 steps 10, 11 and 14);
// the sky stage over a video: the YouTube player under the map, the Fullscreen button and its guard (M5 step 8).
// Imports no OpenLayers module (README import rule 4). [Redesign] Layout only (redesign spec section 2): the stage is
// the hero, a 16:9 box for both the clip and the live player; the selected object's card (ObjectCard) floats over its
// bottom-left; the lists under the stage are gone (InViewList, in the control bar's [In view] popover, replaces them)
// and Fullscreen moved to the control bar, which takes the whole stage column fullscreen.
import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { imageCapturedText, imageSizeNotice } from "../app/stillImage";
import { mountYoutubePlayer } from "../app/youtube";
import { registerMap } from "../map/registry";
import { cameraPansAndZooms, createSkyMap } from "../map/sky/createSkyMap";
import { backgroundImageSize, bindBackground } from "../map/sync/bindBackground";
import { bindBodiesVisible, bindPendingPoint } from "../map/sync/bindCalibrationView";
import { bindHorizonWorker, bindSkyHorizon } from "../map/sync/bindHorizon";
import { bindSkyLayerVisible } from "../map/sync/bindLayers";
import { bindSelection } from "../map/sync/bindSelection";
import { bindSkyCamera } from "../map/sync/bindSkyCamera";
import { registerFrameUpdater } from "../state/clockLoop";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera, selectClipUnavailable } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import { HoverCard } from "./HoverCard";
import { ObjectCard } from "./ObjectCard";

/** [M5] The guard's note when the player's own fullscreen (the f key, G3) was undone. */
const FULLSCREEN_NOTE = "Use the Fullscreen button under the video to keep the sky drawn on it.";
/**
 * [M9] Layout lives in src/app/layout.css (visual design, step 12): the stage box fills the pane, a map target needs a
 * non-zero size (M1 gotcha 15), and the frame is fitted inside it, whatever its shape. The box carries the frame's
 * ratio W/H for the CSS. [M5] For a YouTube camera the stage itself has the camera's aspect W:H, contained in the box,
 * and the player wrapper and the map target both fill it (README "Sky over video" rules 4 and 8).
 */
const ratioStyle = (widthPx: number, heightPx: number) =>
  ({ "--stage-ratio": widthPx / heightPx }) as CSSProperties;
const youtubeStageStyle = (widthPx: number, heightPx: number) =>
  ({ aspectRatio: `${widthPx} / ${heightPx}` }) as const;

/** [Redesign] Phone widths: the video is too small to cover, so the card goes under it instead (layout.css). */
const NARROW = "(max-width: 599.98px)";
function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getNarrow = (): boolean => window.matchMedia(NARROW).matches;

/** [M5] App's resolved video id for the active YouTube camera (step 12.3). */
export interface SkyViewPlayer {
  readonly cameraId: string;
  readonly videoId: string;
  /** App has restarted this activation with a new id: errors give up without another re-resolve. */
  readonly restarted: boolean;
}
export interface SkyViewProps {
  /** null while App resolves the id, and for other camera kinds. */
  readonly player?: SkyViewPlayer | null;
  /** Hands App a new id found by the player's re-resolve (step 5.8). A stable reference. */
  readonly onRestart?: (newId: string) => void;
}
const NO_RESTART = (): void => {};

export function SkyView({ player = null, onRestart = NO_RESTART }: SkyViewProps = {}) {
  useTick4Hz(); // the size notice reads backgroundImageSize during render (React rule 5)
  const ref = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  // [M5] The camera whose player's own fullscreen the guard undid: the note shows only for that camera.
  const [fullscreenNoteFor, setFullscreenNoteFor] = useState<string | null>(null);
  const [hoverElement, setHoverElement] = useState<HTMLElement | null>(null);
  // "Fit frame" calls the live map's fitFrame; null while no map is mounted.
  const fitFrameRef = useRef<(() => void) | null>(null);
  const actions = useActions();
  const stars = useAppState((s) => s.data.stars);
  const cameraName = useAppState((s) => selectActiveCamera(s)?.name ?? null);
  const kind = useAppState((s) => selectActiveCamera(s)?.kind ?? null);
  const activeId = useAppState((s) => s.camera.activeId);
  const imageSize = useAppState((s) => selectActiveCamera(s)?.imageSize);
  const frameTimeMs = useAppState((s) => s.camera.frameTimeMs);
  const mode = useAppState((s) => s.clock.mode);
  const calibrating = useAppState((s) => s.ui.panel === "calibration");
  // [Redesign] The clip is missing or failed: say so on the stage itself, never a black box (spec section 1).
  const clipUnavailable = useAppState(selectClipUnavailable);
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, () => false);
  // [M5] Once embed-blocked or in error, the effect's cleanup destroys the player; Retry sets "idle" again.
  const playerBlocked = useAppState(
    (s) => s.video.status === "embed-blocked" || s.video.status === "error",
  );
  const youtube = kind === "youtube";
  const overVideo = youtube || kind === "local-video";
  const playerVideoId =
    youtube && player !== null && player.cameraId === activeId ? player.videoId : null;
  const mayReResolve = !(player?.restarted ?? false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // A new map and new layers on every run: StrictMode runs mount, cleanup, mount in development.
    const sky = createSkyMap(el, store, skyCache);
    setHoverElement(sky.hoverElement);
    fitFrameRef.current = sky.fitFrame;
    const cleanup = registerMap("sky", sky.map, [
      bindSkyCamera(store, sky),
      // [M5] Every sky layer through bindSkyLayerVisible: over a video, Starlink and the grid also need layers.video.
      bindSkyLayerVisible(store, "stars", sky.starsLayer),
      // [M4] The Sun, Moon and planets also show while calibrating: they are calibration targets.
      bindBodiesVisible(store, sky.bodiesLayer),
      bindSkyLayerVisible(store, "grid", sky.gridLayer),
      bindSkyLayerVisible(store, "satellites", sky.satellitesLayer),
      bindSkyLayerVisible(store, "starlink", sky.starlinkLayer),
      bindSkyLayerVisible(store, "trails", sky.trailsLayer),
      bindSelection(store, sky.setSelection),
      bindBackground(store, sky.backgroundLayer),
      bindPendingPoint(store, sky.setPendingPoint),
      // [M6] The skyline on every camera kind (selectSkyLayerVisible("horizon") is plain layers.horizon), its
      // profile, and the worker that computes it; the cleanup stops the worker with the map.
      bindSkyLayerVisible(store, "horizon", sky.horizonLayer),
      bindSkyHorizon(store, sky),
      bindHorizonWorker(store),
      registerFrameUpdater(sky.updateFrame),
    ]);
    return () => {
      fitFrameRef.current = null;
      setHoverElement(null);
      cleanup();
    };
  }, []);

  // [M5] The player: its own effect, keyed by camera id and resolved video id, separate from the map's (README Map
  // lifecycle rule 5). StrictMode mounts, cleans up and mounts again; one player stays alive.
  useEffect(() => {
    const wrapper = playerRef.current;
    if (wrapper === null || playerVideoId === null || playerBlocked) return;
    const camera = store.getState().camera.registry[activeId];
    if (camera?.kind !== "youtube") return;
    const handle = mountYoutubePlayer(wrapper, camera, playerVideoId, store, onRestart, {
      mayReResolve,
    });
    return () => handle.destroy();
  }, [activeId, playerVideoId, playerBlocked, onRestart, mayReResolve]);

  // [M5] The fullscreen guard (step 8.5): the player's own fullscreen (the f key, G3) shows the video without the
  // overlay, so leave it and point at the stage's button. The handler has no user activation to take over.
  useEffect(() => {
    if (!overVideo) return;
    const onChange = (): void => {
      const stage = stageRef.current;
      const element = document.fullscreenElement;
      // [Redesign] The control bar's Fullscreen (the stage column, around the stage) clears the note.
      if (stage !== null && element?.contains(stage) === true) setFullscreenNoteFor(null);
      if (stage === null || element === null || element === stage || !stage.contains(element))
        return;
      document.exitFullscreen().catch((error: unknown) => {
        console.warn("Could not leave the player's fullscreen", error);
      });
      setFullscreenNoteFor(store.getState().camera.activeId);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [overVideo]);

  const statusText =
    stars === "loading" ? "Loading stars…" : stars === "error" ? "The stars failed to load" : null;
  const still = kind === "still-image";
  const panZoom = kind !== null && cameraPansAndZooms(kind);
  // Read during render; bindBackground writes it in place on every load, and useTick4Hz re-renders.
  const sizeNotice =
    imageSize !== undefined && backgroundImageSize.cameraId === activeId
      ? imageSizeNotice(backgroundImageSize.widthPx, backgroundImageSize.heightPx, imageSize)
      : null;
  const capturedText =
    still && mode === "replay" && frameTimeMs !== null ? imageCapturedText(frameTimeMs) : null;
  // M2's wording describes only the synthetic cameras (M4 step 11.5); [Redesign] plain words for the videos.
  const name = cameraName ?? "the camera";
  const label = youtube
    ? `Live video from ${name}, with the sky drawn over it`
    : kind === "local-video"
      ? `Recorded video from ${name}, with the sky drawn over it`
      : still
        ? `Computed sky over the image from ${name}`
        : `Computed sky${cameraName === null ? "" : ` for ${cameraName}`}: zenith fisheye, north up, east left`;
  // A map that takes keyboard pan and zoom is a focusable application (README Accessibility rule 5).
  const mapA11y = panZoom
    ? ({
        role: "application",
        "aria-roledescription": "map",
        "aria-label": `Sky map over the ${kind === "local-video" ? "clip" : "image"} from ${name}`,
        tabIndex: 0,
      } as const)
    : null;
  // [M5] The stage takes this aspect; [Redesign] a clip's too.
  const videoSize = overVideo ? imageSize : undefined;

  return (
    <section className="sky" aria-label={label} aria-busy={stars !== "ready" && stars !== "error"}>
      {/* [M5] The fullscreen note shares the one status element: sky.spec reads the region's only role="status". */}
      <div role="status" className="sky-status">
        {statusText}
        {overVideo && fullscreenNoteFor === activeId ? <p>{FULLSCREEN_NOTE}</p> : null}
      </div>
      {sizeNotice === null ? null : <p>{sizeNotice}</p>}
      {capturedText === null ? null : (
        <p>
          {capturedText}{" "}
          <button type="button" onClick={() => actions.setMode("live")}>
            Back to live
          </button>
        </p>
      )}
      {/* [M5] One stage for every camera kind; the player wrapper comes and goes, the map target stays. [M9] The box
          around it gives the stage its room (layout.css). */}
      <div
        className={`sky-stage-box sky-stage-box--${kind ?? "none"}`}
        style={
          imageSize === undefined ? undefined : ratioStyle(imageSize.widthPx, imageSize.heightPx)
        }
      >
        <div
          ref={stageRef}
          data-testid="sky-stage"
          className={videoSize === undefined ? "sky-stage" : "sky-stage sky-stage--video"}
          style={
            videoSize === undefined
              ? undefined
              : youtubeStageStyle(videoSize.widthPx, videoSize.heightPx)
          }
        >
          {youtube ? (
            <div ref={playerRef} data-testid="video-player" className="sky-player" />
          ) : null}
          <div ref={ref} data-map="sky" data-testid="sky-map" className="sky-map" {...mapA11y} />
          {/* The keyboard path's target for "Add point at view centre" (M4 step 14.4). */}
          {calibrating && panZoom ? (
            <div aria-hidden="true" data-testid="sky-crosshair" className="sky-crosshair">
              +
            </div>
          ) : null}
          {panZoom ? (
            <button
              type="button"
              className="sky-fit btn-quiet"
              title="Show the whole picture again after zooming"
              onClick={() => fitFrameRef.current?.()}
            >
              Reset zoom
            </button>
          ) : null}
          {clipUnavailable ? (
            <div className="stage-message">
              <p>The recorded video can't be shown here.</p>
              <p>Choose “Watch live” to see the sky over Maunakea now.</p>
            </div>
          ) : null}
          {/* The selected object's card, over the stage's bottom-left; only the card itself takes the pointer. */}
          {narrow ? null : (
            <div className="stage-card">
              <ObjectCard />
            </div>
          )}
        </div>
      </div>
      {narrow ? (
        <div className="stage-card stage-card--below">
          <ObjectCard />
        </div>
      ) : null}
      {hoverElement === null ? null : createPortal(<HoverCard />, hoverElement)}
    </section>
  );
}
