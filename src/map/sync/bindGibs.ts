// src/map/sync/bindGibs.ts — the true-colour Time follows the clock (M1 step 12). The binding pattern every later
// binding copies: a primitive selector, shallow, fireImmediately, listeners that only mutate OpenLayers objects,
// and one returned function that removes everything it added.
import { unByKey } from "ol/Observable";
import type WMTS from "ol/source/WMTS";
import { shallow } from "zustand/vanilla/shallow";
import { selectTrueColorDate } from "../../state/selectors";
import type { AppStore } from "../../state/store";

export function bindTrueColorDate(store: AppStore, source: WMTS): () => void {
  let lastGood: string | null = null;
  // OpenLayers never re-requests an errored tile: going back to a failed Time would spin the map.
  const failed = new Set<string>();
  const currentTime = (): unknown => source.getDimensions().Time;
  const keys = [
    source.on("tileloadend", (e) => {
      const time = currentTime();
      // TileImage stamps each tile with the source key at creation: this filters late events from an older Time.
      if (e.tile.key === source.getKey() && typeof time === "string") lastGood = time;
    }),
    source.on("tileloaderror", (e) => {
      const time = currentTime();
      if (e.tile.key !== source.getKey() || typeof time !== "string" || time === lastGood) return;
      failed.add(time);
      if (lastGood !== null) source.updateDimensions({ Time: lastGood });
    }),
  ];
  const unsubscribe = store.subscribe(
    selectTrueColorDate,
    (date) => {
      if (date === null) return;
      // The dimension key must be exactly `Time`; an unchanged value is a no-op.
      source.updateDimensions({ Time: failed.has(date) && lastGood !== null ? lastGood : date });
    },
    { equalityFn: shallow, fireImmediately: true },
  );
  return () => {
    unsubscribe();
    unByKey(keys);
  };
}
