// The sky view's pan and zoom for image cameras (M4 step 11.1–11.2), through its pure parts: which kinds pan and
// zoom, the fitted view a refit builds, and the "fitted state" test that decides whether a resize refits. The map
// itself needs a DOM; calibration-export.spec.ts drives it in Chromium.
import { describe, expect, it } from "vitest";
import {
  cameraPansAndZooms,
  createPanZoomSkyView,
  createSkyView,
  fittedSkyResolution,
  isFittedSkyView,
  PAN_ZOOM_MIN_RESOLUTION,
} from "../../src/map/sky/createSkyMap";

describe("cameraPansAndZooms", () => {
  it("is true for still-image and local-video cameras only (SkyMapHandle.setPanZoom)", () => {
    expect(cameraPansAndZooms("still-image")).toBe(true);
    expect(cameraPansAndZooms("local-video")).toBe(true);
    expect(cameraPansAndZooms("synthetic")).toBe(false);
    expect(cameraPansAndZooms("youtube")).toBe(false);
  });
});

describe("fittedSkyResolution", () => {
  it("is view.getResolutionForExtent([0, 0, W, H], size): the larger of W/w and H/h", () => {
    expect(fittedSkyResolution(1232, 1232, [600, 600])).toBeCloseTo(1232 / 600, 12);
    expect(fittedSkyResolution(3840, 2160, [1280, 600])).toBe(3.6); // the height limits
    expect(fittedSkyResolution(3840, 2160, [1280, 900])).toBe(3); // the width limits
    const view = createSkyView(3840, 2160);
    expect(fittedSkyResolution(3840, 2160, [1000, 700])).toBe(
      view.getResolutionForExtent([0, 0, 3840, 2160], [1000, 700]),
    );
  });

  it("is NaN for a missing or empty size", () => {
    expect(fittedSkyResolution(1232, 1232, undefined)).toBeNaN();
    expect(fittedSkyResolution(1232, 1232, [0, 600])).toBeNaN();
    expect(fittedSkyResolution(1232, 1232, [600, 0])).toBeNaN();
  });
});

describe("createPanZoomSkyView", () => {
  const W = 1232;
  const fitted = W / 600;

  it("starts fitted and centred, in the frame's pixel projection", () => {
    const view = createPanZoomSkyView(W, W, [600, 600]);
    expect(view.getProjection().getCode()).toBe("sky-px-1232x1232");
    expect(view.getCenter()).toEqual([616, 616]);
    expect(view.getResolution()).toBeCloseTo(fitted, 12);
    expect(view.getMaxResolution()).toBeCloseTo(fitted, 12);
  });

  it("zooms in to minResolution 0.125, which OpenLayers snaps to maxResolution / 2^n (step 11.1)", () => {
    const view = createPanZoomSkyView(W, W, [600, 600]);
    // Fitted 2.0533 gives 0.1283 (7.8 screen px per image px), as the doc measured on ol 10.11.0.
    expect(view.getMinResolution()).toBeCloseTo(fitted / 16, 12);
    expect(view.getMinResolution()).toBeCloseTo(0.1283, 4);
    expect(view.getMinResolution()).toBeGreaterThanOrEqual(PAN_ZOOM_MIN_RESOLUTION);
    view.setResolution(0.01);
    expect(view.getResolution()).toBeCloseTo(fitted / 16, 12);
    view.setResolution(100);
    expect(view.getResolution()).toBeCloseTo(fitted, 12); // never zooms out past the whole frame
  });

  it("keeps the centre inside the frame and never rotates", () => {
    const view = createPanZoomSkyView(W, W, [600, 600]);
    view.setCenter([-500, 2000]);
    expect(view.getCenter()).toEqual([0, W]);
    view.setCenter([300, 900]);
    expect(view.getCenter()).toEqual([300, 900]);
    view.setRotation(1);
    expect(view.getRotation()).toBe(0);
  });

  it("a non-square frame: the wider side decides the fit", () => {
    const view = createPanZoomSkyView(3840, 2160, [1280, 600]);
    expect(view.getMaxResolution()).toBe(3.6);
    expect(view.getCenter()).toEqual([1920, 1080]);
    expect(view.getProjection().getCode()).toBe("sky-px-3840x2160");
  });
});

describe("isFittedSkyView", () => {
  const W = 1232;

  it("true right after a refit; false once zoomed in or panned", () => {
    const view = createPanZoomSkyView(W, W, [600, 600]);
    const fitted = view.getMaxResolution();
    expect(isFittedSkyView(view, fitted)).toBe(true);
    view.setResolution(fitted / 2);
    expect(isFittedSkyView(view, fitted)).toBe(false);
    view.setResolution(fitted);
    expect(isFittedSkyView(view, fitted)).toBe(true);
    view.setCenter([600, 616]);
    expect(isFittedSkyView(view, fitted)).toBe(false);
  });

  it("false for another fitted resolution", () => {
    const view = createPanZoomSkyView(W, W, [600, 600]);
    expect(isFittedSkyView(view, W / 800)).toBe(false);
  });
});
