// src/ui/GroundView.tsx — the ground map container, its lifecycle and its load states (M1 step 13).
// Imports no OpenLayers module (README import rule 4).
import { useEffect, useRef } from "react";
import { createGroundMap } from "../map/ground/createGroundMap";
import { getGibsCapabilities } from "../map/ground/layers/gibs";
import { useAppState } from "../state/hooks";
import { selectActiveCamera } from "../state/selectors";
import { store } from "../state/store";
import { gibsStatusText } from "./gibsStatus";

/** A container needs a non-zero size: a zero-size map requests no tiles (Gotcha 15). */
const MAP_STYLE = { height: "60vh", minHeight: "256px" } as const;

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
  return (
    <div>
      {cameras === "error" ? (
        <div role="status">
          <p>Camera list failed to load</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : cameras !== "ready" ? (
        <p role="status">Loading cameras…</p>
      ) : null}
      {gibsText === null ? null : <p role="status">{gibsText}</p>}
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
        style={MAP_STYLE}
      />
    </div>
  );
}
