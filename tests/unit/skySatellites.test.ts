import MultiLineString from "ol/geom/MultiLineString";
import type MultiPoint from "ol/geom/MultiPoint";
import { describe, expect, it } from "vitest";
import { apparentAltDeg } from "../../src/domain/astro";
import {
  createCameraModel,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
  toSkyMapCoord,
} from "../../src/domain/camera";
import { azAltToEnuUnit } from "../../src/domain/geo";
import {
  CLASS_COUNT,
  createSkySatellites,
  LineWriter,
  skySatelliteList,
  TRAIL_MS,
  trackedSkyIndices,
  writeSkySatellites,
  writeTrails,
} from "../../src/map/sky/layers/satellites";
import type { SkyPathOut } from "../../src/workers/protocol";
import { type FakeSat, fakeCatalog, fakeFrame } from "../helpers/satFrame";

const T = Date.parse("2026-10-11T15:09:50Z");
const model = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

/** Map coordinate of an apparent az/alt through the model, or null when culled. */
function mapXy(azDeg: number, altDeg: number): [number, number] | null {
  const uv = new Float64Array(2);
  if (!projectAzAltDeg(model, azDeg, altDeg, uv, 0)) return null;
  const out = [0, 0];
  toSkyMapCoord(model, uv[0] ?? 0, uv[1] ?? 0, out, 0);
  return [out[0] ?? 0, out[1] ?? 0];
}

const SATS: FakeSat[] = [
  { norad: 25544, name: "ISS (ZARYA)", group: 0, azDeg: 124, altDeg: 29 }, // 0 the ISS
  { norad: 19046, name: "SL-3 R/B", group: 1, azDeg: 200, altDeg: 20, sunlit: false }, // 1 shadowed
  { norad: 10114, name: "SL-3 R/B", group: 1, azDeg: 10, altDeg: -2 }, // 2 below the horizon
  { norad: 44713, name: "STARLINK-1007", group: 2, azDeg: 300, altDeg: 50 }, // 3 Starlink
  { norad: 36086, name: "POISK", group: 0, azDeg: 124, altDeg: 29, dockedWith: 25544 }, // 4 docked
  { norad: 22222, name: "DECAYED", group: 1, azDeg: 0, altDeg: 40, valid: false }, // 5 no position
  { norad: 33333, name: "SELECTED", group: 1, azDeg: 45, altDeg: 60 }, // 6 selected
  { norad: 44444, name: "HOVERED", group: 1, azDeg: 90, altDeg: 40 }, // 7 hovered
  { norad: 55555, name: "PLAIN", group: 1, azDeg: 270, altDeg: 70 }, // 8 a plain visual satellite
];
const IDS = { iss: 0, selected: 6, hovered: 7 } as const;

const points = (g: MultiPoint | undefined): number[] =>
  g === undefined ? [] : [...g.getFlatCoordinates()];

describe("writeSkySatellites", () => {
  it("projects every valid, undocked object above the horizon and keeps the picking arrays", () => {
    const sats = createSkySatellites();
    writeSkySatellites(sats, model, fakeFrame(SATS, T), fakeCatalog(SATS), IDS, true, false);
    expect(sats.count).toBe(SATS.length);
    expect(Array.from(sats.projected.subarray(0, 9))).toEqual([1, 1, 0, 1, 0, 0, 1, 1, 1]);
    // Pickable: drawn. Starlink is off, so index 3 is projected but not pickable.
    expect(Array.from(sats.skip.subarray(0, 9))).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0]);
    const iss = mapXy(124, 29);
    expect(sats.xy[0]).toBeCloseTo(iss?.[0] ?? Number.NaN, 9);
    expect(sats.xy[1]).toBeCloseTo(iss?.[1] ?? Number.NaN, 9);
  });

  it("writes the classes of the visible layers, leaving out the ISS, the selected and the hovered objects", () => {
    const sats = createSkySatellites();
    expect(sats.classes.length).toBe(CLASS_COUNT);
    writeSkySatellites(sats, model, fakeFrame(SATS, T), fakeCatalog(SATS), IDS, true, false);
    const [stationsLit, stationsShadow, visualLit, visualShadow, starlinkLit, starlinkShadow] =
      sats.classes;
    // Nothing of a class is in its source until it has points: never a placeholder at 0, 0.
    expect(stationsLit?.source.hasFeature(stationsLit.feature)).toBe(false);
    expect(stationsShadow?.source.hasFeature(stationsShadow.feature)).toBe(false);
    expect(points(visualShadow?.feature.getGeometry())).toEqual(mapXy(200, 20));
    expect(points(visualLit?.feature.getGeometry())).toEqual(mapXy(270, 70));
    expect(starlinkLit?.source.hasFeature(starlinkLit.feature)).toBe(false);
    expect(starlinkShadow?.source.hasFeature(starlinkShadow.feature)).toBe(false);

    writeSkySatellites(sats, model, fakeFrame(SATS, T), fakeCatalog(SATS), IDS, true, true);
    expect(points(starlinkLit?.feature.getGeometry())).toEqual(mapXy(300, 50));
    expect(sats.skip[3]).toBe(0);
  });

  it("keeps the lit and shadowed classes apart in shape, not only in colour", () => {
    const sats = createSkySatellites();
    const [lit, shadowed] = sats.classes;
    const litImage = lit?.style.getImage();
    const shadowImage = shadowed?.style.getImage();
    expect(litImage?.constructor.name).not.toBe(shadowImage?.constructor.name);
  });

  it("with the satellites layer off, only the selected satellite stays pickable", () => {
    const sats = createSkySatellites();
    writeSkySatellites(sats, model, fakeFrame(SATS, T), fakeCatalog(SATS), IDS, false, false);
    expect(Array.from(sats.skip.subarray(0, 9))).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1]);
    for (const c of sats.classes) expect(c.source.getFeatures()).toEqual([]);
  });

  it("draws and picks nothing before the first ready frame", () => {
    const sats = createSkySatellites();
    writeSkySatellites(sats, model, fakeFrame(SATS, T), fakeCatalog(SATS), IDS, true, true);
    writeSkySatellites(sats, model, fakeFrame(SATS, T, false), fakeCatalog(SATS), IDS, true, true);
    expect(sats.count).toBe(0);
    for (const c of sats.classes) expect(c.source.getFeatures()).toEqual([]);
  });

  it("fires no change when nothing moved, so a paused sky is not redrawn", () => {
    const sats = createSkySatellites();
    const frame = fakeFrame(SATS, T);
    const catalog = fakeCatalog(SATS);
    writeSkySatellites(sats, model, frame, catalog, IDS, true, false);
    let changes = 0;
    for (const c of sats.classes) c.source.on("change", () => changes++);
    for (const c of sats.classes) c.feature.getGeometry()?.on("change", () => changes++);
    writeSkySatellites(sats, model, frame, catalog, IDS, true, false);
    expect(changes).toBe(0);
  });

  it("grows its arrays with the catalog", () => {
    const sats = createSkySatellites(2);
    writeSkySatellites(sats, model, fakeFrame(SATS, T), fakeCatalog(SATS), IDS, true, false);
    expect(sats.xy.length).toBeGreaterThanOrEqual(2 * SATS.length);
    expect(sats.projected[8]).toBe(1);
  });
});

describe("trackedSkyIndices", () => {
  it("is the selected satellite first, then every drawn stations/visual satellite, capped", () => {
    const sats = createSkySatellites();
    const catalog = fakeCatalog(SATS);
    writeSkySatellites(sats, model, fakeFrame(SATS, T), catalog, IDS, true, true);
    const out = new Int32Array(100);
    let n = trackedSkyIndices(sats, catalog, 6, true, true, out, 100);
    expect(Array.from(out.subarray(0, n))).toEqual([6, 0, 1, 7, 8]); // no Starlink, docked or culled rows
    n = trackedSkyIndices(sats, catalog, 3, true, true, out, 3);
    expect(Array.from(out.subarray(0, n))).toEqual([3, 0, 1]); // a selected Starlink is tracked
    n = trackedSkyIndices(sats, catalog, 6, false, true, out, 100);
    expect(Array.from(out.subarray(0, n))).toEqual([6]); // trails off: only the 2-minute path
    n = trackedSkyIndices(sats, catalog, null, false, true, out, 100);
    expect(n).toBe(0);
    n = trackedSkyIndices(sats, catalog, null, true, false, out, 100);
    expect(n).toBe(0); // satellites layer off: nothing is drawn
  });
});

/** A sky path on the 2 s grid through the given apparent az/alt points (geometric alt chosen to match). */
function pathThrough(index: number, firstPointMs: number, azAlt: [number, number][]): SkyPathOut {
  const enu = new Float32Array(3 * azAlt.length);
  const unit = new Float64Array(3);
  azAlt.forEach(([az, alt], j) => {
    // Invert the refraction closely enough for the test: apparent ≈ geometric + R(geometric).
    let geo = alt;
    for (let k = 0; k < 5; k++) geo = alt - (apparentAltDeg(geo) - geo);
    azAltToEnuUnit(az, geo, unit, 0);
    for (let c = 0; c < 3; c++) enu[3 * j + c] = (unit[c] ?? 0) * 1000;
  });
  return { index, firstPointMs, enuKm: enu };
}

describe("writeTrails and LineWriter", () => {
  it("draws the last 30 s of each tracked path ending at the current position, split where culled", () => {
    const sats = createSkySatellites();
    const catalog = fakeCatalog(SATS);
    writeSkySatellites(sats, model, fakeFrame(SATS, T), catalog, IDS, true, false);
    // Index 1: points every 2 s from T − 40 s to T + 4 s; the one at T − 10 s is below the horizon.
    const first = T - 40_000;
    const azAlt: [number, number][] = [];
    for (let t = first; t <= T + 4_000; t += 2_000) azAlt.push([200, t === T - 10_000 ? -1 : 20]);
    const paths = new Map([[1, pathThrough(1, first, azAlt)]]);
    const geometry = new MultiLineString([], "XY", []);
    const tracked = Int32Array.from([1]);
    expect(writeTrails(new LineWriter(geometry), sats, model, paths, tracked, 1, T)).toBe(true);
    // In [T − 30 s, T): 15 grid points, the one at T − 10 s culled → runs of 10 and 4 + the current position.
    const ends = geometry.getEnds();
    expect(ends).toEqual([2 * 10, 2 * 10 + 2 * 5]);
    const flat = geometry.getFlatCoordinates();
    expect(flat[flat.length - 2]).toBe(sats.xy[2]);
    expect(flat[flat.length - 1]).toBe(sats.xy[3]);
    expect(TRAIL_MS).toBe(30_000);
    // Unchanged input: no change event.
    let changes = 0;
    geometry.on("change", () => changes++);
    expect(writeTrails(new LineWriter(geometry), sats, model, paths, tracked, 1, T)).toBe(false);
    expect(changes).toBe(0);
  });

  it("drops runs shorter than two points and empties the geometry when nothing is tracked", () => {
    const geometry = new MultiLineString([], "XY", []);
    const writer = new LineWriter(geometry);
    writer.begin();
    writer.point(1, 1);
    writer.breakRun();
    writer.point(2, 2);
    writer.point(3, 3);
    writer.point(4, 4);
    writer.breakRun();
    writer.point(5, 5);
    expect(writer.end()).toBe(true);
    expect(geometry.getEnds()).toEqual([6]);
    expect(geometry.getFlatCoordinates()).toEqual([2, 2, 3, 3, 4, 4]);
    writer.begin();
    expect(writer.end()).toBe(true);
    expect(geometry.getEnds()).toEqual([]);
    expect(geometry.getFlatCoordinates()).toEqual([]);
  });
});

describe("skySatelliteList", () => {
  it("lists drawn stations/visual satellites and the selected one, highest first, and counts Starlink", () => {
    const catalog = fakeCatalog(SATS);
    const frame = fakeFrame(SATS, T);
    const list = skySatelliteList(frame, catalog, null, true, true);
    expect(list?.indices).toEqual([8, 6, 7, 0, 1]); // 70°, 60°, 40°, 29°, 20°
    expect(list?.starlinkCount).toBe(1);
    // A selected Starlink joins the list and leaves the count.
    const withStarlink = skySatelliteList(frame, catalog, 3, true, true);
    expect(withStarlink?.indices).toEqual([8, 6, 3, 7, 0, 1]);
    expect(withStarlink?.starlinkCount).toBe(0);
    // Satellites layer off: only the selected one; Starlink off: no count.
    expect(skySatelliteList(frame, catalog, 7, false, false)).toEqual({
      indices: [7],
      starlinkCount: 0,
    });
    expect(skySatelliteList(fakeFrame(SATS, T, false), catalog, null, true, true)).toBeNull();
  });
});
