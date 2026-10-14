// CameraPicker (M4 step 13): every enabled camera, a native radio group, status as text plus a shape. [Redesign] The
// header's segmented control: short plain names, a status dot, words in the description, and "Watch live" while the
// recorded clip is on. Rendered with renderToStaticMarkup (no DOM in unit tests).
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

/** The text of the element with the given id (its nested spans' text, tags dropped). */
function textOfId(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  const open = html.indexOf(">", start) + 1;
  const close = html.indexOf("</label>", open);
  return html
    .slice(open, close)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The visible short names, in order. */
const names = (html: string): string[] =>
  [...html.matchAll(/<span class="cam-seg-name">([^<]*)<\/span>/g)].map((m) => m[1] ?? "");

describe("CameraPickerView ([Redesign] the header's segmented control)", () => {
  it("is a fieldset with a hidden legend and one radio per camera, in order, sharing one name", () => {
    const html = render();
    expect(html).toContain('<fieldset><legend class="visually-hidden">Camera</legend>');
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

  it("names each camera by its short plain name, and describes it by its full name and status in words", () => {
    const html = render();
    expect(names(html)).toEqual([
      "Computed sky, Maunakea",
      "CFHT Nānā ao all-sky (visible)",
      "Subaru live",
      "CFHT live",
    ]);
    expect(radios(html).map((r) => textOfId(html, r.describedBy))).toEqual([
      "Computed sky, Maunakea, Live",
      "CFHT Nānā ao all-sky (visible), Offline offline",
      "Subaru-Asahi StarCam (east, live), Not checked",
      "CFHT-Asahi StarCam (west, live), Daytime daytime",
    ]);
  });

  it("[Redesign] keeps the description out of the radio's name: the described span is aria-hidden, still referenced", () => {
    const html = render();
    const spans = [
      ...html.matchAll(/<span id="([^"]+)" class="visually-hidden" aria-hidden="true">/g),
    ];
    expect(spans.map((m) => m[1])).toEqual(radios(html).map((r) => r.describedBy));
  });

  it("shows a status dot for every camera, and a word only for offline and daytime", () => {
    const html = render();
    expect(html.match(/<span aria-hidden="true" class="cam-seg-dot"><\/span>/g)).toHaveLength(4);
    expect([...html.matchAll(/data-status="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "live",
      "offline",
      "unknown",
      "daytime",
    ]);
    const words = [...html.matchAll(/<span aria-hidden="true">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(words).toEqual(["offline", "daytime"]);
  });

  it("names the recorded clip 'ISS pass (recorded)' and offers Watch live while it is on", () => {
    const clip = get("subaru-2026-10-11-iss");
    const live = get("subaru-starcam");
    const onWatchLive = vi.fn();
    const html = render({
      entries: [
        { camera: clip, status: "unknown" },
        { camera: live, status: "live" },
      ],
      activeId: clip.id,
      onWatchLive,
    });
    expect(names(html)).toEqual(["ISS pass (recorded)", "Subaru live"]);
    expect(html).toContain('data-status="recorded"');
    expect(html).toMatch(
      /<button type="button" class="btn-primary watch-live">.*Watch live<\/button>/,
    );
    // On a live camera: no Watch live button.
    expect(
      render({ entries: [{ camera: live, status: "live" }], activeId: live.id }),
    ).not.toContain("Watch live");
  });

  it("says when the camera list is loading or failed", () => {
    expect(render({ entries: [], cameras: "loading" })).toContain(
      '<div role="status" class="cam-switch-status">Loading cameras</div>',
    );
    expect(render({ entries: [], cameras: "error" })).toContain(
      '<div role="status" class="cam-switch-status">The camera list failed to load</div>',
    );
    expect(render()).toContain('<div role="status" class="cam-switch-status"></div>');
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
    actions.setActiveCamera("synthetic-maunakea"); // [Redesign] the app store opens on the recorded clip
    actions.setLoadStatus("cameras", "ready");
    const before = renderToStaticMarkup(createElement(CameraPicker));
    expect(before).toContain("Computed sky, Maunakea, Live");
    expect(before).toContain("CFHT Nānā ao all-sky (visible), Not checked");
    expect(
      radios(before)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["synthetic-maunakea"]);

    actions.setCameraStatus("cfht-nanaao", "offline");
    actions.setActiveCamera("cfht-nanaao");
    const after = renderToStaticMarkup(createElement(CameraPicker));
    expect(after).toContain(
      'CFHT Nānā ao all-sky (visible), Offline</span><span aria-hidden="true">offline',
    );
    expect(
      radios(after)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["cfht-nanaao"]);
  });
});
