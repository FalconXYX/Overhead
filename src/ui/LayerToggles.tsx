// src/ui/LayerToggles.tsx — the Layers button and panel (M1 step 15; the satellite toggles M3, the terrain toggles M6,
// the footprint M8). [Redesign] A popover from the header (redesign spec sections 2–4): two groups in plain words, "On
// the video" and "On the map", switches with short plain status, a small colour legend, and a footer button that opens
// the "Camera alignment (advanced)" drawer. Open while ui.panel is "layers" (its button or the L key).
import { useCallback, useId, useSyncExternalStore } from "react";
import { FOOTPRINT_FALLBACK_HEIGHT_KM, FOOTPRINT_PRESETS_KM } from "../domain/camera";
import { heightKmOf, indexOfObjectId } from "../state/ephemeris";
import { footprintStatus } from "../state/footprintStatus";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectHorizonStatus, selectSkyOverVideo } from "../state/selectors";
import { store } from "../state/store";
import type { LayerToggle, LoadStatus } from "../state/types";
import { gibsStatusText } from "./gibsStatus";
import {
  FOOTPRINT_HEIGHT_LABEL,
  FOOTPRINT_NOTE,
  FOOTPRINT_NOTHING_TEXT,
  FOOTPRINT_TOGGLE_LABEL,
  selectedHeightOptionText,
} from "./incomingText";
import { Popover } from "./Popover";
import { CALIBRATION_DRAWER_ID } from "./shellIds";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getReducedMotion = (): boolean => window.matchMedia(REDUCED_MOTION).matches;

/** A data layer's load state in a few plain words; null when there is nothing to say. */
function loadText(statuses: readonly LoadStatus[]): string | null {
  if (statuses.includes("error")) return "Couldn't load";
  if (statuses.includes("loading")) return "Loading…";
  return null;
}

/**
 * One switch: a native checkbox inside its label, so its accessible name is the label alone, and an optional short
 * status after it. The status is a status region that exists before its text changes, so "Loading…" and the result
 * are each announced once, and it describes the checkbox.
 */
function Switch(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly status?: string | null;
  readonly disabled?: boolean;
  readonly kind?: string;
}) {
  const statusId = useId();
  const hasStatus = props.status !== undefined;
  return (
    <p className="switch">
      <label>
        <span className="switch-label">
          {props.kind === undefined ? null : (
            <span aria-hidden="true" className={`kind-dot kind-${props.kind}`} />
          )}
          {props.label}
        </span>
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          aria-describedby={hasStatus ? statusId : undefined}
          onChange={props.onChange}
        />
      </label>
      {hasStatus ? (
        <span id={statusId} role="status" className="switch-status">
          {props.status}
        </span>
      ) : null}
    </p>
  );
}

/** A plain layer toggle. */
function LayerSwitch(props: {
  readonly layer: LayerToggle;
  readonly label: string;
  readonly status?: string | null;
  readonly disabled?: boolean;
  readonly kind?: string;
}) {
  const actions = useActions();
  const on = useAppState((s) => s.layers[props.layer]);
  return (
    <Switch
      label={props.label}
      checked={on}
      disabled={props.disabled}
      status={props.status}
      kind={props.kind}
      onChange={() => actions.toggleLayer(props.layer)}
    />
  );
}

/**
 * Starlink and the grid also need their layers.video gate while the sky is drawn over a video (every enabled camera
 * now): one switch sets both, so "on" means on the video and, for Starlink, on the map too.
 */
function GatedSwitch(props: {
  readonly layer: "starlink" | "grid";
  readonly label: string;
  readonly status?: string | null;
  readonly kind?: string;
}) {
  const actions = useActions();
  const overVideo = useAppState(selectSkyOverVideo);
  const on = useAppState(
    (s) => s.layers[props.layer] && (!overVideo || s.layers.video[props.layer]),
  );
  return (
    <Switch
      label={props.label}
      checked={on}
      status={props.status}
      kind={props.kind}
      onChange={() => {
        actions.setLayer(props.layer, !on);
        actions.setVideoLayer(props.layer, !on);
      }}
    />
  );
}

/** [M8] The height presets' option labels, in FOOTPRINT_PRESETS_KM order. */
const PRESET_LABELS: Readonly<Record<(typeof FOOTPRINT_PRESETS_KM)[number], string>> = {
  420: "Space station height (420 km)",
  480: "Starlink height (480 km)",
};
const FOLLOW_SELECTED = "selected";

/**
 * [M8] "Camera view at orbit height", and while it is on, its height select and note (step 9.1). Re-renders through
 * useTick4Hz and reads the selected satellite's height and footprintStatus during render (React rule 5). keyboard.ts
 * ignores keys typed into a select, so its arrow keys never move the clock.
 */
function FootprintControls() {
  useTick4Hz();
  const actions = useActions();
  const on = useAppState((s) => s.layers.footprint);
  const preset = useAppState((s) => s.layers.footprintHeightKm);
  const noteId = useId();
  const id = store.getState().selection.selectedId;
  const index = id?.startsWith("sat:") === true ? indexOfObjectId(id) : null;
  const selectedKm = index === null ? null : heightKmOf(index);
  return (
    <>
      <p className="switch">
        <label>
          <span className="switch-label">{FOOTPRINT_TOGGLE_LABEL}</span>
          <input
            type="checkbox"
            checked={on}
            aria-describedby={on ? noteId : undefined}
            onChange={() => actions.toggleLayer("footprint")}
          />
        </label>
      </p>
      {on ? (
        <div className="switch-more">
          <select
            aria-label={FOOTPRINT_HEIGHT_LABEL}
            aria-describedby={noteId}
            value={preset === null ? FOLLOW_SELECTED : String(preset)}
            onChange={(e) => {
              const value = e.currentTarget.value;
              actions.setFootprintHeightKm(value === FOLLOW_SELECTED ? null : Number(value));
            }}
          >
            <option value={FOLLOW_SELECTED}>
              {selectedHeightOptionText(selectedKm, FOOTPRINT_FALLBACK_HEIGHT_KM)}
            </option>
            {FOOTPRINT_PRESETS_KM.map((km) => (
              <option key={km} value={String(km)}>
                {PRESET_LABELS[km]}
              </option>
            ))}
          </select>
          <p id={noteId} className="switch-note">
            {FOOTPRINT_NOTE}
          </p>
        </div>
      ) : null}
      {/* Always mounted, so the text is announced when it appears. */}
      <p role="status" className="switch-note">
        {on && footprintStatus.pairCount === 0 ? FOOTPRINT_NOTHING_TEXT : ""}
      </p>
    </>
  );
}

/** The colour key, the same colours as the video, the map and the card (spec section 4). */
function Legend() {
  return (
    <div className="legend">
      <h3 className="legend-title">Colour key</h3>
      <ul>
        <li>
          <span aria-hidden="true" className="kind-dot kind-iss" /> Space Station
        </li>
        <li>
          <span aria-hidden="true" className="kind-dot kind-satellite" /> Satellites
        </li>
        <li>
          <span aria-hidden="true" className="kind-dot kind-starlink" /> Starlink
        </li>
        <li>
          <span aria-hidden="true" className="kind-dot kind-planet" /> Planets and Moon
        </li>
      </ul>
      <p className="legend-shapes">
        <span aria-hidden="true" className="legend-lit" /> Sunlit{" "}
        <span aria-hidden="true" className="legend-shadow" /> In Earth's shadow
      </p>
    </div>
  );
}

/** The panel's content (unit tests render it through LayerToggles). */
function LayersPanel() {
  const actions = useActions();
  const gibs = useAppState((s) => s.data.gibs);
  const stations = useAppState((s) => s.data.gp.stations.status);
  const visual = useAppState((s) => s.data.gp.visual.status);
  const starlink = useAppState((s) => s.data.gp.starlink.status);
  const starlinkOn = useAppState((s) => s.layers.starlink);
  const horizonStatus = useAppState(selectHorizonStatus);
  const calibrationOpen = useAppState((s) => s.ui.panel === "calibration");
  // Trails are not drawn while reduced motion is on (README Accessibility rule 2); the setting itself is kept.
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const noImagery = gibs !== "ready";
  return (
    <>
      <h2 className="popover-title">Layers</h2>
      <fieldset className="layer-group">
        <legend>On the video</legend>
        <LayerSwitch
          layer="satellites"
          label="Satellites"
          kind="satellite"
          status={loadText([stations, visual])}
        />
        <GatedSwitch
          layer="starlink"
          label="Starlink"
          kind="starlink"
          status={loadText([starlink]) ?? (starlinkOn ? "Also on the map" : "A 4.7 MB download")}
        />
        <LayerSwitch layer="stars" label="Stars" kind="star" />
        <LayerSwitch layer="planets" label="Planets and Moon" kind="planet" />
        <LayerSwitch
          layer="trails"
          label="Trails"
          status={reducedMotion ? "Off while reduced motion is on" : undefined}
        />
        <GatedSwitch layer="grid" label="Grid lines" />
        <LayerSwitch
          layer="horizon"
          label="Horizon line"
          status={
            horizonStatus === "loading"
              ? "Loading…"
              : horizonStatus === "error"
                ? "Couldn't load the mountains"
                : null
          }
        />
      </fieldset>
      <fieldset className="layer-group">
        <legend>On the map</legend>
        {/* [M7] Also described by GroundView's caption (id "goes-status") while it is on. */}
        <LayerSwitch
          layer="goesIr"
          label="Cloud imagery (10 min)"
          disabled={noImagery}
          status={gibsStatusText(gibs)}
        />
        <LayerSwitch layer="hillshade" label="Terrain shading" />
        <FootprintControls />
        <LayerSwitch layer="tracks" label="Satellite paths" />
      </fieldset>
      <Legend />
      <p className="popover-foot">
        <button
          type="button"
          className="btn-quiet"
          aria-controls={CALIBRATION_DRAWER_ID}
          aria-expanded={calibrationOpen}
          onClick={() => actions.openPanel("calibration")}
        >
          Camera alignment (advanced)
        </button>
      </p>
    </>
  );
}

export function LayerToggles() {
  const actions = useActions();
  const open = useAppState((s) => s.ui.panel === "layers");
  const onOpenChange = useCallback(
    (next: boolean) => {
      // Closing never closes another panel (the drawer) that took ui.panel meanwhile.
      if (next) actions.openPanel("layers");
      else if (store.getState().ui.panel === "layers") actions.openPanel(null);
    },
    [actions],
  );
  return (
    <Popover
      label="Layers"
      title="Layers"
      open={open}
      onOpenChange={onOpenChange}
      className="layers"
      buttonClassName="header-button"
      id="layers-panel"
    >
      <LayersPanel />
    </Popover>
  );
}
