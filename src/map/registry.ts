// src/map/registry.ts — the one implementation of the map lifecycle cleanup (README Map lifecycle, steps 1–3).
import type OlMap from "ol/Map";

export type MapId = "ground" | "sky";

export const registry = new Map<MapId, OlMap>();

/**
 * Registers the map and returns its cleanup: run every disposer (binding unsubscribes, frame-updater
 * unregisters), dispose every layer, map.dispose(), and delete the entry only if it still points at this map.
 */
export function registerMap(
  id: MapId,
  map: OlMap,
  disposers: ReadonlyArray<() => void>,
): () => void {
  registry.set(id, map);
  return () => {
    for (const dispose of disposers) dispose();
    for (const layer of map.getAllLayers()) layer.dispose();
    map.dispose(); // also clears the target; it does not dispose layers
    if (registry.get(id) === map) registry.delete(id);
  };
}

/** Called by clockLoop.ts on frames where the sim time changed. */
export function renderSyncAll(): void {
  for (const map of registry.values()) map.renderSync();
}
