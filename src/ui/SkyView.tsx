// src/ui/SkyView.tsx — the sky map container, its lifecycle, its load states and its text alternative (M2 step 9), the
// satellite list and the hover card's portal (M3 step 13). Imports no OpenLayers module (README import rule 4).
// Layout and look are visual design, settled from screenshots.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BODY_IDS, BODY_STRIDE } from "../domain/astro";
import { wrap360 } from "../domain/geo";
import { registerMap } from "../map/registry";
import { createSkyMap } from "../map/sky/createSkyMap";
import { bodyLabel } from "../map/sky/layers/bodies";
import { skySatelliteList } from "../map/sky/layers/satellites";
import { bindLayerVisible } from "../map/sync/bindLayers";
import { bindSelection } from "../map/sync/bindSelection";
import { bindSkyCamera } from "../map/sync/bindSkyCamera";
import { registerFrameUpdater } from "../state/clockLoop";
import { ephemeris, indexOfObjectId } from "../state/ephemeris";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectActiveCamera } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import type { LoadStatus, SatId } from "../state/types";
import { HoverCard } from "./HoverCard";

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
): { items: SatelliteItem[]; starlinkCount: number } | null {
  const { frame, catalog } = ephemeris;
  const list = skySatelliteList(frame, catalog, selectedIndex, satellitesOn, starlinkOn);
  if (list === null) return null;
  const items = list.indices.map((i): SatelliteItem => {
    const noradId = catalog.noradIds[i] ?? 0;
    const az = wrap360(Math.round(frame.azAltDeg[2 * i] ?? 0));
    const alt = Math.round(frame.azAltDeg[2 * i + 1] ?? 0);
    const lit = ((frame.flags[i] ?? 0) & 2) !== 0 ? "sunlit" : "in shadow";
    const name = catalog.names[i] ?? `NORAD ${noradId}`;
    return {
      noradId,
      id: `sat:${noradId}`,
      text: `${name}, NORAD ${noradId}, az ${az}°, alt ${alt}°, ${lit}`,
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

export function SkyView() {
  useTick4Hz(); // the lists read skyCache and ephemeris during render (React rule 5)
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const satellitesHeadingId = useId();
  const [hoverElement, setHoverElement] = useState<HTMLElement | null>(null);
  const actions = useActions();
  const stars = useAppState((s) => s.data.stars);
  const cameraName = useAppState((s) => selectActiveCamera(s)?.name ?? null);
  const selectedId = useAppState((s) => s.selection.selectedId);
  const satellitesOn = useAppState((s) => s.layers.satellites);
  const starlinkOn = useAppState((s) => s.layers.starlink);
  const stationsStatus = useAppState((s) => s.data.gp.stations.status);
  const visualStatus = useAppState((s) => s.data.gp.visual.status);
  const starlinkStatus = useAppState((s) => s.data.gp.starlink.status);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // A new map and new layers on every run: StrictMode runs mount, cleanup, mount in development.
    const sky = createSkyMap(el, store, skyCache);
    setHoverElement(sky.hoverElement);
    const cleanup = registerMap("sky", sky.map, [
      bindSkyCamera(store, sky),
      bindLayerVisible(store, "stars", sky.starsLayer),
      bindLayerVisible(store, "planets", sky.bodiesLayer),
      bindLayerVisible(store, "grid", sky.gridLayer),
      bindLayerVisible(store, "satellites", sky.satellitesLayer),
      bindLayerVisible(store, "starlink", sky.starlinkLayer),
      bindLayerVisible(store, "trails", sky.trailsLayer),
      bindSelection(store, sky.setSelection),
      registerFrameUpdater(sky.updateFrame),
    ]);
    return () => {
      setHoverElement(null);
      cleanup();
    };
  }, []);

  const statusText =
    stars === "loading"
      ? "Loading star catalogue"
      : stars === "error"
        ? "Star catalogue failed to load"
        : null;
  const above = bodiesAboveHorizon(skyCache.bodies);
  const selectedIndex = selectedId === null ? null : indexOfObjectId(selectedId);
  const satellites = satellitesAboveHorizon(selectedIndex, satellitesOn, starlinkOn);
  const satellitesText = satelliteStatusText(stationsStatus, visualStatus);
  const starlinkCount =
    starlinkOn && starlinkStatus === "ready" && satellites !== null
      ? satellites.starlinkCount
      : null;

  return (
    <section
      aria-label={`Computed sky${cameraName === null ? "" : ` for ${cameraName}`}: zenith fisheye, north up, east left`}
      aria-busy={stars !== "ready" && stars !== "error"}
    >
      <div role="status">{statusText}</div>
      <div ref={ref} data-map="sky" style={MAP_STYLE} />
      {hoverElement === null ? null : createPortal(<HoverCard />, hoverElement)}
      <h3 id={headingId}>Above the horizon</h3>
      <ul aria-labelledby={headingId}>
        {above?.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
      {above !== null && above.length === 0 ? (
        <p>No Sun, Moon or planets above the horizon</p>
      ) : null}
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
    </section>
  );
}
