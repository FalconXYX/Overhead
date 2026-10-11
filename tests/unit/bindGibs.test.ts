import { getTopLeft } from "ol/extent";
import { get as getProjection } from "ol/proj";
import { TileSourceEvent } from "ol/source/Tile";
import WMTS from "ol/source/WMTS";
import Tile from "ol/Tile";
import TileState from "ol/TileState";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import { describe, expect, it } from "vitest";
import { bindTrueColorDate } from "../../src/map/sync/bindGibs";
import type { AppStore } from "../../src/state/store";
import { storeAt } from "../helpers/store";

const EPSG3857 = getProjection("EPSG:3857");
if (EPSG3857 === null) throw new Error("EPSG:3857 is always defined");
const extent = EPSG3857.getExtent();
if (extent === null) throw new Error("EPSG:3857 has an extent");

/** A real WMTS source from options (no DOM): Level9-like grid, KVP, image/jpeg, Time 2026-10-08. */
function trueColorSource(): WMTS {
  const zooms = Array.from({ length: 10 }, (_, z) => z);
  return new WMTS({
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?",
    layer: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    matrixSet: "GoogleMapsCompatible_Level9",
    format: "image/jpeg",
    style: "default",
    requestEncoding: "KVP",
    projection: EPSG3857 ?? undefined,
    tileGrid: new WMTSTileGrid({
      origin: getTopLeft(extent ?? [0, 0, 0, 0]),
      resolutions: zooms.map((z) => 156543.03392804097 / 2 ** z),
      matrixIds: zooms.map(String),
    }),
    dimensions: { Time: "2026-10-08" },
  });
}

function setup(): { store: AppStore; source: WMTS; changes: () => number; unbind: () => void } {
  const store = storeAt("2026-10-10T03:30:00Z");
  const source = trueColorSource();
  let count = 0;
  source.on("change", () => {
    count += 1;
  });
  const unbind = bindTrueColorDate(store, source);
  return { store, source, changes: () => count, unbind };
}

const time = (source: WMTS): unknown => source.getDimensions().Time;

function steps(store: AppStore, n: number, deltaMs: number): void {
  for (let i = 0; i < n; i += 1) store.getState().actions.stepBy(deltaMs);
}

function dispatch(source: WMTS, type: "tileloadend" | "tileloaderror", key: string): void {
  const tile = new Tile([5, 2, 14], TileState.LOADED);
  tile.key = key;
  source.dispatchEvent(new TileSourceEvent(type, tile));
}

describe("bindTrueColorDate", () => {
  it("changes Time once per date and stops after unbind", () => {
    const { store, source, changes, unbind } = setup();
    expect(changes()).toBe(0); // the immediate call with the same date is a no-op
    steps(store, 30, 60_000);
    expect(changes()).toBe(1);
    expect(time(source)).toBe("2026-10-09");
    const url = source.getTileUrlFunction()([5, 2, 14], 1, EPSG3857 ?? undefined) ?? "";
    expect(url.endsWith("&Time=2026-10-09")).toBe(true);
    expect(url).toContain("layer=VIIRS_NOAA20_CorrectedReflectance_TrueColor");
    unbind();
    steps(store, 30, -60_000);
    expect(changes()).toBe(1);
    expect(time(source)).toBe("2026-10-09");
  });

  it("reverts to the last Time that loaded a tile when the current Time fails", () => {
    const { store, source } = setup();
    dispatch(source, "tileloadend", source.getKey()); // 2026-10-08 loads
    const oldKey = source.getKey();
    steps(store, 30, 60_000);
    expect(time(source)).toBe("2026-10-09");
    dispatch(source, "tileloaderror", oldKey); // a late error from the old Time changes nothing
    expect(time(source)).toBe("2026-10-09");
    dispatch(source, "tileloaderror", source.getKey());
    expect(time(source)).toBe("2026-10-08");
  });

  it("an error on the first Time with nothing loaded leaves Time unchanged", () => {
    const { source } = setup();
    dispatch(source, "tileloaderror", source.getKey());
    expect(time(source)).toBe("2026-10-08");
  });

  it("an error on the Time that last loaded changes nothing", () => {
    const { source } = setup();
    dispatch(source, "tileloadend", source.getKey());
    dispatch(source, "tileloaderror", source.getKey());
    expect(time(source)).toBe("2026-10-08");
  });

  it("never returns to a failed Time after a revert", () => {
    const { store, source } = setup();
    dispatch(source, "tileloadend", source.getKey());
    steps(store, 30, 60_000);
    dispatch(source, "tileloaderror", source.getKey()); // 2026-10-09 fails: back to 2026-10-08
    expect(time(source)).toBe("2026-10-08");
    steps(store, 30, -60_000); // the selector gives 2026-10-08
    expect(time(source)).toBe("2026-10-08");
    steps(store, 30, 60_000); // the selector gives 2026-10-09 again
    expect(time(source)).toBe("2026-10-08");
  });

  it("never returns to a first Time that failed once a later Time loaded", () => {
    const { store, source } = setup();
    dispatch(source, "tileloaderror", source.getKey()); // 2026-10-08 fails, nothing to go back to
    expect(time(source)).toBe("2026-10-08");
    steps(store, 30, 60_000);
    expect(time(source)).toBe("2026-10-09");
    dispatch(source, "tileloadend", source.getKey()); // 2026-10-09 loads
    steps(store, 30, -60_000); // the selector gives 2026-10-08 again
    expect(time(source)).toBe("2026-10-09");
  });
});
