// CameraPicker (M4 step 13): every enabled camera in cameras.json order, a native radio group, status as text plus
// a shape. Rendered with renderToStaticMarkup (no DOM in unit tests).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { store } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import { CameraPicker, type CameraPickerEntry, CameraPickerView } from "../../src/ui/CameraPicker";
import { committedCameras } from "../helpers/store";

const cameras = committedCameras();
const get = (id: string): CameraConfig => {
  const camera = cameras[id];
  if (camera === undefined) throw new Error(`${id} missing`);
  return camera;
};

const entries: CameraPickerEntry[] = [
  { camera: get("synthetic-maunakea"), status: "live" },
  { camera: get("cfht-nanaao"), status: "offline" },
  { camera: get("subaru-starcam"), status: "unknown" },
  { camera: get("cfht-starcam"), status: "daytime" },
];

const render = (props: Partial<Parameters<typeof CameraPickerView>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(CameraPickerView, {
      entries,
      activeId: "cfht-nanaao",
      cameras: "ready",
      onChoose: () => {},
      ...props,
    }),
  );

/** Every radio input's attributes, in document order. */
function radios(
  html: string,
): { name: string; value: string; checked: boolean; describedBy: string }[] {
  return [...html.matchAll(/<input type="radio"([^>]*)\/>/g)].map((m) => {
    const attrs = m[1] ?? "";
    const attr = (name: string): string => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";
    return {
      name: attr("name"),
      value: attr("value"),
      checked: /checked=""/.test(attrs),
      describedBy: attr("aria-describedby"),
    };
  });
}

/** The text of the element with the given id (one level of nesting is enough here). */
function textOfId(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  const open = html.indexOf(">", start) + 1;
  const close = html.indexOf("</span></p>", open);
  return html
    .slice(open, close)
    .replace(/<span aria-hidden="true">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("CameraPickerView", () => {
  it("is a fieldset with a legend and one radio per camera, in order, sharing one name", () => {
    const html = render();
    expect(html.startsWith("<fieldset><legend>Camera</legend>")).toBe(true);
    const all = radios(html);
    expect(all.map((r) => r.value)).toEqual([
      "synthetic-maunakea",
      "cfht-nanaao",
      "subaru-starcam",
      "cfht-starcam",
    ]);
    expect(new Set(all.map((r) => r.name)).size).toBe(1);
    expect(all[0]?.name).not.toBe("");
  });

  it("checks the active camera only", () => {
    const html = render();
    expect(
      radios(html)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["cfht-nanaao"]);
  });

  it("labels each radio with the camera name and describes its kind and status in words", () => {
    const html = render();
    expect(html).toContain(">CFHT Nānā ao all-sky (visible)</label>");
    expect(radios(html).map((r) => textOfId(html, r.describedBy))).toEqual([
      "Computed sky, Live",
      "Still image, Offline",
      "Live video, Not checked",
      "Live video, Daytime",
    ]);
  });

  it("pairs every status with a shape hidden from assistive technology", () => {
    const html = render();
    const shapes = [...html.matchAll(/<span aria-hidden="true">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(shapes).toEqual(["●", "✕", "?", "☀"]);
  });

  it("says when the camera list is loading or failed", () => {
    expect(render({ entries: [], cameras: "loading" })).toContain(
      '<div role="status">Loading cameras</div>',
    );
    expect(render({ entries: [], cameras: "error" })).toContain(
      '<div role="status">The camera list failed to load</div>',
    );
    expect(render()).toContain('<div role="status"></div>');
  });
});

describe("CameraPicker (store-connected)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows synthetic cameras as Live and a still camera's stored status, else Not checked", () => {
    // Server rendering reads getInitialState(); point it at the live state for this render.
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.setRegistry({
      "synthetic-maunakea": get("synthetic-maunakea"),
      "cfht-nanaao": get("cfht-nanaao"),
    });
    actions.setLoadStatus("cameras", "ready");
    const before = renderToStaticMarkup(createElement(CameraPicker));
    expect(before).toContain('Computed sky, <span aria-hidden="true">●</span> Live');
    expect(before).toContain('Still image, <span aria-hidden="true">?</span> Not checked');
    expect(
      radios(before)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["synthetic-maunakea"]);

    actions.setCameraStatus("cfht-nanaao", "offline");
    actions.setActiveCamera("cfht-nanaao");
    const after = renderToStaticMarkup(createElement(CameraPicker));
    expect(after).toContain('Still image, <span aria-hidden="true">✕</span> Offline');
    expect(
      radios(after)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["cfht-nanaao"]);
  });
});
