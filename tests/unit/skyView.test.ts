// SkyView for image cameras (M4 steps 10.4, 10.7, 11.2, 11.5 and 14.4): the aria-label, the image-size notice, the
// replay caption with "Back to live", "Fit frame", the focusable map and the calibration crosshair. Rendered with
// renderToStaticMarkup against the app store (no DOM, so the map effect does not run; the e2e specs drive it).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enabledCameras } from "../../src/app/cameras";
import { backgroundImageSize } from "../../src/map/sync/bindBackground";
import { store } from "../../src/state/store";
import { SkyView } from "../../src/ui/SkyView";
import { committedCameras } from "../helpers/store";

const FRAME = Date.parse("2026-10-11T07:59:20Z");
const render = (): string => renderToStaticMarkup(createElement(SkyView));

/** The opening tag of the element carrying data-map="sky". */
const mapTag = (html: string): string => /<div[^>]*data-map="sky"[^>]*>/.exec(html)?.[0] ?? "";

beforeEach(() => {
  // Server rendering reads getInitialState(); point it at the live state for these renders.
  vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
  const { actions } = store.getState();
  actions.setRegistry(enabledCameras(committedCameras()));
  actions.setActiveCamera("synthetic-maunakea");
  actions.openPanel(null);
  actions.setMode("live");
});

afterEach(() => {
  vi.restoreAllMocks();
  backgroundImageSize.cameraId = null;
  backgroundImageSize.widthPx = 0;
  backgroundImageSize.heightPx = 0;
});

describe("SkyView on a synthetic camera (M2 unchanged)", () => {
  it("keeps M2's label, a map that takes no keys, no Fit frame and no crosshair", () => {
    store.getState().actions.togglePanel("calibration");
    const html = render();
    expect(html).toContain(
      'aria-label="Computed sky for Computed sky, Maunakea: zenith fisheye, north up, east left"',
    );
    expect(mapTag(html)).not.toContain("tabindex");
    expect(mapTag(html)).not.toContain('role="application"');
    expect(html).not.toContain("Fit frame");
    expect(html).not.toContain('data-testid="sky-crosshair"');
  });

  it("shows no image caption in replay", () => {
    const { actions } = store.getState();
    actions.setFrameTimeMs(FRAME);
    actions.setMode("replay");
    expect(render()).not.toContain("Image captured");
  });
});

describe("SkyView on a still-image camera", () => {
  beforeEach(() => {
    store.getState().actions.setActiveCamera("cfht-nanaao");
  });

  it("is labelled as the computed sky over the camera's image (step 11.5)", () => {
    const html = render();
    expect(html).toContain(
      'aria-label="Computed sky over the image from CFHT Nānā ao all-sky (visible)"',
    );
    expect(html).not.toContain("zenith fisheye");
  });

  it("the map is a focusable application for OpenLayers' keyboard pan and zoom, with Fit frame (step 11.2)", () => {
    const html = render();
    const tag = mapTag(html);
    expect(tag).toContain('tabindex="0"');
    expect(tag).toContain('role="application"');
    expect(tag).toContain('aria-roledescription="map"');
    expect(tag).toContain(
      'aria-label="Sky map over the image from CFHT Nānā ao all-sky (visible)"',
    );
    expect(html).toContain('<button type="button">Fit frame</button>');
  });

  it("an aria-hidden centre crosshair only while the Calibration panel is open (step 14.4)", () => {
    expect(render()).not.toContain('data-testid="sky-crosshair"');
    store.getState().actions.togglePanel("calibration");
    const html = render();
    expect(html).toMatch(/<div aria-hidden="true" data-testid="sky-crosshair"[^>]*>/);
    store.getState().actions.togglePanel("layers");
    expect(render()).not.toContain('data-testid="sky-crosshair"');
  });

  it("the image-size notice for this camera's image only (step 10.4)", () => {
    expect(render()).not.toContain("Image is");
    backgroundImageSize.cameraId = "cfht-nanaao";
    backgroundImageSize.widthPx = 256;
    backgroundImageSize.heightPx = 256;
    expect(render()).toContain(
      "<p>Image is 256 × 256 px; the calibration assumes 1232 × 1232 px</p>",
    );
    backgroundImageSize.widthPx = 1232;
    backgroundImageSize.heightPx = 1232;
    expect(render()).not.toContain("Image is");
    backgroundImageSize.cameraId = "synthetic-maunakea";
    backgroundImageSize.widthPx = 256;
    backgroundImageSize.heightPx = 256;
    expect(render()).not.toContain("Image is");
  });

  it("in replay: 'Image captured HH:MM:SS UTC' and Back to live (step 10.7); not in live", () => {
    const { actions } = store.getState();
    actions.setFrameTimeMs(FRAME);
    expect(render()).not.toContain("Image captured");
    actions.setMode("replay");
    const html = render();
    expect(html).toContain("Image captured 07:59:20 UTC");
    expect(html).toContain('<button type="button">Back to live</button>');
    actions.setFrameTimeMs(null); // no image yet: nothing to caption
    expect(render()).not.toContain("Image captured");
  });
});
