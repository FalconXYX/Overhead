import { describe, expect, it } from "vitest";
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../../src/domain/astro";
import type { GroupData } from "../../src/state/types";
import {
  altText,
  azText,
  behindTerrain,
  bodyMagnitudeText,
  type CatalogView,
  dockedText,
  elementAgeText,
  GROUP_LABELS,
  groupStatusText,
  horizonStatusText,
  isStale,
  litText,
  missingSatelliteText,
  objectDetails,
  rangeText,
  type SatFrameView,
  type SkyView,
  satelliteGroupsPending,
  starMagnitudeText,
  terrainLines,
  visibilityText,
} from "../../src/ui/objectText";

const T = Date.parse("2026-10-11T15:09:50Z");
const ISS_EPOCH_MS = Date.parse("2026-10-09T22:48:38.797Z");
const DAY_MS = 86_400_000;

describe("field formats", () => {
  it("az and alt to 0.1°, the alt apparent and signed", () => {
    expect(azText(123.812)).toBe("az 123.8°");
    expect(azText(359.96)).toBe("az 0.0°"); // never "360.0"
    expect(azText(0.04)).toBe("az 0.0°");
    expect(altText(28.872)).toBe("alt 28.9°");
    expect(altText(-0.04)).toBe("alt 0.0°"); // never "-0.0"
    expect(altText(-3.26)).toBe("alt −3.3°");
  });

  it("range in whole km, Sunlit or In Earth's shadow", () => {
    expect(rangeText(794.522)).toBe("795 km"); // 0.02 km above the rounding edge (M3 section 5)
    expect(rangeText(794.494)).toBe("794 km");
    expect(rangeText(1045.48)).toBe("1,045 km");
    expect(litText(true)).toBe("Sunlit");
    expect(litText(false)).toBe("In Earth's shadow");
  });

  it("magnitudes: V to 0.01 for stars, 0.1 for bodies, with a true minus", () => {
    expect(starMagnitudeText(2.02)).toBe("V magnitude 2.02");
    expect(starMagnitudeText(-1.46)).toBe("V magnitude −1.46");
    expect(bodyMagnitudeText(-2.47)).toBe("Magnitude −2.5");
    expect(bodyMagnitudeText(0.46)).toBe("Magnitude 0.5");
  });

  it("group names", () => {
    expect(GROUP_LABELS).toEqual({
      stations: "Space stations",
      visual: "Brightest (CelesTrak visual)",
      starlink: "Starlink",
    });
  });

  it("element age relative to sim time; stale past 7 days either way", () => {
    expect(elementAgeText(ISS_EPOCH_MS, T)).toBe("Elements 1.7 days old");
    expect(elementAgeText(T - 1.3 * DAY_MS, T)).toBe("Elements 1.3 days old");
    expect(elementAgeText(T - 19.92 * DAY_MS, T)).toBe("Stale elements: 19.9 days old");
    expect(elementAgeText(T - 7 * DAY_MS, T)).toBe("Elements 7.0 days old"); // |age| > 7 is stale
    expect(isStale(T - 7 * DAY_MS, T)).toBe(false);
    expect(isStale(T - 7 * DAY_MS - 1, T)).toBe(true);
    // Sim time before the epoch (a seek back): the same rule on |age|.
    expect(elementAgeText(T + 0.5 * DAY_MS, T)).toBe("Elements 0.5 days ahead of this time");
    expect(elementAgeText(T + 8.4 * DAY_MS, T)).toBe("Stale elements: 8.4 days ahead of this time");
    expect(isStale(T + 8.4 * DAY_MS, T)).toBe(true);
    expect(elementAgeText(T + 1_000, T)).toBe("Elements 0.0 days old");
  });

  it("visibility: Visible to the eye, else the first failing reason", () => {
    const live = {
      sunlit: true,
      aboveHorizon: true,
      visible: true,
      sunAltDeg: -16.2,
      altDeg: 28.9,
    };
    expect(visibilityText(live, "stations")).toBe("Visible to the eye");
    expect(visibilityText({ ...live, visible: false, sunlit: false }, "visual")).toBe(
      "Not visible: in Earth's shadow",
    );
    expect(
      visibilityText({ ...live, visible: false, sunlit: false, aboveHorizon: false }, "visual"),
    ).toBe("Not visible: in Earth's shadow");
    // Starlink's cutoff is −12°, stations and visual −6°.
    expect(visibilityText({ ...live, visible: false, sunAltDeg: -8 }, "starlink")).toBe(
      "Not visible: Sun too high",
    );
    expect(visibilityText({ ...live, visible: false, sunAltDeg: -5 }, "stations")).toBe(
      "Not visible: Sun too high",
    );
    expect(
      visibilityText({ ...live, visible: false, aboveHorizon: false, altDeg: -3 }, "stations"),
    ).toBe("Not visible: below the horizon");
    // [M6] Above 0° but at or below the terrain horizon (the flag uses the terrain horizon).
    expect(visibilityText({ ...live, visible: false, aboveHorizon: false }, "stations")).toBe(
      "Not visible: behind terrain",
    );
    // A flag the three rules do not explain still reads as not visible.
    expect(visibilityText({ ...live, visible: false }, "stations")).toBe("Not visible to the eye");
  });

  it("a missing satellite waits while stations or visual has not loaded, or Starlink is loading", () => {
    const g = (status: GroupData["status"]): GroupData => ({ status, count: 0, fetchedAtMs: null });
    const gp = (
      stations: GroupData["status"],
      visual: GroupData["status"],
      starlink: GroupData["status"],
    ) => ({
      stations: g(stations),
      visual: g(visual),
      starlink: g(starlink),
    });
    expect(satelliteGroupsPending(gp("idle", "idle", "idle"))).toBe(true); // before cameras.json
    expect(satelliteGroupsPending(gp("loading", "loading", "idle"))).toBe(true);
    expect(satelliteGroupsPending(gp("ready", "loading", "idle"))).toBe(true);
    expect(satelliteGroupsPending(gp("ready", "ready", "loading"))).toBe(true);
    expect(satelliteGroupsPending(gp("ready", "ready", "idle"))).toBe(false); // Starlink never requested
    expect(satelliteGroupsPending(gp("ready", "ready", "ready"))).toBe(false);
    expect(satelliteGroupsPending(gp("error", "ready", "error"))).toBe(false); // no retry loop: settled
  });

  it("docked vehicles and a satellite outside the loaded groups", () => {
    expect(dockedText(["POISK", "ISS (NAUKA)"])).toBe("Docked: POISK, ISS (NAUKA)");
    expect(missingSatelliteText(12345)).toBe(
      "Satellite 12345 is not in the loaded groups. Turn on Starlink if it is a Starlink satellite.",
    );
  });
});

describe("groupStatusText", () => {
  const FETCHED = Date.parse("2026-10-11T03:50:21Z");
  const g = (status: GroupData["status"], count = 0, fetchedAtMs: number | null = null) => ({
    status,
    count,
    fetchedAtMs,
  });

  it("ready: the object count and the fetch stamp to the minute, UTC", () => {
    expect(groupStatusText([g("ready", 11102, FETCHED)])).toBe(
      "11,102 objects, elements fetched 2026-10-11 03:50 UTC",
    );
    // Stations and visual together: the sum, and the older stamp.
    expect(groupStatusText([g("ready", 12, FETCHED), g("ready", 153, FETCHED + 3_600_000)])).toBe(
      "165 objects, elements fetched 2026-10-11 03:50 UTC",
    );
    expect(groupStatusText([g("ready", 1, null)])).toBe("1 object");
    expect(groupStatusText([g("ready", 12, null), g("ready", 153, FETCHED)])).toBe(
      "165 objects, elements fetched 2026-10-11 03:50 UTC",
    );
  });

  it("failed beats loading beats ready; all idle shows nothing", () => {
    expect(groupStatusText([g("idle"), g("idle")])).toBeNull();
    expect(groupStatusText([g("loading")])).toBe("Loading…");
    expect(groupStatusText([g("ready", 12, FETCHED), g("loading")])).toBe("Loading…");
    expect(groupStatusText([g("ready", 12, FETCHED), g("idle")])).toBe("Loading…");
    expect(groupStatusText([g("loading"), g("error")])).toBe("Failed to load");
    expect(groupStatusText([g("ready", 12, FETCHED), g("error")])).toBe("Failed to load");
  });
});

// ---- objectDetails over fake ephemeris and sky data ----

const ISS = 25544;
const POISK = 36086;
const DRAGON = 100882;
const SL3 = 19046;
const STARLINK = 44713;

/** Satrec order: ISS, POISK (docked), SL-3 R/B (visual), CREW DRAGON 13 (docked), a Starlink. */
function catalog(): CatalogView {
  const noradIds = Int32Array.from([ISS, POISK, SL3, DRAGON, STARLINK]);
  return {
    count: 5,
    noradIds,
    names: ["ISS (ZARYA)", "POISK", "SL-3 R/B", "CREW DRAGON 13", "STARLINK-1007"],
    groupIndex: Uint8Array.from([0, 0, 1, 0, 2]),
    epochMs: Float64Array.from([
      ISS_EPOCH_MS,
      ISS_EPOCH_MS,
      T - 2 * DAY_MS,
      ISS_EPOCH_MS - 10,
      T - 19.92 * DAY_MS,
    ]),
    dockedWith: Int32Array.from([-1, ISS, -1, ISS, -1]),
    indexByNorad: new Map([...noradIds].map((n, i) => [n, i])),
  };
}

/** The ISS at 15:09:50Z (az 123.812°, apparent alt 28.872°, 794.522 km, sunlit, visible); index 2 in shadow. */
function frame(ready = true): SatFrameView {
  const azAltDeg = new Float64Array(10);
  azAltDeg.set([123.812, 28.872], 0);
  azAltDeg.set([200.04, 41.25], 4);
  azAltDeg.set([10, -20], 8);
  return {
    timeMs: T,
    ready,
    sunAltDeg: -16.2,
    azAltDeg,
    rangeKm: Float64Array.from([794.522, 0, 1201.6, 0, 3000]),
    // bit 0 valid, 1 sunlit, 2 above horizon, 3 visible; docked rows are never valid
    flags: Uint8Array.from([0b1111, 0, 0b0101, 0, 0b0011]),
  };
}

const POLARIS: StarRow = [37.95456, 89.26411, 2.02, 424, "Polaris"];
const FAINT: StarRow = [10, 10, 5.5, 7001, ""];

function sky(loaded = true): SkyView {
  const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN);
  const jupiter = BODY_IDS.indexOf("planet:Jupiter") * BODY_STRIDE;
  bodies.set([95.25, 33.33, -2.47, 0.99], jupiter);
  const moon = BODY_IDS.indexOf("moon") * BODY_STRIDE;
  bodies.set([270, -40, -4.45, 0.01], moon);
  return {
    rows: loaded ? [POLARIS, FAINT] : [],
    starCount: loaded ? 1 : 0, // the magnitude limit leaves FAINT out
    starAzAltDeg: Float32Array.from([0.592, 20.151, 0, 0]),
    bodies,
  };
}

const sources = (ready = true, loaded = true) => ({
  catalog: catalog(),
  frame: frame(ready),
  sky: sky(loaded),
  timeMs: T,
});

describe("objectDetails", () => {
  it("a host satellite: names, group, live fields and its docked vehicles", () => {
    expect(objectDetails("sat:25544", sources())).toEqual({
      kind: "satellite",
      noradId: ISS,
      name: "ISS (ZARYA)",
      group: "stations",
      epochMs: ISS_EPOCH_MS,
      dockedTo: null,
      docked: ["POISK", "CREW DRAGON 13"],
      live: {
        azDeg: 123.812,
        altDeg: 28.872,
        rangeKm: 794.522,
        sunlit: true,
        aboveHorizon: true,
        visible: true,
        sunAltDeg: -16.2,
      },
      note: null,
    });
  });

  it("a docked vehicle shows its own name and its host's position", () => {
    const d = objectDetails("sat:100882", sources());
    expect(d).toMatchObject({
      kind: "satellite",
      noradId: DRAGON,
      name: "CREW DRAGON 13",
      dockedTo: { noradId: ISS, name: "ISS (ZARYA)" },
      docked: [],
      live: { azDeg: 123.812, altDeg: 28.872, rangeKm: 794.522 },
    });
  });

  it("a satellite in shadow below the horizon, and a stale Starlink", () => {
    expect(objectDetails("sat:19046", sources())).toMatchObject({
      group: "visual",
      live: { sunlit: false, aboveHorizon: true, visible: false, altDeg: 41.25 },
    });
    expect(objectDetails("sat:44713", sources())).toMatchObject({
      group: "starlink",
      live: { sunlit: true, aboveHorizon: false, visible: false, altDeg: -20 },
    });
  });

  it("no position before the first sample pair, or when the row is not valid", () => {
    expect(objectDetails("sat:25544", sources(false))).toMatchObject({
      live: null,
      note: "Computing position…",
    });
    const f = frame();
    const s = { ...sources(), frame: { ...f, flags: Uint8Array.from([0, 0, 0, 0, 0]) } };
    expect(objectDetails("sat:25544", s)).toMatchObject({
      live: null,
      note: "No position at this time",
    });
  });

  it("a satellite that is not in the catalog", () => {
    expect(objectDetails("sat:12345", sources())).toEqual({
      kind: "missing-satellite",
      noradId: 12345,
    });
  });

  it("stars: name or HR n, V magnitude, position only inside the magnitude prefix", () => {
    expect(objectDetails("star:424", sources())).toEqual({
      kind: "star",
      hr: 424,
      label: "Polaris",
      vmag: 2.02,
      live: { azDeg: expect.closeTo(0.592, 5), altDeg: expect.closeTo(20.151, 5) },
      note: null,
    });
    expect(objectDetails("star:7001", sources())).toEqual({
      kind: "star",
      hr: 7001,
      label: "HR 7001",
      vmag: 5.5,
      live: null,
      note: "Fainter than the star magnitude limit",
    });
    expect(objectDetails("star:424", sources(true, false))).toEqual({
      kind: "star",
      hr: 424,
      label: "HR 424",
      vmag: null,
      live: null,
      note: "Loading star catalogue…",
    });
    expect(objectDetails("star:9000", sources())).toMatchObject({
      label: "HR 9000",
      vmag: null,
      live: null,
      note: "Not in the star catalogue",
    });
  });

  it("bodies: label, position and magnitude; NaN before the first sky pass", () => {
    expect(objectDetails("planet:Jupiter", sources())).toEqual({
      kind: "body",
      id: "planet:Jupiter",
      label: "Jupiter",
      live: { azDeg: 95.25, altDeg: 33.33, mag: -2.47 },
      note: null,
    });
    expect(objectDetails("moon", sources())).toMatchObject({ label: "Moon (new)" });
    expect(objectDetails("sun", sources())).toEqual({
      kind: "body",
      id: "sun",
      label: "Sun",
      live: null,
      note: "Computing position…",
    });
  });
});

describe("terrain text (M6)", () => {
  // Walenstadt-like: the Churfirsten wall north at 32.75°, the Walensee gap west at 1.96°, a sea horizon east.
  const profile = new Float32Array(360).fill(10);
  profile[0] = 32.75;
  profile[359] = 32.65;
  profile[1] = 32.85;
  profile[270] = 1.96;
  profile[90] = -1.93;

  it("ready: the signed terrain horizon at the object's azimuth, and Behind terrain at or below it", () => {
    // Capella: az 359.92°, alt 3.37°, under 32.7° (interpolated between az 359 and 0).
    expect(terrainLines("ready", profile, 359.92, 3.37)).toEqual([
      "Terrain horizon here: +32.7°",
      "Behind terrain",
    ]);
    // Polaris: az 0.49°, alt 46.62°.
    expect(terrainLines("ready", profile, 0.49, 46.62)).toEqual(["Terrain horizon here: +32.8°"]);
    expect(terrainLines("ready", profile, 90, -1.5)).toEqual(["Terrain horizon here: −1.9°"]);
    expect(terrainLines("ready", profile, 270, 1.96)).toEqual([
      "Terrain horizon here: +2.0°",
      "Behind terrain", // at the horizon counts as behind it
    ]);
  });

  it("loading, error and idle", () => {
    expect(terrainLines("loading", null, 0, 10)).toEqual(["Terrain horizon: loading"]);
    expect(terrainLines("error", null, 0, 10)).toEqual([
      "Terrain horizon: unavailable (geometric horizon used)",
    ]);
    expect(terrainLines("idle", null, 0, 10)).toEqual([]);
  });

  it("behindTerrain needs a profile: with none, nothing is behind terrain", () => {
    expect(behindTerrain(profile, 0, 20)).toBe(true);
    expect(behindTerrain(profile, 270, 20)).toBe(false);
    expect(behindTerrain(null, 0, -5)).toBe(false);
  });

  it("the Terrain horizon toggle's status", () => {
    expect(horizonStatusText("idle")).toBeNull();
    expect(horizonStatusText("loading")).toBe("Loading terrain…");
    expect(horizonStatusText("ready")).toBe("Terrain ready");
    expect(horizonStatusText("error")).toBe("Terrain unavailable: geometric horizon");
  });
});
