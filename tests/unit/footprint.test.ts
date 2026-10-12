// tests/unit/footprint.test.ts — footprintLonLatDeg (M8 step 3, section 5).
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { apparentAltDeg, geometricAltDeg } from "../../src/domain/astro";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  FOOTPRINT_CLIP_EPS_DEG,
  FOOTPRINT_FALLBACK_HEIGHT_KM,
  FOOTPRINT_PRESETS_KM,
  FOOTPRINT_SAMPLES_PER_EDGE,
  footprintLonLatDeg,
  footprintMaxPairs,
  frameAzimuthCoverage,
  horizonRadiusUnit,
  type LensModel,
  projectAzAltDeg,
  syntheticFisheyeCalibration,
} from "../../src/domain/camera";
import {
  azAltToEnuUnit,
  EARTH_MEAN_RADIUS_KM,
  ecefToEnu,
  enuToAzAltDeg,
  enuToEcef,
  enuToEcefMatrix,
  type ObserverSite,
  raySphereExitKm,
  sphericalLatLonDeg,
  sphericalObserverKm,
  wrap180,
  wrap360,
} from "../../src/domain/geo";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const R = EARTH_MEAN_RADIUS_KM;
const N16 = FOOTPRINT_SAMPLES_PER_EDGE;

/** "Subaru": the inline Subaru defaults of the README fixtures (the published pointing). */
const SUBARU_SITE: ObserverSite = { latDeg: 19.82552, lonDeg: -155.47587, heightM: 4148 };
/** "Fisheye": synthetic-maunakea. */
const MAUNAKEA: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const WALENSTADT: ObserverSite = { latDeg: 47.1236, lonDeg: 9.3242, heightM: 467.6 };

function calibration(overrides: Partial<Calibration>): Calibration {
  return {
    azDeg: 0,
    altDeg: 0,
    rollDeg: 0,
    focalPx: 2742,
    cxPx: 1920,
    cyPx: 1080,
    k1: 0,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: null,
    updatedAtMs: 0,
    ...overrides,
  };
}

function rectilinear(overrides: Partial<Calibration>): CameraModel {
  return createCameraModel({
    lens: "rectilinear",
    calibration: calibration(overrides),
    widthPx: 3840,
    heightPx: 2160,
  });
}

const SUBARU = rectilinear({ azDeg: 81.2, altDeg: 19.6 });
const FISHEYE = createCameraModel({
  lens: "fisheye-equidistant",
  calibration: syntheticFisheyeCalibration(1024),
  widthPx: 1024,
  heightPx: 1024,
});

function newOut(): Float64Array {
  return new Float64Array(2 * footprintMaxPairs(N16));
}

/** Great-circle distance (km) on the sphere R from the site to (latDeg, lonDeg), haversine form. */
function distanceKm(site: ObserverSite, latDeg: number, lonDeg: number): number {
  const p1 = site.latDeg * D2R;
  const p2 = latDeg * D2R;
  const sDp = Math.sin((p2 - p1) / 2);
  const sDl = Math.sin(((lonDeg - site.lonDeg) * D2R) / 2);
  const a = sDp * sDp + Math.cos(p1) * Math.cos(p2) * sDl * sDl;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing (degrees in [0, 360)) from the site to (latDeg, lonDeg). */
function bearingDeg(site: ObserverSite, latDeg: number, lonDeg: number): number {
  const p1 = site.latDeg * D2R;
  const p2 = latDeg * D2R;
  const dl = (lonDeg - site.lonDeg) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * R2D);
}

/** Distance (km) to where the dip-tangent ray meets the shell R + H: R·(acos(R/(R + h)) + acos(R/(R + H))). */
function limbDistanceKm(site: ObserverSite, heightKm: number): number {
  return R * (Math.acos(R / (R + site.heightM / 1000)) + Math.acos(R / (R + heightKm)));
}

function pair(out: Float64Array, i: number): [lonDeg: number, latDeg: number] {
  return [out[2 * i] ?? Number.NaN, out[2 * i + 1] ?? Number.NaN];
}

describe("footprint constants", () => {
  it("match README section 6", () => {
    expect(FOOTPRINT_SAMPLES_PER_EDGE).toBe(16);
    expect(FOOTPRINT_PRESETS_KM).toEqual([420, 480]);
    expect(FOOTPRINT_FALLBACK_HEIGHT_KM).toBe(420);
    expect(FOOTPRINT_CLIP_EPS_DEG).toBe(1e-6);
    expect(footprintMaxPairs(16)).toBe(128);
    expect(footprintMaxPairs(4)).toBe(32);
  });
});

describe("footprintLonLatDeg · known pose (Subaru, null profile)", () => {
  it("writes 66 pairs at 420 km starting at the top-left corner", () => {
    const out = newOut();
    expect(footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, out)).toBe(66);
    const [lon0, lat0] = pair(out, 0);
    expect(Math.abs(lon0 - -151.946464)).toBeLessThan(1e-6);
    expect(Math.abs(lat0 - 23.598321)).toBeLessThan(1e-6);
    const [lon16, lat16] = pair(out, 16);
    expect(Math.abs(lon16 - -151.044186)).toBeLessThan(1e-6);
    expect(Math.abs(lat16 - 17.120521)).toBeLessThan(1e-6);
  });

  it("matches an independent proj4 gnom inverse through the + root on the top edge (pairs 0–16)", () => {
    const out = newOut();
    footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, out);
    const gnom = proj4(
      "+proj=longlat +R=1 +no_defs",
      "+proj=gnom +lat_0=19.6 +lon_0=81.2 +x_0=0 +y_0=0 +R=1 +no_defs",
    );
    const o = new Float64Array(3);
    sphericalObserverKm(SUBARU_SITE.latDeg, SUBARU_SITE.lonDeg, SUBARU_SITE.heightM, o, 0);
    const m = enuToEcefMatrix(SUBARU_SITE.latDeg, SUBARU_SITE.lonDeg);
    const enu = new Float64Array(3);
    const d = new Float64Array(3);
    const hit = new Float64Array(2);
    let worst = 0;
    for (let j = 0; j <= 16; j++) {
      const u = (3840 * j) / 16; // pair 16 is the top-right corner (3840, 0)
      const [lon, lat] = gnom.inverse<[number, number]>([(u - 1920) / 2742, (1080 - 0) / 2742]);
      const az = ((lon % 360) + 360) % 360;
      azAltToEnuUnit(az, geometricAltDeg(lat), enu, 0);
      enuToEcef(m, enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, d, 0);
      const [ox, oy, oz] = [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0];
      const [dx, dy, dz] = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
      const t = raySphereExitKm(ox, oy, oz, dx, dy, dz, R + 420) ?? Number.NaN;
      sphericalLatLonDeg(ox + t * dx, oy + t * dy, oz + t * dz, hit, 0);
      const [vLon, vLat] = pair(out, j);
      worst = Math.max(
        worst,
        Math.abs(wrap180(vLon - (hit[1] ?? Number.NaN))),
        Math.abs(vLat - (hit[0] ?? Number.NaN)),
      );
    }
    expect(worst).toBeLessThan(1e-9); // measured 2.8e-14°
  });

  it("never reaches beyond the limb, and puts 19 vertices on it (17 clip-curve points + 2 crossings)", () => {
    const limb = limbDistanceKm(SUBARU_SITE, 420);
    expect(Math.abs(limb - 2482.234)).toBeLessThan(0.001);
    const out = newOut();
    const n = footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, out);
    let onLimb = 0;
    for (let i = 0; i < n; i++) {
      const [lon, lat] = pair(out, i);
      const dist = distanceKm(SUBARU_SITE, lat, lon);
      expect(dist).toBeLessThan(limb + 0.001);
      if (Math.abs(dist - limb) < 0.001) onLimb += 1;
    }
    expect(onLimb).toBe(19);
  });

  it("moves outward at 480 km", () => {
    expect(Math.abs(limbDistanceKm(SUBARU_SITE, 480) - 2628.866)).toBeLessThan(0.001);
    const out = newOut();
    const n = footprintLonLatDeg(SUBARU, SUBARU_SITE, 480, N16, null, out);
    expect(n).toBe(66);
    const [lon0, lat0] = pair(out, 0);
    expect(Math.abs(lon0 - -151.488596)).toBeLessThan(1e-6);
    expect(Math.abs(lat0 - 24.067504)).toBeLessThan(1e-6);
    for (let i = 0; i < n; i++) {
      const [lon, lat] = pair(out, i);
      expect(distanceKm(SUBARU_SITE, lat, lon)).toBeLessThan(2628.866 + 0.001);
    }
  });
});

describe("footprintLonLatDeg · bearings = wedge", () => {
  it("keeps every vertex bearing inside frameAzimuthCoverage, and reaches both ends", () => {
    const coverage = frameAzimuthCoverage(SUBARU, 16);
    expect(coverage.kind).toBe("range");
    if (coverage.kind !== "range") return;
    expect(Math.abs(coverage.fromAzDeg - 40.3553)).toBeLessThan(0.001);
    expect(Math.abs(coverage.toAzDeg - 122.0447)).toBeLessThan(0.001);
    const out = newOut();
    const n = footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, out);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const [lon, lat] = pair(out, i);
      const b = bearingDeg(SUBARU_SITE, lat, lon);
      expect(b).toBeGreaterThan(coverage.fromAzDeg - 0.001);
      expect(b).toBeLessThan(coverage.toAzDeg + 0.001);
      min = Math.min(min, b);
      max = Math.max(max, b);
    }
    expect(Math.abs(min - coverage.fromAzDeg)).toBeLessThan(0.01);
    expect(Math.abs(max - coverage.toAzDeg)).toBeLessThan(0.01);
  });
});

describe("footprintLonLatDeg · fisheye rings (synthetic-maunakea, 420 km)", () => {
  it("is the horizon circle with a null profile: 64 pairs, all 2,305.660 km out", () => {
    const out = newOut();
    const n = footprintLonLatDeg(FISHEYE, MAUNAKEA, 420, N16, null, out);
    expect(n).toBe(64);
    for (let i = 0; i < n; i++) {
      const [lon, lat] = pair(out, i);
      expect(Math.abs(distanceKm(MAUNAKEA, lat, lon) - 2305.66)).toBeLessThan(0.001);
    }
  });

  it("is the clip curve with a constant 10° profile: 64 pairs, all 1,385.212 km out", () => {
    const out = newOut();
    const n = footprintLonLatDeg(FISHEYE, MAUNAKEA, 420, N16, new Float32Array(360).fill(10), out);
    expect(n).toBe(64);
    for (let i = 0; i < n; i++) {
      const [lon, lat] = pair(out, i);
      expect(Math.abs(distanceKm(MAUNAKEA, lat, lon) - 1385.212)).toBeLessThan(0.001);
    }
  });

  it("treats NaN profile values (rays with no samples) as the dip, never as a vertex", () => {
    const withNull = newOut();
    const withNaN = newOut();
    const n = footprintLonLatDeg(FISHEYE, MAUNAKEA, 420, N16, null, withNull);
    const nanProfile = new Float32Array(360).fill(-30); // below the dip everywhere: the dip clips
    nanProfile.fill(Number.NaN, 0, 180);
    expect(footprintLonLatDeg(FISHEYE, MAUNAKEA, 420, N16, nanProfile, withNaN)).toBe(n);
    for (let i = 0; i < 2 * n; i++) {
      expect(Number.isFinite(withNaN[i])).toBe(true);
      expect(Math.abs((withNaN[i] ?? Number.NaN) - (withNull[i] ?? Number.NaN))).toBeLessThan(
        1e-12,
      );
    }
  });
});

/** Turns a vertex back into a direction seen from the site and projects it (M8 section 5, clip correctness). */
function checkVertices(
  model: CameraModel,
  site: ObserverSite,
  heightKm: number,
  out: Float64Array,
  n: number,
  label: string,
): number {
  const o = new Float64Array(3);
  sphericalObserverKm(site.latDeg, site.lonDeg, site.heightM, o, 0);
  const m = enuToEcefMatrix(site.latDeg, site.lonDeg);
  const p = new Float64Array(3);
  const enu = new Float64Array(3);
  const azAlt = new Float64Array(2);
  const uv = new Float64Array(2);
  const limb = limbDistanceKm(site, heightKm);
  let worstPx = 0;
  for (let i = 0; i < n; i++) {
    const [lon, lat] = pair(out, i);
    expect(distanceKm(site, lat, lon), `${label} vertex ${i} beyond the limb`).toBeLessThan(
      limb + 0.001,
    );
    sphericalObserverKm(lat, lon, heightKm * 1000, p, 0);
    ecefToEnu(
      m,
      (p[0] ?? 0) - (o[0] ?? 0),
      (p[1] ?? 0) - (o[1] ?? 0),
      (p[2] ?? 0) - (o[2] ?? 0),
      enu,
      0,
    );
    enuToAzAltDeg(enu[0] ?? 0, enu[1] ?? 0, enu[2] ?? 0, azAlt, 0);
    const projected = projectAzAltDeg(model, azAlt[0] ?? 0, apparentAltDeg(azAlt[1] ?? 0), uv, 0);
    expect(projected, `${label} vertex ${i} projects`).toBe(true);
    const u = uv[0] ?? Number.NaN;
    const v = uv[1] ?? Number.NaN;
    const outside = Math.max(0, -u, u - model.widthPx, -v, v - model.heightPx);
    worstPx = Math.max(worstPx, outside);
  }
  expect(worstPx, `${label} outside the frame`).toBeLessThan(1e-3);
  return worstPx;
}

describe("footprintLonLatDeg · clip correctness (gotcha 4: never clamp per sample)", () => {
  it("keeps every vertex of a rolled, tilted rectilinear camera inside its frame", () => {
    let worst = 0;
    let drawn = 0;
    for (const altDeg of [-10, 0, 5, 10, 19.6, 45, 70]) {
      for (const rollDeg of [-30, 0, 15, 45, 90]) {
        const model = rectilinear({ azDeg: 90, altDeg, rollDeg });
        const out = newOut();
        const n = footprintLonLatDeg(model, MAUNAKEA, 420, N16, null, out);
        if (n > 0) drawn += 1;
        const label = `rectilinear alt ${altDeg} roll ${rollDeg}`;
        worst = Math.max(worst, checkVertices(model, MAUNAKEA, 420, out, n, label));
      }
    }
    expect(drawn).toBe(35); // every pose shows some sky
    console.log(`rectilinear clip correctness: worst ${worst.toExponential(2)} px outside`);
  });

  it("keeps every vertex of the four fisheyes on a 616 px horizon circle inside the frame", () => {
    const lenses: readonly LensModel[] = [
      "fisheye-equidistant",
      "fisheye-equisolid",
      "fisheye-stereographic",
      "fisheye-orthographic",
    ];
    let worst = 0;
    for (const lens of lenses) {
      for (const altDeg of [0, 20, 60, 90]) {
        const model = createCameraModel({
          lens,
          calibration: calibration({
            azDeg: 90,
            altDeg,
            rollDeg: 30,
            focalPx: 616 / horizonRadiusUnit(lens),
            cxPx: 616,
            cyPx: 616,
          }),
          widthPx: 1232,
          heightPx: 1232,
        });
        const out = newOut();
        const n = footprintLonLatDeg(model, MAUNAKEA, 420, N16, null, out);
        expect(n, `${lens} alt ${altDeg}`).toBeGreaterThan(0);
        worst = Math.max(worst, checkVertices(model, MAUNAKEA, 420, out, n, `${lens} ${altDeg}`));
      }
    }
    console.log(`fisheye clip correctness: worst ${worst.toExponential(2)} px outside`);
  });
});

describe("footprintLonLatDeg · edges", () => {
  it("returns 0 for a camera pointing down (no sky in frame)", () => {
    const model = rectilinear({ azDeg: 90, altDeg: -60 });
    expect(footprintLonLatDeg(model, MAUNAKEA, 420, N16, null, newOut())).toBe(0);
  });

  it("returns 0 at or below the site height, and for a non-finite height", () => {
    expect(footprintLonLatDeg(FISHEYE, MAUNAKEA, 3, N16, null, newOut())).toBe(0);
    expect(footprintLonLatDeg(FISHEYE, MAUNAKEA, 4.204, N16, null, newOut())).toBe(0);
    expect(footprintLonLatDeg(FISHEYE, MAUNAKEA, Number.NaN, N16, null, newOut())).toBe(0);
    expect(
      footprintLonLatDeg(FISHEYE, MAUNAKEA, Number.POSITIVE_INFINITY, N16, null, newOut()),
    ).toBe(0);
  });

  it("draws Walenstadt at 2,200 km, but returns 0 at 2,300 km where the ring encloses the pole (gotcha 12)", () => {
    const out = newOut();
    const n = footprintLonLatDeg(FISHEYE, WALENSTADT, 2200, N16, null, out);
    expect(n).toBe(64);
    let maxLat = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) maxLat = Math.max(maxLat, pair(out, i)[1]);
    expect(Math.abs(maxLat - 89.68)).toBeLessThan(0.01);
    expect(footprintLonLatDeg(FISHEYE, WALENSTADT, 2300, N16, null, newOut())).toBe(0);
  });

  it("unwraps a Nānā ao-like ring at 800 km into the site's world copy (gotcha 11)", () => {
    // Any roll draws the same ring; the ± 0.01° bounds hold where the samples include due east and west
    // (multiples of 90°). Other rolls sample other azimuths, which moves the extremes by up to 0.04°.
    for (const rollDeg of [0, 30, 90, 137, 180]) {
      const tol = rollDeg % 90 === 0 ? 0.01 : 0.05;
      const model = createCameraModel({
        lens: "fisheye-equidistant",
        calibration: calibration({
          azDeg: 0,
          altDeg: 90,
          rollDeg,
          focalPx: 392.158,
          cxPx: 616,
          cyPx: 616,
          flipX: true,
        }),
        widthPx: 1232,
        heightPx: 1232,
      });
      const out = newOut();
      const n = footprintLonLatDeg(model, MAUNAKEA, 800, N16, null, out);
      expect(n, `roll ${rollDeg}`).toBe(64);
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < n; i++) {
        const lon = pair(out, i)[0];
        min = Math.min(min, lon);
        max = Math.max(max, lon);
        if (i > 0) expect(Math.abs(lon - pair(out, i - 1)[0])).toBeLessThan(180);
      }
      expect(Math.abs(min - -185.18), `roll ${rollDeg} min ${min}`).toBeLessThan(tol);
      expect(Math.abs(max - -125.75), `roll ${rollDeg} max ${max}`).toBeLessThan(tol);
    }
  });

  it("unwraps a cfht-starcam-like rectilinear view west at 800 km beyond −180°", () => {
    const model = rectilinear({ azDeg: 270, altDeg: 20 });
    const out = newOut();
    const n = footprintLonLatDeg(model, MAUNAKEA, 800, N16, null, out);
    expect(n).toBe(66);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const lon = pair(out, i)[0];
      min = Math.min(min, lon);
      max = Math.max(max, lon);
    }
    expect(Math.abs(min - -186.93)).toBeLessThan(0.01);
    expect(Math.abs(max - -162.15)).toBeLessThan(0.01);
  });
});

describe("footprintLonLatDeg · output buffer", () => {
  it("writes only inside out, and gives the same ring on a repeated call", () => {
    const a = new Float64Array(2 * footprintMaxPairs(N16) + 2).fill(-999);
    const n = footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, a);
    expect(a[2 * n]).toBe(-999);
    const b = newOut();
    expect(footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, b)).toBe(n);
    for (let i = 0; i < 2 * n; i++) expect(b[i]).toBe(a[i]);
  });

  it("works for another samplesPerEdge", () => {
    const out = new Float64Array(2 * footprintMaxPairs(4));
    const n = footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, 4, null, out);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(footprintMaxPairs(4));
    // Switching back gives the 16-per-edge ring again.
    expect(footprintLonLatDeg(SUBARU, SUBARU_SITE, 420, N16, null, newOut())).toBe(66);
  });
});

describe("footprintLonLatDeg · refraction inversion always returns", () => {
  // astronomy-engine's InverseRefraction never returns within 3e-5° of +90° apparent, nor for about 0.1 % of
  // altitudes in [−90°, −64°]. Through geometricAltDeg both poses below hung the page (a regression here hangs the
  // test worker rather than failing it).
  it("draws a camera whose zenith lies exactly on the top-edge sample", () => {
    const model = rectilinear({ azDeg: 90, altDeg: 90 - Math.atan(1080 / 2742) * R2D });
    const n = footprintLonLatDeg(model, MAUNAKEA, 420, N16, null, newOut());
    expect(n).toBe(64);
  });

  it("returns 0 for every steeply downward pose (39 of these 530 hit a non-converging altitude)", () => {
    let calls = 0;
    for (let altDeg = -89; altDeg <= -50; altDeg += 0.37) {
      for (const rollDeg of [-30, 0, 15, 45, 90]) {
        const model = rectilinear({ azDeg: 90, altDeg, rollDeg });
        expect(footprintLonLatDeg(model, MAUNAKEA, 420, N16, null, newOut())).toBe(0);
        calls += 1;
      }
    }
    expect(calls).toBe(530);
  });
});
