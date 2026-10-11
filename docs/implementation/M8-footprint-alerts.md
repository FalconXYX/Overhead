# M8 · Footprint and alerts

Branch `m8-footprint-alerts`, one pull request. Read [README](README.md) sections 2, 3 and 7 first. This file uses the paths, types and names defined there and does not restate them. [`../DECISIONS.md`](../DECISIONS.md) wins over both.

Numbers without a citation were measured for this file on 2026-10-11 from a prototype of every domain function below, run on the committed CelesTrak snapshot (`tests/fixtures/gp/`, fetched 2026-10-11T03:50:21Z) with the pinned packages (satellite.js 7.1.0, astronomy-engine 2.1.19, proj4 2.22.0, ol 10.11.0, TypeScript 7.0.2, Biome 2.5.15, Playwright 1.64.0). Domain numbers come from Node 26.11.1 arm64: the prototype's check scripts that produce the quoted values (rays, footprint, incoming lists, coverage, bisected entries, `geodeticHeightKm`) were re-run there on 2026-10-11 and print the same values. Timings come from headless Chromium 156 (arm64) on an Apple M2. Both code blocks were type-checked with tsc 7.0.2 (`strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`) and pass `biome check` with the M0 config; the first one was also executed. A second, independent prototype (its own lens model, footprint walk and propagation loop) re-ran on the same day every snippet, the ray table, every `footprint.test.ts`, `footprintTrack.test.ts`, `incoming.test.ts` and `incomingCoverage.test.ts` value, `geodeticHeightKm` over the snapshot and the 358 px clamping leak, and matched them. The Chromium timings and gotcha 11 were not re-run.

## 1. Goal and scope

The ground map shows where the camera frame looks at orbit height: a polygon on a sphere at the selected satellite's height, or at the 420 km and 480 km presets. An "incoming" chip lists satellites that will become visible inside the frame within 60 s. The worker finds them by propagating each candidate forward and running every sample through the camera model. It never uses the polygon for this, because a fixed-height polygon caught only 24 of 59 real night entries ([architecture.md](../verification/architecture.md) claim 7).

Out of scope:

- The site wedge. It shipped in M4 (`frameAzimuthCoverage`, `bindSite`) and already shows the azimuth range the frame covers, or a full circle when the zenith is in frame ([architecture.md](../verification/architecture.md) claim 17). M8 does not change it. It adds one test that the footprint's bearings match the wedge (section 5).
- Using the polygon as a predictor, highlighting incoming satellites on the maps, and sounds or notifications.
- Incoming alerts while playing at 60× or 600× (gotcha 14).
- New URL parameters, keyboard shortcuts or persisted settings.
- Visual design. Polygon style, chip placement and look are settled during the build from screenshots. This file specifies behaviour, content, states, keyboard and accessibility.

## 2. Prerequisites

- **Merged milestones.**
  - M3: `propagation.worker.ts` with `satrecs`, `groupIndex` and `skip`; `sampleClient.ts`; `ephemeris.ts` with `updateEphemerisFrame`, `SatFrame`, `indexOfObjectId` and the catalog; `writeSample`, `createPropagationContext`, `isVisible`, `SUN_CUTOFF_DEG`; the docked-object flags; the test hooks.
  - M4: all lenses, `createCameraModel`, `projectAzAltDeg`, `unprojectPixel`, `horizonRadiusUnit`, `frameAzimuthCoverage`, `bindSite`.
  - M5: `subaru-starcam`, `local-replay` and the `subaru-2026-10-11-iss` clip camera, which plays `recordings/subaru-2026-10-11-iss.mp4` with its sidecar `recordings/subaru-2026-10-11-iss.json` for the manual check ([README recorded clips](README.md#recorded-clips)).
  - M6: `selectHorizonProfileDeg` and `horizonAltAtAzDeg` (linear interpolation). Everything here also works with a null profile.
- **Data.** No new data files. Tests use the M3 snapshot. The only hand task is the recorded-pass check in section 6.
- **Accounts.** None beyond M0's hosting and CI.
- **Decisions** ([DECISIONS](../DECISIONS.md)).
  - O3 (open): M8 uses `layers.footprint`, `layers.footprintHeightKm` and `setFootprintHeightKm` from the approved shape. If O3 changes, propose those three in this pull request.
  - O2: the "chip before entry" acceptance on a recorded pass runs by hand on the 2026-10-11 clip (section 6). Recordings are gitignored and never committed ([README working agreement](README.md#working-agreement) item 6), so it is not an e2e case; the automated cases stay on the committed OMM snapshot.
  - O1: the footprint polygon is ground-map data and is never drawn on the video ([README sky over video](README.md#sky-over-video) rule 1). The chip is a page element mounted by `App.tsx`, outside the sky stage; wherever the layout puts it, it must not cover the player's controls.
  - O4: no effect.

## 3. Deliverables

New files:

| Path | Content |
| ---- | ------- |
| `src/domain/camera/footprint.ts` | `footprintLonLatDeg`, footprint constants, `footprintMaxPairs` |
| `src/domain/orbits/incoming.ts` | `incomingEtaSec` (changed signature), `collectIncoming`, incoming constants |
| `src/state/incomingClient.ts` | `IncomingClient` (request pacing, stale-reply filter) |
| `src/state/footprintStatus.ts` | `footprintStatus`, written by the binding, read by the UI |
| `src/map/ground/layers/footprint.ts` | `createFootprintLayer` |
| `src/map/sync/bindFootprint.ts` | `bindFootprint` |
| `src/ui/IncomingChip.tsx` | the chip |
| `tests/unit/rays.test.ts`, `footprint.test.ts`, `footprintTrack.test.ts`, `incoming.test.ts`, `incomingCoverage.test.ts`, `incomingClient.test.ts`, `bindFootprint.test.ts` | section 5 |
| `tests/e2e/incoming.spec.ts`, `tests/perf/incoming.perf.ts` | section 5 |

Changed files:

| Path | Change |
| ---- | ------ |
| `src/domain/geo/index.ts` | `sphericalObserverKm`, `raySphereExitKm`, `raySphereEntryKm`, `sphericalLatLonDeg`, `geometricDipDeg`, `geodeticHeightKm` |
| `src/domain/camera/index.ts`, `src/domain/orbits/index.ts` | re-exports |
| `src/workers/propagation.worker.ts` | `setCamera`, `setHorizonProfile`, `incoming` handlers |
| `src/state/ephemeris.ts` | `setCamera`/`setHorizonProfile` sending, `IncomingClient`, `ephemeris.incoming`, `heightKmOf` |
| `src/state/actions.ts`, `selectors.ts` | `setFootprintHeightKm`; `selectIncomingMask`, `selectIncomingActive` (README selectors) |
| `src/map/ground/createGroundMap.ts` | footprint layer, `bindLayerVisible(store, "footprint", layer)`, `bindFootprint` |
| `src/ui/LayerToggles.tsx`, `Inspector.tsx`, `src/app/App.tsx`, `src/app/testHooks.ts` | step 9 |
| `tests/unit/geo.test.ts` | ENU→ECEF numeric check, `geodeticHeightKm` |
| `tests/unit/actions.test.ts`, `selectors.test.ts` | `setFootprintHeightKm`; `selectIncomingMask`, `selectIncomingActive` (section 5) |
| `tests/unit/store.test.ts` (M0) | "every later action throws": drop `setFootprintHeightKm` and lower the expected count by 1. With M7 merged, the 4 left (`startDemo`, `setDemoStep`, `stopDemo`, `setDemoPaused`) throw `/^actions\.<name> lands in M9$/` |
| `docs/DECISIONS.md`, `README.md` | section 8; M8 section |

## 4. Steps

Build in this order. For every formula, write the failing test from section 5 first, with its fixture value and tolerance.

### Step 1. Rays on the footprint sphere (`src/domain/geo`)

Units: km for positions and distances, degrees at the API. The footprint uses one sphere, R = `EARTH_MEAN_RADIUS_KM` (6371.0088), and observer O = (R + h)·û, where û is the Up column of `enuToEcefMatrix(latDeg, lonDeg)` (DECISIONS "Ground map"). Never use the WGS-84 position from `geodeticToEcefKm` as O (gotcha 2).

The naive root is easy to get wrong in three ways: it returns a far-side exit for rays that hit the Earth, it loses precision at the tangent, and it treats "inside" and "outside" alike. Write the helpers like this:

```ts
// src/domain/geo/index.ts — M8 additions. EARTH_MEAN_RADIUS_KM, D2R and R2D are already in this file.

/** Footprint model: O = (R + h)·û with R = EARTH_MEAN_RADIUS_KM. Never a WGS-84 position. */
export function sphericalObserverKm(
  latDeg: number,
  lonDeg: number,
  heightM: number,
  out: Float64Array,
  offset: number,
): void {
  const r = EARTH_MEAN_RADIUS_KM + heightM / 1000;
  const cosLat = Math.cos(latDeg * D2R);
  out[offset] = r * cosLat * Math.cos(lonDeg * D2R);
  out[offset + 1] = r * cosLat * Math.sin(lonDeg * D2R);
  out[offset + 2] = r * Math.sin(latDeg * D2R);
}

/** Forward (+) root t of |O + t·d| = radiusKm for a unit d; null if there is no real root or t ≤ 0. */
export function raySphereExitKm(
  oxKm: number,
  oyKm: number,
  ozKm: number,
  dx: number,
  dy: number,
  dz: number,
  radiusKm: number,
): number | null {
  const b = oxKm * dx + oyKm * dy + ozKm * dz; // O·d
  const c = oxKm * oxKm + oyKm * oyKm + ozKm * ozKm - radiusKm * radiusKm; // |O|² − r²
  const disc = b * b - c;
  if (!(disc >= 0)) return null; // also rejects NaN
  const t = -b + Math.sqrt(disc);
  return t > 0 ? t : null;
}

/** Distance to the first hit of the sphere in front of O, or null if the ray misses it. */
export function raySphereEntryKm(
  oxKm: number,
  oyKm: number,
  ozKm: number,
  dx: number,
  dy: number,
  dz: number,
  radiusKm: number,
): number | null {
  const b = oxKm * dx + oyKm * dy + ozKm * dz;
  const c = oxKm * oxKm + oyKm * oyKm + ozKm * ozKm - radiusKm * radiusKm;
  const disc = b * b - c;
  if (!(disc >= 0)) return null;
  const q = Math.sqrt(disc);
  if (c <= 0) return -b + q; // O inside or on the sphere: the exit is the first hit
  if (b >= 0) return null; // O outside and pointing away
  return c / (-b + q); // equals −b − q, without the cancellation
}

/** −acos(R / (R + h)) in degrees: −2.0809° at 4,204 m. */
export function geometricDipDeg(heightM: number): number {
  return -Math.acos(EARTH_MEAN_RADIUS_KM / (EARTH_MEAN_RADIUS_KM + heightM / 1000)) * R2D;
}
```

`sphericalLatLonDeg(x, y, z, out, offset)` writes `[atan2(z, hypot(x, y)), atan2(y, x)]` in degrees. Footprint vertices go through this function, never through `ecefToLatLonDeg` (gotcha 9).

Run from 19.8253°, −155.4689°, 4,204 m:

| Ray | Earth entry (R) | Shell exit (R + 420) |
| --- | --------------- | -------------------- |
| straight up | null | 415.796 km = H − h (error 1.2e-12 km); hit = site, 3.6e-15° |
| az 90°, alt −2.0° | null | 2,572.80 km |
| az 90°, alt −2.2° | 165.31 km | 2,597.25 km |
| az 90°, alt −3° | 93.36 km | 2,697.08 km (the naive root's far-side point) |
| exactly at the dip, −2.080873° | 231.48 km (a tangent counts as a hit) | 2,582.66 km |
| dip + 1e-9° | null | 2,582.66 km |

`geometricDipDeg`: 4,204 m → −2.080873°; 4,148 m → −2.066975°; 467.6 m → −0.694157°.

### Step 2. Geodetic height (`geodeticHeightKm`)

`geodeticHeightKm(xKm, yKm, zKm)` uses the one-step Bowring latitude φ of `ecefToLatLonDeg`, then h = p·cos φ + z·sin φ − a·√(1 − e²·sin²φ), with p = hypot(x, y) and M3's WGS-84 constants. Over all 11,280 snapshot objects at 2026-10-11T03:50:21Z it matched `eciToGeodetic(...).height` to 6.4e-12 km. It is valid at every latitude, because the formula never divides by cos φ.

The selected satellite's footprint height uses this, not |P| − R. With the geodetic height, the ISS sub-point entered the polygon 0.5–1.0 s after the ISS entered the Subaru frame (5 entries). On the synthetic fisheye the gap was −0.5 to +3.0 s (12 horizon entries from 2026-10-11T00:00Z to 2026-10-13T04:00Z). With |P| − R the gaps ranged from −5.5 to +4.5 s, and the model's direction error doubled from 0.175° to 0.345°. The model treats geodetic latitude as spherical latitude, so the geodetic height is the consistent choice.

### Step 3. Footprint polygon (`src/domain/camera/footprint.ts`)

`footprintLonLatDeg(model, site, heightKm, samplesPerEdge, horizonProfileDeg, out)` from README section 6. Callers pass `FOOTPRINT_SAMPLES_PER_EDGE` (16) and `out = new Float64Array(2 × footprintMaxPairs(16))`, where `footprintMaxPairs(n) = 8n`. The function allocates nothing after its first call with a given `samplesPerEdge`.

1. **Guard.** Return 0 unless `heightKm` is finite and greater than `site.heightM / 1000`.
2. **Boundary samples.**
   - Take N = 4n boundary positions, clockwise from the top-left corner. Each corner is included once:
     - top edge (u, v) = (W·j/n, 0);
     - right edge (W, H·j/n);
     - bottom edge (W − W·j/n, H);
     - left edge (0, H − H·j/n);
     - j = 0…n−1.
   - A fractional position interpolates linearly along its edge; the bisection in item 4 needs this.
   - **Fisheyes:** if a sample lies farther from (cx, cy) than the horizon circle, move it radially onto the circle. The circle's radius is f·g(r_h)·(1 − 1e-9) px, with r_h = `horizonRadiusUnit(lens)` and g(r) = r(1 + k1r² + k2r⁴).
     - When the circle fits the frame (Nānā ao: 616 px in 1232 × 1232), every sample lands on the circle. The image corners then never reach `unprojectPixel` (gotcha 5).
     - When the circle is cropped, the samples inside it stay on the edges.
3. **Margins.** For each sample:
   - Call `unprojectPixel`. A failure counts as below the clip.
   - Convert the apparent altitude to geometric: g = `geometricAltDeg(alt)` (README refraction rule 6).
   - The clip, in geometric altitude, is clip(az) = max(dip, `geometricAltDeg(horizonAltAtAzDeg(profile, az))`), with dip = `geometricDipDeg(site.heightM)`. With a null profile the clip is the dip alone; do not call `horizonAltAtAzDeg(null, az)` here, because its 0° would clip at −0.48° geometric instead of the dip. A non-finite profile value (M6 writes NaN for a ray with no samples) also counts as the dip: `Math.max(dip, NaN)` is NaN, and NaN must never reach a vertex.
   - A sample is above when g − clip(az) ≥ 0.
4. **Walk.** ε = `FOOTPRINT_CLIP_EPS_DEG` (1e-6°) keeps clipped rays off the tangent (gotcha 3).
   - **All samples above:** the directions are the N samples.
   - **None above:**
     - If `projectAzAltDeg(model, 0, 90)` lands inside [0, W] × [0, H] (the zenith is in frame), the directions are the clip curve at az = 360·j/N, alt = clip(az) + ε.
     - Otherwise return 0: the frame shows no sky.
   - **Mixed:** start at the first sample that is above and go once round the ring.
     - above → above: keep the sample.
     - above → below: bisect the boundary position between the two samples (30 halvings) for the last position that is above. Emit its azimuth at alt clip + ε, the exit crossing. Count the below run m from 1.
     - below → below: m += 1.
     - below → above: bisect for the first position that is above, the entry crossing. Then emit m clip-curve points at az = az_exit + Δ·k/(m + 1), k = 1…m, with alt = clip + ε. Then emit the entry crossing, then the sample.
     - Δ is the signed arc from az_exit to az_entry: either Δ1 = (az_entry − az_exit) mod 360 in (0, 360), or Δ1 − 360. Pick the one whose midpoint direction (at `apparentAltDeg(clip + ε)`) projects inside the frame. If both or neither do, pick the shorter.
   - Do not clamp each below-horizon sample at its own azimuth (gotcha 4).
5. **Intersect.**
   - For each direction, d = M·`azAltToEnuUnit(az, alt)` with M = `enuToEcefMatrix(site.latDeg, site.lonDeg)`, and O = `sphericalObserverKm(site…)`.
   - Drop the direction if `raySphereEntryKm(O, d, R)` is not null. This is a safety net: after the clip it never fires on valid input.
   - Otherwise t = `raySphereExitKm(O, d, R + heightKm)`, and the vertex is `sphericalLatLonDeg(O + t·d)`, written as `[lonDeg, latDeg]`.
6. **Unwrap.**
   - Fewer than 3 pairs: return 0.
   - Set lon₀ = `unwrapLonDeg(site.lonDeg, lon₀)`, then lonᵢ = `unwrapLonDeg(lonᵢ₋₁, lonᵢ)`. The ring then sits in the site's world copy (gotcha 11).
   - If |`unwrapLonDeg(lon_last, lon₀)` − lon₀| > 180, the ring encloses a pole: return 0 (gotcha 12).
7. Return the pair count. The ring is open; the caller closes it.

Measured: every emitted direction projected inside the frame within 5.1e-5 px. This held for a rectilinear 3840 × 2160 camera (f 2742 px, az₀ 90°) at alt₀ −10, 0, 5, 10, 19.6, 45 and 70° and roll −30, 0, 15, 45 and 90°. It held for all four fisheyes at alt₀ 0, 20, 60 and 90°. One call takes 0.1 ms in Chromium (p95 0.2 ms).

### Step 4. Incoming check (`src/domain/orbits/incoming.ts`)

Constants: `INCOMING_STEP_MS` 5,000; `INCOMING_STEPS` 12; `INCOMING_MIN_ALT_DEG` −5.

1. **Context cache.** The module keeps 13 contexts, `createPropagationContext(timeMs + 5000·k, site)` for k = 0…12. It rebuilds them only when `timeMs` or the `site` object (by identity) changes. The worker passes its one stored site object (gotcha 10).
2. **Visible-in-frame predicate** at one context. It is true when all of these hold:
   - `writeSample` into a module-level `Float32Array(SAMPLE_STRIDE)` at index 0 returns true. A false return means propagation failed, and the caller stops.
   - The sunlit flag is 1.
   - `enuToAzAltDeg`, then `apparentAltDeg`, gives an apparent altitude above `horizonAltAtAzDeg(profile, az)`. Call `apparentAltDeg` only after `writeSample` returned true: `Refraction` throws on NaN (M3 gotcha 17).
   - `projectAzAltDeg` returns true with 0 ≤ u ≤ W and 0 ≤ v ≤ H.
3. **`incomingEtaSec(satrec, site, camera, timeMs, horizonProfileDeg)`** ([README section 6](README.md#6-domain-module-apis)):
   - For k = 1…12, the first k where the predicate holds returns 5k.
   - A propagation failure returns null. No entry within 60 s returns null.
4. **`collectIncoming(satrecs, groupIndex, skip, groups, site, camera, timeMs, horizonProfileDeg)`** is the worker's whole pass:
   1. Take context k = 0. The allowed groups are the bits of `groups` whose `SUN_CUTOFF_DEG[group]` is at least that context's `sunAltDeg`. If none are allowed, return [] without touching any satellite. Daylight then costs 0.1 ms.
   2. For each index, skip it when any of these holds:
      - it is docked (`skip[i] === 1`);
      - its group is not allowed;
      - `writeSample` fails;
      - its apparent altitude ≤ −5°;
      - the predicate already holds at k = 0. It is visible now, so it is not incoming.
   3. Otherwise call `incomingEtaSec` and keep any non-null result as `{ index, etaSec }`.
   4. Sort by `etaSec`, then by `index`.
   - There is deliberately no "sunlit now" filter (gotcha 7).

Measured `collectIncoming` cost in Chromium 156 (30 calls, 1 s apart):
- stations + visual: median 0.2 ms, p95 0.8 ms;
- with Starlink (11,277 objects): median 7.7–10.0 ms, p95 ≤ 10.6 ms, at 06:00Z, 10:00Z and 15:05Z.

Node timings do not carry over to Chromium (single `collectIncoming` calls with Starlink took 14.4–16.5 ms in Node 26.11.1 arm64); never assert timings in Vitest.

### Step 5. Worker (`protocol.ts`, `propagation.worker.ts`)

1. `protocol.ts` needs no change: README section 5, which M3 copied verbatim, already holds `{ type: "setHorizonProfile"; profileDeg: Float32Array | null }` and the `incoming` reply with `computeMs`.
2. `setCamera`: store `camera = msg.camera === null ? null : createCameraModel(msg.camera)`.
3. `setHorizonProfile`: store the array as received. It arrives as a structured-clone copy; the main thread never transfers it, because the store keeps the original. `setSite` resets it to null until the main thread sends the new camera's profile.
4. `incoming`:
   - If `site` or `camera` is null, reply `{ type: "incoming", requestId, timeMs, computeMs: 0, entries: [] }`.
   - Otherwise reply `{ type: "incoming", requestId, timeMs, computeMs, entries }`. `entries` is `collectIncoming(satrecs, groupIndex, skip, msg.groups, site, camera, msg.timeMs, horizon)`. `computeMs` is `performance.now()` around that call.
   - `IncomingHit` has the same shape as `IncomingEntry`, so post the array as is.
5. A Starlink pass blocks the worker for about 10 ms once a second. The sample pipeline has about 100 ms of slack (README "sample lifecycle" step 5), so no reordering is needed.
6. The worker now imports `apparentAltDeg`. astronomy-engine's ESM build declares `sideEffects: false`: `Refraction` + `InverseRefraction` alone bundle to 2.9 kB minified (rolldown 1.2.13). Compare the worker chunk size in `vite build` with M3's 28 KB and note it in the PR.
7. The worker also imports `src/domain/camera` for the first time. Re-run M4's acceptance 8 check on the built worker chunk: `grep -c "must have required property"` prints 0, so ajv did not come along (M4 gotcha G9).

### Step 6. Main thread (`incomingClient.ts`, `ephemeris.ts`, `selectors.ts`)

1. **`IncomingClient`.** It has no `Worker`, so Node tests drive it.
   - `frame(wallMs, simTimeMs, active, groups)`:
     - When not active, clear `latest` and mark dirty.
     - A sim-time jump calls `flush()` first: `simTimeMs` is before the last request's `timeMs`, or more than 20,000 ms after it. That catches a seek, a step back, Now and a still image's new capture time. Playing at 1× or 10× moves sim time at most about 11 s between requests.
     - Otherwise post a request only when all of these hold:
       - no request is in flight;
       - 1,000 ms of wall time have passed since the last post, or the client is dirty;
       - `simTimeMs` or `groups` differs from the last request, or the client is dirty.
     - Paused with nothing changed, it posts nothing.
   - `flush()`:
     - clears `latest`;
     - sets the minimum accepted `requestId` to the next id;
     - clears the in-flight flag;
     - marks dirty.
   - `onReply(reply)` drops replies older than the minimum accepted id. It clears in-flight when the reply matches the last post, and stores the reply as `latest`.
2. **`ephemeris.ts`.**
   - **Send `setCamera`** with `{ lens, calibration: selectCalibration(s), widthPx, heightPx }` of the active camera, or null before the registry loads. Subscribe to the camera entry and the calibration; send on each change, then call `incoming.flush()`.
   - **Send `setHorizonProfile`** whenever `selectHorizonProfileDeg` changes (a camera switch or a finished profile), then flush. Register this subscription after M3's site subscription: the worker's `setSite` resets its profile to null, so on a camera switch `setSite` must reach the worker before `setHorizon`.
   - **Flush also** after sending `setSite`, on every `groupLoaded`, and when `selectIncomingMask` changes. Time jumps are caught inside `frame` (item 1). A rate change needs no flush: entries are in sim seconds, and 60× and 600× are handled by `active`.
   - **Each frame**, in `updateEphemerisFrame`, call `incoming.frame(performance.now(), simTimeMs, selectIncomingActive(state) && cameraSent, selectIncomingMask(state))`. Call it before M3's "nothing changed, skip the loop" return; otherwise a flush while paused (a profile arriving, a layer toggle) never posts.
   - **Replies:** route each `incoming` reply to `incoming.onReply`, and expose `incoming.latest` as `ephemeris.incoming`.
   - **`heightKmOf(index)`** returns null unless the frame is ready and the valid bit is set. Otherwise it returns `geodeticHeightKm(O + M·enuKm[index])`, using the frame loop's own WGS-84 O and M.
3. **Selectors.**
   - `selectIncomingMask(s) = (s.layers.satellites ? 0b011 : 0) | (s.layers.starlink ? 0b100 : 0)`. Alerts cover only the groups that are on screen.
   - `selectIncomingActive(s) = selectIncomingMask(s) !== 0 && !(s.clock.mode === "replay" && s.clock.playing && s.clock.rate >= 60)`.

### Step 7. Store action

`setFootprintHeightKm(km)` takes `null` (follow the selection) or a finite number > 0. Ignore anything else. The UI offers only `null`, 420 and 480.

### Step 8. Footprint layer and binding

1. **`createFootprintLayer()`** returns a canvas `VectorLayer` over a `VectorSource` holding one `Feature(new Polygon([]))`, plus that polygon.
   - Never use `WebGLVector`: it does not draw beyond ±180° (DECISIONS "Rendering"). The polygon reaches −186.9° for `cfht-starcam` at 800 km.
   - Its label reads `Camera view at {H} km`, with H = `footprintStatus.heightKm` rounded.
   - The fill must leave the imagery underneath readable; the exact style is visual design.
2. **`createGroundMap`.**
   - Insert the layer directly below the site layer: above GIBS, the hillshade and GOES, below the site marker and wedge, the tracks and the satellites.
   - Bind it with `bindLayerVisible(store, "footprint", layer)` and `bindFootprint(store, polygon)`, and add both disposers.
3. **`bindFootprint(store, polygon)`.**
   1. **Inputs.** Subscribe with `shallow` and `fireImmediately` to `[layers.footprint, layers.footprintHeightKm, selection.selectedId, camera.activeId, selectCalibration(s), selectSite(s), selectHorizonProfileDeg(s)]`. Each change calls `recompute()`.
   2. **Following the selection.** `registerFrameUpdater`. When the footprint is on, `footprintHeightKm` is null and the selection is a `sat:` id:
      - h = `heightKmOf(index)` with index = `indexOfObjectId(id)`; h is null when the index is null (the satellite's group is not loaded);
      - call `recompute(h)` when h is not null and either `footprintStatus.source !== "selected"` or |h − `footprintStatus.heightKm`| ≥ 1 km.
      - The ISS changes height by 15 km over an orbit (419–434 km, [architecture.md](../verification/architecture.md) claim 6), so this is about 30 recomputes per 92-minute orbit at 1×.
   3. **`recompute(h?)`.**
      - Footprint off: `polygon.setCoordinates([])`, and set `footprintStatus` to heightKm null, source "fallback", pairCount 0. `footprintStatus` is one exported `const` object: write its fields in place, never reassign it.
      - Otherwise pick the height:
        - the preset, with source "preset";
        - else the selected satellite's height, with source "selected": `h` when the frame updater passed it, else `heightKmOf(index)` read now;
        - else 420 km (`FOOTPRINT_FALLBACK_HEIGHT_KM`), with source "fallback".
      - Build `createCameraModel({ lens, calibration, widthPx, heightPx })` and run `footprintLonLatDeg(model, site, H, 16, profile, buf)`.
      - n = 0: `setCoordinates([])`.
      - Otherwise build the ring as n + 1 `fromLonLat` coordinates in reused arrays, the last a copy of the first, and call `polygon.setCoordinates([ring])`. In Node this fired exactly one source `change` per call.
      - Update `footprintStatus` either way.
   4. The returned disposer unsubscribes and unregisters the frame updater.

### Step 9. UI and test hooks

Follow the README [React rules](README.md#react-rules) and [accessibility rules](README.md#accessibility). Every control is keyboard-reachable with a visible focus ring.

1. **`LayerToggles.tsx`**:
   - A checkbox "Camera view at orbit height" (`toggleLayer("footprint")`).
   - A native `<select aria-label="Orbit height for the camera view">` with these options:
     - "Selected satellite (422 km)" (value `selected` → `setFootprintHeightKm(null)`). The height comes from `heightKmOf`, rounded, and re-renders through `useTick4Hz`. With no satellite selected the option reads "Selected satellite (none: 420 km)".
     - "ISS shell (420 km)" (→ 420).
     - "Starlink shell (480 km)" (→ 480).
   - The always-visible note "Exact only for satellites at this height" ([architecture.md](../verification/architecture.md) claim 7).
   - While the footprint is on and `footprintStatus.pairCount` is 0, a `role="status"` line: "Nothing to draw at this height: the camera sees no sky above the horizon, or the view would cover a pole."
2. **`IncomingChip.tsx`** (`<section aria-label="Incoming satellites" data-testid="incoming-chip">`, mounted by `App.tsx` at all times) re-renders through `useTick4Hz` and reads `ephemeris.incoming`, the catalog and `store.getState()` during render.
   1. **Entries.**
      - N = ⌈max(0, etaSec − (simTimeMs − latest.timeMs)/1000)⌉. While paused this equals `etaSec`; while playing it counts down between the 1 Hz replies (by up to 1 s at 1×, up to 10 s at 10×).
      - Show up to 3 entries as `<button>`s, then the text "and K more".
      - Visible text: `{name} · {N} s`. Accessible name: `{name}, NORAD {id}, enters the view within {N} seconds`.
      - Activation calls ``select(`sat:${id}`)``. `aria-pressed` marks the selected satellite.
   2. **Live region.** An `aria-live="polite"` element inside the section, mounted even when empty. Change its text only when the first entry's NORAD id changes to a new id: `{name} will enter the view within {N} seconds.` Countdown updates are never announced (gotcha 13).
   3. **States.**
      - No entries: empty and visually hidden.
      - Inactive because of the rate: "Incoming alerts pause at 60× and 600×."
      - Inactive because both satellite layers are off (`selectIncomingMask` is 0): empty, like "no entries".
      - Nothing animates under `prefers-reduced-motion: reduce`.
3. **`Inspector.tsx`**: when the selected satellite is in `ephemeris.incoming`, show "Enters the view within N s", with N as above.
4. **`testHooks.ts`**:
   - `footprint()` returns `footprintStatus`.
   - `incoming()` returns `{ timeMs, computeMs, entries: [{ noradId, etaSec }] }`, or null.

### Step 10. Documentation

Append section 8 to `docs/DECISIONS.md`. Add the root README's M8 section: what the polygon means ("exact only at its height"), the height presets, and how the chip predicts.

## 5. Tests

All domain tests run in Vitest (`environment: "node"`) on the M3 snapshot read with `node:fs`. "Subaru" means `subaru-starcam` defaults:
- site 19.82552°, −155.47587°, 4,148 m;
- 3840 × 2160, rectilinear, az 81.2°, alt 19.6°, roll 0, f 2742 px, cx 1920, cy 1080.

"Fisheye" means `synthetic-maunakea`: 19.8253°, −155.4689°, 4,204 m, `syntheticFisheyeCalibration(1024)`. Every number below was produced by the prototype; generate any new value the same way and commit it as an inline constant. A vertex's distance from the site is the great-circle distance on the sphere R = 6371.0088 km between the site's (latDeg, lonDeg) and the vertex; bearings are initial great-circle bearings on the same sphere.

| File · case | Fixture | Tolerance and expected value |
| ----------- | ------- | ---------------------------- |
| `geo.test.ts` · ENU→ECEF numeric check | `enuToEcefMatrix(19.8253, −155.4689)` | row-major [0.415187106151195, 0.308540026704293, −0.855816989085348, −0.909736042424283, 0.140812098065060, −0.390579423616657, 0, 0.940731101303571, 0.339153350330156] ± 1e-12; MᵀM = I ± 1e-15 (measured 1.1e-16); det = 1 ± 1e-15. For (az, alt) = (0, 45), (90, 10), (181, 60), (270, 0.5), (30, 40), (359, 89): satellite.js `ecfToLookAngles(observerGd, O_wgs84 + 1000·M·enu)` returns the same az and alt ± 1e-9° (measured ≤ 5e-13°) |
| `geo.test.ts` · `geodeticHeightKm` | all snapshot objects at 2026-10-11T03:50:21Z: ECEF from `propagate` + GMST rotation | vs `eciToGeodetic(...).height` ≤ 1e-6 km (measured 6.4e-12 km) |
| `rays.test.ts` · straight up | O = `sphericalObserverKm(19.8253, −155.4689, 4204)`, d = Up column of M | \|O\| − R = 4.204 ± 1e-9 km; `raySphereExitKm` to R + 420 = 415.796 ± 1e-9 km (R + 480: 475.796); hit `sphericalLatLonDeg` = site ± 1e-9°; `raySphereEntryKm` to R is null |
| `rays.test.ts` · Earth hits | az 90°, alt −3 / −2.2 / −2.0 / −10° | entry 93.363 / 165.308 / null / 24.472 km ± 0.001; the shell exit at −3° is 2,697.080 ± 0.001 km, so a naive root would have drawn a far-side point |
| `rays.test.ts` · dip and tangent | `geometricDipDeg(4204)`, (4148), (467.6), (0) | −2.080873, −2.066975, −0.694157, 0 ± 1e-6°. At exactly the dip, entry is non-null (231.48 ± 0.01 km); at dip + 1e-9°, null |
| `footprint.test.ts` · known pose | Subaru, H 420, null profile, 16 per edge | 66 pairs. Pair 0 (top-left corner) (−151.946464, 23.598321) and pair 16 (top-right) (−151.044186, 17.120521) ± 1e-6°. Pairs 0–16 equal an independent proj4 `gnom` inverse (`+x_0=0 +y_0=0`, `forward/inverse<[number, number]>`) through the brief's root ± 1e-9° (measured 2.8e-14°). No vertex is farther from the site than the limb distance 2,482.234 km + 0.001; 19 vertices lie on it ± 0.001 km. H 480: pair 0 (−151.488596, 24.067504), limb 2,628.866 km |
| `footprint.test.ts` · bearings = wedge | same | the initial great-circle bearing from the site to every vertex lies in `frameAzimuthCoverage(model, 16)` = 40.3553–122.0447° ± 0.001°, and the minimum and maximum bearings equal its ends ± 0.01° |
| `footprint.test.ts` · fisheye rings | fisheye, H 420 | null profile: 64 pairs, all 2,305.660 ± 0.001 km from the site. Constant 10° profile (the clip curve lies inside the frame): 64 pairs at 1,385.212 ± 0.001 km |
| `footprint.test.ts` · clip correctness | rectilinear 3840 × 2160, f 2742, az₀ 90°, alt₀ {−10, 0, 5, 10, 19.6, 45, 70} × roll {−30, 0, 15, 45, 90}; the 4 fisheyes on 1232 × 1232 (cx = cy = 616, f = 616/`horizonRadiusUnit`, a 616 px horizon circle) at az₀ 90°, alt₀ {0, 20, 60, 90} (90 is zenith-locked), roll 30; site 19.8253°, −155.4689°, 4,204 m; H 420 | each vertex turned back into a direction (P = (R + H)·û(lat, lon), Mᵀ(P − O), `enuToAzAltDeg`, `apparentAltDeg`) projects inside [0, W] × [0, H] ± 1e-3 px (measured ≤ 5.1e-5 px); no vertex beyond the limb distance + 0.001 km |
| `footprint.test.ts` · edges | as named | rectilinear alt₀ −60° (pointing down): 0. Fisheye H 3 km (below the site): 0. Walenstadt zenith fisheye (47.1236°, 9.3242°, 467.6 m), null profile: H 2,200 km gives 64 pairs with max lat 89.68 ± 0.01°; H 2,300 km gives 0 (encloses the pole). Nānā ao-like zenith-locked equidistant fisheye (1232², f 392.158, cx = cy = 616, `flipX`; any roll), site 19.8253°, −155.4689°, 4,204 m, H 800: 64 pairs, lon −185.18…−125.75 ± 0.01, consecutive \|Δlon\| < 180. `cfht-starcam`-like rectilinear (3840 × 2160, f 2742, cx 1920, cy 1080, az 270°, alt 20°, roll 0), same site, H 800: 66 pairs, lon −186.93…−162.15 ± 0.01 |
| `footprintTrack.test.ts` · polygon agrees with the frame | ISS from the snapshot, Subaru, windows of ± 120 s around 2026-10-11T00:11:33Z, 15:09:55Z, 23:24:30Z, 2026-10-12T01:01:28Z, 14:22:56Z. Every 0.5 s: in frame (projected inside, apparent alt > 0, null profile, no sunlit test) and sub-point (`ecefToLatLonDeg`) inside the polygon built at `geodeticHeightKm` (ray casting in lon/lat, point lon shifted to within 180° of vertex 0) | in each window the polygon entry is within ± 2 s of the frame entry (measured +0.5 to +1.0 s) |
| `incoming.test.ts` · synthetic pass, frame entry | ISS, Subaru. E = first ms when the predicate holds, found by bisection in [15:09:50Z, 15:10:00Z] | E = 2026-10-11T15:09:54.955Z ± 2 ms (Sun −16.19°). For t = E − k s: k = 61…70 → null. For k = 1…60: `etaSec` ∈ {5, …, 60} and 0 ≤ t + 1000·etaSec − E < 5,000 ms. At E + 1 s, `collectIncoming` does not list the ISS (visible now) |
| `incoming.test.ts` · synthetic pass, shadow exit | ISS, fisheye. Rises (apparent alt > 0) at 2026-10-11T15:04:25.874Z in shadow. exit = the first ms when the predicate holds, found by bisection in [15:04:30Z, 15:06:00Z]: 15:05:39.300Z ± 2 ms (Sun −17.18°). Use the bisected value, not the rounded constant: `exit − 60 s` puts the last sample exactly on it | `incomingEtaSec(exit − 32.5 s)` = 35, `(exit − 60 s)` = 60, `(exit − 62.5 s)` = null; at exit − 32.5 s the ISS sample's sunlit flag is 0 |
| `incoming.test.ts` · horizon | fisheye, 2026-10-11T15:05:07Z | ISS `etaSec`: null profile 35; constant −0.27° 35; constant +30° null |
| `incoming.test.ts` · `collectIncoming` lists | stations + visual through `appendGroup` (docked flags) | fisheye 15:05:07Z, mask 0b011 → [25544: 35, 19046: 55]. Fisheye 15:06:07Z → [10114: 50]. Subaru 15:09:22Z → [25544: 35], with none of 36086, 49044, 68837, 100057, 100712, 100882. Subaru 2026-10-11T22:00Z, mask 0b111 → [] (daylight) |
| `incoming.test.ts` · failure | ISS OMM with `ECCENTRICITY: 1.2` | `propagate` returns null (error 1); `incomingEtaSec` returns null |
| `incomingCoverage.test.ts` · nothing missed | stations + visual, docked skipped, 2026-10-11T04:00Z to 16:00Z in 5 s steps. An appearance is a step where the predicate turns true for an object that was not visible-in-frame (sunlit) at the previous step, with the Sun ≤ −6° at that step and 60 s before. Refine to 1 s; call `collectIncoming` at E − 55 s | every appearance is listed with t + 1000·etaSec in [E − 1,000, E + 5,000) ms: Subaru 58/58, fisheye 167/167 (about 1 s per camera in Node 26.11.1 arm64) |
| `incomingClient.test.ts` | fake `post`, `IncomingClient` | a frame at wall 0 posts id 1; a frame at 500 posts nothing (in flight). After reply 1, a frame at 1,000 with a new sim time posts id 2. Paused (same sim time and groups) after reply 2: no post at 3,000. `flush()` clears `latest`; the next frame posts at once; a late reply 2 is ignored. A frame whose sim time is 30 s before, or 60 s after, the last request clears `latest` and posts at once, even within 1,000 ms of wall time; one 10 s ahead does not. Inactive: no posts, `latest` null |
| `actions.test.ts`, `selectors.test.ts` | store | `setFootprintHeightKm` stores `null`, 420, 480 and 0.5; ignores 0, −1, `NaN` and `Infinity` (state unchanged). `selectIncomingMask`: 0b011 by default, 0b111 with `starlink`, 0b100 with only `starlink`, 0 with both off. `selectIncomingActive`: true at rate 1 playing and at 10× playing; false at 60× and 600× while playing in replay; true at 60× while paused; false with both satellite layers off |
| `bindFootprint.test.ts` | `createAppStore` with the `subaru-starcam` entry active; `createFootprintLayer()`; `vi.mock` of `ephemeris.ts` for `heightKmOf` and `indexOfObjectId`; frames from M0's fake `FrameScheduler` | Off: no rings, `heightKm` null. On with preset 480: one ring of 67 coordinates, first equals last, each equals `fromLonLat` of `footprintLonLatDeg` ± 1e-6 m; status `{ 480, "preset", 66 }`; exactly one source `change`. `updateCalibration({ azDeg: 90 })` recomputes once. `setFootprintHeightKm(null)` without a selection: `{ 420, "fallback" }`. `sat:25544` selected with heights 433.7 → 434.2 → 434.8 km over three frames: recomputes at 433.7 and 434.8 only |

### End-to-end (`tests/e2e/incoming.spec.ts`)

Import `test` from `tests/e2e/fixtures.ts`. Same-origin `data/gp/*.json` is served from `tests/fixtures/gp`. With M6's `mastM` 33 for `synthetic-maunakea`, the terrain route gives a profile ≤ −0.49°, which does not change any value below. If M6's `mastM` change was not approved (`mastM` 0), the route gives up to +6.87° over az 61–216°. The ISS enters at az 195° and alt 4.5°, and SL-3 R/B 10114 at az 134° and alt 0°, so both would then be behind terrain: regenerate the values below.

1. Open `/?cam=synthetic-maunakea&t=2026-10-11T15:05:07Z`. Wait for `__overhead.incoming()?.timeMs === Date.parse("2026-10-11T15:05:07Z")`. Check:
   - the chip's buttons are, in order, "ISS (ZARYA), NORAD 25544, enters the view within 35 seconds" and "SL-3 R/B, NORAD 19046, enters the view within 55 seconds";
   - no button names 36086, 49044, 68837, 100057, 100712 or 100882;
   - the live region contains "ISS (ZARYA)".
2. Click "Forward 1 minute". Then:
   - the hook's `timeMs` is 60,000 ms later;
   - the only button is "SL-3 R/B, NORAD 10114, enters the view within 50 seconds", and there is no ISS button.
   - Click it. The Inspector shows "Enters the view within 50 s" and the URL has `sel=sat:10114`.
3. Choose rate 60× and press Play. The chip reads "Incoming alerts pause at 60× and 600×" and `incoming()` is null. Pause.
4. Open `/?cam=synthetic-maunakea&t=2026-10-11T15:05:07Z&sel=sat:25544`. Open Layers and check "Camera view at orbit height":
   - `footprint()` is `{ source: "selected", heightKm: 422.4 ± 0.5, pairCount: 64 }` (the ISS geodetic height there is 422.400 km), and the option text contains "422 km";
   - choose "Starlink shell (480 km)": `{ "preset", 480, 64 }`;
   - choose "Selected satellite", move focus off the select (`locator.blur()`; `keyboard.ts` ignores keys from a `select`), then press Esc: `{ "fallback", 420, 64 }`.
   - Save a ground-map screenshot.
5. The fixture's console-error and third-party checks pass.

### Performance (`tests/perf/incoming.perf.ts`, `npm run perf`, not CI)

Open `/?cam=synthetic-maunakea&t=2026-10-11T06:00:00Z`, turn on Starlink, wait for `starlink` ready, play at 1×, and collect `computeMs` from 60 consecutive `incoming()` replies (each new `timeMs`). Report p50 and p95; the gate is p95 ≤ 20 ms (acceptance 5). Then run M3's `tests/perf/propagation.perf.ts` again on this branch: the stations + visual sample p95 must stay ≤ 4 ms (M3's gate). Record its Starlink sample numbers next to M3's; they are not gated until M9 (M3 measured p95 18 ms paced at 10 Hz).

## 6. Acceptance criteria and PR evidence

1. The [definition of done](README.md#definition-of-done) holds. Paste the Vitest summary listing every file in section 5 and the Playwright list for `incoming.spec.ts`.
2. README M8 acceptance:
   - **Straight-up ray:** `rays.test.ts` › straight up: t = H − h (415.796 km) and the hit equals the site within 1e-9°.
   - **A −3° ray from 4,204 m is rejected:** `rays.test.ts` › Earth hits, plus `footprint.test.ts` › clip correctness. The footprint never emits a vertex beyond the limb.
   - **On a recorded pass the chip appears before the satellite enters the frame:**
     - synthetic: `incoming.test.ts` › synthetic pass. The ISS is listed from E − 60 s, and every listed ETA brackets the true entry within 5 s;
     - recorded: the manual check below.
3. **Recorded pass, manual (O2).** The clip is the 2026-10-11 Subaru StarCam recording ([README recorded clips](README.md#recorded-clips)): media 0 is 2026-10-11T15:08:30.183Z (burned-in clock, ± 0.3 s), and the sunlit ISS enters at the right edge at media 78.7 s (15:09:48.883Z; the sidecar's `pass.inFrameFromMediaS`).
   - **Setup.**
     - Run `npm run dev` (a preview or deployed build serves no recordings) and open the app's URL with `?cam=subaru-2026-10-11-iss&sel=sat:25544`. The clip camera loads `recordings/subaru-2026-10-11-iss.mp4` with its sidecar and opens in replay, paused at media 0, with the ISS selected.
     - Keep the sidecar's calibration, which the clip camera loads: az 81.2322°, alt 19.6185°, roll 0.7698°, f 2525.93 px, k1 −0.00992. With it and the committed OMM (ISS epoch 2026-10-09T22:48:38.797Z) the predicted entry is media 79.8 s (15:09:49.982Z), 1.1 s after the observed one. The Subaru defaults predict media 84.8 s (15:09:54.955Z): the chip would then list the ISS from media 24.8–25.8 s with N = 60, and t_seen − (t_chip + N) would be −6.1 to −7.1 s, so the check can fail on the −7 s bound below. Do not run the check on the defaults.
     - Turn on "Camera view at orbit height".
     - Play at 1× from media 0. The clip starts 78.7 s before the ISS appears, more than the 60 s look-ahead.
   - **Record:**
     - t_chip, the media time when the chip first lists the ISS, and its N;
     - t_seen, the first media time where the ISS is visible at the right edge (step with →).
   - **Expected** (the M8 prototype of `collectIncoming` with the sidecar calibration, mask 0b011, null profile, re-run under Node 26.11.1): from media 0 the chip lists SL-3 R/B (NORAD 10114) with N = 25; it enters through the right edge at media 21 s at az 118.2°, alt 6.3°, above the computed Subaru skyline, which is about +4.1° near az 118° and +4.14° at its highest ([terrain.md](../verification/terrain.md) claims 5 and 9; M6 gotcha 19), so the M6 profile does not remove it. The ISS joins with N = 60 at the first request at or after media 19.8 s, so t_chip is 19.8–20.8 s. t_seen is 78.7 s, or 79 s when stepping whole seconds.
   - **Pass:** t_seen − t_chip ≥ 30 s, and t_seen ∈ [t_chip + N − 7 s, t_chip + N + 2 s]. The 7 s covers the 5 s sampling plus 2 s of clock error.
   - **Evidence:**
     - the four numbers and the element-set epoch;
     - a screenshot at t_chip;
     - a screen recording of t_chip to t_seen + 10 s. It should show the ISS ground track entering the polygon within about 3 s of t_seen.
4. **Coverage:** `incomingCoverage.test.ts` shows 58/58 (Subaru) and 167/167 (fisheye).
5. **Performance:** `incoming.perf.ts` p95 ≤ 20 ms on the development machine (measured 9.6 ms in Chromium 156 on an M2), and `propagation.perf.ts` still gives stations + visual p95 ≤ 4 ms. Paste both outputs, with the Starlink sample numbers for comparison with M3.
6. **Screenshots,** from which the visual design is settled:
   - the ground map for `subaru-starcam` with the ISS selected, showing the footprint and the M4 wedge;
   - the same for `synthetic-maunakea` (a ring);
   - the chip with the ISS and SL-3 R/B entries (e2e test 1);
   - the Layers panel with the height select open.
7. **A short clip** (≤ 30 s) at 10× on `synthetic-maunakea` from 2026-10-11T15:04:30Z, with the footprint on and the ISS selected: the chip counting down for the ISS, the ISS lighting up in the sky view at 15:05:39Z, and its track crossing into the footprint.
8. `DECISIONS.md` has the section 8 lines.

## 7. Gotchas

1. **The brief's root draws the far side of the Earth.** The + root is always positive, even for rays that hit the Earth first: a −3° ray hits the ground 93 km out, but the shell root is 2,697 km. Reject with `raySphereEntryKm` ([architecture.md](../verification/architecture.md) claim 16).
2. **Never mix WGS-84 and the sphere.**
   - With O from `geodeticToEcefKm` and R = 6371.0088: t = 411.110 km instead of 415.796 km, and the straight-up hit lands 0.115° (about 13 km) from the site (claim 16).
   - Use `sphericalObserverKm` for every footprint ray.
3. **A ray exactly at the dip is a tangent hit.** `raySphereEntryKm` returns 231.48 km there. Clipped directions sit ε = 1e-6° above the clip; 1e-9° was already enough.
4. **Clamping each sample at its own azimuth leaks out of the frame.** For a rolled camera pointing low (alt₀ 0°, roll 45°) the clamped horizon points landed up to 358 px outside the image. Walk the boundary and bisect the crossings (step 3).
5. **Fisheye frame corners are not sky.** On an all-sky frame the corners lie outside the image circle: alt −30° to −60°, or NaN for orthographic ([architecture.md](../verification/architecture.md) claim 16, [proj4-lens.md](../verification/proj4-lens.md) claim 5). Pull the samples onto the circle.
6. **The polygon is not a predictor.** It is exact only for satellites at its height. A fixed 420 km polygon caught 24 of 59 real night entries (claim 7). The chip never reads it.
7. **"Sunlit now" misses shadow exits.**
   - A satellite that leaves Earth's shadow inside the frame appears without crossing an edge. Over 12 night hours the README's candidate filter caught 51/58 (Subaru) and 121/167 (fisheye) appearances.
   - Testing sunlit at each future sample instead catches 58/58 and 167/167.
   - Cost: with Starlink, 373–749 candidates instead of 0–290 (fisheye and Subaru at 06:00Z, 10:00Z and 15:05Z), still under 11 ms in Chromium.
   - If Parth keeps a "sunlit now" filter ([README "Assumed until Parth confirms"](README.md#assumed-until-parth-confirms)): add "not sunlit at k = 0" to the skip list in step 4, item 4.2, and the coverage acceptance becomes 51/58 and 121/167.
8. **The two refraction models disagree near the horizon.**
   - The terrain profile (κ 0.13) puts Maunakea's sea horizon at −1.94° apparent. astronomy-engine's `'normal'` model adds about 0.64° below −1°. The Subaru frame's bottom edge (alt₀ 19.6°) is at apparent −1.59° (corners) to −1.90° (centre), which becomes geometric −2.23° to −2.53°. All of it is below the −2.067° dip at 4,148 m, so the whole bottom edge (17 samples) is clipped to the limb. That is why the known-pose test has 19 vertices on the limb: 17 clip-curve points plus 2 crossings.
   - At 420 km the unrefracted bottom edge would reach 2,425–2,462 km; clipped, it sits on the limb at 2,482 km, 20–58 km farther. It is a picture, so accept it. The real refraction at Maunakea's 616 hPa is smaller still ([terrain.md](../verification/terrain.md) claim 17). (The brief's alt₀ 20° pose has its bottom edge at apparent −1.26° to −1.50°, geometric −1.90° to −2.14°, only partly below the dip.)
9. **Footprint vertices use spherical latitude.**
   - The model places the site at spherical latitude = geodetic latitude, so `sphericalLatLonDeg` is consistent with the ground-map dots (which use Bowring).
   - Converting vertices with `ecefToLatLonDeg` moves the straight-up hit 0.1155° (12.8 km) north at Maunakea and fails the straight-up test.
10. **The context cache is keyed by the site object.** Passing a new `{ latDeg, lonDeg, heightM }` per call rebuilds 13 contexts per candidate. The worker passes its stored `site`.
11. **A ring in the neighbouring world still draws but is not "there".**
    - Headless Chromium drew the Nānā ao ring at 800 km correctly from both lon 174.8…234.2 and −185.2…−125.8.
    - `Polygon#intersectsCoordinate(site)` was false for the first and true for the second. Unwrap from the site's longitude.
12. **Large heights can enclose a pole.** From Walenstadt with a null profile, the ring still closes at 2,230 km but wraps the North Pole at 2,250 km; an unwrapped ring then does not close. Return 0. The snapshot's highest stations or visual object reaches about 2,227 km (a FREGAT debris piece, [architecture.md](../verification/architecture.md) claim 7), which still draws.
13. **Do not announce the countdown.** Replies arrive every second; announce only a new first entry.
14. **Alerts at 60× and 600× are meaningless.** The 60 s look-ahead lasts 1 s or 0.1 s of wall time, and requests run once per wall second.
15. **The Sun gate is per request, not per sample.** A per-sample Sun test would list every sunlit satellite already in frame for the minute before dusk reaches −6°.
16. **Docked modules duplicate the ISS.** Without `skip`, six ISS-docked objects (36086, 49044, 68837, 100057, 100712, 100882) appear with the ISS's ETA.
17. **`Refraction` throws on NaN** (M3 gotcha 17). Convert altitudes only after `writeSample` succeeded.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M8's contract lines under "Contract changes from the implementation docs": no "sunlit now" filter with a per-request Sun gate, and the `setHorizonProfile` worker message. Append the rest.

- An incoming entry is the first 5 s sample at which a satellite is inside the frame, sunlit and above the terrain horizon. Docked objects never alert. Reason: behind-terrain satellites are not about to appear, and docked modules would duplicate the ISS.
- Alerts cover the groups whose layers are on (`satellites` for stations and visual, `starlink`). They pause while playing at 60× and 600×. Reason: only drawn satellites can appear, and the look-ahead is under a second of wall time at those rates.
- The chip shows "within N s", with N = ⌈etaSec − sim seconds since the reply⌉, and announces only a new first entry. Reason: 5 s sampling gives an upper bound; 1 Hz announcements would flood screen readers.
- The footprint walks 16 samples per edge and replaces each run below the clip with the clip curve between bisected crossings. Reason: per-sample clamping put vertices up to 358 px outside the frame.
- The clip is max(geometric dip, geometric terrain profile) + 1e-6°, compared in geometric altitude. Reason: footprint rays are geometric; a ray exactly at the dip is a tangent Earth hit.
- Fisheye boundary samples move radially onto the horizon circle. When every sample is below the clip but the zenith is in frame, the footprint is the whole clip curve. Reason: frame corners are not sky; Walenstadt's ridges are higher than its fisheye horizon.
- The default footprint height is the selected satellite's geodetic height (`geodeticHeightKm`), recomputed when it moves ≥ 1 km. Otherwise it is 420 km. Reason: the ISS sub-point entered the polygon within 3 s of the frame; |P| − R gave up to 5.5 s.
- Footprint longitudes are unwrapped from the site's longitude, and a ring around a pole returns 0. Reason: geometry tests fail in the neighbouring world; an unclosed ring cannot be drawn.
- The footprint is a canvas `VectorLayer` directly below the site layer. Reason: `WebGLVector` drops geometry beyond ±180°, and the marker and wedge stay on top.
- Near the horizon, footprint rays use astronomy-engine refraction even where it disagrees with the terrain κ model. Reason: one refraction model for drawn objects (README); the effect is under 70 km at 420 km.

