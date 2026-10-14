// src/ui/friendly.ts — plain-language names, kinds and positions for everything the app draws (redesign spec section
// 3). Pure functions: no React, no store, no OpenLayers. Catalogue names, NORAD ids and degrees stay out of these
// strings; they belong in the "More details" disclosures (objectText.ts).
import type { ObjectId } from "../state/types";

/** What an object is, for the card's wording. */
export type ObjectKind =
  | "space-station"
  | "station-module"
  | "spacecraft"
  | "telescope"
  | "starlink"
  | "satellite"
  | "rocket-stage"
  | "debris"
  | "planet"
  | "moon"
  | "sun"
  | "star";

/** The CSS class that colours an object the same on the video, the map, the legend and the card. */
export type KindClass =
  | "kind-iss"
  | "kind-satellite"
  | "kind-starlink"
  | "kind-planet"
  | "kind-moon"
  | "kind-sun"
  | "kind-star";

export interface Friendly {
  /** Says what it is on its own: "International Space Station", "Cosmos 1536 (satellite)", "Jupiter (planet)". */
  readonly name: string;
  /** For tight spaces such as the incoming chip: "ISS", "Rocket stage", "Cosmos 1536". */
  readonly shortName: string;
  readonly kind: ObjectKind;
  /** One line on what it is. */
  readonly description: string;
  readonly className: KindClass;
}

// ---- satellites, from their CelesTrak OBJECT_NAME

const ROCKET_STAGE_TEXT = "The used upper stage of a rocket, left in orbit.";
const DEBRIS_TEXT = "A piece of debris left in orbit.";
const SATELLITE_TEXT = "A satellite orbiting Earth.";
const ISS_PART_TEXT = "Part of the International Space Station.";
const TIANGONG_PART_TEXT = "Part of China's Tiangong space station.";

/** Words kept in capitals by titleCase: acronyms with vowels that would otherwise read as words. */
const ACRONYMS = new Set(["ALOS", "ASTEX", "ISIS", "NOAA", "GOES", "SERT", "TDRS", "XRISM"]);

/**
 * "COSMOS 1536" → "Cosmos 1536"; "MIDORI II" → "Midori II"; "HMU-SAT2" → "HMU-SAT2". A part keeps its capitals when
 * it holds a digit, has at most three letters, has no vowel, or is a known acronym.
 */
export function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          /\d/.test(part) ||
          part.length <= 3 ||
          !/[AEIOUY]/i.test(part) ||
          ACRONYMS.has(part.toUpperCase())
            ? part
            : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
        )
        .join("-"),
    )
    .join(" ");
}

/** "ORBVIEW 2 (SEASTAR)" → "ORBVIEW 2": CelesTrak's parenthesised second names. */
const withoutParens = (name: string): string => name.replace(/\s*\([^)]*\)/g, "").trim();

const satellite = (
  name: string,
  shortName: string,
  kind: ObjectKind,
  description: string,
  className: KindClass = "kind-satellite",
): Friendly => ({ name, shortName, kind, description, className });

/** A plain satellite: "Terra (satellite)", short "Terra". */
const plainSatellite = (title: string, description = SATELLITE_TEXT): Friendly =>
  satellite(`${title} (satellite)`, title, "satellite", description);

const KNOWN: Readonly<Record<string, Friendly>> = {
  "ISS (ZARYA)": satellite(
    "International Space Station",
    "ISS",
    "space-station",
    "A crewed space station, about 420 km up.",
    "kind-iss",
  ),
  "CSS (TIANHE)": satellite(
    "Tiangong space station",
    "Tiangong",
    "space-station",
    "China's crewed space station.",
  ),
  POISK: satellite("Poisk module", "Poisk module", "station-module", ISS_PART_TEXT, "kind-iss"),
  HST: satellite(
    "Hubble Space Telescope",
    "Hubble",
    "telescope",
    "NASA's famous space telescope, about 530 km up.",
  ),
  "ATLAS CENTAUR 2": satellite(
    "Spent rocket stage (Atlas Centaur)",
    "Rocket stage",
    "rocket-stage",
    ROCKET_STAGE_TEXT,
  ),
  "OAO 2": satellite(
    "OAO 2 space telescope",
    "OAO 2",
    "telescope",
    "An early NASA space telescope from 1968, no longer working.",
  ),
  "OAO 3 (COPERNICUS)": satellite(
    "Copernicus space telescope",
    "Copernicus",
    "telescope",
    "An early NASA space telescope from 1972, no longer working.",
  ),
  "ASTRO-H (HITOMI)": satellite(
    "Hitomi space telescope",
    "Hitomi",
    "telescope",
    "A Japanese X-ray telescope that broke apart in 2016.",
  ),
  XRISM: satellite(
    "XRISM space telescope",
    "XRISM",
    "telescope",
    "A Japanese X-ray space telescope.",
  ),
  "HXMT (HUIYAN)": satellite(
    "Huiyan space telescope",
    "Huiyan",
    "telescope",
    "China's X-ray space telescope.",
  ),
  ACS3: satellite(
    "ACS3 solar sail",
    "ACS3",
    "spacecraft",
    "A NASA test spacecraft with a thin sail pushed by sunlight.",
  ),
  "AJISAI (EGS)": plainSatellite(
    "Ajisai",
    "A Japanese ball covered in mirrors that flashes in sunlight.",
  ),
  ENVISAT: plainSatellite(
    "Envisat",
    "A large European satellite that watched Earth; no longer working.",
  ),
  TERRA: plainSatellite("Terra", "A NASA satellite that watches Earth's land, oceans and air."),
  AQUA: plainSatellite("Aqua", "A NASA satellite that studies Earth's water."),
  "SEASAT 1": plainSatellite("Seasat 1", "An early NASA ocean-watching satellite from 1978."),
};

interface Rule {
  readonly test: RegExp;
  readonly make: (match: RegExpExecArray) => Friendly;
}

const vehicle = (name: string, description: string): Friendly =>
  satellite(name, name, "spacecraft", description);

/** First match wins; KNOWN is checked before these. */
const RULES: readonly Rule[] = [
  {
    // "FREGAT DEB", "COSMOS 2251 DEB", "ISS DEB [SPX-28 IPA FSE]"
    test: /^(.*?)\s*\bDEB\b/,
    make: (m) => {
      const from = titleCase(withoutParens(m[1] ?? ""));
      return satellite(
        from === "" ? "Space debris" : `Space debris (${from})`,
        "Debris",
        "debris",
        DEBRIS_TEXT,
      );
    },
  },
  {
    // "SL-3 R/B", "SL-12 R/B(2)", "DELTA 2 R/B(1)", "IDEFIX & ARIANE 42P R/B" (a payload riding on the stage)
    test: /^(.*?)\s*\bR\/B\b/,
    make: (m) => {
      const from = titleCase(withoutParens((m[1] ?? "").split(" & ").pop() ?? ""));
      return satellite(
        from === "" ? "Spent rocket stage" : `Spent rocket stage (${from})`,
        "Rocket stage",
        "rocket-stage",
        ROCKET_STAGE_TEXT,
      );
    },
  },
  {
    test: /^ISS \((.+)\)$/,
    make: (m) => {
      const name = `${titleCase(m[1] ?? "")} module`;
      return satellite(name, name, "station-module", ISS_PART_TEXT, "kind-iss");
    },
  },
  {
    test: /^CSS \((.+)\)$/,
    make: (m) => {
      const name = `${titleCase(m[1] ?? "")} module`;
      return satellite(name, name, "station-module", TIANGONG_PART_TEXT);
    },
  },
  {
    test: /^STARLINK\b/,
    make: () =>
      satellite(
        "Starlink satellite",
        "Starlink satellite",
        "starlink",
        "One of SpaceX's internet satellites.",
        "kind-starlink",
      ),
  },
  {
    test: /^CYGNUS\b/,
    make: () =>
      vehicle("Cygnus cargo ship", "A robotic US cargo ship that supplies the Space Station."),
  },
  {
    test: /\bDRAGON\b/,
    make: () =>
      vehicle(
        "Dragon capsule",
        "SpaceX's capsule that carries astronauts or cargo to the Space Station.",
      ),
  },
  {
    test: /^PROGRESS\b/,
    make: () =>
      vehicle(
        "Progress cargo ship",
        "A robotic Russian cargo ship that supplies the Space Station.",
      ),
  },
  {
    test: /^SOYUZ\b/,
    make: () =>
      vehicle(
        "Soyuz crew capsule",
        "A Russian spacecraft that carries astronauts to and from the Space Station.",
      ),
  },
  {
    test: /^STARLINER\b/,
    make: () =>
      vehicle(
        "Starliner crew capsule",
        "Boeing's spacecraft that carries astronauts to the Space Station.",
      ),
  },
  {
    test: /^HTV\b/,
    make: () =>
      vehicle("HTV cargo ship", "A robotic Japanese cargo ship that supplies the Space Station."),
  },
  {
    test: /^TIANZHOU\b/,
    make: () =>
      vehicle("Tianzhou cargo ship", "A robotic Chinese cargo ship that supplies Tiangong."),
  },
  {
    test: /^SHENZHOU\b/,
    make: () =>
      vehicle(
        "Shenzhou crew capsule",
        "A Chinese spacecraft that carries astronauts to and from Tiangong.",
      ),
  },
  {
    // "SZ-21 MODULE": the orbital module a Shenzhou leaves behind
    test: /^SZ-\d+ MODULE\b/,
    make: () => vehicle("Shenzhou module", "A section left in orbit by a Chinese crew spacecraft."),
  },
  {
    test: /^(SPACEMOBILE|BLUEBIRD)\b/,
    make: () =>
      satellite(
        "AST SpaceMobile satellite",
        "SpaceMobile satellite",
        "satellite",
        "A large satellite that connects straight to ordinary mobile phones.",
      ),
  },
  {
    test: /^ONEWEB\b/,
    make: () =>
      satellite(
        "OneWeb satellite",
        "OneWeb satellite",
        "satellite",
        "One of OneWeb's internet satellites.",
      ),
  },
  {
    test: /^KUIPER\b/,
    make: () =>
      satellite(
        "Amazon Kuiper satellite",
        "Kuiper satellite",
        "satellite",
        "One of Amazon's internet satellites.",
      ),
  },
  {
    test: /^IRIDIUM\b/,
    make: () =>
      satellite(
        "Iridium satellite",
        "Iridium satellite",
        "satellite",
        "One of the Iridium satellites, which carry satellite phone calls.",
      ),
  },
  {
    test: /^(INTER)?COSMOS \d/,
    make: (m) =>
      plainSatellite(titleCase(withoutParens(m.input)), "A Soviet or Russian satellite."),
  },
  {
    test: /^USA \d/,
    make: (m) => plainSatellite(titleCase(withoutParens(m.input)), "A US government satellite."),
  },
  {
    test: /^YAOGAN\b/,
    make: (m) =>
      plainSatellite(titleCase(withoutParens(m.input)), "A Chinese satellite that watches Earth."),
  },
];

/** Everything friendly about one satellite, from its CelesTrak OBJECT_NAME. */
export function friendlySatellite(catalogName: string): Friendly {
  const upper = catalogName.trim().toUpperCase();
  const known = KNOWN[upper];
  if (known !== undefined) return known;
  for (const rule of RULES) {
    const m = rule.test.exec(upper);
    if (m !== null) return rule.make(m);
  }
  const title = titleCase(withoutParens(upper));
  return title === ""
    ? satellite("Unnamed satellite", "Satellite", "satellite", SATELLITE_TEXT)
    : plainSatellite(title);
}

/** "ISS (ZARYA)" → "International Space Station"; "SL-3 R/B" → "Spent rocket stage (SL-3)". */
export const friendlyName = (catalogName: string): string => friendlySatellite(catalogName).name;
export const objectKind = (catalogName: string): ObjectKind => friendlySatellite(catalogName).kind;
export const describeObject = (catalogName: string): string =>
  friendlySatellite(catalogName).description;

// ---- the Sun, Moon, planets and stars

const PLANET_TEXT: Readonly<Record<string, string>> = {
  Mercury: "The planet closest to the Sun, seen low in twilight.",
  Venus: "The brightest planet, often called the morning or evening star.",
  Mars: "The red planet.",
  Jupiter: "The largest planet, and one of the brightest things in the night sky.",
  Saturn: "The ringed planet.",
  Uranus: "A distant planet, barely visible to the eye on a dark night.",
};

/**
 * The Sun, Moon or a planet. `label` is bodyLabel's text: "Moon (new)" while the Moon is new. Planets read
 * "Jupiter (planet)"; the Moon and the Sun stay plain.
 */
export function friendlyBody(id: "sun" | "moon" | `planet:${string}`, label = ""): Friendly {
  if (id === "sun") {
    return {
      name: "Sun",
      shortName: "Sun",
      kind: "sun",
      description: "Our star. Never look straight at it.",
      className: "kind-sun",
    };
  }
  if (id === "moon") {
    return {
      name: "Moon",
      shortName: "Moon",
      kind: "moon",
      description: label.includes("new")
        ? "Earth's moon, new tonight, so almost impossible to see."
        : "Earth's moon.",
      className: "kind-moon",
    };
  }
  const planet = id.slice("planet:".length);
  return {
    name: `${planet} (planet)`,
    shortName: planet,
    kind: "planet",
    description: PLANET_TEXT[planet] ?? "A planet, shining by reflected sunlight.",
    className: "kind-planet",
  };
}

/** A star: "Polaris (star)", or "A star" when it has no proper name (`properName` is "" or an "HR n" label). */
export function friendlyStar(properName: string): Friendly {
  const named = properName !== "" && !/^HR \d+$/.test(properName);
  return {
    name: named ? `${properName} (star)` : "A star",
    shortName: named ? properName : "Star",
    kind: "star",
    description: "A star, like the Sun but much farther away.",
    className: "kind-star",
  };
}

/** The kind class for an id when no name is at hand (satellites: the ISS is told apart by its NORAD id, 25544). */
export function kindClassOf(id: ObjectId): KindClass {
  if (id === "sat:25544") return "kind-iss";
  if (id.startsWith("sat:")) return "kind-satellite";
  if (id.startsWith("star:")) return "kind-star";
  if (id === "moon") return "kind-moon";
  if (id === "sun") return "kind-sun";
  return "kind-planet";
}

/** "the International Space Station", "the Hubble Space Telescope"; other names as they are. */
export function withThe(f: Friendly): string {
  return f.kind === "space-station" || f.kind === "telescope" ? `the ${f.name}` : f.name;
}

// ---- where to look and whether it can be seen

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

/** One of eight compass words for an azimuth (0° north, 90° east). */
export function compassWord(azDeg: number): string {
  const sector = Math.round((((azDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[sector] ?? "north";
}

export const LOW_BELOW_DEG = 20;
export const HIGH_FROM_DEG = 50;
export const OVERHEAD_FROM_DEG = 80;

/**
 * A compass word and a height word, from apparent az/alt: "Low in the east" (< 20°), "Halfway up in the south"
 * (20–50°), "High in the south-west" (≥ 50°), "Almost overhead" (≥ 80°), or "Below the horizon, to the north".
 */
export function whereToLook(azDeg: number, altDeg: number): string {
  const dir = compassWord(azDeg);
  if (altDeg >= OVERHEAD_FROM_DEG) return "Almost overhead";
  if (altDeg >= HIGH_FROM_DEG) return `High in the ${dir}`;
  if (altDeg >= LOW_BELOW_DEG) return `Halfway up in the ${dir}`;
  if (altDeg >= 0) return `Low in the ${dir}`;
  return `Below the horizon, to the ${dir}`;
}

/**
 * Whether a satellite can be seen: below the horizon, then behind the mountains, then Earth's shadow, then a sky too
 * bright (the Sun above the group's cut-off), else lit and visible.
 */
export function visibilityText(
  lit: boolean,
  behindTerrain: boolean,
  altDeg: number,
  skyTooBright = false,
): string {
  if (altDeg < 0) return "Below the horizon";
  if (behindTerrain) return "Behind the mountains";
  if (!lit) return "In Earth's shadow, not visible";
  if (skyTooBright) return "Lit by the Sun, but the sky is too bright to see it";
  return "Lit by the Sun, visible to the eye";
}

/** "High in the east" → "high in the east", for the middle of a sentence. */
export const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
