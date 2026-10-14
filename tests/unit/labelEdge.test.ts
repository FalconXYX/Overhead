// [Polish] labelEdge.ts: a marker's label leans inward near the frame's edges, so "ISS" never runs off the video; the
// sky's marker and body layers pick the leaning style from the map's view extent at render time.
import type Feature from "ol/Feature";
import type Style from "ol/style/Style";
import { describe, expect, it } from "vitest";
import { edgeTextPlacement, labelEdge, labelWidthPx } from "../../src/map/labelEdge";
import { createBodiesLayer } from "../../src/map/sky/layers/bodies";
import { createMarkerLayer, placeMarker } from "../../src/map/sky/layers/selection";

/** A 1920 × 1080 frame at 2 map units per CSS px (a 960 px wide video). */
const FRAME = [0, 0, 1920, 1080];
const R = 2;

describe("labelEdge", () => {
  it("centres the label above a marker with room on every side", () => {
    expect(labelEdge(960, 540, FRAME, R, "ISS", 12, 18)).toBe("");
  });

  it("lines the label's right end up with a marker near the right edge, its left end near the left edge", () => {
    // "ISS": 3 × 7.2 + 4 = 25.6 px wide; half is 12.8 px = 25.6 map units.
    expect(labelWidthPx("ISS", 12)).toBeCloseTo(25.6, 9);
    expect(labelEdge(1920 - 20, 540, FRAME, R, "ISS", 12, 18)).toBe("r");
    expect(labelEdge(1920 - 30, 540, FRAME, R, "ISS", 12, 18)).toBe("");
    expect(labelEdge(20, 540, FRAME, R, "ISS", 12, 18)).toBe("l");
    expect(labelEdge(1920, 540, FRAME, R, "ISS", 12, 18)).toBe("r"); // on the edge itself
  });

  it("drops the label of a marker whose centre is outside the frame (it would be cut)", () => {
    expect(labelEdge(1925, 540, FRAME, R, "ISS", 12, 18)).toBe("x");
    expect(labelEdge(-1, 540, FRAME, R, "ISS", 12, 18)).toBe("x");
    expect(labelEdge(960, 1081, FRAME, R, "ISS", 12, 18)).toBe("x");
    expect(labelEdge(960, -3, FRAME, R, "ISS", 12, 18)).toBe("x");
  });

  it("takes x to the world copy nearest the view on a wrapping map", () => {
    const W = 40_075_016.685578488;
    // The view around Hawaii; the marker one world to the east: as if at the view's right edge.
    const view = [-17_500_000, 2_000_000, -16_500_000, 3_000_000];
    expect(labelEdge(-16_500_100 + W, 2_500_000, view, 1000, "ISS", 12, 18, W)).toBe("r");
    expect(labelEdge(-16_500_100 + W, 2_500_000, view, 1000, "ISS", 12, 18)).toBe("x");
  });

  it("puts the label below a marker near the top edge, and combines with a side", () => {
    // 18 + 6 + 2 = 26 px = 52 map units under the top.
    expect(labelEdge(960, 1080 - 50, FRAME, R, "Jupiter", 12, 18)).toBe("b");
    expect(labelEdge(960, 1080 - 54, FRAME, R, "Jupiter", 12, 18)).toBe("");
    expect(labelEdge(1910, 1075, FRAME, R, "ISS", 12, 18)).toBe("rb");
    expect(labelEdge(5, 1075, FRAME, R, "ISS", 12, 18)).toBe("lb");
  });

  it("does nothing for an empty label or an unknown resolution", () => {
    expect(labelEdge(1919, 1079, FRAME, R, "", 12, 18)).toBe("");
    expect(labelEdge(1919, 1079, FRAME, 0, "ISS", 12, 18)).toBe("");
    expect(labelEdge(1919, 1079, FRAME, Number.NaN, "ISS", 12, 18)).toBe("");
  });

  it("edgeTextPlacement: the alignment and the side of the marker", () => {
    expect(edgeTextPlacement("", 18)).toEqual({ textAlign: undefined, offsetY: -18 });
    expect(edgeTextPlacement("r", 18)).toEqual({ textAlign: "right", offsetY: -18 });
    expect(edgeTextPlacement("lb", 18)).toEqual({ textAlign: "left", offsetY: 18 });
  });
});

type StyleFn = (f: Feature, r: number) => Style[] | Style | undefined;
const asArray = (s: Style[] | Style | undefined): Style[] =>
  s === undefined ? [] : Array.isArray(s) ? s : [s];

describe("the sky's layers lean their labels inside the view", () => {
  it("the ISS marker's label is right-aligned at the frame's right edge, centred elsewhere", () => {
    const markers = createMarkerLayer(false, [], () => FRAME);
    const style = markers.layer.getStyle() as StyleFn;
    placeMarker(markers.iss, 1915, 540, "lit", "ISS", "iss");
    const text = asArray(style(markers.iss.feature, R)).at(-1)?.getText();
    expect(text?.getText()).toBe("ISS");
    expect(text?.getTextAlign()).toBe("right");
    expect(text?.getOffsetY()).toBe(-18);
    placeMarker(markers.iss, 960, 540, "lit", "ISS", "iss");
    const centred = asArray(style(markers.iss.feature, R)).at(-1)?.getText();
    expect(centred?.getTextAlign()).toBeUndefined();
    // Past the edge: the marker without its label.
    placeMarker(markers.iss, 1930, 540, "lit", "ISS", "iss");
    const outside = asArray(style(markers.iss.feature, R)).at(-1);
    expect(outside?.getImage()).not.toBeNull();
    expect(outside?.getText()).toBeNull();
    // Without a view extent (the ground map), always centred.
    const plain = createMarkerLayer(true);
    placeMarker(plain.iss, 1915, 540, "lit", "ISS", "iss");
    const plainText = asArray((plain.layer.getStyle() as StyleFn)(plain.iss.feature, R)).at(-1);
    expect(plainText?.getText()?.getTextAlign()).toBeUndefined();
  });

  it("a planet's label at the top edge goes below it", () => {
    const bodies = createBodiesLayer(() => FRAME);
    const i = 0;
    const feature = bodies.features[i];
    bodies.visible[i] = 1;
    bodies.parts[i] = { label: "Jupiter", radiusPx: 4, hollow: false };
    bodies.styleKeys[i] = "Jupiter|4|false";
    bodies.points[i]?.setCoordinates([960, 1078]);
    if (feature === undefined) throw new Error("no feature");
    const text = asArray((bodies.layer.getStyle() as StyleFn)(feature, R))[0]?.getText();
    expect(text?.getText()).toBe("Jupiter");
    expect(text?.getOffsetY()).toBe(13); // radius + 9, below
  });
});
