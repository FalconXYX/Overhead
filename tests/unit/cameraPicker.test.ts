// CameraPicker (M4 step 13): every enabled camera, status as text plus a shape. [Redesign] Short plain names, a status
// dot, words in the description, and "Watch live" while the recorded clip is on. [Polish] A menu button and its menu,
// grouped "Recorded" and "Live", so 8 cameras fit: rows named by their short name alone, a place line with the sky at
// the site, and "Unavailable" for a clip that failed to load. Rendered with renderToStaticMarkup (no DOM in unit tests).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { store } from "../../src/state/store";
import type { CameraConfig, LocalVideoCamera } from "../../src/state/types";
import {
  CameraPicker,
  type CameraPickerEntry,
  CameraPickerView,
  cameraDescription,
  cameraStatusView,
  placeParts,
  skyWord,
  skyWordAt,
} from "../../src/ui/CameraPicker";
import { committedCameras } from "../helpers/store";

const cameras = committedCameras();
const get = (id: string): CameraConfig => {
  const camera = cameras[id];
  if (camera === undefined) throw new Error(`${id} missing`);
  return camera;
};
const CLIP = "subaru-2026-10-11-iss";
const clip = get(CLIP);
const subaru = get("subaru-starcam");
const cfht = get("cfht-starcam");

const entries: CameraPickerEntry[] = [
  { camera: clip, status: "unknown" },
  { camera: subaru, status: "live", sky: "night" },
  { camera: cfht, status: "offline", sky: "night" },
];

const render = (props: Partial<Parameters<typeof CameraPickerView>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(CameraPickerView, {
      entries,
      activeId: CLIP,
      cameras: "ready",
      onChoose: () => {},
      ...props,
    }),
  );

/** Every menu row's attributes, in document order. */
function rows(html: string) {
  return [...html.matchAll(/<button type="button" role="menuitemradio"([^>]*)>/g)].map((m) => {
    const attrs = m[1] ?? "";
    const attr = (name: string): string => new RegExp(` ${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";
    return {
      id: attr("data-camera-id"),
      checked: attr("aria-checked"),
      labelledBy: attr("aria-labelledby"),
      describedBy: attr("aria-describedby"),
      status: attr("data-status"),
      tabIndex: attr("tabindex"),
    };
  });
}

/** The text of the element with the given id. */
function textOfId(html: string, id: string): string {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html);
  return m?.[1] ?? "";
}

/** The groups' legends, in order. */
const legends = (html: string): string[] =>
  [...html.matchAll(/<legend class="cam-menu-heading">([^<]*)<\/legend>/g)].map((m) => m[1] ?? "");

/** The menu button's opening tag and its content. */
function menuButton(html: string): { tag: string; text: string } {
  const m = /<button([^>]*class="cam-menu-button"[^>]*)>([\s\S]*?)<\/button>/.exec(html);
  return {
    tag: m?.[1] ?? "",
    text: (m?.[2] ?? "")
      .replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, ""),
  };
}

describe("CameraPickerView ([Polish] a menu button and its menu)", () => {
  it("is a menu button named 'Camera: <short name>', closed by default, controlling a hidden menu", () => {
    const html = render();
    const button = menuButton(html);
    expect(button.text).toBe("Camera: ISS pass (recorded)");
    expect(button.tag).toContain('aria-haspopup="menu"');
    expect(button.tag).toContain('aria-expanded="false"');
    expect(button.tag).toContain('data-status="recorded"');
    const controls = /aria-controls="([^"]+)"/.exec(button.tag)?.[1] ?? "";
    expect(html).toContain(`id="${controls}" role="menu" aria-label="Cameras"`);
    expect(html).toMatch(/role="menu" aria-label="Cameras" class="cam-menu-list" hidden=""/);
    // Described by the active camera's full name, place and status.
    const described = /aria-describedby="([^"]+)"/.exec(button.tag)?.[1] ?? "";
    expect(textOfId(html, described)).toBe(
      "Subaru StarCam: ISS pass, 2026-10-11 (recorded). Maunakea, Hawaii. A recording",
    );
  });

  it("groups the rows 'Recorded' then 'Live', one menuitemradio per camera, the active one checked", () => {
    const html = render({ defaultOpen: true });
    expect(html).not.toMatch(/class="cam-menu-list" hidden/);
    expect(legends(html)).toEqual(["Recorded", "Live"]);
    const all = rows(html);
    expect(all.map((r) => r.id)).toEqual([CLIP, "subaru-starcam", "cfht-starcam"]);
    expect(all.map((r) => r.checked)).toEqual(["true", "false", "false"]);
    expect(all.every((r) => r.tabIndex === "-1")).toBe(true); // roving focus: the arrows move it
  });

  it("names each row by its short name alone and describes it by its full name, place, sky and status", () => {
    const html = render({ defaultOpen: true });
    const all = rows(html);
    expect(all.map((r) => textOfId(html, r.labelledBy))).toEqual([
      "ISS pass (recorded)",
      "Subaru live",
      "CFHT live",
    ]);
    expect(all.map((r) => textOfId(html, r.describedBy))).toEqual([
      "Subaru StarCam: ISS pass, 2026-10-11 (recorded). Maunakea, Hawaii. A recording",
      "Subaru-Asahi StarCam (east, live). Maunakea, Hawaii, night. Live",
      "CFHT-Asahi StarCam (west, live). Maunakea, Hawaii, night. Offline",
    ]);
    // The visible place line.
    expect([...html.matchAll(/class="cam-item-place">([^<]*)</g)].map((m) => m[1])).toEqual([
      "Maunakea, Hawaii",
      "Maunakea, Hawaii · night",
      "Maunakea, Hawaii · night",
    ]);
  });

  it("shows a status dot on every row, and a word for live and offline only", () => {
    const html = render({ defaultOpen: true });
    expect(rows(html).map((r) => r.status)).toEqual(["recorded", "live", "offline"]);
    expect(html.match(/<span aria-hidden="true" class="cam-dot"><\/span>/g)).toHaveLength(4); // + the button's
    expect([...html.matchAll(/class="cam-item-word">([^<]*)</g)].map((m) => m[1])).toEqual([
      "Live",
      "Offline",
    ]);
    // Not checked: the hollow dot alone.
    const unchecked = render({
      defaultOpen: true,
      entries: [{ camera: subaru, status: "unknown" }],
      activeId: subaru.id,
    });
    expect(rows(unchecked).map((r) => r.status)).toEqual(["unknown"]);
    expect(unchecked).not.toContain("cam-item-word");
    expect(unchecked).toContain("Subaru-Asahi StarCam (east, live). Maunakea, Hawaii. Not checked");
  });

  it("says 'Unavailable' for a recording whose clip failed to load, in the row and on the button", () => {
    const html = render({ defaultOpen: true, entries: [{ camera: clip, status: "offline" }] });
    expect(rows(html).map((r) => r.status)).toEqual(["unavailable"]);
    expect(html).toContain('class="cam-item-word">Unavailable<');
    expect(menuButton(html).tag).toContain('data-status="unavailable"');
    expect(html).toContain('<span aria-hidden="true" class="cam-menu-word">unavailable</span>');
    expect(html).toContain("(recorded). Maunakea, Hawaii. Unavailable");
  });

  it("offers Watch live while the recorded clip is on, and not on a live camera", () => {
    const html = render();
    expect(html).toMatch(
      /<button type="button" class="btn-primary watch-live">.*Watch live<\/button>/,
    );
    expect(render({ activeId: subaru.id })).not.toContain("Watch live");
    expect(menuButton(render({ activeId: subaru.id })).text).toBe("Camera: Subaru live");
  });

  it("says when the camera list is loading or failed, with no button until it has cameras", () => {
    const loading = render({ entries: [], cameras: "loading" });
    expect(loading).toContain('<div role="status" class="cam-switch-status">Loading cameras</div>');
    expect(loading).not.toContain("cam-menu-button");
    expect(render({ entries: [], cameras: "error" })).toContain(
      '<div role="status" class="cam-switch-status">The camera list failed to load</div>',
    );
    expect(render()).toContain('<div role="status" class="cam-switch-status"></div>');
  });

  it("[Polish] lists 8 cameras (1 recorded, 7 live) in order, each with a unique id and one checked", () => {
    const live = (id: string, shortName: string, placeName: string, timeZone: string) =>
      ({
        ...structuredClone(subaru),
        id,
        name: `${shortName} (full name)`,
        shortName,
        placeName,
        site: { ...subaru.site, timeZone },
      }) as CameraConfig;
    const eight: CameraPickerEntry[] = [
      { camera: clip, status: "live" },
      { camera: subaru, status: "live", sky: "night" },
      { camera: cfht, status: "unknown", sky: "night" },
      {
        camera: live("kiso", "Kiso live", "Kiso Observatory, Japan", "Asia/Tokyo"),
        status: "live",
        sky: "day",
      },
      {
        camera: live("kozushima", "Kōzushima live", "Kōzushima, Japan", "Asia/Tokyo"),
        status: "offline",
        sky: "day",
      },
      {
        camera: live("fukushima", "Fukushima live", "Fukushima, Japan", "Asia/Tokyo"),
        status: "unknown",
        sky: "day",
      },
      {
        camera: live("alma", "ALMA live", "ALMA, Chile", "America/Santiago"),
        status: "live",
        sky: "twilight",
      },
      {
        camera: live("marugame", "Marugame live", "Marugame, Japan", "Asia/Tokyo"),
        status: "unknown",
        sky: "day",
      },
    ];
    const html = render({ entries: eight, activeId: "alma", defaultOpen: true });
    const all = rows(html);
    expect(all).toHaveLength(8);
    expect(new Set(all.map((r) => r.id)).size).toBe(8);
    expect(new Set(all.map((r) => r.labelledBy)).size).toBe(8);
    expect(all.filter((r) => r.checked === "true").map((r) => r.id)).toEqual(["alma"]);
    expect(legends(html)).toEqual(["Recorded", "Live"]);
    expect(all.map((r) => textOfId(html, r.labelledBy))).toEqual([
      "ISS pass (recorded)",
      "Subaru live",
      "CFHT live",
      "Kiso live",
      "Kōzushima live",
      "Fukushima live",
      "ALMA live",
      "Marugame live",
    ]);
    expect(textOfId(html, all[6]?.describedBy ?? "")).toBe(
      "ALMA live (full name). ALMA, Chile, twilight. Live",
    );
    // The recorded group holds the clip alone; the live group the other 7.
    const [recorded, liveGroup] = html.split('<legend class="cam-menu-heading">Live</legend>');
    expect(rows(recorded ?? "")).toHaveLength(1);
    expect(rows(liveGroup ?? "")).toHaveLength(7);
    expect(menuButton(html).text).toBe("Camera: ALMA live");
  });
});

describe("the switcher's words", () => {
  it("skyWord: day above −0.833°, twilight down to −12°, else night; null when unknown", () => {
    expect(skyWord(10)).toBe("day");
    expect(skyWord(-0.5)).toBe("day");
    expect(skyWord(-1)).toBe("twilight");
    expect(skyWord(-11.9)).toBe("twilight");
    expect(skyWord(-12)).toBe("night");
    expect(skyWord(-60)).toBe("night");
    expect(skyWord(Number.NaN)).toBeNull();
  });

  it("skyWordAt: night, day and twilight on Maunakea by the Sun's altitude", () => {
    expect(skyWordAt(subaru, Date.parse("2026-10-11T08:00:00Z"))).toBe("night"); // 22:00 HST
    expect(skyWordAt(subaru, Date.parse("2026-10-11T22:00:00Z"))).toBe("day"); // 12:00 HST
    expect(skyWordAt(subaru, Date.parse("2026-10-11T04:30:00Z"))).toBe("twilight"); // 18:30 HST
  });

  it("placeParts: placeName, else the time zone as a place; a loaded clip's date; a live camera's sky", () => {
    expect(placeParts(subaru, "night")).toEqual(["Maunakea, Hawaii", "night"]);
    expect(placeParts(subaru, null)).toEqual(["Maunakea, Hawaii"]);
    const { placeName: _gone, ...unnamed } = subaru;
    expect(
      placeParts({ ...unnamed, site: { ...subaru.site, timeZone: "Asia/Tokyo" } }, "day"),
    ).toEqual(["Japan", "day"]);
    const loaded = {
      ...clip,
      source: {
        ...(clip as LocalVideoCamera).source,
        startUtcMs: Date.parse("2026-10-11T15:08:30Z"),
      },
    } as CameraConfig;
    expect(placeParts(loaded, "night")).toEqual(["Maunakea, Hawaii", "11 Oct 2026"]); // no sky on a recording
  });

  it("cameraStatusView and cameraDescription end with the status in words", () => {
    expect(cameraStatusView(subaru, "daytime")).toEqual({
      dot: "daytime",
      word: "Daytime",
      text: "Daytime",
    });
    expect(cameraStatusView(clip, "live")).toEqual({
      dot: "recorded",
      word: "",
      text: "A recording",
    });
    expect(cameraDescription(cfht, "live", "day")).toBe(
      "CFHT-Asahi StarCam (west, live). Maunakea, Hawaii, day. Live",
    );
  });
});

describe("CameraPicker (store-connected)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows each camera's stored status, else Not checked, and the active camera on the button", () => {
    // Server rendering reads getInitialState(); point it at the live state for this render.
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.setRegistry({ [CLIP]: clip, "subaru-starcam": subaru, "cfht-starcam": cfht });
    actions.setActiveCamera(CLIP);
    actions.setLoadStatus("cameras", "ready");
    const before = renderToStaticMarkup(createElement(CameraPicker));
    expect(menuButton(before).text).toBe("Camera: ISS pass (recorded)");
    expect(before).toContain("Subaru-Asahi StarCam (east, live). Maunakea, Hawaii. Not checked");
    expect(before).toContain("Watch live");

    actions.setCameraStatus("subaru-starcam", "offline");
    actions.setCameraStatus(CLIP, "offline");
    actions.setActiveCamera("subaru-starcam");
    const after = renderToStaticMarkup(createElement(CameraPicker));
    expect(menuButton(after).text).toBe("Camera: Subaru live");
    expect(after).toContain("Subaru-Asahi StarCam (east, live). Maunakea, Hawaii. Offline");
    expect(after).toContain("(recorded). Maunakea, Hawaii. Unavailable");
    expect(
      rows(after)
        .filter((r) => r.checked === "true")
        .map((r) => r.id),
    ).toEqual(["subaru-starcam"]);
    expect(after).not.toContain("Watch live");
  });
});
