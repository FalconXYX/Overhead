import Feature from "ol/Feature";
import type Point from "ol/geom/Point";
import type Polygon from "ol/geom/Polygon";
import { fromLonLat, toLonLat } from "ol/proj";
import { getDistance } from "ol/sphere";
import { getUid } from "ol/util";
import View from "ol/View";
import { describe, expect, it } from "vitest";
import { wrap180, wrap360 } from "../../src/domain/geo";
import {
  createSiteLayer,
  SITE_WEDGE_RADIUS_M,
  siteWedgeGeometry,
  WEDGE_ARC_STEP_DEG,
  WEDGE_CIRCLE_VERTICES,
} from "../../src/map/ground/layers/site";
import { bindSite } from "../../src/map/sync/bindSite";
import { committedCameras, storeAt } from "../helpers/store";

function setup() {
  const store = storeAt("2026-10-10T03:30:00Z");
  const feature = new Feature<Point>();
  const view = new View({ center: [0, 0], zoom: 6 });
  let geometryChanges = 0;
  feature.on("change:geometry", () => {
    geometryChanges += 1;
  });
  const unbind = bindSite(store, feature, view);
  return { store, feature, view, unbind, geometryChanges: () => geometryChanges };
}

describe("bindSite", () => {
  it("places the marker at the site, names it and centres the view", () => {
    const { feature, view } = setup();
    const coordinates = feature.getGeometry()?.getCoordinates() ?? [];
    const expected = fromLonLat([-155.4689, 19.8253]);
    expect(coordinates).toEqual(expected);
    expect(coordinates[0]).toBeCloseTo(-17306718.78, 2);
    expect(coordinates[1]).toBeCloseTo(2252346.76, 2);
    expect(view.getCenter()).toEqual(expected);
    expect(feature.get("name")).toBe("Computed sky, Maunakea");
  });

  it("one geometry change over 100 ticks", () => {
    const { store, geometryChanges } = setup();
    const t0 = store.getState().clock.simTimeMs;
    for (let i = 1; i <= 100; i += 1) store.getState().actions.tick(t0 + i * 16);
    expect(geometryChanges()).toBe(1);
  });

  it("follows a camera change, and nothing moves after unbind", () => {
    const { store, feature, view, unbind } = setup();
    store.getState().actions.setRegistry(committedCameras());
    store.getState().actions.setActiveCamera("synthetic-walenstadt");
    const walenstadt = fromLonLat([9.3242, 47.1236]);
    expect(feature.getGeometry()?.getCoordinates()).toEqual(walenstadt);
    expect(view.getCenter()).toEqual(walenstadt);
    expect(feature.get("name")).toBe("Computed sky, Walenstadt");
    unbind();
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expect(feature.getGeometry()?.getCoordinates()).toEqual(walenstadt);
    expect(view.getCenter()).toEqual(walenstadt);
  });

  it("clears the marker when the active camera is not in the registry", () => {
    const { store, feature } = setup();
    store.getState().actions.setActiveCamera("nope");
    expect(feature.getGeometry()).toBeUndefined();
  });
});

// ---- [M4] The site wedge (M4 step 12) ----

const D2R = Math.PI / 180;

/** Initial great-circle bearing from a to b, degrees in [0, 360). */
function bearingDeg(a: readonly number[], b: readonly number[]): number {
  const [lon1 = 0, lat1 = 0] = a.map((d) => d * D2R);
  const [lon2 = 0, lat2 = 0] = b.map((d) => d * D2R);
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return wrap360(Math.atan2(y, x) / D2R);
}

/** The wedge's ring in lon/lat degrees. */
function ringLonLat(polygon: Polygon | undefined): number[][] {
  return (polygon?.getCoordinates()[0] ?? []).map((c) => toLonLat(c));
}

const MAUNAKEA = [-155.4689, 19.8253];
const SUBARU = [-155.47587, 19.82552]; // subaru-starcam's site

function expectFullCircle(polygon: Polygon | undefined, centre: readonly number[]): void {
  const ring = ringLonLat(polygon);
  expect(ring).toHaveLength(WEDGE_CIRCLE_VERTICES + 1);
  for (const p of ring) {
    expect(Math.abs(getDistance(centre as number[], p) - SITE_WEDGE_RADIUS_M)).toBeLessThan(1e-3);
  }
}

/** A range wedge: site, the arc clockwise from `from` to `to` every 2°, site. */
function expectRange(
  polygon: Polygon | undefined,
  centre: readonly number[],
  from: number,
  to: number,
  tol: number,
): void {
  const ring = ringLonLat(polygon);
  const first = ring[0] ?? [];
  const last = ring.at(-1) ?? [];
  expect(first[0]).toBeCloseTo(centre[0] ?? 0, 9);
  expect(first[1]).toBeCloseTo(centre[1] ?? 0, 9);
  expect(last).toEqual(first);
  const arc = ring.slice(1, -1);
  const bearings = arc.map((p) => bearingDeg(centre, p));
  expect(Math.abs(wrap180((bearings[0] ?? 0) - from))).toBeLessThan(tol);
  expect(Math.abs(wrap180((bearings.at(-1) ?? 0) - to))).toBeLessThan(tol);
  for (let i = 1; i < bearings.length; i++) {
    const step = wrap360((bearings[i] ?? 0) - (bearings[i - 1] ?? 0));
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(WEDGE_ARC_STEP_DEG + 1e-9);
  }
  for (const p of arc) {
    expect(Math.abs(getDistance(centre as number[], p) - SITE_WEDGE_RADIUS_M)).toBeLessThan(1e-3);
  }
}

describe("siteWedgeGeometry", () => {
  it("full: circular([lon, lat], radius, 64) in EPSG:3857", () => {
    const polygon = siteWedgeGeometry(
      MAUNAKEA[0] ?? 0,
      MAUNAKEA[1] ?? 0,
      { kind: "full" },
      SITE_WEDGE_RADIUS_M,
    );
    expectFullCircle(polygon, MAUNAKEA);
    // EPSG:3857 metres, not degrees.
    expect(Math.abs(polygon.getCoordinates()[0]?.[0]?.[0] ?? 0)).toBeGreaterThan(1e6);
  });

  it("range: site, every 2° clockwise from fromAzDeg to exactly toAzDeg, site", () => {
    const polygon = siteWedgeGeometry(
      MAUNAKEA[0] ?? 0,
      MAUNAKEA[1] ?? 0,
      { kind: "range", fromAzDeg: 40.3553, toAzDeg: 122.0447 },
      SITE_WEDGE_RADIUS_M,
    );
    expectRange(polygon, MAUNAKEA, 40.3553, 122.0447, 1e-6);
    // 81.6894° of arc: 41 vertices every 2° from 40.3553, then 122.0447 itself, plus the site twice.
    expect(polygon.getCoordinates()[0]).toHaveLength(41 + 1 + 2);
  });

  it("range across north: fromAzDeg > toAzDeg runs clockwise through 0°", () => {
    const polygon = siteWedgeGeometry(
      MAUNAKEA[0] ?? 0,
      MAUNAKEA[1] ?? 0,
      { kind: "range", fromAzDeg: 308.98, toAzDeg: 31.02 },
      SITE_WEDGE_RADIUS_M,
    );
    expectRange(polygon, MAUNAKEA, 308.98, 31.02, 1e-6);
    const bearings = ringLonLat(polygon)
      .slice(1, -1)
      .map((p) => bearingDeg(MAUNAKEA, p));
    expect(bearings.some((b) => b > 359 || b < 1)).toBe(true); // it passes north
    expect(bearings.every((b) => b >= 308.98 - 1e-6 || b <= 31.02 + 1e-6)).toBe(true); // and never south
  });
});

describe("createSiteLayer", () => {
  it("holds the wedge and the marker, the wedge drawn first (below)", () => {
    const { layer, feature, wedge } = createSiteLayer();
    const features = layer.getSource()?.getFeatures() ?? [];
    expect(features).toContain(feature);
    expect(features).toContain(wedge);
    // OpenLayers' default render order is by uid, which follows creation order.
    expect(Number(getUid(wedge))).toBeLessThan(Number(getUid(feature)));
  });
});

describe("bindSite wedge", () => {
  function setupWedge() {
    const store = storeAt("2026-10-10T03:30:00Z");
    store.getState().actions.setRegistry(committedCameras());
    const { feature, wedge } = createSiteLayer();
    const view = new View({ center: [0, 0], zoom: 6 });
    let wedgeChanges = 0;
    wedge.on("change:geometry", () => {
      wedgeChanges += 1;
    });
    let markerChanges = 0;
    feature.on("change:geometry", () => {
      markerChanges += 1;
    });
    const unbind = bindSite(store, feature, view, wedge);
    return {
      store,
      feature,
      wedge,
      view,
      unbind,
      wedgeChanges: () => wedgeChanges,
      markerChanges: () => markerChanges,
    };
  }

  it("a zenith fisheye and Nānā ao's 1.7° tilt both show a full circle", () => {
    const { store, wedge } = setupWedge();
    expectFullCircle(wedge.getGeometry(), MAUNAKEA);
    store.getState().actions.setActiveCamera("cfht-nanaao");
    expectFullCircle(wedge.getGeometry(), MAUNAKEA);
    store.getState().actions.setActiveCamera("synthetic-walenstadt");
    expectFullCircle(wedge.getGeometry(), [9.3242, 47.1236]);
  });

  it("a rectilinear camera shows the azimuth range its frame covers (frameAzimuthCoverage, 16 per edge)", () => {
    const { store, wedge } = setupWedge();
    // [M5] The settled defaults (81.2322, 19.6185, roll 0.7698, f 2525.93, k1 −0.00992), 3840 × 2160: 37.48°–125.17°
    // (M5 step 8.9); M1's provisional f 2742 gave 40.3553°–122.0447°.
    store.getState().actions.setActiveCamera("subaru-starcam");
    expectRange(wedge.getGeometry(), SUBARU, 37.47505, 125.17394, 1e-3);
    store.getState().actions.setActiveCamera("cfht-starcam"); // (270, 20)
    expectRange(wedge.getGeometry(), MAUNAKEA, 228.98, 311.02, 0.01);
  });

  it("follows a calibration change without moving the marker or the view", () => {
    const { store, wedge, view, markerChanges } = setupWedge();
    store.getState().actions.setActiveCamera("subaru-starcam");
    const marker = markerChanges();
    view.setCenter([1, 2]); // the user panned
    store.getState().actions.updateCalibration({ azDeg: 91.2 }); // + 9.9678° from the settled 81.2322
    expectRange(wedge.getGeometry(), SUBARU, 47.44285, 135.14174, 1e-3);
    expect(view.getCenter()).toEqual([1, 2]);
    expect(markerChanges()).toBe(marker);
  });

  it("no wedge change on clock ticks", () => {
    const { store, wedgeChanges } = setupWedge();
    const before = wedgeChanges();
    const t0 = store.getState().clock.simTimeMs;
    for (let i = 1; i <= 100; i += 1) store.getState().actions.tick(t0 + i * 16);
    expect(wedgeChanges()).toBe(before);
  });

  it("cleared with the marker for a camera not in the registry; nothing after unbind", () => {
    const { store, wedge, unbind } = setupWedge();
    store.getState().actions.setActiveCamera("nope");
    expect(wedge.getGeometry()).toBeUndefined();
    store.getState().actions.setActiveCamera("synthetic-maunakea");
    expectFullCircle(wedge.getGeometry(), MAUNAKEA);
    unbind();
    store.getState().actions.setActiveCamera("subaru-starcam");
    expectFullCircle(wedge.getGeometry(), MAUNAKEA);
  });
});
