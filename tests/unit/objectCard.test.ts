// tests/unit/objectCard.test.ts — the floating object card, the hover card's lines and the [In view] list (redesign spec
// sections 2 and 3): plain words first, jargon only behind "More details", Close, Show on map and Follow, nothing when
// nothing is selected, and the in-view list's order, positions and frame filter. Rendered with renderToStaticMarkup
// (no DOM in unit tests).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../../src/domain/astro";
import { createCameraModel, projectAzAltDeg } from "../../src/domain/camera";
import { store } from "../../src/state/store";
import type { ObjectId } from "../../src/state/types";
import { type CardContext, type CardText, cardText, hoverLines } from "../../src/ui/cardText";
import { InViewListView } from "../../src/ui/InViewList";
import { type InViewSources, inViewItemLabel, inViewItems } from "../../src/ui/inView";
import { ObjectCard, ObjectCardView } from "../../src/ui/ObjectCard";
import { objectDetails } from "../../src/ui/objectText";

const T = Date.parse("2026-10-11T15:09:50Z");
const ISS_EPOCH_MS = Date.parse("2026-10-09T22:48:38.797Z");
const DAY_MS = 86_400_000;

const ISS = 25544;
const POISK = 36086;
const SL3 = 19046;
const DRAGON = 100882;
const STARLINK = 44713;
const SL3B = 10114;

/** Satrec order: ISS, POISK (docked), SL-3 R/B, CREW DRAGON 13 (docked), a Starlink, a second SL-3 R/B. */
function catalog() {
  const noradIds = Int32Array.from([ISS, POISK, SL3, DRAGON, STARLINK, SL3B]);
  return {
    count: 6,
    noradIds,
    names: ["ISS (ZARYA)", "POISK", "SL-3 R/B", "CREW DRAGON 13", "STARLINK-1007", "SL-3 R/B"],
    groupIndex: Uint8Array.from([0, 0, 1, 0, 2, 1]),
    epochMs: Float64Array.from([
      ISS_EPOCH_MS,
      ISS_EPOCH_MS,
      T - 2 * DAY_MS,
      ISS_EPOCH_MS,
      T - 19.92 * DAY_MS,
      T - DAY_MS,
    ]),
    dockedWith: Int32Array.from([-1, ISS, -1, ISS, -1, -1]),
    indexByNorad: new Map([...noradIds].map((n, i) => [n, i])),
  };
}

/**
 * The ISS at az 123.812°, alt 28.872° (sunlit, visible); SL-3 19046 at az 200°, alt 41° in shadow; the Starlink at
 * az 300°, alt 60° (sunlit); SL-3 10114 at az 90°, alt 5°, above 0° but behind the mountains.
 */
function frame(ready = true) {
  const azAltDeg = new Float64Array(12);
  azAltDeg.set([123.812, 28.872], 0);
  azAltDeg.set([200.04, 41.25], 4);
  azAltDeg.set([300, 60], 8);
  azAltDeg.set([90, 5], 10);
  return {
    timeMs: T,
    ready,
    sunAltDeg: -16.2,
    azAltDeg,
    rangeKm: Float64Array.from([794.522, 0, 1201.6, 0, 700, 2400]),
    // bit 0 valid, 1 sunlit, 2 above horizon, 3 visible; docked rows are never valid
    flags: Uint8Array.from([0b1111, 0, 0b0101, 0, 0b1111, 0b0011]),
  };
}

const POLARIS: StarRow = [37.95456, 89.26411, 2.02, 424, "Polaris"];

function bodies(): Float64Array {
  const b = new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN);
  for (let i = 0; i < BODY_IDS.length; i++) b.set([0, -30, 0, 0.5], i * BODY_STRIDE);
  b.set([95.25, 33.33, -2.47, 0.99], BODY_IDS.indexOf("planet:Jupiter") * BODY_STRIDE);
  b.set([270, 12, -4.45, 0.01], BODY_IDS.indexOf("moon") * BODY_STRIDE);
  return b;
}

const sources = () => ({
  catalog: catalog(),
  frame: frame(),
  sky: {
    rows: [POLARIS],
    starCount: 1,
    starAzAltDeg: Float32Array.from([0.592, 20.151]),
    bodies: bodies(),
  },
});

const CTX: CardContext = {
  simTimeMs: T,
  pending: false,
  horizonStatus: "idle",
  horizonProfileDeg: null,
  heightKm: 417.6,
  incomingText: null,
};

const card = (id: ObjectId, ctx: Partial<CardContext> = {}): CardText =>
  cardText(id, objectDetails(id, sources()), { ...CTX, ...ctx });

describe("cardText", () => {
  it("the ISS: plain words first, the technical facts in details", () => {
    const c = card("sat:25544", { incomingText: "Comes into the camera view in 35 s" });
    expect(c).toMatchObject({
      name: "International Space Station",
      description: "A crewed space station, about 420 km up.",
      className: "kind-iss",
      where: "Halfway up in the south-east",
      visibility: "Lit by the Sun, visible to the eye",
      note: null,
      onMap: true,
      hasPosition: true,
    });
    expect(c.details).toEqual([
      "Catalogue name: ISS (ZARYA)",
      "NORAD id: 25544",
      "Height above Earth: 418 km",
      "Speed: about 27,600 km/h (7.7 km/s)",
      "Distance from the camera: 795 km",
      "Direction: az 123.8°, alt 28.9° (apparent)",
      "Comes into the camera view in 35 s",
      "Orbit data (elements) 1.7 days old",
      "CelesTrak list: Space stations",
      "Docked to it: Poisk module and Dragon capsule",
    ]);
    // Jargon never leads.
    for (const line of [c.name, c.description, c.where, c.visibility]) {
      expect(line).not.toMatch(/NORAD|az |alt |°|elements|R\/B/);
    }
  });

  it("a docked vehicle: its own name, its host's place and colour", () => {
    const c = card("sat:100882");
    expect(c).toMatchObject({
      name: "Dragon capsule",
      className: "kind-iss",
      where: "Halfway up in the south-east",
      note: "Docked to the International Space Station, so it is shown at the same place.",
    });
    expect(c.details).toContain("Docked to ISS (ZARYA) (NORAD 25544)");
  });

  it("a rocket stage in shadow; another behind the mountains", () => {
    expect(card("sat:19046")).toMatchObject({
      name: "Spent rocket stage (SL-3)",
      description: "The used upper stage of a rocket, left in orbit.",
      where: "Halfway up in the south",
      visibility: "In Earth's shadow, not visible",
    });
    expect(card("sat:10114")).toMatchObject({
      where: "Low in the east",
      visibility: "Behind the mountains",
    });
  });

  it("no position yet, terrain lines, and a satellite outside the loaded data", () => {
    const s = { ...sources(), frame: frame(false) };
    const c = cardText("sat:25544", objectDetails("sat:25544", s), CTX);
    expect(c).toMatchObject({
      where: null,
      visibility: null,
      note: "Working out where it is…",
      hasPosition: false,
    });
    const profile = new Float32Array(360).fill(10);
    expect(
      card("sat:25544", { horizonStatus: "ready", horizonProfileDeg: profile }).details,
    ).toContain("Mountain skyline here: +10.0°");
    expect(card("sat:12345")).toMatchObject({
      name: "Satellite not found",
      onMap: false,
      details: ["NORAD id: 12345"],
    });
    expect(card("sat:12345").description).toContain("turn on Starlink");
    expect(card("sat:12345", { pending: true })).toMatchObject({
      name: "Loading satellites…",
      description: "",
    });
  });

  it("planets, the Moon and stars: no map buttons; behind the mountains from a ready profile", () => {
    expect(card("planet:Jupiter")).toMatchObject({
      name: "Jupiter (planet)",
      className: "kind-planet",
      where: "Halfway up in the east",
      visibility: null,
      onMap: false,
      details: ["Direction: az 95.3°, alt 33.3°", "Brightness: magnitude −2.5 (lower is brighter)"],
    });
    const wall = new Float32Array(360).fill(40);
    expect(
      card("planet:Jupiter", { horizonStatus: "ready", horizonProfileDeg: wall }).visibility,
    ).toBe("Behind the mountains");
    // The profile is ignored until it is ready.
    expect(
      card("planet:Jupiter", { horizonStatus: "loading", horizonProfileDeg: wall }).visibility,
    ).toBeNull();
    expect(card("moon")).toMatchObject({
      name: "Moon",
      className: "kind-moon",
      where: "Low in the west",
    });
    expect(card("star:424")).toMatchObject({
      name: "Polaris (star)",
      className: "kind-star",
      where: "Halfway up in the north",
      details: [
        "Catalogue: HR 424 (Yale Bright Star Catalogue)",
        "Brightness: V magnitude 2.02 (lower is brighter)",
        "Direction: az 0.6°, alt 20.2°",
      ],
    });
    expect(card("sun")).toMatchObject({
      where: "Below the horizon, to the north",
      visibility: null,
    });
  });

  it("the hover card's lines: where, then visibility or the note", () => {
    expect(hoverLines(card("sat:25544"))).toEqual([
      "Halfway up in the south-east",
      "Lit by the Sun, visible to the eye",
    ]);
    expect(hoverLines(card("sat:100882"))).toEqual([
      "Halfway up in the south-east",
      "Lit by the Sun, visible to the eye",
    ]);
    expect(hoverLines(card("planet:Jupiter"))).toEqual(["Halfway up in the east"]);
    expect(hoverLines(card("sat:12345"))[0]).toContain("isn't in the loaded data");
  });
});

describe("ObjectCardView", () => {
  const render = (c: CardText, follow = false): string =>
    renderToStaticMarkup(
      createElement(ObjectCardView, {
        card: c,
        follow,
        onClose: () => {},
        onShowOnMap: () => {},
        onToggleFollow: () => {},
      }),
    );

  it("a named region with the name, plain lines, Close, the map buttons and More details", () => {
    const html = render(card("sat:25544"), true);
    expect(html).toMatch(/^<section aria-label="Selected object" data-testid="object-card"/);
    expect(html).toContain('class="object-card kind-iss"');
    expect(html).toContain('<h2 class="object-card-name">International Space Station</h2>');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('<p class="object-card-where">Halfway up in the south-east</p>');
    expect(html).toContain('<button type="button">Show on map</button>');
    expect(html).toContain('<button type="button" aria-pressed="true">Follow</button>');
    expect(html).toContain("<details");
    expect(html).toContain("<summary>More details</summary>");
    // NORAD appears only inside the disclosure.
    expect(html.indexOf("NORAD")).toBeGreaterThan(html.indexOf("<details"));
  });

  it("Show on map is disabled without a position; bodies get no map buttons", () => {
    const s = { ...sources(), frame: frame(false) };
    const html = render(cardText("sat:25544", objectDetails("sat:25544", s), CTX));
    expect(html).toContain('<button type="button" disabled="">Show on map</button>');
    const jupiter = render(card("planet:Jupiter"));
    expect(jupiter).not.toContain("Show on map");
    expect(jupiter).not.toContain("Follow");
    expect(jupiter).toContain('aria-label="Close"');
  });

  it("Close clears through its callback", () => {
    let closed = 0;
    const element = ObjectCardView({
      card: card("moon"),
      follow: false,
      onClose: () => closed++,
      onShowOnMap: () => {},
      onToggleFollow: () => {},
    });
    // section → head div → [dot, h2, button]
    const head = (element as { props: { children: unknown[] } }).props.children[0] as {
      props: { children: { props: { onClick?: () => void } }[] };
    };
    head.props.children[2]?.props.onClick?.();
    expect(closed).toBe(1);
  });
});

describe("ObjectCard with the app store", () => {
  beforeEach(() => {
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
  });
  afterEach(() => {
    store.getState().actions.select(null);
    vi.restoreAllMocks();
  });
  const render = (): string => renderToStaticMarkup(createElement(ObjectCard));

  it("renders nothing while nothing is selected", () => {
    store.getState().actions.select(null);
    expect(render()).toBe("");
  });

  it("a selected body before the first sky pass", () => {
    store.getState().actions.select("planet:Saturn");
    const html = render();
    expect(html).toContain("Saturn (planet)");
    expect(html).toContain("Working out where it is…");
  });
});

describe("inViewItems", () => {
  const base = (): InViewSources => ({
    catalog: catalog(),
    frame: frame(),
    bodies: bodies(),
    model: null,
    terrain: null,
    selectedIndex: null,
    selectedId: null,
    satellitesOn: true,
    starlinkOn: true,
    planetsOn: true,
  });

  it("satellites highest first with plain positions, Starlink counted, then the bodies above the horizon", () => {
    const view = inViewItems(base());
    expect(view.satellites?.map(inViewItemLabel)).toEqual([
      "Spent rocket stage (SL-3), halfway up in the south, in Earth's shadow",
      "International Space Station, halfway up in the south-east",
      "Spent rocket stage (SL-3), low in the east, behind the mountains",
    ]);
    expect(view.satellites?.map((item) => item.id)).toEqual([
      "sat:19046",
      "sat:25544",
      "sat:10114",
    ]);
    expect(view.satellites?.[1]?.className).toBe("kind-iss");
    expect(view.starlinkCount).toBe(1);
    expect(view.bodies?.map(inViewItemLabel)).toEqual([
      "Moon, low in the west",
      "Jupiter (planet), halfway up in the east",
    ]);
    expect(view.bodies?.map((item) => item.className)).toEqual(["kind-moon", "kind-planet"]);
  });

  it("layers off hide their objects, except the selection; a docked selection marks its host", () => {
    const view = inViewItems({
      ...base(),
      satellitesOn: false,
      starlinkOn: false,
      planetsOn: false,
      selectedIndex: 0, // CREW DRAGON 13 selected: its host's row
      selectedId: "sat:100882",
    });
    expect(view.satellites?.map((item) => [item.id, item.selected])).toEqual([["sat:25544", true]]);
    expect(view.starlinkCount).toBe(0);
    expect(view.bodies).toEqual([]);
    const moon = inViewItems({ ...base(), planetsOn: false, selectedId: "moon" });
    expect(moon.bodies?.map((item) => [item.name, item.selected])).toEqual([["Moon", true]]);
  });

  it("null before the first frame and the first sky pass", () => {
    const view = inViewItems({
      ...base(),
      frame: frame(false),
      bodies: new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN),
    });
    expect(view).toEqual({ satellites: null, starlinkCount: 0, bodies: null });
  });

  it("with a camera model, only what projects inside its frame", () => {
    // A rectilinear camera looking south-east at 30°: the ISS is in the frame, the others are not.
    const model = createCameraModel({
      lens: "rectilinear",
      calibration: {
        azDeg: 124,
        altDeg: 29,
        rollDeg: 0,
        focalPx: 1600,
        cxPx: 640,
        cyPx: 360,
        k1: 0,
        k2: 0,
        flipX: false,
        streamDelayMs: 0,
        rmsDeg: null,
        updatedAtMs: 0,
      },
      widthPx: 1280,
      heightPx: 720,
    });
    const out = new Float64Array(2);
    expect(projectAzAltDeg(model, 123.812, 28.872, out, 0)).toBe(true);
    const view = inViewItems({ ...base(), model });
    expect(view.satellites?.map((item) => item.id)).toEqual(["sat:25544"]);
    expect(view.starlinkCount).toBe(0);
    expect(view.bodies).toEqual([]);
  });
});

describe("InViewListView", () => {
  const render = (props: Partial<Parameters<typeof InViewListView>[0]> = {}): string =>
    renderToStaticMarkup(
      createElement(InViewListView, {
        view: { satellites: [], starlinkCount: 0, bodies: [] },
        satelliteStatus: null,
        onSelect: () => {},
        ...props,
      }),
    );

  it("buttons with friendly names and plain positions, satellites first, selection pressed", () => {
    const view = inViewItems({
      catalog: catalog(),
      frame: frame(),
      bodies: bodies(),
      model: null,
      terrain: null,
      selectedIndex: 0,
      selectedId: "sat:25544",
      satellitesOn: true,
      starlinkOn: true,
      planetsOn: true,
    });
    const html = render({ view });
    expect(html).toContain("<h3");
    expect(html.indexOf(">Satellites</h3>")).toBeLessThan(
      html.indexOf(">Planets, Moon and Sun</h3>"),
    );
    expect(html).toContain(
      'aria-label="International Space Station, halfway up in the south-east" aria-pressed="true" data-object-id="sat:25544"',
    );
    expect(html).toContain('class="in-view-item kind-iss"');
    expect(html).toContain("and 1 Starlink satellite");
    expect(html).toContain(
      'aria-label="Jupiter (planet), halfway up in the east" aria-pressed="false"',
    );
    expect(html).not.toMatch(/NORAD|az |alt |°/);
  });

  it("empty and loading states in plain words", () => {
    const empty = render();
    expect(empty).toContain("No satellites in view right now");
    expect(empty).toContain("No planets, Moon or Sun in view right now");
    expect(render({ satelliteStatus: "Loading satellites…" })).toContain("Loading satellites…");
    expect(render({ satelliteStatus: "Loading satellites…" })).not.toContain(
      "No satellites in view",
    );
    const before = render({ view: { satellites: null, starlinkCount: 0, bodies: null } });
    expect(before).not.toContain("right now");
  });
});
