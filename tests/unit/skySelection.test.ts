import type Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import type CircleStyle from "ol/style/Circle";
import type Style from "ol/style/Style";
import { describe, expect, it } from "vitest";
import { apparentAltDeg, BODY_IDS, BODY_STRIDE, type StarRow } from "../../src/domain/astro";
import {
  createCameraModel,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
  toSkyMapCoord,
} from "../../src/domain/camera";
import { azAltToEnuUnit } from "../../src/domain/geo";
import {
  createSkySatellites,
  LineWriter,
  writeSkySatellites,
} from "../../src/map/sky/layers/satellites";
import {
  createMarkerLayer,
  createSkySelection,
  hideMarker,
  markerStyle,
  NEXT_PATH_MS,
  placeMarker,
  type SelectionTargets,
  writeNextPath,
  writeSkySelection,
} from "../../src/map/sky/layers/selection";
import type { SkyPathOut } from "../../src/workers/protocol";
import { type FakeSat, fakeCatalog, fakeFrame } from "../helpers/satFrame";

const T = Date.parse("2026-10-11T15:09:50Z");
const model = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

function mapXy(azDeg: number, altDeg: number): number[] | null {
  const uv = new Float64Array(2);
  if (!projectAzAltDeg(model, azDeg, altDeg, uv, 0)) return null;
  const out = [0, 0];
  toSkyMapCoord(model, uv[0] ?? 0, uv[1] ?? 0, out, 0);
  return out;
}

const styleOf = (feature: Feature, layerStyle: unknown): Style[] | undefined =>
  (layerStyle as (f: Feature, r: number) => Style[] | undefined)(feature, 1);

describe("marker slots", () => {
  it("start hidden, place in place, and fire a change only when something differs", () => {
    const markers = createMarkerLayer(false);
    const style = markers.layer.getStyle();
    for (const slot of [markers.selected, markers.hover, markers.iss]) {
      expect(slot.visible).toBe(false);
      expect(styleOf(slot.feature, style)).toBeUndefined();
    }
    let changes = 0;
    markers.selected.feature.on("change", () => changes++);
    markers.selected.point.on("change", () => changes++);
    expect(placeMarker(markers.selected, 10, 20, "lit", "ISS (ZARYA)")).toBe(true);
    expect(markers.selected.point.getCoordinates()).toEqual([10, 20]);
    const drawn = styleOf(markers.selected.feature, style);
    expect(drawn?.at(-1)?.getText()?.getText()).toBe("ISS (ZARYA)");
    const before = changes;
    expect(placeMarker(markers.selected, 10, 20, "lit", "ISS (ZARYA)")).toBe(false);
    expect(changes).toBe(before);
    expect(placeMarker(markers.selected, 10, 20, "shadowed", "ISS (ZARYA)")).toBe(true);
    expect(placeMarker(markers.selected, 11, 20, "shadowed", "ISS (ZARYA)")).toBe(true);
    expect(hideMarker(markers.selected)).toBe(true);
    expect(hideMarker(markers.selected)).toBe(false);
    expect(styleOf(markers.selected.feature, style)).toBeUndefined();
  });

  it("asks a canvas layer to redraw while the view animates or is dragged only when told to", () => {
    expect(createMarkerLayer(true).layer.getUpdateWhileAnimating()).toBe(true);
    expect(createMarkerLayer(true).layer.getUpdateWhileInteracting()).toBe(true);
    expect(createMarkerLayer(false).layer.getUpdateWhileAnimating()).toBe(false);
  });
});

describe("markerStyle", () => {
  it("keeps lit and shadowed apart in shape and marks selected and hovered differently", () => {
    const lit = markerStyle("iss", "lit", "A");
    const shadowed = markerStyle("iss", "shadowed", "A");
    expect(lit.at(-1)?.getImage()?.constructor.name).not.toBe(
      shadowed.at(-1)?.getImage()?.constructor.name,
    );
    const selectedRing = markerStyle("selected", "none", "A")[0]?.getImage() as CircleStyle;
    const hoverRing = markerStyle("hover", "none", "A")[0]?.getImage() as CircleStyle;
    expect(selectedRing.getStroke()?.getLineDash()).toBeNull();
    expect(hoverRing.getStroke()?.getLineDash()).not.toBeNull();
    expect(markerStyle("selected", "lit", "A")).toBe(markerStyle("selected", "lit", "A")); // cached
  });
});

const SATS: FakeSat[] = [
  { norad: 25544, name: "ISS (ZARYA)", group: 0, azDeg: 124, altDeg: 29 }, // 0
  { norad: 19046, name: "SL-3 R/B", group: 1, azDeg: 200, altDeg: 20, sunlit: false }, // 1
  { norad: 10114, name: "BELOW", group: 1, azDeg: 10, altDeg: -2 }, // 2
];
const POLARIS: StarRow = [37.95456, 89.26411, 2.02, 424, "Polaris"];
const NAMELESS: StarRow = [10, 10, 3.0, 7001, ""];
const FAINT: StarRow = [20, 20, 5.5, 7002, "Faint"];

function sky() {
  const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN);
  bodies.set([120.4, 57.6, 0.6, 1], BODY_IDS.indexOf("planet:Saturn") * BODY_STRIDE);
  bodies.set([200, -10, -4, 0.5], BODY_IDS.indexOf("moon") * BODY_STRIDE);
  return {
    rows: [POLARIS, NAMELESS, FAINT],
    starCount: 2,
    starAzAltDeg: Float32Array.from([0.592, 20.151, 300, 40, 50, 50]),
    bodies,
  };
}

function setup(targets: SelectionTargets, satellitesOn = true) {
  const sats = createSkySatellites();
  const catalog = fakeCatalog(SATS);
  const frame = fakeFrame(SATS, T);
  writeSkySatellites(
    sats,
    model,
    frame,
    catalog,
    { iss: 0, selected: targets.selectedIndex, hovered: targets.hoverIndex },
    satellitesOn,
    false,
  );
  const sel = createSkySelection();
  writeSkySelection(sel, model, sats, frame, catalog, sky(), targets, satellitesOn);
  return { sel, sats };
}

const none: SelectionTargets = {
  selectedId: null,
  hoverId: null,
  selectedIndex: null,
  hoverIndex: null,
  issIndex: 0,
};

const label = (sel: ReturnType<typeof createSkySelection>, which: "selected" | "hover" | "iss") => {
  const slot = sel[which];
  return slot.visible
    ? styleOf(slot.feature, sel.layer.getStyle())?.at(-1)?.getText()?.getText()
    : undefined;
};

describe("writeSkySelection", () => {
  it("labels the ISS whenever it is drawn, by its friendly short name ([Redesign])", () => {
    const { sel, sats } = setup(none);
    expect(label(sel, "iss")).toBe("ISS");
    expect(sel.iss.point.getCoordinates()).toEqual([sats.xy[0], sats.xy[1]]);
    expect(sel.drawnSelectedId).toBeNull();
    expect(setup(none, false).sel.iss.visible).toBe(false); // satellites layer off
  });

  it("marks the selected satellite (once, even when it is the ISS) and a hovered star", () => {
    const { sel } = setup({
      selectedId: "sat:25544",
      hoverId: "star:424",
      selectedIndex: 0,
      hoverIndex: null,
      issIndex: 0,
    });
    expect(label(sel, "selected")).toBe("ISS");
    expect(sel.iss.visible).toBe(false);
    expect(label(sel, "hover")).toBe("Polaris");
    // skyCache holds Float32 az/alt.
    expect(sel.hover.point.getCoordinates()).toEqual(
      mapXy(Math.fround(0.592), Math.fround(20.151)),
    );
    expect(sel.drawnSelectedId).toBe("sat:25544");
  });

  it("shows one marker when the hovered object is the selected one", () => {
    const { sel } = setup({
      selectedId: "sat:19046",
      hoverId: "sat:19046",
      selectedIndex: 1,
      hoverIndex: 1,
      issIndex: 0,
    });
    expect(label(sel, "selected")).toBe("Rocket stage"); // [Redesign] "SL-3 R/B" in plain words
    expect(sel.hover.visible).toBe(false);
    expect(label(sel, "iss")).toBe("ISS");
  });

  it("labels bodies with bodyLabel and stars with their name or HR number", () => {
    const { sel } = setup({ ...none, selectedId: "planet:Saturn", hoverId: "star:7001" });
    expect(label(sel, "selected")).toBe("Saturn");
    expect(sel.selected.point.getCoordinates()).toEqual(mapXy(120.4, 57.6));
    expect(label(sel, "hover")).toBe("HR 7001");
  });

  it("draws nothing for an object that is culled, not computed or unknown", () => {
    const cases: SelectionTargets[] = [
      { ...none, selectedId: "moon" }, // below the horizon
      { ...none, selectedId: "sun" }, // NaN: no sky pass yet
      { ...none, selectedId: "star:7002" }, // fainter than the limit
      { ...none, selectedId: "star:1" }, // not in the catalogue
      { ...none, selectedId: "sat:10114", selectedIndex: 2 }, // below the horizon
      { ...none, selectedId: "sat:99999", selectedIndex: null }, // not loaded
    ];
    for (const targets of cases) {
      const { sel } = setup(targets);
      expect(sel.selected.visible, String(targets.selectedId)).toBe(false);
      expect(sel.drawnSelectedId, String(targets.selectedId)).toBeNull();
    }
  });
});

describe("writeNextPath", () => {
  it("draws the selected satellite's next 2 minutes from its current position, dotted", () => {
    const sats = createSkySatellites();
    const catalog = fakeCatalog(SATS);
    writeSkySatellites(
      sats,
      model,
      fakeFrame(SATS, T),
      catalog,
      { iss: 0, selected: 1, hovered: null },
      true,
      false,
    );
    // Points every 2 s from T − 4 s to T + 130 s at az 200°, alt 20°.
    const enu = new Float32Array(3 * 68);
    const unit = new Float64Array(3);
    let geo = 20;
    for (let k = 0; k < 5; k++) geo = 20 - (apparentAltDeg(geo) - geo);
    azAltToEnuUnit(200, geo, unit, 0);
    for (let j = 0; j < 68; j++) for (let c = 0; c < 3; c++) enu[3 * j + c] = (unit[c] ?? 0) * 900;
    const path: SkyPathOut = { index: 1, firstPointMs: T - 4_000, enuKm: enu };
    const geometry = new MultiLineString([], "XY", []);
    const writer = new LineWriter(geometry);
    expect(writeNextPath(writer, sats, model, new Map([[1, path]]), 1, T)).toBe(true);
    // The current position, then T + 2 s … T + 120 s: 1 + 60 points in one run.
    expect(geometry.getEnds()).toEqual([2 * 61]);
    expect(geometry.getFlatCoordinates().slice(0, 2)).toEqual([sats.xy[2], sats.xy[3]]);
    expect(NEXT_PATH_MS).toBe(120_000);
    expect(writeNextPath(writer, sats, model, new Map([[1, path]]), null, T)).toBe(true);
    expect(geometry.getEnds()).toEqual([]);
  });

  it("is dotted", () => {
    const sel = createSkySelection();
    const feature = sel.layer
      .getSource()
      ?.getFeatures()
      .find((f) => f.getGeometry() === sel.nextPath);
    const style = styleOf(feature as Feature, sel.layer.getStyle());
    expect(style?.[0]?.getStroke()?.getLineDash()?.length).toBeGreaterThan(0);
  });
});
