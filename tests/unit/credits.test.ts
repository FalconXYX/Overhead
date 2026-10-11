import { describe, expect, it } from "vitest";
import {
  BSC5_CREDIT,
  CELESTRAK_CREDIT,
  dataCredits,
  GIBS_CREDIT,
  IAU_WGSN_CREDIT,
  OSM_NE_CREDIT,
  starCredits,
  TRUE_COLOR_INSTRUMENT,
} from "../../src/app/credits";

/** Both satellite layers off: the M1 cases. */
const NO_SATELLITES = { satellites: false, starlink: false } as const;

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
        const none = { trueColor: false, coastlines: false, satellites, starlink };
        expect(dataCredits(none, gibsReady), `${gibsReady} ${satellites} ${starlink}`).toEqual([
          CELESTRAK_CREDIT,
        ]);
      }
    }
    // Last, after the GIBS lines; once only with both satellite layers on.
    const all = { trueColor: true, coastlines: true, satellites: true, starlink: true };
    expect(dataCredits(all, true)).toEqual([GIBS_CREDIT, OSM_NE_CREDIT, CELESTRAK_CREDIT]);
    expect(dataCredits(all, true)[2]).toBe(CELESTRAK_CREDIT);
    expect(dataCredits(all, false)).toEqual([CELESTRAK_CREDIT]);
    expect(dataCredits({ ...all, satellites: false, starlink: false }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
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
