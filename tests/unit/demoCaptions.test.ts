// tests/unit/demoCaptions.test.ts — the Tour region (M9 step 10 rule 7) and the on-screen key list (step 9), rendered
// with renderToStaticMarkup from the app's store (no DOM in unit tests).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enabledCameras } from "../../src/app/cameras";
import { KEY_MAP } from "../../src/app/keyboard";
import { buildGeoPoseExport } from "../../src/app/persist";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { store } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import { DemoCaptions, GeoPoseResultView } from "../../src/ui/DemoCaptions";
import { KeyboardShortcuts } from "../../src/ui/KeyboardShortcuts";
import { committedCameras } from "../helpers/store";

const CLIP_ID = "subaru-2026-10-11-iss";
const enabled = enabledCameras(committedCameras());

function withClip(loaded: boolean, live = true): Record<string, CameraConfig> {
  const out: Record<string, CameraConfig> = {};
  for (const [id, camera] of Object.entries(enabled)) {
    if (id === "subaru-starcam" && !live) continue;
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
      '<p aria-live="polite">A guided tour of Overhead: satellites, the ISS, the Moon, planets and bright stars, computed and drawn over a sky camera, with the same moment on a ground map.</p>',
    );
    expect(html).not.toContain("role=");
  });

  it("intro: loading the clip disables Start; a failed or absent clip says the tour runs on the computed sky", () => {
    const { actions } = store.getState();
    actions.startDemo();
    actions.setActiveCamera(CLIP_ID);
    let html = render();
    expect(text(html)).toContain("Loading the recorded clip…");
    expect(button(html, "Start the tour")).toContain("disabled");
    expect(text(html)).not.toContain("Step ");
    expect(button(html, "Pause tour")).toBe("");

    actions.setVideoStatus("error");
    html = render();
    expect(text(html)).toContain(
      "The recorded clip is not part of this build, so the tour runs on the computed sky.",
    );
    expect(button(html, "Start the tour")).not.toContain("disabled");

    actions.setRegistry(withClip(true));
    actions.setVideoStatus("paused");
    html = render();
    expect(text(html)).not.toContain("Loading the recorded clip");
    expect(text(html)).not.toContain("not part of this build");
    expect(button(html, "Start the tour")).not.toContain("disabled");
  });

  it("timed steps show Step n of N, the path's caption and Previous, Pause tour, Next and Exit tour", () => {
    const { actions } = store.getState();
    actions.setRegistry(withClip(true));
    actions.startDemo();
    actions.setDemoStep(1);
    let html = render();
    expect(text(html)).toContain("Step 1 of 8");
    expect(text(html)).toContain("The Subaru-Asahi StarCam on Maunakea, recorded on 2026-10-11");
    for (const name of ["Previous", "Next", "Exit tour"]) expect(button(html, name)).not.toBe("");
    expect(button(html, "Pause tour")).toContain('aria-pressed="false"');
    actions.setDemoPaused(true);
    html = render();
    expect(button(html, "Pause tour")).toContain('aria-pressed="true"'); // the label never changes

    actions.setRegistry(withClip(false, false));
    actions.setDemoStep(7);
    html = render();
    expect(text(html)).toContain("Step 7 of 7");
  });

  it("the OGC step validates the active camera's GeoPose, then shows it", async () => {
    const { actions } = store.getState();
    actions.setActiveCamera(DEFAULT_CAMERA_ID);
    actions.startDemo();
    actions.setDemoStep(4);
    // The check runs in an effect (ajv may load on demand): the first render says so.
    expect(text(render())).toContain("Validating the pose against the official schema…");

    const camera = enabled[DEFAULT_CAMERA_ID];
    if (camera === undefined) throw new Error("no synthetic-maunakea");
    const result = await buildGeoPoseExport(camera, camera.defaults);
    const html = text(renderToStaticMarkup(createElement(GeoPoseResultView, { result })));
    expect(html).toContain(
      "Valid against the OGC GeoPose 1.0 Basic-YPR schema (synthetic-maunakea).",
    );
    expect(html).toContain("&quot;x-overhead&quot;");
    const failed = renderToStaticMarkup(
      createElement(GeoPoseResultView, {
        result: { ok: false, errors: ["/position/lat must be in [-90, 90]"] },
      }),
    );
    expect(text(failed)).toContain(
      "The pose does not validate: /position/lat must be in [-90, 90]",
    );
  });

  it("the end: the caption, Restart tour and Exit tour, and no step number", () => {
    const { actions } = store.getState();
    actions.startDemo();
    actions.setDemoStep(9);
    const html = render();
    expect(text(html)).toContain("End of the tour.");
    expect(text(html)).not.toContain("Step ");
    for (const name of ["Restart tour", "Exit tour", "Previous"]) {
      expect(button(html, name)).not.toBe("");
    }
    expect(button(html, "Next")).toBe("");
    expect(button(html, "Pause tour")).toBe("");
  });
});

describe("KeyboardShortcuts", () => {
  it("lists KEY_MAP inside a closed <details> named Keyboard shortcuts", () => {
    const html = renderToStaticMarkup(createElement(KeyboardShortcuts));
    expect(html).toMatch(/^<details(?: class="[^"]*")?><summary>Keyboard shortcuts<\/summary>/);
    expect(html.match(/<th scope="row">/g)).toHaveLength(KEY_MAP.length);
    for (const row of KEY_MAP) expect(html).toContain(`<th scope="row">${row.keys}</th>`);
  });
});
