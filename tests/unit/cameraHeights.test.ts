// tests/unit/cameraHeights.test.ts — M6 step 8: every registry entry at a terrain-fixture site keeps heightM equal to
// the DEM ground (Terrarium z14, as the horizon worker samples it) + mastM, within 3 m. The worker never reads
// heightM, so a wrong mast would put the eye inside a ridge (gotcha 9). O2: the recorded Subaru clip copies
// subaru-starcam's site, so its profile equals the StarCam's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import { tilesForSite } from "../../src/domain/terrain";
import type { CameraConfig } from "../../src/state/types";
import { withM5CameraEntries } from "../helpers/m5Cameras";
import { fixtureSampler, type TerrainFixtureSite } from "../helpers/terrainFixtures";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
// The M5 entries (local-replay, subaru-2026-10-11-iss) are merged until cameras.json carries them.
const registry = parseCameraRegistry(withM5CameraEntries(committed));

/** The fixture sites: the maunakea fixture's z14 tiles hold both the CFHT and the Subaru point. */
const POINTS: readonly {
  name: string;
  latDeg: number;
  lonDeg: number;
  fixture: TerrainFixtureSite;
  ids: readonly string[];
}[] = [
  {
    name: "CFHT",
    latDeg: 19.8253,
    lonDeg: -155.4689,
    fixture: "maunakea",
    ids: ["synthetic-maunakea", "cfht-nanaao", "cfht-starcam"],
  },
  {
    name: "Subaru",
    latDeg: 19.82552,
    lonDeg: -155.47587,
    fixture: "maunakea",
    ids: ["subaru-starcam", "local-replay", "subaru-2026-10-11-iss"],
  },
  {
    name: "Walenstadt",
    latDeg: 47.1236,
    lonDeg: 9.3242,
    fixture: "walenstadt",
    ids: ["synthetic-walenstadt"],
  },
];

/** DEM ground at a point, as the worker reads it: bilinear at z14 over the site's tiles. */
function groundM(fixture: TerrainFixtureSite, latDeg: number, lonDeg: number): number {
  return fixtureSampler(fixture, tilesForSite(latDeg, lonDeg, 0))(latDeg, lonDeg, 0, 14);
}

const camera = (id: string): CameraConfig => {
  const c = registry[id];
  if (c === undefined) throw new Error(`no camera ${id}`);
  return c;
};

describe("registry heights agree with the DEM", () => {
  it("every committed entry sits at a fixture site", () => {
    const covered = POINTS.flatMap((p) => p.ids).sort();
    expect(Object.keys(registry).sort()).toEqual(covered);
  });

  for (const point of POINTS) {
    it(`${point.name}: |DEM ground + mastM − heightM| ≤ 3 m for ${point.ids.join(", ")}`, () => {
      const ground = groundM(point.fixture, point.latDeg, point.lonDeg);
      expect(Number.isFinite(ground)).toBe(true);
      for (const id of point.ids) {
        const { site } = camera(id);
        expect(site.latDeg, id).toBe(point.latDeg);
        expect(site.lonDeg, id).toBe(point.lonDeg);
        expect(Math.abs(ground + site.mastM - site.heightM), id).toBeLessThanOrEqual(3);
      }
    });
  }

  it("the measured grounds: CFHT 4,170.9 m (mastM 33), Subaru 4,134.6 m (mastM 13), Walenstadt 467.6 m", () => {
    expect(groundM("maunakea", 19.8253, -155.4689)).toBeCloseTo(4170.9, 0);
    expect(groundM("maunakea", 19.82552, -155.47587)).toBeCloseTo(4134.6, 0);
    expect(groundM("walenstadt", 47.1236, 9.3242)).toBeCloseTo(467.6, 0);
    for (const id of ["synthetic-maunakea", "cfht-nanaao", "cfht-starcam"]) {
      expect(camera(id).site.mastM, id).toBe(33);
    }
  });

  it("O2: subaru-2026-10-11-iss has subaru-starcam's latitude, longitude and mast, so the same profile", () => {
    const { latDeg, lonDeg, mastM } = camera("subaru-starcam").site;
    expect(camera("subaru-2026-10-11-iss").site).toMatchObject({ latDeg, lonDeg, mastM });
  });
});
