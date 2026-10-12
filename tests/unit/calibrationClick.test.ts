// The sky map's calibration clicks (M4 steps 11.3 and 14.4): a singleclick's map coordinate [x, y] is the image pixel
// (x, H − y); pairClick decides add, complete or ignore against the catalogue markers at the frame time; and
// applyPairClick calls addImagePoint or completePair. Only on a still-image camera with the panel open and an image on
// screen; otherwise the click selects as usual (null).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StarRow } from "../../src/domain/astro";
import { createCameraModel } from "../../src/domain/camera";
import { applyPairClick, calibrationClickAt } from "../../src/map/sky/calibrationClick";
import type { AppStore } from "../../src/state/store";
import type { StillImageCamera } from "../../src/state/types";
import {
  catalogTargetsAt,
  type ProjectedTarget,
  projectTargets,
} from "../../src/ui/calibrationPairs";
import { storeAt } from "../helpers/store";

const T = Date.parse("2026-10-11T08:00:00Z"); // 22:00 HST: Saturn at about 60° (M4 step 18)
const FRAME = T - 40_000; // load time − captureLagMs
const ROWS = JSON.parse(
  readFileSync(new URL("../../public/data/stars.json", import.meta.url), "utf8"),
) as StarRow[];

/** cfht-nanaao active, an image on screen, the Calibration panel open, the catalogue loaded. */
function calibrating(): { store: AppStore; camera: StillImageCamera } {
  const store = storeAt("2026-10-11T08:00:00Z");
  const { actions } = store.getState();
  actions.setActiveCamera("cfht-nanaao");
  actions.setFrameTimeMs(FRAME);
  actions.setLoadStatus("stars", "ready");
  actions.togglePanel("calibration");
  const camera = store.getState().camera.registry["cfht-nanaao"] as StillImageCamera;
  return { store, camera };
}

/** The markers the panel and the click rule use, under the registry defaults. */
function projected(camera: StillImageCamera, rows: readonly StarRow[]): ProjectedTarget[] {
  const { widthPx, heightPx } = camera.imageSize;
  const model = createCameraModel({
    lens: camera.lens,
    calibration: camera.defaults,
    widthPx,
    heightPx,
  });
  return projectTargets(model, catalogTargetsAt(rows, camera.site, FRAME));
}

/** A projected target with no other marker within `clearPx` image pixels. */
function isolated(list: readonly ProjectedTarget[], kind: "star" | "planet", clearPx: number) {
  const found = list.find(
    (p) =>
      p.target.kind === kind &&
      list.every((q) => q === p || Math.hypot(q.uPx - p.uPx, q.vPx - p.vPx) > clearPx),
  );
  if (found === undefined) throw new Error(`no isolated ${kind}`);
  return found;
}

describe("calibrationClickAt", () => {
  it("adds a point at (u, v) = (x, H − y) when none is pending", () => {
    const { store } = calibrating();
    expect(calibrationClickAt(store.getState(), ROWS, 600.5, 1000, 1)).toEqual({
      kind: "add",
      uPx: 600.5,
      vPx: 232,
    });
  });

  it("ignores a click outside [0, W] × [0, H]", () => {
    const { store } = calibrating();
    const s = store.getState();
    expect(calibrationClickAt(s, ROWS, -0.5, 600, 1)).toEqual({ kind: "ignore" });
    expect(calibrationClickAt(s, ROWS, 1232.5, 600, 1)).toEqual({ kind: "ignore" });
    expect(calibrationClickAt(s, ROWS, 600, 1233, 1)).toEqual({ kind: "ignore" }); // v = −1
    expect(calibrationClickAt(s, ROWS, 600, -1, 1)).toEqual({ kind: "ignore" }); // v = H + 1
    expect(calibrationClickAt(s, ROWS, 0, 0, 1)).toEqual({ kind: "add", uPx: 0, vPx: 1232 });
  });

  it("completes the pending pair within 6 screen px of a star marker, scaled by the resolution", () => {
    const { store, camera } = calibrating();
    const H = camera.imageSize.heightPx;
    const star = isolated(projected(camera, ROWS), "star", 40);
    store.getState().actions.addImagePoint(100, 100);
    const s = store.getState();
    const y = H - star.vPx;
    // Resolution 1: 5 image px is 5 screen px.
    expect(calibrationClickAt(s, ROWS, star.uPx + 5, y, 1)).toEqual({
      kind: "complete",
      targetId: star.target.id,
    });
    // Zoomed in 4× (resolution 0.25): 5 image px is 20 screen px, a new point instead.
    expect(calibrationClickAt(s, ROWS, star.uPx + 5, y, 0.25)).toEqual({
      kind: "add",
      uPx: star.uPx + 5,
      vPx: star.vPx,
    });
    expect(calibrationClickAt(s, ROWS, star.uPx + 1, y, 0.25)).toEqual({
      kind: "complete",
      targetId: star.target.id,
    });
  });

  it("without the catalogue only planets complete a pair", () => {
    const { store, camera } = calibrating();
    const H = camera.imageSize.heightPx;
    const star = isolated(projected(camera, ROWS), "star", 40);
    const saturn = projected(camera, []).find((p) => p.target.id === "planet:Saturn");
    expect(saturn).toBeDefined();
    const { actions } = store.getState();
    actions.setLoadStatus("stars", "loading");
    actions.addImagePoint(100, 100);
    const s = store.getState();
    expect(calibrationClickAt(s, ROWS, star.uPx, H - star.vPx, 1)).toMatchObject({ kind: "add" });
    expect(
      calibrationClickAt(s, ROWS, saturn?.uPx ?? Number.NaN, H - (saturn?.vPx ?? Number.NaN), 1),
    ).toEqual({ kind: "complete", targetId: "planet:Saturn" });
  });

  it("uses the stored calibration, not the registry defaults", () => {
    const { store, camera } = calibrating();
    const H = camera.imageSize.heightPx;
    const star = isolated(projected(camera, ROWS), "star", 40);
    const { actions } = store.getState();
    actions.updateCalibration({ cxPx: camera.defaults.cxPx + 30 }); // every marker moves 30 px right
    actions.addImagePoint(100, 100);
    const s = store.getState();
    expect(calibrationClickAt(s, ROWS, star.uPx, H - star.vPx, 1)).toMatchObject({ kind: "add" });
    const moved = calibrationClickAt(s, ROWS, star.uPx + 30, H - star.vPx, 1);
    expect(moved).toEqual({ kind: "complete", targetId: star.target.id });
  });

  it("null (an ordinary click) with the panel closed, without an image, or on a synthetic camera", () => {
    const { store } = calibrating();
    const { actions } = store.getState();
    actions.togglePanel("calibration");
    expect(calibrationClickAt(store.getState(), ROWS, 600, 600, 1)).toBeNull();
    actions.togglePanel("calibration");
    actions.setFrameTimeMs(null);
    expect(calibrationClickAt(store.getState(), ROWS, 600, 600, 1)).toBeNull();
    actions.setActiveCamera("synthetic-maunakea");
    expect(store.getState().ui.panel).toBe("calibration");
    expect(calibrationClickAt(store.getState(), ROWS, 600, 600, 1)).toBeNull();
    actions.setActiveCamera("nope");
    expect(calibrationClickAt(store.getState(), ROWS, 600, 600, 1)).toBeNull();
  });

  it("null for a non-finite coordinate or resolution", () => {
    const { store } = calibrating();
    const s = store.getState();
    expect(calibrationClickAt(s, ROWS, Number.NaN, 600, 1)).toEqual({ kind: "ignore" });
    expect(calibrationClickAt(s, ROWS, 600, 600, Number.NaN)).toBeNull();
  });
});

describe("applyPairClick", () => {
  it("add → addImagePoint (replacing a pending point); complete → completePair; ignore → nothing", () => {
    const { store, camera } = calibrating();
    const star = isolated(projected(camera, ROWS), "star", 40);
    applyPairClick(store.getState().actions, { kind: "add", uPx: 10, vPx: 20 });
    expect(store.getState().calibrationUi.pendingPx).toEqual([10, 20]);
    applyPairClick(store.getState().actions, { kind: "add", uPx: 30, vPx: 40 });
    expect(store.getState().calibrationUi.pendingPx).toEqual([30, 40]);
    const before = store.getState();
    applyPairClick(before.actions, { kind: "ignore" });
    expect(store.getState()).toBe(before);
    applyPairClick(store.getState().actions, { kind: "complete", targetId: star.target.id });
    const ui = store.getState().calibrationUi;
    expect(ui.pendingPx).toBeNull();
    expect(ui.pairs).toHaveLength(1);
    expect(ui.pairs[0]).toMatchObject({ imagePx: [30, 40], targetId: star.target.id, role: "fit" });
  });
});
