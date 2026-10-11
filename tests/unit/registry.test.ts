import type OlMap from "ol/Map";
import { afterEach, describe, expect, it } from "vitest";
import { registerMap, registry, renderSyncAll } from "../../src/map/registry";

/** Enough of an OpenLayers map for the registry: layers, dispose and renderSync, all logged. */
function fakeMap(name: string, log: string[]): OlMap {
  const layer = { dispose: () => log.push(`${name}:layer.dispose`) };
  return {
    getAllLayers: () => [layer],
    dispose: () => log.push(`${name}:map.dispose`),
    renderSync: () => log.push(`${name}:renderSync`),
  } as unknown as OlMap;
}

afterEach(() => {
  registry.clear();
});

describe("registerMap", () => {
  it("cleans up in order and never removes a newer map", () => {
    const log: string[] = [];
    const first = fakeMap("first", log);
    const second = fakeMap("second", log);
    const cleanupFirst = registerMap("ground", first, [() => log.push("first:unbind")]);
    expect(registry.get("ground")).toBe(first);
    const cleanupSecond = registerMap("ground", second, [() => log.push("second:unbind")]);

    cleanupFirst();
    expect(log).toEqual(["first:unbind", "first:layer.dispose", "first:map.dispose"]);
    expect(registry.get("ground")).toBe(second);

    log.length = 0;
    renderSyncAll();
    expect(log).toEqual(["second:renderSync"]);

    log.length = 0;
    cleanupSecond();
    expect(log).toEqual(["second:unbind", "second:layer.dispose", "second:map.dispose"]);
    expect(registry.size).toBe(0);
  });

  it("renderSyncAll reaches every registered map", () => {
    const log: string[] = [];
    const cleanups = [
      registerMap("ground", fakeMap("ground", log), []),
      registerMap("sky", fakeMap("sky", log), []),
    ];
    renderSyncAll();
    expect(log.sort()).toEqual(["ground:renderSync", "sky:renderSync"]);
    for (const cleanup of cleanups) cleanup();
    expect(registry.size).toBe(0);
  });
});
