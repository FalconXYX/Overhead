// tests/unit/footprintControls.test.ts — the Layers panel's footprint controls (M8 step 9.1): the toggle, the height
// select and its options, the note, and the "nothing to draw" status. Rendered with renderToStaticMarkup against the
// app store; heightKmOf is mocked (the frame loop does not run here).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { footprintStatus } from "../../src/state/footprintStatus";
import { store } from "../../src/state/store";
import { selectedHeightOptionText } from "../../src/ui/incomingText";
import { LayerToggles } from "../../src/ui/LayerToggles";

const ephemerisMock = vi.hoisted(() => ({ heightKm: null as number | null }));
vi.mock("../../src/state/ephemeris", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/state/ephemeris")>();
  return {
    ...original,
    heightKmOf: () => ephemerisMock.heightKm,
    indexOfObjectId: (id: string) => (id === "sat:25544" ? 0 : null),
  };
});

const NOTHING =
  "Nothing to draw at this height: the camera sees no sky above the horizon, or the view would cover a pole.";

beforeEach(() => {
  vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
  const { actions } = store.getState();
  actions.select(null);
  actions.setLayer("footprint", false);
  actions.setFootprintHeightKm(null);
  ephemerisMock.heightKm = null;
  Object.assign(footprintStatus, { heightKm: null, source: "fallback", pairCount: 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const render = (): string => renderToStaticMarkup(createElement(LayerToggles));
/** [value, selected, text] of every option of the height select. */
function options(html: string): [string, boolean, string][] {
  const select =
    /<select aria-label="Orbit height for the camera view"[^>]*>(.*?)<\/select>/.exec(html)?.[1] ??
    "";
  return [...select.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map(
    (m) => [m[1] ?? "", m[2] !== undefined, m[3] ?? ""],
  );
}

describe("selectedHeightOptionText", () => {
  it("rounds the selected satellite's height, or names the fallback", () => {
    expect(selectedHeightOptionText(422.4, 420)).toBe("Selected satellite (422 km)");
    expect(selectedHeightOptionText(null, 420)).toBe("Selected satellite (none: 420 km)");
  });
});

describe("LayerToggles: the footprint controls", () => {
  it("has the toggle, the select with three options, and the always-visible note", () => {
    const html = render();
    expect(html).toMatch(
      /<input type="checkbox" aria-describedby="([^"]+)"\/>Camera view at orbit height<\/label>/,
    );
    const noteId =
      /<input type="checkbox" aria-describedby="([^"]+)"\/>Camera view at orbit height/.exec(
        html,
      )?.[1];
    expect(html).toContain(`<p id="${noteId}">Exact only for satellites at this height</p>`);
    expect(options(html)).toEqual([
      ["selected", true, "Selected satellite (none: 420 km)"],
      ["420", false, "ISS shell (420 km)"],
      ["480", false, "Starlink shell (480 km)"],
    ]);
  });

  it("names the selected satellite's height, and selects the preset in use", () => {
    const { actions } = store.getState();
    ephemerisMock.heightKm = 422.4;
    actions.select("sat:25544");
    expect(options(render())[0]).toEqual(["selected", true, "Selected satellite (422 km)"]);
    actions.select("star:424");
    expect(options(render())[0]?.[2]).toBe("Selected satellite (none: 420 km)");
    actions.setFootprintHeightKm(480);
    expect(options(render()).map(([value, selected]) => [value, selected])).toEqual([
      ["selected", false],
      ["420", false],
      ["480", true],
    ]);
  });

  it("says when there is nothing to draw, only while the footprint is on", () => {
    expect(render()).toContain('<p role="status"></p>');
    store.getState().actions.setLayer("footprint", true);
    expect(render()).toContain(`<p role="status">${NOTHING}</p>`);
    footprintStatus.pairCount = 66;
    expect(render()).toContain('<p role="status"></p>');
  });
});
