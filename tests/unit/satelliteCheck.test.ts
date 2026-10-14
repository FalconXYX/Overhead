// tests/unit/satelliteCheck.test.ts — M5 step 13 and step 11.4: star-pair clicks on a paused clip, the Satellite
// check's click routing (calibrationClick.ts), one click's residual (satelliteCheckRow), the summary line, and the
// section as rendered in the Calibration panel (renderToStaticMarkup; no DOM).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import type { StarRow } from "../../src/domain/astro";
import {
  createCameraModel,
  projectAzAltDeg,
  satelliteCheckSummary,
  unprojectPixel,
} from "../../src/domain/camera";
import {
  calibrationClickAt,
  satelliteCheckClickAt,
  setSatelliteCheckClicks,
} from "../../src/map/sky/calibrationClick";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig, LocalVideoCamera } from "../../src/state/types";
import {
  SatelliteCheck,
  satelliteCheckEnabled,
  satelliteCheckRow,
  satelliteCheckSummaryText,
} from "../../src/ui/SatelliteCheck";
import { withM5CameraEntries } from "../helpers/m5Cameras";
import { TEST_CAMERA_ID } from "../helpers/store";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
const registry: Record<string, CameraConfig> = parseCameraRegistry(withM5CameraEntries(committed));
const ROWS = JSON.parse(
  readFileSync(new URL("../../public/data/stars.json", import.meta.url), "utf8"),
) as StarRow[];
const T = Date.parse("2026-10-11T15:10:00Z");
const CLIP_ID = "subaru-2026-10-11-iss";
const clipCamera = registry[CLIP_ID] as LocalVideoCamera;
const model = createCameraModel({
  lens: clipCamera.lens,
  calibration: clipCamera.defaults,
  widthPx: 3840,
  heightPx: 2160,
});

/** The clip camera active and paused on a frame, with the Calibration panel open. */
function pausedClip(): AppStore {
  const store = createAppStore(initialState(T, TEST_CAMERA_ID));
  const { actions } = store.getState();
  actions.setRegistry({ ...registry });
  actions.setActiveCamera(CLIP_ID);
  actions.setFrameTimeMs(T);
  actions.togglePanel("calibration");
  return store;
}

const removers: (() => void)[] = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

describe("calibration clicks on a clip (M5 step 11.4)", () => {
  it("a paused clip takes star-pair clicks like a still image: (u, v) = (x, H − y)", () => {
    const store = pausedClip();
    expect(calibrationClickAt(store.getState(), ROWS, 1000, 2160 - 700, 6)).toEqual({
      kind: "add",
      uPx: 1000,
      vPx: 700,
    });
  });

  it("no pair while the clip plays (no frame time) or the panel is closed", () => {
    const store = pausedClip();
    store.getState().actions.setFrameTimeMs(null);
    expect(calibrationClickAt(store.getState(), ROWS, 1000, 1000, 6)).toBeNull();
    store.getState().actions.setFrameTimeMs(T);
    store.getState().actions.togglePanel("calibration");
    expect(calibrationClickAt(store.getState(), ROWS, 1000, 1000, 6)).toBeNull();
  });
});

describe("satelliteCheckClickAt", () => {
  it("hands the image pixel to the Satellite check while it takes clicks, and nothing else then", () => {
    const store = pausedClip();
    const clicks: [number, number][] = [];
    expect(satelliteCheckClickAt(store.getState(), 100, 2000)).toBe(false); // no handler: a star-pair click
    removers.push(setSatelliteCheckClicks((u, v) => clicks.push([u, v])));
    expect(satelliteCheckClickAt(store.getState(), 100, 2000)).toBe(true);
    expect(clicks).toEqual([[100, 160]]);
  });

  it("does not take clicks with the panel closed, without a frame, on a synthetic camera or off the map", () => {
    const store = pausedClip();
    const clicks: [number, number][] = [];
    removers.push(setSatelliteCheckClicks((u, v) => clicks.push([u, v])));
    const { actions } = store.getState();
    actions.togglePanel("calibration");
    expect(satelliteCheckClickAt(store.getState(), 1, 1)).toBe(false);
    actions.togglePanel("calibration");
    actions.setFrameTimeMs(null);
    expect(satelliteCheckClickAt(store.getState(), 1, 1)).toBe(false);
    actions.setFrameTimeMs(T);
    expect(satelliteCheckClickAt(store.getState(), Number.NaN, 1)).toBe(false);
    actions.setActiveCamera(TEST_CAMERA_ID);
    actions.setFrameTimeMs(T);
    expect(satelliteCheckClickAt(store.getState(), 1, 1)).toBe(false);
    expect(clicks).toEqual([]);
  });

  it("a remover clears only its own handler", () => {
    const store = pausedClip();
    const first = setSatelliteCheckClicks(() => {});
    const seen: number[] = [];
    removers.push(setSatelliteCheckClicks((u) => seen.push(u)));
    first(); // stale: the second handler stays
    expect(satelliteCheckClickAt(store.getState(), 7, 7)).toBe(true);
    expect(seen).toEqual([7]);
  });
});

describe("satelliteCheckRow", () => {
  const out = new Float64Array(2);

  it("a click on the marker has residual 0° and 0 px", () => {
    expect(projectAzAltDeg(model, 100, 25, out, 0)).toBe(true);
    const row = satelliteCheckRow(model, 100, 25, T, out[0] ?? 0, out[1] ?? 0);
    expect(row?.residualDeg).toBeLessThan(1e-6);
    expect(row?.residualPx).toBeLessThan(1e-6);
    expect(row?.timeMs).toBe(T);
  });

  it("44.09 px from the axis is about 1° with the settled Subaru fit (M5 step 18.7)", () => {
    expect(unprojectPixel(model, 1920, 1080, out, 0)).toBe(true);
    const [az = 0, alt = 0] = out;
    const row = satelliteCheckRow(model, az, alt, T, 1920 + 44.09, 1080);
    expect(row?.residualDeg).toBeCloseTo(1.0, 2);
    expect(row?.residualPx).toBeCloseTo(44.09, 6);
  });

  it("null when the click does not unproject; residualPx null when the marker is culled", () => {
    expect(satelliteCheckRow(model, 100, 25, T, Number.NaN, 1)).toBeNull();
    // The ISS at 15:08:08Z, 84.51° off the axis: culled by projectAzAltDeg (gotcha G13).
    const row = satelliteCheckRow(model, 172.11, 18.99, T, 1920, 1080);
    expect(row?.residualPx).toBeNull();
    expect(row?.residualDeg).toBeGreaterThan(80);
  });
});

describe("satelliteCheckSummaryText", () => {
  it("reads like the M5 example", () => {
    const samples = [0.3, 0.4, 0.5, 0.55, 0.56, 0.57, 0.59, 0.65, 0.7, 0.75, 0.8, 0.85].map(
      (residualDeg, i) => ({ timeMs: T + 2_000 * i, residualDeg }),
    );
    expect(satelliteCheckSummaryText(satelliteCheckSummary(samples, 1.0))).toBe(
      "12 samples, largest gap 2.0 s, max 0.85°, median 0.58°: pass",
    );
    expect(satelliteCheckSummaryText(satelliteCheckSummary([], 1.0))).toBe(
      "0 samples, no gap yet, max none, median none: fail",
    );
    expect(
      satelliteCheckSummaryText(satelliteCheckSummary([{ timeMs: T, residualDeg: 0.2 }], 1.0)),
    ).toBe("1 sample, no gap yet, max 0.20°, median 0.20°: fail");
  });
});

describe("SatelliteCheck (rendered)", () => {
  const render = (frameTimeMs: number | null): string =>
    renderToStaticMarkup(
      createElement(SatelliteCheck, {
        camera: clipCamera,
        calibration: clipCamera.defaults,
        frameTimeMs,
        announce: () => {},
      }),
    );

  it("is disabled, with its rule, until a satellite is selected on a paused frame", () => {
    const html = render(T);
    expect(html).toContain("<h3");
    expect(html).toContain("Satellite check");
    expect(html).toMatch(/<fieldset disabled=""[^>]*><legend>Clicks add<\/legend>/);
    expect(html).toContain("star pairs");
    expect(html).toContain("satellite check");
    expect(html).toContain("&amp;sel=sat:25544");
    expect(html).toContain("0 samples, no gap yet, max none, median none: fail");
    expect(html).toMatch(/<button type="button" disabled="">Export check<\/button>/);
    expect(html).not.toContain("aria-live"); // the panel keeps its one polite live region
  });

  it("is enabled only on a paused frame with a satellite selected", () => {
    expect(satelliteCheckEnabled("local-video", T, false, "sat:25544")).toBe(true);
    expect(satelliteCheckEnabled("local-video", T, true, "sat:25544")).toBe(false); // playing
    expect(satelliteCheckEnabled("local-video", null, false, "sat:25544")).toBe(false); // no frame
    expect(satelliteCheckEnabled("local-video", T, false, "planet:Jupiter")).toBe(false);
    expect(satelliteCheckEnabled("local-video", T, false, null)).toBe(false);
    // A still image is frozen while the panel is open, whatever the clock does.
    expect(satelliteCheckEnabled("still-image", T, true, "sat:25544")).toBe(true);
  });
});
