# Overhead — Development Brief

Oct 10, 2026 · @Parth

Revised 2026-10-11 after verification ([docs/verification/](docs/verification/README.md)), then again the same day for Parth's decisions O1, O2, O4 and H1 ([docs/DECISIONS.md](docs/DECISIONS.md)).

Working title. A live sky-camera overlay with a linked ground map, built with React, TypeScript, OpenLayers and Zustand. Written to be handed to a coding agent. Where this brief and `docs/DECISIONS.md` disagree, DECISIONS wins. Contracts (store, types, file layout, worker messages, fixtures) and per-milestone build steps are in [docs/implementation/](docs/implementation/README.md).

## Summary & goals

Overhead draws satellites, the ISS, the Moon, planets and bright stars onto live sky-camera video and images, linked to an OpenLayers ground map. It is a portfolio piece for a map-focused role, so every feature is chosen to show OpenLayers, React, TypeScript, Zustand and OGC standards working on real public data.

The core idea: a camera at a known place, pointing in a known direction, is a map projection of the sky. Anything whose direction we can compute (satellites from orbital elements, planets from ephemerides, stars from a catalog) can be drawn into the frame.

Two views share one clock:

- **Sky view:** the camera's picture (the live YouTube video, a recorded clip, a still image or the synthetic sky) with computed objects drawn on it by OpenLayers. On video the overlay is deliberately light (the ISS, bright satellites, the Moon, planets, a few bright stars and the skyline), so the picture stays readable.
- **Ground map:** carries the dense data: the camera site, every loaded satellite (Starlink on demand), ground tracks, the camera's view projected up to orbit height, satellite cloud imagery and terrain.

### Decisions

- **O1, decided:** the OpenLayers overlay is drawn on top of the YouTube player: light on the video, dense on the ground map (Feature spec).
- **O2, decided:** replay clips are recorded from the StarCam stream with yt-dlp + ffmpeg and kept in `recordings/` (gitignored); the first is `subaru-2026-10-11-iss`, a sunlit ISS pass across the Subaru StarCam frame.
- **O4, decided:** Node 26 (26.11.1, arm64).
- **H1, decided:** hosting on GitHub Pages, deployed from Actions, at `https://parthjain.ca/overhead/` (public repository `FalconXYX/overhead`, Vite `base: "/overhead/"`, every runtime URL through `import.meta.env.BASE_URL`). Production deploys from `main` only; there are no per-branch previews.
- **O3, open — see docs/DECISIONS.md:** the store shape below. This brief assumes it is approved.
- Smaller assumptions that also need Parth's yes (`fetch-gp.yml` data commits bypassing the required CI check on a protected `main`, a 33 m mast at the CFHT point, no "sunlit now" filter for incoming alerts, and the 4× CPU performance gates) are listed in `docs/implementation/README.md` §1.

### Success criteria

1. After calibration, bright stars and planets land within 0.5° of where the camera shows them (fit RMS ≤ 0.25°; see the M4 acceptance).
2. After calibration (pointing from stars; on live video, also the stream delay), the ISS marker stays within 1° of the ISS wherever the ISS is visible on the recorded 2026-10-11 pass (the M5 acceptance). Other satellites are only as accurate as their element sets (Gotchas, "Element sets on replay").
3. Selecting an object in either view highlights it in the other on the next frame.
4. The UI holds 60 fps on a laptop with the ISS, the CelesTrak visual group and Starlink loaded (about 11,280 objects), shown by Chrome traces: unthrottled ≥ 59 fps with a frame p95 ≤ 6 ms, and at 4× CPU throttling (a slow-laptop proxy) ≥ 55 fps with a frame p95 ≤ 16 ms.
5. No API keys and no backend: static hosting plus one scheduled data-fetch job.
6. A 5-minute demo covers video, imagery, terrain, sensor controls and OGC standards.

### Out of scope

- A 3D globe. This is a 2D OpenLayers project on purpose.
- Accounts, auth or a database.
- Committing video to the repository. Recorded clips stay in `recordings/` (gitignored, O2); how one reaches a deployed build is an engineering call in M9.
- Survey-grade astrometry. The goal is a convincing, honest overlay.

## How it maps to the role

Each requirement in the job description maps to one feature the demo can show in under a minute.

| Requirement                 | What Overhead shows                                                                                                                                                                                          | Where it lives                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Video feeds                 | OpenLayers drawing on the live YouTube sky camera, timed by the player's media clock: a light layer set on the video, the dense data on the ground map (O1). Replay of clips recorded from the stream, with the video as the master clock (O2). | `src/map/sky`, `src/ui/VideoPanel.tsx`, `src/app/clip.ts`       |
| Imagery                     | GOES-West infrared clouds every 10 minutes from NASA GIBS over WMTS with a Time dimension, plus a daily VIIRS true-colour basemap. The same clouds seen from below (camera) and above (satellite).            | `src/map/ground/layers/gibs.ts`, `goes.ts`                      |
| Geospatial and terrain data | Horizon mask computed from elevation tiles and drawn as a skyline in the sky view. Hillshade lit by the real Sun at the clock time. The camera's view projected up to orbit height on the ground map.        | `src/domain/terrain`, `src/workers/horizon.worker.ts`           |
| Sensor controls             | Calibration panel: pointing, roll, field of view, lens model, distortion, a star-pair fit and stream delay. Stretch: a simulated tracking mount with slew-rate limits.                                       | `src/ui/CalibrationPanel.tsx`, `src/domain/camera`              |
| OGC standards               | WMTS with a Time dimension (GIBS). Camera pose exported as OGC GeoPose 1.0 Basic-YPR JSON, validated with ajv against the official schema. Optional OGC API – Features for the camera registry.              | `src/domain/camera/geopose.ts`                                  |
| React, TypeScript, Zustand  | Strict TypeScript 7. One vanilla Zustand store drives two imperative OpenLayers maps through selector subscriptions, not React re-renders.                                                                   | `src/state`, `src/map/sync`                                     |

### Talking points the code should make easy to show

- **A camera is a map projection.** A rectilinear lens is a gnomonic projection; a fisheye lens is an azimuthal one (equidistant, equal-area, stereographic or orthographic). Unit tests prove the closed-form code matches proj4.
- **Same math as ISR video annotation.** Project known world objects into a camera with a known pose and lens model.
- **Space domain awareness framing.** A ground optical sensor checks what it sees against the satellite catalog.
- **Two-step calibration.** Stars fix pointing because they move only 15° per hour. Satellites fix the stream delay because the ISS crosses about 1° per second overhead.
- **Performance by design.** Orbit propagation runs in a Web Worker on a fixed sim-time grid, thousands of satellites move as one geometry per style class, and React commits at most 4 times a second.

## Tech stack

A static Vite app with no backend. Every API named in this brief was re-checked on 2026-10-11 against these exact versions installed from npm, by running code ([docs/verification/](docs/verification/README.md)).

| Package                | Version       | Used for                                                                                                                                                                                                                                       |
| ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                | 26.x (26.11.1), arm64 | Tooling, scripts and CI (O4). Pinned with `.nvmrc` (`26`) and `"engines": { "node": ">=26" }`; `ci.yml` and `fetch-gp.yml` run Node 26. Every pinned package's `engines` range accepts it (vitest `>=26.0.0`; vite, rolldown and `@vitejs/plugin-react` `>=22.12.0`; Playwright `>=20`; Biome `>=14.21.3`; tsx `>=18.0.0`). Node 26 becomes LTS on 2026-10-28. |
| `react`, `react-dom`   | 19.3.0        | UI panels only. React never owns OpenLayers objects or high-rate data.                                                                                                                                                                         |
| `typescript`           | 7.0.2         | `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, `lib` with `ESNext.Disposable` (satellite.js types need it). `tsc -b` over four projects (app, worker, node, test); no `baseUrl` (removed). No classic compiler API, so typescript-eslint, vite-plugin-checker and ts-morph are banned. |
| `vite`                 | 8.3.4         | Dev server, build, module Web Workers via `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`. `vite.config.ts` must set `worker: { format: 'es' }`: with the default `iife` the build fails once anything imports `satellite.js`. |
| `@vitejs/plugin-react` | 6.1.2         | React refresh.                                                                                                                                                                                                                                 |
| `ol`                   | 10.11.0       | Both maps: `WMTS` + `WMTSCapabilities`, `ImageTile`, `WebGLTile`, `ImageStatic`, `ImageCanvas`, canvas vector and `WebGLVector` layers, `MultiPoint`, `Overlay`, custom pixel `Projection`.                                                     |
| `zustand`              | 5.0.15        | One vanilla store (`createStore` from `zustand/vanilla`) with `subscribeWithSelector`. Bindings import `shallow` from `zustand/vanilla/shallow`; React reads through `useStore` with primitive selectors or `useShallow`.                      |
| `proj4`                | 2.22.0        | Tests only: cross-checks the closed-form lens models (`gnom`, `aeqd`, `laea`, `stere`, `ortho`). Ships its own types, so `@types/proj4` is removed.                                                                                            |
| `satellite.js`         | 7.1.0         | `json2satrec` (OMM, typed as `OMMJsonObject`), `propagate`, `gstime`, `eciToEcf`, `geodeticToEcf`, `sunPos`, `jday`, `shadowFraction`; `ecfToLookAngles` and `eciToGeodetic` as test oracles. `BulkPropagator` only as a measured fallback.   |
| `astronomy-engine`     | 2.1.19        | Sun, Moon and planets (`Equator` + `Horizon`, `Illumination`); stars via one `Rotation_EQJ_HOR` matrix per pass plus `Refraction`; twilight via `SearchAltitude`.                                                                              |
| `vitest`               | 5.0.3         | Unit tests for all math.                                                                                                                                                                                                                       |
| `@playwright/test`     | 1.64.0        | End-to-end tests, Chromium only, headless. Needs its own browser build (chromium-1248): `npx playwright install chromium`.                                                                                                                      |
| `ajv`                  | 8.20.0        | GeoPose JSON Schema validation: `import { Ajv } from "ajv"` (the default import fails under `nodenext`).                                                                                                                                       |
| `@biomejs/biome`       | 2.5.15        | Lint and format.                                                                                                                                                                                                                               |
| `tsx`                  | 4.23.15       | Runs `scripts/*.ts`.                                                                                                                                                                                                                           |
| `@types/node`          | 26.6.5        | Types for `vite.config.ts`, scripts and tests (the latest 26.x).                                                                                                                                                                              |

Tooling: Biome 2.5.15 for lint and format (typescript-eslint refuses to load with TypeScript 7). Set `noExplicitAny`, `noSkippedTests` and `noFocusedTests` to `error`, and run `biome ci --error-on-warnings .` in CI; the recommended preset only warns on `any` and ignores `.skip`. No CSS framework is required; CSS Modules are enough. Exact configs are in `docs/implementation/` (M0).

## Architecture

One clock in a vanilla Zustand store drives two imperative OpenLayers maps; heavy math runs in Web Workers, and React renders only the panels.

&#91;embedded content: architecture · how data reaches the two maps\]

Arrows show data flow. The store and the workers feed the map bindings, which update both OpenLayers maps; React panels only read the store and send actions.

### Integration rules

1. `SkyView.tsx` and `GroundView.tsx` build a new `ol/Map` and new layers on every run of an effect on their container ref (React 19 StrictMode runs it mount, cleanup, mount in development). Keep each map in the module-level registry (`src/map/registry.ts`), never in React state or the store. Cleanup, in order: unsubscribe every binding; `map.getAllLayers().forEach((l) => l.dispose())`; `map.dispose()`, which detaches the target but does not dispose layers (WebGL contexts would leak); delete the registry entry if it still points at this map. Never reuse a map whose layers were disposed.
2. Map bindings in `src/map/sync` subscribe to store slices with `store.subscribe(selector, listener, { equalityFn: shallow, fireImmediately: true })`, importing `shallow` from `zustand/vanilla/shallow`, and mutate OpenLayers objects directly. Listeners run synchronously inside `setState`, so both maps see a selection in the same frame. Every binding returns an unsubscribe function.
3. The clock tick never re-renders React. React selectors return a primitive or an existing reference; an object-returning selector throws React error #185 in zustand 5, so several fields go through `useShallow`. Every time-varying readout re-renders through one shared 4 Hz ticker (`useTick4Hz`), never through its own interval.
4. One `requestAnimationFrame` loop (`src/state/clockLoop.ts`) sets `clock.simTimeMs` once per frame from the mode and the active camera:
   - live, synthetic camera: `Date.now()`;
   - live, still image: the capture time of the image on screen (`camera.frameTimeMs`), or now before the first image;
   - live, YouTube: the player's media clock minus the stream delay (`youtubeLiveTimeMs`), anchored at the first PLAYING with a finite `getCurrentTime()` above 0, so overlay time freezes while the player pauses or buffers. Rate is locked to 1; play/pause, scrub, step or a rate change switches to replay;
   - replay without video: `simTimeMs += min(wallDeltaMs, 250) × rate`, clamped to ±12 h around `clock.rangeCenterMs`, pausing at the edge (rAF pauses in background tabs, so the first delta back would be huge);
   - local video: the video is the master clock, `startUtcMs + mediaTime × 1000` from `requestVideoFrameCallback`.

   The loop then runs the registered frame updaters (satellite interpolation, sky recompute, next sample request) and, on frames where the sim time changed, calls `renderSync()` on both maps. Without it OpenLayers draws one frame late, or only every other frame; on other frames OpenLayers schedules its own renders, so a paused map stays idle.
5. `propagation.worker.ts` owns all satrecs and samples on a fixed sim-time grid `t_k = k·D`, with `D = 100 ms × rate` (100 ms in live mode). The main thread holds the two samples around the render time plus one request ahead, so it interpolates and never extrapolates. A sample is one packed `Float32Array(count × 8)`: topocentric ENU in km, Earth-fixed velocity in ENU, sunlit, valid. A pool of 3 buffers ping-pongs between the threads by transfer (a transferred buffer is detached on the sender's side). `timeMs` travels as a plain number. A seek, rate change, camera change, Starlink toggle or group load flushes the pool. Message types: `docs/implementation/README.md` §5.
6. Interpolate Cartesian positions, never azimuth, altitude or longitude: ENU for the sky (linear up to 60×, Hermite with the velocity at 600×), ECEF for the ground map. Convert to az/alt afterwards, then add refraction. Measured at 600×: linear az/alt is 14–28° off; Hermite ENU 0.0017°.
7. `horizon.worker.ts` builds the terrain horizon profile once per camera site.
8. High-rate data stays out of the store: samples, interpolated positions, tracks and the incoming list live in `src/state/ephemeris.ts`; star and body positions in `src/state/skyCache.ts`.
9. Everything in `src/domain` is pure TypeScript: no DOM, no OpenLayers, no React, no store. It is all unit-tested.

### Store shape

The store holds only discrete state. The full types, initial state, actions and selectors are in `docs/implementation/README.md` §4 (O3). Changes from v1: `clock.streamDelayMs` is gone, because the delay lives only in `Calibration` and is read through `selectStreamDelayMs`; the scrubber centre (and a `recenter` action for `?t=`), camera status and frame time, `selection.follow`, the coastlines toggle, the footprint height, the star magnitude limit, the toggles for the overlay on video (`layers.video`, O1), per-group data status, per-camera horizons, GOES availability and its load status, and calibration, video and UI state were added. If O3 changes, a milestone that needs a rejected field proposes it in its own pull request.

```ts
type ObjectId = `sat:${number}` | `planet:${PlanetName}` | `star:${number}` | "moon" | "sun"; // star: BSC5 HR number
type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ClockState {
  mode: "live" | "replay";
  playing: boolean;
  rate: ClockRate; // 1 | 10 | 60 | 600; fixed at 1 in live mode
  simTimeMs: number; // UTC epoch ms
  rangeCenterMs: number; // the ±12 h scrubber is centred here
}
interface CameraState {
  activeId: string;
  registry: Record<string, CameraConfig>; // from public/data/cameras.json
  calibration: Record<string, Calibration>; // persisted per camera; missing → registry[id].defaults
  status: Record<string, "unknown" | "live" | "offline" | "daytime">;
  frameTimeMs: number | null; // capture time of the still image or video frame on screen
}
interface SelectionState {
  selectedId: ObjectId | null;
  hoverId: ObjectId | null;
  follow: boolean; // the ground map keeps the selected satellite centred
}
interface LayersState {
  trueColor: boolean;
  coastlines: boolean; // Coastlines + Reference_Labels
  goesIr: boolean;
  hillshade: boolean;
  footprint: boolean;
  stars: boolean;
  planets: boolean; // Sun, Moon and planets
  satellites: boolean; // stations + visual
  starlink: boolean; // first switch-on loads gp/starlink.json
  trails: boolean;
  grid: boolean;
  horizon: boolean; // skyline and behind-terrain dimming
  footprintHeightKm: number | null; // null: the selected satellite's current height (420 when none)
  starMagLimit: number; // default 4.5
  video: VideoOverlayLayers; // extra gates while the sky is drawn over a video (O1)
}
interface VideoOverlayLayers {
  starlink: boolean; // all default false; each also needs its LayersState toggle
  grid: boolean;
  denseLabels: boolean; // false: labels only for the ISS, the selected or hovered object, the Sun, Moon and planets
}
interface DataState {
  cameras: LoadStatus;
  gibs: LoadStatus; // capabilities snapshot parsed
  stars: LoadStatus;
  gp: Record<GpGroup, { status: LoadStatus; fetchedAtMs: number | null; count: number }>;
  horizon: Record<string, { status: LoadStatus; profileDeg: Float32Array | null; imagerySources: string[] }>; // by camera id
  goes: { status: LoadStatus; intervals: readonly TimeInterval[]; latestStepMs: number | null };
}
```

Three more slices complete the state: `calibrationUi` (star pairs with their fit or held-out role and residuals, the pending image click, the last fit), `video` (player status, including `embed-blocked`, and the YouTube error code) and `ui` (the open panel, and the tour's step and pause). `PlanetName`, `GpGroup` (`"stations" | "visual" | "starlink"`), `ClockRate` and `TimeInterval` come from `src/domain`; `CameraConfig` and `Calibration` are defined under Camera model & calibration. Actions live in one stable `actions` object, read with `useActions()`, so selectors never return new functions.

### Project layout

```text
.github/workflows/  ci.yml (every push and PR), fetch-gp.yml (every 6 h), the GitHub Pages deploy from main (H1)
src/
  main.tsx          parse the URL, load cameras.json, apply URL state, render
  app/              App, ErrorBoundary, cameras.ts, url.ts, keyboard.ts, credits.ts, testHooks.ts, persist.ts,
                    youtube.ts, clip.ts, demo.ts
  state/            types.ts, initialState.ts, store.ts, actions.ts, selectors.ts, hooks.ts, clockLoop.ts,
                    skyCache.ts (stars, bodies), objectId.ts, sampleClient.ts, ephemeris.ts (worker client,
                    satellite arrays, tracks), incomingClient.ts, footprintStatus.ts
  domain/
    time/           epoch-ms helpers, clock rules, GOES steps, true-colour date
    geo/            WGS84 <-> ECEF <-> ENU, Bowring lat/lon, ray-sphere intersection, unwrapping, destination points
    orbits/         OMM parsing and dedupe, packed samples, interpolation, visibility, tracks, incoming check,
                    Starlink culling, passes
    astro/          Sun, Moon, planets, inline star rotation, refraction, twilight
    camera/         lens models, sky <-> pixel, frame coverage, calibration fit, footprint, GeoPose + vendored schema
    terrain/        Terrarium decode, tile plan, horizon march
  workers/          protocol.ts, propagation.worker.ts, horizon.worker.ts
  map/
    registry.ts     module-level Map<MapId, OlMap> and registerMap, the one cleanup
    pick.ts, classPoints.ts   pixel-space picking, per-class MultiPoint writes
    ground/         createGroundMap.ts, layers/ (gibs, goes, hillshade, site, satellites, tracks, footprint)
    sky/            createSkyMap.ts, layers/ (background, grid, stars, bodies, satellites, selection, horizon,
                    hitTargets)
    sync/           store -> map bindings
  ui/               GroundView, SkyView, Timeline, LayerToggles, Credits, Inspector, HoverCard, CameraPicker,
                    CalibrationPanel, VideoPanel, IncomingChip, DemoCaptions, KeyboardShortcuts
public/data/        cameras.json, gibs-capabilities.xml, stars.json, gp/{stations,visual,starlink,meta}.json (generated)
recordings/         gitignored (O2): <clip>.mp4 + <clip>.json (ClipSidecar); first clip subaru-2026-10-11-iss
scripts/            fetch-gibs-caps.ts, build-stars.ts, fetch-horizons-fixture.ts, fetch-gp.ts, find-passes.ts,
                    record-clip.ts, fetch-terrain-fixture.ts, fixtures/iss-pass-skyfield.py, fixtures/make-test-clip.ts
tests/              unit/, e2e/, perf/, helpers/, fixtures/
```

The full tree, with the milestone that creates each path, is in `docs/implementation/README.md` §3. Import rules: workers import only `src/domain` and `protocol.ts`; `src/map` never imports React; `src/ui` never imports OpenLayers; import the map as `import OlMap from "ol/Map"` (`Map` shadows the global and fails Biome).

## Time, coordinates & astronomy math

Every object is reduced to one pair before it reaches a map: azimuth in degrees clockwise from north, and apparent altitude in degrees above the horizon, at a UTC time in epoch milliseconds.

### Conventions

- **Time:** `number` UTC epoch ms everywhere. Build a `Date` only at library boundaries. astronomy-engine reads a bare number as days since J2000, so pass it `new Date(ms)` or one `AstroTime` built per pass. Never store epoch ms in a `Float32Array` (about 23.5 s of error). CelesTrak's `EPOCH` has no zone suffix: append `Z` before parsing. The UI shows UTC and the camera's local time (`site.timeZone`), both labelled.
- **Units in names:** `azDeg`, `altRad`, `rangeKm`, `heightM`, `focalPx`, `uPx`. Degrees in the store, UI and messages; radians only inside domain functions and at the satellite.js boundary.
- **Observer:** `{ latDeg, lonDeg, heightM }`, where `heightM` is the lens height above mean sea level (ground plus mast). satellite.js wants `{ latitude, longitude }` in radians and `height` in km. astronomy-engine wants `new Observer(latDeg, lonDeg, heightM)`.
- **Azimuth:** both libraries already use clockwise from north. satellite.js computes `atan2(-topE, topS) + π` (radians, 0 to 2π); astronomy-engine's `Horizon` and `HorizonFromVector` return degrees with east = 90. The `Rotation_EQJ_HOR` frame is x = north, y = west, z = up, so `az = atan2(-y, x)`.
- **Altitude:** apparent (refracted) for everything drawn, picked or compared with the terrain horizon. Geometric altitude only for the Sun's twilight cutoff and for footprint rays.
- **Refraction:** one model for stars, planets and satellites: astronomy-engine `'normal'`, unscaled. It is a sea-level model and overstates refraction at Maunakea by about 35% (0.17° at the horizon, 0.03° at 10°), well inside the targets.

### Satellites (satellite.js 7.1.0, in the worker)

1. Type each parsed group file as `OMMJsonObject[]` (a hand-written interface fails strict TypeScript). Dedupe by `NORAD_CAT_ID` across groups, collapse docked vehicles into one marker (near-identical elements and within 1 km of each other at the later epoch and 45 min later: CREW DRAGON 13 is docked to the ISS but has its own element set), and flag element sets more than 7 days old. Then `const satrec = json2satrec(omm)` once per object.
2. `const pv = propagate(satrec, date)`. It returns `null` on error or decay: mark the object invalid and log its NORAD ID and `satrec.error` once per session.
3. `const gmst = gstime(date)`, then `eciToEcf(pv.position, gmst)`. Topocentric ENU = Mᵀ(ECF − O), with O from `geodeticToEcf` and M the matrix under Direction vectors; `ecfToLookAngles` gives the same angles and is the test oracle. The sample also carries the Earth-fixed velocity in ENU, Mᵀ(`eciToEcf(pv.velocity, gmst)` − ω × r) with ω = 7.292115 × 10⁻⁵ rad/s, for Hermite interpolation.
4. Ground map position: ECEF = O + M·ENU, then a closed-form Bowring latitude and `lon = atan2(y, x)`, within 10⁻⁷° of `eciToGeodetic`. Never call `eciToGeodetic` per tick: it always runs 20 iterations and costs about 15.6 ms per Starlink tick.
5. Sunlit: `const f = shadowFraction(sunPos(jday(date)).rsun, pv.position)`. 0 means fully lit and 1 means umbra; treat `f < 0.5` as sunlit. It is a step value, never interpolated.
6. Apparent altitude: geometric + `Refraction('normal', geometric)` in degrees, at every altitude. A 10° cutoff would make a 0.09° jump and leave satellites above 10° 1–3′ off the stars.
7. Visible: sunlit, and the Sun's geometric altitude ≤ −6° (−12° for Starlink; most Starlinks the −6° rule flags are fainter than magnitude 7.6), and apparent altitude above the terrain horizon at its azimuth (0° until the profile loads).
8. Scale: one plain loop for every group until M9. Measured in a Chrome worker on an M2: about 0.4 ms per tick for the ISS and visual group (178 objects); with Starlink (11,102) about 6 ms back to back, but p95 about 18 ms paced at 10 Hz under load. Budgets: ≤ 4 ms and ≤ 10 ms. So M9 always culls Starlink: each sample propagates one tenth of Starlink plus every object close enough to rise above −10° before its slice comes round again, and extrapolates the rest (p95 2.1–2.6 ms at 1× to 60×). `BulkPropagator` with `createSingleThreadRuntime()` (barely faster than the plain loop) ships only if it beats culling on a target laptop. Never use `createMultiThreadRuntime` (it needs COOP/COEP, which breaks third-party tiles and embeds) or `GeodeticPositionCalculator` (latitude and longitude are swapped in 7.1.0).

### Sun, Moon and planets (astronomy-engine 2.1.19)

- `const eq = Equator(Body.Jupiter, date, observer, true, true)`, then `Horizon(date, observer, eq.ra, eq.dec, 'normal')`. The result's `azimuth` and `altitude` are degrees; `'normal'` adds refraction. `Horizon` takes `ra` in sidereal hours: never pass catalog RA in degrees.
- Draw Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn and Uranus. Size labels by `Illumination(body, date).mag`.
- Twilight: `SearchAltitude(Body.Sun, observer, -1, start, 1, -6)` returns civil dusk, the end of evening civil twilight (the Sun's centre descending through −6°, unrefracted); direction `+1` returns civil dawn. It returns `AstroTime | null`. A negative `limitDays` searches backwards, so the ±12 h timeline markers search forward from the start of the range instead.
- Recompute the whole sky (stars, planets, Sun, Moon) whenever sim time has moved ≥ 2 s in either direction since the last pass, or the camera changes. A wall-clock 1 Hz timer leaves stars up to 600 s behind at 600×, about 138 px.

### Stars

- `scripts/build-stars.ts` converts the Yale Bright Star Catalog (CDS V/50 `catalog.gz`; pad each line to 197 characters and skip the 14 records with no position) to `public/data/stars.json` as rows of `[raDegJ2000, decDegJ2000, vmag, hr, name]`, limited to V ≤ 6.5: 8,404 rows. BSC5 has no proper names, so names are joined from IAU-CSN by HR number.
- Precompute each star's J2000 unit vector once, into a `Float64Array`.
- Each sky pass: one `const rot = Rotation_EQJ_HOR(time, observer)`, applied inline over all stars: az = atan2(−y, x) wrapped to [0°, 360°), alt = atan2(z, hypot(x, y)) + `Refraction('normal', alt)`, written into a reused `Float32Array`. `RotateVector` and `HorizonFromVector` allocate on every call, so they serve only as the test oracle. A pass costs about 1 ms, bodies included.
- Test fixture: from Maunakea (19.8253°, −155.4689°, 4,204 m) at 2026-10-10T08:00Z, Polaris (HR 424) lands at azimuth 0.592°, altitude 20.151° (20.105° without refraction), within 0.01°.

### Direction vectors

Azimuth A and altitude h become a local east-north-up unit vector:

```latex
\hat d_{ENU} = (\cos h \sin A,\; \cos h \cos A,\; \sin h)
```

At observer geodetic latitude φ and longitude λ, the ECEF direction is:

```latex
\hat d_{ECEF} = \begin{pmatrix} -\sin\lambda & -\sin\varphi\cos\lambda & \cos\varphi\cos\lambda \\ \cos\lambda & -\sin\varphi\sin\lambda & \cos\varphi\sin\lambda \\ 0 & \cos\varphi & \sin\varphi \end{pmatrix} \hat d_{ENU}
```

### Camera view at orbit height (ground map)

- Boundary rays: about 16 points along each image edge for rectilinear lenses, and the horizon circle for fisheyes (their image edges and corners map below the horizon). Convert each pixel to azimuth and altitude with the inverse lens model, convert apparent to geometric altitude, and clip to the terrain horizon at that azimuth. Without a profile, clip to the geometric dip −acos(R/(R + h)), −2.08° at 4,204 m.
- Use one spherical model: R = 6371.0088 km and O = (R + h)·û, where û is the up column of the ENU matrix. Mixing in the WGS-84 position from `geodeticToEcf` shifts the hit by about 13 km. Intersect each ray with a sphere of radius R + H:

```latex
t = -(O \cdot \hat d) + \sqrt{(O \cdot \hat d)^2 - (\lVert O \rVert^2 - (R + H)^2)}
```

- The formula returns a positive t even for rays through the Earth: drop any ray that hits the sphere of radius R first.
- H defaults to the selected satellite's current height, with presets of 420 km (ISS) and 480 km (Starlink; SpaceX lowered the 550 km shell to about 480 km in 2026).
- Convert the hit points to latitude and longitude with lat = asin(P_z/|P|), lon = atan2(P_y, P_x) and draw the polygon. The patch is exact only for satellites at height H: it shows where the frame looks, and does not predict entries. The "incoming" chip uses the camera model instead (Feature spec).

### Ground tracks

- Selected satellite: ±10 minutes around the clock in 20-second steps (61 points). Satellites inside the camera frame: ±3 minutes (19 points), at most 100, Starlink only when selected.
- Points sit on the absolute 20 s grid (multiples of 20,000 ms), so a track is identical for any time in the same 20 s slot. The worker rebuilds every requested track on each request (about 1.3 ms at the cap).
- Unwrap longitudes so consecutive points never jump by more than 180°. Hawaii tracks cross the antimeridian. Draw tracks on a canvas `VectorLayer` (default `wrapX`), which draws unwrapped lines across wrapped worlds; `WebGLVector` draws nothing beyond ±180°.

## Camera model & calibration

Treat azimuth as longitude and altitude as latitude on a unit sphere. A rectilinear camera is then a gnomonic projection centred on its pointing direction, and a zenith-pointing fisheye is a polar azimuthal projection.

### Lens models

Here θ is the angle from the optical axis (for a zenith fisheye, θ = 90° − altitude) and f is the focal length in pixels.

| Lens                       | Radius on the sensor | proj4 definition                                                    |
| -------------------------- | -------------------- | ------------------------------------------------------------------- |
| Rectilinear (the StarCams) | r = f tan θ          | `+proj=gnom +lat_0=<alt0> +lon_0=<az0> +x_0=0 +y_0=0 +R=1 +no_defs` |
| Fisheye, equidistant       | r = f θ              | `+proj=aeqd +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +R=1 +no_defs`         |
| Fisheye, equisolid         | r = 2f sin(θ/2)      | `+proj=laea +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +R=1 +no_defs`         |
| Fisheye, stereographic     | r = 2f tan(θ/2)      | `+proj=stere +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +R=1 +no_defs`        |
| Fisheye, orthographic      | r = f sin θ          | `+proj=ortho +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +R=1 +no_defs`        |

At the horizon of a zenith fisheye, r/f is π/2, √2, 2 and 1 for the four fisheyes. A zenith fisheye fixes az = 0 and alt = 90 and fits only roll, because azimuth and roll are the same rotation there. A tilted all-sky camera uses `+lat_0=<alt0> +lon_0=<az0>` for the fisheyes too.

Verified against proj4 2.22.0 (re-checked 2026-10-11):

- With source `+proj=longlat +R=1 +no_defs`, the closed-form gnomonic below is algebraically identical to proj4's `gnom` and agrees to about 2 × 10⁻¹⁵ inside a 70° × 40° field. Every fisheye radius matches its formula to about 10⁻¹⁵, not bit for bit, so tests use a tolerance.
- proj4 2.22.0 returns `NaN` from `gnom` and `laea` unless `+x_0=0 +y_0=0` are present. Always include them.
- No mirroring is needed. This mapping already gives the view from inside the sky: facing west, azimuth 300° lands on the right of the frame, as it does in a real camera.
- For zenith fisheyes proj4 puts north at the bottom and east on the right. A roll of 180° gives the usual north-up, east-left all-sky image.
- At runtime the app projects with the closed forms for all five lenses, writing into reused typed arrays. proj4 allocates, throws on non-finite input and returns longitudes in (−180°, 180°], so it is used only in tests.

### Forward model (sky to pixel)

Rectilinear step, for a camera pointing at azimuth A₀ and altitude h₀:

```latex
\cos c = \sin h_0 \sin h + \cos h_0 \cos h \cos(A - A_0)
```

```latex
x = \frac{\cos h \sin(A - A_0)}{\cos c}, \qquad y = \frac{\cos h_0 \sin h - \sin h_0 \cos h \cos(A - A_0)}{\cos c}
```

Cull any point with cos c ≤ 0: it is behind the camera. Fisheyes use the polar projection from the table instead, with R = 1 (unit focal length); the tail applies f once. Cull fisheye points with θ > θmax (alt < 0 on a zenith fisheye) before projecting, because the orthographic model folds the hidden hemisphere back into the image. Both then share the same tail: roll ρ, radial distortion, focal length, principal point, optional flip.

```latex
x' = x\cos\rho - y\sin\rho, \quad y' = x\sin\rho + y\cos\rho, \quad s = 1 + k_1 r^2 + k_2 r^4, \quad r^2 = x'^2 + y'^2
```

```latex
u = c_x \pm f\,s\,x', \qquad v = c_y - f\,s\,y'
```

Here u and v are pixels with v pointing down, and the sign of the u term flips when `flipX` is set. Distortion applies to every lens, with r in unit-focal projected coordinates (for an equidistant fisheye that is r = f(θ + k₁θ³ + k₂θ⁵)). k1 and k2 must keep the mapping monotonic with margin: 1 + 3k₁r² + 5k₂r⁴ ≥ 0.05 out to the corner radius, capped at the fisheye horizon radius (at exactly 0 the inverse's Newton iteration needs more than 10 steps). The sliders and the fit enforce this, and the forward model also culls points whose undistorted radius exceeds 1.05 times that radius. For rectilinear lenses, f = (W/2) / tan(HFOV/2); for every lens the UI shows HFOV = 2·θ(W/(2f)). The M2 synthetic sky is an equidistant zenith fisheye with W = H and f = (W/2)/(π/2), which is 325.949 px at 1,024 px, rolled 180°. The sky map uses a pixel projection like the OpenLayers static-image example, so a feature's coordinate is `[u, H - v]`.

The inverse (pixel to sky) undoes flip, principal point and focal length, solves r(1 + k₁r² + k₂r⁴) = r_d by Newton from r = r_d (stop when a step is below 10⁻⁹, at most 10 iterations), un-rolls and inverts the lens in closed form. It returns null when g′ ≤ 0, when the residual is 10⁻⁶ px or more, or for a pixel outside a fisheye's horizon circle; r_d = 0 returns the optical axis. The footprint, the frame-coverage wedge and calibration use it; picking compares projected positions in pixels.

### Types

```ts
type LensModel =
  | "rectilinear"
  | "fisheye-equidistant"
  | "fisheye-equisolid"
  | "fisheye-stereographic"
  | "fisheye-orthographic";

interface Calibration {
  azDeg: number; // optical axis; fixed 0 on a zenith fisheye
  altDeg: number; // 90 on a zenith fisheye
  rollDeg: number; // ρ in x' = x cos ρ − y sin ρ
  focalPx: number; // UI shows HFOV derived from it
  cxPx: number;
  cyPx: number; // principal point
  k1: number;
  k2: number; // radial distortion, all lenses: 1 + 3 k1 r² + 5 k2 r⁴ ≥ 0.05 out to the corner radius
  flipX: boolean; // some all-sky images are mirrored
  streamDelayMs: number; // the only copy; read via selectStreamDelayMs
  rmsDeg: number | null; // quality of the last fit
  updatedAtMs: number;
}

interface CameraSite {
  latDeg: number;
  lonDeg: number;
  heightM: number; // lens above mean sea level (ground + mast): the observer height everywhere
  mastM: number; // lens above local ground: horizon z0 = DEM ground + mastM
  geoidSepM: number; // geoid separation N: GeoPose h = heightM + geoidSepM
  timeZone: string; // IANA zone for local time and burned-in image clocks
}
interface CameraBase {
  id: string;
  name: string;
  site: CameraSite;
  imageSize: { widthPx: number; heightPx: number };
  lens: LensModel;
  defaults: Calibration; // starting guesses
  credit: { text: string; href: string | null; licence: string | null; licenceHref: string | null }; // always on screen
  termsNote: string; // shown next to the credit
}
interface SyntheticCamera extends CameraBase {
  kind: "synthetic"; // computed sky, no image
  source: null;
}
interface StillImageCamera extends CameraBase {
  kind: "still-image";
  source: { imageUrl: string; refreshSec: number; corsEnabled: boolean; captureLagMs: number; exposureSec: number };
}
interface YoutubeCamera extends CameraBase {
  kind: "youtube";
  source: { youtubeVideoId: string; resolverUrl: string | null }; // live IDs change when a stream restarts
}
interface LocalVideoCamera extends CameraBase {
  kind: "local-video";
  source: {
    sidecarUrl: string | null; // ClipSidecar, e.g. "recordings/subaru-2026-10-11-iss.json"; null: picked at runtime
    sourceCameraId: string | null; // the camera the clip was recorded from; null: local-replay
    videoUrl: string | null; // set when the clip loads
    startUtcMs: number | null; // set when the clip loads: UTC of media time 0
  };
}
type CameraConfig = SyntheticCamera | StillImageCamera | YoutubeCamera | LocalVideoCamera;
```

### Calibration flow (the sensor-controls panel)

1. Pause on a frame with stars (a paused YouTube player freezes overlay time with it). Fix pointing first: stars move only 15° per hour, so stream delay does not matter yet.
2. Start from the camera's defaults. Overlay stars to V ≤ 4, the planets and the Moon.
3. **Manual:** sliders with numeric inputs, plus keyboard nudges, for azimuth, altitude, roll, focal length, k1 and principal point.
4. **Assisted:** click a star in the image, then its catalog marker (or pick from the 3 nearest), to make a pair; mark at least 3 pairs as held out. Pairs need clicks on the picture, so they work on still images, clips and the synthetic sky. Over a YouTube player, clicks off a hit target go to the player, so align a YouTube camera with the sliders, or start from the fit made on a recorded clip of the same camera. With 4 or more usable pairs, fit azimuth, altitude, roll, f, cx, cy and k1 by Levenberg–Marquardt on pixel residuals (a zenith fisheye fits roll instead of azimuth and altitude, unless "Fit tilt" frees its axis: Nānā ao is tilted about 1.7°), keeping the distortion constraint at every accepted step. Drop pairs beyond 3σ and refit. Show RMS in pixels and degrees and each pair's residual.
5. **Acceptance:** at least 10 named stars at altitude ≥ 10° (≥ 20° on all-sky cameras), RMS ≤ 0.25°, every star within 0.5°, plus one planet and 3 held-out stars within 0.5°. For scale, f = 2742 px gives 47.9 px per degree at the centre.
6. **Stream delay:** the Subaru default is 50 s, and the slider covers 0–120 s with ±10 s fine control. The quickest estimate is the burned-in HST clock in the video: delay ≈ now − (clock + 10 h). Confirm it by dragging the delay until a bright satellite or the ISS sits on its moving dot, and re-check whenever the stream restarts. `getMediaReferenceTime()` may suggest a value, but it is undocumented: feature-detect it and keep the slider.
7. Persist per camera in `localStorage` under `overhead.calibration.v1` (inside `try/catch`), with JSON export and import. The pose part exports as GeoPose.

### GeoPose export

- Use the OGC GeoPose 1.0 Data Exchange Standard (21-056r11), Basic-YPR form. It is an export-only view: it cannot hold the intrinsics or the stream delay.
- Schema: `https://schemas.opengis.net/geopose/1.0/schemata/GeoPose.Basic.YPR.Schema.json`, vendored in `src/domain/camera/schemas/` (sha256 `5508d26a…765640`) and never fetched at runtime or in CI. All six keys are required, angles are in degrees and h is in metres above the WGS-84 ellipsoid. The Subaru StarCam's default pose exports as `{"position": {"lat": 19.82552, "lon": -155.47587, "h": 4172.32}, "angles": {"yaw": 8.8, "pitch": -19.6, "roll": 0}}`. Do not use the Euler schema or the GitHub draft that says `location`.
- Validate every export with ajv (the default draft-07 `Ajv`). The schema has no ranges and allows extra properties, so `geopose.ts` also checks finite numbers, lat in [−90, 90] and lon in [−180, 180].
- Rotation: an intrinsic z-y′-x″ sequence from the local East-North-Up frame. Rotate by yaw about Up, then by pitch about the new y′ axis, then by roll about the new x″ axis: R = Rz(yaw)·Ry(pitch)·Rx(roll), whose columns are the body axes in ENU. OGC's reference `YPRAngles.ToQuaternion` is the test oracle.
- The standard does not say which camera axis is body x. Convention, documented in `geopose.ts`: x = optical axis, y = image-left, z = image-up. Export yaw = wrap180(90 − azDeg), pitch = −altDeg, roll = wrap180(rollDeg); a zenith fisheye exports (90, −90, roll). Round-trip tests compare rotation matrices or reprojected pixels, never raw angles, which are ambiguous at pitch −90. The official example instances use radians: use them only as schema fixtures.
- Heights: `site.heightM` is above mean sea level, as the DEM and astronomy-engine use. Export h = heightM + geoidSepM (the EGM96 geoid separation; Subaru +24.32 m). The datum difference moves the overlay by under 0.3 px.

## Terrain

Terrain does two jobs: a horizon profile that hides objects behind real ridges in the sky view, and a ground-map hillshade lit by the Sun's position at the clock time.

### Elevation source

- AWS Terrain Tiles, Terrarium PNGs: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, 256 px tiles, maximum zoom 15 (z16 and above return 404). Free, no account. Credit every source in the "Required attribution" block of the dataset's [attribution document](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), with a link. The list may instead be built per view from each tile's `x-amz-meta-x-imagery-sources` header, never from a fixed subset.
- Decode, with channels 0–255: elevation in metres = R × 256 + G + B / 256 − 32768.
- Browser access (CORS) was verified on 2026-10-11: every GET returns `Access-Control-Allow-Origin: *`, so tiles are fetched directly. Use plain GETs only: a HEAD or a request with custom headers fails CORS. No pre-fetch fallback is needed; `scripts/fetch-terrain-fixture.ts` only writes test fixtures.

### Horizon profile (`horizon.worker.ts`)

1. Fetch tiles by distance from the site: z14 within 1.5 km, z12 to 8 km, z10 to 30 km, z9 to 60 km, z8 beyond. That is about 45 tiles (5.5 MB) per site, against 181 tiles (20 MB) for a z12/z10 plan, with negligible angular error. Decode each with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` and a `willReadFrequently` `OffscreenCanvas` 2D context; colour management would corrupt the packed elevations.
2. Camera height z₀ = ground elevation at the site (from z14) + `site.mastM` from `cameras.json` (Subaru StarCam: 13 m).
3. For each azimuth from 0° to 359°, march outward from 20 m. Use 10 m steps near the camera, growing to 1% of the distance. Place samples with the spherical destination formula; never add metres in EPSG:3857, which are 1/cos φ ground metres (1.47× at Walenstadt, a 9° error). Sample elevation bilinearly and clamp it to max(z, 0): Terrarium ocean pixels are seabed depth.
4. At distance d with terrain height z, the apparent angle includes Earth curvature and refraction (κ ≈ 0.13):

```latex
\alpha = \arctan\!\left(\frac{z - z_0 - d^2 (1 - \kappa) / (2R)}{d}\right)
```

5. The horizon for that azimuth is the largest α on the ray. Return a `Float32Array(360)` in degrees and store it in `data.horizon[cameraId].profileDeg`. Until it is ready, everything uses the geometric horizon (0°).
6. March limit: max(100 km, 1.05·√(2R·z₀/(1 − κ))), about 260 km from Maunakea's summit, so the sea horizon is reached. A flat sea seen from 4,204 m gives −1.94° about 248 km out. The real Subaru StarCam profile is not negative everywhere: the summit cones put the horizon at about +1.5° to +2° at azimuth 81° and up to +4.1° near 112–117°, inside the camera's view, while open-ocean azimuths reach −1.93°.
7. In the sky view, project the profile through the camera model as a filled skyline. Dim anything below it and flag it "behind terrain" in the inspector. The DEM is bare earth: domes and buildings are not in it.

Tests: the α formula gives 5.672 ± 0.001° for a 1,000 m wall 10 km away seen from 0 m (the no-curvature 5.7106° must fail). The full march over an analytic plateau (1,000 m everywhere from 10 km out) gives 5.67 ± 0.05°, since sampling makes an exact match flaky.

### Hillshade lit by the real Sun (ground map)

- A `WebGLTile` layer over an `ol/source/ImageTile` source of the same tiles, with `maxZoom: 15` and `interpolate: false` (linear filtering corrupts packed elevations). Do not use `XYZ`: it fails the WebGLTile source type (TS2740). `ImageTile` already defaults `crossOrigin` to `'anonymous'`.
- OpenLayers band values arrive in 0..1, so scale by 255 inside the style expression:

```ts
const elevation = (dx = 0, dy = 0) => [
  "-",
  [
    "*",
    255,
    [
      "+",
      ["*", 256, ["band", 1, dx, dy]],
      ["band", 2, dx, dy],
      ["/", ["band", 3, dx, dy], 256],
    ],
  ],
  32768,
];
```

- Slope and aspect come from neighbour samples via the band offsets, as in the OpenLayers "WebGL Shaded Relief" example, but not its `['resolution']` divisor: that is the view resolution in Mercator metres, wrong at fractional zoom and by cos φ. Divide central differences by 2 × `texelGroundM` instead, a style variable = 40075016.686 / (256 · 2^z) · cos φ for the tile zoom OpenLayers actually uses (`tileGrid.getZForResolution`, never `Math.round`) and the view-centre latitude, pushed on `moveend` and whenever that tile zoom changes.
- Style variables `sunAzDeg` and `sunAltDeg` come from astronomy-engine at the clock time. Declare initial values in `style.variables`, and push Sun updates with `layer.updateStyleVariables(...)` at most once per second.
- When the Sun is below 0°, switch to fixed 315°/45° lighting and show a "night" badge.

## Data sources & endpoints

Everything is free and needs no API key. CelesTrak is the only source that blocks IPs, so a scheduled job fetches it and browsers never do. Still-image cameras are polled by each viewer's browser, so keep to each provider's cadence.

| Source                                                                                  | Provides                                                                                                                                  | Access                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Limits and terms                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CelesTrak GP data](https://celestrak.org/usage-policy.php)                             | Orbital elements (OMM JSON) for the ISS, the brightest satellites and Starlink                                                            | `https://celestrak.org/NORAD/elements/gp.php?GROUP=<stations\|visual\|starlink>&FORMAT=json`, fetched by `scripts/fetch-gp.ts` in `fetch-gp.yml` every 6 h into `public/data/gp/<group>.json` plus `meta.json` (fetch time, count, sha256). Always send `FORMAT=json`: the default became CSV on 2026-05-09.                                                                                                                                                                                 | CelesTrak checks for new data every 2 hours, but the source changes only 2–3 times a day. Skip a group whose `meta.json` stamp is under 2 h old. A repeat download within one update returns 403 "GP data has not updated since your last successful download". Stop on any non-200 and never retry: 50 errors in 2 h blocks the IP. [Since 2026-07-11](https://celestrak.org/) new objects have 6-digit numbers and no TLEs, so use OMM JSON only. Credit CelesTrak. |
| [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/) (WMTS) | GOES-West infrared every 10 minutes; daily true colour; coastline and label overlays                                                     | KVP endpoint `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi` (GetCapabilities, GetTile with `Time=YYYY-MM-DDThh:mm:ssZ`). REST tile template, for reference: `…/epsg3857/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{row}/{col}.{png\|jpeg}`. Availability: `…/epsg3857/best/1.0.0/{Layer}/default/{TileMatrixSet}/all/{start}--{end}.xml` (DescribeDomains). Layers: `GOES-West_ABI_Band13_Clean_Infrared` (GoogleMapsCompatible_Level6), `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (alternate `VIIRS_NOAA21_…`), `Coastlines`, `Reference_Labels` (Level9; not the `_15m` variants). `scripts/fetch-gibs-caps.ts` writes a trimmed capabilities snapshot. | Geostationary layers keep a rolling 90 days. GOES tiles arrive 20–40 minutes after observation, the newest advertised step flaps between replicas, and gaps (about 2% of steps) return 404. GOES-West covers Hawaii, not Europe. Credit: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." Overlays: "© OpenStreetMap contributors, Natural Earth". |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles)                        | Global elevation as Terrarium PNG tiles                                                                                                   | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, z0–15, CORS `*` on GET                                                                                                                                                                                                                                                                                                                                                                                             | No account needed. Credit every source in the attribution document's "Required attribution" block (see Terrain).                                                                                                                                                                                                                                                                                                                  |
| [Subaru-Asahi StarCam](https://arxiv.org/html/2508.00245v1)                             | Live east-facing sky video from Maunakea; 70° × 40° view centred at az 81.2°, alt 19.6°; stars to about magnitude 8                       | YouTube embed, video ID `Kj5DjRYkzD8` as of 2026-10-11. Resolve the current ID at runtime from `https://astroasahi.github.io/maunakea_east/` (CORS `*`; a meta refresh to `youtu.be/<id>`). `https://www.naoj.org/PIO/LiveCam/cam_redirect.html` is a JavaScript redirect without CORS: by hand only. Never use `embed/live_stream?channel=`: the channel runs several cameras. Clips (O2): `scripts/record-clip.ts` cuts a UTC window from the stream's DVR window, format 270 (1080p H.264, video only; the stream has no muxed formats). | Credit "NAOJ & Asahi Shimbun" on screen; non-commercial use. On 2026-10-11 the DVR window held the last 3,600 s, so record a pass within the hour. Live IDs change when the stream restarts. |
| [CFHT-Asahi StarCam](https://www.cfht.hawaii.edu/en/gallery/starcam.php)                | Live west-facing 4K sky video; shows satellites and aircraft                                                                              | YouTube embed, video ID `Q3UhCgsWDw8` as of 2026-10-11, resolved from `https://astroasahi.github.io/maunakea_west/`. `qh6Nqiq6LIg` from the [Feb 2025 announcement](https://subarutelescope.org/en/news/topics/2025/02/03/3503.html) ended on 2025-09-25.                                                                                                                                                                                                                                       | Best-effort uptime. Credit "CFHT & Asahi Shimbun in collaboration with Subaru Telescope, NAOJ" on screen; non-commercial use.                                                                                                                                                                                                                                                                                                     |
| [CFHT Nānā ao](https://www.cfht.hawaii.edu/en/gallery/nanaao.php)                       | Two zenith fisheyes, optical and infrared, covering over 90% of the night sky; a new image every 60 s while the hatch is open, sunset to sunrise Hawaii time | `https://www.cfht.hawaii.edu/~nanaao/last_vis.png` and `last_ir.png` (not `last.png`, a 3-panel mosaic). Poll at most once a minute; 404 means the hatch is closed. No CORS headers: leave `crossOrigin` unset. The capture time exists only as the HST clock burned into the image, to the minute. North up, east right.                                                                                                                                                                          | © CFHT, GNU Free Documentation License 1.3 or later. Credit "© CFHT" with a link to the licence.                                                                                                                                                                                                                                                                                                                                  |
| [AllSkyKamera network](https://www.allskykamera.space/kamera.php?k=ASK053)              | Hobbyist all-sky cameras with published coordinates, refreshed every 1–4 minutes                                                          | ASK053 in Walenstadt (47.1236°, 9.3242°, ground about 467 m) sits in an Alpine valley: the terrain demo site. `https://www.allskykamera.space/imageProxy.php?cam=ASK053&type=image&variant=auto` serves a 1920 × 1440 JPEG with CORS `*`; poll every 120 s. The capture time is the burned-in Europe/Vaduz timestamp (or manual entry), taken at mid-exposure; night exposures are 60 s, so satellites are drawn as 60 s arcs.                                                                 | Ask the owner; the camera is added only after written permission, recorded in `docs/DECISIONS.md`. Credit the camera and owner.                                                                                                                                                                                                                                                                                                  |
| Yale Bright Star Catalog (BSC5)                                                         | 9,110 entries (9,096 stars with positions), complete to about V 6.5; 8,404 rows at V ≤ 6.5                                                 | `https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz`, converted at build time by `scripts/build-stars.ts`; proper names from IAU-CSN by HR number                                                                                                                                                                                                                                                                                                                                             | Credit "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR" (DOI 10.26093/cds/vizier); names: IAU WGSN.                                                                                                                                                                                                                                                                                             |

### `cameras.json` starting entry

`public/data/cameras.json` is an array of `CameraConfig` in picker order. The default camera is `synthetic-maunakea`, the computed sky at the Polaris fixture site; ids are part of the URL contract. Every entry (synthetic Maunakea and Walenstadt, Nānā ao, both StarCams, local replay, ASK053) is listed in `docs/implementation/README.md` §2: M1 commits every known entry, and each milestone enables its own. The Subaru StarCam, as M5 enables it:

```json
{
  "id": "subaru-starcam",
  "name": "Subaru-Asahi StarCam (east, live)",
  "kind": "youtube",
  "source": {
    "youtubeVideoId": "Kj5DjRYkzD8",
    "resolverUrl": "https://astroasahi.github.io/maunakea_east/"
  },
  "site": {
    "latDeg": 19.82552,
    "lonDeg": -155.47587,
    "heightM": 4148,
    "mastM": 13,
    "geoidSepM": 24.32,
    "timeZone": "Pacific/Honolulu"
  },
  "imageSize": { "widthPx": 3840, "heightPx": 2160 },
  "lens": "rectilinear",
  "defaults": {
    "azDeg": 81.2,
    "altDeg": 19.6,
    "rollDeg": 0,
    "focalPx": 2742,
    "cxPx": 1920,
    "cyPx": 1080,
    "k1": 0,
    "k2": 0,
    "flipX": false,
    "streamDelayMs": 50000,
    "rmsDeg": null,
    "updatedAtMs": 0
  },
  "credit": {
    "text": "NAOJ & Asahi Shimbun",
    "href": "https://www.youtube.com/channel/UCiN7OwV8g8dMm_E0xphBVig",
    "licence": null,
    "licenceHref": null
  },
  "termsNote": "Non-commercial use only"
}
```

- Site and pointing come from arXiv 2508.00245: the camera is 13 m above DEM ground of about 4,135 m (so `heightM` 4148), and its field is centred at az 81.2°, alt 19.6° (Table 2.3). Calibrate on night frames: the field shifts slightly in daytime as the handrail warms.
- `focalPx` 2742 gives a 70° horizontal view at 3840 px; the vertical view it implies (43°) is close to the published 40°. The lens (24 mm on a 35.6 mm-wide sensor) suggests about 2589 px. Calibration settles it: a star fit on the 2026-10-11 clip (73 stars, rms 0.03°) gave az 81.2322°, alt 19.6185°, roll 0.7698°, f 2525.93 px (74.5° wide) and k1 −0.00992, and the clip's sidecar carries it. With the defaults, the ISS marker on that pass is up to 3.0° off.
- `streamDelayMs` 50,000: the default embed plays 45–57 s behind real time, and 23 s even at the live head.
- `youtubeVideoId` is the last known ID; the app resolves the current one from `resolverUrl` at runtime.

## Feature spec & UI

This section fixes what exists and how it behaves. Layout and look are provisional: the visual design is settled during the build from screenshots. The screen holds the sky view, the ground map and a timeline, and stays usable on a narrow screen.

### Sky view

The background depends on the camera kind:

- **synthetic:** no image. The computed sky in an equidistant zenith fisheye (M2), the default camera.
- **still-image:** an `ImageStatic` layer in the pixel projection with extent `[0, 0, W, H]`. `ImageStatic` has no `setUrl` and `refresh()` does not refetch, so every `refreshSec` (60 s minimum) create a new source with a cache-busting query, and start the next only after `imageloadend` or `imageloaderror`. On an error keep the old image; the status becomes offline (404 means the hatch is closed), or daytime while the Sun is up at the site. Set `crossOrigin` only when `corsEnabled`. Overlay time is the image's capture time, never the fetch time. Exposures over 1 s draw satellites as arcs. Pan and zoom are allowed.
- **youtube (O1):** the YouTube IFrame Player itself, with the transparent sky map drawn on top of it in one sky stage. Overlay time is the player's media clock minus the stream delay.
  - Pointer pass-through: `pointer-events: none` on the map target element itself (on `.ol-viewport` alone it still blocks the iframe), so the player's controls stay usable. Each drawn object except Starlink (the ISS, visual-group satellites, stars, the Sun, Moon and planets, and the selected object) gets a DOM hit target, a button placed with `ol/Overlay` and `stopEvent: false`, at least 24 × 24 px.
  - Fullscreen: create the player with `playerVars.fs: 0`, because YouTube's own fullscreen shows the video without the overlay. A Fullscreen button outside the stage calls `stage.requestFullscreen()`, so player and overlay go fullscreen together.
  - Content box: the overlay tracks the video's content box exactly (16:9 on both StarCams), including the letterboxing inside the iframe (for example fullscreen on a 16:10 screen), and refits on every resize: `view.fit([0, 0, W, H], { size })` gives exactly that centred box.
  - States: loading, playing, buffering, paused, ended, error and embed-blocked (errors 101, 150 and 153). Error 150 also comes back for an ended or unknown id, so the app re-resolves the id once before showing the blocked state. Error 153 means no Referer was sent, so never set `Referrer-Policy: no-referrer`. If embedding is blocked, fall back to replay: the recorded clip of this camera, or a local clip.
  - The iframe is cross-origin, so never try to read its pixels.
- **local-video:** a `<video>` element whose frames are drawn into an `ImageCanvas` source (`ratio: 1`), calling `source.changed()` from `requestVideoFrameCallback` and on `seeked` (a paused seek may deliver no frame callback). The video is the master clock: overlay time = `startUtcMs + mediaTime × 1000`. Chromium accepts `playbackRate` only from 0.0625 to 16, so 60× and 600× are hidden while a video is loaded. Each clip comes with a `ClipSidecar` JSON (UTC of media time 0, the source camera, an optional calibration, the credit): `subaru-2026-10-11-iss` loads its sidecar from `recordings/`, and `local-replay` takes a picked clip and sidecar (O2). Pan and zoom are allowed.

Layers, top to bottom (the stacking order; how each looks is settled from screenshots):

1. Selection halo and labels.
2. Terrain skyline from the horizon profile, with a fill below it that dims everything behind terrain.
3. Satellites: the ISS emphasised; sunlit and shadowed objects are told apart without relying on colour. Trails for the last 30 s and a distinct path for the next 2 minutes.
4. Sun, Moon and planets, labelled.
5. Stars to V ≤ 4.5 by default (V ≤ 4 while calibrating), sized by magnitude.
6. Altitude/azimuth grid every 10°, with cardinal letters on the horizon.
7. The camera image or clip frame (still-image and local-video cameras only).

**Over video** (youtube and local-video cameras) the sky view draws a light set by default, readable on moving video:

- the ISS and the visual-group satellites in the frame;
- labels only for the ISS, the selected or hovered object, the Sun, the Moon and the planets;
- stars to V ≤ 2 as small marks, each named on hover (V ≤ 4 while calibrating);
- the selected object's halo, its 30 s trail and its next 2-minute path, and no other trails;
- the terrain skyline as a thin line, plus behind-terrain dimming.

Starlink, the grid and dense labels are off on the video, and each is one toggle away (`layers.video`). The light set changes only what the sky view draws: the worker, the Inspector and the ground map keep everything.

An "incoming" chip appears when a satellite will enter the camera frame within 60 s. Once a second the worker takes each candidate (apparent altitude above −5° now, in a shown group whose Sun cutoff is met now, not already in the frame), propagates it at t+5 to t+60 s in 5 s steps, and runs each sample through the camera model, the sunlit test and the terrain horizon. There is no "sunlit now" filter: a satellite leaving Earth's shadow inside the frame is an entry too. Alerts pause while replay plays at 60× and 600×. Hovering any object shows its name, NORAD ID (satellites), azimuth, altitude, range, lit state and magnitude where known.

### Ground map (EPSG:3857)

- GIBS daily true colour from `VIIRS_NOAA20_CorrectedReflectance_TrueColor`, dated to the latest 13:30 local-mean-solar-time pass at the site (NOAA-20's afternoon pass) that is at least 4 h before the clock. Never use the clock's UTC date or the capabilities `Default` time: both are often unprocessed (a black tile) or night at the site. Plus the `Coastlines` and `Reference_Labels` overlays.
- GOES-West infrared, semi-transparent. Time = the latest available step ≤ the clock rounded down to 10 minutes, taken from the layer's DescribeDomains intervals; the newest step is confirmed with a HEAD request, and a step whose tiles fail is dropped for the session, which falls back one step. Label it "Imagery as of HH:MM UTC".
- Sun-lit hillshade (see Terrain).
- Camera site marker with a wedge showing the azimuth range the frame actually covers, from the inverse-projected boundary, or a full circle when the zenith is in frame. HFOV is not that range: at f 2742 px and alt 20° the frame spans 82.0° of azimuth, not 70°.
- The camera's view at orbit height, with a height dropdown: the selected satellite's current height (default), 420 km or 480 km.
- Satellite positions as one `MultiPoint` per group and lit/shadowed class on a `WebGLVector` layer, written in place each frame; the ISS, the selected and the hovered satellite are separate labelled points. Picking is a nearest-neighbour search in pixel space (about 6 px) over the worker's arrays. `WebGLVector` rebuilds only when the view is idle, so bulk points pause during pans and zoom animations.
- Ground tracks for the selected and in-frame satellites, on a canvas vector layer.
- Optional: the day/night terminator, built from the subsolar point.

### Panels

- **Timeline:** live/replay toggle, play/pause, rate (1×, 10×, 60×, 600×; 1× and 10× while a clip is loaded), a ±12 h scrubber, a "Now" button, UTC and camera-local time, twilight markers and ticks where GOES imagery exists. In live mode on a YouTube camera the rate is locked to 1, and any play/pause, scrub, step or rate change switches to replay.
- **Camera picker:** every enabled entry in `cameras.json`, with live, offline, daytime or unknown status.
- **Calibration (the sensor-controls panel):** sliders with numeric inputs, the star-pair list with residuals and held-out flags, a Fit button, the RMS readout, a stream-delay control (0–120 s, ±10 s fine), Reset, JSON export and import, and Export GeoPose.
- **Layers:** one toggle per boolean in `LayersState`, plus the star magnitude limit and the footprint height. Over a video, an "On the video" group adds Starlink, grid and dense labels.
- **Inspector:** the selected object's name, NORAD ID, azimuth, altitude, range, lit state, element-set age, behind-terrain flag and incoming ETA, plus "Show on map" and "Follow".
- **Credits:** the credit of every visible source, and the active camera's credit and terms note at all times.
- **Stretch, tracking mount:** pick a target and watch a simulated mount chase it with a 3°/s slew limit and an acceleration limit. Show its field-of-view box in the sky view and the pointing error over time. An overhead ISS pass shows why the limits matter.

### Interactions

- A click in either view sets `selection.selectedId`, and both views highlight it on the next frame.
- Keys: Space play/pause · ←/→ step 1 s (Shift: 1 min) · `[` `]` change rate · C calibration · L layers · Esc exits the tour, else cancels a pending calibration point, else clears the selection. In calibration, ←/→ nudge azimuth (roll on a zenith fisheye) and ↑/↓ altitude by 0.05° (Shift: 0.5°), and time stepping is off. Shortcuts are ignored while focus is in a text field, slider or select, for keys a focused map has already handled (its arrows, + and − pan and zoom it), with Alt, Ctrl or Meta held, and for Space on a button (Space presses the button). Each has an on-screen control, and the keyboard shortcuts list shows them all.
- Shareable URLs carry the state, for example `?cam=subaru-starcam&t=2026-10-10T15:30:00Z&sel=sat:25544`. The URL is parsed once before the first render (`t` means replay, paused, and must end in `Z`; without `t` the app starts live) and written with `history.replaceState` 250 ms after the last discrete change, never per frame. "Copy link" builds the link from the store, with the current time.
- Accessibility: every control is keyboard-reachable with a visible focus ring; `prefers-reduced-motion` hides trails and turns off view animations; meaning never rides on colour alone; the incoming chip holds an `aria-live="polite"` element that announces only a new first entry; each map container has an `aria-label`, and the sky view has a text list of what is above the horizon; targets are at least 24 × 24 px.

## Milestones & acceptance criteria

Ten milestones, each shippable and demoable on its own; the first three already make a respectable demo, so build in order and deploy after every one. M7 needs only M1 and may run in parallel. Each milestone has a stage file in `docs/implementation/` with numbered steps and tests; the milestone map in its README (§2) is authoritative.

- [ ] **M0 · Scaffold.** Vite, React, TypeScript 7 strict with four project references, the full store types and initial state, the replay clock loop, Biome, Vitest, Playwright (Chromium, `vite preview` under the `/overhead/` base), Node 26 (`.nvmrc` `26`, `engines.node` `>=26`), CI on every push, the GitHub Pages deploy from Actions (H1).
  - `npm run typecheck`, `lint`, `test`, `build` and `e2e` exit 0 in CI, and the smoke e2e loads the app with no console errors. CI never runs `npm run dev`: the dev server never exits.
- [ ] **M1 · Ground map.** GIBS VIIRS true colour (KVP, from the capabilities snapshot) with the coastline and label overlays, the camera site marker, `cameras.json` with every known camera (only `synthetic-maunakea` enabled), the live clock for synthetic cameras, Timeline, Layers panel, Credits, `?cam=` and `?t=`, the StrictMode-safe map lifecycle.
  - An e2e test asserts that after a date change every true-colour tile request carries the new Time and none carries the old one.
- [ ] **M2 · Synthetic sky.** The astro domain (Sun, Moon, planets, inline star loop, twilight), `stars.json`, the zenith equidistant fisheye forward model and a pixel-space sky map, the altitude/azimuth grid, twilight markers.
  - The Polaris fixture passes within 0.01°.
  - Planet positions match a JPL Horizons AIRLESS table within 0.05°; twilight times within 60 s.
  - At W = H = 1024, the north horizon lands at map `[512, 1024]` and east at `[0, 512]`.
- [ ] **M3 · Satellites.** `fetch-gp` script and workflow, the propagation worker (fixed grid, ping-pong buffers), the ISS and visual group in both views (Starlink on demand), trails and ground tracks, lit state and visibility, selection sync, hover details, a basic Inspector, `?sel=`.
  - ISS azimuth and altitude within 0.05° of a reference pass generated with Skyfield and saved as a fixture.
  - Clicking the ISS in the sky view, or loading `?sel=sat:25544`, highlights it on the ground map on the next frame and fills the Inspector.
- [ ] **M4 · Camera model and still images.** All five lens models with the k1/k2 tail and the inverse, proj4 cross-check tests, the calibration panel (manual and assisted fit), the Nānā ao still camera as background, persistence, the camera picker, the site wedge, GeoPose export validated by ajv.
  - On the committed star-pair fixture, the calibration acceptance above holds (RMS ≤ 0.25°, every star ≤ 0.5°, one planet and 3 held-out stars ≤ 0.5°), and the exported GeoPose validates.
- [ ] **M5 · Live video.** The computed sky drawn on both YouTube StarCams (O1): the player under the sky map with pointer pass-through and `ol/Overlay` hit targets, stage fullscreen with `fs: 0`, the light overlay set and its toggles. Runtime video-ID resolution, the video panel with its states and the embed-blocked fallback to replay, the live clock from the player's media time, the stream-delay control. Clip cameras from a `ClipSidecar` (`subaru-2026-10-11-iss` from `recordings/`, `local-replay` picked at runtime), `scripts/find-passes.ts` and `scripts/record-clip.ts` (O2).
  - On the recorded 2026-10-11 ISS pass, with the star calibration from the clip's sidecar and the committed snapshot's element sets (`tests/fixtures/gp/`, ISS epoch 2026-10-09T22:48:38Z, 40.3 h before the pass, copied into `public/data/gp/` for the check and not committed), the ISS marker is within 1° of the ISS wherever the ISS is visible on the video: media 78.7–228.0 s, 238.0–241.5 s, 256.0–258.4 s and 260.8–290.43 s (the domes hide it in between). A manual check: click the ISS every 2 s of clip time over those spans, every residual ≤ 1.0°, with a short screen clip in the pull request. With the default pointing the marker is up to 3.0° off.
  - The e2e test with the YouTube stub passes, including a click on an empty part of the overlay reaching the player and a click on a hit target selecting its object.
- [ ] **M6 · Terrain.** Horizon worker, skyline, behind-terrain dimming, visibility against the profile, the sun-lit hillshade, terrain credits, `synthetic-walenstadt`.
  - The wall formula gives 5.672 ± 0.001° and the plateau march 5.67 ± 0.05°; a flat sea from 4,204 m gives −1.94 ± 0.01° at 248 ± 2 km.
  - From committed Walenstadt tiles: 32.7 ± 0.3° at azimuth 0° and 2.0 ± 0.3° at 270°, and the skyline follows the ridge by eye.
- [ ] **M7 · Weather imagery.** GOES-West 10-minute overlay synced to the clock (KVP, tile-matrix limits removed), DescribeDomains polling, the HEAD-confirmed newest step and 404 fallback, the "imagery as of" label, GOES ticks on the timeline.
  - Scrubbing across a 10-minute boundary changes Time exactly once (unit test) and gives exactly 2 distinct Time values in tile requests (e2e).
- [ ] **M8 · Footprint and alerts.** The orbit-height footprint polygon (spherical model, Earth-hit rejection, horizon clip), its height dropdown and the "incoming" chip.
  - A straight-up ray gives t = H − h and hits the site within 10⁻⁹°; a −3° ray from 4,204 m is rejected.
  - On the 2026-10-11 clip, with the M5 element sets, the chip shows the ISS before it enters the frame: before media 78.7 s with the clip's fitted calibration, and before its predicted entry at 15:09:54.955Z (media 84.8 s) with the Subaru defaults.
- [ ] **M9 · Polish and ship.** Demo mode (it opens on the recorded 2026-10-11 ISS clip with the overlay and ends on the live StarCam), a performance pass, an accessibility pass, a README with the architecture diagram, talking points and credits, how (or whether) a recorded clip, and element sets from near its pass, reach the deployed build (recordings are never committed, and the 2026-10-11 clip is 148.6 MB, over git's 100 MB per-file limit; a GitHub Pages site must stay under 1 GB), then a production deploy.
  - Chrome performance traces with Starlink loaded, attached to the pull request: unthrottled ≥ 59 fps with a frame p95 ≤ 6 ms, and at 4× CPU throttling ≥ 55 fps with a frame p95 ≤ 16 ms.
  - Lighthouse accessibility score of 90 or more.

Recorded clips never run in CI: the M5 and M8 clip checks are manual, and e2e uses the generated test-pattern clip.

Stretch goals, in any order: the tracking-mount simulator; pygeoapi serving `cameras.json` as OGC API – Features; camera frames modelled in the SensorThings API; Meteosat imagery for European cameras (no GIBS geostationary layer covers Walenstadt; EUMETSAT's WMS at `https://view.eumetsat.int/geoserver/wms`, layer `mtg_fd:ir105_hrfi`, does).

## Testing, performance & gotchas

All math is pinned by fixtures, CI never calls a third-party service, and app code on the hot path allocates nothing per frame. Every fixture, with its generator, date and tolerance, is listed in `docs/implementation/README.md` §8.

### Unit tests (Vitest)

- **Setup:** `environment: "node"`. `tests/unit/setup.ts` replaces `fetch` with a stub that throws. Seeded tests use mulberry32 with seed 20261011. Performance is never asserted in Vitest.
- **Lenses:** closed form vs proj4 for all five models at 50 seeded points per pose (within a relative 10⁻¹² · max(1, ‖p‖); rectilinear points inside the image, fisheye points within 90° of the axis, tilted poses included). Forward then inverse round trip < 10⁻⁶ px. Orientation: facing west (az0 270°, alt0 20°, f 2742, cx 1920), azimuth 300° lands at u ≈ 3381; a 1024 px zenith fisheye at roll 180° puts north at map `[512, 1024]` and east at `[0, 512]`. Frame coverage at f 2742, 3840 × 2160, az0 90°: an azimuth span of 70.0° at alt0 0°, 82.0° at 20° and 117.1° at 45° (± 0.05°).
- **Astronomy:** the Polaris fixture (± 0.01°). Planets against a JPL Horizons OBSERVER table with `APPARENT=AIRLESS`, compared with `Horizon(..., undefined)` as great-circle separation < 0.05° on rows with elevation > 0. Twilight from 2026-10-10T10:00Z at the Polaris site: dusk 2026-10-11T04:24:11Z, dawn 2026-10-10T15:53:03Z, ± 60 s. `Refraction('normal', alt)` at 0°, 10°, 20°, 45°: 0.48303, 0.09013, 0.04569, 0.01688 (± 10⁻⁵).
- **Orbits:** an ISS reference pass from `scripts/fixtures/iss-pass-skyfield.py` on the committed OMM snapshot: azimuth and altitude ≤ 0.05°, range ≤ 0.1 km, sub-point ≤ 0.005°, sunlit transitions within 2 s. `propagate` returning `null` is handled; antimeridian unwrapping; Bowring vs `eciToGeodetic` < 10⁻⁶° in latitude over the whole snapshot (measured about 10⁻⁷°).
- **Footprint:** from 4,204 m with H = 420 km, a straight-up ray gives t = 415.796 km (H − h) and hits the site within 10⁻⁹°; a ray at altitude −3° hits the Earth 93.4 km out and is rejected (inside the polygon walk, directions below the horizon are replaced by points on the clip curve before any ray is cast); the dip is −2.081°.
- **Terrain:** Terrarium decode ((128, 0, 0) gives 0 m; (137, 219, 68) gives 2523.2656 m); the wall and plateau tests above; flat sea from 4,204 m gives −1.9407° at 248.1 km (± 0.01°, ± 2 km); Walenstadt from committed tiles (ground 467.6 ± 3 m).
- **GeoPose:** ajv validates the official instances and every export; round trips compare rotation matrices within 10⁻¹².

### End-to-end tests (Playwright)

- Chromium only, headless, against `vite preview` under the `/overhead/` base (H1). Every spec uses the shared fixture in `tests/e2e/fixtures.ts`. It mocks GIBS (tiles, DescribeDomains, HEAD probes; the capabilities snapshot is same-origin), Terrarium tiles, the YouTube IFrame API (a stub player), the astroasahi resolver pages, camera images and `data/gp/*.json`. It aborts and fails on any other third-party request, and fails on any console error or uncaught exception.
- The app loads and both maps render.
- A date change changes Time in every true-colour tile request (decode `%3A` before matching).
- Selecting the ISS (click or `?sel=sat:25544`) highlights it in both views and fills the Inspector.
- Calibration export downloads valid JSON, and the GeoPose export validates.
- The video panel handles playing, buffering and embed-blocked with the stub. The player is created with `fs: 0`; a click on an empty part of the overlay reaches the player, and a click on a hit target selects its object.
- Both clip cameras load the generated test-pattern clip: picked (`local-replay`) and through a `recordings/` route (`subaru-2026-10-11-iss`).
- Crossing a 10-minute boundary gives exactly 2 distinct GOES Time values.

### Performance budgets

Benchmarks run in Chromium through Playwright (`npm run perf`), never in Node: the app propagates in browser workers, so that is what the budgets measure. From M9 they use Chrome for Testing with the GPU, because the default headless shell renders WebGL in software.

| Work                                                     | Rate                                                   | Budget                                                       |
| -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Main thread per frame (clock, bindings, satellites, sky) | 60 fps                                                 | ≤ 6 ms per frame (p95); at 4× CPU throttling ≥ 55 fps and ≤ 16 ms |
| Propagation worker, ISS + visual (about 178 objects)     | 10 Hz on the fixed grid                                | ≤ 4 ms per tick (p95)                                        |
| Propagation worker, with Starlink (about 11,280)         | 10 Hz                                                  | ≤ 10 ms per tick (p95); about 2–5 ms with M9's culling       |
| Incoming pass, with Starlink                             | 1 Hz                                                   | ≤ 20 ms (p95)                                                |
| Stars, planets, Sun, Moon                                | whenever sim time moves ≥ 2 s (every frame at 600×)    | ≤ 2 ms per pass (p95), cold first pass excluded              |
| React commits while playing, no input                    | one shared 4 Hz ticker                                 | ≤ 4 commits per second (React Profiler, development build)   |

Moving satellites are one `MultiPoint` per group and style class (`WebGLVector` on the ground map, canvas in the sky view), with coordinates written into its flat array in place and one `geometry.changed()` per frame: per-feature `setCoordinates` costs 13–46 ms per frame for 11k points on either renderer, this path 1–4 ms. Create each `MultiPoint` with its initial coordinates (an empty one never renders on `WebGLVector`). Typed arrays are allocated once and reused; worker buffers ping-pong.

### Gotchas

- **Overlay on the YouTube player:** `pointer-events: none` goes on the map target element itself; on `.ol-viewport` alone the map still blocks the iframe. The page gets no pointer events over the cross-origin iframe, so pass-through cannot be switched on hover: clickable objects get `ol/Overlay` hit targets with `stopEvent: false`. YouTube's own fullscreen hides the overlay, so set `playerVars.fs: 0` and fullscreen the stage. The player letterboxes inside its iframe, so fit the sky map to the same contain box on every resize.
- **YouTube embeds:** live IDs change when a stream restarts. A channel can disable embedding (errors 101 and 150; 150 also means an ended or unknown ID), and a page that sends no Referer gets error 153. Fall back to replay.
- **Recording clips:** cut the window from the DVR window after the pass, while its start is still inside the window (3,600 s on 2026-10-11). Never record at the live edge and stop with Ctrl-C: on 2026-10-11 that left MPEG-TS under an `.mp4` name, which Chromium cannot play. yt-dlp's `--download-sections` does not help: with `--live-from-start` it aborts, and without it it silently records the live edge instead of the asked window. Remux to MP4 with `-movflags +faststart`, and take media 0 from the burned-in clock.
- **Element sets on replay:** the app propagates whatever `public/data/gp/` holds, so a recorded clip is only as accurate as the element set's distance from its pass. On the 2026-10-11 pass the ISS ephemeris ran 0.08 s, 0.30 s and 0.88 s behind the clip with element sets from 20 h, 11 h and 40.3 h before, and 2.9 s behind with a NASA ephemeris made on 2026-10-07; day-old Starlink sets were off by −16.3 to +7.8 s along track. Replay a clip with element sets from near its pass: the M5 check uses the committed snapshot, and M9 settles what a deployed tour uses.
- **Stream delay:** live overlays are wrong by seconds until the delay is calibrated. YouTube latency grows with every rebuffer and never catches up, so live time follows the player's media clock, not `Date.now()` alone. For still images, use the capture time.
- **proj4 2.22.0:** `gnom` and `laea` return `NaN` without `+x_0=0 +y_0=0`. Use the spherical source `+proj=longlat +R=1 +no_defs`, and call `forward<[number, number]>(...)` so results are not `number[]`.
- **OpenLayers pixel space:** y points up, so a pixel (u, v) becomes `[u, H - v]`.
- **OpenLayers updates:** every `setCoordinates` updates the spatial index and fires a source change; there is no batch API. Use the `MultiPoint` path. `WebGLVector` draws nothing beyond ±180°, so tracks stay on canvas.
- **OpenLayers lifecycle:** `map.dispose()` does not dispose layers, and a disposed layer cannot be reused (integration rule 1).
- **GIBS:** in REST mode each time-enabled layer lists 3 tile templates, 2 without `{Time}`, and OpenLayers spreads tiles across them: use `optionsFromCapabilities(caps, { layer, matrixSet, requestEncoding: 'KVP' })`. Delete `TileMatrixSetLimits` from GOES layers first (OpenLayers keeps only the first range per level). Send seconds in Time (`hh:mmZ` returns 400). Never leave a source on a Time that returns 404: OpenLayers then re-renders every frame and never fires `rendercomplete`.
- **GOES:** imagery arrives 20–40 minutes late and has gaps. Treat a 404 tile as "no data" and fall back to the previous step. A demo clip must be under 90 days old for the overlay to match.
- **CORS:** Nānā ao sends no CORS headers. Leave `crossOrigin` unset (setting it makes the load fail); the image still displays in `ImageStatic` with the Canvas renderer, but it taints the canvas, so never call `getImageData` on it or feed it to WebGL. Terrarium, GIBS and ASK053 send `Access-Control-Allow-Origin: *`; Terrarium allows only plain GETs.
- **CelesTrak:** browsers never call it. Always send `FORMAT=json`. The job stops on the first non-200, including the 403 for a repeat download.
- **Catalog numbers:** OMM only. Never assume 5-digit NORAD IDs in parsing, regexes or column widths.
- **astronomy-engine time:** a number means days since J2000, not epoch ms. Pass a `Date` or an `AstroTime`.
- **Float32 time:** epoch ms in a `Float32Array` lose about 23.5 s. `timeMs` travels as a plain number.
- **Refraction:** one `'normal'` model at every altitude for stars, planets and satellites. Only the Sun's twilight cutoff uses geometric altitude.
- **Terrarium:** ocean pixels are seabed depth, so clamp to 0 for the horizon. Decode with `colorSpaceConversion: 'none'`. Never step distances in EPSG:3857 metres.
- **Vite workers:** without `worker: { format: 'es' }` the build fails once satellite.js is imported.
- **Daytime and cloud:** the overlay still draws positions. Label the view "daytime" or "clouded out"; demos use replay.
- **Mirrored all-sky images:** expose `flipX`. Nānā ao is north up, east right: start from roll 180° with `flipX` on.
- **Credits:** show each feed's and layer's credit on screen while it is visible, including OpenStreetMap for the GIBS overlays. A recorded clip shows its sidecar's credit ("NAOJ & Asahi Shimbun" for the StarCam clips).
- **TypeScript 7:** settled. Biome and `tsc -b` work; typescript-eslint, vite-plugin-checker and ts-morph do not. `lib` needs `ESNext.Disposable`, and `baseUrl` is gone.

## Demo script & working agreement

The demo opens on the recorded 2026-10-11 ISS pass (`subaru-2026-10-11-iss`) with the overlay drawn on the video, so it never depends on Hawaiian weather; the live StarCam with the overlay on the player is the closing bonus if it is twilight on Maunakea.

### Five-minute demo

1. **0:00 · Replay.** Play the 2026-10-11 clip from about 30 s before the ISS enters (it enters at media 78.7 s, and the chip looks 60 s ahead). The "incoming" chip already flags the ISS, which enters the Subaru StarCam frame at the right edge and slides down toward the domes with its label riding it. Line: "Every label comes from public orbital data; nothing is placed by hand."
2. **0:45 · Linked views.** Click the ISS on the video. The ground map highlights its track crossing the camera's orbit-height footprint. Turn on Starlink: thousands of dots on the ground map, while the video stays readable (Starlink on the video is one toggle away).
3. **1:30 · Sensor controls.** Open calibration: this clip's pointing comes from a 73-star fit with an RMS of 0.03°, carried in its sidecar. Click one star and its catalog marker to show how a pair is made, then show the stream-delay control used on live video. Line: "The lens is a map projection; stars fix pointing, satellites fix time."
4. **2:30 · Imagery.** Turn on GOES-West infrared at the same moment: the clouds in the camera match the satellite view (GIBS keeps 90 days, so this clip matches until about 2027-01-09). Scrub time to show the WMTS Time dimension updating.
5. **3:15 · Terrain.** Switch to Walenstadt (the ASK053 image once its owner has agreed, otherwise the synthetic Walenstadt sky): the computed skyline traces the ridge, a satellite sets behind it, and the hillshade is lit by the real Sun.
6. **4:00 · OGC.** Export the camera pose as GeoPose and show it passing schema validation.
7. **4:30 · Architecture.** Two maps, one clock, workers for the math, no React renders per frame. Then switch to the live Subaru StarCam with the overlay on the player, if it is twilight on Maunakea.

`?demo=1` runs this tour automatically with captions, in case the network misbehaves on the day. It runs on the recorded clip wherever `recordings/` is served (dev, or a deploy that carries the clip; M9 settles which), and elsewhere on a picked clip or the computed sky. Keep a screen recording of the full tour as a last-resort backup.

### Working agreement for the coding agent

- Build milestone by milestone. One pull request per milestone, on a branch `m<N>-<slug>`, with tests and an updated README section. Do not start the next milestone until the current one's acceptance criteria pass.
- Keep `src/domain` pure. Write the test first for every formula in this brief, with the fixture value and tolerance from `docs/implementation/README.md` §8.
- Use the APIs, versions and contracts named here and in `docs/implementation/`. If an installed API differs, follow its type definitions and record the difference in `docs/DECISIONS.md`.
- Record every non-obvious choice (a convention, an approximation, a fallback) in `docs/DECISIONS.md` with a one-line reason.
- Ask before adding a backend, an API key, analytics, a dependency over about 50 kB gzipped, or a change to the store shape (O3).
- Never call CelesTrak from the browser. Recorded clips stay in `recordings/` and are never committed; tests use only the generated test-pattern clip. Keep credits visible.
- Done means: `typecheck`, `lint`, `test`, `build` and `e2e` green in CI, acceptance criteria shown in the pull request with test output and a screenshot or short clip, no console errors, no `any`, no skipped or focused tests (Biome reports them as errors).
