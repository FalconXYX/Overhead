// tests/unit/shell.test.ts — [Redesign] the shell's markup (redesign spec sections 2–5): the popovers ([?] keyboard
// shortcuts, Credits), the control bar's plain local time, the colour key under the video, and the object colours.
// Rendered with renderToStaticMarkup (no DOM).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_MAP } from "../../src/app/keyboard";
import { KIND_COLOR, satelliteKind } from "../../src/map/kindColors";
import { store } from "../../src/state/store";
import { Credits } from "../../src/ui/Credits";
import { localTimeWords, placeOfZone, utcTooltip } from "../../src/ui/controlBarText";
import { KeyboardShortcuts } from "../../src/ui/KeyboardShortcuts";
import { Popover } from "../../src/ui/Popover";
import { StageHint } from "../../src/ui/StageHint";
import { committedCameras } from "../helpers/store";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Popover", () => {
  const render = (open: boolean): string =>
    renderToStaticMarkup(
      createElement(
        Popover,
        { label: "Things", title: "Things list", open, onOpenChange: () => {}, id: "things" },
        createElement("p", null, "Inside"),
      ),
    );

  it("is a button with aria-expanded and aria-controls, and a labelled region kept in the DOM while closed", () => {
    expect(render(false)).toBe(
      '<div class="popover"><button type="button" aria-expanded="false" aria-controls="things">Things</button>' +
        '<section id="things" aria-label="Things list" class="popover-panel popover-panel--end popover-panel--below" hidden="">' +
        "<p>Inside</p></section></div>",
    );
    const open = render(true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain('hidden=""');
  });
});

describe("KeyboardShortcuts ([?])", () => {
  it("is a [?] button named Keyboard shortcuts opening KEY_MAP's rows", () => {
    const html = renderToStaticMarkup(createElement(KeyboardShortcuts));
    expect(html).toMatch(
      /^<div class="popover shortcuts"><button type="button" class="btn-icon header-button" aria-label="Keyboard shortcuts" aria-expanded="false" aria-controls="[^"]+"><span aria-hidden="true">\?<\/span><\/button>/,
    );
    expect(html).toContain('aria-label="Keyboard shortcuts" class="popover-panel');
    expect(html.match(/<th scope="row">/g)).toHaveLength(KEY_MAP.length);
    for (const row of KEY_MAP) expect(html).toContain(`<th scope="row">${row.keys}</th>`);
  });
});

describe("Credits ([Credits])", () => {
  it("is one Credits button opening the full list, which stays in the DOM while closed", () => {
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.setRegistry(committedCameras());
    actions.setActiveCamera("subaru-starcam");
    const html = renderToStaticMarkup(createElement(Credits));
    expect(html).toMatch(
      /^<div class="popover credits"><button type="button" class="header-button" aria-expanded="false" aria-controls="[^"]+">Credits<\/button><section id="[^"]+" aria-label="Credits"[^>]* hidden="">/,
    );
    expect(html).toContain('<ul class="credits-list"><li>');
    // The camera's credit comes first, with its terms.
    const camera = committedCameras()["subaru-starcam"];
    const credit = (camera?.credit.text ?? "?").replaceAll("&", "&amp;");
    expect(html.indexOf(credit)).toBeGreaterThan(html.indexOf("credits-list"));
  });
});

describe("the control bar's time words", () => {
  const T = Date.parse("2026-10-11T15:09:50Z");

  it("says the camera's local time to the minute, in a place people know", () => {
    expect(localTimeWords(T, "Pacific/Honolulu")).toBe("05:09 in Hawaii");
    expect(localTimeWords(T, "Europe/Zurich")).toBe("17:09 in Switzerland");
    expect(placeOfZone("America/New_York")).toBe("New York");
  });

  it("keeps UTC for the tooltip", () => {
    expect(utcTooltip(T)).toBe("2026-10-11 15:09:50 UTC");
  });
});

describe("the colour key under the video", () => {
  it("names the four kinds with their dots, and how to learn what a dot is", () => {
    const html = renderToStaticMarkup(createElement(StageHint));
    for (const [kind, name] of [
      ["iss", "Space Station"],
      ["satellite", "Satellites"],
      ["starlink", "Starlink"],
      ["planet", "Planets and Moon"],
    ]) {
      expect(html).toContain(
        `<span aria-hidden="true" class="kind-dot kind-${kind}"></span> ${name}`,
      );
    }
    expect(html).toContain("Click a dot on the video or the map to see what it is.");
  });
});

describe("object colours (spec section 4)", () => {
  it("ISS orange, satellites cyan, Starlink violet, planets gold, stars white", () => {
    expect(KIND_COLOR).toEqual({
      iss: "#ff8a3d",
      satellite: "#4fd1ff",
      starlink: "#b58cff",
      planet: "#ffd166",
      star: "#ffffff",
    });
  });

  it("tells the ISS and Starlink apart from other satellites", () => {
    expect(satelliteKind(25544, 0)).toBe("iss");
    expect(satelliteKind(44713, 2)).toBe("starlink");
    expect(satelliteKind(19046, 1)).toBe("satellite");
    expect(satelliteKind(undefined, undefined)).toBe("satellite");
  });
});
