# M3 · Satellites

Branch `m3-satellites`, one pull request. Contracts: [README.md](README.md). Decisions: [../DECISIONS.md](../DECISIONS.md). Evidence: `verification/satellite-js.md`, `verification/architecture.md`, `verification/openlayers.md`, `verification/sources.md`. Every number below marked "measured" was run on 2026-10-11 with the pinned packages (satellite.js 7.1.0, astronomy-engine 2.1.19, ol 10.11.0, TypeScript 7.0.2, Vitest 5.0.3, Biome 2.5.15), Skyfield 1.55 + sgp4 2.27, and headless Chromium 156 (`chromium_headless_shell-1248`, native arm64) on an Apple M2. Every TypeScript snippet type-checks with `tsc -b` under the M0 configs and passes Biome's linter; a few long lines are shown unwrapped, so run `npm run format` after pasting.

## 1. Goal

Draw the ISS and CelesTrak's "visual" group (and Starlink on demand) in both views from OMM elements, propagated in a Web Worker on a fixed sim-time grid and interpolated every frame. Selecting or hovering an object in either view highlights it in both on the next frame, fills the Inspector and hover card, and is shareable as `?sel=`. A scheduled job keeps `public/data/gp/` fresh without ever breaking CelesTrak's usage policy.

Out of scope here (milestone in brackets):

- Lens models other than the M2 zenith fisheye, the camera wedge, still images [M4]. Video and stream delay [M5].
- The terrain horizon: M3 uses the geometric horizon, 0° apparent altitude, everywhere a horizon is needed [M6].
- Footprint, `setCamera` and `incoming` handling beyond an empty reply [M8].
- Starlink culling, `BulkPropagator`, and the Starlink frame-budget gate [M9]. M3 loads and draws Starlink on demand and records its numbers only.
- Magnitudes for satellites (no source). Search or a catalogue browser.
- Visual design (marker shapes, colours, sizes, label placement, panel placement). It is settled during the build from screenshots. This doc specifies behaviour, content, states, keyboard and accessibility only.

## 2. Prerequisites

1. M2 merged: the sky map (`createSkyMap`, `SkyMapHandle`, `skyPixelProjection`), `skyCache.ts`, `apparentAltDeg`, `angularSeparationDeg`, `wrap360`/`wrap180`, the "Above the horizon" list in `SkyView.tsx`, and M1's ground map, registry, `url.ts`, `keyboard.ts`, `credits.ts`, `LayerToggles.tsx`.
2. Data: the CelesTrak snapshot from the verification run (step 1). No new download is needed for M3 unless that snapshot is gone.
3. Tools on the developer machine only: `uv` (for the Skyfield fixture, step 4) and network once for `de421.bsp` (17 MB, cached outside the repository).
4. Accounts: none beyond the GitHub repository (Actions with `contents: write`) and the M0 host. CelesTrak has no accounts or keys.
5. Decisions ([DECISIONS](../DECISIONS.md)). O1: M3 draws satellites on the synthetic sky with pixel-space picking. Over a video, M5 limits the sky view to the light set (README [Sky over video](README.md#sky-over-video): the ISS and the other stations and visual satellites, labels only for the ISS and the selected or hovered object, the selected object's trail and next path, Starlink only when switched on for the video). On a YouTube camera M5 also replaces map picking with DOM hit targets that call the same `hover` and `select` actions, so keep picking behind those two actions. O2: no effect. O3 is open: M3 uses `selection`, `layers.satellites/starlink/trails` and `data.gp`; if O3 changes, propose them in this PR. O4: `fetch-gp.yml` reads `.nvmrc` (`26`).

## 3. Deliverables

| Path | Change |
| ---- | ------ |
| `tests/fixtures/gp/stations.json`, `visual.json`, `starlink.json`, `meta.json` | New. The verification snapshot (step 1). |
| `public/data/gp/*.json` | New. Seeded with the same four files; `fetch-gp.yml` refreshes them afterwards. |
| `scripts/fixtures/iss-pass-skyfield.py` | New. Skyfield reference passes (step 4). |
| `tests/fixtures/iss-pass-maunakea.json` | New, generated (7,769 bytes). |
| `scripts/fetch-gp.ts` | New. CelesTrak download with the 2 h stamp (step 8). |
| `.github/workflows/fetch-gp.yml` | New. Cron every 6 h + manual (step 9). |
| `src/domain/time/index.ts` | Add `parseOmmEpochMs`, `sampleStepMs`, `BASE_SAMPLE_STEP_MS`, `TRACK_STEP_MS`, and `floorToStepMs` unless M7 landed first and added it. |
| `src/domain/geo/index.ts` | Add the ECEF/ENU functions, `ecefToLatLonDeg`, unwrapping (step 2). |
| `src/domain/orbits/omm.ts`, `sample.ts`, `interpolate.ts`, `visibility.ts`, `tracks.ts`, `index.ts` | New, per [section 6](README.md#6-domain-module-apis), plus `ISS_NORAD_ID`. |
| `src/workers/protocol.ts` | New: README section 5, verbatim. |
| `src/workers/propagation.worker.ts` | New (step 10). |
| `src/state/sampleClient.ts` | New: sample pool and grid logic without the `Worker` (step 11). |
| `src/state/ephemeris.ts` | New: worker client, catalog, per-frame arrays, tracks, sky paths (step 11). |
| `src/state/objectId.ts` | New: `parseObjectId`, `noradIdOf`. |
| `src/state/actions.ts`, `selectors.ts`, `clockLoop.ts` | `select`, `hover`, `setFollow`, `setGroupData`; `selectGroupStatus`, `selectSampleStepMs`, `selectGroupMask`; `frameCount()`. |
| `src/app/url.ts`, `keyboard.ts`, `credits.ts`, `App.tsx`; `src/main.tsx` | `?sel=`, Esc, CelesTrak credit, the Inspector in the shell; `startEphemeris` and test hooks at boot. |
| `src/app/testHooks.ts` | New: read-only hooks for Playwright. |
| `src/map/pick.ts`, `src/map/classPoints.ts` | New: pixel-space picking and class-point writes. |
| `src/map/sky/layers/satellites.ts`, `selection.ts`; `src/map/sky/createSkyMap.ts` | Satellites, trails, paths, selection marker and labels; picking and hover. |
| `src/map/ground/layers/satellites.ts`, `tracks.ts`; `src/map/ground/createGroundMap.ts` | WebGL class points, canvas markers, ground tracks; picking and hover. |
| `src/map/sync/bindSelection.ts`, `bindFollow.ts`, `bindTracks.ts` | New. |
| `src/ui/Inspector.tsx`, `HoverCard.tsx`; `SkyView.tsx`, `LayerToggles.tsx` | New panels; the satellite list in the sky region; three toggles. |
| `tests/unit/*.test.ts`, `tests/e2e/selection.spec.ts`, `tests/e2e/fixtures.ts`, `tests/perf/propagation.perf.ts` | Section 5. |
| `tests/unit/store.test.ts` (M0) | "every later action throws": drop `select`, `hover`, `setFollow` and `setGroupData` from the list and lower the expected count by 4 (22 remain) |
| `docs/DECISIONS.md`, `README.md` | Section 8 entries; the root README's M3 section. |

## 4. Steps

Tests first for every formula ([working agreement](README.md#working-agreement)). Units follow [Units](README.md#units): km for orbits, ECEF and ENU; degrees in every public API; epoch ms for time.

### Step 1. CelesTrak snapshot and seed data

1. The verification download is already committed at `tests/fixtures/gp/{stations,visual,starlink}.json` (saved 2026-10-11). Check the sha256s before using it: stations `648b069c3cc87606f670886699e5b8159d1518d3e505579783016d2831c07fb6`, visual `1649b851ccc5f0adcd8431f3b642ef5d91abd480cb8cc6cc727e6f44a96796e9`, starlink `9b411b5ca47fe267dd75571a8d646f6d58c04f1bc0264bad4d36ec6ca4556928`.
2. `tests/fixtures/gp/meta.json` already holds the matching `GpMeta`: each group `{ "fetchedAtMs": 1791690621000, "count": <records>, "sha256": <above> }`, counts 22, 156 and 11,102. `1791690621000` is 2026-10-11T03:50:21Z.
3. If the snapshot files are missing or their hashes differ, run `GP_CONTACT_URL=<repo URL> npx tsx scripts/fetch-gp.ts --out tests/fixtures/gp` once (after step 8). Then every snapshot-specific number in this doc (counts, docked pairs, stale ids, the e2e list in section 5) must be recomputed and updated in the same PR, and the ISS fixture regenerated.
4. Copy the four files into `public/data/gp/` too, so the first deploy has data before the first scheduled run.

### Step 2. Geo additions (`src/domain/geo/index.ts`)

Implement the remaining M3 functions of the [geo API](README.md#6-domain-module-apis): `enuToEcefMatrix` (row-major, columns E, N, U), `enuToEcef` (M·v), `ecefToEnu` (Mᵀ·v), `geodeticToEcefKm` (WGS-84, the same formula as satellite.js `geodeticToEcf`), `azAltToEnuUnit`, `enuToAzAltDeg` (az = atan2(E, N) in [0, 360)), `ecefToLatLonDeg`, `unwrapLonDeg`, `unwrapLonLatPairsInPlace`.

1. `ecefToLatLonDeg` is one-step Bowring with a = 6378.137, b = 6356.7523142, e² = 2f − f², e′² = (a² − b²)/b²: p = hypot(x, y), θ = atan2(z·a, p·b), lat = atan2(z + e′²·b·sin³θ, p − e²·a·cos³θ), lon = atan2(y, x). Never `eciToGeodetic` in a per-tick or per-frame path (gotcha 1).
2. `unwrapLonDeg(prev, lon) = lon + 360·round((prev − lon)/360)`. `unwrapLonLatPairsInPlace` first wraps pair 0 into [−180, 180), then unwraps each following longitude against the previous one.
3. Tests (`geo.test.ts`): Bowring against `eciToGeodetic` for all 11,280 snapshot records at 2026-10-11T03:50:21Z, max |Δlat| < 1e-6° (measured 9.7e-8°) and |Δlon| < 1e-9° (measured 8.5e-14°); `enuToEcef(ecefToEnu(v))` = v within 1e-9 km for 1,000 seeded vectors up to 10,000 km (measured 3.6e-12 km); `unwrapLonDeg(179.949, −179.962)` = 180.038 ± 1e-9; pairs (190, −170, 170) unwrap to (−170, −170, −190).

### Step 3. OMM handling (`src/domain/orbits/omm.ts`)

1. Type files as `OMMJsonObject[]` from satellite.js (gotcha 4). `parseGpFile(json: unknown)` throws on a non-array and on any record that is not a usable OMM. Write it as a type guard `isOmm(v: unknown): v is OMMJsonObject`: `OBJECT_NAME`, `OBJECT_ID` and `EPOCH` are strings; `parseOmmEpochMs(EPOCH)` is finite; `NORAD_CAT_ID` is a positive integer (number or numeric string; never assume 5 digits); `MEAN_MOTION`, `ECCENTRICITY`, `INCLINATION`, `RA_OF_ASC_NODE`, `ARG_OF_PERICENTER`, `MEAN_ANOMALY`, `BSTAR`, `MEAN_MOTION_DOT`, `MEAN_MOTION_DDOT` and `ELEMENT_SET_NO` are finite numbers or numeric strings; `EPHEMERIS_TYPE` is absent, `0` or `"0"`; `CLASSIFICATION_TYPE` is absent, `"U"` or `"C"`; the optional header fields that `OMMJsonObject` restricts (`CCSDS_OMM_VERS` starting `"3."`, `CENTER_NAME` `"EARTH"`, `REF_FRAME` `"TEME"`, `TIME_SYSTEM` `"UTC"`, `MEAN_ELEMENT_THEORY` `"SGP4"`) are absent or hold those values (CelesTrak omits them). `[]` is valid here; `fetch-gp.ts` rejects it.
2. `appendGroup(seen, group, omms)`:
   1. Drop records whose NORAD id is already in `seen` (across groups and within one), else add it. Load order is stations, visual, starlink, so the ISS stays in `stations`.
   2. Docking, within the new records of this group. A pair is docked when its near-identical elements put the two objects within 1 km of each other at the later of the two epochs and again 45 min later. Find candidates without an O(n²) loop: compute each record's mean argument of latitude u = ω + M + 360·n·(t_ref − epoch)/1 day at t_ref = the group's newest epoch, sort by u (mod 360), and sweep a 0.05° window, wrapping past 360°. Keep a candidate pair only if |Δn| ≤ 0.001 rev/day, |Δi| ≤ 0.05° and |ΔΩ| ≤ 0.05° (ΔΩ and Δu taken across 0°/360°); then confirm with `json2satrec` + `propagate`. Join confirmed pairs with union-find. The host of a cluster is its lowest NORAD id; every other member gets `dockedWith = host`.
   3. Return one `CatalogEntry` per kept record, in file order, with `epochMs = parseOmmEpochMs(EPOCH)`.
3. `elementAgeDays(epochMs, timeMs) = (timeMs − epochMs)/86,400,000`. Stale means `|age| > STALE_ELEMENTS_DAYS` (7), relative to sim time.
4. Export `ISS_NORAD_ID = 25544`.
5. Measured on the snapshot: stations 22 entries with 10 docked (`36086, 49044, 68837, 100057, 100712, 100882 → 25544`; `53239, 54216, 69049, 69180 → 48274`), so 12 are drawn; visual 153 new entries (25544, 48274 and 66515 are already in stations), 0 docked; starlink 11,102, 0 docked; 11,277 unique ids. CREW DRAGON 13 (100882) has its own element set but stays within 0.611 km of the ISS over 24 h, which is why the rule is positional (gotcha 13). All three `appendGroup` calls together took 17–21 ms on the first run and 10–20 ms on later runs in Node 26.11.1 arm64 (seven runs per process, repeated in several processes); at fetch time 2 Starlink records are stale (48408 at 19.92 days, 58885 at 8.40 days).

### Step 4. ISS reference fixture (`scripts/fixtures/iss-pass-skyfield.py`)

Run by hand from the repository root, after step 1:

```sh
uv run --with skyfield==1.55 --with sgp4==2.27 python scripts/fixtures/iss-pass-skyfield.py
```

It prints `3 passes, 93 samples, 31 shadow transitions -> <absolute path of the fixture>`, and two runs give byte-identical output. What it does:

1. Reads ISS 25544 from `tests/fixtures/gp/stations.json` and the start time from `meta.json` `stations.fetchedAtMs`. Observer 19.8253°, −155.4689°, 4,204 m (the Polaris site). Window: 24 h from the start.
2. Finds rise, culmination and set above 10° with `find_events`, samples each pass on the absolute 10 s grid, and writes `[timeMs, azDeg, altDeg, rangeKm, subLatDeg, subLonDeg, sunlit]` rows. Altitudes are geometric (no refraction).
3. Scans `is_sunlit` over the whole window at 1 s and writes `[firstMsOfNewState, newState]` for each flip.
4. The JSON also carries `generator`, `skyfield`, `sgp4`, `ephemeris`, `noradId`, `ommEpoch`, `site`, `startMs`, `endMs`, `minAltDeg`, `stepSec`, `columns` and `passes` (`riseMs`, `culminationMs`, `setMs`, `maxAltDeg`).

The core calls (excerpt of the verified script):

```python
from skyfield.api import EarthSatellite, Loader, wgs84

load = Loader(str(Path.home() / ".cache" / "skyfield"))  # keeps de421.bsp (17 MB) out of the repository
ts = load.timescale()
eph = load("de421.bsp")
sat = EarthSatellite.from_omm(ts, omm)
site = wgs84.latlon(LAT_DEG, LON_DEG, elevation_m=HEIGHT_M)
times, events = sat.find_events(site, t0, t1, altitude_degrees=MIN_ALT_DEG)  # 0 rise, 1 culmination, 2 set
# per pass, t = ts.from_datetimes([...]) on the absolute 10 s grid:
alt, az, dist = (sat - site).at(t).altaz()  # geometric: no refraction
geo = sat.at(t)
sub = wgs84.subpoint_of(geo)
lit = geo.is_sunlit(eph)
```

Passes in the committed fixture: 2026-10-11 15:06:50–15:12:44Z (max 28.84°), 16:45:01–16:48:10Z (12.67°), 2026-10-12 00:57:45–01:04:11Z (44.83°). The first shadow entry is 05:18:57Z, matching `verification/satellite-js.md` #16.

### Step 5. Samples (`src/domain/orbits/sample.ts`)

`createPropagationContext(timeMs, site)` builds once per sample: `date`, `gmstRad = gstime(date)`, `sunEciAu = sunPos(jday(date)).rsun`, `observerEcefKm` (`geodeticToEcefKm` with `heightM`), `enuToEcef` (`m` below, from `enuToEcefMatrix`), and `sunAltDeg` (`R2D = 180 / Math.PI`). The Sun's altitude must be geometric (the twilight convention) and needs the AU vector scaled to km before the observer is subtracted:

```ts
const KM_PER_AU = 149_597_870.7;
// Sun geometric altitude: AU -> km, rotate ECI -> ECEF by GMST, subtract the observer, project on Up.
const c = Math.cos(gmstRad);
const s = Math.sin(gmstRad);
const sx = sunEciAu.x * KM_PER_AU;
const sy = sunEciAu.y * KM_PER_AU;
const dx = sx * c + sy * s - (observerEcefKm[0] ?? 0);
const dy = -sx * s + sy * c - (observerEcefKm[1] ?? 0);
const dz = sunEciAu.z * KM_PER_AU - (observerEcefKm[2] ?? 0);
const e = (m[0] ?? 0) * dx + (m[3] ?? 0) * dy + (m[6] ?? 0) * dz;
const n = (m[1] ?? 0) * dx + (m[4] ?? 0) * dy + (m[7] ?? 0) * dz;
const u = (m[2] ?? 0) * dx + (m[5] ?? 0) * dy + (m[8] ?? 0) * dz;
const sunAltDeg = Math.atan2(u, Math.hypot(e, n)) * R2D;
```

`writeSample` writes the packed layout of `SampleField`. The velocity must be Earth-fixed, or Hermite is worse than linear (gotcha 9):

```ts
export function writeSample(satrec: SatRec, ctx: PropagationContext, out: Float32Array, index: number): boolean {
  const o = index * SAMPLE_STRIDE;
  const pv = propagate(satrec, ctx.date);
  if (pv === null) {
    out.fill(0, o, o + SAMPLE_STRIDE); // valid = 0
    return false;
  }
  const { position: r, velocity: v } = pv;
  const c = Math.cos(ctx.gmstRad);
  const s = Math.sin(ctx.gmstRad);
  // ECI (TEME) -> ECEF: rotate about z by GMST (the same rotation as eciToEcf).
  const rx = r.x * c + r.y * s;
  const ry = -r.x * s + r.y * c;
  const rz = r.z;
  // Earth-fixed velocity: rotate, then subtract omega x r (omega along +z).
  const vx = v.x * c + v.y * s + EARTH_ROTATION_RAD_S * ry;
  const vy = -v.x * s + v.y * c - EARTH_ROTATION_RAD_S * rx;
  const vz = v.z;
  const m = ctx.enuToEcef;
  const O = ctx.observerEcefKm;
  const dx = rx - (O[0] ?? 0);
  const dy = ry - (O[1] ?? 0);
  const dz = rz - (O[2] ?? 0);
  const m0 = m[0] ?? 0, m1 = m[1] ?? 0, m2 = m[2] ?? 0;
  const m3 = m[3] ?? 0, m4 = m[4] ?? 0, m5 = m[5] ?? 0;
  const m6 = m[6] ?? 0, m7 = m[7] ?? 0, m8 = m[8] ?? 0;
  out[o] = m0 * dx + m3 * dy + m6 * dz; // E = M^T d
  out[o + 1] = m1 * dx + m4 * dy + m7 * dz;
  out[o + 2] = m2 * dx + m5 * dy + m8 * dz;
  out[o + 3] = m0 * vx + m3 * vy + m6 * vz;
  out[o + 4] = m1 * vx + m4 * vy + m7 * vz;
  out[o + 5] = m2 * vx + m5 * vy + m8 * vz;
  out[o + 6] = shadowFraction(ctx.sunEciAu, r) < 0.5 ? 1 : 0; // Sun (AU) first, satellite (km) second
  out[o + 7] = 1;
  return true;
}
```

Edge cases: `propagate` returns `null` (decayed or bad elements) → `valid = 0`, and the worker logs `console.warn` once per object with the NORAD id and `satrec.error`. A synthetic set with `BSTAR` 0.05 and `MEAN_MOTION_DOT` 0.1 at 2027-01-01 gives `null` with `satrec.error === 1` (measured), which is the unit-test case.

### Step 6. Interpolation and visibility

1. `interpModeForRate(rate)`: `"hermite"` at 600, else `"linear"`.
2. `interpolateEnuKm(a, tA, b, tB, index, t, mode, out, offset)` returns false unless both samples have `valid = 1`. It clamps s = (t − tA)/(tB − tA) to [0, 1] (hold, never extrapolate); with `b === a` it returns `a`'s position. Hermite works in seconds because velocities are km/s:

```ts
// Cubic Hermite: positions in km, velocities in km/s, so scale the tangents by the span in seconds.
const hSec = span / 1000;
const s2 = s * s;
const s3 = s2 * s;
const h00 = 2 * s3 - 3 * s2 + 1;
const h10 = s3 - 2 * s2 + s;
const h01 = -2 * s3 + 3 * s2;
const h11 = s3 - s2;
for (let k = 0; k < 3; k++) {
  out[offset + k] =
    h00 * (a[o + k] ?? 0) +
    h10 * hSec * (a[o + 3 + k] ?? 0) +
    h01 * (b[o + k] ?? 0) +
    h11 * hSec * (b[o + 3 + k] ?? 0);
}
```

3. `sunlitAt` takes the flag from the sample nearer in time. Take `sunAltDeg` the same way.
4. `SUN_CUTOFF_DEG = { stations: −6, visual: −6, starlink: −12 }`. `isVisible(sunlit, sunAltDeg, group, apparentAltDeg, horizonDeg) = sunlit && sunAltDeg ≤ cutoff && apparentAltDeg > horizonDeg`. In M3 `horizonDeg` is always 0; M6 swaps in `horizonAltAtAzDeg`.
5. Measured interpolation error (great-circle, ISS, alt > 10°, Float32 samples, 10 points per interval):

| Rate (D) | Linear, 44.8° pass | Linear, zenith pass | Hermite, zenith | Hermite without −ω×r, zenith |
| -------- | ------------------ | ------------------- | --------------- | ---------------------------- |
| 1× (0.1 s) | 2.6e-5° | 3.3e-5° | 3.4e-5° | 6.0e-4° |
| 10× (1 s) | 7.1e-5° | 7.8e-5° | 3.5e-5° | 6.0e-3° |
| 60× (6 s) | 0.0023° | 0.0024° | 3.6e-5° | 0.036° |
| 600× (60 s) | 0.229° | 0.219° | 4.1e-5° | 0.354° |

### Step 7. Ground tracks (`tracks.ts`)

`trackLonLatDeg(satrec, centerMs, halfSpanMs, out)` snaps the centre down to the 20 s grid and writes points from c − half to c + half: 61 points for ±10 min, 19 for ±3 min, identical for any centre in the same 20 s slot. Per point: `propagate`, rotate by `gstime`, `ecefToLatLonDeg`, then unwrap against the previous point (the first is wrapped into [−180, 180)). It stops at the first `null` and returns the count. The ISS moves at most 1.996° of longitude per 20 s (measured over 24 h), so a ±10 min track stays within ±300° and inside the canvas renderer's ±540°.

### Step 8. `scripts/fetch-gp.ts`

Exports `MIN_REFETCH_MS` (2 h), `shouldFetch(meta, group, nowMs)`, `gpUrl(group, baseUrl?)` and `fetchGp(options)` (with `outDir`, `nowMs`, `userAgent`, optional `baseUrl`, `fetchImpl`, `log`), so unit tests inject a fake `fetch` (the unit-test `setup.ts` blocks the real one). The CLI part runs only when the file is the entry point (`import.meta.url === pathToFileURL(process.argv[1] ?? "").href`; without `?? ""` it fails TS2345 under `noUncheckedIndexedAccess`). This check holds under `npx tsx scripts/fetch-gp.ts` (verified: the CLI ran and exited 2 without `GP_CONTACT_URL`).

1. Read `<out>/meta.json`. Missing means first run. Corrupt JSON throws before any request.
2. For each of `GP_GROUPS` in order: skip when the stamp is under 2 h old. Otherwise request `https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=json`, sequentially:

```ts
const res = await doFetch(url, {
  headers: { "User-Agent": o.userAgent, Accept: "application/json" },
  redirect: "manual", // a 301 is an error to CelesTrak too: stop, do not follow
  signal: AbortSignal.timeout(60_000),
});
body = await res.text();
if (res.status !== 200) {
  result.error = `${group}: HTTP ${res.status} ${body.slice(0, 500)}`;
  break; // stop on any non-200, including 403 "not updated since your last download"
}
```

3. A 200 whose body is not a non-empty `parseGpFile` array (CelesTrak's "No GP data found" text, an HTML page) is also an error and stops the run.
4. On success: sha256 of the exact body. Rewrite `<group>.json` only when the hash differs. Always set `meta[group] = { fetchedAtMs: now, count: records, sha256 }`.
5. After the loop, write `meta.json` if any group succeeded, so groups fetched before a stop are kept.
6. CLI: `--out <dir>` (default `public/data/gp`). It requires `GP_CONTACT_URL` (the repository URL) and sends `User-Agent: overhead-fetch-gp/1.0 (+<GP_CONTACT_URL>)`; without it, it exits 2 before any request. Exit 1 after a stop, printing `Stopped: <error>`. Never retry, never loop. Never put a personal email address in the User-Agent.

Measured against a local server: with stations 200 and visual 301, it made exactly 2 requests, wrote `stations.json` and `meta.json`, and reported `visual: HTTP 301 moved`; with visual 403 it also stopped after 2 requests and `meta.json` held only stations (count 22). The User-Agent arrived as sent. Node's `fetch` returns the real 301 status with `redirect: "manual"` (a browser would return status 0).

### Step 9. `.github/workflows/fetch-gp.yml`

Passes actionlint 1.7.12. The commit step was exercised in a scratch repository: it commits only changed files under `public/data/gp/` and exits 0 when nothing changed.

```yaml
name: fetch-gp

on:
  schedule:
    - cron: "0 */6 * * *" # 4 runs a day; CelesTrak's source data changes 2–3 times a day
  workflow_dispatch:

permissions:
  contents: write
  actions: write # gh workflow run deploy.yml after a data push (M0 step 15)

concurrency:
  group: fetch-gp
  cancel-in-progress: false

jobs:
  fetch:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: Fetch GP data (stops at the first non-200, never retries)
        run: npx tsx scripts/fetch-gp.ts --out public/data/gp
        env:
          GP_CONTACT_URL: ${{ github.server_url }}/${{ github.repository }}
      - name: Commit changed files, then deploy them
        if: ${{ !cancelled() }} # also after a stop, so groups fetched before it are kept
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data/gp
          if git diff --cached --quiet; then
            echo "No changes to commit"
            exit 0
          fi
          git commit -m "data: refresh CelesTrak GP $(date -u +%Y-%m-%dT%H:%MZ)"
          git push
          gh workflow run deploy.yml --ref main
```

A push made with `GITHUB_TOKEN` starts no workflow, so the step dispatches `deploy.yml` itself; `workflow_dispatch` runs always start, and the dispatched run builds the newest commit on `main`, which is the data commit (M0 step 15, rule 1). Without that line data commits never reach production. A stop fails the job (red run, e-mail) and still commits what succeeded. The stamp in `meta.json` changes on every successful fetch, so expect one small data commit per run that fetched anything. Run it once with `workflow_dispatch` before merging and link the run in the PR (gotcha 6 explains why the push may be rejected).

### Step 10. Worker (`src/workers/protocol.ts`, `propagation.worker.ts`)

1. `protocol.ts` is README section 5 verbatim, including `skyPaths` and `SKY_PATH_STEP_MS`. The worker handles `arc` from M4 and `setHorizonProfile` from M8.
2. The worker owns `site`, the `seen` set, `satrecs: SatRec[]`, `groupIndex: Uint8Array` and `skip: Uint8Array` (1 = docked). Type outgoing messages with one helper and register with `addEventListener` (Biome rejects `onmessage = …` as `noGlobalAssign`):

```ts
const post = (msg: PropagationOut, transfer: Transferable[] = []): void =>
  postMessage(msg, transfer);
let loads: Promise<void> = Promise.resolve(); // loadGroup runs strictly in arrival order
addEventListener("message", (e: MessageEvent<PropagationIn>): void => {
  const msg = e.data;
  switch (msg.type) {
    case "loadGroup":
      loads = loads.then(() => loadGroup(msg.group, msg.url));
      break;
    // … init/setSite, sample, tracks, skyPaths, setCamera, incoming
  }
});
```

3. `loadGroup`: `url` is absolute (gotcha 15). Fetch `meta.json` once, from `new URL("meta.json", url)`, then the group file; `parseGpFile`, `appendGroup`, `json2satrec` per entry; reply `groupLoaded` with the `CatalogDelta` (transfer its typed arrays) and `fetchedAtMs` from meta (null if absent). Any failure replies `groupError`. `loadGroup` catches every error itself and never rejects: a rejected `loads` promise would silently skip every later `loadGroup` (`.then` callbacks do not run on a rejected promise).
4. `sample`: `new Float32Array(msg.buffer)`; one `createPropagationContext(k × stepMs, site)`; for i < min(satrecs, buffer length / 8): zero the slot when `skip[i]` is 1 or the object's group bit is not in `msg.groups`, else `writeSample`. `computeMs` is `performance.now()` around the loop. Reply with the same buffer, transferred. `timeMs = k × stepMs` stays a plain number.
5. `tracks`: per README "tracks and incoming". A full rebuild at the cap (1 × 61 + 100 × 19 points) took 1.2–1.3 ms median, 1.4–1.6 ms p95 in a Chromium worker (measured), so the worker rebuilds every requested track on every request and keeps no per-satellite cache (README section 5).
6. `skyPaths`: for each index, ENU at every multiple of 2,000 ms in [fromMs, toMs], stopping at the first failed propagation. One `createPropagationContext` per time step, shared by all indices.
7. `setCamera` stores nothing yet; `incoming` replies with `entries: []` (M8).
8. The main thread creates it with `new Worker(new URL("../workers/propagation.worker.ts", import.meta.url), { type: "module" })`. `vite build` emits a 28 KB worker chunk (satellite.js without its WASM), with `worker: { format: "es" }` from M0.

### Step 11. Ephemeris client (`src/state/sampleClient.ts`, `src/state/ephemeris.ts`)

`SampleClient` holds the README [sample lifecycle](README.md#propagation-sample-lifecycle) without a `Worker`, so Node tests can drive it. `resize(totalCount)` makes a pool of 3 buffers and flushes; `flush()` bumps `generation`, returns held buffers to the pool and clears the in-flight set; `onSample(reply)` recycles stale replies (wrong generation: back to the pool without touching the in-flight set; a size from before a resize: dropped) and holds current ones sorted by k, removing k from the in-flight set. Without the clear, a flush with requests outstanding (a mask or site change, 60 ms worker latency, 60×) gave 12 held frames instead of 2 in the same simulation. The per-frame step, as run:

```ts
frame(renderMs: number, stepMs: number, groups: GroupMask): SamplePair | null {
  if (stepMs !== this.stepMs || groups !== this.groups) {
    this.stepMs = stepMs;
    this.groups = groups;
    this.flush();
  }
  const k = Math.floor(renderMs / stepMs);
  const first = this.held[0];
  // Flush when the render time leaves [t_first, t_first + 2D] (seek, step, Now, a long stall).
  if (first !== undefined && (renderMs < first.timeMs || renderMs > first.timeMs + 2 * stepMs))
    this.flush();
  // Release samples older than k: their buffers go to the next requests.
  while (this.held.length > 1 && (this.held[0]?.k ?? k) < k && (this.held[1]?.k ?? k + 1) <= k) {
    const old = this.held.shift();
    if (old !== undefined) this.pool.push(old.data.buffer);
  }
  // Keep k, k+1 and k+2 held or in flight, as far as the pool allows; never allocate here.
  for (let j = k; j <= k + 2; j++) {
    if (this.inFlight.has(j) || this.heldAt(j) !== null) continue;
    const buffer = this.pool.pop();
    if (buffer === undefined) break;
    this.inFlight.add(j);
    this.post({ type: "sample", generation: this.generation, k: j, stepMs, groups, buffer }, [buffer]);
  }
  let a: HeldSample | null = null; // newest held sample at or before k
  for (const h of this.held) if (h.k <= k) a = h;
  if (a === null) return null;
  return { a, b: this.heldAt(a.k + 1) ?? a }; // b === a: the next sample is late, hold
}
```

`HeldSample.data` is typed `Float32Array<ArrayBuffer>` so `data.buffer` goes back into the pool without a cast (gotcha 18). Simulated at 60 fps for 10 s with 20 ms worker latency: 0 holds and 0 empty frames at 1×, 10×, 60× and 600×, exactly 3 buffers ever allocated; it recovers after a 1 h seek (2 empty frames, then none); with 150 ms latency it holds instead of extrapolating.

`ephemeris.ts` (API in [README section 6](README.md#state-app-and-map-modules)):

1. `startEphemeris(store)` (called once in `main.tsx`): creates the worker and subscribes to `selectSite` with `fireImmediately`. `selectSite` is `null` until `cameras.json` has loaded, so wait for the first non-null site: then send `init` with it, then `loadGroup` for stations and visual (setting each group `loading`) with absolute URLs (`` new URL(`${import.meta.env.BASE_URL}data/gp/${group}.json`, location.href).href ``, type-checked). Later site changes send `setSite` and `flush`. It also subscribes to `layers.starlink` (the first `true` sends `loadGroup("starlink")` and sets `setGroupData("starlink", { status: "loading" })`). On `groupLoaded`: append the catalog, `resize(totalCount)`, `setGroupData(group, { status: "ready", fetchedAtMs, count: entries not docked })`. On `groupError`: `setGroupData(group, { status: "error" })` and `console.warn`; no retry loop (Starlink is retried only when its toggle is turned on again; stations and visual wait for a reload).
2. `updateEphemerisFrame(simTimeMs)` is registered with `registerFrameUpdater` at boot and also called first by every satellite layer updater; it computes once per `frameCount()`. Each frame: `pair = client.frame(simTimeMs, selectSampleStepMs(state), selectGroupMask(state))`. For each index, with the mode from `interpModeForRate` (rate 1 in live mode): `interpolateEnuKm` → `enuToAzAltDeg` → `apparentAltDeg` (only for valid objects: gotcha 17) → `rangeKm = |ENU|` → `sunlitAt` → `ECEF = O + M·ENU` → `ecefToLatLonDeg` → `[lon, lat]` into a reused `number[]`, converted in place with `fromEPSG4326(buf, buf)` from `ol/proj/epsg3857`. Flags: valid, sunlit, above the horizon (apparent alt > 0), visible (`isVisible`). When `simTimeMs`, the pair and the mask are unchanged, skip the loop. The first frame in which `client.frame` returns a pair sets the test hooks' `readyFrame` to `frameCount()`.
3. Measured main-thread cost of that loop (interpolate, az/alt, refraction, ECEF, Bowring, EPSG:3857), run over every record without dedupe: 178 records p95 0.1 ms; 11,280 records p50 2.2 ms, p95 2.4 ms per frame in Chromium.
4. `requestTracks` and `requestSkyPaths` post `tracks`/`skyPaths` with a fresh `requestId`; replies with an older `requestId` (or, for sky paths, an older `generation`) are ignored. Results land in `ephemeris.tracks` and `ephemeris.skyPaths`, and `ephemeris.pathsVersion` is incremented so layers redraw only on change.
5. `indexOfObjectId(id)` maps `sat:<n>` to its index; a docked id maps to its host's index.

### Step 12. Store, URL and keyboard

1. Actions per the [actions table](README.md#actions): `select(id)` (null also clears `follow`), `hover(id)` (no change when equal), `setFollow(on)`, `setGroupData(group, patch)`.
2. Selectors: `selectGroupStatus` and `selectSampleStepMs` as written in the README; `selectGroupMask(s) = 0b011 | (s.layers.starlink ? 0b100 : 0)` (README selectors). Stations and visual are always propagated, so the Inspector stays live while `layers.satellites` is off.
3. `src/state/objectId.ts`: `parseObjectId(raw)` accepts `sat:<1–9 digits, no leading 0>`, `planet:<PlanetName>` (exact case), `star:<1–9110>`, `moon`, `sun`, else null; `noradIdOf(id)` gives the number for `sat:` ids.
4. `url.ts`: `UrlState` gains `sel: ObjectId | null`. `main.tsx` calls `select(url.sel)` before the first render and `console.warn`s an invalid value. `writeUrlState` appends `&sel=<id>` with the colon raw, like M1's `t` (`URLSearchParams.toString()` would write `sat%3A25544`; `parseUrlState` reads both). M1's `startUrlSync` adds `selection.selectedId` to the tuple it subscribes to, so the URL follows the selection after its 250 ms debounce.
5. `keyboard.ts`: Esc → `select(null)`, ignored for inputs like the other keys.
6. `clockLoop.ts`: export `frameCount()`, incremented at the start of each frame callback.

### Step 13. Sky view (`src/map/sky`)

1. Layer order, bottom to top: grid, stars, bodies (M2), trails, satellites, starlink, selection. `bindLayerVisible`: `satellites`, `starlink`, `trails`.
2. `layers/satellites.ts`: canvas `VectorLayer`s, each over a `VectorSource` with `useSpatialIndex: false` (a source option, as in M2's grid layer), one `MultiPoint` feature per group and class as on the ground map (stations lit/shadowed and visual lit/shadowed in the satellites layer; starlink lit/shadowed in the starlink layer). Lit and shadowed differ in shape ([Accessibility](README.md#accessibility)). Per frame, for each object of the layer's groups that is valid, not docked, apparent alt > 0 and `projectAzAltDeg` succeeds: write `toSkyMapCoord` into a reused `number[]` per class, then `writeClassPoints` (step 14). The ISS, the selected and the hovered objects are left out of the classes; `selection.ts` draws them, keeping the lit/shadowed shape difference. Keep the projected `[x, y]` of every index in a reused `Float64Array` plus a `skip` `Uint8Array` for picking.
3. Trails (`layers.trails`): a `MultiLineString` of each tracked satellite's path over the last 30 s of sim time, ending at its current interpolated position. Tracked: every drawn stations/visual satellite, plus the selected satellite, capped at 100. While `prefers-reduced-motion: reduce` matches, trails are not drawn and the toggle shows "(off: reduced motion)".
4. The selected satellite's next 2 minutes: a dotted `LineString` from its current position. It belongs to `selection.ts` and shows whenever a satellite is selected.
5. Both come from `requestSkyPaths(fromMs, toMs, indices)` with `fromMs = t − 30 s − 2D` and `toMs = t + 120 s + 2D` (D = sample step). Request when the tracked set changes, the selection changes, or `floor(t / 2000)` changes; at most 10 per second. Each path point goes ENU → `enuToAzAltDeg` → `apparentAltDeg` → `projectAzAltDeg`; split the line where a point is culled.
6. `layers/selection.ts`: `Point` features with text labels for the ISS (always, when drawn), the hovered object and the selected object (marked distinctly from hover; the design decides how). Selected and hovered may be a satellite, star, planet, the Sun or the Moon. Labels: satellite `OBJECT_NAME`, star name or `HR n`, body `bodyLabel`. The layer gets the ids through `bindSelection` (README [binding rules](README.md#binding-rules)) and repositions its points in its frame updater; the clock loop's `renderSyncAll()` draws them in the next frame, playing or paused. On `postrender`, call `recordHighlight("sky", selectedId)` (test hooks).
7. Picking: `map.on("pointermove")` (skip `e.dragging`) → `hover(pickSky(e.pixel))`; `map.on("click")` → `select(pickSky(e.pixel))`, where a miss selects null. A `pointerleave` on the viewport → `hover(null)`. `pickSky` turns the pixel into a map coordinate with `map.getCoordinateFromPixel`, then runs `pickNearest` (`src/map/pick.ts`) with radius `PICK_RADIUS_PX` (6 CSS px, README [section 9](README.md#9-performance-budgets) rule 4) × `view.getResolution()` and `worldWidth` 0 (no wrapping), over satellites, the 8 bodies and the stars in the current magnitude prefix; the nearest wins. Set the viewport cursor to `pointer` over a hit.
8. Hover card anchor: an `ol/Overlay` with `stopEvent: false` and `pointer-events: none` on its element, placed at the hovered object each frame. `SkyMapHandle` exposes the element; `SkyView.tsx` renders `HoverCard` into it with `createPortal` (`src/ui` never imports OpenLayers).
9. `SkyView.tsx` text alternative: below M2's body list, a "Satellites above the horizon" list of `<button>`s, one per drawn stations/visual satellite plus the selected satellite, sorted by apparent altitude, highest first. Accessible name: "ISS (ZARYA), NORAD 25544, az 124°, alt 29°, sunlit" ("in shadow" otherwise). With Starlink on, a sentence "and N Starlink satellites" follows. Activation calls `select(id)`; `aria-pressed` marks the selected one. It re-renders through `useTick4Hz()`, with items keyed by NORAD id so focus survives updates. This list is the keyboard path to every stations/visual satellite in the sky. Playwright's `getByRole(..., { name })` matches a case-insensitive substring unless `exact: true`, so a locator for M2's "Above the horizon" list would also match "Satellites above the horizon" and fail strict mode. M2's `sky.spec.ts` uses `exact: true` (M2 step 11); check it still does, and use `exact: true` for this list too.

### Step 14. Ground map (`src/map/ground`)

1. Layer order: GIBS layers, site (M1), tracks (canvas), satellites (`WebGLVector`), starlink (`WebGLVector`), markers (canvas). WebGL layers get `disableHitDetection: true` (picking is ours) and are disposed in the cleanup ([Map lifecycle](README.md#map-lifecycle)).
2. Each WebGL layer has one `MultiPoint` feature per group and class (stations lit/shadowed, visual lit/shadowed; starlink lit/shadowed), each created with one coordinate and not added to its source: the first non-empty `writeClassPoints` adds it, so no placeholder point is ever drawn at 0, 0 ([Errors](README.md#errors)). Every valid, not docked object is drawn (whole globe); ISS, selected and hovered are left out (gotcha 11). Write classes with:

```ts
export function writeClassPoints(
  source: VectorSource,
  feature: Feature<MultiPoint>,
  flat: number[],
  count: number,
): void {
  const geometry = feature.getGeometry();
  if (geometry === undefined) return;
  if (count === 0) {
    if (source.hasFeature(feature)) source.removeFeature(feature);
    return;
  }
  const coords = geometry.getFlatCoordinates(); // live array: write in place, then one changed()
  coords.length = 2 * count;
  for (let i = 0; i < 2 * count; i++) coords[i] = flat[i] ?? 0;
  geometry.changed();
  if (!source.hasFeature(feature)) source.addFeature(feature);
}
```

   Measured on `WebGLVector` with hit tests at three positions: point counts 1 → 0 → 2 → 0 → 3 were each drawn exactly where written, both when the feature was added at creation and when the first `writeClassPoints` added it. Without the remove/add, a class that was empty once never draws again (counts 2 and 3 drew nothing; gotcha 10).
3. Markers layer (canvas `VectorLayer` with `updateWhileAnimating: true` and `updateWhileInteracting: true`; both default to false, and the layer would then freeze its markers during a pan or the "Show on map" animation): labelled `Point`s for the ISS, the selected and the hovered satellite at their EPSG:3857 positions, fed through `bindSelection` like the sky's selection layer. On `postrender`, call `recordHighlight("ground", selectedId)`.
4. `layers/tracks.ts` + `bindTracks.ts`: a canvas `VectorLayer` (source `wrapX` default true) of `LineString`s built with `fromLonLat` from the unwrapped pairs. Request per README "tracks and incoming": the selected satellite ±10 min; the others are the satellites inside the sky frame (`projectAzAltDeg` true and 0 ≤ u ≤ W, 0 ≤ v ≤ H), capped at 100, Starlink only when selected, ±3 min. Send on a selection change, a change of that set, or a change of `floor(simTimeMs / 20000)`; at most 10 per second. The selected track is drawn emphasised; the design decides how.
5. Picking: `pointermove` → `hover`, `singleclick` → `select` (a miss selects null; `singleclick` keeps double-click zoom from deselecting). Use `pickNearest` over the frame's EPSG:3857 array (`ephemeris.frame.mercator`, a `number[]`) with radius `PICK_RADIUS_PX` × resolution and `worldWidth = WORLD_WIDTH_M` (40,075,016.685578488 m), because view coordinates are not wrapped: 50 px right of a view centred on 180° read x = 21,994,296 m, past the 20,037,508 m edge (measured).
6. `bindFollow.ts`: while `selection.follow` is true and a satellite is selected, a frame updater calls `view.setCenter` on its position. A `pointerdrag` on the map calls `setFollow(false)`. "Show on map" (Inspector) animates the centre over 500 ms, or sets it when reduced motion is on.

### Step 15. UI

1. `Inspector.tsx`: a region named "Inspector" (`<section aria-label="Inspector">`; Biome's `useSemanticElements` rejects `<div role="region">`, M2 gotcha). Empty state: "Nothing selected. Click an object in either view, or use the list of satellites above the horizon." For a satellite: name, "NORAD 25544", group ("Space stations", "Brightest (CelesTrak visual)", "Starlink"), az and apparent alt (0.1°), range (whole km), "Sunlit" or "In Earth's shadow", visibility ("Visible to the eye" or the first failing reason: in shadow, Sun too high, below the horizon), element age ("Elements 1.3 days old"; "Stale elements: 19.9 days old" past 7 days), docked vehicles ("Docked: POISK, ISS (NAUKA), …"). For stars: name or HR, V magnitude, az, alt. For bodies: name, az, alt, magnitude. Buttons "Show on map" and "Follow" (`aria-pressed`) for satellites only, and "Clear selection". A `sat:` id that is not in the loaded groups shows "Satellite 12345 is not in the loaded groups. Turn on Starlink if it is a Starlink satellite." Live fields render through `useTick4Hz()` reading `ephemeris` and `skyCache` ([React rules](README.md#react-rules)).
2. `HoverCard.tsx`: name, NORAD id (satellites), az, alt, range, lit state, stale flag, magnitude where known (stars, bodies), in the Inspector's formats: "az 123.8°" and "alt 28.9°" (apparent, `toFixed(1)`), "795 km" (`Math.round`), "Sunlit" or "In Earth's shadow". `role="tooltip"`, not live. Hidden when `hoverId` is null.
3. `LayerToggles.tsx`: "Satellites (ISS and brightest)", "Starlink (about 11,100; loads 4.7 MB)", "Trails". Each shows its group status: loading, failed, or "N objects, elements fetched 2026-10-11 03:50 UTC".
4. `credits.ts`: `CELESTRAK_CREDIT: Credit` (text "Orbital elements: CelesTrak", `href` `https://celestrak.org`, `licence` and `licenceHref` null). M1's `dataCredits(layers, gibsReady)` takes `satellites` and `starlink` in `layers` too and appends `CELESTRAK_CREDIT` while either is on, whatever `gibsReady` is (M1 returns `[]` early when `gibsReady` is false; that early return must not drop this credit). Update M1's `credits.test.ts` cases.

### Step 16. Test hooks, e2e fixture, perf test

1. `src/app/testHooks.ts` ([README section 6](README.md#state-app-and-map-modules)) is installed by `main.tsx` only when `navigator.webdriver` is true (it is in Playwright's headless Chromium). The selection layers call `recordHighlight(view, selectedId)` from `postrender`. `selectionFrame` comes from the hooks' own `bindSelection` listener, which stores `frameCount()` whenever `selectedId` changes; `readyFrame` is set by `updateEphemerisFrame` (step 11). `clientPoint` uses M1's `registry` (`src/map/registry.ts`), `map.getPixelFromCoordinate` and the target's `getBoundingClientRect()`. `ViewId` has the same members as M1's `MapId`.
2. `tests/e2e/fixtures.ts`: add the same-origin route `**/data/gp/*.json` → `tests/fixtures/gp/<file>` ([End-to-end tests](README.md#end-to-end-tests)), so positions do not change when the workflow commits new data.
3. `tests/perf/propagation.perf.ts` (`npm run perf`): load `./?t=2026-10-11T15:09:50Z`, press Space (1×), collect 600 `overhead:propagate` durations, drop the first 5 (JIT warm-up: the first reply took 1.0–3.1 ms), report p50/p95/max; then turn Starlink on, wait for the group, and collect 600 more the same way. `ephemeris.ts` records each reply as `performance.measure("overhead:propagate", { start: performance.now() - computeMs, duration: computeMs })` and clears it at once; collect with a `PerformanceObserver`, as M2 does for `overhead:sky` (599 of 600 measures were observed before the run returned; the last was still pending).

### Step 17. Docs

Append section 8 to `docs/DECISIONS.md`. Root README M3 section: what the satellite layers show, how `fetch-gp` and its workflow behave, how to regenerate the ISS fixture, the CelesTrak credit, the benchmark numbers.

## 5. Tests

Site for orbit tests: 19.8253°, −155.4689°, 4,204 m. Fixtures as in [Fixtures](README.md#fixtures).

| File | Test | Fixture | Tolerance |
| ---- | ---- | ------- | --------- |
| `orbits.test.ts` | ISS vs Skyfield: for each of the 93 rows, `writeSample` → `enuToAzAltDeg` (geometric) vs az/alt; \|ENU\| vs range; `O + M·ENU` → `ecefToLatLonDeg` vs sub-point | `iss-pass-maunakea.json` (step 4) | great-circle ≤ 0.05° (measured 0.0038°); range ≤ 0.1 km (0.037 km); sub-point ≤ 0.005° (0.00038°) |
| `orbits.test.ts` | Sunlit flips: for each of the 31 transitions, scan ± 10 s at 1 s; the flag flips to the new state | same | ≤ 2 s (measured ≤ 1 s) |
| `orbits.test.ts` | `ctx.sunAltDeg` vs astronomy-engine `Horizon(date, obs, eq.ra, eq.dec)` (no refraction) every 10 min on 2026-10-11 | none | < 0.01° (measured 0.0046°) |
| `orbits.test.ts` | `appendGroup` counts, docked pairs, 11,277 unique ids; stale Starlink = `[48408, 58885]` at 03:50:21Z | snapshot | exact |
| `orbits.test.ts` | `parseGpFile` throws for `{}`, `"No GP data found"`, a missing `EPOCH`, `NORAD_CAT_ID` 0, `CLASSIFICATION_TYPE` "S"; `[]` → `[]` | none | exact |
| `orbits.test.ts` | Bad elements (`BSTAR` 0.05, `MEAN_MOTION_DOT` 0.1) at 2027-01-01: `writeSample` false, slot all zero, `satrec.error` 1 | ISS OMM copy | exact |
| `geo.test.ts` | Step 2 cases (Bowring over 11,280 records, round trips, unwrapping) | snapshot | as in step 2 |
| `interpolate.test.ts` | Zenith pass (observer at the ISS sub-point at 2026-10-12T01:00:58.527Z, 22.0404°, −152.6504°, height 4,204 m), alt > 10°: linear at 60× < 0.005°; Hermite at 600× < 0.005°; linear at 600× > 0.1° and Hermite with the naive velocity at 600× > 0.01° (both must hold, so a regression fails) | ISS OMM | as stated (table in step 6) |
| `tracks.test.ts` | ±10 min → 61 points, ±3 min → 19; centres 03:50:20Z and 03:50:21Z give identical tracks; 24 h of track on the 20 s grid from 2026-10-11T03:50:20Z has 14 antimeridian crossings and every step < 180° (largest 1.996°); `unwrapLonDeg` cases | ISS OMM | exact; 1e-9° |
| `fetchGp.test.ts` | `shouldFetch` at 2 h − 1 min false, 2 h true; stations 200 + visual 403 → exactly 2 requests, URL `…GROUP=stations&FORMAT=json`, User-Agent set, `redirect: "manual"`, meta holds only stations (count 22, its sha256), error starts `visual: HTTP 403`; a run 1 h later, with visual answering 403 again, makes 1 request (stations skipped); a 200 with "No GP data found" stops after 1 request; an unchanged body is not rewritten | fake `fetchImpl`, temp dir | exact |
| `gpData.test.ts` | Each `public/data/gp/*.json` parses with `parseGpFile`, its sha256 equals `meta.json`, and `count` matches | committed data | exact |
| `sampleClient.test.ts` | The simulation in step 11 at 1/10/60/600× (0 holds, 0 nulls, 3 buffers), after a seek, and with 150 ms latency (holds > 0, nulls 0) | none | exact |
| `objectId.test.ts` | Accepts `sat:25544`, `sat:100882`, `planet:Jupiter`, `star:424`, `moon`; rejects `sat:`, `sat:0`, `sat:025544`, `sat:1e5`, `planet:Pluto`, `planet:jupiter`, `star:9111`, `Moon`, trailing space, `""` | none | exact |
| `pick.test.ts` | A pointer at x = half-world + 2 km picks an object at x = −half-world + 1 km with wrapping, not without; `skip` and radius are respected | none | exact |
| `actions.test.ts`, `selectors.test.ts`, `url.test.ts`, `keyboard.test.ts` | `select(null)` clears follow; `hover` unchanged id → no state change; `selectGroupMask` 3 / 7; `?sel=` round trip; Esc → `select(null)` | store | exact |
| `bindSelection.test.ts` | Fires `[null, null]` at subscribe, once per selection or hover change, never on `tick`, never after unsubscribe | store | exact |
| `selection.spec.ts` (e2e) | `./?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z`: once `readyFrame()` is set, the "Satellites above the horizon" list holds exactly ISS (ZARYA), SL-3 R/B (NORAD 19046), CYGNUS NG-24, ORBVIEW 2 (SEASTAR), SL-3 R/B (NORAD 10114), DUPLEX, SPACEMOBILE-010, CZ-8A R/B, in that order, and no docked vehicle (no POISK) | gp route | exact |
| `selection.spec.ts` | Click `clientPoint("sky", "sat:25544")`: `highlight("ground").id` is `sat:25544` and its frame − `selectionFrame()` ≤ 1; the Inspector shows "ISS (ZARYA)" and "25544"; URL has `sel=sat:25544` | same | ≤ 1 frame |
| `selection.spec.ts` | Load the same URL plus `&sel=sat:25544`: `highlight("ground")` and `highlight("sky")` frames ≤ `readyFrame() + 1`; Inspector filled. Esc: both highlights null, URL without `sel` | same | ≤ 1 frame |
| `selection.spec.ts` | Hover the ISS point: the tooltip reads "az 123.8°", "alt 28.9°", "795 km", "Sunlit" (satellite.js at 15:09:50Z: az 123.812°, geometric alt 28.841° + 0.030° refraction = 28.872°, range 794.522 km. The range is 0.02 km above the rounding edge; Skyfield's 794.494 km would round to 794, so the string must come from the app's own satellite.js value) | same | exact strings |
| `selection.spec.ts` | Tab to the ISS button in the list, Enter: selected. Turning Starlink on requests `data/gp/starlink.json` exactly once (none before) and the toggle shows ready | same | exact |
| `propagation.perf.ts` | Step 16.3 | gp route | ISS + visual p95 ≤ 4 ms ([section 9](README.md#9-performance-budgets)) |

The e2e spec, type-checked against `@playwright/test` 1.64 (the click case):

```ts
const T = "2026-10-11T15:09:50Z"; // ISS at az 123.8°, apparent alt 28.9°, sunlit, Sun at −16.2°

test("clicking the ISS in the sky view highlights it on the ground map on the next frame", async ({ page }) => {
  await page.goto(`./?cam=synthetic-maunakea&t=${T}`);
  await expect.poll(() => hooksReady(page)).toBe(true);
  const p = await clientPoint(page, "sky", "sat:25544");
  expect(p).not.toBeNull();
  await page.mouse.click(p?.x ?? 0, p?.y ?? 0);
  await expect.poll(async () => (await highlight(page, "ground"))?.id).toBe("sat:25544");
  const sel = await page.evaluate(() => window.__overhead?.selectionFrame() ?? null);
  const ground = await highlight(page, "ground");
  expect((ground?.frame ?? Number.POSITIVE_INFINITY) - (sel ?? 0)).toBeLessThanOrEqual(1);
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector).toContainText("ISS (ZARYA)");
  await expect(inspector).toContainText("25544");
  await expect(page).toHaveURL(/[?&]sel=sat:25544(&|$)/);
});
```

with `hooksReady = (page: Page) => page.evaluate(() => (window.__overhead?.readyFrame() ?? null) !== null)`, `highlight = (page: Page, view: ViewId) => page.evaluate((v) => window.__overhead?.highlight(v) ?? null, view)` and `clientPoint = (page: Page, view: ViewId, id: ObjectId) => page.evaluate(([v, i]) => window.__overhead?.clientPoint(v, i) ?? null, [view, id] as const)`, and the imports `import type { Page } from "@playwright/test"`, `import type { ViewId } from "../../src/app/testHooks"`, `import type { ObjectId } from "../../src/state/types"` and `import { expect, test } from "./fixtures"`. The `testHooks` import is required even if `ViewId` were declared locally: it brings the `Window.__overhead` declaration into the test project, which includes only `tests` (without it every `window.__overhead` fails TS2339, checked). The "next frame" mechanism was checked in Chromium with a zustand store, a canvas layer and a 60 Hz loop: the highlight was drawn in frame N + 1 after a selection in frame N, both when the loop called `renderSync()` and when it did not (OpenLayers scheduled the render itself).

## 6. Acceptance criteria

1. `orbits.test.ts` "ISS vs Skyfield" passes: great-circle az/alt ≤ 0.05° on all 93 rows (stricter than the brief's 0.5°), range ≤ 0.1 km, sub-point ≤ 0.005°, sunlit flips within 2 s on all 31.
2. `selection.spec.ts` passes in CI: clicking the ISS in the sky view, and loading `?sel=sat:25544`, each highlight it on the ground map within one frame and fill the Inspector; Esc clears both; the list, hover and Starlink cases pass; the shared fixture records no console errors and no third-party requests.
3. `interpolate.test.ts`, `sampleClient.test.ts`, `tracks.test.ts`, `fetchGp.test.ts`, `gpData.test.ts` and the docking counts pass.
4. `npm run perf` on a laptop, launched from the arm64 Node 26 (O4): ISS + visual p95 ≤ 4 ms. Measured here at 10 Hz in four runs of 600 (first 5 dropped): p50 0.1–0.2 ms, p95 0.2–0.7 ms, max 0.6–0.9 ms (175 objects; worker `performance.now()` is quantised to 0.1 ms); request-to-reply p95 0.4–1.0 ms. The Starlink numbers are recorded, not gated: p50 5.6–9.1 ms, p95 17.8–18.0 ms, max 19.9–20.4 ms paced at 10 Hz in three runs, against 4.6–4.8 ms for a back-to-back loop (propagate alone 3.9–4.1 ms).
5. `fetch-gp.yml` passes actionlint, and one `workflow_dispatch` run on GitHub fetched or skipped every group and pushed (or had nothing to push); after a push, a Deploy run for the data commit started (`workflow_dispatch`).
6. Keyboard: Esc clears the selection; the satellite list is reachable with Tab and selects on Enter; Inspector buttons work with Enter and Space; focus rings are visible. Lit and shadowed satellites differ in shape. The CelesTrak credit is visible while satellites are shown.
7. The [definition of done](README.md#definition-of-done) holds.

Evidence in the PR: the Vitest summary and the measured values printed by the ISS, interpolation and docking tests; the Playwright report for `selection.spec.ts`; the `npm run perf` output with machine and browser version; the Skyfield script's summary line and versions; the link to the manual `fetch-gp` run; screenshots of both views at `?t=2026-10-11T15:09:50Z&sel=sat:25544`; a 10 s clip at 60× showing smooth motion, trails and the dotted path; a screenshot with Starlink on.

## 7. Gotchas

1. **`eciToGeodetic` runs a fixed 20-iteration loop**: about 15–16.5 ms per 11k objects in Chrome. Use the Bowring closed form (1e-7°). `verification/satellite-js.md` #2
2. **`BulkPropagator`'s `GeodeticPositionCalculator` swaps latitude and longitude in 7.1.0**, and `createWasmModule` does not exist. M3 does not use `BulkPropagator`. `verification/satellite-js.md` #1, #5, #6
3. **Without `worker: { format: "es" }` the build fails** as soon as anything imports satellite.js. `verification/satellite-js.md` #4
4. **A hand-written OMM interface fails TS2345** (`EPHEMERIS_TYPE`, `CLASSIFICATION_TYPE`, no index signature). Use `OMMJsonObject` and a type guard. `verification/satellite-js.md` #11
5. **CelesTrak:**
   - The default format became CSV on 2026-05-09: always send `FORMAT=json`.
   - A second download in the same window returns 403 "GP data has not updated since your last successful download"; 50 errors (301/403/404) in 2 h firewall the IP. Stop on any non-200 and never retry.
   - Store the stamp in `meta.json`: `git checkout` resets file mtimes, so an mtime check in CI always sees a fresh file.
   - A `.com` URL answers 301; `redirect: "manual"` makes that a stop instead of a silent follow.
   - `verification/sources.md` #3, #18, #19
6. **Workflow pushes:**
   - Pushes made with `GITHUB_TOKEN` do not start other workflows, so `ci.yml` does not run on data commits (GitHub docs, "Triggering a workflow", checked 2026-10-11).
   - M0 makes `check` a required status check on `main`. Required checks are meant to pass before commits land on the branch, and the data commit never gets a `check` run (previous point), so the workflow's push may be rejected. The README assumes a repository ruleset that requires `check` and lets the data push bypass it ([README "Assumed until Parth confirms"](README.md#assumed-until-parth-confirms)); prove it on the first manual run, and if the push is rejected, report it to Parth instead of weakening the protection.
7. **`shadowFraction` takes the Sun in AU first and the satellite in km second**; swapped arguments return NaN. `verification/satellite-js.md` #16
8. **Sun altitude:**
   - `sunPos().rsun` is in AU. Scale it to km before subtracting the observer's ECEF position, or the topocentric vector is meaningless.
   - The −6° test is geometric. A refracted Sun turns "visible" on about 156 s after the twilight marker.
   - `verification/architecture.md` #13
9. **Hermite needs the Earth-fixed velocity** `eciToEcf(v) − ω × r_ecf`. The naive rotated velocity errs by 0.35° at 600× (measured above), worse than linear. `verification/architecture.md` #12
10. **An emptied `MultiPoint` never redraws on `WebGLVector`.** `MixedGeometryBatch.changeFeature` returns early for a feature without a ref (`ol/render/webgl/MixedGeometryBatch.js` 543–557), and an empty geometry loses its ref. Remove the feature while empty and add it back (verified). A `MultiPoint` created empty never draws at all. `verification/architecture.md` #2
11. **`WebGLVector` draws about one frame late and freezes while the view pans, zooms or animates.** At 600× a satellite moves tens of km per frame, so a WebGL dot under a canvas label would visibly lag. Draw the ISS, the selected and the hovered satellites only on the canvas markers layer. A canvas `VectorLayer` also skips re-rendering during view animation and interaction unless `updateWhileAnimating` and `updateWhileInteracting` are true (both default false, `renderer/canvas/VectorLayer.js` 688–699), so set both on the markers layer. `verification/openlayers.md` #9
12. **`WebGLVector` drops unwrapped geometry past ±180°** when the view sits inside one world (a Hawaii-centred view shows nothing). Ground tracks go on a canvas `VectorLayer` with unwrapped longitudes. `verification/openlayers.md` #10
13. **Docked vehicles do not always share elements.** Five ISS vehicles carry the ISS element set exactly; CREW DRAGON 13 has its own (epoch 10 ms earlier, ω and M differ) and stays within 0.611 km. An exact-key rule draws it as a second ISS.
14. **Two objects can share a name** (two "SL-3 R/B" above Maunakea at 15:09:50Z). Accessible names and list keys carry the NORAD id.
15. **Worker URLs:** `new URL("meta.json", "data/gp/stations.json")` throws "Invalid base URL", and a relative `fetch("data/gp/meta.json")` in the built worker went to `/assets/data/gp/meta.json` (the worker script's folder) and still answered 200 under `vite preview`, so the mistake surfaces as a JSON parse error (both measured). Pass absolute URLs.
16. **Transferring a buffer detaches it**; only the main thread's pool may reuse it, after the worker sends it back. Never keep a reference to a sent buffer. `verification/satellite-js.md` #8
17. **`Refraction` throws a string, not an `Error`, on a non-finite altitude**, after `console.trace()` (`astronomy.js` 199–205). The M0 clock loop then removes the throwing frame updater for good. Call `apparentAltDeg` only for valid objects.
18. **TypeScript 7 typed arrays are generic.** A helper declared to return `Uint8Array` returns `Uint8Array<ArrayBufferLike>`, which is not assignable to a variable inferred as `Uint8Array<ArrayBuffer>` (TS2322, verified). Annotate `Uint8Array<ArrayBuffer>` / `Float32Array<ArrayBuffer>`.
19. **`erasableSyntaxOnly` rejects constructor parameter properties and enums** (TS1294, verified). Declare fields explicitly.
20. **Benchmark paced, native and in a browser.** Back-to-back loops ran Starlink in 4.6–4.8 ms; the same code paced at 10 Hz gave p50 5.6–9.1 ms and p95 18 ms on the same M2 under background load. This Mac now has only Node 26.11.1 arm64 (O4), and the project's `node_modules` carries the arm64 builds of its native bindings (rolldown, esbuild, lightningcss, Biome); `vite --version` and `vitest --version` report `darwin-arm64 node-v26.11.1`. Run the benchmark in Playwright's arm64 headless shell (`navigator.userAgentData` architecture `arm`), launched from that Node. `verification/satellite-js.md` #3
21. **`setFlatCoordinates` takes `number[]`, not a typed array**, and does not fire a change: call `changed()` once per geometry per frame. Per-feature `setCoordinates` at Starlink scale costs 13–46 ms per frame. `verification/architecture.md` #3
22. **Load groups strictly in order.** Two concurrent `fetch`es can resolve in either order; visual finishing first would claim 25544 for the visual group and break `?sel=` group text and the docking hosts.
23. **The worker answers within milliseconds, but tracks and sky paths share its thread.** Keep both requests at ≤ 10 per second so a burst never delays a sample past its 100 ms slot.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M3's contract lines under "Contract changes from the implementation docs": the positional docking rule, and tracks rebuilt per request with a flush on a group-mask change. Append the rest.

- Stale elements: |sim time − epoch| > 7 days, shown in the Inspector and hover card, still drawn. Reason: DECISIONS asks for a flag, not removal.
- `fetch-gp.ts` sends `User-Agent: overhead-fetch-gp/1.0 (+<repo URL>)`, uses `redirect: "manual"` and a 60 s timeout, treats a non-OMM 200 as an error, rewrites a group file only when its sha256 changes, and always refreshes the stamp. Reason: CelesTrak counts 301s and asks for a contact; unchanged data should not churn files.
- The workflow commits after a stop too (`if: !cancelled()`). Reason: groups fetched before the stop are valid.
- Stations and visual are always propagated; Starlink only while its toggle is on. Reason: the Inspector stays live, and Starlink's tick is far costlier (p50 5.6–9.1 ms against 0.1–0.2 ms, measured).
- Interpolation clamps to [t_a, t_b]; a late sample holds the newest position. Reason: README section 5 forbids extrapolation.
- The sky draws satellites with apparent altitude > 0 (the horizon profile from M6); the ground map draws every valid object. Reason: the ground map is global.
- The ISS, selected and hovered objects are drawn only as canvas `Point`s with labels, never in the class `MultiPoint`s. Reason: WebGL lags a frame and cannot draw text.
- An empty WebGL class feature is removed from its source and re-added when it has points. Reason: gotcha 10.
- Picking radius 6 CSS px (README section 9), nearest candidate wins; a click on empty space clears the selection; the ground map uses `singleclick`. Reason: double-click zoom must not deselect.
- Trails cover the last 30 s of sim time for drawn stations/visual satellites plus the selected one (cap 100), from worker `skyPaths` on an absolute 2 s grid; the selected satellite gets a dotted 2-minute path; reduced motion hides trails. Reason: only the worker owns satrecs, and future positions need propagation.
- Test hooks exist only when `navigator.webdriver` is true. Reason: e2e needs object positions and draw frames without reading canvas pixels.
- The e2e instant is 2026-10-11T15:09:50Z (ISS at 28.9°, sunlit, Sun at −16.2°). Reason: inside the fixture pass, visible to the eye, deterministic list of 8 satellites.
- The ISS fixture is generated with Skyfield 1.55 and sgp4 2.27, DE421 cached in `~/.cache/skyfield`. Reason: reproducible to the byte.
- `public/data/gp/` is seeded from the verification snapshot. Reason: the first deploy needs data without an extra CelesTrak download.

