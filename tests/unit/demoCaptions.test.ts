// tests/unit/demoCaptions.test.ts — the Tour region (M9 step 10 rule 7; [Redesign] five plain steps, the last live),
// rendered with renderToStaticMarkup from the app's store (no DOM in unit tests). [Redesign] The key list is the
// header's [?] popover now (KeyboardShortcuts, the shell's); keyboard.test.ts checks KEY_MAP itself.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enabledCameras } from "../../src/app/cameras";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { store } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import { DemoCaptions } from "../../src/ui/DemoCaptions";
import { committedCameras } from "../helpers/store";

const CLIP_ID = "subaru-2026-10-11-iss";
const enabled = enabledCameras(committedCameras());

function withClip(loaded: boolean): Record<string, CameraConfig> {
  const out: Record<string, CameraConfig> = {};
  for (const [id, camera] of Object.entries(enabled)) {
    out[id] =
      id === CLIP_ID && camera.kind === "local-video" && loaded
        ? {
            ...camera,
            source: { ...camera.source, videoUrl: "blob:test", startUtcMs: 1791731310183 },
          }
        : camera;
  }
  return out;
}

const render = (): string => renderToStaticMarkup(createElement(DemoCaptions));
/** The visible text, tags stripped. */
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const button = (html: string, name: string): string =>
  new RegExp(`<button[^>]*>${name}</button>`).exec(html)?.[0] ?? "";

beforeEach(() => {
  // Server rendering reads zustand's getInitialState: point it at the live state (as incomingChip.test does).
  vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
  store.setState(initialState(Date.parse("2026-10-11T15:20:00Z"), DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(withClip(false));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DemoCaptions", () => {
  it("is the Tour region with one polite live region holding the caption", () => {
    store.getState().actions.startDemo();
    const html = render();
    expect(html).toMatch(/^<section aria-label="Tour"(?: class="[^"]*")?>/); // [M9] a class for the visual design
    expect(html.match(/aria-live=/g)).toHaveLength(1);
    expect(html).toContain(
      '<p aria-live="polite">This is a sky camera on Maunakea, Hawaii, filmed on the night the International Space Station flew over. The labels on the video are added by this site.</p>',
    );
    expect(html).not.toContain("role=");
  });

  it("intro: loading the clip disables Start; a missing clip says the tour goes straight to live", () => {
    const { actions } = store.getState();
    actions.startDemo();
    actions.setActiveCamera(CLIP_ID);
    let html = render();
    expect(text(html)).toContain("Loading the recorded video…");
    expect(button(html, "Start the tour")).toContain("disabled");
    expect(button(html, "Pause tour")).toBe("");
    expect(button(html, "Previous")).toBe("");

    actions.setVideoStatus("error");
    html = render();
    expect(text(html)).toContain(
      "The recorded video is not included in this copy of the site, so the tour goes straight to the live camera.",
    );
    expect(text(html)).toContain("Step 1 of 2"); // the intro and live
    expect(text(html)).not.toContain("computed sky");
    expect(button(html, "Start the tour")).not.toContain("disabled");

    actions.setRegistry(withClip(true));
    actions.setVideoStatus("paused");
    html = render();
    expect(text(html)).toContain("Step 1 of 5");
    expect(text(html)).not.toContain("Loading the recorded video");
    expect(text(html)).not.toContain("not included");
    expect(button(html, "Start the tour")).not.toContain("disabled");
  });

  it("timed steps show Step n of 5, the caption and Previous, Pause tour, Next and Exit tour", () => {
    const { actions } = store.getState();
    actions.setRegistry(withClip(true));
    actions.startDemo();
    actions.setDemoStep(1);
    let html = render();
    expect(text(html)).toContain("Step 2 of 5");
    expect(text(html)).toContain("the International Space Station appears");
    for (const name of ["Previous", "Next", "Exit tour"]) expect(button(html, name)).not.toBe("");
    expect(button(html, "Pause tour")).toContain('aria-pressed="false"');
    actions.setDemoPaused(true);
    html = render();
    expect(button(html, "Pause tour")).toContain('aria-pressed="true"'); // the label never changes
    for (const jargon of ["NORAD", "OGC", "GeoPose", "WMTS", "GIBS", "azimuth", "Walenstadt"])
      for (let step = 0; step < 5; step++) {
        actions.setDemoStep(step);
        expect(text(render())).not.toContain(jargon);
      }
  });

  it("the last step, live: its caption, Restart tour and Exit tour; a blocked stream says so", () => {
    const { actions } = store.getState();
    actions.setRegistry(withClip(true));
    actions.startDemo();
    actions.setDemoStep(4);
    actions.setActiveCamera("subaru-starcam");
    let html = render();
    expect(text(html)).toContain("Step 5 of 5");
    expect(text(html)).toContain("This is the same camera, live.");
    for (const name of ["Restart tour", "Exit tour", "Previous"]) {
      expect(button(html, name)).not.toBe("");
    }
    expect(button(html, "Next")).toBe("");
    expect(button(html, "Pause tour")).toBe("");

    actions.setVideoStatus("embed-blocked", 150);
    html = render();
    expect(text(html)).toContain("The live stream cannot play here right now.");
  });
});
