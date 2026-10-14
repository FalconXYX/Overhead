// CalibrationPanel (M4 step 14): structure, states and accessibility, rendered with renderToStaticMarkup (no DOM in
// unit tests; the e2e spec drives the handlers). Also skyViewCentreImagePx, the keyboard path's view centre.
import { readFileSync } from "node:fs";
import type OlMap from "ol/Map";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StarRow } from "../../src/domain/astro";
import { type Calibration, createCameraModel, projectAzAltDeg } from "../../src/domain/camera";
import { registry } from "../../src/map/registry";
import { skyViewCentreImagePx } from "../../src/map/sky/viewCentre";
import { store } from "../../src/state/store";
import type {
  Actions,
  CalibrationUiState,
  CameraConfig,
  StarPair,
  StillImageCamera,
} from "../../src/state/types";
import { CalibrationDrawer } from "../../src/ui/CalibrationDrawer";
import { CalibrationPanel, CalibrationPanelView } from "../../src/ui/CalibrationPanel";
import { catalogTargetsAt, targetsById } from "../../src/ui/calibrationPairs";
import { committedCameras } from "../helpers/store";

const ROWS = JSON.parse(
  readFileSync(new URL("../../public/data/stars.json", import.meta.url), "utf8"),
) as StarRow[];
const cameras = committedCameras();
const nanaao = cameras["cfht-nanaao"] as StillImageCamera;
const synthetic = cameras["synthetic-maunakea"] as CameraConfig;
const T = Date.parse("2026-10-11T08:00:00Z");
const FRAME = T - 40_000; // load time − captureLagMs
const EMPTY_UI: CalibrationUiState = { pairs: [], pendingPx: null, fit: null };
const NO_ACTIONS = {} as Actions; // rendering never calls an action

type ViewProps = Parameters<typeof CalibrationPanelView>[0];

function render(props: Partial<ViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(CalibrationPanelView, {
      open: true,
      camera: nanaao,
      calibration: nanaao.defaults,
      ui: EMPTY_UI,
      frameTimeMs: FRAME,
      rows: ROWS,
      stars: "ready",
      imageSizeNotice: null,
      actions: NO_ACTIONS,
      ...props,
    }),
  );
}

/** The <input> opening tags whose attributes match all the given fragments. */
function inputs(html: string, ...fragments: string[]): string[] {
  return [...html.matchAll(/<input[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => fragments.every((f) => tag.includes(f)));
}

/** The id of the label element with this text. */
function labelId(html: string, text: string): string {
  const m = new RegExp(
    `<label id="([^"]+)" for="[^"]+">${text.replace(/[()]/g, "\\$&")}</label>`,
  ).exec(html);
  if (m?.[1] === undefined) throw new Error(`no label "${text}"`);
  return m[1];
}

const pair = (targetId: StarPair["targetId"], role: StarPair["role"] = "fit"): StarPair => ({
  imagePx: [600, 600],
  targetId,
  role,
  residualPx: null,
  rejected: false,
});

describe("pointing and lens fields", () => {
  it("gives each field a range input and a number input, both named by one label with its unit", () => {
    const html = render();
    for (const label of [
      "Azimuth (°)",
      "Altitude (°)",
      "Roll (°)",
      "Focal length (px)",
      "Principal point x (px)",
      "Principal point y (px)",
      "Radial distortion k1 (no unit)",
    ]) {
      const id = labelId(html, label);
      expect(inputs(html, 'type="range"', `id="${id.replace("-label", "-range")}"`)).toHaveLength(
        1,
      );
      expect(inputs(html, 'type="number"', `aria-labelledby="${id}"`)).toHaveLength(1);
    }
  });

  it("carries aria-valuetext with the unit and shows the step's digits", () => {
    const html = render();
    expect(
      inputs(html, 'type="range"', 'aria-valuetext="227.30 degrees"', 'value="227.3"'),
    ).toHaveLength(1);
    expect(inputs(html, 'type="range"', 'aria-valuetext="373.1 pixels"')).toHaveLength(1);
    expect(inputs(html, 'type="range"', 'aria-valuetext="0.0030"')).toHaveLength(1);
    const az = labelId(html, "Azimuth (°)");
    expect(inputs(html, `aria-labelledby="${az}"`, 'value="227.30"')).toHaveLength(1);
  });

  it("shows the field across the width beside the focal length, k2 read-only, and flipX as a checkbox", () => {
    const html = render();
    expect(html).toMatch(
      /<label for="([^"]+)">Field across the width \(°\)<\/label> <input id="\1" type="number"/,
    );
    expect(inputs(html, 'type="number"', 'value="189.19"', 'max="360"')).toHaveLength(1);
    expect(html).toContain(
      "Radial distortion k2 (no unit, set only by an import): <output>0.0000</output>",
    );
    expect(html).toContain('<input type="checkbox" checked=""/>Mirrored image (flip x)');
  });

  it("disables the azimuth, and says why, while a fisheye points at the zenith", () => {
    const html = render({ camera: synthetic, calibration: synthetic.defaults, frameTimeMs: null });
    const az = labelId(html, "Azimuth (°)");
    const [range] = inputs(html, `id="${az.replace("-label", "-range")}"`);
    const [number] = inputs(html, `aria-labelledby="${az}"`);
    expect(range).toContain('disabled=""');
    expect(number).toContain('disabled=""');
    const note = /aria-describedby="([^"]+)"/.exec(range ?? "")?.[1];
    expect(html).toContain(
      `<span id="${note}">Disabled while the camera points at the zenith: roll turns the image.</span>`,
    );
    const tilted = render({ calibration: { ...nanaao.defaults, altDeg: 88 } });
    expect(inputs(tilted, 'type="range"', 'disabled=""')).toHaveLength(0);
  });
});

describe("header and image time", () => {
  it("names the camera and its lens", () => {
    expect(render()).toContain(
      "<p>Camera: CFHT Nānā ao all-sky (visible). Lens: Equidistant fisheye.</p>",
    );
  });

  it("shows the frame time in UTC and the site's zone, estimated until entered, and the stamp input", () => {
    const html = render();
    expect(html).toContain(
      '<p>UTC <time dateTime="2026-10-11T07:59:20Z">2026-10-11T07:59:20Z</time>, estimated (± 30 s)</p>',
    );
    expect(html).toContain("<p>Pacific/Honolulu 2026-10-10 21:59:20, estimated (± 30 s)</p>");
    expect(html).toContain("<p>Image frozen while calibrating.</p>");
    expect(html).toMatch(
      /<label for="([^"]+)">Enter burned-in time<\/label> <input id="\1" type="datetime-local" step="1"/,
    );
    expect(inputs(html, 'type="datetime-local"', 'value="2026-10-10T21:58:00"')).toHaveLength(1);
    expect(html).toContain("It is to the minute; the image time is the stamp + 30 s.");
  });

  it("says so before the first image, and has no image time on a synthetic camera", () => {
    expect(render({ frameTimeMs: null })).toContain("<p>No image yet.</p>");
    const html = render({ camera: synthetic, calibration: synthetic.defaults, frameTimeMs: null });
    expect(html).not.toContain("Image time");
    expect(html).toContain("<p>Star pairs need a camera image on screen.</p>");
    expect(html).not.toContain(">Fit</button>");
  });

  it("shows the image-size notice when given one", () => {
    const notice = "Image is 256 × 256 px; the calibration assumes 1232 × 1232 px";
    expect(render({ imageSizeNotice: notice })).toContain(`<p>${notice}</p>`);
  });
});

describe("star pairs", () => {
  it("offers the keyboard path and says there are no pairs yet", () => {
    const html = render();
    expect(html).toContain('<button type="button">Add point at view centre</button>');
    expect(html).toContain("<p>No pairs yet.</p>");
    expect(html).toContain('<h3 tabindex="-1">Star pairs</h3>');
  });

  it("lists the 3 catalogue objects nearest a pending point as buttons, plus Cancel point", () => {
    // Put the pending point 2 px from Vega's marker under the defaults.
    const vega = targetsById(catalogTargetsAt(ROWS, nanaao.site, FRAME)).get("star:7001");
    const model = createCameraModel({
      lens: nanaao.lens,
      calibration: nanaao.defaults,
      widthPx: 1232,
      heightPx: 1232,
    });
    const uv = new Float64Array(2);
    expect(
      projectAzAltDeg(model, vega?.azDeg ?? Number.NaN, vega?.altDeg ?? Number.NaN, uv, 0),
    ).toBe(true);
    const pendingPx = [(uv[0] ?? 0) + 2, uv[1] ?? 0] as const;
    const html = render({ ui: { ...EMPTY_UI, pendingPx } });
    const list = /<ul aria-label="Nearest catalogue objects">(.*?)<\/ul>/.exec(html)?.[1] ?? "";
    const buttons = [...list.matchAll(/<button type="button">([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toBe("Vega, 2.0 px away");
    expect(html).toContain('<button type="button">Cancel point</button>');
    expect(html).toContain(
      `<p>Point at u ${pendingPx[0].toFixed(1)}, v ${pendingPx[1].toFixed(1)}. Nearest catalogue objects:</p>`,
    );
  });

  it("tables each pair with its name, role, residuals, rejected flag and Remove", () => {
    const pairs: StarPair[] = [
      { ...pair("star:7001"), residualPx: 1.234, rejected: false },
      { ...pair("planet:Saturn", "holdout"), residualPx: Number.NaN },
      { ...pair("star:424"), residualPx: 9.5, rejected: true },
    ];
    const html = render({ ui: { pairs, pendingPx: null, fit: null } });
    expect(html).toContain("<caption>3 pairs, 2 for the fit</caption>");
    const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th>(.*?)<\/tr>/g)];
    expect(rows.map((r) => r[1])).toEqual(["Vega", "Saturn", "Polaris"]);
    expect(rows[0]?.[2]).toContain('<select aria-label="Role of Vega">');
    expect(rows[0]?.[2]).toContain("<td>1.23</td><td>—</td><td>No</td>");
    expect(rows[1]?.[2]).toContain('<option value="holdout" selected="">Holdout</option>');
    expect(rows[1]?.[2]).toContain("<td>—</td><td>—</td><td>No</td>");
    expect(rows[2]?.[2]).toContain("<td>9.50</td><td>—</td><td>Rejected</td>");
    expect(rows[2]?.[2]).toContain(
      '<button type="button" aria-label="Remove Polaris">Remove</button>',
    );
    expect(html).toContain('<button type="button" aria-pressed="false">Sort by residual</button>');
    expect(html).toContain('<button type="button">Clear pairs</button>');
  });

  it("falls back to 'HR n' for a star the loaded catalogue does not hold", () => {
    const html = render({
      rows: [],
      stars: "loading",
      ui: { pairs: [pair("star:7001")], pendingPx: null, fit: null },
    });
    expect(html).toContain('<th scope="row">HR 7001</th>');
    expect(html).toContain("<p>Loading the star catalogue: planets only for now.</p>");
    expect(render({ rows: [], stars: "error" })).toContain(
      "<p>The star catalogue failed to load: planets only.</p>",
    );
  });
});

describe("fit", () => {
  const fourFit = [pair("star:7001"), pair("star:424"), pair("star:5340"), pair("star:6134")];

  it("enables Fit at 4 fit pairs and says when k1 is held below 8", () => {
    const three = render({ ui: { pairs: fourFit.slice(0, 3), pendingPx: null, fit: null } });
    expect(three).toMatch(
      /<button type="button" disabled="" aria-describedby="[^"]+">Fit<\/button>/,
    );
    expect(three).toContain("Needs at least 4 fit pairs (3 now).");
    const four = render({ ui: { pairs: fourFit, pendingPx: null, fit: null } });
    expect(four).toMatch(/<button type="button" aria-describedby="[^"]+">Fit<\/button>/);
    expect(four).toContain("<p>Fewer than 8 fit pairs: the fit holds k1.</p>");
    // Holdouts never count towards the fit.
    const holdouts = render({
      ui: {
        pairs: [...fourFit.slice(0, 3), pair("planet:Saturn", "holdout")],
        pendingPx: null,
        fit: null,
      },
    });
    expect(holdouts).toContain("Needs at least 4 fit pairs (3 now).");
  });

  it("shows Fit tilt only while the calibration is a zenith-locked fisheye", () => {
    expect(render()).not.toContain("Fit tilt");
    const locked: Calibration = { ...nanaao.defaults, azDeg: 0, altDeg: 90 };
    const html = render({
      calibration: locked,
      ui: { pairs: fourFit, pendingPx: null, fit: null },
    });
    expect(html).toContain('<input type="checkbox" checked=""/>Fit tilt</label>');
    expect(html).toContain('<input type="checkbox" checked=""/>Fit k1</label>');
    expect(html).toContain("<p>Fewer than 8 fit pairs: the fit holds k1 and the tilt.</p>");
    // A tilted camera always fits its full rotation, so only k1 is held.
    expect(render({ ui: { pairs: fourFit, pendingPx: null, fit: null } })).toContain(
      "the fit holds k1.",
    );
  });

  it("reads out the last fit's RMS in px and degrees and its largest errors", () => {
    const fit = { rmsPx: 1.234, rmsDeg: 0.0412, maxFitDeg: 0.1, maxHoldoutDeg: null };
    const html = render({ ui: { pairs: fourFit, pendingPx: null, fit } });
    expect(html).toContain(
      "<dl><dt>RMS</dt><dd>1.23 px, 0.041°</dd><dt>Largest fit error</dt><dd>0.100°</dd><dt>Largest holdout error</dt><dd>No holdouts</dd></dl>",
    );
  });

  it("offers Compare lens models on fisheyes with an image, enabled at 4 fit pairs", () => {
    expect(render()).toContain('<button type="button" disabled="">Compare lens models</button>');
    expect(render({ ui: { pairs: fourFit, pendingPx: null, fit: null } })).toContain(
      '<button type="button">Compare lens models</button>',
    );
    expect(
      render({ camera: synthetic, calibration: synthetic.defaults, frameTimeMs: null }),
    ).not.toContain("Compare lens models");
  });
});

describe("files and the live region", () => {
  it("has Reset, Export JSON, Import JSON, Export GeoPose and Import GeoPose", () => {
    const html = render();
    expect(html).toContain('<h3 tabindex="-1">Files</h3>');
    expect(html).toContain('<button type="button">Reset</button>');
    expect(html).toContain('<button type="button">Export JSON</button>');
    expect(html).toContain(
      '<label>Import JSON <input type="file" accept=".json,application/json"/></label>',
    );
    expect(html).toContain('<button type="button">Export GeoPose</button>');
    expect(html).toContain(
      '<label>Import GeoPose <input type="file" accept=".json,application/json"/></label>',
    );
  });

  it("ends with one polite live region", () => {
    const html = render();
    expect(html.match(/aria-live=/g)).toHaveLength(1);
    expect(html).toContain('<p aria-live="polite"></p>');
  });
});

describe("CalibrationPanel (store-connected)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[Redesign] lives in the Camera alignment (advanced) drawer, hidden until the panel opens", () => {
    // Server rendering reads getInitialState(); point it at the live state for these renders.
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.setRegistry({ "synthetic-maunakea": synthetic, "cfht-nanaao": nanaao });
    actions.openPanel(null);
    const closed = renderToStaticMarkup(createElement(CalibrationDrawer));
    expect(closed).toMatch(
      /^<section id="camera-alignment" aria-labelledby="([^"]+)" class="drawer" hidden=""><header class="drawer-head"><h2 id="\1">Camera alignment \(advanced\)<\/h2><button type="button" class="btn-icon btn-quiet" aria-label="Close camera alignment">/,
    );
    actions.togglePanel("calibration");
    actions.setActiveCamera("cfht-nanaao");
    const open = renderToStaticMarkup(createElement(CalibrationDrawer));
    expect(open).not.toContain('hidden=""');
    expect(open).toContain('<div class="drawer-body"><div class="calibration">');
    expect(open).toContain("Camera: CFHT Nānā ao all-sky (visible). Lens: Equidistant fisheye.");
    expect(open).toContain("<p>No image yet.</p>");
    // The panel's own content has no toggle of its own any more.
    expect(renderToStaticMarkup(createElement(CalibrationPanel))).toMatch(
      /^<div class="calibration">/,
    );
    actions.openPanel(null);
  });
});

describe("skyViewCentreImagePx", () => {
  afterEach(() => {
    registry.clear();
  });

  it("turns the sky view's centre [x, y] into the image pixel (x, H − y)", () => {
    expect(skyViewCentreImagePx(1232)).toBeNull();
    const view = { getCenter: () => [600.5, 1000] };
    registry.set("sky", { getView: () => view } as unknown as OlMap);
    expect(skyViewCentreImagePx(1232)).toEqual([600.5, 232]);
    registry.set("sky", { getView: () => ({ getCenter: () => undefined }) } as unknown as OlMap);
    expect(skyViewCentreImagePx(1232)).toBeNull();
  });
});
