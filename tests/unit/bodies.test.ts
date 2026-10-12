import { readFileSync } from "node:fs";
import { Refraction } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import {
  horizonsQueryParams,
  horizonsUtcToIso,
  parseHorizonsTable,
} from "../../scripts/fetch-horizons-fixture";
import {
  astroTimeAt,
  BODY_IDS,
  BODY_STRIDE,
  bodyAirlessAzAltDeg,
  computeBodies,
  makeObserver,
} from "../../src/domain/astro";
import { angularSeparationDeg, type ObserverSite } from "../../src/domain/geo";
import { bodyLabel } from "../../src/map/sky/layers/bodies";

const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const DAY_START_MS = Date.parse("2026-10-10T00:00:00Z");
const STEP_MS = 20 * 60_000;

interface HorizonsFixture {
  generator: string;
  fetchedAtUtc: string;
  query: string;
  site: { latDeg: number; lonDeg: number; heightM: number };
  bodies: Record<string, { command: string; rows: [string, number, number][] }>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/horizons-airless-maunakea-2026-10-10.json", import.meta.url),
    "utf8",
  ),
) as HorizonsFixture;

describe("BODY_IDS and BODY_STRIDE", () => {
  it("fix the body order and the four fields per body", () => {
    expect(BODY_IDS).toEqual([
      "sun",
      "moon",
      "planet:Mercury",
      "planet:Venus",
      "planet:Mars",
      "planet:Jupiter",
      "planet:Saturn",
      "planet:Uranus",
    ]);
    expect(BODY_STRIDE).toBe(4);
  });
});

describe("Horizons AIRLESS fixture", () => {
  it("has the documented shape: 8 bodies keyed by BODY_IDS, 73 rows each, the real first Sun row", () => {
    expect(fixture.generator).toBe("scripts/fetch-horizons-fixture.ts");
    expect(fixture.query).toBe(
      "EPHEM_TYPE=OBSERVER CENTER=coord@399 COORD_TYPE=GEODETIC QUANTITIES=4 ANG_FORMAT=DEG EXTRA_PREC=YES APPARENT=AIRLESS TIME_TYPE=UT STEP_SIZE=20m",
    );
    expect(fixture.site).toEqual(SITE);
    expect(Object.keys(fixture.bodies)).toEqual([...BODY_IDS]);
    expect(BODY_IDS.map((id) => fixture.bodies[id]?.command)).toEqual([
      "10",
      "301",
      "199",
      "299",
      "499",
      "599",
      "699",
      "799",
    ]);
    for (const id of BODY_IDS) {
      const rows = fixture.bodies[id]?.rows ?? [];
      expect(rows.length, id).toBe(73);
      rows.forEach(([iso], k) => {
        expect(Date.parse(iso), `${id} row ${k}`).toBe(DAY_START_MS + k * STEP_MS);
      });
    }
    expect(fixture.bodies.sun?.rows[0]).toEqual([
      "2026-10-10T00:00:00Z",
      228.740928134,
      52.025548643,
    ]);
  });

  it.each(BODY_IDS.map((id, i) => [id, i] as const))(
    "%s: airless pipeline within 0.05° of Horizons on ≥ 30 rows above the horizon",
    (id, i) => {
      const observer = makeObserver(SITE);
      const out = new Float64Array(2);
      let checked = 0;
      let worst = 0;
      for (const [iso, azDeg, elDeg] of fixture.bodies[id]?.rows ?? []) {
        if (!(elDeg > 0)) continue;
        bodyAirlessAzAltDeg(i, astroTimeAt(Date.parse(iso)), observer, out, 0);
        // Great-circle separation: raw Δaz near the zenith is meaningless (gotcha 7).
        worst = Math.max(
          worst,
          angularSeparationDeg(out[0] ?? Number.NaN, out[1] ?? Number.NaN, azDeg, elDeg),
        );
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(30);
      expect(worst).toBeLessThan(0.05);
    },
  );
});

describe("bodyAirlessAzAltDeg", () => {
  it("writes at the offset and throws RangeError for an index outside 0–7", () => {
    const t = astroTimeAt(DAY_START_MS);
    const observer = makeObserver(SITE);
    const out = new Float64Array(4).fill(-1);
    bodyAirlessAzAltDeg(0, t, observer, out, 2);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(-1);
    expect(Number.isFinite(out[2])).toBe(true);
    expect(Number.isFinite(out[3])).toBe(true);
    for (const bad of [-1, 8, 1.5, Number.NaN]) {
      expect(() => bodyAirlessAzAltDeg(bad, t, observer, out, 0)).toThrow(RangeError);
    }
  });
});

describe("computeBodies", () => {
  it("equals the airless pipeline plus Refraction('normal'), az unchanged, every 20 min on 2026-10-10", () => {
    const observer = makeObserver(SITE);
    const bodies = new Float64Array(BODY_IDS.length * BODY_STRIDE);
    const airless = new Float64Array(2);
    let worst = 0;
    for (let k = 0; k <= 72; k++) {
      const t = astroTimeAt(DAY_START_MS + k * STEP_MS);
      computeBodies(t, observer, bodies);
      for (let i = 0; i < BODY_IDS.length; i++) {
        bodyAirlessAzAltDeg(i, t, observer, airless, 0);
        const az = airless[0] ?? Number.NaN;
        const alt = airless[1] ?? Number.NaN;
        worst = Math.max(
          worst,
          Math.abs((bodies[i * BODY_STRIDE] ?? Number.NaN) - az),
          Math.abs((bodies[i * BODY_STRIDE + 1] ?? Number.NaN) - (alt + Refraction("normal", alt))),
        );
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("writes 32 finite values at 2026-10-10T08:00Z, with a new Moon labelled 'Moon (new)'", () => {
    const out = new Float64Array(BODY_IDS.length * BODY_STRIDE).fill(Number.NaN);
    computeBodies(astroTimeAt(Date.parse("2026-10-10T08:00:00Z")), makeObserver(SITE), out);
    expect(out.length).toBe(32);
    expect(out.every(Number.isFinite)).toBe(true);
    const moonPhase = out[1 * BODY_STRIDE + 3] ?? Number.NaN;
    expect(moonPhase).toBeGreaterThanOrEqual(0);
    expect(moonPhase).toBeLessThan(0.02);
    // Sun magnitude about −26.7, Sun phase 1.
    expect(out[2]).toBeLessThan(-26);
    expect(out[3]).toBeCloseTo(1, 9);
    expect(bodyLabel("moon", 0.002)).toBe("Moon (new)");
  });
});

describe("scripts/fetch-horizons-fixture.ts parsing", () => {
  const table = (header: string, lines: readonly string[]): string =>
    [
      "*******",
      header,
      " Date__(UT)__HR:MN, , ,Azimuth_(a-app), Elevation_(a-app),",
      "$$SOE",
      ...lines,
      "$$EOE",
      "*******",
    ].join("\n");

  it("sends the documented query, single quotes included", () => {
    const p = horizonsQueryParams("301");
    expect(p.get("format")).toBe("json");
    expect(p.get("COMMAND")).toBe("'301'");
    expect(p.get("CENTER")).toBe("'coord@399'");
    expect(p.get("SITE_COORD")).toBe("'-155.4689,19.8253,4.204'");
    expect(p.get("START_TIME")).toBe("'2026-10-10 00:00'");
    expect(p.get("STOP_TIME")).toBe("'2026-10-11 00:00'");
    expect(p.get("APPARENT")).toBe("'AIRLESS'");
    expect(p.toString()).toContain("COMMAND=%27301%27");
  });

  it("converts Horizons UT dates to ISO", () => {
    expect(horizonsUtcToIso(" 2026-Oct-10 00:20")).toBe("2026-10-10T00:20:00Z");
    expect(horizonsUtcToIso(" 2026-Oct-11 00:00")).toBe("2026-10-11T00:00:00Z");
    expect(() => horizonsUtcToIso(" 2026-Okt-10 00:20")).toThrow();
  });

  it("reads the rows between $$SOE and $$EOE and refuses anything that is not AIRLESS or finite", () => {
    const rows = [
      " 2026-Oct-10 00:00,*,m,  228.740928134,      52.025548643,",
      " 2026-Oct-10 00:20, , ,   12.009860937,     -76.630249900,",
    ];
    expect(parseHorizonsTable(table("Atmos refraction: NO (AIRLESS)", rows))).toEqual([
      ["2026-10-10T00:00:00Z", 228.740928134, 52.025548643],
      ["2026-10-10T00:20:00Z", 12.009860937, -76.6302499],
    ]);
    expect(() => parseHorizonsTable(table("Atmos refraction: YES", rows))).toThrow(/AIRLESS/);
    expect(() =>
      parseHorizonsTable(
        table("Atmos refraction: NO (AIRLESS)", [" 2026-Oct-10 00:00,*,m,  n.a.,  52.0,"]),
      ),
    ).toThrow(/finite/);
    expect(() => parseHorizonsTable("Atmos refraction: NO (AIRLESS)\nno table")).toThrow();
  });
});
