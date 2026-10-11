# M2 · Synthetic sky

Branch `m2-synthetic-sky`, one pull request. Contracts: [README.md](README.md). Decisions: [../DECISIONS.md](../DECISIONS.md). Evidence: `docs/verification/` (kept locally). Every number below was measured on 2026-10-11 with the pinned packages; browser timings come from headless Chromium 1248 (Playwright 1.64) on an Apple M2.

## 1. Goal

Draw the sky for the active camera's site at the clock's sim time in a zenith-fisheye pixel map: stars sized by magnitude, the Sun, Moon and planets with labels, and an alt/az grid with cardinal letters. Add civil-twilight markers to the timeline. Each formula is pinned to an independent reference (SIMBAD/BSC5 Polaris, JPL Horizons, Skyfield and USNO) before anything is drawn.

Out of scope here (milestone in brackets):

- Satellites, picking, hover, selection and the Inspector [M3].
- Every lens except the zenith equidistant fisheye; the inverse projection; fitting k1/k2; the Calibration panel; camera images as the background; pan and zoom in the sky view [M4].
- YouTube and local video [M5]. Terrain horizon [M6]. Footprint [M8].
- Star name labels on the map. Names appear in hover [M3] and in the calibration picker [M4].
- Visual design (colours, sizes, fonts, layout, panel placement). It is settled during the build from screenshots.

Reused, not rebuilt: the replay clock loop with `advanceReplayMs` (wall delta clamped to 250 ms, times rate) and `registerFrameUpdater` [M0]; the Timeline and its keys (Space, ←/→, Shift+←/→, `[` `]`), `?t=` and `?cam=`, `src/map/registry.ts` (`MapId` already includes `"sky"`; `registerMap`, `renderSyncAll`), `bindLayerVisible`, `LayerToggles`, `Credits.tsx`, `formatZonedDateTime` and the unit-test helper `storeAt(iso)` [M1]. M2 hooks the sky into them and tests that they drive it.

## 2. Prerequisites

1. M1 merged: `cameras.json` holds `synthetic-maunakea` ([camera registry](README.md#camera-registry)), the Timeline, Layers panel, Credits, map registry and the StrictMode-safe [map lifecycle](README.md#map-lifecycle) work.
2. No accounts or keys. Network is needed only on the developer machine, for three hand-run downloads (CDS, IAU-CSN, JPL Horizons). CI never calls them ([CI](README.md#ci)).
3. Node 26 (O4). The scripts use the global `fetch`, `node:fs`, `node:zlib` and `node:crypto` only. A prototype of `build-stars.ts` run under Node 26.11.1 arm64 on 2026-10-11 wrote a `stars.json` byte-identical to the earlier run's.
4. Lint: M0's `biome.json` sets `noNonNullAssertion` and `noFocusedTests` to `error`. Index typed arrays with `?? 0`, never `!` (gotcha 19).

## 3. Deliverables

| Path | Change |
| ---- | ------ |
| `scripts/build-stars.ts` | New. CDS V/50 `catalog.gz` + IAU-CSN → `public/data/stars.json`. |
| `public/data/stars.json` | New, generated. 8,404 `StarRow`s, brightest first. |
| `scripts/fetch-horizons-fixture.ts` | New. JPL Horizons AIRLESS table for 8 bodies → the fixture below. |
| `tests/fixtures/horizons-airless-maunakea-2026-10-10.json` | New, generated. |
| `src/domain/geo/index.ts` | New: `ObserverSite`, `wrap360`, `wrap180`, `angularSeparationDeg`. |
| `src/domain/astro/stars.ts` | New: `StarRow`, `starUnitVectors`, `rotateStarsAzAltDeg`, `apparentAltDeg`, `geometricAltDeg`, `needsSkyRecompute`. |
| `src/domain/astro/bodies.ts` | New: `BODY_IDS`, `BODY_STRIDE`, `makeObserver`, `astroTimeAt`, `computeBodies`, `bodyAirlessAzAltDeg`. |
| `src/domain/astro/twilight.ts` | New: `sunGeometricAltDeg`, `civilTwilightMs`, `twilightMarkersMs`. |
| `src/domain/astro/index.ts` | Re-export the above (`PlanetName` stays from M0). |
| `src/domain/camera/lens.ts` | New: the `CameraModelInput` and `CameraModel` types ([README section 6](README.md#6-domain-module-apis)), `horizonRadiusUnit`, `syntheticFisheyeCalibration`, `createCameraModel` (zenith equidistant only). |
| `src/domain/camera/project.ts` | New: `projectAzAltDeg`, `projectBatch`, `toSkyMapCoord` (zenith equidistant only). |
| `src/domain/camera/index.ts` | Re-export the above. |
| `src/domain/time/index.ts` | Add `SKY_RECOMPUTE_MS = 2_000` (M0 left it out). Add `formatUtcHhMm(timeMs)` = `new Date(timeMs).toISOString().slice(11, 16)` (truncates), unless M7 landed first and added it. |
| `src/state/skyCache.ts` | New. Star and body arrays, `lastSkyMs`, `loadStars` (API in [README section 6](README.md#state-app-and-map-modules)). |
| `src/state/actions.ts`, `src/state/selectors.ts` | `setStarMagLimit`. Add `selectStarMagLimit` and `selectCalibration` exactly as in the [README](README.md#selectors): M2 is the first user of both (M1 added only `selectActiveCamera`, `selectSite` and `selectTrueColorDate`). |
| `src/main.tsx` | Start `loadStars(store)` at startup. |
| `src/map/sky/createSkyMap.ts` | New. Pixel projection, `createSkyView`, `fitSkyFrame`, layers, `setCameraModel`, `updateFrame`. |
| `src/map/sky/layers/grid.ts`, `stars.ts`, `bodies.ts` | New. |
| `src/map/sync/bindSkyCamera.ts` | New. Camera model per active camera. |
| `src/ui/SkyView.tsx` | New. Container, lifecycle, text alternative, loading and error states. |
| `src/app/App.tsx` | Mount `SkyView` in place of M0's placeholder in the "Sky view" pane. |
| `src/ui/Timeline.tsx` | Twilight markers. |
| `src/ui/LayerToggles.tsx` | `stars`, `planets`, `grid` toggles and the magnitude limit. |
| `src/app/credits.ts`, `src/ui/Credits.tsx` | Star catalogue and star-name credits (step 10). |
| `public/data/cameras.json` | No change: M1's `synthetic-maunakea` defaults already equal `syntheticFisheyeCalibration(1024)` (the `lens.test.ts` row checks it). |
| `tests/unit/geo.test.ts`, `stars.test.ts`, `bodies.test.ts`, `twilight.test.ts`, `lens.test.ts`, `starsJson.test.ts`, `skyCache.test.ts`, `skyGrid.test.ts`, `bindSkyCamera.test.ts` | New unit tests (section 5). Extend `actions.test.ts`, `selectors.test.ts` and `credits.test.ts`. In M0's `store.test.ts`, drop `setStarMagLimit` from the list of actions that must still throw. |
| `tests/e2e/sky.spec.ts` | New e2e. |
| `tests/perf/sky.perf.ts` | New, run by hand with `npm run perf`. |
| `docs/DECISIONS.md`, `README.md` | Section 8 entries; the root README's M2 section. |

## 4. Steps

Write each test before its implementation and watch it fail ([working agreement](README.md#working-agreement)). Units follow [Units](README.md#units): degrees in every public API, epoch ms for time, pixels with `u` right and `v` down.

### Step 1. Geo helpers

1. In `src/domain/geo/index.ts` implement `ObserverSite`, `wrap360` (result in [0, 360)), `wrap180` (result in [−180, 180)) and `angularSeparationDeg`. The other geo functions land in M3, M6 and M8.
2. `angularSeparationDeg` uses the haversine form, which stays accurate for tiny separations and near the zenith: `a = sin²(Δh/2) + cos h1 cos h2 sin²(ΔA/2)`, result `2 asin(min(1, √a))`.
3. Tests (`geo.test.ts`), each ± 1e-9: (0°, 0°)–(90°, 0°) = 90; (10°, 89.9°)–(190°, 89.9°) = 0.2; (0°, 45°)–(0.001°, 45°) = 0.000707107; `wrap360(-0.5)` = 359.5, `wrap360(360)` = 0, `wrap180(190)` = −170, `wrap180(180)` = −180. Compare with a tolerance, never `===` (M4 gotcha G17: `wrap180(44.8)` is 44.799999999999955).

### Step 2. Star catalogue: `scripts/build-stars.ts`

Run by hand: `npx tsx scripts/build-stars.ts`, or with local copies `--catalog <catalog.gz> --csn <IAU-CSN.txt>`. Commit only the output.

1. Inputs (both re-downloaded and byte-identical on 2026-10-11):
   - `https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz`: 573,921 bytes, sha256 `3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed`.
   - `https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt`: 71,800 bytes, "Last updated 2022-04-04", sha256 `84fac0c90f1b19abc491c2793469e0caa7b003ad1bc93a790ca41147010d0eb0`.
2. `gunzipSync`, decode as `latin1`, split on `\n`, skip empty lines, then `padEnd(197, " ")` every line. CDS trims trailing blanks, so lines are 160–197 characters long.
3. Slice with 0-based JS indices (the ReadMe's 1-based bytes minus one):

   | Field | Slice | Notes |
   | ----- | ----- | ----- |
   | HR | `[0, 4)` | |
   | Name | `[4, 14)` | Flamsteed `[0, 3)`, Bayer abbreviation `[3, 6)`, Bayer index `[6]`, constellation `[7, 10)` within the field |
   | RA h, m, s | `[75, 77)`, `[77, 79)`, `[79, 83)` | J2000, epoch 2000 |
   | Dec sign, d, m, s | `[83]`, `[84, 86)`, `[86, 88)`, `[88, 90)` | |
   | Vmag | `[102, 107)` | F5.2 |

4. Skip the 14 records whose RA is blank (HR 92, 95, 182, 1057, 1841, 2472, 2496, 3515, 3671, 6309, 6515, 7189, 7539, 8296). Keep `V ≤ 6.5` inclusive: 49 stars sit at exactly 6.50 (8,355 with `<`).
5. `raDeg = (h + m/60 + s/3600) × 15`, `decDeg = ±(d + m/60 + s/3600)`, both rounded to 5 decimals (0.036″; the catalogue carries 0.1 s in RA and 1″ in Dec). `vmag` as parsed.
6. Names, in this order:
   1. IAU-CSN proper name. Decode the file as UTF-8. Use lines that do not start with `#` or `$`. The ASCII name is characters `[0, 18)` trimmed. Join by the HR number matched with `/^.{18}.{18}HR (\d+)\s/` (the Designation column starts at character 36). Throw on a duplicate HR. The 2022-04-04 file has 333 such rows and all 333 land among the 8,404.
   2. Bayer designation from the BSC Name field: Greek letter for the 3-letter abbreviation (`Alp` α … `Ome` ω; `Mu`, `Nu`, `Xi`, `Pi` are 2 letters plus a blank), the index digit if any, a space, the constellation: `ι Tel`, `ψ6 Aur`. Throw on an unknown abbreviation. The only other values in that field (`NOVA 1572`, `NGC 2808` and similar) belong to the 14 skipped records.
   3. Flamsteed number and constellation: `61 Cyg`.
   4. Otherwise `""`. Consumers show `HR <n>`.
7. Sort by `vmag` ascending, then HR ascending, so a magnitude limit is a prefix of the array. Write one row per line: `[\n` + each row's `JSON.stringify(row)` joined by `,\n` + `\n]\n`.
8. Print the record count, skipped count, row count, name counts and both input sha256s. Paste the line into the PR.

Expected output: `9110 records, 14 without position, 8404 rows at V <= 6.5, 333 proper names, 5319 without any name`. The remaining rows get 1,245 Bayer and 1,507 Flamsteed designations. The file is 307,503 bytes (117 KB gzipped). Polaris is `[37.95292,89.26417,2.02,424,"Polaris"]`; Sirius is the first row.

### Step 3. Stars: `src/domain/astro/stars.ts`

1. `starUnitVectors(rows)` returns `Float64Array(3 × n)` of `(cos δ cos α, cos δ sin α, sin δ)` with α, δ converted from degrees. This equals `VectorFromSphere(new Spherical(dec, ra, 1), t)`.
2. `rotateStarsAzAltDeg(time, observer, unitJ2000, count, out)` builds one `Rotation_EQJ_HOR` per call and runs a plain loop over the first `count` stars. It allocates nothing per star. The output frame is x = north, y = west, z = up, and the matrix is applied with `RotateVector`'s index order. Under `noUncheckedIndexedAccess`, copy `rot` into nine locals once, with `?? 0` (Biome forbids `!`):

```ts
import { type AstroTime, type Observer, Refraction, Rotation_EQJ_HOR } from "astronomy-engine";

const R2D = 180 / Math.PI;

export function rotateStarsAzAltDeg(
  time: AstroTime,
  observer: Observer,
  unitJ2000: Float64Array,
  count: number,
  outAzAltDeg: Float32Array,
): void {
  // Rotation_EQJ_HOR output frame: x = north, y = west, z = up. Same index order as RotateVector.
  const r = Rotation_EQJ_HOR(time, observer).rot;
  const a00 = r[0]?.[0] ?? 0;
  const a01 = r[0]?.[1] ?? 0;
  const a02 = r[0]?.[2] ?? 0;
  const a10 = r[1]?.[0] ?? 0;
  const a11 = r[1]?.[1] ?? 0;
  const a12 = r[1]?.[2] ?? 0;
  const a20 = r[2]?.[0] ?? 0;
  const a21 = r[2]?.[1] ?? 0;
  const a22 = r[2]?.[2] ?? 0;
  for (let i = 0; i < count; i++) {
    const vx = unitJ2000[3 * i] ?? 0;
    const vy = unitJ2000[3 * i + 1] ?? 0;
    const vz = unitJ2000[3 * i + 2] ?? 0;
    const n = a00 * vx + a10 * vy + a20 * vz;
    const w = a01 * vx + a11 * vy + a21 * vz;
    const u = a02 * vx + a12 * vy + a22 * vz;
    let az = -Math.atan2(w, n) * R2D;
    if (az < 0) az += 360;
    if (az >= 360) az -= 360;
    const alt = Math.atan2(u, Math.hypot(n, w)) * R2D;
    outAzAltDeg[2 * i] = az;
    outAzAltDeg[2 * i + 1] = alt + Refraction("normal", alt);
  }
}
```

3. `apparentAltDeg(g) = g + Refraction("normal", g)`. `geometricAltDeg(a) = a + InverseRefraction("normal", a)`. The round trip is exact to 1.4e-14° over −1° to 90°.
4. `needsSkyRecompute(simTimeMs, lastSkyMs)` returns true when `lastSkyMs` is null or `|simTimeMs − lastSkyMs| ≥ SKY_RECOMPUTE_MS` (2,000).
5. Tests first (`stars.test.ts`): the Polaris fixture, the library oracle, the refraction constants and the recompute rule (section 5).

### Step 4. Sun, Moon and planets: Horizons fixture and `bodies.ts`

1. Write `scripts/fetch-horizons-fixture.ts` and run it once with `npx tsx`. One request per body (Sun 10, Moon 301, Mercury 199, Venus 299, Mars 499, Jupiter 599, Saturn 699, Uranus 799), 500 ms apart. The request is `GET https://ssd.jpl.nasa.gov/api/horizons.api` with these parameters (single quotes are part of each value; `URLSearchParams` encodes them):

```text
format=json  COMMAND='<id>'  OBJ_DATA='NO'  MAKE_EPHEM='YES'  EPHEM_TYPE='OBSERVER'
CENTER='coord@399'  COORD_TYPE='GEODETIC'  SITE_COORD='-155.4689,19.8253,4.204'
START_TIME='2026-10-10 00:00'  STOP_TIME='2026-10-11 00:00'  STEP_SIZE='20m'  TIME_TYPE='UT'
QUANTITIES='4'  ANG_FORMAT='DEG'  EXTRA_PREC='YES'  APPARENT='AIRLESS'  CSV_FORMAT='YES'
```

2. In the script:
   - Fail unless the HTTP status is 200.
   - Fail unless the `result` text contains `Atmos refraction: NO (AIRLESS)`.
   - Take the lines between `$$SOE` and `$$EOE`. Each CSV line is: date, solar flag, lunar flag, az, el.
   - Convert ` 2026-Oct-10 00:20` to `2026-10-10T00:20:00Z`.
   - Fail on any non-finite az or el.
   - `SITE_COORD` is east longitude, latitude, km.
3. Fixture shape (also in the [README fixtures table](README.md#fixtures)). Body keys are the `BODY_IDS` strings. Each body has 73 rows (00:00 through 24:00 inclusive).

   ```json
   {
     "generator": "scripts/fetch-horizons-fixture.ts",
     "fetchedAtUtc": "2026-10-11T07:57:38.590Z",
     "query": "EPHEM_TYPE=OBSERVER CENTER=coord@399 COORD_TYPE=GEODETIC QUANTITIES=4 ANG_FORMAT=DEG EXTRA_PREC=YES APPARENT=AIRLESS TIME_TYPE=UT STEP_SIZE=20m",
     "site": { "latDeg": 19.8253, "lonDeg": -155.4689, "heightM": 4204 },
     "bodies": { "sun": { "command": "10", "rows": [["2026-10-10T00:00:00Z", 228.740928134, 52.025548643]] } }
   }
   ```

   The first Sun row above is real; check your run against it.
4. `bodies.ts`:
   - `makeObserver(site)` returns `new Observer(latDeg, lonDeg, heightM)`. Build it once per site, not per pass.
   - `astroTimeAt(ms)` returns `MakeTime(new Date(ms))`. Build it once per pass.
   - `computeBodies(time, observer, out)` runs over `BODY_IDS` in order with `Body.Sun, Body.Moon, Body.Mercury … Body.Uranus`. For each body it calls `Equator(body, time, observer, true, true)`, then `Horizon(time, observer, eq.ra, eq.dec, "normal")`, then `Illumination(body, time)`, and writes `[azimuth, altitude, mag, phase_fraction]` at `i × BODY_STRIDE`.
   - `bodyAirlessAzAltDeg` uses the same pipeline with the refraction argument left out. It throws `RangeError` for an index outside 0–7.
5. The library allocates inside `Equator`, `Horizon` and `Illumination`. For 8 bodies that is accepted (0.16–0.19 ms per pass, `verification/architecture.md` #22). The star loop is the part that must not allocate.

### Step 5. Twilight: `twilight.ts`

1. `sunGeometricAltDeg(time, observer)` is `Equator(Body.Sun, time, observer, true, true)`, then `Horizon(...)` with no refraction argument.
2. `civilTwilightMs(observer, startMs, direction, limitDays)` returns `SearchAltitude(Body.Sun, observer, direction, new Date(startMs), limitDays, -6)?.date.getTime() ?? null`. A direction of −1 gives civil dusk (the end of evening civil twilight); +1 gives civil dawn. A positive `limitDays` searches forward only.
3. `twilightMarkersMs(observer, centerMs, halfRangeMs)`:
   - For each direction, search forward from `searchStart = centerMs − halfRangeMs` with `limitDays = (windowEnd − searchStart) / 86,400,000`, where `windowEnd = centerMs + halfRangeMs`.
   - Push each hit that is ≤ `windowEnd`.
   - Restart the search at `searchStart = hit + 3,600,000` ms. Same-direction crossings are about 24 h apart.
   - Stop on `null`, on a hit after `windowEnd`, or when `searchStart ≥ windowEnd`. That last check keeps `limitDays` positive: a negative value searches backward (gotcha 8).
   - Results are ascending. Polar day or night gives empty arrays.
   - Cost per warm call, measured on 2026-10-11 over 300 calls with a ± 12 h window at the Polaris site: median 0.14–0.17 ms (p95 0.34–1.06 ms, over three runs on a loaded machine) in Node 26.11.1 arm64, and median 0.1 ms (p95 0.3–0.4 ms; its timer resolution is 0.1 ms) in headless Chromium 156. The first, cold call took 2.5–4.7 ms in both. Call it only when `rangeCenterMs` or the site changes, never per frame.

### Step 6. Zenith equidistant fisheye: `lens.ts`, `project.ts`

1. `syntheticFisheyeCalibration(sizePx)` returns `azDeg 0, altDeg 90, rollDeg 180, focalPx (sizePx/2)/(π/2), cxPx = cyPx = sizePx/2, k1 = k2 = 0, flipX false, streamDelayMs 0, rmsDeg null, updatedAtMs 0`. For 1024 px, `focalPx` is 325.94932345220167, which puts the horizon on the image edge.
2. Pixel coordinates are continuous. The image's top-left corner is (0, 0) and its bottom-right corner is (W, H), so pixel `i` covers `[i, i+1)` and the centre is W/2, not (W−1)/2. The README orientation fixture (`[512, 1024]` for north) depends on this.
3. `horizonRadiusUnit(lens)`: π/2, √2, 2, 1, and `Infinity` for rectilinear.
4. `createCameraModel(input)` sets `zenithLocked: true`, `thetaMaxRad: π/2` and `rMaxUnit = min(r_corner, horizonRadiusUnit(lens))`, where `r_corner` is the largest `hypot(u − cxPx, v − cyPx) / focalPx` over the four image corners (M4 adds undistortion to it). That is π/2 for the synthetic camera (`r_corner` 2.2214). Until M4 it throws for any lens other than `fisheye-equidistant` with `altDeg === 90`. That is a programmer error, because M2's registry holds only the synthetic camera (M1 enables nothing else).
5. `projectAzAltDeg` is the polar azimuthal-equidistant closed form (north at the bottom, east on the right), then the shared tail from the brief: roll, radial factor `s`, focal length, principal point and flip. Do not multiply by f before the tail (`verification/proj4-lens.md`, implementation note 5). It returns false for alt < 0 (θ > π/2) and for non-finite input, so NaN never reaches OpenLayers:

```ts
import type { CameraModel } from "./lens";

const D2R = Math.PI / 180;

/** M2: zenith equidistant fisheye. Writes [uPx, vPx] (v down); false when culled. */
export function projectAzAltDeg(
  model: CameraModel,
  azDeg: number,
  altDeg: number,
  out: Float64Array,
  offset: number,
): boolean {
  const theta = (90 - altDeg) * D2R; // angle from the zenith
  // The first test also rejects a NaN altitude. At alt 0, theta is exactly π/2, so the horizon projects.
  if (!(theta <= model.thetaMaxRad) || theta < 0 || !Number.isFinite(azDeg)) return false;
  const a = azDeg * D2R;
  const x = theta * Math.sin(a); // polar aeqd: north at the bottom, east on the right
  const y = -theta * Math.cos(a);
  const c = model.calibration;
  const rho = c.rollDeg * D2R;
  const cr = Math.cos(rho);
  const sr = Math.sin(rho);
  const xr = x * cr - y * sr;
  const yr = x * sr + y * cr;
  const r2 = xr * xr + yr * yr;
  if (r2 > (1.05 * model.rMaxUnit) ** 2) return false;
  const s = 1 + c.k1 * r2 + c.k2 * r2 * r2;
  out[offset] = c.cxPx + (c.flipX ? -1 : 1) * c.focalPx * s * xr;
  out[offset + 1] = c.cyPx - c.focalPx * s * yr;
  return true;
}
```

6. `projectBatch` loops `projectAzAltDeg` over `[az, alt]` pairs into caller-owned arrays through one module-level `Float64Array(2)` scratch. It writes `outVisible[i]` as 1 or 0 and returns the visible count. `toSkyMapCoord(model, u, v, out, offset)` writes `[u, heightPx − v]`.
7. At roll 180°, W = H = 1024, the map coordinates are: zenith `[512, 512]`, N horizon `[512, 1024]` (top), E `[0, 512]` (left), S `[512, 0]`, W `[1024, 512]`. That is the view from below: north up, east left (`verification/proj4-lens.md` #20).

### Step 7. Sky cache and star loading: `src/state/skyCache.ts`

1. Implement the API in [README section 6](README.md#state-app-and-map-modules): `createSkyCache`, the `skyCache` singleton, `starCountForLimit`, `setStars`, `setStarLimit`, `invalidateSky`, `updateSky` and `loadStars`. Semantics:
   - `createSkyCache()`: no rows, empty typed arrays, `starCount` 0, `bodies = new Float64Array(BODY_IDS.length × BODY_STRIDE).fill(NaN)` (NaN means "not computed yet"), `lastSkyMs`, `site` and `observer` null.
   - `starCountForLimit(rows, vmag)`: the number of leading rows with `vmag ≤` the limit (binary search; the rows are sorted).
   - `setStars(cache, rows, vmagLimit)`: stores the rows, `unitJ2000 = starUnitVectors(rows)`, a new `Float32Array(2 × rows.length)` for `starAzAltDeg`, `starCount = starCountForLimit(rows, vmagLimit)`, and sets `lastSkyMs = null`.
   - `setStarLimit(cache, vmagLimit)`: recomputes the count. If it changed, stores it, sets `lastSkyMs = null` and returns true; otherwise returns false.
   - `invalidateSky(cache)`: `lastSkyMs = null`.
2. `updateSky(cache, simTimeMs, site)`:
   1. When `site` is a different object from `cache.site`, rebuild the observer and clear `lastSkyMs`. The registry hands out stable site objects, so a camera switch changes the reference.
   2. Return false unless `needsSkyRecompute` is true.
   3. Otherwise build one `astroTimeAt`, run `rotateStarsAzAltDeg` over `starCount` stars and `computeBodies`, set `lastSkyMs`, and return true.
3. `loadStars(store)`:
   1. Set `setLoadStatus("stars", "loading")`.
   2. Fetch `` `${import.meta.env.BASE_URL}data/stars.json` ``, as M1 fetches `cameras.json`. Throw on `!res.ok`.
   3. Validate it: a non-empty array of at most 8,404 rows (the stars layer's capacity, step 8); every row is 5 elements with 4 finite numbers and a string; `vmag` is non-decreasing.
   4. Call `setStars(skyCache, rows, selectStarMagLimit(store.getState()))`, then set `ready`.
   5. On any failure, `console.error` and set `error`. Do not retry ([Errors](README.md#errors)).
4. Store:
   - Add `setStarMagLimit(vmag)`. It ignores non-finite values and clamps to [1, 6.5].
   - Add `selectStarMagLimit` and `selectCalibration` as specified in [Selectors](README.md#selectors).
   - `main.tsx` calls `loadStars(store)` once at startup, without awaiting it.

### Step 8. Sky map and layers: `src/map/sky`

1. `createSkyMap(target, store, cache)` returns a `SkyMapHandle`. It builds the map with the helpers below. The map has no controls and no interactions: the synthetic view always shows the whole frame. M4 adds pan and zoom for still images. The view is fitted to the frame on creation and on every `change:size`. OpenLayers' own ResizeObserver fires `change:size` when the container resizes.
   - In an 800 × 600 container the 1024 px frame fits at resolution 1.7067, with N at pixel (400, 0) and E at (100, 300). After a resize to 400 × 300 they move to (200, 0) and (50, 150). In a 400 × 200 container the resolution is 5.12 and N stays at (200, 0).
   - `createSkyView` must set `maxResolution`. Without it OpenLayers caps the resolution at max(W, H)/256 (4 for a 1024 px frame). The frame then cannot fit any container whose shorter side is under 256 px: in 400 × 200, N landed at (200, −28), off the top (checked).
   - `fitSkyFrame` reads the extent from the current view's projection, so it stays right after `setCameraModel` swaps the view for a new frame size (checked: 1024² → 1232² → resize to 400 × 300 gives resolution 4.1067).
   - The handle's functions are closures, not methods that use `this`: `SkyView` passes `sky.updateFrame` to `registerFrameUpdater` unbound.
   - Until the first `setCameraModel`, `createSkyMap` uses the active camera's `imageSize`, or 1024 × 1024 while the registry is still loading.

```ts
import { getCenter } from "ol/extent";
import OlMap from "ol/Map";
import Projection from "ol/proj/Projection";
import View from "ol/View";

/** Pixel projection of one camera frame: a pixel (u, v) is the coordinate [u, H − v]. */
export function skyPixelProjection(widthPx: number, heightPx: number): Projection {
  return new Projection({
    code: `sky-px-${widthPx}x${heightPx}`,
    units: "pixels",
    extent: [0, 0, widthPx, heightPx],
  });
}

/** One view per frame size. Without maxResolution, OpenLayers caps it at max(W, H)/256. */
export function createSkyView(widthPx: number, heightPx: number): View {
  const projection = skyPixelProjection(widthPx, heightPx);
  return new View({
    projection,
    center: getCenter(projection.getExtent()),
    resolution: 1,
    maxResolution: Math.max(widthPx, heightPx),
    enableRotation: false,
  });
}

/** Fits the current view's whole frame (its projection extent) into the map's size. */
export function fitSkyFrame(map: OlMap): void {
  const size = map.getSize();
  if (size === undefined || !((size[0] ?? 0) > 0 && (size[1] ?? 0) > 0)) return;
  const view = map.getView();
  view.fit(view.getProjection().getExtent(), { size });
}

/** No interactions or controls: the sky view always shows the whole frame. */
export function createSkyOlMap(target: HTMLElement, widthPx: number, heightPx: number): OlMap {
  const map = new OlMap({
    target,
    controls: [],
    interactions: [],
    view: createSkyView(widthPx, heightPx),
  });
  map.on("change:size", () => fitSkyFrame(map));
  fitSkyFrame(map);
  return map;
}
```

   `createSkyMap` calls `createSkyOlMap`, adds the three layers, calls `invalidateSky(cache)` and returns the handle. The cache outlives any one map (StrictMode mounts, cleans up and mounts again in development), so a new map must not wait for 2 s of sim time before its first pass. Do not name a local function `fit`: Biome's `noFocusedTests` reports a bare `fit()` call as a focused test, and its unsafe fix rewrites the call to `it()` (gotcha 19).
2. Layer order, bottom to top: grid, stars, bodies.
3. `layers/grid.ts`: `buildGridFeatures(model)` returns one `MultiLineString` plus 4 letter `Point`s. `createGridLayer()` returns a `VectorLayer` over a `VectorSource` with `useSpatialIndex: false`, with cached styles.
   - Altitude circles every 10° from 0° to 80°, sampled every 1° of azimuth.
   - Azimuth lines every 10°, from alt 0° to alt 80°, sampled every 1°.
   - Every sample goes through `projectAzAltDeg` and `toSkyMapCoord`, and a polyline is split wherever a sample is culled. That makes the code work unchanged for M4 lenses.
   - Letters N, E, S and W sit at az 0/90/180/270, alt 5°, so they lie fully inside the frame.
   - Rebuild only in `setCameraModel`.
4. `layers/stars.ts`: one `MultiPoint` holds every star in the current magnitude prefix. A custom `Style.renderer` draws only the visible ones, with a per-star radius. Write coordinates in place, then call `changed()`. When the limit changes, resize with `setFlatCoordinates`, which does not fire a change itself:

```ts
import Feature from "ol/Feature";
import MultiPoint from "ol/geom/MultiPoint";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";

export interface StarsLayer {
  readonly layer: VectorLayer<VectorSource>;
  readonly geometry: MultiPoint; // point i = star i of the catalogue prefix
  readonly visible: Uint8Array; // 1 = draw star i (projected, alt ≥ 0)
  readonly radiusPx: Float32Array; // CSS px, set once from vmag
}

/** One MultiPoint for every star; a custom renderer draws the visible ones with a per-star radius. */
export function createStarsLayer(capacity: number, fillStyle: string): StarsLayer {
  const visible = new Uint8Array(capacity);
  const radiusPx = new Float32Array(capacity);
  const geometry = new MultiPoint([0, 0], "XY");
  const style = new Style({
    renderer: (pixelCoordinates, state) => {
      const pts = pixelCoordinates as number[][]; // one [x, y] per point, in point order, device px
      const ctx = state.context;
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (visible[i] !== 1 || p === undefined) continue;
        const x = p[0] ?? 0;
        const y = p[1] ?? 0;
        const r = (radiusPx[i] ?? 0) * state.pixelRatio;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    },
  });
  const source = new VectorSource({ useSpatialIndex: false, features: [new Feature(geometry)] });
  return { layer: new VectorLayer({ source, style }), geometry, visible, radiusPx };
}

/** After a magnitude-limit change: one point per star in the new prefix (allocates once per change). */
export function setStarCount(stars: StarsLayer, count: number): void {
  stars.geometry.setFlatCoordinates("XY", new Array<number>(count * 2).fill(0));
  stars.visible.fill(0);
  stars.geometry.changed();
}
```

   - `createSkyMap` calls `createStarsLayer(8404, fillStyle)`: the capacity is the committed catalogue's row count, and `loadStars` rejects a longer file. The fill colour is a design decision. Fill `radiusPx` from `vmag` once per catalogue load (item 6.2 below).
   - Every point must stay inside the frame. For a culled star (`visible[i] = 0`), write the frame centre `[W / 2, H / 2]`. Never park it off-frame, and never write NaN. OpenLayers drops every point outside the rendered extent before it calls the renderer, so `pixelCoordinates[i]` would no longer be star `i` (gotcha 20).
   - Checked in headless Chromium at DPR 1 and 2: visible points are drawn at their device-pixel positions, and a point with `visible[i] = 0` leaves its pixel empty.
   - The size mapping must be monotonic: a brighter star is never smaller. The actual radii are a design decision.
   - Hit detection on this layer is not used: picking is a nearest-neighbour search over the projected arrays (M3).
5. `layers/bodies.ts`: 8 `Point` features in `BODY_IDS` order, created once, each with its index.
   - Write the coordinates into `point.getFlatCoordinates()` with `toSkyMapCoord`, then call `point.changed()`.
   - The style function returns `undefined` for a body that `projectAzAltDeg` culled, and for every body before the first pass. Otherwise it returns a cached `Style` with a marker and a text label.
   - Marker size grows with brightness from `Illumination` magnitude, clamped so the Sun (−26.7) and Moon do not dominate. The numbers are a design decision.
   - Export `bodyLabel(id, phaseFraction)`. It returns `Sun`, `Moon`, `Mercury` … `Uranus`, and `Moon (new)` when the Moon's `phase_fraction` is below 0.02. In that case the Moon's marker is also de-emphasised, so the label carries the meaning and colour does not ([Accessibility](README.md#accessibility)).
6. `handle.updateFrame(simTimeMs)` is registered with `registerFrameUpdater`. Each frame it:
   1. Reads `selectSite` and `selectStarMagLimit` from `store.getState()`. It returns early with no camera model or no site.
   2. If `cache.rows` is not the array this handle last saw (the catalogue arrived, or this map is new), fill `radiusPx` from `vmag` and call `setStarCount(stars, cache.starCount)` (`setStars` or `createSkyMap` already cleared `lastSkyMs`). Otherwise, if `setStarLimit(cache, limit)` returns true, call `setStarCount(stars, cache.starCount)`. Never resize the `MultiPoint` without a cleared `lastSkyMs`: `setStarCount` zeroes the points, and only the next pass refills them.
   3. Takes `const t0 = performance.now()`. If `updateSky` returns false, it returns.
   4. Otherwise it runs `projectBatch` over the star prefix into a reused `Float32Array`, with `stars.visible` as `outVisible`. It writes `[u, H − v]` for visible stars and the frame centre for culled ones into the `MultiPoint`, writes the bodies, and calls one `changed()` per geometry.
   5. Ends with the measure below. Rendering stays in the clock loop (`renderSyncAll()`, which M1 runs on frames where the sim time changed). On other frames, such as a camera change while paused, the `changed()` calls make OpenLayers schedule its own render.

```ts
performance.measure("overhead:sky", { start: t0 });
performance.clearMeasures("overhead:sky");
```

   Clearing at once keeps the user-timing buffer from growing at 60 entries per second. A `PerformanceObserver` still receives every entry; the e2e and perf tests count passes that way.
7. `handle.setCameraModel(model)`:
   - If `widthPx` or `heightPx` changed, call `map.setView(createSkyView(W, H))`, then `fitSkyFrame(map)`. `setView` does not fire `change:size`, so the explicit refit is needed.
   - Rebuild the grid features.
   - Call `invalidateSky(cache)` so the next frame recomputes and reprojects.
8. `src/map/sync/bindSkyCamera.ts`, `bindSkyCamera(store, sky)`:
   - Subscribe to `(s) => [selectActiveCamera(s), selectCalibration(s)] as const` with `shallow` and `fireImmediately` ([Binding rules](README.md#binding-rules)).
   - When the camera is defined, call `sky.setCameraModel(createCameraModel({ lens, calibration, widthPx, heightPx }))`, taking `widthPx` and `heightPx` from `camera.imageSize`.

### Step 9. `SkyView.tsx`

1. Lifecycle per [Map lifecycle](README.md#map-lifecycle), through M1's `registerMap` (the only implementation of the cleanup order). The effect on the container ref has no dependencies and returns:

   `registerMap("sky", sky.map, [bindSkyCamera(store, sky), bindLayerVisible(store, "stars", sky.starsLayer), bindLayerVisible(store, "planets", sky.bodiesLayer), bindLayerVisible(store, "grid", sky.gridLayer), registerFrameUpdater(sky.updateFrame)])`

   where `const sky = createSkyMap(el, store, skyCache)` is built in the same effect run. The cleanup runs every disposer, disposes the layers, calls `map.dispose()` and removes the registry entry only if it still points at this map. `SkyView` imports no `ol/*` module ([import rule 4](README.md#3-file-layout)).
2. The container is a `<section>` with `aria-label` "Computed sky for <camera name>: zenith fisheye, north up, east left". Use `<section>`, not `<div role="region">`: Biome's `useSemanticElements` rejects the latter (checked). The map target is a child element with a non-zero size (any CSS; M1 gotcha 15).
   - `aria-busy` is `"true"` until `data.stars` is `ready` or `error`, so it is also busy while `idle`. React writes `aria-busy={false}` as `aria-busy="false"`, which the e2e spec waits for.
   - While `data.stars` is `loading`, a `role="status"` text reads "Loading star catalogue".
   - On `error` it reads "Star catalogue failed to load", and the grid and bodies still draw.
3. Text alternative inside the region: an "Above the horizon" list of the Sun, Moon and planets whose apparent altitude is finite and ≥ 0, in `BODY_IDS` order.
   - Each item reads like "Saturn, az 120°, alt 58°": `bodyLabel` names, whole degrees with `Math.round`, and an azimuth that rounds to 360 shown as 0.
   - With no body above the horizon it reads "No Sun, Moon or planets above the horizon".
   - Before the first pass every `skyCache.bodies` value is NaN. The list then renders no items and no fallback text.
   - It re-renders only through `useTick4Hz()` and reads `skyCache.bodies` during render ([React rules](README.md#react-rules)).
   - It is not an `aria-live` region.
4. The visual design of the sky view and its list is settled from screenshots.

### Step 10. Timeline, Layers panel, Credits

1. Twilight markers in `Timeline.tsx`:
   - `useMemo` over `rangeCenterMs` (`useAppState` primitive) and the site (`selectSite`, a stable reference) computes `twilightMarkersMs(makeObserver(site), rangeCenterMs, SCRUB_HALF_RANGE_MS)`. There are no markers when the site is null.
   - Each event is a `<button>` placed along the scrubber at `(t − (rangeCenterMs − 12 h)) / 24 h`.
   - Accessible name: "Civil dusk 04:24 UTC (18:24 local)" or "Civil dawn …". Build it from `formatUtcHhMm(t)` and `formatZonedDateTime(t, site.timeZone).slice(11, 16)` (M1). Both truncate to the minute, so the two labels agree.
   - Activating a marker (click, Enter or Space) calls `actions.seek(ms)`. M1's `keyboard.ts` skips Space on a BUTTON target, so Space presses the focused marker and does not toggle play. The markers are in the Tab order with a visible focus ring.
2. `LayerToggles.tsx`:
   - Checkboxes "Stars", "Sun, Moon and planets" and "Alt/az grid", bound to `toggleLayer`.
   - "Star magnitude limit": `<input type="range" min="1" max="6.5" step="0.5">` wired to `setStarMagLimit`. Its text shows the limit and the star count, for example "V ≤ 4.5 (904 stars)", using `starCountForLimit(skyCache.rows, limit)`. The component also reads `data.stars` with `useAppState`, so the count updates when the catalogue arrives.
   - `keyboard.ts` already ignores `input` targets, so the arrow keys move the slider, not the clock.
3. Credits ([Credits](README.md#credits)):
   - `credits.ts` adds `BSC5_CREDIT: Credit` (text "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR", `href` `https://doi.org/10.26093/cds/vizier`, no licence) and `IAU_WGSN_CREDIT` (text "Star names: IAU WGSN", `href` `https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt`, `licence` "CC BY", `licenceHref` null). Both URLs returned 200 on 2026-10-11 (the DOI redirects to VizieR).
   - `starCredits(starsOn: boolean): Credit[]` returns both while `layers.stars` is on, else `[]`. Like `dataCredits`, it returns a new array: call it during render, never inside `useAppState`.
   - `Credits.tsx` lists `starCredits(...)` after `dataCredits(...)`.

### Step 11. End-to-end and performance tests

Write `tests/e2e/sky.spec.ts` (section 5). Every spec imports `test` from `./fixtures`. Count sky passes with an observer installed before the app loads:

```ts
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Counts sky passes. The app clears its "overhead:sky" measures at once; an observer still receives each one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __skyPasses: number };
    w.__skyPasses = 0;
    new PerformanceObserver((list) => {
      w.__skyPasses += list.getEntriesByName("overhead:sky").length;
    }).observe({ type: "measure" });
  });
});
const skyPasses = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __skyPasses: number }).__skyPasses);
const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

test("sky recomputes on >= 2 s of sim time", async ({ page }) => {
  await page.goto("./?cam=synthetic-maunakea&t=2026-10-10T08:00:00Z");
  // Wait for the catalogue: its arrival triggers one more pass.
  await expect(page.getByRole("region", { name: /Computed sky/ })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect.poll(() => skyPasses(page)).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const c0 = await skyPasses(page);
  await page.keyboard.press("ArrowRight"); // +1 s: below the threshold
  await twoFrames(page);
  await page.waitForTimeout(200);
  expect(await skyPasses(page)).toBe(c0);
  await page.keyboard.press("ArrowRight"); // +2 s in total
  await expect.poll(() => skyPasses(page)).toBe(c0 + 1);
});
```

The remaining `sky.spec.ts` cases in section 5 follow the same pattern. Before pressing clock keys, make sure focus is on the page body, not an input: `keyboard.ts` ignores keys typed into an input. Locate the "Above the horizon" list by its exact accessible name (`exact: true`): Playwright matches a case-insensitive substring otherwise, and M3 adds a "Satellites above the horizon" list.

Then write `tests/perf/sky.perf.ts` (run by hand with `npm run perf`):

1. Load `?t=2026-10-10T08:00:00Z` and wait for the region's `aria-busy="false"`.
2. Press `l`, `fill("6.5")` the "Star magnitude limit" slider, then `blur()` it. While the slider has focus, `]` and Space go to the slider, not the clock.
3. Press `]` three times (600×), then Space.
4. Collect `overhead:sky` durations with the same observer for 10 s (the observer receives `PerformanceMeasure` entries; read `entry.duration`).
5. Drop the first pass and report the p95. The budget is ≤ 2 ms ([section 9](README.md#9-performance-budgets)).

### Step 12. Docs

1. Append the section 8 entries to `docs/DECISIONS.md`.
2. Write the root `README.md` M2 section:
   - what the sky view shows;
   - how to regenerate `stars.json` and the Horizons fixture;
   - the two new credits.

## 5. Tests

Site for every astronomy test unless stated: 19.8253°, −155.4689°, 4,204 m. Fixtures are described in [Fixtures](README.md#fixtures).

| File | Test | Fixture and how it is made | Tolerance |
| ---- | ---- | -------------------------- | --------- |
| `stars.test.ts` | Polaris at 2026-10-10T08:00Z via `rotateStarsAzAltDeg` | Inline: HR 424, J2000 RA 37.95456°, Dec +89.26411° (SIMBAD). Expected az 0.592°, alt 20.151° (measured 0.59233°, 20.15073°). | ± 0.01° each. Dropping refraction gives 20.105° and must fail. |
| `stars.test.ts` | Polaris airless oracle | `HorizonFromVector(RotateVector(Rotation_EQJ_HOR(t, obs), VectorFromSphere(new Spherical(dec, ra, 1), t)), "")` gives alt 20.105° (measured 20.10529°) | ± 0.01° |
| `stars.test.ts` | Inline loop vs the library over all of `stars.json` at the Polaris instant | `HorizonFromVector(..., "normal")` per star as the oracle | `angularSeparationDeg` < 1e-4° (measured worst 1.52e-5°, Float32 rounding) |
| `stars.test.ts` | `Refraction("normal", alt)` and `apparentAltDeg` | 0° → 0.48303, 10° → 0.09013, 20° → 0.04569, 45° → 0.01688 | ± 1e-5 |
| `stars.test.ts` | `geometricAltDeg(apparentAltDeg(a))` for a = −1° … 90° step 0.25° | none | < 1e-9° (measured 1.4e-14°) |
| `stars.test.ts` | `needsSkyRecompute` | (1000, null) true; (10000, 8001) false; (10000, 8000) true; (8000, 10000) true | exact |
| `bodies.test.ts` | Each of the 8 bodies vs Horizons, rows with el > 0 only, using `bodyAirlessAzAltDeg` | `tests/fixtures/horizons-airless-maunakea-2026-10-10.json` from `scripts/fetch-horizons-fixture.ts` (step 4). Assert 73 rows per body and at least 30 checked rows per body (measured 34–40). | great-circle < 0.05°. Measured worst: Venus 0.00583°, Saturn 0.00324°, Uranus 0.00169°, Jupiter 0.00096°, Moon 0.00078°, Sun 0.00069°, Mercury 0.00068°, Mars 0.00067°. |
| `bodies.test.ts` | `computeBodies` equals airless + `Refraction("normal", airlessAlt)`, and az is unchanged, for all 8 bodies every 20 min on 2026-10-10 | none | < 1e-9° (measured 1.4e-14°) |
| `bodies.test.ts` | `computeBodies` at 2026-10-10T08:00Z writes 32 finite values; Moon `phase_fraction` < 0.02 (measured 0.002, new moon); `bodyLabel("moon", 0.002)` is "Moon (new)" | none | exact |
| `twilight.test.ts` | From 2026-10-10T10:00Z, `civilTwilightMs(-1, 1 day)` and `(+1, 1 day)` | Inline. Skyfield 1.55, DE421, `almanac.dark_twilight_day` (civil→nautical is 3→2): dusk 2026-10-11T04:24:11Z, dawn 2026-10-10T15:53:03Z. The USNO API agrees at its minute resolution: End Civil Twilight 18:24 HST, Begin 05:53 HST. | ± 60 s (astronomy-engine is within 1 s: 04:24:11.187Z and 15:53:03.414Z) |
| `twilight.test.ts` | `sunGeometricAltDeg` at the returned dusk | none | −6 ± 0.001° |
| `twilight.test.ts` | Start 2026-10-11T05:00Z, direction −1, 0.1 day | none | `null` |
| `twilight.test.ts` | `twilightMarkersMs` at 2026-10-10T08:00Z ± 12 h | Skyfield dusk 2026-10-10T04:24:59Z (USNO 18:25 HST on 10-09), dawn 2026-10-10T15:53:03Z | exactly 1 of each, ± 60 s |
| `twilight.test.ts` | ± 36 h around the same centre | none | 3 dusks and 3 dawns, ascending, consecutive spacing 24 h ± 5 min |
| `twilight.test.ts` | Tromsø 69.65°, 18.96°, 0 m, 2026-06-21T00:00Z ± 12 h | none | both arrays empty |
| `lens.test.ts` | `syntheticFisheyeCalibration(1024).focalPx` | none | 325.949 ± 0.001 |
| `lens.test.ts` | Roll 180°, map coordinates of zenith, N, E, S, W horizon | README orientation fixture | `[512,512]`, `[512,1024]`, `[0,512]`, `[512,0]`, `[1024,512]` ± 1e-9 px |
| `lens.test.ts` | Roll 0° puts N at map `[512, 0]`; flipX at roll 180° puts E at x = 1024 | none | ± 1e-9 px |
| `lens.test.ts` | Equidistance: radius = 512 × (90 − alt)/90 px for alt 0, 10, 30, 45, 60, 89 | none | ± 1e-9 px |
| `lens.test.ts` | Cull: alt −0.001° false, alt 0° true, NaN alt false, NaN az false | none | exact |
| `lens.test.ts` | Roll 0° vs proj4 `+proj=aeqd +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +R=1 +no_defs` (source `+proj=longlat +R=1 +no_defs`), 50 points from mulberry32(20261011), az 0–360, alt 0–90 | none | `(u − cx)/f` vs x and `−(v − cy)/f` vs y < 1e-9 |
| `lens.test.ts` | `projectBatch` on (az, alt) = (0, 0), (90, −5), (180, 45): visible `[1,0,1]`, returns 2, pixels (u, v) (512, 0) and (512, 768) | none | ± 1e-3 px (Float32) |
| `lens.test.ts` | `cameras.json` `synthetic-maunakea` defaults equal `syntheticFisheyeCalibration(1024)` (except `updatedAtMs`) | `public/data/cameras.json`; `focalPx` must be the full double 325.94932345220167 | ± 1e-9 |
| `starsJson.test.ts` | 8,404 rows; `vmag` non-decreasing; HR 424 named "Polaris", 2491 "Sirius", 7001 "Vega"; HR 7424 "ι Tel"; HR 8085 "61 Cyg"; 5-element rows, finite numbers | `public/data/stars.json` | exact |
| `starsJson.test.ts` | `starCountForLimit`: 4 → 518, 4.5 → 904, 6.5 → 8,404 | same | exact |
| `skyCache.test.ts` | `updateSky` returns true on the first call; false at +1,999 ms; true at +2,000 ms; true when stepping back 2 s; true for a new site object; true after `setStarLimit` changes the count; true after `invalidateSky` | `stars.json` | exact |
| `skyCache.test.ts` | Polaris from its `stars.json` row (BSC coordinates) after `updateSky` | same | az 0.592 ± 0.01°, alt 20.151 ± 0.01° (measured 0.59226°, 20.15071°) |
| `skyCache.test.ts` | `loadStars` with the throwing fetch stub from `setup.ts`: status goes `loading` → `error`; with a one-test fetch stub that returns `stars.json`: `ready` and `starCount` 904 | store from `createAppStore` | exact |
| `skyGrid.test.ts` | `buildGridFeatures` for the synthetic camera: 45 polylines (9 circles + 36 lines); letters N `[512, 995.556]`, E `[28.444, 512]`, S `[512, 28.444]`, W `[995.556, 512]` | none (real OpenLayers geometry in Node) | ± 1e-3 px |
| `bindSkyCamera.test.ts` | With a fake `{ setCameraModel }`: one call at subscribe, with `zenithLocked` true; none on `tick`; one after a calibration change; none after an unsubscribe. Make the calibration change with `store.setState` on `camera.calibration`: `updateCalibration` still throws until M4. | `storeAt("2026-10-10T08:00:00Z")` (M1 helper) | exact |
| `actions.test.ts`, `selectors.test.ts` | `setStarMagLimit(7)` → 6.5, `(0)` → 1, `(NaN)` → unchanged; `selectStarMagLimit` gives 4 for a state with `layers.starMagLimit` 4.5 and `ui.panel` "calibration" (build that state directly; the panel lands in M4), and 4.5 otherwise; `selectCalibration` returns the registry `defaults` object itself (`toBe`) while `camera.calibration` is empty, and the stored object once `camera.calibration["synthetic-maunakea"]` is set with `setState` | store | exact |
| `credits.test.ts` | `starCredits(true)` is `[BSC5_CREDIT, IAU_WGSN_CREDIT]`; `starCredits(false)` is `[]` | none | exact |
| `sky.spec.ts` (e2e) | Load `./?cam=synthetic-maunakea&t=2026-10-10T08:00:00Z`. Once the region named /Computed sky/ has `aria-busy="false"`, the "Above the horizon" list holds exactly "Saturn, az 120°, alt 58°" and "Uranus, az 73°, alt 16°" (computed az 120.4°, alt 57.60°; az 72.9°, alt 16.00°). | committed `stars.json`; route mocks from `fixtures.ts` | exact |
| `sky.spec.ts` | Paused: `skyPasses` unchanged over 500 ms. → once: unchanged. → again: +1. Shift+→: +1. ← twice: +1. | observer above | exact (`expect.poll` for the increments) |
| `sky.spec.ts` | Exactly one "Civil dusk" and one "Civil dawn" button. Focus the dusk one and press Enter: the URL's `t` is within 2 s of 2026-10-10T04:24:58.9Z; passes +1; the list becomes Mercury, Venus, Saturn in that order (computed alt 10.77°, 4.46°, 8.74°). | same | ± 2 s |
| `sky.spec.ts` | Rate 600× (`]` three times) and play for 1 s: at least 20 passes. Rate 1× and play for 3 s: 1 or 2 passes (a wall-clock 1 Hz timer would give 3). | same | bounds as stated |

## 6. Acceptance criteria

1. `stars.test.ts` "Polaris" passes: az 0.592°, alt 20.151°, ± 0.01°.
2. `bodies.test.ts` passes for all 8 bodies: great-circle separation < 0.05° against the committed Horizons AIRLESS table, rows with el > 0, at least 30 rows per body.
3. `twilight.test.ts` passes: dusk 2026-10-11T04:24:11Z and dawn 2026-10-10T15:53:03Z within ± 60 s, plus the marker cases.
4. `lens.test.ts` passes: for W = H = 1024 at roll 180°, the N horizon is at map `[512, 1024]` and E at `[0, 512]`, and so on.
5. `public/data/stars.json` has exactly 8,404 rows, brightest first, and HR 424 is "Polaris". The PR quotes the script's summary line with both input sha256s.
6. `sky.spec.ts` passes in CI:
   - the sky recomputes on ≥ 2 s of sim time in either direction and not on 1 s;
   - at 600× it makes at least 20 passes per second of play;
   - the twilight markers seek;
   - the body list matches Horizons-verified positions;
   - the shared fixture records no console errors and no third-party requests.
7. On a local `npm run perf`, `overhead:sky` p95 is ≤ 2 ms at limit 6.5 and 600×. Prototype runs of this step's code in headless Chromium 1248 on an M2 gave a pass p95 of 1.4–1.7 ms at 6.5 (medians: stars and bodies 0.7 ms, projection and writes 0.6 ms) and 0.5–1.1 ms at 4.5. Chromium rounds `performance.now()` to 0.1 ms, so single runs vary by that much.
8. Every toggle and the limit slider work from the keyboard. Twilight markers are reachable with Tab and act on Enter and Space. Both star credits are visible while stars are on.
9. The [definition of done](README.md#definition-of-done) holds.

Evidence in the PR:

- the test names and output for items 1–6;
- a screenshot of the sky view at `?t=2026-10-10T08:00:00Z` at limit 4.5 and at 6.5;
- a 10 s clip at 600× showing the stars turning about the pole with no stepping;
- the `npm run perf` output for item 7;
- the `build-stars.ts` summary line.

## 7. Gotchas

1. **astronomy-engine reads a number as days since J2000, not epoch ms.** `Equator` then throws "Object is too distant…", and `Rotation_EQJ_HOR` silently returns a wrong matrix. TypeScript accepts the number, so pass `astroTimeAt(ms)` or a `Date`. `verification/astronomy-engine.md` #8
2. **Airless arguments differ by function.** `HorizonFromVector`'s `refraction` parameter is a required `string`: pass `""` for airless (`null` fails TS2345). `Horizon`'s is optional: leave it out. `verification/astronomy-engine.md` #9
3. **Never pass catalogue RA/Dec to `Horizon`.** Its `ra` is in sidereal hours, and it expects coordinates of date. Polaris comes out 0.15° off without precession. Stars go through `Rotation_EQJ_HOR`. `verification/astronomy-engine.md` #10
4. **`RotateVector` uses the transposed-looking index order** (`r[0][0]x + r[1][0]y + r[2][0]z`), and the HOR frame is x = north, y = west, z = up, so az = −atan2(y, x). Getting either wrong mirrors the sky. The oracle test catches it. `verification/astronomy-engine.md`, implementation notes
5. **Do not call `RotateVector` or `HorizonFromVector` per star in the app.** Each pass allocates 1.1–2.1 MB. Keep them as the test oracle. `verification/astronomy-engine.md` #4
6. **Refraction:**
   - The Polaris tolerance is 0.01°, not 0.05°: the whole refraction term is 0.045°, so a missing refraction passes at 0.05°. `verification/astronomy-engine.md` #5
   - `'normal'` refraction ignores observer height. At 4,204 m it overstates refraction by about 35% (0.17° at the horizon). JPL Horizons does not scale it either, so the fixtures assume unscaled `'normal'`. Do not "fix" one side only. `verification/astronomy-engine.md` #1
7. **The Horizons table needs care:**
   - It defaults to AIRLESS. Compare it with the airless pipeline, not with `'normal'`, which misses by up to 0.36° near the horizon.
   - Compare by great-circle separation. Raw Δaz near the zenith reached 0.144° at el 89.75° while the true separation was 0.0007°.
   - `verification/astronomy-engine.md` #6
8. **`SearchAltitude` details:**
   - It returns `AstroTime | null`; use `.date`.
   - With a positive `limitDays` it searches forward only; a negative one searches backward.
   - Its altitude is unrefracted. Searching on a refracted altitude moves dusk by +2.6 min, and the ± 60 s test catches that.
   - Pass exactly ±1: 2 behaves like +1, and 0 returns `null` after seconds of work.
   - `verification/astronomy-engine.md` #2, #19
9. **The Moon at new moon still reports magnitude −4.45** (phase fraction 0.002 on 2026-10-10). Hence the "Moon (new)" label rule. `verification/astronomy-engine.md` #16
10. **Stars lag behind a wall-clock timer.** A wall-clock 1 Hz update leaves stars 2.5° behind at 600× and up to 180° wrong for a second after a scrub. The trigger is ≥ 2 s of sim time in either direction. `verification/astronomy-engine.md` #3, `verification/architecture.md` #22
11. **How stars are drawn decides the frame budget.** In headless Chromium 1248 on an Apple M2, with 8,404 stars:
    - one `MultiPoint` per 0.5-magnitude bin, with culled points parked off-frame, costs 5–8 ms per `renderSync()`: 5.1 ms at DPR 1 and 8.0 ms at DPR 2 when idle, 5.9–6.0 ms right after a pass. Parking is safe there only because those bins have no per-index arrays (gotcha 20);
    - the single custom-renderer `MultiPoint` costs 0.7–0.9 ms at either DPR, and 0.1–0.2 ms at limit 4.5;
    - per-feature `Point`s cost 4.5–16 ms per update (Node, `verification/architecture.md` #22).
    - The renderer receives device pixels, so multiply radii by `state.pixelRatio`.
    - OpenLayers allocates one `[x, y]` array per point each time it replays the layer. That is library-internal and accepted.
12. **OpenLayers geometry updates:** `setFlatCoordinates` does not fire a change event, so call `changed()` after it (`ol/geom/SimpleGeometry.js` 157–161). After writing into `getFlatCoordinates()` in place, call `changed()` once per geometry, or the cached extent and replay go stale.
13. **`map.render()` schedules its own animation frame.** Keep M1's `renderSyncAll()` in the clock loop (it runs on frames where the sim time changed), or the sky draws one frame late or at 30 fps. Do not add a per-frame `renderSync()` of your own. `verification/architecture.md` #5
14. **Catalogue parsing:**
    - CDS trims trailing blanks, so pad each line to 197 before slicing.
    - The BSC `Name` field has no proper names.
    - IAU-CSN names contain spaces ("Polaris Australis"), so slice fixed columns instead of splitting on whitespace.
    - `verification/sources.md` #13 and the BSC5 note in its implementation notes.
15. **Float32 azimuths can read 360.0.** `Math.fround(359.99999)` is 360. That is harmless for projection; wrap with `wrap360` before display.
16. **Do not scale the fisheye radius by f before the tail.** Doing so applies f twice. The equidistant closed form equals proj4 `aeqd` to about 1e-15. `verification/proj4-lens.md`
17. **Keys go where focus is.** M1's `keyboard.ts` skips Space on a BUTTON (so Space presses a focused twilight marker) and ignores every key typed into an input (so the clock keys do nothing while the magnitude slider has focus). Tests that press clock keys must first move focus off inputs. (M1 step 7)
18. **The PerformanceObserver needs no buffer.** A measure that is cleared at once is still delivered to an observer: 100 of 100 in a Chromium 1248 check, with 0 left in the buffer. Never rely on `getEntriesByName` in tests.
19. **M0's Biome rules bite this code** (all checked with Biome 2.5.15 and M0's `biome.json`):
    - `noNonNullAssertion` is an error, so `r[0]![0]!` and `pts[i]!` fail `npm run lint`. Use `?? 0` or an `undefined` check, as the snippets here do.
    - `noFocusedTests` flags a bare call to a function named `fit` (Jasmine's focused `it`), even in app code, and its unsafe fix rewrites it to `it()`. Hence `fitSkyFrame`.
    - `useSemanticElements` rejects `<div role="region">`. Use `<section aria-label>`.
20. **A custom renderer sees only the points OpenLayers kept.**
    - For a `MultiPoint`, the canvas builder's `appendFlatPointCoordinates` drops every coordinate outside the rendered extent (`ol/render/canvas/Builder.js` 143–157, called at 376–378). The renderer's `pixelCoordinates` then has fewer entries than the geometry, and `visible[i]` and `radiusPx[i]` belong to a different star.
    - Checked in headless Chromium: five points, with the middle three parked at (−10,000, −10,000), hid the fifth (visible) star. Parked at the frame centre, it drew.
    - M2's view always contains the whole frame, so in-frame coordinates are never dropped. M4's pan and zoom would break that: OpenLayers keeps only the points inside the view extent buffered by the layer's `renderBuffer` (100 px by default). M4 therefore creates the stars layer with `renderBuffer: 1_000_000` (M4 step 11), which keeps every star of the frame at any zoom.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds the continuous pixel convention under "Contract changes from the implementation docs". Append the rest.

- The twilight reference is Skyfield 1.55 + DE421 (to the second). USNO's API (to the minute) is a cross-check only. Reason: USNO rounding would use half of the ± 60 s tolerance.
- The Horizons fixture is one JSON file keyed by `BODY_IDS`, with rows `[isoUtc, azDeg, elDeg]`, 73 per body, and the test needs at least 30 above-horizon rows per body. Reason: an empty or truncated table must not pass vacuously.
- `stars.json` rows are sorted by `vmag`, then HR. Reason: a magnitude limit is then a prefix, and `rotateStarsAzAltDeg`'s `count` skips the rest (904 of 8,404 at the default limit).
- Star names come from the IAU-CSN ASCII column, then the Bayer designation (Greek letter, index digit, constellation), then Flamsteed, else `""` shown as "HR n". Reason: BSC5 has no proper names, and ASCII avoids encoding issues (only 15 rows differ, none with an HR number).
- Stars are drawn as one `MultiPoint` with a custom `Style.renderer` reading per-star visibility and radius from typed arrays. Reason: magnitude bins cost 5–8 ms per render at 8,404 stars, against 0.7–0.9 ms.
- The synthetic sky view has no interactions or controls and refits on resize. Its `View` sets `maxResolution` to max(W, H). Reason: the frame must match the camera image (M4 calibration, and from M5 the video under the map, O1), and OpenLayers' default cap of max(W, H)/256 stops the frame from fitting a container shorter than 256 px. M4 adds pan and zoom for still images.
- Culled stars are written at the frame centre with `visible` 0, never off-frame. Reason: OpenLayers drops off-extent `MultiPoint` coordinates before the custom renderer runs, which shifts the per-star arrays.
- `createCameraModel` throws for anything other than a zenith equidistant fisheye until M4. Reason: M2 has no other camera; a silent fallback would hide a wrong `cameras.json`.
- The grid has altitude circles 0–80° every 10° and azimuth lines every 10° from alt 0° to 80°, sampled every 1° through the camera model. Letters N, E, S and W sit at alt 5°. Reason: the code is lens-independent, and the letters stay inside the frame.
- The star magnitude limit runs from 1 to 6.5 in steps of 0.5. `setStarMagLimit` clamps and ignores non-finite values. Reason: 6.5 is the catalogue's cut.
- Sky passes are measured as `overhead:sky` and cleared at once; tests count them with a `PerformanceObserver`. Reason: user-timing entries would otherwise accumulate at 60 per second.
- `formatUtcHhMm` truncates to the minute (as M7 also specifies), and the marker's local time is `formatZonedDateTime(...).slice(11, 16)`, which truncates too. Reason: the UTC and local labels on a marker must agree.
- `twilightMarkersMs` restarts each search 1 h after a hit. Reason: same-direction crossings are about 24 h apart, and a restart at the hit itself can find it again.
- The sky region carries an "Above the horizon" text list as its text alternative, and is `aria-busy` until the star catalogue is `ready` or `error`. Reason: canvas content is invisible to screen readers; the list and the busy flag double as e2e hooks.
- `skyCache.bodies` starts as NaN. Reason: zeros would read as eight bodies on the horizon at az 0 before the first pass.

O1 changes nothing in M2: M5 places this same map over the player and fits its frame to the video's content box ([Camera kinds](README.md#camera-kinds), [Sky over video](README.md#sky-over-video)). If O3 changes, M2's PR proposes `layers.starMagLimit` and `data.stars` itself.

