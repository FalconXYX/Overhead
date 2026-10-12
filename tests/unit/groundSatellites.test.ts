import type Feature from "ol/Feature";
import type MultiPoint from "ol/geom/MultiPoint";
import type WebGLVectorLayer from "ol/layer/WebGLVector";
import type VectorSource from "ol/source/Vector";
import type Style from "ol/style/Style";
import { describe, expect, it } from "vitest";
import {
  createGroundSatellites,
  satelliteWebglStyle,
  writeGroundMarkers,
  writeGroundSatellites,
} from "../../src/map/ground/layers/satellites";
import type { SelectionTargets } from "../../src/map/sky/layers/selection";
import { type FakeSat, fakeCatalog, fakeFrame } from "../helpers/satFrame";

const T = Date.parse("2026-10-11T15:09:50Z");

const SATS: FakeSat[] = [
  { norad: 25544, name: "ISS (ZARYA)", group: 0, mercator: [-17e6, 2.2e6] }, // 0 the ISS
  { norad: 19046, name: "SL-3 R/B", group: 1, mercator: [1e6, 2e6], sunlit: false }, // 1 shadowed
  { norad: 10114, name: "FAR SIDE", group: 1, altDeg: -60, mercator: [3e6, 4e6] }, // 2 below the horizon: still drawn
  { norad: 44713, name: "STARLINK-1007", group: 2, mercator: [5e6, 6e6] }, // 3 Starlink
  { norad: 36086, name: "POISK", group: 0, dockedWith: 25544, mercator: [-17e6, 2.2e6] }, // 4 docked
  { norad: 22222, name: "DECAYED", group: 1, valid: false, mercator: [7e6, 8e6] }, // 5 no position
  { norad: 33333, name: "SELECTED", group: 1, mercator: [9e6, 1e6] }, // 6
  { norad: 44444, name: "HOVERED", group: 1, mercator: [2e6, 3e6] }, // 7
];

const pointsOf = (f: Feature<MultiPoint> | undefined): number[] => [
  ...(f?.getGeometry()?.getFlatCoordinates() ?? []),
];

describe("writeGroundSatellites", () => {
  it("draws every valid, undocked object of the visible layers, whole globe, without the ISS, selected and hovered", () => {
    const g = createGroundSatellites();
    const ids = { iss: 0, selected: 6, hovered: 7 };
    writeGroundSatellites(g, fakeFrame(SATS, T), fakeCatalog(SATS), ids, true, true);
    // [M9] Starlink by row parity: the Starlink row (index 3) is odd.
    const [
      stationsLit,
      stationsShadow,
      visualLit,
      visualShadow,
      evenLit,
      evenShadow,
      starlinkLit,
      starlinkShadow,
    ] = g.classes;
    expect(stationsLit?.source.hasFeature(stationsLit.feature)).toBe(false);
    expect(stationsShadow?.source.hasFeature(stationsShadow.feature)).toBe(false);
    expect(pointsOf(visualLit?.feature)).toEqual([3e6, 4e6]); // below the sky's horizon, still on the globe
    expect(pointsOf(visualShadow?.feature)).toEqual([1e6, 2e6]);
    expect(pointsOf(starlinkLit?.feature)).toEqual([5e6, 6e6]);
    expect(starlinkShadow?.source.hasFeature(starlinkShadow.feature)).toBe(false);
    expect(evenLit?.source.hasFeature(evenLit.feature)).toBe(false);
    expect(evenShadow?.source.hasFeature(evenShadow.feature)).toBe(false);
    // Pickable: drawn, the markers included.
    expect(Array.from(g.skip.subarray(0, 8))).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
    expect(g.count).toBe(8);
  });

  it("follows the layer toggles; the selected satellite stays pickable", () => {
    const g = createGroundSatellites();
    writeGroundSatellites(
      g,
      fakeFrame(SATS, T),
      fakeCatalog(SATS),
      { iss: 0, selected: 3, hovered: null },
      false,
      false,
    );
    for (const c of g.classes) expect(c.source.getFeatures()).toEqual([]);
    expect(Array.from(g.skip.subarray(0, 8))).toEqual([1, 1, 1, 0, 1, 1, 1, 1]);
  });

  it("marks lit and shadowed in the WebGL style by shape: circle against square", () => {
    const g = createGroundSatellites();
    expect(g.classes.map((c) => c.feature.get("lit"))).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    const [lit, shadowed] = satelliteWebglStyle(4);
    expect(lit?.filter).toEqual(["==", ["get", "lit"], 1]);
    expect(lit?.style).toHaveProperty("circle-radius", 4);
    expect(shadowed?.else).toBe(true);
    expect(shadowed?.style).toHaveProperty("shape-points", 4);
  });

  it("[M9] splits Starlink by row parity into two WebGL layers, so a frame that moves one parity changes one layer", () => {
    const g = createGroundSatellites();
    const sats: FakeSat[] = [
      { norad: 1, name: "STARLINK-A", group: 2, mercator: [1e6, 1e6] }, // 0 even
      { norad: 2, name: "STARLINK-B", group: 2, mercator: [2e6, 2e6] }, // 1 odd
      { norad: 3, name: "STARLINK-C", group: 2, mercator: [3e6, 3e6], sunlit: false }, // 2 even, shadowed
    ];
    const ids = { iss: null, selected: null, hovered: null };
    const catalog = fakeCatalog(sats);
    const frame = fakeFrame(sats, T);
    writeGroundSatellites(g, frame, catalog, ids, true, true);
    const layers = g.starlinkLayer.getLayers().getArray();
    expect(layers).toHaveLength(2);
    const [evenLit, evenShadow, oddLit] = g.classes.slice(4);
    expect(pointsOf(evenLit?.feature)).toEqual([1e6, 1e6]);
    expect(pointsOf(evenShadow?.feature)).toEqual([3e6, 3e6]);
    expect(pointsOf(oddLit?.feature)).toEqual([2e6, 2e6]);
    expect(evenLit?.source).toBe((layers[0] as WebGLVectorLayer<VectorSource>).getSource());
    expect(oddLit?.source).toBe((layers[1] as WebGLVectorLayer<VectorSource>).getSource());
    // Only the odd row moves: the even layer's source sees no change.
    let evenChanges = 0;
    let oddChanges = 0;
    evenLit?.source.on("change", () => evenChanges++);
    oddLit?.source.on("change", () => oddChanges++);
    frame.mercator[2] = 2.5e6;
    writeGroundSatellites(g, frame, catalog, ids, true, true);
    expect([evenChanges, oddChanges]).toEqual([0, 1]);
    expect(g.starlinkLayer.getVisible()).toBe(true);
  });

  it("[M9] leaves Starlink outside the draw area out of the class points (wrapped in x), never other groups", () => {
    const g = createGroundSatellites();
    const W = 40_075_016.685578488;
    const sats: FakeSat[] = [
      { norad: 1, name: "STARLINK-NEAR", group: 2, mercator: [1e6, 0] }, // 0 in
      { norad: 2, name: "STARLINK-FAR", group: 2, mercator: [9e6, 0] }, // 1 out in x
      { norad: 3, name: "STARLINK-WRAP", group: 2, mercator: [-W / 2 + 1e5, 0] }, // 2 in across the antimeridian
      { norad: 4, name: "STARLINK-NORTH", group: 2, mercator: [1e6, 5e6] }, // 3 out in y
      { norad: 5, name: "FAR STATION", group: 1, mercator: [9e6, 9e6] }, // 4 stations/visual: always drawn
    ];
    const ids = { iss: null, selected: null, hovered: null };
    const area = { centerX: W / 2 - 1e6, centerY: 0, halfSizeM: 3e6 };
    writeGroundSatellites(g, fakeFrame(sats, T), fakeCatalog(sats), ids, true, true, area);
    const [evenLit, , oddLit] = g.classes.slice(4);
    // Row 0 is about 1.9e7 m from the centre and left out; row 2 is 1.1e6 m away across the antimeridian.
    expect(pointsOf(evenLit?.feature)).toEqual([-W / 2 + 1e5, 0]);
    expect(oddLit?.source.hasFeature(oddLit.feature)).toBe(false); // rows 1 and 3 are out
    expect(pointsOf(g.classes[2]?.feature)).toEqual([9e6, 9e6]);
    // Picking does not depend on the area.
    expect(Array.from(g.skip.subarray(0, 5))).toEqual([0, 0, 0, 0, 0]);
    // An area as wide as the world draws everything.
    writeGroundSatellites(g, fakeFrame(sats, T), fakeCatalog(sats), ids, true, true, {
      ...area,
      halfSizeM: W,
    });
    expect(pointsOf(g.classes[4]?.feature)).toEqual([1e6, 0, -W / 2 + 1e5, 0]);
    expect(pointsOf(g.classes[6]?.feature)).toEqual([9e6, 0, 1e6, 5e6]);
  });

  it("draws and picks nothing before a ready frame", () => {
    const g = createGroundSatellites();
    const ids = { iss: 0, selected: null, hovered: null };
    writeGroundSatellites(g, fakeFrame(SATS, T), fakeCatalog(SATS), ids, true, true);
    writeGroundSatellites(g, fakeFrame(SATS, T, false), fakeCatalog(SATS), ids, true, true);
    expect(g.count).toBe(0);
    for (const c of g.classes) expect(c.source.getFeatures()).toEqual([]);
  });
});

const labelOf = (
  g: ReturnType<typeof createGroundSatellites>,
  which: "selected" | "hover" | "iss",
) => {
  const slot = g.markers[which];
  if (!slot.visible) return undefined;
  const fn = g.markers.layer.getStyle() as (f: Feature, r: number) => Style[] | undefined;
  return fn(slot.feature, 1)?.at(-1)?.getText()?.getText();
};

const targets = (t: Partial<SelectionTargets>): SelectionTargets => ({
  selectedId: null,
  hoverId: null,
  selectedIndex: null,
  hoverIndex: null,
  issIndex: 0,
  ...t,
});

describe("writeGroundMarkers", () => {
  it("labels the ISS, the selected and the hovered satellite at their EPSG:3857 positions", () => {
    const g = createGroundSatellites();
    const frame = fakeFrame(SATS, T);
    const catalog = fakeCatalog(SATS);
    writeGroundMarkers(
      g,
      frame,
      catalog,
      targets({ selectedId: "sat:33333", selectedIndex: 6, hoverId: "sat:44444", hoverIndex: 7 }),
      true,
    );
    expect(labelOf(g, "iss")).toBe("ISS (ZARYA)");
    expect(g.markers.iss.point.getCoordinates()).toEqual([-17e6, 2.2e6]);
    expect(labelOf(g, "selected")).toBe("SELECTED");
    expect(g.markers.selected.point.getCoordinates()).toEqual([9e6, 1e6]);
    expect(labelOf(g, "hover")).toBe("HOVERED");
    expect(g.drawnSelectedId).toBe("sat:33333");
  });

  it("draws no ground marker for stars and bodies, nor for a docked id's own row", () => {
    const g = createGroundSatellites();
    const frame = fakeFrame(SATS, T);
    const catalog = fakeCatalog(SATS);
    writeGroundMarkers(
      g,
      frame,
      catalog,
      targets({ selectedId: "planet:Saturn", hoverId: "star:424" }),
      true,
    );
    expect(g.markers.selected.visible).toBe(false);
    expect(g.markers.hover.visible).toBe(false);
    expect(g.drawnSelectedId).toBeNull();
    // ?sel=sat:36086 (POISK) resolves to the ISS's index: one marker, the selected one, named after the host.
    writeGroundMarkers(
      g,
      frame,
      catalog,
      targets({ selectedId: "sat:36086", selectedIndex: 0 }),
      true,
    );
    expect(labelOf(g, "selected")).toBe("ISS (ZARYA)");
    expect(g.markers.iss.visible).toBe(false);
    expect(g.drawnSelectedId).toBe("sat:36086");
  });

  it("hides the ISS while the satellites layer is off, and every marker before a ready frame", () => {
    const g = createGroundSatellites();
    const catalog = fakeCatalog(SATS);
    writeGroundMarkers(g, fakeFrame(SATS, T), catalog, targets({}), false);
    expect(g.markers.iss.visible).toBe(false);
    writeGroundMarkers(
      g,
      fakeFrame(SATS, T),
      catalog,
      targets({ selectedId: "sat:25544", selectedIndex: 0 }),
      true,
    );
    expect(g.markers.selected.visible).toBe(true);
    writeGroundMarkers(
      g,
      fakeFrame(SATS, T, false),
      catalog,
      targets({ selectedId: "sat:25544", selectedIndex: 0 }),
      true,
    );
    expect(g.markers.selected.visible).toBe(false);
    expect(g.drawnSelectedId).toBeNull();
  });

  it("keeps its markers drawn while the view pans or animates (gotcha 11)", () => {
    const g = createGroundSatellites();
    expect(g.markers.layer.getUpdateWhileAnimating()).toBe(true);
    expect(g.markers.layer.getUpdateWhileInteracting()).toBe(true);
  });
});
