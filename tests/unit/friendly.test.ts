// tests/unit/friendly.test.ts — plain-language names, kinds, positions and visibility (redesign spec section 3): the
// spec's examples, every object in the committed CelesTrak fixtures, where-to-look thresholds and compass words.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compassWord,
  describeObject,
  friendlyBody,
  friendlyName,
  friendlySatellite,
  friendlyStar,
  kindClassOf,
  lowerFirst,
  objectKind,
  titleCase,
  visibilityText,
  whereToLook,
  withThe,
} from "../../src/ui/friendly";

/** OBJECT_NAME of every record in the stations and visual fixtures (NORAD ids repeat across the two). */
function fixtureObjects(): Map<number, string> {
  const byNorad = new Map<number, string>();
  for (const group of ["stations", "visual"]) {
    const records = JSON.parse(
      readFileSync(new URL(`../fixtures/gp/${group}.json`, import.meta.url), "utf8"),
    ) as { OBJECT_NAME: string; NORAD_CAT_ID: number }[];
    for (const r of records) byNorad.set(Number(r.NORAD_CAT_ID), r.OBJECT_NAME);
  }
  return byNorad;
}

describe("the spec's examples", () => {
  it("stations, Starlink, rocket stages, debris and the known vehicles", () => {
    expect(friendlySatellite("ISS (ZARYA)")).toEqual({
      name: "International Space Station",
      shortName: "ISS",
      kind: "space-station",
      description: "A crewed space station, about 420 km up.",
      className: "kind-iss",
    });
    expect(friendlySatellite("CSS (TIANHE)")).toMatchObject({
      name: "Tiangong space station",
      description: "China's crewed space station.",
      className: "kind-satellite",
    });
    expect(friendlySatellite("STARLINK-1234")).toEqual({
      name: "Starlink satellite",
      shortName: "Starlink satellite",
      kind: "starlink",
      description: "One of SpaceX's internet satellites.",
      className: "kind-starlink",
    });
    expect(friendlyName("STARLINK-31571 [DTC]")).toBe("Starlink satellite");
    expect(friendlySatellite("SL-3 R/B")).toMatchObject({
      name: "Spent rocket stage (SL-3)",
      shortName: "Rocket stage",
      kind: "rocket-stage",
      description: "The used upper stage of a rocket, left in orbit.",
    });
    expect(friendlyName("CZ-2C R/B")).toBe("Spent rocket stage (CZ-2C)");
    expect(friendlyName("SL-12 R/B(2)")).toBe("Spent rocket stage (SL-12)");
    expect(friendlyName("DELTA 2 R/B(1)")).toBe("Spent rocket stage (Delta 2)");
    expect(friendlyName("IDEFIX & ARIANE 42P R/B")).toBe("Spent rocket stage (Ariane 42P)");
    expect(friendlySatellite("FREGAT DEB")).toMatchObject({
      name: "Space debris (Fregat)",
      kind: "debris",
      description: "A piece of debris left in orbit.",
    });
    expect(friendlyName("COSMOS 2251 DEB")).toBe("Space debris (Cosmos 2251)");
    expect(friendlyName("CYGNUS NG-24")).toBe("Cygnus cargo ship");
    expect(friendlyName("CREW DRAGON 13")).toBe("Dragon capsule");
    expect(friendlyName("DRAGON CRS-33")).toBe("Dragon capsule");
    expect(friendlyName("PROGRESS-MS 34")).toBe("Progress cargo ship");
    expect(friendlyName("SOYUZ-MS 29")).toBe("Soyuz crew capsule");
    expect(friendlyName("HST")).toBe("Hubble Space Telescope");
    expect(objectKind("HST")).toBe("telescope");
    expect(objectKind("SOYUZ-MS 29")).toBe("spacecraft");
  });

  it("ISS and Tiangong modules; the ISS's parts share its colour", () => {
    expect(friendlySatellite("ISS (NAUKA)")).toMatchObject({
      name: "Nauka module",
      kind: "station-module",
      description: "Part of the International Space Station.",
      className: "kind-iss",
    });
    expect(friendlySatellite("POISK")).toMatchObject({
      name: "Poisk module",
      className: "kind-iss",
    });
    expect(friendlySatellite("CSS (WENTIAN)")).toMatchObject({
      name: "Wentian module",
      description: "Part of China's Tiangong space station.",
      className: "kind-satellite",
    });
  });

  it("anything else: the name in title case, said to be a satellite", () => {
    expect(friendlySatellite("COSMOS 1536")).toMatchObject({
      name: "Cosmos 1536 (satellite)",
      shortName: "Cosmos 1536",
      kind: "satellite",
      description: "A Soviet or Russian satellite.",
    });
    expect(friendlyName("ORBVIEW 2 (SEASTAR)")).toBe("Orbview 2 (satellite)");
    expect(friendlyName("MIDORI II (ADEOS-II)")).toBe("Midori II (satellite)");
    expect(friendlyName("HMU-SAT2")).toBe("HMU-SAT2 (satellite)");
    expect(describeObject("KNACKSAT-2")).toBe("A satellite orbiting Earth.");
    expect(friendlySatellite("")).toMatchObject({
      name: "Unnamed satellite",
      shortName: "Satellite",
    });
  });

  it("planets, the Moon, the Sun and stars", () => {
    expect(friendlyBody("planet:Jupiter", "Jupiter")).toMatchObject({
      name: "Jupiter (planet)",
      shortName: "Jupiter",
      kind: "planet",
      className: "kind-planet",
    });
    expect(friendlyBody("moon", "Moon")).toMatchObject({
      name: "Moon",
      kind: "moon",
      description: "Earth's moon.",
      className: "kind-moon",
    });
    expect(friendlyBody("moon", "Moon (new)").description).toContain("new");
    expect(friendlyBody("sun")).toMatchObject({
      name: "Sun",
      kind: "sun",
      className: "kind-sun",
    });
    expect(friendlyBody("sun").description).toContain("Never look straight at it");
    expect(friendlyStar("Polaris")).toMatchObject({
      name: "Polaris (star)",
      kind: "star",
      className: "kind-star",
    });
    expect(friendlyStar("").name).toBe("A star");
    expect(friendlyStar("HR 7001").name).toBe("A star");
  });
});

describe("every object in the committed fixtures", () => {
  const objects = fixtureObjects();

  it("is the ~175 objects of stations.json and visual.json", () => {
    expect(objects.size).toBeGreaterThanOrEqual(170);
  });

  it("gets a plain name that says what it is, with no catalogue jargon", () => {
    const saysWhat =
      /(\(satellite\)|module|cargo ship|crew capsule|capsule|space station|Space Station|space telescope|Space Telescope|solar sail|^Spent rocket stage|^Space debris|satellite$)/;
    for (const [norad, catalogName] of objects) {
      const f = friendlySatellite(catalogName);
      const where = `${catalogName} (${norad})`;
      expect(f.name, where).toMatch(saysWhat);
      expect(f.name, where).not.toMatch(/R\/B|\bDEB\b|NORAD|\[|ZARYA|TIANHE/);
      expect(f.shortName, where).not.toBe("");
      expect(f.description, where).toMatch(/^[A-Z].*\.$/);
      // No all-capitals word of four or more letters, except known acronyms.
      for (const word of f.name.split(/[\s()-]+/)) {
        if (/^[A-Z]{4,}$/.test(word))
          expect(["ALOS", "ASTEX", "ISIS", "SERT", "XRISM", "SAT2", "GSLV"], where).toContain(word);
      }
    }
  });

  it("colours the ISS orange and every other satellite cyan", () => {
    for (const [norad, catalogName] of objects) {
      const { className } = friendlySatellite(catalogName);
      const iss =
        catalogName === "ISS (ZARYA)" || catalogName === "ISS (NAUKA)" || catalogName === "POISK";
      expect(className, `${catalogName} (${norad})`).toBe(iss ? "kind-iss" : "kind-satellite");
    }
  });
});

describe("titleCase", () => {
  it("keeps short parts, parts with digits and parts without vowels in capitals", () => {
    expect(titleCase("COSMOS 1536")).toBe("Cosmos 1536");
    expect(titleCase("THOR AGENA D")).toBe("Thor Agena D");
    expect(titleCase("RESURS-DK 1")).toBe("Resurs-DK 1");
    expect(titleCase("KORONAS-FOTON")).toBe("Koronas-Foton");
    expect(titleCase("GSLV")).toBe("GSLV");
    expect(titleCase("  ALOS-2 ")).toBe("ALOS-2");
  });
});

describe("kind classes and articles", () => {
  it("by id when no name is at hand", () => {
    expect(kindClassOf("sat:25544")).toBe("kind-iss");
    expect(kindClassOf("sat:19046")).toBe("kind-satellite");
    expect(kindClassOf("star:424")).toBe("kind-star");
    expect(kindClassOf("planet:Venus")).toBe("kind-planet");
    expect(kindClassOf("moon")).toBe("kind-moon");
    expect(kindClassOf("sun")).toBe("kind-sun");
  });

  it("'the' before stations and telescopes only", () => {
    expect(withThe(friendlySatellite("ISS (ZARYA)"))).toBe("the International Space Station");
    expect(withThe(friendlySatellite("HST"))).toBe("the Hubble Space Telescope");
    expect(withThe(friendlySatellite("COSMOS 1536"))).toBe("Cosmos 1536 (satellite)");
  });
});

describe("whereToLook", () => {
  it("a height word and a compass word: low < 20°, high ≥ 50°, overhead ≥ 80°", () => {
    expect(whereToLook(90, 10)).toBe("Low in the east");
    expect(whereToLook(90, 19.99)).toBe("Low in the east");
    expect(whereToLook(180, 20)).toBe("Halfway up in the south");
    expect(whereToLook(123.8, 28.9)).toBe("Halfway up in the south-east");
    expect(whereToLook(225, 50)).toBe("High in the south-west");
    expect(whereToLook(300, 79.9)).toBe("High in the north-west");
    expect(whereToLook(10, 80)).toBe("Almost overhead");
    expect(whereToLook(0, 0)).toBe("Low in the north");
    expect(whereToLook(270, -3)).toBe("Below the horizon, to the west");
  });

  it("eight compass sectors centred on each direction", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(22.4)).toBe("north");
    expect(compassWord(22.5)).toBe("north-east");
    expect(compassWord(67.4)).toBe("north-east");
    expect(compassWord(67.5)).toBe("east");
    expect(compassWord(337.5)).toBe("north");
    expect(compassWord(359.9)).toBe("north");
    expect(compassWord(360)).toBe("north");
    expect(compassWord(-90)).toBe("west");
  });

  it("degrees never appear", () => {
    for (let az = 0; az < 360; az += 7) {
      for (let alt = -10; alt <= 90; alt += 9) expect(whereToLook(az, alt)).not.toMatch(/°|\d/);
    }
  });

  it("lowerFirst for the middle of a sentence", () => {
    expect(lowerFirst("High in the east")).toBe("high in the east");
  });
});

describe("visibilityText", () => {
  it("lit and visible, in shadow, behind the mountains, below the horizon, or a bright sky", () => {
    expect(visibilityText(true, false, 30)).toBe("Lit by the Sun, visible to the eye");
    expect(visibilityText(false, false, 30)).toBe("In Earth's shadow, not visible");
    expect(visibilityText(true, true, 5)).toBe("Behind the mountains");
    expect(visibilityText(false, true, 5)).toBe("Behind the mountains");
    expect(visibilityText(true, false, -2)).toBe("Below the horizon");
    expect(visibilityText(true, false, 30, true)).toBe(
      "Lit by the Sun, but the sky is too bright to see it",
    );
    expect(visibilityText(false, false, 30, true)).toBe("In Earth's shadow, not visible");
  });
});
