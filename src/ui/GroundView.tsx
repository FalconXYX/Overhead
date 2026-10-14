// src/ui/GroundView.tsx — the ground map container, its lifecycle and its load states (M1 step 13), the GOES
// caption (M7 step 7) and the hillshade's night badge (M6 step 11.4). [Redesign] Beside the video, smaller (spec
// section 2); layout only.
// Imports no OpenLayers module (README import rule 4).
import { useEffect, useRef } from "react";
import { createGroundMap } from "../map/ground/createGroundMap";
import { getGibsCapabilities } from "../map/ground/layers/gibs";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera, selectGoesLabel } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import { gibsStatusText } from "./gibsStatus";

/**
 * [M7] The GOES caption ("Imagery as of 09:50 UTC"), on screen whenever the layer is on, whether or not the Layers
 * panel is open. Re-rendered by the 4 Hz ticker and read during render: a useAppState(selectGoesStepMs) subscription
 * would add a React commit per step outside the ticker. No aria-live: at 600× the text changes every second.
 */
function GoesCaption() {
  useTick4Hz();
  const label = selectGoesLabel(store.getState());
  return label === null ? null : (
    <p id="goes-status" data-testid="goes-asof">
      {label}
    </p>
  );
}

/**
 * [M6] While the hillshade is on and the Sun is below 0° at the site, the relief uses fixed lighting from 315° at 45°
 * (NIGHT_SUN_AZ_DEG and NIGHT_SUN_ALT_DEG in hillshade.ts): say so. The Sun's apparent altitude is skyCache's body 0,
 * read during the 4 Hz render; NaN before the first sky pass shows nothing.
 */
function NightBadge() {
  useTick4Hz();
  const on = useAppState((s) => s.layers.hillshade);
  const sunAltDeg = skyCache.bodies[1] ?? Number.NaN;
  return on && sunAltDeg < 0 ? <p>Night: the terrain shading uses a fixed light</p> : null;
}

export function GroundView() {
  const ref = useRef<HTMLDivElement>(null);
  const cameras = useAppState((s) => s.data.cameras);
  const gibs = useAppState((s) => s.data.gibs);
  const cameraName = useAppState((s) => selectActiveCamera(s)?.name ?? null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || cameras !== "ready" || (gibs !== "ready" && gibs !== "error")) return;
    // A new map on every run: StrictMode runs mount, cleanup, mount in development.
    return createGroundMap(el, store, gibs === "ready" ? getGibsCapabilities() : null);
  }, [cameras, gibs]);

  const gibsText = gibsStatusText(gibs);
  // [M9] Layout in src/app/layout.css: the map fills the pane (a container needs a non-zero size: a zero-size map
  // requests no tiles, Gotcha 15), and the GOES caption and night badge sit over its bottom-left corner. [Redesign]
  // The load states float over the map's top edge, so the map never shifts.
  return (
    <div className="ground">
      {cameras === "error" ? (
        <div role="status" className="ground-status">
          <p>Camera list failed to load</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : cameras !== "ready" ? (
        <p role="status" className="ground-status">
          Loading cameras…
        </p>
      ) : null}
      {gibsText === null ? null : (
        <p role="status" className="ground-status">
          {gibsText}
        </p>
      )}
      <div
        ref={ref}
        data-map="ground"
        role="application"
        aria-roledescription="map"
        aria-label={
          cameraName === null
            ? "Ground map around the camera site"
            : `Ground map around the camera site: ${cameraName}`
        }
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so OpenLayers KeyboardPan and KeyboardZoom work
        tabIndex={0}
        className="ground-map"
      />
      <div className="ground-badges">
        <GoesCaption />
        <NightBadge />
      </div>
    </div>
  );
}
