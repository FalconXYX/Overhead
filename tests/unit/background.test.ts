// startStillImageRefresh (M4 step 10) in Node: a real ImageLayer and real ImageStatic sources, with the image events
// dispatched by hand and fake timers, so the scheduling is checked without a DOM. The request headers (no Origin
// without corsEnabled) and the decoded image are checked in Chromium by calibration-export.spec.ts.
import ImageWrapper from "ol/Image";
import ImageState from "ol/ImageState";
import ImageLayer from "ol/layer/Image";
import type ImageSource from "ol/source/Image";
import { ImageSourceEvent } from "ol/source/Image";
import ImageStatic from "ol/source/ImageStatic";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { skyPixelProjection } from "../../src/map/sky/createSkyMap";
import {
  cacheBustedUrl,
  type StillRefreshOptions,
  startStillImageRefresh,
  stillImageSourceOptions,
  stillRefreshDelayMs,
} from "../../src/map/sky/layers/background";

const URL_NANAAO = "https://www.cfht.hawaii.edu/~nanaao/last_vis.png";
const T0 = Date.parse("2026-10-11T08:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** The ImageStatic the layer shows or is loading. */
function sourceOf(layer: ImageLayer<ImageSource>): ImageStatic {
  const source = layer.getSource();
  if (!(source instanceof ImageStatic)) throw new Error("expected an ImageStatic source");
  return source;
}

/** Fires the event OpenLayers fires when the image of `source` has decoded (an ImageBitmap-like W × H) or failed. */
function finish(source: ImageStatic, outcome: "load" | "error", sizePx = 256): void {
  const image = new ImageWrapper([0, 0, 1, 1], undefined, 1, ImageState.IDLE);
  // An ImageBitmap in Chromium: width and height, no naturalWidth.
  image.setImage({ width: sizePx, height: sizePx } as unknown as ImageBitmap);
  source.dispatchEvent(
    new ImageSourceEvent(outcome === "load" ? "imageloadend" : "imageloaderror", image),
  );
}

function setup(overrides: Partial<StillRefreshOptions> = {}) {
  const layer = new ImageLayer<ImageSource>();
  const projection = skyPixelProjection(1232, 1232);
  const loads: [number, number, number][] = [];
  let errors = 0;
  const options: StillRefreshOptions = {
    imageUrl: URL_NANAAO,
    refreshSec: 60,
    corsEnabled: false,
    widthPx: 1232,
    heightPx: 1232,
    onLoad: (ms, w, h) => loads.push([ms, w, h]),
    onError: () => {
      errors += 1;
    },
    ...overrides,
  };
  const stop = startStillImageRefresh(layer, projection, options);
  return { layer, loads, errors: () => errors, stop };
}

describe("pure parts", () => {
  it("cacheBustedUrl adds t=<ms> with ? or &, before any fragment", () => {
    expect(cacheBustedUrl(URL_NANAAO, 1_791_000_000_000)).toBe(`${URL_NANAAO}?t=1791000000000`);
    expect(cacheBustedUrl("https://a.example/img.jpg?cam=3", 5)).toBe(
      "https://a.example/img.jpg?cam=3&t=5",
    );
    expect(cacheBustedUrl("https://a.example/img.jpg#x", 5)).toBe(
      "https://a.example/img.jpg?t=5#x",
    );
  });

  it("stillRefreshDelayMs: refreshSec in ms, never below 60 s", () => {
    expect(stillRefreshDelayMs(60)).toBe(60_000);
    expect(stillRefreshDelayMs(120)).toBe(120_000); // ASK053
    expect(stillRefreshDelayMs(10)).toBe(60_000);
    expect(stillRefreshDelayMs(0)).toBe(60_000);
    expect(stillRefreshDelayMs(Number.NaN)).toBe(60_000);
  });

  it("crossOrigin is set only with corsEnabled (null: a no-cors request for Nānā ao)", () => {
    const projection = skyPixelProjection(1232, 1232);
    const base = { imageUrl: URL_NANAAO, widthPx: 1232, heightPx: 1232 };
    const off = stillImageSourceOptions({ ...base, corsEnabled: false }, projection, T0);
    expect(off).toEqual({
      url: `${URL_NANAAO}?t=${T0}`,
      projection,
      imageExtent: [0, 0, 1232, 1232],
      crossOrigin: null,
    });
    expect(
      stillImageSourceOptions({ ...base, corsEnabled: true }, projection, T0).crossOrigin,
    ).toBe("anonymous");
  });
});

describe("startStillImageRefresh", () => {
  it("requests at once: a cache-busted ImageStatic in the camera's projection over [0, 0, W, H]", () => {
    const { layer } = setup();
    const source = sourceOf(layer);
    expect(source.getUrl()).toBe(`${URL_NANAAO}?t=${T0}`);
    expect(source.getProjection()?.getCode()).toBe("sky-px-1232x1232");
    expect(source.getImageExtent()).toEqual([0, 0, 1232, 1232]);
  });

  it("schedules the next request refreshSec after the load ends, never while one is in flight", () => {
    const { layer, loads } = setup();
    const first = sourceOf(layer);
    vi.advanceTimersByTime(10 * 60_000); // a slow server: still loading after 10 min
    expect(sourceOf(layer)).toBe(first);
    finish(first, "load");
    const loadedAt = T0 + 10 * 60_000;
    expect(loads).toEqual([[loadedAt, 256, 256]]);
    vi.advanceTimersByTime(59_999);
    expect(sourceOf(layer)).toBe(first);
    vi.advanceTimersByTime(1);
    const second = sourceOf(layer);
    expect(second).not.toBe(first);
    expect(second.getUrl()).toBe(`${URL_NANAAO}?t=${loadedAt + 60_000}`);
  });

  it("an error (404 included) calls onError and schedules the next request as well", () => {
    const { layer, loads, errors } = setup();
    const first = sourceOf(layer);
    finish(first, "error");
    expect(errors()).toBe(1);
    expect(loads).toEqual([]);
    vi.advanceTimersByTime(60_000);
    const second = sourceOf(layer);
    expect(second).not.toBe(first);
    finish(second, "load");
    expect(loads).toHaveLength(1);
  });

  it("refreshSec below 60 s is raised to 60 s", () => {
    const { layer } = setup({ refreshSec: 5 });
    const first = sourceOf(layer);
    finish(first, "load");
    vi.advanceTimersByTime(59_999);
    expect(sourceOf(layer)).toBe(first);
    vi.advanceTimersByTime(1);
    expect(sourceOf(layer)).not.toBe(first);
  });

  it("stop() mid-request puts the shown source back and ignores the late load", () => {
    const { layer, loads, stop } = setup();
    const shown = sourceOf(layer);
    finish(shown, "load");
    vi.advanceTimersByTime(60_000);
    const inFlight = sourceOf(layer);
    expect(inFlight).not.toBe(shown);
    stop();
    expect(layer.getSource()).toBe(shown); // the frozen frame stays the one onLoad reported
    finish(inFlight, "load");
    expect(loads).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(layer.getSource()).toBe(shown);
  });

  it("stop() before the first image leaves the layer as it was (empty)", () => {
    const { layer, stop } = setup();
    expect(layer.getSource()).not.toBeNull();
    stop();
    expect(layer.getSource()).toBeNull();
  });

  it("stop() between loads cancels the timer; a second stop() does nothing", () => {
    const { layer, stop } = setup();
    const shown = sourceOf(layer);
    finish(shown, "load");
    stop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(layer.getSource()).toBe(shown);
    stop();
    expect(layer.getSource()).toBe(shown);
  });

  it("onLoad may stop the loop: no further request", () => {
    const layer = new ImageLayer<ImageSource>();
    let stop: () => void = () => {};
    stop = startStillImageRefresh(layer, skyPixelProjection(1232, 1232), {
      imageUrl: URL_NANAAO,
      refreshSec: 60,
      corsEnabled: false,
      widthPx: 1232,
      heightPx: 1232,
      onLoad: () => stop(),
      onError: () => {},
    });
    const shown = sourceOf(layer);
    finish(shown, "load");
    vi.advanceTimersByTime(10 * 60_000);
    expect(layer.getSource()).toBe(shown);
  });
});
