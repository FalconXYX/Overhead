// bindBackground (M4 step 10, section 5 row): a store from createAppStore, a real ImageLayer, and a fake `start`
// that captures its projection and options, so the binding runs without a DOM.
import ImageLayer from "ol/layer/Image";
import type Projection from "ol/proj/Projection";
import type ImageSource from "ol/source/Image";
import ImageStatic from "ol/source/ImageStatic";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StillRefreshOptions } from "../../src/map/sky/layers/background";
import {
  backgroundImageSize,
  bindBackground,
  type StartStillImageRefresh,
} from "../../src/map/sync/bindBackground";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import { committedCameras } from "../helpers/store";

const NIGHT = Date.parse("2026-10-11T08:00:00Z"); // 22:00 HST
const NOON = Date.parse("2026-10-11T22:00:00Z"); // 12:00 HST

interface Run {
  readonly projection: Projection;
  readonly options: StillRefreshOptions;
  stopped: boolean;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NIGHT);
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(activeId = DEFAULT_CAMERA_ID) {
  const store: AppStore = createAppStore(initialState(NIGHT, DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(committedCameras()); // cfht-nanaao is committed but not yet enabled
  store.getState().actions.setActiveCamera(activeId);
  const layer = new ImageLayer<ImageSource>();
  const runs: Run[] = [];
  const start: StartStillImageRefresh = (_layer, projection, options) => {
    const run: Run = { projection, options, stopped: false };
    runs.push(run);
    return () => {
      run.stopped = true;
    };
  };
  const unbind = bindBackground(store, layer, start);
  const running = (): Run[] => runs.filter((r) => !r.stopped);
  const current = (): Run => {
    const live = running();
    expect(live).toHaveLength(1);
    return live[0] as Run;
  };
  return { store, layer, runs, running, current, unbind };
}

/** A pending point and two pairs, as the Calibration panel would leave them. */
function addPairs(store: AppStore): void {
  const { actions } = store.getState();
  actions.addImagePoint(600, 400);
  actions.completePair("star:424");
  actions.addImagePoint(700, 500);
  actions.completePair("planet:Saturn");
  actions.addImagePoint(10, 10);
}

describe("bindBackground", () => {
  it("runs no loop for a synthetic camera", () => {
    const { runs } = setup();
    expect(runs).toHaveLength(0);
  });

  it("after synthetic-maunakea → cfht-nanaao: one loop in sky-px-1232x1232 with the camera's source fields", () => {
    const { store, runs, current } = setup();
    store.getState().actions.setActiveCamera("cfht-nanaao");
    expect(runs).toHaveLength(1);
    const run = current();
    expect(run.projection.getCode()).toBe("sky-px-1232x1232");
    expect(run.projection.getExtent()).toEqual([0, 0, 1232, 1232]);
    expect(run.options).toMatchObject({
      imageUrl: "https://www.cfht.hawaii.edu/~nanaao/last_vis.png",
      refreshSec: 60,
      corsEnabled: false,
      widthPx: 1232,
      heightPx: 1232,
    });
  });

  it("load: frameTimeMs = load − 40,000, status live, pairs cleared, natural size recorded", () => {
    const { store, current } = setup("cfht-nanaao");
    addPairs(store);
    expect(store.getState().calibrationUi.pairs).toHaveLength(2);
    expect(store.getState().camera.status["cfht-nanaao"]).toBeUndefined();
    const loadedAt = NIGHT + 1_234;
    current().options.onLoad(loadedAt, 256, 256);
    const s = store.getState();
    expect(s.camera.frameTimeMs).toBe(loadedAt - 40_000);
    expect(s.camera.status["cfht-nanaao"]).toBe("live");
    expect(s.calibrationUi).toEqual({ pairs: [], pendingPx: null, fit: null });
    expect(backgroundImageSize).toEqual({ cameraId: "cfht-nanaao", widthPx: 256, heightPx: 256 });
  });

  it("error at 2026-10-11T08:00Z → offline, at 22:00Z → daytime; frameTimeMs is kept", () => {
    const { store, current } = setup("cfht-nanaao");
    const run = current();
    run.options.onLoad(NIGHT, 1232, 1232);
    const frame = store.getState().camera.frameTimeMs;
    run.options.onError();
    expect(store.getState().camera.status["cfht-nanaao"]).toBe("offline");
    vi.setSystemTime(NOON);
    run.options.onError();
    expect(store.getState().camera.status["cfht-nanaao"]).toBe("daytime");
    expect(store.getState().camera.frameTimeMs).toBe(frame);
  });

  it("panel open with an image → stopped; closed → restarted; never two loops at once", () => {
    const { store, runs, running, current } = setup("cfht-nanaao");
    const { actions } = store.getState();
    current().options.onLoad(NIGHT, 1232, 1232);
    actions.togglePanel("calibration");
    expect(running()).toHaveLength(0);
    expect(runs).toHaveLength(1);
    store.getState().actions.setFrameTimeMs(NIGHT - 12_000); // "Enter burned-in time" while frozen
    expect(running()).toHaveLength(0);
    actions.togglePanel("calibration");
    expect(runs).toHaveLength(2);
    current();
    actions.openPanel("layers"); // another panel does not freeze the image
    current();
    expect(runs).toHaveLength(2);
  });

  it("panel open before the first image: the loop runs until an image is on screen, then stops", () => {
    const { store, running, current } = setup("cfht-nanaao");
    store.getState().actions.togglePanel("calibration");
    const run = current();
    run.options.onError(); // a 404: nothing on screen yet
    expect(running()).toEqual([run]);
    run.options.onLoad(NIGHT, 1232, 1232);
    expect(running()).toHaveLength(0);
    expect(store.getState().camera.frameTimeMs).toBe(NIGHT - 40_000);
  });

  it("camera change → stopped and setSource(null); stale callbacks are ignored", () => {
    const { store, layer, runs, running, current } = setup("cfht-nanaao");
    const run = current();
    layer.setSource(
      new ImageStatic({ url: "https://example.invalid/x.png", imageExtent: [0, 0, 1, 1] }),
    );
    run.options.onLoad(NIGHT, 640, 480);
    store.getState().actions.setActiveCamera(DEFAULT_CAMERA_ID);
    expect(running()).toHaveLength(0);
    expect(layer.getSource()).toBeNull();
    expect(backgroundImageSize).toEqual({ cameraId: DEFAULT_CAMERA_ID, widthPx: 0, heightPx: 0 });
    run.options.onLoad(NIGHT + 60_000, 1232, 1232);
    run.options.onError();
    expect(store.getState().camera.frameTimeMs).toBeNull();
    expect(store.getState().camera.status["cfht-nanaao"]).toBe("live"); // from the first load only
    store.getState().actions.setActiveCamera("cfht-nanaao");
    expect(runs).toHaveLength(2);
    expect(running()).toHaveLength(1);
  });

  it("clock ticks start nothing", () => {
    const { store, runs } = setup("cfht-nanaao");
    for (let i = 1; i <= 100; i++) store.getState().actions.tick(NIGHT + i * 16);
    expect(runs).toHaveLength(1);
  });

  it("unbind stops the loop and later changes start none", () => {
    const { store, runs, running, unbind } = setup("cfht-nanaao");
    unbind();
    expect(running()).toHaveLength(0);
    store.getState().actions.setActiveCamera(DEFAULT_CAMERA_ID);
    store.getState().actions.setActiveCamera("cfht-nanaao");
    expect(runs).toHaveLength(1);
  });
});
