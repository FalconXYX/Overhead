// tests/unit/videoControls.test.ts — the M5 controls outside VideoPanel, rendered with renderToStaticMarkup against the
// app store (no DOM): the Layers panel's "On the video" group (step 8.8), the Timeline's "Follows the video"
// description (step 12.1), and the Calibration panel's stream-delay section and star-pair text (step 9).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import { store } from "../../src/state/store";
import type { Actions, YoutubeCamera } from "../../src/state/types";
import { CalibrationPanelView } from "../../src/ui/CalibrationPanel";
import { LayerToggles } from "../../src/ui/LayerToggles";
import { Timeline } from "../../src/ui/Timeline";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const T = Date.parse("2026-10-11T08:00:00Z");

beforeEach(() => {
  vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
  const json: unknown = JSON.parse(
    readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
  );
  const { actions } = store.getState();
  actions.setRegistry(parseCameraRegistry(withM5CameraEntries(json)));
  actions.setActiveCamera("synthetic-maunakea");
  actions.openPanel(null);
  for (const key of ["starlink", "grid", "denseLabels"] as const) actions.setVideoLayer(key, false);
  actions.recenter(T);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayerToggles: On the video", () => {
  const render = (): string => renderToStaticMarkup(createElement(LayerToggles));

  it("is absent while the sky is not over a video", () => {
    expect(render()).not.toContain("On the video");
    store.getState().actions.setActiveCamera("cfht-nanaao");
    expect(render()).not.toContain("On the video");
  });

  it("shows three unchecked boxes over a YouTube player or a clip, the Starlink one with its note", () => {
    for (const id of ["subaru-starcam", "local-replay"]) {
      store.getState().actions.setActiveCamera(id);
      const html = render();
      const group =
        /<fieldset><legend>On the video<\/legend>(.*?)<\/fieldset>/.exec(html)?.[1] ?? "";
      expect(group, id).toContain("Starlink on the video");
      expect(group).toContain("Grid on the video");
      expect(group).toContain("All labels on the video");
      expect(group).toContain("Also needs the Starlink layer, which loads the data.");
      const boxes = [...group.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
      expect(boxes).toHaveLength(3);
      for (const box of boxes) expect(box).not.toContain("checked");
    }
    store.getState().actions.setVideoLayer("grid", true);
    const html = render();
    const checked = [...html.matchAll(/<input type="checkbox"[^>]*checked=""[^>]*\/?>([^<]*)/g)];
    expect(checked.some((m) => (m[1] ?? "").includes("Grid on the video"))).toBe(true);
  });
});

describe("Timeline: Follows the video", () => {
  const render = (): string => renderToStaticMarkup(createElement(Timeline));

  it("describes the live mode readout on a YouTube camera only", () => {
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    actions.setMode("live");
    const html = render();
    const id = /data-testid="time-mode" aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}">Follows the video</span>`);
    expect(html).toMatch(/data-testid="time-mode"[^>]*>Live<\/span>/);
    actions.setMode("replay");
    expect(render()).not.toContain("Follows the video");
    actions.setActiveCamera("synthetic-maunakea");
    actions.setMode("live");
    expect(render()).not.toContain("Follows the video");
  });
});

describe("CalibrationPanelView on a YouTube camera", () => {
  it("has the stream-delay section with labelled inputs in seconds, and star pairs off", () => {
    const camera = store.getState().camera.registry["subaru-starcam"] as YoutubeCamera;
    store.getState().actions.setActiveCamera("subaru-starcam");
    const html = renderToStaticMarkup(
      createElement(CalibrationPanelView, {
        open: true,
        camera,
        calibration: camera.defaults,
        ui: { pairs: [], pendingPx: null, fit: null },
        frameTimeMs: null,
        rows: [],
        stars: "ready",
        imageSizeNotice: null,
        actions: {} as Actions,
      }),
    );
    expect(html).toContain("<h3>Stream delay</h3>");
    expect(html).toContain(">Stream delay, seconds</label>");
    expect(html).toContain(">Fine adjust, seconds</label>");
    expect(html).toContain(">Stream delay (exact), seconds</label>");
    expect(html).toContain('aria-valuetext="50.0 seconds"');
    expect(html).toContain("Delay at start of playback: 50.0 s");
    expect(html).toContain("Behind real time now: 50.0 s (0.0 s of pauses and buffering)");
    expect(html).toContain(">Video clock (Pacific/Honolulu)</label>");
    expect(html).toContain("Available once the video plays.");
    expect(html).not.toContain("The player suggests");
    expect(html).toContain(
      "Star pairs need a still image or a clip. Align by eye against the video, or calibrate a recorded clip of this camera and copy its pointing here.",
    );
    // One live region: the readouts stay outside it.
    expect(html.match(/aria-live=/g)).toHaveLength(1);
  });
});
