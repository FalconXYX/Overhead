// src/ui/SkyView.tsx — the sky map container, its lifecycle, its load states and its text alternative (M2 step 9).
// Imports no OpenLayers module (README import rule 4). Layout and look are visual design, settled from screenshots.
import { useEffect, useId, useRef } from "react";
import { BODY_IDS, BODY_STRIDE } from "../domain/astro";
import { wrap360 } from "../domain/geo";
import { registerMap } from "../map/registry";
import { createSkyMap } from "../map/sky/createSkyMap";
import { bodyLabel } from "../map/sky/layers/bodies";
import { bindLayerVisible } from "../map/sync/bindLayers";
import { bindSkyCamera } from "../map/sync/bindSkyCamera";
import { registerFrameUpdater } from "../state/clockLoop";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";

/** A map target needs a non-zero size (M1 gotcha 15); the frame is fitted inside it, whatever its shape. */
const MAP_STYLE = { height: "60vh", minHeight: "256px" } as const;

interface BodyItem {
  readonly id: string;
  readonly text: string;
}

/** Bodies at apparent alt ≥ 0, in BODY_IDS order, e.g. "Saturn, az 120°, alt 58°"; null before the first pass. */
function bodiesAboveHorizon(bodies: Float64Array): BodyItem[] | null {
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
    items.push({ id, text: `${label}, az ${azRounded}°, alt ${Math.round(alt)}°` });
  }
  return computed ? items : null;
}

export function SkyView() {
  useTick4Hz(); // the list reads skyCache.bodies during render (React rule 5)
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const stars = useAppState((s) => s.data.stars);
  const cameraName = useAppState((s) => selectActiveCamera(s)?.name ?? null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // A new map and new layers on every run: StrictMode runs mount, cleanup, mount in development.
    const sky = createSkyMap(el, store, skyCache);
    return registerMap("sky", sky.map, [
      bindSkyCamera(store, sky),
      bindLayerVisible(store, "stars", sky.starsLayer),
      bindLayerVisible(store, "planets", sky.bodiesLayer),
      bindLayerVisible(store, "grid", sky.gridLayer),
      registerFrameUpdater(sky.updateFrame),
    ]);
  }, []);

  const statusText =
    stars === "loading"
      ? "Loading star catalogue"
      : stars === "error"
        ? "Star catalogue failed to load"
        : null;
  const above = bodiesAboveHorizon(skyCache.bodies);

  return (
    <section
      aria-label={`Computed sky${cameraName === null ? "" : ` for ${cameraName}`}: zenith fisheye, north up, east left`}
      aria-busy={stars !== "ready" && stars !== "error"}
    >
      <div role="status">{statusText}</div>
      <div ref={ref} data-map="sky" style={MAP_STYLE} />
      <h3 id={headingId}>Above the horizon</h3>
      <ul aria-labelledby={headingId}>
        {above?.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
      {above !== null && above.length === 0 ? (
        <p>No Sun, Moon or planets above the horizon</p>
      ) : null}
    </section>
  );
}
