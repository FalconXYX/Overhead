// src/ui/SkyView.tsx — the sky map container, its lifecycle, its load states and its text alternative (M2 step 9), the
// satellite list and the hover card's portal (M3 step 13); for image cameras the still-image background, its size
// notice and replay caption, "Fit frame", the focusable map and the calibration crosshair (M4 steps 10, 11 and 14);
// the sky stage over a video: the YouTube player under the map, the Fullscreen button and its guard (M5 step 8).
// Imports no OpenLayers module (README import rule 4). Layout and look are visual design, settled from screenshots.
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imageCapturedText, imageSizeNotice } from "../app/stillImage";
import { mountYoutubePlayer } from "../app/youtube";
import { BODY_IDS, BODY_STRIDE } from "../domain/astro";
import { wrap360 } from "../domain/geo";
import { registerMap } from "../map/registry";
import { cameraPansAndZooms, createSkyMap } from "../map/sky/createSkyMap";
import { bodyLabel } from "../map/sky/layers/bodies";
import { skySatelliteList } from "../map/sky/layers/satellites";
import { backgroundImageSize, bindBackground } from "../map/sync/bindBackground";
import { bindBodiesVisible, bindPendingPoint } from "../map/sync/bindCalibrationView";
import { bindHorizonWorker, bindSkyHorizon } from "../map/sync/bindHorizon";
import { bindSkyLayerVisible } from "../map/sync/bindLayers";
import { bindSelection } from "../map/sync/bindSelection";
import { bindSkyCamera } from "../map/sync/bindSkyCamera";
import { registerFrameUpdater } from "../state/clockLoop";
import { ephemeris, indexOfObjectId } from "../state/ephemeris";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import {
  selectActiveCamera,
  selectHorizonProfileDeg,
  selectHorizonStatus,
} from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import type { LoadStatus, SatId } from "../state/types";
import { HoverCard } from "./HoverCard";
import { behindTerrain } from "./objectText";

/** [M5] The guard's note when the player's own fullscreen (the f key, G3) was undone. */
const FULLSCREEN_NOTE = "Use this Fullscreen button to keep the sky on the video.";
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

/** [M6] The non-visual equivalent of the dimming fill, appended to an item's accessible name. */
const BEHIND_TERRAIN_SUFFIX = ", behind terrain";

interface BodyItem {
  readonly id: string;
  readonly text: string;
}

/**
 * Bodies at apparent alt ≥ 0, in BODY_IDS order, e.g. "Saturn, az 120°, alt 58°"; null before the first pass. [M6]
 * ", behind terrain" is appended for a body at or below a ready terrain profile (`terrain`, else null).
 */
function bodiesAboveHorizon(bodies: Float64Array, terrain: Float32Array | null): BodyItem[] | null {
  let computed = false;
  const items: BodyItem[] = [];
  for (let i = 0; i < BODY_IDS.length; i++) {
    const id = BODY_IDS[i];
    const o = i * BODY_STRIDE;
    const az = bodies[o] ?? Number.NaN;
    const alt = bodies[o + 1] ?? Number.NaN;
    if (id === undefined || !Number.isFinite(alt)) continue;
    computed = true;
    if (alt < 0) continue;
    const azRounded = wrap360(Math.round(az)); // 359.6 shows as 0, not 360
    const label = bodyLabel(id, bodies[o + 3] ?? Number.NaN);
    const behind = behindTerrain(terrain, az, alt) ? BEHIND_TERRAIN_SUFFIX : "";
    items.push({ id, text: `${label}, az ${azRounded}°, alt ${Math.round(alt)}°${behind}` });
  }
  return computed ? items : null;
}

interface SatelliteItem {
  readonly noradId: number;
  readonly id: SatId;
  /** The button's text and accessible name, e.g. "ISS (ZARYA), NORAD 25544, az 124°, alt 29°, sunlit". */
  readonly text: string;
  readonly index: number;
}

/** The satellites drawn in the sky this frame, highest first; null before the first ready frame. */
function satellitesAboveHorizon(
  selectedIndex: number | null,
  satellitesOn: boolean,
  starlinkOn: boolean,
  terrain: Float32Array | null, // [M6] a ready profile, else null
): { items: SatelliteItem[]; starlinkCount: number } | null {
  const { frame, catalog } = ephemeris;
  const list = skySatelliteList(frame, catalog, selectedIndex, satellitesOn, starlinkOn);
  if (list === null) return null;
  const items = list.indices.map((i): SatelliteItem => {
    const noradId = catalog.noradIds[i] ?? 0;
    const azDeg = frame.azAltDeg[2 * i] ?? 0;
    const altDeg = frame.azAltDeg[2 * i + 1] ?? 0;
    const az = wrap360(Math.round(azDeg));
    const alt = Math.round(altDeg);
    const lit = ((frame.flags[i] ?? 0) & 2) !== 0 ? "sunlit" : "in shadow";
    const name = catalog.names[i] ?? `NORAD ${noradId}`;
    const behind = behindTerrain(terrain, azDeg, altDeg) ? BEHIND_TERRAIN_SUFFIX : "";
    return {
      noradId,
      id: `sat:${noradId}`,
      text: `${name}, NORAD ${noradId}, az ${az}°, alt ${alt}°, ${lit}${behind}`,
      index: i,
    };
  });
  return { items, starlinkCount: list.starlinkCount };
}

/** "Loading satellite data" or "Satellite data failed to load" for the stations and visual groups; else null. */
function satelliteStatusText(stations: LoadStatus, visual: LoadStatus): string | null {
  if (stations === "error" || visual === "error") return "Satellite data failed to load";
  if (stations !== "ready" || visual !== "ready") return "Loading satellite data";
  return null;
}

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
  useTick4Hz(); // the lists read skyCache and ephemeris during render (React rule 5)
  const ref = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  // [M5] The camera whose player's own fullscreen the guard undid: the note shows only for that camera.
  const [fullscreenNoteFor, setFullscreenNoteFor] = useState<string | null>(null);
  const headingId = useId();
  const satellitesHeadingId = useId();
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
  const selectedId = useAppState((s) => s.selection.selectedId);
  const satellitesOn = useAppState((s) => s.layers.satellites);
  const starlinkOn = useAppState((s) => s.layers.starlink);
  const stationsStatus = useAppState((s) => s.data.gp.stations.status);
  const visualStatus = useAppState((s) => s.data.gp.visual.status);
  const starlinkStatus = useAppState((s) => s.data.gp.starlink.status);
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
    stars === "loading"
      ? "Loading star catalogue"
      : stars === "error"
        ? "Star catalogue failed to load"
        : null;
  // [M6] Read during render (React rule 5): the suffix applies only while the profile is ready.
  const state = store.getState();
  const terrain = selectHorizonStatus(state) === "ready" ? selectHorizonProfileDeg(state) : null;
  const above = bodiesAboveHorizon(skyCache.bodies, terrain);
  const selectedIndex = selectedId === null ? null : indexOfObjectId(selectedId);
  const satellites = satellitesAboveHorizon(selectedIndex, satellitesOn, starlinkOn, terrain);
  const satellitesText = satelliteStatusText(stationsStatus, visualStatus);
  const starlinkCount =
    starlinkOn && starlinkStatus === "ready" && satellites !== null
      ? satellites.starlinkCount
      : null;

  const still = kind === "still-image";
  const panZoom = kind !== null && cameraPansAndZooms(kind);
  // Read during render; bindBackground writes it in place on every load, and useTick4Hz re-renders.
  const sizeNotice =
    imageSize !== undefined && backgroundImageSize.cameraId === activeId
      ? imageSizeNotice(backgroundImageSize.widthPx, backgroundImageSize.heightPx, imageSize)
      : null;
  const capturedText =
    still && mode === "replay" && frameTimeMs !== null ? imageCapturedText(frameTimeMs) : null;
  // M2's wording describes only the synthetic cameras (M4 step 11.5; M5 step 8.6 for the videos).
  const name = cameraName ?? "the camera";
  const label = youtube
    ? `Computed sky drawn over the live video from ${name}`
    : kind === "local-video"
      ? `Computed sky drawn over the clip from ${name}`
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
  const videoSize = youtube ? imageSize : undefined; // [M5] the stage takes this aspect

  return (
    <section className="sky" aria-label={label} aria-busy={stars !== "ready" && stars !== "error"}>
      {/* [M5] The fullscreen note shares the one status element: sky.spec reads the region's only role="status". */}
      <div role="status">
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
        </div>
      </div>
      {panZoom || overVideo ? (
        <div className="sky-tools">
          {panZoom ? (
            <button type="button" onClick={() => fitFrameRef.current?.()}>
              Fit frame
            </button>
          ) : null}
          {/* [M5] Outside the stage: the player and the overlay go fullscreen together; the browser's Esc exits. */}
          {overVideo ? (
            <button
              type="button"
              onClick={() => {
                setFullscreenNoteFor(null);
                stageRef.current?.requestFullscreen().catch((error: unknown) => {
                  console.warn("Fullscreen was refused", error);
                });
              }}
            >
              Fullscreen
            </button>
          ) : null}
        </div>
      ) : null}
      {hoverElement === null ? null : createPortal(<HoverCard />, hoverElement)}
      <div className="sky-objects">
        <div className="sky-objects-group sky-objects-bodies">
          <h3 id={headingId}>Above the horizon</h3>
          <ul aria-labelledby={headingId}>
            {above?.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
          {above !== null && above.length === 0 ? (
            <p>No Sun, Moon or planets above the horizon</p>
          ) : null}
        </div>
        <div className="sky-objects-group sky-objects-satellites">
          <h3 id={satellitesHeadingId}>Satellites above the horizon</h3>
          {/* The keyboard path to every stations/visual satellite in the sky; keyed by NORAD id so focus survives. */}
          <ul aria-labelledby={satellitesHeadingId}>
            {satellites?.items.map((item) => (
              <li key={item.noradId}>
                <button
                  type="button"
                  aria-pressed={item.index === selectedIndex}
                  onClick={() => actions.select(item.id)}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
          {starlinkCount === null ? null : (
            <p>
              and {starlinkCount.toLocaleString("en-US")} Starlink{" "}
              {starlinkCount === 1 ? "satellite" : "satellites"}
            </p>
          )}
          {satellitesText !== null ? (
            <p>{satellitesText}</p>
          ) : satellites !== null && satellites.items.length === 0 ? (
            <p>No satellites above the horizon</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
