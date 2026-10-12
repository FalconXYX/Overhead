// src/ui/LayerToggles.tsx — the Layers button and panel (M1 step 15). Each toggle lands with its layer: the
// satellite toggles in M3 (step 15.3), "Terrain horizon" with its status and "Hillshade" in M6 (step 13), the
// footprint toggle and its height select in M8 (step 9.1).
import { useId, useSyncExternalStore } from "react";
import { TRUE_COLOR_INSTRUMENT } from "../app/credits";
import { FOOTPRINT_FALLBACK_HEIGHT_KM, FOOTPRINT_PRESETS_KM } from "../domain/camera";
import { heightKmOf, indexOfObjectId } from "../state/ephemeris";
import { footprintStatus } from "../state/footprintStatus";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectHorizonStatus, selectSkyOverVideo, selectTrueColorDate } from "../state/selectors";
import { skyCache, starCountForLimit } from "../state/skyCache";
import { store } from "../state/store";
import type { LayerToggle, LoadStatus, VideoOverlayLayers } from "../state/types";
import { gibsStatusText } from "./gibsStatus";
import {
  FOOTPRINT_HEIGHT_LABEL,
  FOOTPRINT_NOTE,
  FOOTPRINT_NOTHING_TEXT,
  FOOTPRINT_TOGGLE_LABEL,
  selectedHeightOptionText,
} from "./incomingText";
import { groupStatusText, horizonStatusText } from "./objectText";

/** The sky view's toggles (M2), in panel order. */
const SKY_TOGGLES: readonly { key: LayerToggle; label: string }[] = [
  { key: "stars", label: "Stars" },
  { key: "planets", label: "Sun, Moon and planets" },
  { key: "grid", label: "Alt/az grid" },
];

/** "V ≤ 4.5 (904 stars)" once the catalogue is ready. Reads skyCache during render (React rule 5). */
function starLimitText(limit: number, stars: LoadStatus): string {
  if (stars === "ready") {
    const count = starCountForLimit(skyCache.rows, limit);
    return `V ≤ ${limit} (${count} ${count === 1 ? "star" : "stars"})`;
  }
  if (stars === "error") return `V ≤ ${limit} (star catalogue failed to load)`;
  return `V ≤ ${limit} (loading star catalogue)`;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getReducedMotion = (): boolean => window.matchMedia(REDUCED_MOTION).matches;

/**
 * One satellite toggle and, for a data layer, its load status (status undefined: none). The status sits outside the
 * label, so the checkbox's name stays fixed, and is a status region that exists before its text changes, so
 * "Loading…" and the result are each announced once.
 */
function SatelliteToggle(props: { layer: LayerToggle; label: string; status?: string | null }) {
  const actions = useActions();
  const on = useAppState((s) => s.layers[props.layer]);
  const statusId = useId();
  const hasStatus = props.status !== undefined;
  return (
    <p>
      <label>
        <input
          type="checkbox"
          checked={on}
          aria-describedby={hasStatus ? statusId : undefined}
          onChange={() => actions.toggleLayer(props.layer)}
        />
        {props.label}
      </label>
      {hasStatus ? (
        <>
          {" "}
          <span id={statusId} role="status">
            {props.status}
          </span>
        </>
      ) : null}
    </p>
  );
}

/** [M8] The height presets' option labels, in FOOTPRINT_PRESETS_KM order. */
const PRESET_LABELS: Readonly<Record<(typeof FOOTPRINT_PRESETS_KM)[number], string>> = {
  420: "ISS shell (420 km)",
  480: "Starlink shell (480 km)",
};
const FOLLOW_SELECTED = "selected";

/**
 * [M8] "Camera view at orbit height", the height select and the note (step 9.1). Re-renders through useTick4Hz and
 * reads the selected satellite's height and footprintStatus during render (React rule 5). keyboard.ts ignores keys
 * typed into a select, so its arrow keys never move the clock.
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
      <p>
        <label>
          <input
            type="checkbox"
            checked={on}
            aria-describedby={noteId}
            onChange={() => actions.toggleLayer("footprint")}
          />
          {FOOTPRINT_TOGGLE_LABEL}
        </label>{" "}
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
      </p>
      <p id={noteId}>{FOOTPRINT_NOTE}</p>
      {/* Always mounted, so the text is announced when it appears. */}
      <p role="status">{on && footprintStatus.pairCount === 0 ? FOOTPRINT_NOTHING_TEXT : ""}</p>
    </>
  );
}

/** [M5] The "On the video" toggles (README "Sky over video" rule 2), unchecked by default. */
const VIDEO_TOGGLES: readonly { key: keyof VideoOverlayLayers; label: string; note?: string }[] = [
  {
    key: "starlink",
    label: "Starlink on the video",
    note: "Also needs the Starlink layer, which loads the data.",
  },
  { key: "grid", label: "Grid on the video" },
  { key: "denseLabels", label: "All labels on the video" },
];

/** [M5] One "On the video" checkbox, with its note tied by aria-describedby. */
function VideoToggle(props: { layer: keyof VideoOverlayLayers; label: string; note?: string }) {
  const actions = useActions();
  const on = useAppState((s) => s.layers.video[props.layer]);
  const noteId = useId();
  return (
    <p>
      <label>
        <input
          type="checkbox"
          checked={on}
          aria-describedby={props.note === undefined ? undefined : noteId}
          onChange={() => actions.setVideoLayer(props.layer, !on)}
        />
        {props.label}
      </label>
      {props.note === undefined ? null : (
        <>
          {" "}
          <span id={noteId}>{props.note}</span>
        </>
      )}
    </p>
  );
}

/**
 * [M5] Shown while the sky is drawn over a video: the light set's gates, which change only the sky view (the ground
 * map, the worker and the Inspector keep every object).
 */
function VideoToggles() {
  const overVideo = useAppState(selectSkyOverVideo);
  if (!overVideo) return null;
  return (
    <fieldset>
      <legend>On the video</legend>
      {VIDEO_TOGGLES.map(({ key, label, note }) => (
        <VideoToggle key={key} layer={key} label={label} note={note} />
      ))}
    </fieldset>
  );
}

export function LayerToggles() {
  const actions = useActions();
  const open = useAppState((s) => s.ui.panel === "layers");
  const trueColor = useAppState((s) => s.layers.trueColor);
  const coastlines = useAppState((s) => s.layers.coastlines);
  const gibs = useAppState((s) => s.data.gibs);
  const layers = useAppState((s) => s.layers);
  // Re-renders when the catalogue arrives, so the star count follows it.
  const stars = useAppState((s) => s.data.stars);
  const limitText = starLimitText(layers.starMagLimit, stars);
  // The requested date: after a tile-error revert the map may show an earlier one (DECISIONS, M1).
  const date = useAppState(selectTrueColorDate);
  const gibsText = gibsStatusText(gibs);
  const disabled = gibs !== "ready";
  // GroupData objects are replaced only by setGroupData: existing references, safe in useAppState.
  const stations = useAppState((s) => s.data.gp.stations);
  const visual = useAppState((s) => s.data.gp.visual);
  const starlink = useAppState((s) => s.data.gp.starlink);
  const horizonStatus = useAppState(selectHorizonStatus); // [M6]
  // Trails are not drawn while reduced motion is on (README Accessibility rule 2); the setting itself is kept.
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);

  return (
    <div className="layers">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        aria-controls="layers-panel"
        onClick={() => actions.togglePanel("layers")}
      >
        Layers
      </button>
      <section id="layers-panel" className="panel" aria-label="Layers" hidden={!open}>
        {gibsText === null ? null : <p>{gibsText}</p>}
        <p>
          <label>
            <input
              type="checkbox"
              checked={trueColor}
              disabled={disabled}
              onChange={() => actions.toggleLayer("trueColor")}
            />
            {date === null
              ? `True colour (${TRUE_COLOR_INSTRUMENT})`
              : `True colour (${TRUE_COLOR_INSTRUMENT}, ${date})`}
          </label>
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={coastlines}
              disabled={disabled}
              onChange={() => actions.toggleLayer("coastlines")}
            />
            Coastlines and place labels
          </label>
        </p>
        <p>
          <label>
            {/* [M7] Described by GroundView's caption (id "goes-status"), which exists while the layer is on. */}
            <input
              type="checkbox"
              checked={layers.goesIr}
              disabled={disabled}
              aria-describedby="goes-status"
              onChange={() => actions.toggleLayer("goesIr")}
            />
            GOES-West infrared (Band 13, 10 minute)
          </label>
        </p>
        {SKY_TOGGLES.map(({ key, label }) => (
          <p key={key}>
            <label>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => actions.toggleLayer(key)}
              />
              {label}
            </label>
          </p>
        ))}
        <p>
          <label htmlFor="star-mag-limit">Star magnitude limit</label>{" "}
          {/* keyboard.ts ignores keys typed into an input, so the arrow keys move this, not the clock. */}
          <input
            id="star-mag-limit"
            type="range"
            min={1}
            max={6.5}
            step={0.5}
            value={layers.starMagLimit}
            aria-valuetext={limitText}
            onChange={(e) => actions.setStarMagLimit(Number(e.currentTarget.value))}
          />{" "}
          <output htmlFor="star-mag-limit">{limitText}</output>
        </p>
        <SatelliteToggle
          layer="satellites"
          label="Satellites (ISS and brightest)"
          status={groupStatusText([stations, visual])}
        />
        <SatelliteToggle
          layer="starlink"
          label="Starlink (about 11,100; loads 4.7 MB)"
          status={groupStatusText([starlink])}
        />
        <SatelliteToggle
          layer="trails"
          label={reducedMotion ? "Trails (off: reduced motion)" : "Trails"}
        />
        {/* [M6] The toggle hides only the skyline and its fill; visibility always uses a ready profile. */}
        <SatelliteToggle
          layer="horizon"
          label="Terrain horizon"
          status={horizonStatusText(horizonStatus)}
        />
        <SatelliteToggle layer="hillshade" label="Hillshade" />
        <FootprintControls />
        <VideoToggles />
      </section>
    </div>
  );
}
