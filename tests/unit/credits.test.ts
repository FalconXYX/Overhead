import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BSC5_CREDIT,
  CELESTRAK_CREDIT,
  dataCredits,
  GIBS_CREDIT,
  GOES_SUBTITLE,
  IAU_WGSN_CREDIT,
  NANAAO_CREDIT,
  NANAAO_TERMS_NOTE,
  OSM_NE_CREDIT,
  starCredits,
  TERRAIN_CREDIT,
  TERRAIN_SOURCE_STATEMENTS,
  TRUE_COLOR_INSTRUMENT,
  terrainInUse,
} from "../../src/app/credits";
import { store } from "../../src/state/store";
import { Credits } from "../../src/ui/Credits";
import { committedCameras } from "../helpers/store";

/** Both satellite layers and GOES (M7) off: the M1 cases. */
const NO_SATELLITES = { satellites: false, starlink: false, goesIr: false } as const;

describe("credits", () => {
  it("the GIBS acknowledgement and the OSM / Natural Earth line, verbatim", () => {
    expect(GIBS_CREDIT).toEqual({
      text: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
      href: "https://nasa-gibs.github.io/gibs-api-docs/",
      licence: null,
      licenceHref: null,
    });
    expect(OSM_NE_CREDIT).toEqual({
      text: "© OpenStreetMap contributors, Natural Earth",
      href: "https://www.openstreetmap.org/copyright",
      licence: "ODbL-1.0",
      licenceHref: "https://opendatacommons.org/licenses/odbl/",
    });
    expect(TRUE_COLOR_INSTRUMENT).toBe("NOAA-20 / VIIRS");
  });

  it("dataCredits follows the layers once GIBS is ready", () => {
    expect(dataCredits({ ...NO_SATELLITES, trueColor: true, coastlines: true }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
    expect(dataCredits({ ...NO_SATELLITES, trueColor: true, coastlines: false }, true)).toEqual([
      GIBS_CREDIT,
    ]);
    expect(dataCredits({ ...NO_SATELLITES, trueColor: false, coastlines: true }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
    expect(dataCredits({ ...NO_SATELLITES, trueColor: false, coastlines: false }, true)).toEqual(
      [],
    );
  });

  it("dataCredits has no GIBS credit while GIBS is not ready", () => {
    for (const trueColor of [true, false]) {
      for (const coastlines of [true, false]) {
        expect(dataCredits({ ...NO_SATELLITES, trueColor, coastlines }, false)).toEqual([]);
      }
    }
  });

  it("the CelesTrak credit, verbatim", () => {
    expect(CELESTRAK_CREDIT).toEqual({
      text: "Orbital elements: CelesTrak",
      href: "https://celestrak.org",
      licence: null,
      licenceHref: null,
    });
  });

  it("dataCredits appends CELESTRAK_CREDIT while satellites or starlink is on, whatever gibsReady is", () => {
    for (const gibsReady of [true, false]) {
      for (const [satellites, starlink] of [
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        const none = { trueColor: false, coastlines: false, goesIr: false, satellites, starlink };
        expect(dataCredits(none, gibsReady), `${gibsReady} ${satellites} ${starlink}`).toEqual([
          CELESTRAK_CREDIT,
        ]);
      }
    }
    // Last, after the GIBS lines; once only with both satellite layers on.
    const all = {
      trueColor: true,
      coastlines: true,
      goesIr: true,
      satellites: true,
      starlink: true,
    };
    expect(dataCredits(all, true)).toEqual([GIBS_CREDIT, OSM_NE_CREDIT, CELESTRAK_CREDIT]);
    expect(dataCredits(all, true)[2]).toBe(CELESTRAK_CREDIT);
    expect(dataCredits(all, false)).toEqual([CELESTRAK_CREDIT]);
    expect(dataCredits({ ...all, satellites: false, starlink: false }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
  });

  it("[M7] goesIr is a GIBS layer: GIBS_CREDIT alone once GIBS is ready", () => {
    const goesOnly = { ...NO_SATELLITES, trueColor: false, coastlines: false, goesIr: true };
    expect(dataCredits(goesOnly, true)).toEqual([GIBS_CREDIT]);
    expect(dataCredits({ ...goesOnly, goesIr: false }, true)).toEqual([]);
    expect(dataCredits(goesOnly, false)).toEqual([]);
    // Once only with every GIBS layer on.
    expect(dataCredits({ ...goesOnly, trueColor: true, coastlines: true }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
    expect(GOES_SUBTITLE).toBe("GOES-West/ABI");
  });

  it("the star catalogue and star-name credits, verbatim", () => {
    expect(BSC5_CREDIT).toEqual({
      text: "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR",
      href: "https://doi.org/10.26093/cds/vizier",
      licence: null,
      licenceHref: null,
    });
    expect(IAU_WGSN_CREDIT).toEqual({
      text: "Star names: IAU WGSN",
      href: "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt",
      licence: "CC BY",
      licenceHref: null,
    });
  });

  it("starCredits gives both star credits while stars are on, else none", () => {
    expect(starCredits(true)).toEqual([BSC5_CREDIT, IAU_WGSN_CREDIT]);
    expect(starCredits(true)[0]).toBe(BSC5_CREDIT);
    expect(starCredits(true)[1]).toBe(IAU_WGSN_CREDIT);
    expect(starCredits(false)).toEqual([]);
    // A new array per call: call it during render, never inside useAppState (React rule 6).
    expect(starCredits(true)).not.toBe(starCredits(true));
  });
});

describe("the Nānā ao credit (M4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is © CFHT under the GFDL 1.3 or later, with the gallery link and the licence link, verbatim", () => {
    expect(NANAAO_CREDIT).toEqual({
      text: "Nānā ao all-sky image © CFHT",
      href: "https://www.cfht.hawaii.edu/en/gallery/nanaao.php",
      licence: "GFDL-1.3-or-later",
      licenceHref: "https://www.gnu.org/licenses/fdl-1.3.html",
    });
    expect(NANAAO_TERMS_NOTE).toBe("GNU Free Documentation License 1.3 or later");
  });

  it("is the committed cfht-nanaao entry's credit and terms note", () => {
    const camera = committedCameras()["cfht-nanaao"];
    expect(camera?.credit).toEqual(NANAAO_CREDIT);
    expect(camera?.termsNote).toBe(NANAAO_TERMS_NOTE);
  });

  it("shows in the Credits region with its link, the licence link and the terms note, whatever the layers", () => {
    // Server rendering reads getInitialState(); point it at the live state for these renders.
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.setRegistry(committedCameras());
    actions.setActiveCamera("cfht-nanaao");
    const link = (href: string, text: string): string =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    const line =
      `<li>${link(NANAAO_CREDIT.href ?? "", NANAAO_CREDIT.text)} (` +
      `${link(NANAAO_CREDIT.licenceHref ?? "", "GFDL-1.3-or-later")}) — ${NANAAO_TERMS_NOTE}</li>`;
    expect(renderToStaticMarkup(createElement(Credits))).toContain(line);
    // Every data layer off: the camera's credit stays (README Credits rule 1).
    for (const key of ["trueColor", "coastlines", "stars", "satellites", "starlink"] as const) {
      actions.setLayer(key, false);
    }
    expect(renderToStaticMarkup(createElement(Credits))).toContain(line);
  });
});

describe("the GOES-West imagery line (M7)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows with the GIBS acknowledgement while GIBS is ready and goesIr is on", () => {
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    for (const key of ["trueColor", "coastlines", "satellites", "starlink"] as const) {
      actions.setLayer(key, false);
    }
    const line = "<li>Imagery: GOES-West/ABI, Band 13 Clean Infrared</li>";
    const render = () => renderToStaticMarkup(createElement(Credits));
    actions.setLayer("goesIr", true);
    actions.setLoadStatus("gibs", "loading");
    expect(render()).not.toContain(line);
    actions.setLoadStatus("gibs", "ready");
    expect(render()).toContain(line);
    // The acknowledgement's apostrophes are escaped in the markup: match its link instead.
    const gibsLink = `href="${GIBS_CREDIT.href ?? ""}"`;
    expect(render()).toContain(gibsLink);
    actions.setLayer("goesIr", false);
    expect(render()).not.toContain(line);
    expect(render()).not.toContain(gibsLink);
    actions.setLoadStatus("gibs", "idle");
  });
});

describe("the terrain credits (M6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TERRAIN_CREDIT links the joerd attribution document; the 11 required statements, verbatim", () => {
    expect(TERRAIN_CREDIT).toEqual({
      text: "Terrain: AWS Terrain Tiles (Tilezen Joerd), data sources and attribution",
      href: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      licence: null,
      licenceHref: null,
    });
    expect(TERRAIN_SOURCE_STATEMENTS).toHaveLength(11);
    expect(TERRAIN_SOURCE_STATEMENTS[0]).toBe(
      "ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736",
    );
    expect(TERRAIN_SOURCE_STATEMENTS[2]).toBe(
      "Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich",
    );
    expect(TERRAIN_SOURCE_STATEMENTS[10]).toBe(
      "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.",
    );
    // Line breaks joined, the trailing ";" dropped, and no Mapzen line.
    for (const s of TERRAIN_SOURCE_STATEMENTS) {
      expect(s).not.toMatch(/\n|;$|Mapzen/);
    }
  });

  it("in use while the hillshade is on or the active camera's horizon is loading or ready", () => {
    expect(terrainInUse(false, "idle")).toBe(false);
    expect(terrainInUse(false, "error")).toBe(false);
    expect(terrainInUse(false, "loading")).toBe(true);
    expect(terrainInUse(false, "ready")).toBe(true);
    expect(terrainInUse(true, "idle")).toBe(true);
  });

  it("Credits shows the link and every statement, never a subset, only while terrain is in use", () => {
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.setRegistry(committedCameras());
    actions.setActiveCamera("synthetic-walenstadt");
    actions.setLayer("hillshade", false);
    const render = () => renderToStaticMarkup(createElement(Credits));
    const link = `href="${TERRAIN_CREDIT.href ?? ""}"`;
    expect(render()).not.toContain(link);
    actions.setHorizon("synthetic-walenstadt", { status: "loading" });
    const html = render();
    expect(html).toContain(link);
    expect(html).toContain(TERRAIN_CREDIT.text);
    for (const statement of TERRAIN_SOURCE_STATEMENTS) {
      expect(html).toContain(`<li>${statement.replaceAll("&", "&amp;")}</li>`);
    }
    actions.setHorizon("synthetic-walenstadt", { status: "error" });
    expect(render()).not.toContain(link);
    actions.setLayer("hillshade", true);
    expect(render()).toContain(link);
    actions.setLayer("hillshade", false);
    actions.setHorizon("synthetic-walenstadt", { status: "idle" });
    actions.setActiveCamera("synthetic-maunakea");
  });
});
