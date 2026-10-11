import { describe, expect, it } from "vitest";
import {
  dataCredits,
  GIBS_CREDIT,
  OSM_NE_CREDIT,
  TRUE_COLOR_INSTRUMENT,
} from "../../src/app/credits";

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
    expect(dataCredits({ trueColor: true, coastlines: true }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
    expect(dataCredits({ trueColor: true, coastlines: false }, true)).toEqual([GIBS_CREDIT]);
    expect(dataCredits({ trueColor: false, coastlines: true }, true)).toEqual([
      GIBS_CREDIT,
      OSM_NE_CREDIT,
    ]);
    expect(dataCredits({ trueColor: false, coastlines: false }, true)).toEqual([]);
  });

  it("dataCredits is empty while GIBS is not ready", () => {
    for (const trueColor of [true, false]) {
      for (const coastlines of [true, false]) {
        expect(dataCredits({ trueColor, coastlines }, false)).toEqual([]);
      }
    }
  });
});
