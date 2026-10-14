// src/ui/CameraPicker.tsx — the camera switcher (M4 step 13). [Redesign] Plain short names (cameras.json's shortName),
// a status dot and word, and "Watch live" while the recorded clip is on (redesign spec sections 1–2). [Polish] A menu
// button, so 8 cameras fit at 390 px: the button shows the active camera's short name and status dot; its menu lists
// the cameras grouped "Recorded" and "Live", one row each: the short name, a place line ("Maunakea, Hawaii · night",
// the Sun's altitude at the site now), and the status dot and word. The APG menu button pattern: Enter, Space or ↓ on
// the button opens the menu on the active camera; ↑ ↓ Home End move within it; Enter or Space chooses; Esc or Tab
// closes, Esc back to the button. Each row is a menuitemradio named by its short name alone; its place and status are
// its description. Choosing one calls [M5] activateCamera (setActiveCamera, and the mode a video camera needs); url.ts
// writes ?cam=.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { activateCamera, watchLive } from "../app/activateCamera";
import { LIVE_CAMERA_ID } from "../app/cameras";
import { astroTimeAt, makeObserver, sunGeometricAltDeg } from "../domain/astro";
import { useAppState } from "../state/hooks";
import { selectCameraStatus } from "../state/selectors";
import { store } from "../state/store";
import type { AppState, CameraConfig, CameraStatus, LoadStatus } from "../state/types";
import { placeOfZone } from "./controlBarText";

/** The switcher's label for a camera: its cameras.json shortName, else its name. */
export function cameraShortName(camera: CameraConfig): string {
  return camera.shortName ?? camera.name;
}

/** The sky at a camera's site now, in a word. */
export type SkyWord = "day" | "twilight" | "night";

/**
 * "day" while the Sun's geometric altitude is above −0.833° (sunrise and sunset), "twilight" down to −12° (the sky
 * cameras show their first stars there), else "night"; null when unknown.
 */
export function skyWord(sunAltDeg: number): SkyWord | null {
  if (!Number.isFinite(sunAltDeg)) return null;
  return sunAltDeg > -0.833 ? "day" : sunAltDeg > -12 ? "twilight" : "night";
}

/** skyWord at a camera's site by the wall clock (Date.now() in the app). */
export function skyWordAt(camera: CameraConfig, wallMs: number): SkyWord | null {
  return skyWord(sunGeometricAltDeg(astroTimeAt(wallMs), makeObserver(camera.site)));
}

/** How a camera's status shows: the dot (data-status), the visible word ("" for none) and the words read out. */
export interface CameraStatusView {
  readonly dot: "recorded" | "unavailable" | "live" | "offline" | "daytime" | "unknown";
  readonly word: string;
  readonly text: string;
}

/**
 * A recording is "Unavailable" once its clip failed to load (camera status offline: not part of this build), else it
 * shows its dot alone. A live camera says "Live" or "Offline" once its player has told; "not checked" is the hollow
 * dot alone (a word on every unvisited row would be noise), and the words are always in the description.
 */
export function cameraStatusView(camera: CameraConfig, status: CameraStatus): CameraStatusView {
  if (camera.kind === "local-video") {
    return status === "offline"
      ? { dot: "unavailable", word: "Unavailable", text: "Unavailable" }
      : { dot: "recorded", word: "", text: "A recording" };
  }
  switch (status) {
    case "live":
      return { dot: "live", word: "Live", text: "Live" };
    case "offline":
      return { dot: "offline", word: "Offline", text: "Offline" };
    case "daytime":
      return { dot: "daytime", word: "Daytime", text: "Daytime" };
    default:
      return { dot: "unknown", word: "", text: "Not checked" };
  }
}

const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();
/** "11 Oct 2026" in the site's time zone. */
function localDate(timeMs: number, timeZone: string): string {
  let format = DATE_FORMATS.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    });
    DATE_FORMATS.set(timeZone, format);
  }
  return format.format(timeMs);
}

/**
 * A row's place line, as its parts: the place (placeName, else the time zone as a place), then the recording's date
 * (once its clip has loaded) or the sky at the site now.
 */
export function placeParts(camera: CameraConfig, sky: SkyWord | null | undefined): string[] {
  const parts = [camera.placeName ?? placeOfZone(camera.site.timeZone)];
  if (camera.kind === "local-video") {
    if (camera.source.startUtcMs !== null)
      parts.push(localDate(camera.source.startUtcMs, camera.site.timeZone));
  } else if (sky !== null && sky !== undefined) {
    parts.push(sky);
  }
  return parts;
}

/** A row's description: "Subaru-Asahi StarCam (east, live). Maunakea, Hawaii, night. Live" (the status text last). */
export function cameraDescription(
  camera: CameraConfig,
  status: CameraStatus,
  sky?: SkyWord | null,
): string {
  return `${camera.name}. ${placeParts(camera, sky).join(", ")}. ${cameraStatusView(camera, status).text}`;
}

export interface CameraPickerEntry {
  readonly camera: CameraConfig;
  readonly status: CameraStatus; // selectCameraStatus: synthetic cameras are always "live"
  /** The sky at the site now (a live camera's row); absent or null: not shown. */
  readonly sky?: SkyWord | null;
}

export interface CameraPickerViewProps {
  readonly entries: readonly CameraPickerEntry[];
  readonly activeId: string;
  readonly cameras: LoadStatus; // data.cameras: the registry's load state
  readonly onChoose: (id: string) => void;
  /** "Watch live" (spec section 1): the live Subaru StarCam; the button shows only while the clip is on. */
  readonly onWatchLive?: () => void;
  /** Starts open (the unit tests' static render); the app starts closed. */
  readonly defaultOpen?: boolean;
  /** Called as the menu opens: the store-connected picker reads the sky at each site then. */
  readonly onOpen?: () => void;
}

const GROUPS = [
  { key: "recorded", title: "Recorded" },
  { key: "live", title: "Live" },
] as const;

const groupOf = (camera: CameraConfig): "recorded" | "live" =>
  camera.kind === "local-video" ? "recorded" : "live";

/** The menu's rows, in DOM order. */
const menuRows = (menu: HTMLElement | null): HTMLElement[] =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

/** The menu button and its menu, from props (unit-tested with renderToStaticMarkup). */
export function CameraPickerView({
  entries,
  activeId,
  cameras,
  onChoose,
  onWatchLive,
  defaultOpen = false,
  onOpen,
}: CameraPickerViewProps) {
  const idPrefix = useId();
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${idPrefix}-menu`;
  const loadText =
    cameras === "error"
      ? "The camera list failed to load"
      : entries.length === 0
        ? "Loading cameras"
        : null;
  const activeEntry = entries.find((e) => e.camera.id === activeId);
  const active = activeEntry?.camera;
  const live = entries.find((e) => e.camera.id === LIVE_CAMERA_ID)?.camera;

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  // Opening moves focus to the active camera's row (else the first); a press outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const rows = menuRows(menuRef.current);
    (rows.find((row) => row.getAttribute("aria-checked") === "true") ?? rows[0])?.focus();
    const onPointerDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const show = (): void => {
    onOpen?.();
    setOpen(true);
  };

  const choose = (id: string): void => {
    close(true);
    if (id !== activeId) onChoose(id);
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault(); // keyboard.ts leaves a prevented key alone
    show();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const rows = menuRows(menuRef.current);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    switch (e.key) {
      case "ArrowDown":
        next = (at + 1) % rows.length;
        break;
      case "ArrowUp":
        next = (at - 1 + rows.length) % rows.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = rows.length - 1;
        break;
      case "Escape":
        e.preventDefault(); // keyboard.ts would clear the selection
        close(true);
        return;
      case "Tab":
        close(false); // focus moves on from the button's place
        return;
      default:
        return;
    }
    e.preventDefault();
    rows[next]?.focus();
  };

  const statusOfActive =
    active === undefined || activeEntry === undefined
      ? null
      : cameraStatusView(active, activeEntry.status);
  const activeDescId = `${idPrefix}-active`;

  return (
    <div className="cam-switch">
      <div ref={rootRef} className="cam-menu">
        {active === undefined || statusOfActive === null || activeEntry === undefined ? null : (
          <>
            <button
              ref={buttonRef}
              type="button"
              className="cam-menu-button"
              data-status={statusOfActive.dot}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              aria-describedby={activeDescId}
              onClick={() => (open ? close(false) : show())}
              onKeyDown={onButtonKeyDown}
            >
              <span aria-hidden="true" className="cam-dot" />
              <span className="cam-menu-name">
                <span className="visually-hidden">Camera: </span>
                {cameraShortName(active)}
              </span>
              {statusOfActive.dot === "unavailable" ||
              statusOfActive.dot === "offline" ||
              statusOfActive.dot === "daytime" ? (
                <span aria-hidden="true" className="cam-menu-word">
                  {statusOfActive.word.toLowerCase()}
                </span>
              ) : null}
              <svg aria-hidden="true" className="cam-menu-chevron" viewBox="0 0 12 12">
                <path
                  d="M2.5 4.5 6 8l3.5-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span id={activeDescId} hidden>
              {cameraDescription(active, activeEntry.status)}
            </span>
          </>
        )}
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Cameras"
          className="cam-menu-list"
          hidden={!open}
          onKeyDown={onMenuKeyDown}
        >
          {GROUPS.map(({ key, title }) => {
            const rows = entries.filter((e) => groupOf(e.camera) === key);
            if (rows.length === 0) return null;
            return (
              // A fieldset is a group; its legend, the visible heading, names it.
              <fieldset key={key} className="cam-menu-group">
                <legend className="cam-menu-heading">{title}</legend>
                {rows.map(({ camera, status, sky }) => {
                  const view = cameraStatusView(camera, status);
                  const nameId = `${idPrefix}-${camera.id}-name`;
                  const descId = `${idPrefix}-${camera.id}-desc`;
                  const checked = camera.id === activeId;
                  return (
                    <button
                      key={camera.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      aria-labelledby={nameId}
                      aria-describedby={descId}
                      tabIndex={-1}
                      className="cam-item"
                      data-status={view.dot}
                      data-camera-id={camera.id}
                      onClick={() => choose(camera.id)}
                    >
                      <span aria-hidden="true" className="cam-dot" />
                      <span className="cam-item-text">
                        <span id={nameId} className="cam-item-name">
                          {cameraShortName(camera)}
                        </span>
                        <span aria-hidden="true" className="cam-item-place">
                          {placeParts(camera, sky).join(" · ")}
                        </span>
                      </span>
                      {view.word === "" ? null : (
                        <span aria-hidden="true" className="cam-item-word">
                          {view.word}
                        </span>
                      )}
                      <svg aria-hidden="true" className="cam-item-check" viewBox="0 0 12 12">
                        <path
                          d="M2.5 6.2 5 8.6l4.5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span id={descId} hidden>
                        {cameraDescription(camera, status, sky)}
                      </span>
                    </button>
                  );
                })}
              </fieldset>
            );
          })}
        </div>
      </div>
      {/* Spec section 1: a prominent "Watch live" while the recorded clip is on. */}
      {active?.kind === "local-video" && live !== undefined ? (
        <button
          type="button"
          className="btn-primary watch-live"
          onClick={onWatchLive ?? (() => onChoose(live.id))}
        >
          <span aria-hidden="true" className="live-dot" />
          Watch live
        </button>
      ) : null}
      <div role="status" className="cam-switch-status">
        {loadText}
      </div>
    </div>
  );
}

/** Status of every registry camera, in registry order: a new array, so compared with useShallow (React rule 3). */
const selectStatuses = (s: AppState): CameraStatus[] =>
  Object.keys(s.camera.registry).map((id) => selectCameraStatus(id)(s));

export function CameraPicker() {
  const registry = useAppState((s) => s.camera.registry);
  const activeId = useAppState((s) => s.camera.activeId);
  const cameras = useAppState((s) => s.data.cameras);
  const statuses = useAppState(useShallow(selectStatuses));
  // The sky at each site, read by the wall clock as the menu opens (live cameras show the real now).
  const [skyAtMs, setSkyAtMs] = useState<number | null>(null);
  const entries = Object.values(registry).map((camera, i) => ({
    camera,
    status: statuses[i] ?? "unknown",
    sky: skyAtMs === null || camera.kind === "local-video" ? null : skyWordAt(camera, skyAtMs),
  }));
  return (
    <CameraPickerView
      entries={entries}
      activeId={activeId}
      cameras={cameras}
      onChoose={(id) => activateCamera(store, id)}
      onWatchLive={() => watchLive(store)}
      onOpen={() => setSkyAtMs(Date.now())}
    />
  );
}
