// src/map/sync/bindHillshade.ts — the hillshade's style variables (M6 step 11, README section 9 rule 6): the true
// ground size of a texel on moveend and whenever the tile zoom changes, and the Sun at the active site at most once
// per second.

import type WebGLTileLayer from "ol/layer/WebGLTile";
import type OlMap from "ol/Map";
import { unByKey } from "ol/Observable";
import { toLonLat } from "ol/proj";
import type ImageTile from "ol/source/ImageTile";
import { shallow } from "zustand/vanilla/shallow";
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
} from "../../domain/astro";
import { texelGroundM } from "../../domain/terrain";
import { selectSite } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import { NIGHT_SUN_ALT_DEG, NIGHT_SUN_AZ_DEG } from "../ground/layers/hillshade";

/** The Sun variables are pushed at most once per this many ms of wall time (leading and trailing). */
export const HILLSHADE_SUN_INTERVAL_MS = 1000;

/**
 * Keeps texelGroundM equal to the ground size of one texel of the tiles OpenLayers is drawing. The one binding that
 * takes no store (README binding rule 1). Pushes once when bound, on moveend, and during a zoom only when the tile
 * zoom changes: getZForResolution with the source's zDirection, the call the WebGL renderer makes. The tile zoom
 * switches at z + 0.415, so never derive it with Math.round.
 */
export function bindHillshadeTexel(
  map: OlMap,
  layer: Pick<WebGLTileLayer, "updateStyleVariables">,
  source: ImageTile,
): () => void {
  const view = map.getView();
  const grid = source.getTileGrid();
  let lastZ = Number.NaN;
  const push = (force: boolean): void => {
    const resolution = view.getResolution();
    const center = view.getCenter();
    if (grid === null || resolution === undefined || center === undefined) return;
    const z = grid.getZForResolution(resolution, source.zDirection);
    if (!force && z === lastZ) return;
    lastZ = z;
    layer.updateStyleVariables({ texelGroundM: texelGroundM(z, toLonLat(center)[1] ?? 0) });
  };
  const keys = [
    view.on("change:resolution", () => push(false)),
    map.on("moveend", () => push(true)),
  ];
  push(true);
  return () => unByKey(keys);
}

/**
 * Lights the hillshade with the Sun at the active camera's site (computeBodies: azimuth and apparent altitude). Below
 * 0° it pushes the fixed 315°/45° night lighting (GroundView shows the night badge). While layers.hillshade is off it
 * does nothing and cancels a pending push. Throttled on performance.now(), leading and trailing: at once when
 * HILLSHADE_SUN_INTERVAL_MS has passed since the last push, else one push at the end of that interval, which reads
 * store.getState() when it runs, so the last state always lands.
 */
export function bindHillshadeSun(
  store: AppStore,
  layer: Pick<WebGLTileLayer, "updateStyleVariables">,
): () => void {
  const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE); // allocated once
  let lastPushMs = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const push = (): void => {
    timer = null;
    const state = store.getState();
    const site = selectSite(state);
    if (!state.layers.hillshade || site === null) return;
    lastPushMs = performance.now();
    computeBodies(astroTimeAt(state.clock.simTimeMs), makeObserver(site), bodies);
    const azDeg = bodies[0] ?? Number.NaN; // the Sun is body 0
    const altDeg = bodies[1] ?? Number.NaN;
    layer.updateStyleVariables(
      altDeg >= 0
        ? { sunAzDeg: azDeg, sunAltDeg: altDeg }
        : { sunAzDeg: NIGHT_SUN_AZ_DEG, sunAltDeg: NIGHT_SUN_ALT_DEG },
    );
  };

  const unsubscribe = store.subscribe(
    // The active site too: the registry's arrival, or a clip from another site (local-replay), relights it.
    (s) => [s.clock.simTimeMs, s.camera.activeId, s.layers.hillshade, selectSite(s)] as const,
    ([, , on, site]) => {
      if (!on) {
        cancel();
        return;
      }
      if (site === null) return; // the active camera is not in the registry
      if (timer !== null) return; // the trailing push will read the latest state
      const waitMs = lastPushMs + HILLSHADE_SUN_INTERVAL_MS - performance.now();
      if (waitMs <= 0) push();
      else timer = setTimeout(push, waitMs);
    },
    { equalityFn: shallow, fireImmediately: true },
  );

  return () => {
    unsubscribe();
    cancel();
  };
}
