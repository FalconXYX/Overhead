// tests/unit/videoControls.test.ts — the controls outside VideoPanel, rendered with renderToStaticMarkup against the
// app store (no DOM): [Redesign] the Layers popover's two plain groups and the control bar (live versus clip), and the
// Calibration panel's stream-delay section and star-pair text (M5 step 9).
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
  actions.setMode("replay");
  actions.recenter(T);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** [Redesign] A switch's checkbox tag, found by its label text. */
const switchTag = (html: string, label: string): string =>
  new RegExp(
    `<span class="switch-label">(?:<span[^>]*></span>)?${label}</span>(<input[^>]*>)`,
  ).exec(html)?.[1] ?? "";

describe("LayerToggles ([Redesign] two plain groups in a popover)", () => {
  const render = (): string => renderToStaticMarkup(createElement(LayerToggles));

  it("has the On the video and On the map groups with the spec's plain labels, a key and the alignment button", () => {
    store.getState().actions.setActiveCamera("subaru-starcam");
    const html = render();
    const group = (legend: string): string =>
      new RegExp(`<legend>${legend}</legend>(.*?)</fieldset>`).exec(html)?.[1] ?? "";
    const labels = (g: string): string[] =>
      [...g.matchAll(/<span class="switch-label">(?:<span[^>]*><\/span>)?([^<]+)<\/span>/g)].map(
        (m) => m[1] ?? "",
      );
    expect(labels(group("On the video"))).toEqual([
      "Satellites",
      "Starlink",
      "Stars",
      "Planets and Moon",
      "Trails",
      "Grid lines",
      "Horizon line",
    ]);
    expect(labels(group("On the map"))).toEqual([
      "Cloud imagery (10 min)",
      "Terrain shading",
      "Camera view at orbit height",
      "Satellite paths",
    ]);
    expect(html).toContain('<h3 class="legend-title">Colour key</h3>');
    expect(html).toMatch(
      /<button type="button" class="btn-quiet" aria-controls="camera-alignment" aria-expanded="false">Camera alignment \(advanced\)<\/button>/,
    );
    // No jargon in the panel (spec section 3).
    for (const word of ["NORAD", "GIBS", "GOES", "az/alt", "Alt/az", "magnitude", "EPSG"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("is a closed popover until ui.panel is layers", () => {
    expect(render()).toMatch(
      /^<div class="popover layers"><button type="button" class="header-button" aria-expanded="false" aria-controls="layers-panel">Layers<\/button><section id="layers-panel" aria-label="Layers"[^>]* hidden="">/,
    );
    store.getState().actions.openPanel("layers");
    const open = render();
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain('hidden=""');
  });

  it("over a video, Starlink and Grid lines are on only with their video gates; one switch sets both", () => {
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    actions.setLayer("starlink", true); // the data layer alone: not on the video
    expect(switchTag(render(), "Starlink")).not.toContain("checked");
    actions.setVideoLayer("starlink", true);
    expect(switchTag(render(), "Starlink")).toContain('checked=""');
    expect(switchTag(render(), "Grid lines")).not.toContain("checked");
    actions.setVideoLayer("grid", true);
    expect(switchTag(render(), "Grid lines")).toContain('checked=""');
    actions.setLayer("starlink", false);
  });

  it("Satellite paths follows layers.tracks", () => {
    const { actions } = store.getState();
    expect(switchTag(render(), "Satellite paths")).toContain('checked=""');
    actions.setLayer("tracks", false);
    expect(switchTag(render(), "Satellite paths")).not.toContain("checked");
    actions.setLayer("tracks", true);
  });
});

describe("Timeline ([Redesign] the control bar)", () => {
  const render = (): string => renderToStaticMarkup(createElement(Timeline));

  it("on a live camera: the LIVE badge and no play, rate, step or scrubber; Watch the recorded ISS pass", () => {
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    actions.setMode("live");
    const html = render();
    expect(html).toMatch(/<span class="live-badge" data-testid="time-mode">.*Live<\/span>/);
    expect(html).toContain("Waiting for the video…");
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toMatch(/>(Play|Pause|Back 1 second|Forward 1 minute|Now)</);
    expect(html).toContain(">Watch the recorded ISS pass</button>");
    actions.setMode("replay");
    expect(render()).toContain(">Back to live</button>");
  });

  it("on the recorded clip: play, a scrubber over the clip and m:ss / m:ss (dashes until it loads)", () => {
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-2026-10-11-iss");
    const html = render();
    expect(html).toContain('<span class="visually-hidden">Play</span>');
    expect(html).toMatch(
      /<input type="range" class="cb-scrubber" aria-label="Position in the recording"/,
    );
    expect(html).toContain('data-testid="clip-position">–:–– / –:––</span>');
    expect(html).not.toContain("live-badge");
    expect(html).not.toContain("Watch the recorded ISS pass");
  });

  it("shows the local time in plain words, with UTC only in the tooltip and dateTime", () => {
    store.getState().actions.setActiveCamera("subaru-starcam");
    const html = render();
    expect(html).toContain(
      '<time class="cb-clock" data-testid="time-local" dateTime="2026-10-11T08:00:00Z" title="2026-10-11 08:00:00 UTC">22:00 in Hawaii</time>',
    );
  });

  it("has In view, Fullscreen and Copy link", () => {
    store.getState().actions.setActiveCamera("subaru-starcam");
    const html = render();
    expect(html).toMatch(/aria-expanded="false" aria-controls="[^"]+">In view<\/button>/);
    expect(html).toContain('<section id="');
    expect(html).toContain('aria-label="In view"');
    expect(html).toContain('aria-label="Fullscreen"');
    // [Polish] Its words in a span (phones show the icon alone): still its name.
    expect(html).toMatch(/<\/svg><span class="cb-copy-text">Copy link<\/span><\/button>/);
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
