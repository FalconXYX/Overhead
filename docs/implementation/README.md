# Implementation contracts

Shared contracts for the ten milestone files in this folder. Written 2026-10-11 from the brief ([`../archive/overview-v1-2026-10-10.md`](../archive/overview-v1-2026-10-10.md)), [`../DECISIONS.md`](../DECISIONS.md) and the verification records in `../verification/` (`docs/verification/`, local). Updated the same day for Parth's decisions O1 (the sky map is drawn on the YouTube player), O2 (clips recorded from the StarCam streams), O4 (Node 26) and H1 (GitHub Pages at `https://parthjain.ca/Overhead/`).

Precedence: `DECISIONS.md` wins over this file, and this file wins over a milestone file and over the brief.

## 1. Purpose and how to use this folder

`docs/implementation/` holds this README plus one stage file per milestone:

| File | Milestone |
| ---- | --------- |
| `M0-scaffold.md` | M0 · Scaffold |
| `M1-ground-map.md` | M1 · Ground map |
| `M2-synthetic-sky.md` | M2 · Synthetic sky |
| `M3-satellites.md` | M3 · Satellites |
| `M4-camera-model.md` | M4 · Camera model and still images |
| `M5-live-video.md` | M5 · Live video |
| `M6-terrain.md` | M6 · Terrain |
| `M7-weather-imagery.md` | M7 · Weather imagery |
| `M8-footprint-alerts.md` | M8 · Footprint and alerts |
| `M9-polish-ship.md` | M9 · Polish and ship |

A stage file gives the numbered build steps, tests and acceptance for one pull request. It uses the paths, types, messages and function names defined here and does not redefine them. Every contract a stage file relies on, including the ones first worked out while writing the stage files, is in this README. To change a contract (a path, a type, a message, a signature), change this README in the same pull request and add a line to `DECISIONS.md`.

How to work on a milestone:

1. Read the open decisions in `DECISIONS.md`.
2. Read sections 2, 3 and 7 here, then the stage file.
3. Use the verification record for an area when you need the evidence or a measured number.

### Working agreement

1. One pull request per milestone, on a branch named `m<N>-<slug>` (for example `m3-satellites`). Do not start the next milestone until the current one meets its acceptance criteria. The only parallel track allowed is M7, which needs only M1.
2. Tests first for every formula. Write the unit test with the fixture value and tolerance from section 8, watch it fail, then implement.
3. CI must be green before review.
4. Record every non-obvious choice (a convention, an approximation, a fallback, an API that differs from its docs) in `docs/DECISIONS.md` with a one-line reason. Each stage file lists its lines in its section 8. The lines that change a contract in this README are already in `DECISIONS.md` under "Contract changes from the implementation docs"; do not append them twice.
5. Ask Parth before adding a backend, an API key, analytics, a dependency over about 50 kB gzipped, or a store-shape change (O3).
6. Browsers and CI never call CelesTrak. Recorded clips live in `recordings/` (gitignored) and are never committed; tests use only the generated test-pattern clip (section 8). Credits stay visible.
7. The visual design (layout, colours, panel placement, styling) is not specified in these docs. It is settled during the build from screenshots. Stage files specify behaviour, content, states, interactions, keyboard and accessibility only.

### Definition of done

A milestone is done when all of these hold:

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run e2e` exit 0 in CI.
2. Every acceptance line is shown in the pull request: the test names and their output, plus a screenshot or a short clip for visible behaviour.
3. The e2e runs log no console errors and no uncaught exceptions. The shared e2e fixture fails the test otherwise.
4. There is no `any` and no skipped or focused test. Biome enforces `noExplicitAny`, `noSkippedTests` and `noFocusedTests` as errors, and CI runs `biome ci --error-on-warnings .`.
5. No test makes a request to a third party. The shared e2e fixture aborts such requests and fails the test.
6. `docs/DECISIONS.md` and the milestone's section of the root `README.md` are updated.
7. Every new data source or camera shows its credit on screen (section 7).
8. The code matches the contracts in this file, or this file was updated in the same pull request.

### Decisions

Parth decided O1, O2, O4 and H1 on 2026-10-11 (`DECISIONS.md`, "Decided by Parth"). This file follows them:

| # | Decision | Where it lands |
| - | -------- | -------------- |
| O1 | The sky map is drawn on top of the YouTube player. The overlay on the video is deliberately light (section 4, "Sky over video"); the dense data (Starlink, tracks, footprint, imagery, terrain) stays on the ground map. | Section 4 "Camera kinds", "Sky over video", `layers.video`; section 6 `SkyMapHandle.setPassThrough`; M5; M9 demo |
| O2 | Replay clips are recorded from the StarCam streams with yt-dlp + ffmpeg and kept in `recordings/` (gitignored). Each clip has a `ClipSidecar` (section 6, `src/app/clip.ts`); a `local-video` camera points at it through `source.sidecarUrl`. | Section 3 `recordings/` and `scripts/`; section 4 `LocalVideoCamera`; section 8 "Recorded clips" and fixtures; M5 and M8 acceptance; M9 deploy and demo |
| O4 | Node 26 (26.11.1, arm64): `.nvmrc` `26`, `engines.node` `">=26"`, CI on Node 26, `@types/node` 26.6.5 | Section 3 (`.nvmrc`, `package.json`); M0; `ci.yml`; `deploy.yml`; `fetch-gp.yml` |
| H1 | GitHub Pages from Actions at `https://parthjain.ca/Overhead/`, public repository `FalconXYX/Overhead`, Vite `base: "/Overhead/"`, every runtime URL through `import.meta.env.BASE_URL`, e2e under the same base; production from `main` only, no per-branch previews | Section 3 (`deploy.yml`, `vite.config.ts`, `playwright.config.ts`); section 8 "End-to-end tests" and "Serving clips"; M0 step 15; M9 step 14 |

O3 is still open. The docs assume its recommended default:

| # | Default assumed here | Where it changes |
| - | -------------------- | ---------------- |
| O3 | The store shape in section 4 is approved, including five fields and actions added after the first draft: `recenter` (M1), `cancelImagePoint` (M4), `layers.video` with `setVideoLayer` (M5, for O1), `data.goes.status` with `setGoesStatus` (M7), `ui.demo.paused` with `setDemoPaused` (M9) | Section 4 |

### Assumed until Parth confirms

These are not open decisions in `DECISIONS.md`, but each needs Parth's yes. The docs assume the first option.

| Topic | Assumed | If it changes |
| ----- | ------- | ------------- |
| Data commits on a protected `main` | `fetch-gp.yml` pushes to `main` with `GITHUB_TOKEN`, which never triggers CI or Deploy, so a required `check` may reject the push (M3 gotcha 6), and the workflow dispatches `deploy.yml` itself (`gh workflow run deploy.yml --ref main`, M0 step 15). Assumed: a repository ruleset requires `check` and lets the data push bypass it; prove it on the first manual `fetch-gp` run | A pull-request-based data update, or no required check |
| `site.mastM` at the CFHT point | 33 m for `synthetic-maunakea`, `cfht-nanaao` and `cfht-starcam` from M6, so DEM ground (4,170.9 m) + mast = `heightM` 4,204 m | With 0 the eye sits on the summit ridge and terrain covers up to +6.9° over az 61–216°: M6 step 8 and the M8 e2e constants are regenerated |
| Incoming candidates | No "sunlit now" filter; sunlit is tested at each future sample (M8) | Add "not sunlit now" to the skip list; the coverage acceptance becomes 51/58 and 121/167 (M8 gotcha 7) |
| Performance evidence | Chrome traces unthrottled (≥ 59 fps, frame p95 ≤ 6 ms) and at 4× CPU (≥ 55 fps, p95 ≤ 16 ms); CDP throttling does not slow workers (M9) | A run on a real mid-range laptop replaces or adds to the 4× trace |

## 2. Milestone map

Build in order. Deploy after every milestone.

| # | Goal | Depends on | Key deliverables | Acceptance |
| - | ---- | ---------- | ---------------- | ---------- |
| M0 | Every quality gate runs on an empty app | none | Node 26 (`.nvmrc` `26`, `engines.node` `">=26"`, `@types/node` 26.6.5), Vite 8, React 19, TS 7 strict with 4 tsconfigs, Biome, Vitest, Playwright (Chromium, `vite preview`), `src/state` types, initial state, clock actions and the replay clock loop, `ci.yml` on Node 26, `deploy.yml` to GitHub Pages at `https://parthjain.ca/Overhead/` (`base: "/Overhead/"`, H1) | `typecheck`, `lint`, `test`, `build` and `e2e` exit 0 in CI; the smoke e2e loads the app with no console errors |
| M1 | GIBS true colour and the camera site on a ground map, driven by the clock | M0 | `createGroundMap`, map registry with the StrictMode-safe lifecycle, `fetch-gibs-caps.ts` and the snapshot, VIIRS true colour (KVP) with Coastlines and Reference_Labels, site marker, `cameras.json` with every known camera (only `synthetic-maunakea` enabled), Timeline, Layers panel, Credits, `?cam=` and `?t=` (`recenter`), live clock for synthetic cameras | e2e: after a date change, every true-colour tile request carries the new `Time` and none carries the old one |
| M2 | A computed sky in a zenith-fisheye pixel map | M1 | astro domain (bodies, inline star loop, twilight), `build-stars.ts` and `stars.json`, the zenith equidistant fisheye forward model only, `createSkyMap` (pixel projection, `[u, H − v]`), alt/az grid with cardinal letters, stars sized by magnitude, labelled Sun, Moon and planets, twilight markers, sky recompute on ≥ 2 s of sim time | Polaris 0.592°/20.151° ± 0.01°; planets vs Horizons AIRLESS < 0.05°; twilight ± 60 s; fisheye N horizon at map `[512, 1024]` and E at `[0, 512]` for W = H = 1024 |
| M3 | The ISS and the visual group in both views, linked; Starlink on demand | M2 | `fetch-gp.ts`, `fetch-gp.yml`, `meta.json`, `propagation.worker.ts` (fixed grid, ping-pong buffers), ephemeris client and interpolation, satellites in both views, trails and ground tracks, lit state and visibility, selection sync, hover details, basic Inspector, `?sel=` | ISS reference-pass fixture within 0.05° (stricter than the brief's 0.5°); clicking the ISS in the sky view, or loading `?sel=sat:25544`, highlights it on the ground map on the next frame and fills the Inspector |
| M4 | Real lenses, calibration and an all-sky still camera | M2, M3 | all five lens models in closed form with the k1/k2 tail, the inverse, proj4 cross-check tests, Calibration panel (sliders, nudges, star pairs, fit, RMS, reset, JSON import and export), persistence, GeoPose export with ajv, `cfht-nanaao` enabled as a still-image background with pan and zoom, CameraPicker with status, site wedge | lens tests pass; calibration on the committed pair fixture: ≥ 10 named stars at alt ≥ 20° (all-sky; 10° on rectilinear cameras), RMS ≤ 0.25°, each star ≤ 0.5°, one planet and 3 held-out stars ≤ 0.5°; exported GeoPose validates |
| M5 | The computed sky drawn on the YouTube StarCams; replay of recorded clips | M4 | `subaru-starcam` and `cfht-starcam`, runtime video-id resolver, the sky stage (player under the sky map, `pointer-events: none` on the map target, `ol/Overlay` hit targets, wrapper fullscreen with `fs: 0`, the light overlay set and `layers.video`), VideoPanel (states, embed-blocked fallback to replay), live clock from the player's media time, stream-delay control (0–120 s, ± 10 s fine), clip cameras from a `ClipSidecar` (`local-replay` picked at runtime, `subaru-2026-10-11-iss` from `recordings/`; video as master clock), `findPasses` and `frameSpans`, `scripts/find-passes.ts`, `scripts/record-clip.ts`, `scripts/check-clip-pass.ts` and the measured ISS track fixture | on the 2026-10-11 recorded ISS pass (section 8), the drawn marker is within 1° of the ISS at every one of the 94 tracked media seconds (scripted `check-clip-pass` run, by hand, against `npm run dev`; its report and a short screen recording in the PR); e2e with the YouTube stub passes, including a click on an empty part of the overlay reaching the player and a click on a hit target selecting its object |
| M6 | A real horizon and a Sun-lit hillshade | M4 | terrain domain, `horizon.worker.ts`, skyline layer, behind-terrain dimming and Inspector flag, visibility uses the profile, hillshade (WebGLTile over ImageTile), terrain credits, `synthetic-walenstadt` | wall formula 5.672 ± 0.001° and march 5.67 ± 0.05°; flat sea from 4,204 m −1.94 ± 0.01° at 248 ± 2 km; Walenstadt az 0° 32.7 ± 0.3° and az 270° 2.0 ± 0.3°; the skyline follows the ridge by eye |
| M7 | GOES-West infrared synced to the clock | M1 | GOES WMTS source (KVP, limits removed), DescribeDomains poll with `data.goes.status`, HEAD-confirmed newest step, tile-error fallback (a failed step is dropped for the session), "Imagery as of HH:MM UTC" label, GOES ticks on the timeline | scrubbing across a 10-minute boundary gives 1 Time change (unit) and exactly 2 distinct `Time` values in tile requests (e2e) |
| M8 | Where the frame looks at orbit height, and who is about to enter it | M3, M4, M6 (the clip and the incoming check call `horizonAltAtAzDeg`; both also work with a null profile) | footprint polygon (sphere R = 6371.0088 km, Earth-hit rejection, horizon clip), height dropdown (selected, 420 km, 480 km), incoming check in the worker, IncomingChip | straight-up ray gives t = H − h and a hit at the site within 1e-9°; a −3° ray from 4,204 m is rejected; on the 2026-10-11 recorded clip, run by hand with the clip's fitted calibration, the chip shows the ISS before it enters the frame (it appears at media 78.7 s on the video; the fitted model predicts 79.8 s, and the Subaru defaults 15:09:54.955Z, media 84.8 s; section 8) |
| M9 | Demo, performance, documentation, deploy | M0–M8 | `?demo=1` captioned tour (it opens on `subaru-2026-10-11-iss` where the clip is served, production and `npm run dev`, runs on the computed sky where it is not, and ends on the live `subaru-starcam`), performance pass (Starlink always culled, sky cut-off), accessibility pass, root README with architecture diagram, talking points and credits, the deploy copy of the 2026-10-11 clip and its element sets (a 22.4 MiB release asset copied into `dist/recordings/` by `npm run build:pages`; section 8, "Serving clips"), production deploy | Chrome traces with Starlink loaded, attached to the PR: unthrottled ≥ 59 fps and frame p95 ≤ 6 ms, 4× CPU throttle ≥ 55 fps and p95 ≤ 16 ms (section 9); Lighthouse accessibility ≥ 90 |

### UI pieces by milestone

| Piece | Lands in | Notes |
| ----- | -------- | ----- |
| Timeline: live/replay, play/pause, rate 1×/10×/60×/600×, ± 12 h scrubber, Now, UTC and camera-local time | M1 | The scrubber is a controlled range input that also re-renders in its own `onChange` (M1 step 15). While a clip is loaded the rates are 1× and 10× only (M5). "Copy link" in M9 |
| Timeline twilight markers | M2 | civil dusk and dawn inside the ± 12 h range |
| Timeline GOES availability ticks | M7 | from `goesStepsInRange(data.goes.intervals, …)`, `aria-hidden`; the caption is the accessible text |
| "Imagery as of HH:MM UTC" caption | M7 | in `GroundView.tsx`, from `selectGoesLabel` read during a `useTick4Hz` render |
| Layers panel (`LayerToggles.tsx`) | M1 | Each toggle lands with its layer: `trueColor`, `coastlines` in M1; `stars`, `planets`, `grid` and the magnitude limit in M2; `satellites`, `starlink`, `trails` in M3; the "On the video" group (`layers.video`: Starlink, grid, dense labels) in M5, shown while the sky is over a video; `horizon`, `hillshade` in M6; `goesIr` in M7; `footprint` and the height dropdown in M8 |
| Credits | M1 | grows with every source (section 7) |
| Sky view text alternative | M2 | "Above the horizon" list of the Sun, Moon and planets (M2); "Satellites above the horizon" buttons (M3); ", behind terrain" suffix (M6) |
| Hover details | M3 | name, NORAD id (satellites), az, alt, range, lit state, magnitude where known |
| Inspector | M3 | name, NORAD id, az, alt, range, lit, element age, Show on map, Follow; behind-terrain flag in M6; incoming ETA in M8 |
| CameraPicker | M4 | every enabled `cameras.json` entry with its status; YouTube statuses and clip cameras in M5 |
| Calibration panel | M4 | stream-delay control and the satellite check in M5 |
| Sky stage (in `SkyView.tsx`) | M5 | for a `youtube` camera: the player under the sky map, hit targets, and a Fullscreen button for the stage (section 4, "Sky over video") |
| VideoPanel | M5 | status line, embed-blocked fallback, clip loading and clip information; the player itself sits in the sky stage |
| IncomingChip | M8 | |
| Demo captions | M9 | |
| Keyboard shortcuts list (`KeyboardShortcuts.tsx`) | M9 | rows from `KEY_MAP` |

### Keyboard

One `keydown` handler in `src/app/keyboard.ts` (`installKeyboard`, M1). `handleKeyDown` returns false and does nothing when:

1. the target is an `input`, `textarea`, `select` or `contenteditable` element, so sliders and selects keep their own keys;
2. the event is `defaultPrevented`: OpenLayers `KeyboardPan` on a focused map calls `preventDefault()` first;
3. Alt, Ctrl or Meta is held (Cmd+[ is browser Back);
4. the key is Space and the target is a `button`, so Space presses the focused button.

Every shortcut also has an on-screen control. From M9, `KEY_MAP` in `keyboard.ts` holds the rows that `KeyboardShortcuts.tsx` lists.

| Key | Effect | Lands in |
| --- | ------ | -------- |
| Space | `togglePlay()` | M1 |
| ← / → | `stepBy(−1000)` / `stepBy(1000)`; with Shift ± 60,000 ms | M1 |
| `[` / `]` | previous / next rate the Timeline offers, clamped at the ends: 1, 10, 60, 600; only 1 and 10 while a clip is loaded (M5) | M1 |
| L | `togglePanel("layers")` | M1 |
| Esc | first match only: `stopDemo()` while the tour runs (M9); `cancelImagePoint()` while a calibration point is pending (M4); else `select(null)` | M3 |
| C | `togglePanel("calibration")` | M4 |
| arrows while the Calibration panel is open | ← → change `azDeg` by ∓ 0.05° (on a zenith-locked fisheye they change `rollDeg`), ↑ ↓ change `altDeg` by ± 0.05°; Shift makes the step 0.5°; time stepping is off while the panel is open | M4 |
| arrows, `+`, `−` on a focused map | OpenLayers `KeyboardPan` and `KeyboardZoom` | M1 (ground map), M4 (sky view of image cameras) |

### Camera registry

`public/data/cameras.json` is a JSON array of `CameraConfig` (section 4) in picker order. Default camera: `DEFAULT_CAMERA_ID` (`synthetic-maunakea`). The ids are part of the URL contract.

M1 commits every entry below except the two `local-video` entries (M5 inserts `local-replay` and `subaru-2026-10-11-iss` after `cfht-starcam`) and `ask053-walenstadt` (M6, only with written permission). Only the ids in `ENABLED_CAMERA_IDS` (`src/app/cameras.ts`) reach the store; `parseCameraRegistry` validates every entry. The milestone in the "Enabled in" column adds the id to `ENABLED_CAMERA_IDS`, settles the entry's provisional fields (M1 step 5 lists them) and edits the entry in place.

| id | kind | lens | Enabled in | Facts to use |
| -- | ---- | ---- | ---------- | ------------ |
| `synthetic-maunakea` | synthetic | fisheye-equidistant | M1 (drawn from M2) | 1024 × 1024; site 19.8253°, −155.4689°, `heightM` 4204 (the Polaris fixture site, CFHT's published altitude), `geoidSepM` 24.23 (EGM96), `timeZone` Pacific/Honolulu; `mastM` 0 until M6 sets 33 (DEM ground 4,170.9 m + 33 m = `heightM`); defaults from `syntheticFisheyeCalibration(1024)` (f = 1024/π = 325.949 px, roll 180°) |
| `cfht-nanaao` | still-image | fisheye-equidistant, tilted | M4 | same site and heights as `synthetic-maunakea` (CFHT has not published the mounting; `mastM` 33 from M6); `https://www.cfht.hawaii.edu/~nanaao/last_vis.png`; `refreshSec` 60; `corsEnabled` false; `captureLagMs` 40,000; `exposureSec` 0; 1232 × 1232; defaults az 227.3°, alt 88.26°, roll 44.8°, f 373.1 px, c (619.6, 609.8), k1 0.003, `flipX` (fit on two 2025 frames; M4 step 18 refits); 404 means hatch closed → status `offline` (`daytime` while the Sun is up); credit "Nānā ao all-sky image © CFHT", licence GFDL-1.3-or-later |
| `subaru-starcam` | youtube | rectilinear | M5 | id `Kj5DjRYkzD8` resolved from `https://astroasahi.github.io/maunakea_east/`; 3840 × 2160; site 19.82552°, −155.47587°, `heightM` ≈ 4148 (DEM ground about 4135 + mast), `mastM` 13, `geoidSepM` 24.32 (EGM96); defaults (settled by M5 from the star fit on the 2026-10-11 clip, 73 stars, rms 0.0294°; section 8, "Recorded clips") az 81.2322°, alt 19.6185°, roll 0.7698°, f 2525.93 px, cx 1920, cy 1080, k1 −0.00992, `rmsDeg` 0.0294, `streamDelayMs` 50,000; M1 commits the published centre (az 81.2°, alt 19.6°, roll 0, f 2742, k1 0) as provisional values; credit "NAOJ & Asahi Shimbun", `termsNote` "Non-commercial use only" (M5). Fixtures that name "the Subaru defaults" keep az 81.2°, alt 19.6°, roll 0, f 2742 as their inline inputs; only code that reads `cameras.json` sees the settled values |
| `cfht-starcam` | youtube | rectilinear (calibrate) | M5 | id `Q3UhCgsWDw8` resolved from `https://astroasahi.github.io/maunakea_west/`; 3840 × 2160; site: the CFHT point (`mastM` 33 from M6); defaults are guesses until aligned (az 270°, alt 20°, f 2742 px, `streamDelayMs` 50,000); credit "CFHT & Asahi Shimbun in collaboration with Subaru Telescope, NAOJ", `termsNote` "Non-commercial use only" (M5) |
| `local-replay` | local-video | per clip | M5 (inserted by M5) | `sidecarUrl`, `sourceCameraId`, `videoUrl` and `startUtcMs` null: the user picks a clip and its `ClipSidecar` at runtime; placeholder site and defaults are the Subaru StarCam's, `streamDelayMs` 0 |
| `subaru-2026-10-11-iss` | local-video | rectilinear | M5 (inserted by M5) | `sidecarUrl` `"recordings/subaru-2026-10-11-iss.json"` (resolved against `import.meta.env.BASE_URL`), `sourceCameraId` `subaru-starcam`, `videoUrl` and `startUtcMs` null until the sidecar loads; site, image size, lens and defaults copied from `subaru-starcam` with `streamDelayMs` 0 (`clipCamera` replaces the defaults with the sidecar's `calibration` when the clip loads); credit "NAOJ & Asahi Shimbun". The clip is not in the repository: the entry loads only where `recordings/` is served, which is `npm run dev` and, from M9, production (section 8, "Serving clips") |
| `synthetic-walenstadt` | synthetic | fisheye-equidistant | M6 | site 47.1236°, 9.3242°, `heightM` 467.6 (Terrarium z14 ground), `mastM` 0, `geoidSepM` 47.08, `timeZone` Europe/Zurich |
| `ask053-walenstadt` | still-image | fisheye, chosen by fit | M6, only after the owner grants permission in writing (record it in `DECISIONS.md`) | `https://www.allskykamera.space/imageProxy.php?cam=ASK053&type=image&variant=auto`; 1920 × 1440; `refreshSec` 120; `corsEnabled` true; `exposureSec` 60; `mastM` 0 (unknown); `timeZone` Europe/Vaduz (the burned-in clock) |

## 3. File layout

Every path a stage file uses comes from this tree. The milestone that creates each path is in brackets. Section 6 gives the exports of each module.

```text
.
├── .github/workflows/
│   ├── ci.yml                      [M0] lint, typecheck, unit, build, then Chromium install and e2e, on push and PR; uploads the Playwright report; no third-party calls
│   ├── deploy.yml                  [M0] GitHub Pages (H1): push to main + workflow_dispatch, never workflow_call; npm ci, build, upload dist; M9 builds with npm run build:pages
│   └── fetch-gp.yml                [M3] cron "0 */6 * * *" + workflow_dispatch; runs fetch-gp.ts, commits public/data/gp/, then dispatches deploy.yml (actions: write)
├── .gitignore                      [M0] includes recordings/ and docs/verification/; dist-dev/ and lighthouse/ added in M9
├── .nvmrc                          [M0] 26
├── biome.json                      [M0] recommended + noExplicitAny, noSkippedTests, noFocusedTests, noNonNullAssertion, noConsole (error and warn allowed; off in scripts/ and tests/); excludes public/data and tests/fixtures
├── index.html                      [M0]
├── package.json                    [M0] engines.node ">=26"; devDependencies add @types/node 26.6.5 and drop @types/proj4; allowScripts denies the esbuild and fsevents install scripts; scripts below
├── package-lock.json               [M0]
├── playwright.config.ts            [M0] one Chromium project, headless, baseURL http://localhost:4173/Overhead/, webServer `vite preview --port 4173 --strictPort`; under PERF=1 (M9): channel "chromium", 1440 × 900 at DPR 2, workers 1, PERF_OUTDIR
├── README.md                       [M0] grows each milestone; final in M9
├── tsconfig.json                   [M0] "files": [], references the four below
├── tsconfig.app.json               [M0] include src, exclude src/workers; lib ES2023 + ESNext.Disposable + DOM + DOM.Iterable
├── tsconfig.worker.json            [M0] include src/workers + src/domain; lib ES2023 + ESNext.Disposable + WebWorker
├── tsconfig.node.json              [M0] vite.config.ts, playwright.config.ts, scripts/; own tsBuildInfoFile; module esnext + moduleResolution bundler (not nodenext); types node; lib adds DOM for Playwright
├── tsconfig.test.json              [M0] include tests; types vite/client + node
├── vite.config.ts                  [M0] base "/Overhead/" (H1); worker.format "es"; test: tests/unit/**/*.test.ts, environment node, setupFiles tests/unit/setup.ts; build.chunkSizeWarningLimit in M9
├── docs/
│   ├── DECISIONS.md
│   ├── archive/overview-v1-2026-10-10.md
│   ├── implementation/README.md, M0-scaffold.md … M9-polish-ship.md
│   └── verification/               evidence; read-only; gitignored, so it exists only in a local checkout
├── public/data/
│   ├── cameras.json                [M1] every known camera (section 2, camera registry); ENABLED_CAMERA_IDS picks the ones that reach the store
│   ├── gibs-capabilities.xml       [M1] trimmed snapshot written by scripts/fetch-gibs-caps.ts
│   ├── stars.json                  [M2] written by scripts/build-stars.ts; brightest first
│   └── gp/
│       ├── stations.json           [M3] OMM JSON written by scripts/fetch-gp.ts
│       ├── visual.json             [M3]
│       ├── starlink.json           [M3] loaded only when the starlink toggle is first turned on
│       └── meta.json               [M3] GpMeta: fetchedAtMs, count, sha256 per group
├── recordings/                     gitignored, never committed (O2); the first clip is subaru-2026-10-11-iss (section 8). Per clip:
│                                     <clip>.mp4 (H.264 MP4) and <clip>.json (ClipSidecar): the clip the app plays
│                                     <clip>-dvr.ts, <clip>.segments.json   record-clip's concatenated segments and segment log [M5]
│                                     <clip>.gp/                            stations, visual, starlink and meta.json copied from public/data/gp at cut time [M5]; the app reads it from M9
│                                     <clip>.check.json                     check-clip-pass's report [M5]
│                                     web/                                  deploy copies made by hand for the release asset (M9 step 14a) [M9]
├── scripts/
│   ├── fetch-gibs-caps.ts          [M1]
│   ├── build-stars.ts              [M2]
│   ├── fetch-horizons-fixture.ts   [M2]
│   ├── fetch-gp.ts                 [M3]
│   ├── find-passes.ts              [M5] visible passes of a satellite through a camera's frame, from the committed GP data (findPasses + frameSpans)
│   ├── record-clip.ts              [M5] cuts a UTC window from a StarCam's YouTube DVR window (yt-dlp + ffmpeg) into recordings/ and writes the sidecar
│   ├── check-clip-pass.ts          [M5] the M5 acceptance tool: steps a clip camera in headless Chromium and compares the drawn marker with a measured track
│   ├── fetch-deploy-clips.ts       [M9] run by npm run build:pages in deploy.yml only: release-asset clip copies into dist/recordings/, element sets into dist/recordings/<clip>.gp/
│   ├── fixtures/iss-pass-skyfield.py [M3] Python 3 + Skyfield, run by hand
│   ├── fixtures/make-test-clip.ts  [M5] writes the e2e test-pattern clip
│   └── fetch-terrain-fixture.ts    [M6]
├── src/
│   ├── main.tsx                    [M0] start the clock loop, render; M1: import ol/ol.css, parse the URL, load cameras.json, apply URL state
│   ├── app/
│   │   ├── App.tsx                 [M0]
│   │   ├── ErrorBoundary.tsx       [M0] ErrorBoundary and PaneError; one per pane
│   │   ├── cameras.ts              [M1] registry validation and ENABLED_CAMERA_IDS
│   │   ├── url.ts                  [M1] parseUrlState, writeUrlState, startUrlSync; shareUrl in M9
│   │   ├── keyboard.ts             [M1] handleKeyDown, installKeyboard; KEY_MAP in M9
│   │   ├── credits.ts              [M1] data-source credits; grows with every source
│   │   ├── testHooks.ts            [M3] window.__overhead, installed only when navigator.webdriver is true
│   │   ├── persist.ts              [M4] calibration in localStorage, JSON import/export
│   │   ├── youtube.ts              [M5] IFrame API loader, video-id resolver, player lifecycle
│   │   ├── clip.ts                 [M5] ClipSidecar parsing, clip cameras, loading from a sidecar URL or picked files
│   │   └── demo.ts                 [M9] ?demo=1 tour steps and runner (lazy-loaded)
│   ├── state/
│   │   ├── types.ts                [M0] section 4
│   │   ├── initialState.ts         [M0]
│   │   ├── store.ts                [M0]
│   │   ├── actions.ts              [M0] createActions; each action lands in the milestone in the actions table
│   │   ├── selectors.ts            [M0] each selector lands with its first user
│   │   ├── hooks.ts                [M0] useAppState, useActions, useClockControls, useTick4Hz
│   │   ├── clockLoop.ts            [M0] replay; live sources added in M1, M4, M5; frameCount in M3
│   │   ├── skyCache.ts             [M2] star and body az/alt arrays, lastSkyMs
│   │   ├── objectId.ts             [M3] parseObjectId, noradIdOf
│   │   ├── sampleClient.ts         [M3] sample pool and grid logic, no Worker (Node-testable)
│   │   ├── ephemeris.ts            [M3] propagation-worker client, catalog, per-frame satellite arrays, tracks, sky paths; incoming list in M8
│   │   ├── incomingClient.ts       [M8] incoming request pacing and stale-reply filter
│   │   └── footprintStatus.ts      [M8] footprint height, source and pair count for the UI
│   ├── domain/
│   │   ├── time/index.ts           [M0] grows with later milestones
│   │   ├── geo/index.ts            [M2] ObserverSite, wrap helpers, angularSeparationDeg; ECEF/ENU in M3, destination in M6, rays, dip and geodeticHeightKm in M8
│   │   ├── astro/index.ts                                                  [M0] PlanetName only; functions from M2
│   │   ├── astro/bodies.ts, stars.ts, twilight.ts                          [M2]
│   │   ├── camera/index.ts                                                 [M0] LensModel and Calibration only; functions from M2
│   │   ├── camera/lens.ts, project.ts                                      [M2] zenith equidistant only
│   │   ├── camera/inverse.ts, fit.ts, coverage.ts, geopose.ts              [M4] all lenses added to lens.ts and project.ts; satelliteCheckSummary in fit.ts in M5
│   │   ├── camera/schemas/GeoPose.Basic.YPR.Schema.json                    [M4] vendored, sha256 5508d26a…765640
│   │   ├── camera/schemas/PROVENANCE.md                                    [M4] URL, sha256, retrieval date, © OGC, Apache-2.0 copy
│   │   ├── camera/footprint.ts                                             [M8]
│   │   ├── orbits/index.ts                                                 [M0] GpGroup only; functions from M3
│   │   ├── orbits/omm.ts, sample.ts, interpolate.ts, visibility.ts, tracks.ts [M3]
│   │   ├── orbits/passes.ts                                                [M5] findPasses and frameSpans (scripts/find-passes.ts; the M9 tour)
│   │   ├── orbits/incoming.ts                                              [M8]
│   │   ├── orbits/cull.ts                                                  [M9]
│   │   └── terrain/index.ts, terrarium.ts, tiles.ts, horizon.ts            [M6]
│   ├── workers/
│   │   ├── protocol.ts             [M3] section 5; arc in M4, horizon types in M6, setCamera/setHorizonProfile/incoming in M8
│   │   ├── propagation.worker.ts   [M3]
│   │   ├── horizon.worker.ts       [M6]
│   │   └── bulk.ts                 [M9] BulkPropagator fallback, only if M9 step 3's measurement calls for it
│   ├── map/
│   │   ├── registry.ts             [M1] Map<MapId, OlMap>, registerMap, renderSyncAll
│   │   ├── pick.ts                 [M3] pixel-space nearest-neighbour picking
│   │   ├── classPoints.ts          [M3] writeClassPoints for the per-class MultiPoints
│   │   ├── ground/
│   │   │   ├── createGroundMap.ts  [M1]
│   │   │   └── layers/ gibs.ts [M1], site.ts [M1], satellites.ts [M3], tracks.ts [M3], hillshade.ts [M6], goes.ts [M7], footprint.ts [M8]
│   │   ├── sky/
│   │   │   ├── createSkyMap.ts     [M2] SkyMapHandle; pixel Projection, extent [0, 0, W, H]
│   │   │   └── layers/ grid.ts [M2], stars.ts [M2], bodies.ts [M2], satellites.ts [M3], selection.ts [M3], background.ts [M4], hitTargets.ts [M5], horizon.ts [M6]
│   │   └── sync/
│   │       ├── bindLayers.ts       [M1] one visibility binding per toggle
│   │       ├── bindGibs.ts         [M1] true-colour date
│   │       ├── bindSite.ts         [M1] site marker; wedge in M4
│   │       ├── bindSkyCamera.ts    [M2] camera model and view per active camera; pan and zoom in M4
│   │       ├── bindSelection.ts    [M3] highlight in both maps
│   │       ├── bindFollow.ts       [M3]
│   │       ├── bindTracks.ts       [M3]
│   │       ├── bindBackground.ts   [M4] still-image refresh; video frames in M5
│   │       ├── bindHorizon.ts      [M6] runs horizon.worker per camera; skyline
│   │       ├── bindHillshade.ts    [M6] Sun az/alt at most once per second; texelGroundM on moveend and tile-zoom change
│   │       ├── bindGoes.ts         [M7]
│   │       └── bindFootprint.ts    [M8]
│   └── ui/
│       ├── GroundView.tsx          [M1] map container and lifecycle; night badge in M6; GOES caption in M7
│       ├── Timeline.tsx            [M1]
│       ├── LayerToggles.tsx        [M1]
│       ├── Credits.tsx             [M1]
│       ├── SkyView.tsx             [M2] map container, lifecycle and text alternative; the sky stage (player under the map, Fullscreen) in M5
│       ├── Inspector.tsx           [M3]
│       ├── HoverCard.tsx           [M3]
│       ├── CameraPicker.tsx        [M4]
│       ├── CalibrationPanel.tsx    [M4]
│       ├── VideoPanel.tsx          [M5] status line, fallback, clip loading and information
│       ├── IncomingChip.tsx        [M8]
│       ├── DemoCaptions.tsx        [M9]
│       └── KeyboardShortcuts.tsx   [M9]
└── tests/
    ├── unit/
    │   ├── setup.ts                [M0] replaces globalThis.fetch with a stub that throws
    │   └── <area>.test.ts          one file per module or binding, e.g. lens.test.ts, horizon.test.ts; each stage file names its own
    ├── helpers/
    │   ├── store.ts                [M1] storeAt(iso): a store with the committed, enabled registry
    │   ├── decodePng.ts            [M6] node:zlib inflate + PNG filter reversal, no dependency
    │   └── terrainFixtures.ts      [M6] fixtureSampler(site, keys)
    ├── e2e/
    │   ├── fixtures.ts             [M0] shared `test`: guard (third-party abort, console-error check); route mocks in the `routes` fixture from M1
    │   └── <feature>.spec.ts       smoke [M0], gibs-time and ground-map [M1], sky [M2], selection [M3], calibration-export [M4], video [M5], terrain [M6], goes-swap [M7], incoming [M8], demo, share, a11y and keyboard [M9]
    ├── perf/<budget>.perf.ts       sky [M2], propagation [M3], incoming [M8], starlink, commits and screens [M9]; run with `npm run perf`, not in CI
    └── fixtures/                   section 8
        ├── gp/stations.json, visual.json, starlink.json, meta.json          [M3]
        ├── iss-pass-maunakea.json                                           [M3]
        ├── horizons-airless-maunakea-2026-10-10.json                        [M2]
        ├── gibs/tile.jpg, tile.png                                          [M1]
        ├── gibs/goes-domain.xml                                             [M7]
        ├── geopose/GeoPose.Basic.YPR.Instance.00.json … .03.json            [M4]
        ├── calibration/cfht-nanaao-pairs.json                               [M4]
        ├── youtube/iframe_api.js, astroasahi.html                           [M5]
        ├── video/test-pattern.webm, test-pattern.sidecar.json               [M5] generated, CC0, not a sky recording; the sidecar is a ClipSidecar
        ├── video/subaru-2026-10-11-iss-track.json                           [M5] the measured ISS track on the 2026-10-11 clip (numbers only; a ClipTrack)
        ├── hls/dvr-playlist.m3u8                                            [M5] a real DVR media playlist trimmed for record-clip tests; every URL replaced (section 8)
        ├── terrain/walenstadt/{z}/{x}/{y}.png, walenstadt/sources.json      [M6]
        ├── terrain/maunakea/{z}/{x}/{y}.png, maunakea/sources.json          [M6] the Subaru StarCam's azimuth-0 ray
        └── terrain/flat.png                                                 [M6] (128, 0, 0) everywhere
```

The three M5 scripts run by hand with `npx tsx scripts/<name>.ts`; none is an npm script and CI never runs them. `scripts/fetch-deploy-clips.ts` (M9) runs only inside `npm run build:pages`, which only `deploy.yml` calls.

`package.json` scripts: `dev` (`vite`), `build` (`tsc -b && vite build`), `preview` (`vite preview`), `typecheck` (`tsc -b`), `test` (`vitest run`), `e2e` (`playwright test`), `perf` (`PERF=1 playwright test`; the config's `testMatch` switches to `perf/**/*.perf.ts`), `lint` (`biome ci --error-on-warnings .`), `format` (`biome check --write .`). M9 adds `build:dev` (`NODE_ENV=development vite build --mode development --outDir dist-dev`) for the React commit count, and `build:pages` (`npm run build && tsx scripts/fetch-deploy-clips.ts`) for `deploy.yml`.

Import rules:

1. `src/domain` is pure TypeScript: no DOM, no OpenLayers, no React, no store. It may import `satellite.js`, `astronomy-engine` and, in `geopose.ts` only, `ajv`. `proj4` appears only in tests.
2. `src/workers` imports only `src/domain`, `src/workers/protocol.ts` and the libraries `src/domain` may use (`satellite.js` for `json2satrec` and, in M9's conditional `bulk.ts`, `BulkPropagator`): never React, OpenLayers, the store or `src/app`. `tsconfig.worker.json` type-checks these files with the `WebWorker` lib and no DOM.
3. Tests and other modules import a domain module only through its `index.ts`. The other files in a domain folder are internal.
4. `src/map` never imports React. `src/ui` never imports OpenLayers.
5. Import the OpenLayers map as `import OlMap from "ol/Map"` (`Map` shadows the global and fails Biome).

<a id="store"></a>

## 4. Store

One vanilla zustand 5 store (`createStore` from `zustand/vanilla` with `subscribeWithSelector`). It holds only discrete state. High-rate data stays out of it: worker samples, interpolated satellite positions, tracks and the incoming list live in `src/state/ephemeris.ts`; star and body positions live in `src/state/skyCache.ts`.

The whole shape lands in M0 so it is reviewed once (O3). Each action lands in the milestone listed in the actions table. If O3 changes: a milestone that needs a rejected field proposes it in its own pull request, and this section is updated there.

The code blocks in this section are formatted with M0's `biome.json` and pass `tsc -b` under M0's configs (checked with TypeScript 7.0.2 and Biome 2.5.15 against the installed packages), so they can be pasted verbatim.

Changes from the brief: `clock.streamDelayMs` is gone (read `selectStreamDelayMs`); added `clock.rangeCenterMs`, camera status, `frameTimeMs`, `selection.follow`, `layers.footprintHeightKm`, `layers.starMagLimit`, `layers.coastlines`, `layers.video` (O1: the sky-view gates over a video), per-group GP status, horizon status per camera, GOES load status, intervals and latest step, `calibrationUi`, `video`, `ui` (open panel and tour state). `CameraConfig` is a union by `kind` with kind-specific `source` fields (a `local-video` camera points at its `ClipSidecar` through `source.sidecarUrl`, O2), `site.mastM`, `site.geoidSepM`, `site.timeZone` and credit fields. `Calibration` and `LensModel` live in `src/domain/camera` and are re-exported here. Everything in this list is part of the O3 proposal.

```ts
// src/state/types.ts

import type { PlanetName } from "../domain/astro";
import type { Calibration, LensModel } from "../domain/camera";
import type { GpGroup } from "../domain/orbits";
import type { ClockRate, TimeInterval } from "../domain/time";

export type { Calibration, ClockRate, GpGroup, LensModel, PlanetName, TimeInterval };

export type StarId = `star:${number}`; // BSC5 HR number
export type PlanetId = `planet:${PlanetName}`;
export type SatId = `sat:${number}`; // NORAD_CAT_ID, 5 or 6 digits
export type ObjectId = SatId | PlanetId | StarId | "moon" | "sun";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

// ---- Camera registry (public/data/cameras.json) ----
export interface Credit {
  text: string; // on screen at all times while the source is visible
  href: string | null;
  licence: string | null; // e.g. "GFDL-1.3-or-later"; null when none is published
  licenceHref: string | null;
}
export interface CameraSite {
  latDeg: number;
  lonDeg: number;
  heightM: number; // lens height above mean sea level (ground + mast): the observer height everywhere
  mastM: number; // lens height above local ground: horizon worker z0 = DEM ground + mastM
  geoidSepM: number; // geoid separation N: GeoPose h = heightM + geoidSepM
  timeZone: string; // IANA zone: local-time readout and burned-in image clocks
}
interface CameraBase {
  id: string;
  name: string;
  site: CameraSite;
  imageSize: { widthPx: number; heightPx: number };
  lens: LensModel;
  defaults: Calibration; // starting guesses
  credit: Credit;
  termsNote: string; // shown next to the credit, e.g. "Non-commercial use only"
}
export interface SyntheticCamera extends CameraBase {
  kind: "synthetic"; // computed sky, no image (M2)
  source: null;
}
export interface StillImageCamera extends CameraBase {
  kind: "still-image";
  source: {
    imageUrl: string;
    refreshSec: number; // ≥ STILL_IMAGE_MIN_REFRESH_SEC (60); Nānā ao 60, ASK053 120
    corsEnabled: boolean; // false: leave crossOrigin unset (no pixel access)
    captureLagMs: number; // frameTimeMs = load time − captureLagMs until a manual time is entered
    exposureSec: number; // > 1: satellites drawn as arcs over the exposure
  };
}
export interface YoutubeCamera extends CameraBase {
  kind: "youtube";
  source: {
    youtubeVideoId: string; // last known id; live ids change when a stream restarts
    resolverUrl: string | null; // page whose HTML holds the current youtu.be/<id> link (CORS *)
  };
}
export interface LocalVideoCamera extends CameraBase {
  kind: "local-video";
  source: {
    sidecarUrl: string | null; // ClipSidecar URL relative to BASE_URL, e.g. "recordings/subaru-2026-10-11-iss.json"; null: picked at runtime
    sourceCameraId: string | null; // registry camera the clip was recorded from (the sidecar's cameraId must match); null: local-replay
    videoUrl: string | null; // set when the clip loads: videoFile next to the sidecar, or an object URL (picked files; from M9 also a sidecar-URL clip whose server ignores Range)
    startUtcMs: number | null; // set when the clip loads: the sidecar's startUtcMs (UTC of media time 0)
  };
}
export type CameraConfig = SyntheticCamera | StillImageCamera | YoutubeCamera | LocalVideoCamera;
export type CameraKind = CameraConfig["kind"];
export type CameraStatus = "unknown" | "live" | "offline" | "daytime";
export const STILL_IMAGE_MIN_REFRESH_SEC = 60;
/** [M5] Over a video, only stars with V ≤ this are drawn (unless calibrating): 1–8 stars in the Subaru frame on 2026-10-11. */
export const VIDEO_STAR_MAG_LIMIT = 2;

// ---- Slices ----
export interface ClockState {
  mode: "live" | "replay";
  playing: boolean;
  rate: ClockRate; // fixed at 1 in live mode
  simTimeMs: number; // UTC epoch ms
  rangeCenterMs: number; // the ±12 h scrubber is centred here
}
export interface CameraState {
  activeId: string;
  registry: Record<string, CameraConfig>; // from public/data/cameras.json
  calibration: Record<string, Calibration>; // persisted per camera; missing → registry[id].defaults
  status: Record<string, CameraStatus>;
  frameTimeMs: number | null; // capture time of the still image or video frame on screen
}
export interface SelectionState {
  selectedId: ObjectId | null;
  hoverId: ObjectId | null;
  follow: boolean; // ground map keeps the selected satellite centred
}
export interface LayersState {
  trueColor: boolean;
  coastlines: boolean; // Coastlines + Reference_Labels overlays
  goesIr: boolean;
  hillshade: boolean;
  footprint: boolean;
  stars: boolean;
  planets: boolean; // Sun, Moon and planets
  satellites: boolean; // stations + visual
  starlink: boolean; // also triggers the lazy load of gp/starlink.json
  trails: boolean;
  grid: boolean;
  horizon: boolean; // terrain skyline and behind-terrain dimming
  footprintHeightKm: number | null; // null: selected satellite's current height (420 when none)
  starMagLimit: number; // default 4.5
  video: VideoOverlayLayers; // [M5] O3 proposal (O1)
}
/** [M5] Extra gates for the sky view while it is drawn over a video (selectSkyOverVideo). All default false. */
export interface VideoOverlayLayers {
  starlink: boolean; // Starlink on the video; also needs layers.starlink, which loads the data
  grid: boolean; // alt/az grid on the video; also needs layers.grid
  denseLabels: boolean; // false: labels only for the ISS, the selected or hovered object, the Sun, Moon and planets
}
export type LayerToggle = {
  [K in keyof LayersState]: LayersState[K] extends boolean ? K : never;
}[keyof LayersState];
export interface GroupData {
  status: LoadStatus;
  fetchedAtMs: number | null; // from public/data/gp/meta.json
  count: number; // objects drawn after dedupe and docking
}
export interface HorizonData {
  status: LoadStatus;
  profileDeg: Float32Array | null; // 360 values, 1 per degree of azimuth
  imagerySources: string[]; // dataset prefixes (eudem, srtm, …) from x-amz-meta-x-imagery-sources
}
export interface DataState {
  cameras: LoadStatus;
  gibs: LoadStatus; // capabilities snapshot parsed
  stars: LoadStatus;
  gp: Record<GpGroup, GroupData>;
  horizon: Record<string, HorizonData>; // keyed by camera id
  goes: {
    status: LoadStatus; // DescribeDomains poll; the tile guard sets "error" (M7)
    intervals: readonly TimeInterval[]; // from DescribeDomains, minus steps whose tiles failed
    latestStepMs: number | null; // newest step confirmed by a HEAD probe
  };
}
export interface StarPair {
  imagePx: readonly [uPx: number, vPx: number];
  targetId: StarId | PlanetId;
  role: "fit" | "holdout"; // holdout pairs are measured, never fitted
  residualPx: number | null; // from the last fit
  rejected: boolean; // dropped by the 3σ rule in the last fit
}
export interface CalibrationUiState {
  pairs: StarPair[];
  pendingPx: readonly [uPx: number, vPx: number] | null; // image click waiting for its catalog object
  fit: { rmsPx: number; rmsDeg: number; maxFitDeg: number; maxHoldoutDeg: number | null } | null;
}
export interface VideoState {
  status:
    | "idle"
    | "loading"
    | "playing"
    | "buffering"
    | "paused"
    | "ended"
    | "error"
    | "embed-blocked";
  errorCode: number | null; // YouTube onError: 101/150 embedding disabled (150 also: dead or unknown id), 153 no Referer
}
export interface UiState {
  panel: "calibration" | "layers" | null;
  demo: { active: boolean; step: number; paused: boolean };
}

export interface StateData {
  clock: ClockState;
  camera: CameraState;
  selection: SelectionState;
  layers: LayersState;
  data: DataState;
  calibrationUi: CalibrationUiState;
  video: VideoState;
  ui: UiState;
}

export interface Actions {
  // clock
  tick(simTimeMs: number): void;
  setMode(mode: ClockState["mode"]): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setRate(rate: ClockRate): void;
  stepBy(deltaMs: number): void;
  seek(timeMs: number): void;
  jumpToNow(): void;
  recenter(timeMs: number): void;
  // camera
  setRegistry(registry: Record<string, CameraConfig>): void;
  setActiveCamera(id: string): void;
  setCameraStatus(id: string, status: CameraStatus): void;
  setFrameTimeMs(timeMs: number | null): void;
  updateCalibration(patch: Partial<Omit<Calibration, "updatedAtMs">>): void;
  setStreamDelayMs(ms: number): void;
  resetCalibration(): void;
  importCalibration(id: string, calibration: Calibration): void;
  // selection
  select(id: ObjectId | null): void;
  hover(id: ObjectId | null): void;
  setFollow(on: boolean): void;
  // layers
  setLayer(key: LayerToggle, on: boolean): void;
  toggleLayer(key: LayerToggle): void;
  setFootprintHeightKm(km: number | null): void;
  setStarMagLimit(vmag: number): void;
  setVideoLayer(key: keyof VideoOverlayLayers, on: boolean): void;
  // data
  setLoadStatus(key: "cameras" | "gibs" | "stars", status: LoadStatus): void;
  setGroupData(group: GpGroup, patch: Partial<GroupData>): void;
  setHorizon(cameraId: string, patch: Partial<HorizonData>): void;
  setGoesDomain(intervals: readonly TimeInterval[], latestStepMs: number | null): void;
  setGoesStatus(status: LoadStatus): void;
  // calibration UI
  addImagePoint(uPx: number, vPx: number): void;
  completePair(targetId: StarId | PlanetId): void;
  setPairRole(index: number, role: StarPair["role"]): void;
  removePair(index: number): void;
  clearPairs(): void;
  cancelImagePoint(): void;
  applyFit(
    calibration: Calibration,
    residualPx: readonly number[],
    rejected: readonly boolean[],
    fit: NonNullable<CalibrationUiState["fit"]>,
  ): void;
  // video
  setVideoStatus(status: VideoState["status"], errorCode?: number | null): void;
  // ui
  openPanel(panel: UiState["panel"]): void;
  togglePanel(panel: NonNullable<UiState["panel"]>): void;
  startDemo(): void;
  setDemoStep(step: number): void;
  stopDemo(): void;
  setDemoPaused(paused: boolean): void;
}

export interface AppState extends StateData {
  actions: Actions;
}
```

```ts
// src/state/initialState.ts
import type { StateData } from "./types";

export const DEFAULT_CAMERA_ID = "synthetic-maunakea";

const idleGroup = { status: "idle", fetchedAtMs: null, count: 0 } as const;

export function initialState(nowMs: number, activeId: string): StateData {
  return {
    clock: { mode: "replay", playing: false, rate: 1, simTimeMs: nowMs, rangeCenterMs: nowMs },
    camera: { activeId, registry: {}, calibration: {}, status: {}, frameTimeMs: null },
    selection: { selectedId: null, hoverId: null, follow: false },
    layers: {
      trueColor: true,
      coastlines: true,
      goesIr: false,
      hillshade: false,
      footprint: false,
      stars: true,
      planets: true,
      satellites: true,
      starlink: false,
      trails: true,
      grid: true,
      horizon: true,
      footprintHeightKm: null,
      starMagLimit: 4.5,
      video: { starlink: false, grid: false, denseLabels: false },
    },
    data: {
      cameras: "idle",
      gibs: "idle",
      stars: "idle",
      gp: { stations: { ...idleGroup }, visual: { ...idleGroup }, starlink: { ...idleGroup } },
      horizon: {},
      goes: { status: "idle", intervals: [], latestStepMs: null },
    },
    calibrationUi: { pairs: [], pendingPx: null, fit: null },
    video: { status: "idle", errorCode: null },
    ui: { panel: null, demo: { active: false, step: 0, paused: false } },
  };
}
```

The store, created with an annotated return type (a bare `() => ({...})` initializer fails with TS2345):

```ts
// src/state/store.ts
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { createActions } from "./actions";
import { DEFAULT_CAMERA_ID, initialState } from "./initialState";
import type { AppState, StateData } from "./types";

export function createAppStore(initial: StateData) {
  // The annotated return type is required: a bare `() => ({...})` fails with TS2345.
  return createStore<AppState>()(
    subscribeWithSelector(
      (set, get): AppState => ({ ...initial, actions: createActions(set, get) }),
    ),
  );
}
export type AppStore = ReturnType<typeof createAppStore>;

/** The app singleton. main.tsx applies URL state through actions before the first render. Tests use createAppStore. */
export const store: AppStore = createAppStore(initialState(Date.now(), DEFAULT_CAMERA_ID));
```

### Actions

Every action lives in the one `actions` object, built by `createActions(set, get)` in `src/state/actions.ts` (section 6). Actions that write time call `clampToScrubRangeMs`.

`createActions` returns all 45 actions from M0 (44 before O1 added `setVideoLayer`). An action whose milestone has not landed is a placeholder that throws `Error("actions.<name> lands in M<n>")` (M0 step 6). Each milestone replaces its own placeholders, test first. M0's `store.test.ts` asserts that exactly the unlanded actions throw, and each milestone removes its actions from that list. Placeholders left: 41 after M0, 28 after M1, 27 after M2, 23 after M3, 11 after M4, 8 after M5, 7 after M6, 4 after M8 (with M7 merged), none after M9. M7 removes 2 whenever it lands.

| Action | Semantics | Lands in |
| ------ | --------- | -------- |
| `tick(simTimeMs)` | Called only by `clockLoop.ts`, once per frame. Writes `clock.simTimeMs`. | M0 |
| `play()`, `pause()`, `togglePlay()` | `pause` also switches to replay. | M0 |
| `setMode(mode)` | `live`: rate 1 and playing. `replay`: keeps rate and playing. | M1 |
| `setRate(rate)` | Switches to replay. Changes the propagation grid (a flush). | M1 |
| `stepBy(deltaMs)`, `seek(timeMs)` | Switch to replay, keep `playing`, then move and clamp to ± 12 h of `rangeCenterMs`. | M1 |
| `recenter(timeMs)` | `simTimeMs = rangeCenterMs = timeMs`, mode `replay`, `playing` false. Applies `?t=` (which `seek` could not reach) and a clip's start (M5). | M1 |
| `jumpToNow()` | `simTimeMs = rangeCenterMs = Date.now()`; keeps the mode. | M1 |
| `setRegistry(registry)` | After `cameras.json` loads, with only the enabled entries. | M1 |
| `setActiveCamera(id)` | Sets `activeId` and clears `frameTimeMs` (M1); also clears `calibrationUi` (M4) and resets `video` to `{ status: "idle", errorCode: null }` (M5). Nothing is copied; selectors derive the rest. | M1 |
| `setLayer(key, on)`, `toggleLayer(key)` | Boolean layer toggles. | M1 |
| `setLoadStatus(key, status)` | `cameras` and `gibs` in M1, `stars` in M2. | M1 |
| `openPanel(panel)`, `togglePanel(panel)` | `layers` in M1, `calibration` in M4. | M1 |
| `setStarMagLimit(vmag)` | Ignores non-finite values; clamps to [1, 6.5]. | M2 |
| `select(id)` | `null` also turns `follow` off. | M3 |
| `hover(id)` | No state change when the id is unchanged. | M3 |
| `setFollow(on)` | | M3 |
| `setGroupData(group, patch)` | Load status, `fetchedAtMs`, `count`. | M3 |
| `updateCalibration(patch)` | Writes `calibration[activeId]`, copying `registry[activeId].defaults` the first time, through `normalizeCalibration`; stamps `updatedAtMs`. A write that fails `distortionValid` for the camera's model leaves the state unchanged. | M4 |
| `resetCalibration()` | Deletes `calibration[activeId]`, so the defaults apply. | M4 |
| `importCalibration(id, calibration)` | After validation in `persist.ts` (a `CalibrationFileV1` names its camera, M4 step 8); when a clip camera without a calibration of its own loads: the sidecar's `calibration`, else its source camera's current calibration, with `streamDelayMs` 0 (M5); and from "Copy pointing" on a clip camera, which writes the clip's geometry to `source.sourceCameraId` and keeps that camera's own `streamDelayMs` (M5 step 10.7: the only way a star fit made on a clip reaches a YouTube camera). Normalizes and rejects like `updateCalibration`. | M4 |
| `setCameraStatus(id, status)`, `setFrameTimeMs(timeMs)` | | M4 |
| `addImagePoint(uPx, vPx)`, `completePair(targetId)`, `setPairRole(index, role)`, `removePair(index)`, `clearPairs()` | Star-pair editing. A pair needs an image click, then a catalog object. `addImagePoint` replaces a pending point; `completePair` is a no-op without one and replaces a pair with the same `targetId`. | M4 |
| `cancelImagePoint()` | Clears `calibrationUi.pendingPx` (Esc). | M4 |
| `applyFit(calibration, residualPx, rejected, fit)` | Stores the fitted calibration for the active camera (normalized, rejected if it fails `distortionValid`, `updatedAtMs` stamped) and the per-pair residuals. | M4 |
| `setStreamDelayMs(ms)` | No-op unless the active camera is `youtube`; ignores non-finite input; else `updateCalibration({ streamDelayMs: clampStreamDelayMs(ms) })` (0–120,000 ms). The only writer of the delay. | M5 |
| `setVideoStatus(status, errorCode)` | From the player or the `<video>` element; `errorCode` defaults to null. | M5 |
| `setVideoLayer(key, on)` | Writes `layers.video[key]` (a new `video` object; no change when the value is unchanged). | M5 |
| `setHorizon(cameraId, patch)` | Merges into `data.horizon[cameraId]`, starting from `{ status: "idle", profileDeg: null, imagerySources: [] }`. From `bindHorizonWorker`. | M6 |
| `setGoesDomain(intervals, latestStepMs)` | From the DescribeDomains poll, the HEAD probe and the tile guard; keeps the array reference it is given. | M7 |
| `setGoesStatus(status)` | DescribeDomains load status; the tile guard sets `error` after 3 fallbacks in a row. | M7 |
| `setFootprintHeightKm(km)` | `null` follows the selected satellite's height; otherwise a finite number > 0; anything else is ignored. | M8 |
| `startDemo()`, `setDemoStep(step)`, `stopDemo()`, `setDemoPaused(paused)` | `startDemo` gives `{ active: true, step: 0, paused: false }`; `setDemoStep` clamps to [0, `DEMO_STEPS.length` − 1]; `stopDemo` resets. | M9 |

### Selectors

Every selector returns a primitive or an existing reference, so it is safe in React and in bindings. Each lands with its first user (the tag in its comment). One more selector, `selectGoesLabel(s): string | null` (M7), returns the GOES caption from the text table in M7 step 3; it is read during a `useTick4Hz` render, never through `useAppState`.

```ts
// src/state/selectors.ts — every selector returns a primitive or an existing reference. [Mn] = the milestone of its first user.
import type { GroupMask } from "../domain/orbits";
import { goesStepMs, sampleStepMs, trueColorDateUtc } from "../domain/time";
import {
  type AppState,
  type Calibration,
  type CameraConfig,
  type CameraSite,
  type GpGroup,
  type LayerToggle,
  type LoadStatus,
  VIDEO_STAR_MAG_LIMIT,
} from "./types";

/** [M1] */
export const selectActiveCamera = (s: AppState): CameraConfig | undefined =>
  s.camera.registry[s.camera.activeId];

/** [M1] */
export const selectSite = (s: AppState): CameraSite | null =>
  s.camera.registry[s.camera.activeId]?.site ?? null;

/** [M2] */
export const selectCalibration = (s: AppState): Calibration | undefined =>
  s.camera.calibration[s.camera.activeId] ?? s.camera.registry[s.camera.activeId]?.defaults;

/** [M5] */
export const selectStreamDelayMs = (s: AppState): number =>
  s.camera.calibration[s.camera.activeId]?.streamDelayMs ??
  s.camera.registry[s.camera.activeId]?.defaults.streamDelayMs ??
  0;

/** [M5] Live mode on a YouTube camera: rate locked to 1, any play/pause/scrub/step switches to replay. */
export const selectLiveLocked = (s: AppState): boolean =>
  s.clock.mode === "live" && s.camera.registry[s.camera.activeId]?.kind === "youtube";

/** [M5] The sky map is drawn over a video: youtube and local-video cameras get the light overlay set. */
export const selectSkyOverVideo = (s: AppState): boolean => {
  const kind = s.camera.registry[s.camera.activeId]?.kind;
  return kind === "youtube" || kind === "local-video";
};

/** [M5] Sky-view visibility of a toggle; over a video, starlink and grid also need their layers.video gate. */
export const selectSkyLayerVisible =
  (key: LayerToggle) =>
  (s: AppState): boolean => {
    if (!s.layers[key]) return false;
    if (!selectSkyOverVideo(s)) return true;
    if (key === "starlink") return s.layers.video.starlink;
    if (key === "grid") return s.layers.video.grid;
    return true;
  };

/** [M5] Every label the full sky view draws; over a video only with layers.video.denseLabels. */
export const selectSkyDenseLabels = (s: AppState): boolean =>
  !selectSkyOverVideo(s) || s.layers.video.denseLabels;

/** [M3] Propagation grid spacing D = 100 ms × rate (rate 1 in live mode). */
export const selectSampleStepMs = (s: AppState): number =>
  sampleStepMs(s.clock.mode === "live" ? 1 : s.clock.rate);

/** [M3] Groups the worker propagates: stations and visual always, Starlink while its toggle is on. */
export const selectGroupMask = (s: AppState): GroupMask => 0b011 | (s.layers.starlink ? 0b100 : 0);

/** [M6] The active camera's profile, or null (use the geometric horizon). */
export const selectHorizonProfileDeg = (s: AppState): Float32Array | null =>
  s.data.horizon[s.camera.activeId]?.profileDeg ?? null;

/** [M6] */
export const selectHorizonStatus = (s: AppState): LoadStatus =>
  s.data.horizon[s.camera.activeId]?.status ?? "idle";

/** [M7] GOES Time value in epoch ms; changes once per 10-minute step. */
export const selectGoesStepMs = (s: AppState): number | null =>
  goesStepMs(s.clock.simTimeMs, s.data.goes.intervals, s.data.goes.latestStepMs);

/** [M7] The GOES layer shows only when on, availability is loaded and a step exists. */
export const selectGoesVisible = (s: AppState): boolean =>
  s.layers.goesIr && s.data.goes.status === "ready" && selectGoesStepMs(s) !== null;

/** [M1] VIIRS true-colour date "YYYY-MM-DD" for the active site. */
export const selectTrueColorDate = (s: AppState): string | null => {
  const site = selectSite(s);
  return site === null ? null : trueColorDateUtc(s.clock.simTimeMs, site.lonDeg);
};

/** [M2] V ≤ 4 while calibrating; [M5] else V ≤ VIDEO_STAR_MAG_LIMIT over a video; else the layer setting. */
export const selectStarMagLimit = (s: AppState): number => {
  if (s.ui.panel === "calibration") return Math.min(4, s.layers.starMagLimit);
  if (selectSkyOverVideo(s)) return Math.min(VIDEO_STAR_MAG_LIMIT, s.layers.starMagLimit);
  return s.layers.starMagLimit;
};

/** [M3] */
export const selectGroupStatus =
  (group: GpGroup) =>
  (s: AppState): LoadStatus =>
    s.data.gp[group].status;

/** [M8] Incoming alerts cover only the groups whose layers are on. */
export const selectIncomingMask = (s: AppState): GroupMask =>
  (s.layers.satellites ? 0b011 : 0) | (s.layers.starlink ? 0b100 : 0);

/** [M8] Alerts pause while replay plays at 60× or 600× (the 60 s look-ahead lasts under a second). */
export const selectIncomingActive = (s: AppState): boolean =>
  selectIncomingMask(s) !== 0 &&
  !(s.clock.mode === "replay" && s.clock.playing && s.clock.rate >= 60);
```

`selectStreamDelayMs` was run against a live store: it fired `[50000, 22000]` across the default and one slider change, did not fire on clock ticks, and left `registry[id].defaults` untouched.

### Camera kinds

| kind | Sky view background | Overlay set | Pointer input | Live clock |
| ---- | ------------------- | ----------- | ------------- | ---------- |
| `synthetic` | none; fixed full-frame view, no interactions (M2) | full | the map (`pick`) | `Date.now()` |
| `still-image` | `ImageStatic` in the active camera's pixel projection, extent `[0, 0, W, H]`, on the `ImageLayer<ImageSource>` background layer; a new source every `refreshSec` (≥ 60 s) with a cache-busting query; `crossOrigin` set only when `corsEnabled`; frozen while the Calibration panel is open; pan and zoom (M4) | full | the map (`pick`) | `frameTimeMs ?? Date.now()`: the capture time of the image on screen |
| `youtube` | the YouTube player itself. The transparent sky map sits on top of the player in the sky stage, with M2's fixed full-frame view fitted to the video's content box (M5) | light | hit targets only (`setPassThrough(true)`); every other click goes to the player, so there are no star pairs: pointing comes from the defaults, alignment by eye, or "Copy pointing" from a clip of the same camera (M5) | `youtubeLiveTimeMs(...)` from the player's media time |
| `local-video` | `ImageCanvas` (`ratio: 1`) on the same background layer, redrawn on each `requestVideoFrameCallback` and `seeked`; pan and zoom (M5). The clip comes from a `ClipSidecar` (section 6, `src/app/clip.ts`) | light | the map (`pick`) | none: the video is the master clock, always replay |

### Sky over video

These rules hold while `selectSkyOverVideo` is true, that is for `youtube` and `local-video` cameras. Rules 1–3 apply to both kinds; rules 4–9 concern the YouTube player.

1. **The light set.** The overlay on a video draws only this, by default. The ground map keeps every layer and all its detail.
   - Satellites: the ISS and the other satellites of the `satellites` layer in the frame, that is the stations and visual groups (`layers.satellites`); the light set gates no group other than Starlink. Starlink only when `selectSkyLayerVisible("starlink")` is true, which needs both `layers.starlink` and `layers.video.starlink`.
   - Labels: only for the ISS, the selected object, the hovered object, the Sun, the Moon and the planets. `layers.video.denseLabels` restores every label (`selectSkyDenseLabels`).
   - Stars: V ≤ `VIDEO_STAR_MAG_LIMIT` (2), as small marks without labels, each named on hover (`selectStarMagLimit`; V ≤ 4 while the Calibration panel is open). Measured with the Subaru defaults on 2026-10-11 over the M2 prototype's `stars.json` (8,404 rows, 'normal' refraction), V ≤ 2 gives 1, 8, 5 and 2 stars in the frame at 06:00, 09:00, 12:00 and 15:12 UTC (Regulus and Alphard at 15:12); V ≤ 3 gives 7–22.
   - Trails: only the selected object's 30 s trail and its next 2-minute path (section 5, "Sky paths"). Other objects get none.
   - The selection halo and the hover highlight, as on every camera.
   - Grid: only when `selectSkyLayerVisible("grid")` is true (`layers.grid` and `layers.video.grid`).
   - Horizon: the terrain skyline as a thin line, plus behind-terrain dimming (`layers.horizon`).
2. **Toggles.** While `selectSkyOverVideo` is true the Layers panel shows an "On the video" group: Starlink, grid and dense labels, each calling `setVideoLayer`. The shared toggles still apply. Every sky-view layer binds through `bindSkyLayerVisible`, never `bindLayerVisible`.
3. **Rendering only.** The light set changes what the sky view draws, nothing else. The worker propagates the same groups (`selectGroupMask`), `ephemeris.ts` keeps every object, and the Inspector, the ground map and the text alternative are unchanged.
4. **The sky stage.** `SkyView.tsx` renders one stage element (`data-testid="sky-stage"`) that holds the sky map target. For a `youtube` camera the stage has the camera's aspect ratio W:H and holds two children that both fill it: the player wrapper (`data-testid="video-player"`, the element `mountYoutubePlayer` receives) and, on top, the sky map target (`data-testid="sky-map"`). The map target is the same element for every camera kind; only the player wrapper comes and goes, so the map lifecycle below does not change with the camera.
5. **Pointer pass-through** (`verification/openlayers.md` claim 12). `setPassThrough(true)` sets `pointer-events: none` on the map target element itself; setting it only on `.ol-viewport` still blocks the iframe. The map's `click`, `singleclick` and `pointermove` picking handlers are detached, and every click, hover and player control goes to the player. It also sets `pointer-events: none` on the HoverCard overlay's container (`hoverElement.parentElement`): OpenLayers sets `pointer-events: auto` on every overlay container, and a card over the player took its clicks until set to `none` (M5 step 8.2). Pass-through cannot be switched from `pointermove`: the page gets no events while the pointer is over the cross-origin iframe.
6. **Hit targets** (`src/map/sky/layers/hitTargets.ts`). Each drawn object that can be picked gets a DOM hit target: a `<button type="button">` placed with `ol/Overlay` and `stopEvent: false`, which OpenLayers sets to `pointer-events: auto`.
   - Targets: the ISS and every other drawn stations or visual satellite, the drawn stars, the Sun, the Moon, the planets and the selected object.
   - `pointerenter` and `pointerleave` call `hover`; `click` calls `select`.
   - Each is at least 24 × 24 CSS px, with the object's name as `aria-label` and `tabIndex` −1. Keyboard users select from the text alternative.
   - A frame updater moves the targets with `setPosition`. Overlays are created as needed, reused, and parked with `setPosition(undefined)`; none is created per frame.
   - Starlink gets no targets. If picking it on the video is needed later, use one clip-path hit layer (openlayers.md claim 12 measured about 1.77 ms for 5,000 circles).
7. **Fullscreen.** Create the player with `playerVars.fs: 0`, the documented player parameter that removes its fullscreen button: YouTube's own fullscreen would show the player without the overlay. On the real player `fs: 0` removed the button (measured in M5), but the `f` key still made the focused iframe fullscreen. So `SkyView` listens for `fullscreenchange` on `document`, and when `document.fullscreenElement` is inside the stage but is not the stage, it calls `document.exitFullscreen()` and shows a note to use the stage's button; the guard left the player's fullscreen 16–17 ms after it began (M5 step 8.5). Do not pass `disablekb: 1`: it stops `f` but also removes the player's other keys. A Fullscreen button outside the stage calls `stage.requestFullscreen()`, so the player and the overlay go fullscreen together; Esc exits.
8. **Content box.** The player letterboxes the video inside its iframe whenever the stage's aspect ratio differs from the video's, for example in fullscreen on a 16:10 screen. The map target fills the same box as the iframe, and `fitSkyFrame` runs on every `change:size`. OpenLayers' `view.fit([0, 0, W, H], { size })` gives exactly the centred contain box: checked with ol 10.11.0 at 1280 × 720, 1440 × 900, 1512 × 982, 1920 × 1080 and 900 × 1440 (1440 × 900 gives a 1440 × 810 box 45 px from the top). The player's `setSize(w, h)` and the map's own `ResizeObserver` both follow the stage. Both StarCams and the 2026-10-11 clip are 16:9.
9. **Fallback to replay.** On `onError` 101, 150 or 153, once M5's re-resolve rule has run: `setVideoStatus("embed-blocked", code)`, `setCameraStatus(id, "offline")`, `setMode("replay")`, destroy the player, and keep the sky map in the stage in the camera's framing. VideoPanel then offers:
   - "Replay the recorded clip" for each enabled `local-video` camera whose `source.sourceCameraId` is this camera, newest first; it calls `setActiveCamera(clipId)`;
   - "Replay a local clip", which selects `local-replay`.

   Errors 2 and 5 give `error` with Retry (M5).

### React rules

1. React never owns OpenLayers objects or high-rate data.
2. Read the store with `useAppState(selector)`, where the selector returns a primitive or an existing reference. Never return a new object, array or function: zustand 5 then throws React error #185.
3. For several fields, wrap the selector in `useShallow`, as `useClockControls` does.
4. Get actions with `useActions()`: one stable reference. Never pick actions into a new object.
5. Time-varying readouts (time readout, scrubber thumb, Inspector live fields, incoming chip, GOES caption, camera daytime status) re-render only through `useTick4Hz()`, and read `store.getState()`, `ephemeris.ts`, `skyCache.ts` and `footprintStatus` during render. Never start a per-component interval and never subscribe a component to `clock.simTimeMs`. The one exception is a re-render in the scrubber's own `onChange` (M1 step 15): it answers the user's input, not the clock.
6. Functions that build a new array, such as `dataCredits` and `starCredits`, are called during render, never inside `useAppState`.

```ts
// src/state/hooks.ts
import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { store } from "./store";
import type { Actions, AppState } from "./types";

/** Primitive or existing-reference selectors only. */
export const useAppState = <T>(selector: (s: AppState) => T): T => useStore(store, selector);
/** One stable reference for every action. */
export const useActions = (): Actions => useStore(store, (s) => s.actions);
/** Several fields at once: useShallow, or React throws error #185 in zustand 5. */
export const useClockControls = () =>
  useStore(
    store,
    useShallow((s: AppState) => ({
      playing: s.clock.playing,
      rate: s.clock.rate,
      mode: s.clock.mode,
    })),
  );

// One shared 4 Hz ticker: every subscriber re-renders in the same commit.
const listeners = new Set<() => void>();
let tickCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
function subscribeTick(onTick: () => void): () => void {
  listeners.add(onTick);
  if (timer === null) {
    timer = setInterval(() => {
      tickCount += 1;
      for (const l of listeners) l();
    }, 250);
  }
  return () => {
    listeners.delete(onTick);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const getTick = (): number => tickCount;
/** Re-renders the caller at 4 Hz; read live values (store.getState(), ephemeris) during render. */
export const useTick4Hz = (): number => useSyncExternalStore(subscribeTick, getTick, getTick);
```

Run in headless Chromium (development build, StrictMode, a 60 Hz `tick` loop): three ticker components and the `useShallow` hook produced 20 commits in 5 s (4.0 per second) and no errors.

### Binding rules

1. Bindings live in `src/map/sync`, one exported function per concern, shaped `(store: AppStore, ...olObjects) => () => void`. The one exception is `bindHillshadeTexel(map, layer, source)` (M6): it listens only to OpenLayers view events and takes no store.
2. Subscribe with `store.subscribe(selector, listener, { equalityFn: shallow, fireImmediately: true })`. Import `shallow` from `zustand/vanilla/shallow`, never from `zustand/shallow` (which pulls in React).
3. Listeners run synchronously inside `setState`, so both maps see a selection in the same frame.
4. Listeners mutate OpenLayers objects directly. They never call `setState` on the slice they watch.
5. Per-frame work is not a binding. Register it with `registerFrameUpdater` in `clockLoop.ts` (section 7).
6. Return the unsubscribe function. The map's effect cleanup calls every one.
7. A binding may also call actions from an OpenLayers event listener (for example `bindGoesLayer` on `tileloaderror`, M7). That is not a store listener, so rule 4 still holds.

```ts
// src/map/sync/bindSelection.ts
import { shallow } from "zustand/vanilla/shallow";
import type { AppStore } from "../../state/store";
import type { ObjectId } from "../../state/types";

/** Calls apply now and whenever selection or hover changes. Returns the unsubscribe function. */
export function bindSelection(
  store: AppStore,
  apply: (selectedId: ObjectId | null, hoverId: ObjectId | null) => void,
): () => void {
  return store.subscribe(
    (s) => [s.selection.selectedId, s.selection.hoverId] as const,
    ([selectedId, hoverId]) => apply(selectedId, hoverId),
    { equalityFn: shallow, fireImmediately: true },
  );
}
```

```ts
// src/map/sync/bindLayers.ts
import type BaseLayer from "ol/layer/Base";
import { shallow } from "zustand/vanilla/shallow";
import { selectSkyLayerVisible } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { LayerToggle } from "../../state/types";

/** One call per toggle and OpenLayers layer: ground-map layers, and sky layers until M5. */
export function bindLayerVisible(store: AppStore, key: LayerToggle, layer: BaseLayer): () => void {
  return store.subscribe(
    (s) => s.layers[key],
    (on) => layer.setVisible(on),
    {
      equalityFn: shallow,
      fireImmediately: true,
    },
  );
}

/** [M5] Sky-view layers: the toggle, gated by layers.video while the sky is over a video. */
export function bindSkyLayerVisible(
  store: AppStore,
  key: LayerToggle,
  layer: BaseLayer,
): () => void {
  return store.subscribe(selectSkyLayerVisible(key), (on) => layer.setVisible(on), {
    equalityFn: shallow,
    fireImmediately: true,
  });
}
```

```ts
// src/map/sync/bindGoes.ts
import { shallow } from "zustand/vanilla/shallow";
import { isoUtcSeconds } from "../../domain/time";
import { selectGoesStepMs } from "../../state/selectors";
import type { AppStore } from "../../state/store";

/** setTime receives "YYYY-MM-DDThh:mm:00Z" once per 10-minute step (wire it to WMTS updateDimensions). */
export function bindGoesTime(store: AppStore, setTime: (iso: string) => void): () => void {
  return store.subscribe(
    selectGoesStepMs,
    (stepMs) => {
      if (stepMs !== null) setTime(isoUtcSeconds(stepMs));
    },
    { equalityFn: shallow, fireImmediately: true },
  );
}
```

All four were run against a live store (`bindLayerVisible` and `bindSkyLayerVisible` with a real `ol/layer/Vector` in Node). `bindSelection` fired `[null, null]` immediately, then once per selection or hover change, never on clock ticks and never after unsubscribe. `bindGoesTime` fired twice for a 1 s-step scrub from 09:58 to 10:02 UTC (`09:50`, then `10:00`). `bindSkyLayerVisible(store, "grid", layer)` showed the grid on a synthetic camera, hid it on switching to a `youtube` camera, ignored a clock tick, showed it again with `layers.video.grid`, followed `layers.grid` off and on, kept it on a `local-video` camera, and stopped after unsubscribe. On the same store the M5 selectors gave `selectStarMagLimit` 4.5 on synthetic and still-image cameras, 2 on `youtube` and `local-video`, and 4 with the Calibration panel open.

### Map lifecycle

1. `SkyView.tsx` and `GroundView.tsx` build a new map and new layers on every run of a `useEffect` on their container ref, start their bindings and frame updaters, and return `registerMap(id, map, disposers)` from `src/map/registry.ts` (`MapId` is `"ground"` or `"sky"`). React 19 StrictMode runs the effect as mount, cleanup, mount in development.
2. `registerMap`'s cleanup is the only implementation of the cleanup order: call every disposer (binding unsubscribes and frame-updater unregisters); `map.getAllLayers().forEach((l) => l.dispose())`; `map.dispose()` (it calls `setTarget(null)` and removes controls, interactions, overlays and the ResizeObserver, but does not dispose layers); `if (registry.get(id) === map) registry.delete(id)`. The hit targets of the sky over a YouTube player are `ol/Overlay`s, so `map.dispose()` removes them too (`overlays_.clear()` in ol 10.11.0's `Map.disposeInternal`).
3. Never reuse a map whose layers were disposed: a disposed layer has a null source.
4. A map container has a non-zero size (any CSS): a zero-size map requests no tiles. `main.tsx` imports `ol/ol.css` (M1): without it the hidden rotate control shows. The OpenLayers attribution control is off; `Credits.tsx` is the only credit display.
5. Over a YouTube player (M5) the sky map keeps its one target element and its registry entry `"sky"`; the player is a sibling under it in the sky stage ("Sky over video" rule 4). The player and the map have separate effects: `mountYoutubePlayer` runs in an effect on the player wrapper keyed by camera id and resolved video id, and its `destroy()` never touches the map. `bindSkyCamera` calls `setPassThrough(kind === "youtube")` next to `setPanZoom`.

### URL and persistence

1. `src/app/url.ts` parses the URL once, before the first render:
   - `?cam=<camera id>`: an unknown or not-yet-enabled id falls back to `DEFAULT_CAMERA_ID` with a `console.warn`. A `local-video` camera with a `sidecarUrl` (for example `?cam=subaru-2026-10-11-iss`) loads its sidecar and clip when it becomes active (M5).
   - `?t=<ISO 8601 UTC ending in Z>`: `recenter(t)`, so replay, paused, `simTimeMs = rangeCenterMs = t`. A value without `Z` is rejected (`Date.parse` reads it as local time). Without `t` the app starts live (M1), or in replay at the clip's start on a `local-video` camera (M5).
   - `?sel=<ObjectId>` (M3), parsed by `parseObjectId`, for example `sat:25544`, `planet:Jupiter`, `star:424`, `moon`.
   - `?demo=1` (M9).
2. `startUrlSync` writes the URL with `history.replaceState` 250 ms after the last discrete change (camera, mode, pause, a seek or step while paused, selection, the tour), never per tick. `t` is written only in replay, and colons stay raw. `main.tsx` wraps the write in `try/catch` and `console.warn`s a failure: WebKit throws `SecurityError` after 100 calls in 10 s.
3. The address bar's `t` is stale while replay plays. Shared links come from `shareUrl(state, href)` (M9), never from `location.href`.
4. `src/app/persist.ts` (M4) stores `camera.calibration` under the `localStorage` key `overhead.calibration.v1`. Every read and write is inside `try/catch`; a failure means defaults. Calibration files are `CalibrationFileV1` (`format: "overhead.calibration"`, `version: 1`, M4 step 8).

## 5. Worker protocols

`src/workers/protocol.ts` holds only types and constants and is imported by both sides. The `[Mn]` tags give the milestone that first sends or handles a message.

```ts
// src/workers/protocol.ts — message types shared by the main thread and the workers. Types and constants only.
import type { CameraModelInput } from "../domain/camera";
import type { ObserverSite } from "../domain/geo";
import type { GpGroup, GroupMask } from "../domain/orbits";

// ---- propagation.worker.ts ----
export type PropagationIn =
  /** First message. generation starts at 0. */
  | { type: "init"; site: ObserverSite; generation: number }
  /** Fetch and parse public/data/gp/<group>.json (absolute URL) in the worker; appended after already-loaded groups. */
  | { type: "loadGroup"; group: GpGroup; url: string }
  /** Camera switch: new observer. The main thread bumps generation and discards older samples. Resets the horizon profile to null. */
  | { type: "setSite"; site: ObserverSite; generation: number }
  /** [M8] Camera model for the incoming check; null disables it. */
  | { type: "setCamera"; camera: CameraModelInput | null }
  /** [M8] Terrain profile for the incoming check (a structured-clone copy, never transferred); null = geometric horizon. */
  | { type: "setHorizonProfile"; profileDeg: Float32Array | null }
  /**
   * Compute sample k at t_k = k × stepMs into `buffer` (Float32Array(count × SAMPLE_STRIDE)), transferred.
   * Objects outside `groups` get valid = 0.
   */
  | {
      type: "sample";
      generation: number;
      k: number;
      stepMs: number;
      groups: GroupMask;
      buffer: ArrayBuffer;
    }
  /** Rebuild the requested tracks: selected ±10 min, others ±3 min, on the absolute 20 s grid. */
  | {
      type: "tracks";
      requestId: number;
      timeMs: number;
      selectedIndex: number | null;
      otherIndices: Int32Array;
    }
  /** [M3] ENU paths on the absolute SKY_PATH_STEP_MS grid in [fromMs, toMs]: trails and the selected 2-minute path. */
  | {
      type: "skyPaths";
      requestId: number;
      generation: number;
      fromMs: number;
      toMs: number;
      indices: Int32Array;
    }
  /** [M4] Exposure arc: `steps` samples from startMs, stepMs apart; step s, object i at (s × count + i) × SAMPLE_STRIDE. */
  | {
      type: "arc";
      requestId: number;
      startMs: number;
      stepMs: number;
      steps: number;
      groups: GroupMask;
      buffer: ArrayBuffer;
    }
  /** [M8] At most once per wall-clock second: which satellites enter the frame within 60 s. */
  | { type: "incoming"; requestId: number; timeMs: number; groups: GroupMask };

/** [M3] Grid of sky-path points, absolute multiples of this many ms. */
export const SKY_PATH_STEP_MS = 2_000;

/** Appended catalog rows; satrec index = firstIndex + i. */
export interface CatalogDelta {
  firstIndex: number;
  noradIds: Int32Array;
  names: string[];
  groupIndex: Uint8Array; // index into GP_GROUPS
  epochMs: Float64Array;
  dockedWith: Int32Array; // host NORAD id, or −1
}
export interface TrackOut {
  index: number;
  firstPointMs: number; // multiple of TRACK_STEP_MS
  lonLatDeg: Float64Array; // [lon, lat] pairs, longitudes unwrapped
}
export interface SkyPathOut {
  index: number;
  firstPointMs: number; // multiple of SKY_PATH_STEP_MS
  enuKm: Float32Array; // [e, n, u] triples; ends early at the first failed propagation
}
export interface IncomingEntry {
  index: number;
  etaSec: number; // 5, 10, … 60
}

export type PropagationOut =
  | {
      type: "groupLoaded";
      group: GpGroup;
      totalCount: number;
      fetchedAtMs: number | null;
      catalog: CatalogDelta;
    }
  | { type: "groupError"; group: GpGroup; message: string }
  /** Same buffer back, transferred. timeMs = k × stepMs, a plain number (never Float32). */
  | {
      type: "sample";
      generation: number;
      k: number;
      timeMs: number;
      sunAltDeg: number;
      computeMs: number;
      buffer: ArrayBuffer;
    }
  | { type: "tracks"; requestId: number; tracks: TrackOut[] }
  | { type: "skyPaths"; requestId: number; generation: number; paths: SkyPathOut[] }
  /** Same buffer back, transferred. */
  | {
      type: "arc";
      requestId: number;
      startMs: number;
      stepMs: number;
      steps: number;
      buffer: ArrayBuffer;
    }
  /** computeMs: performance.now() around collectIncoming; entries sorted by etaSec, then index. */
  | {
      type: "incoming";
      requestId: number;
      timeMs: number;
      computeMs: number;
      entries: IncomingEntry[];
    }
  | { type: "error"; message: string };

// ---- horizon.worker.ts ----
export interface HorizonIn {
  type: "compute";
  requestId: number;
  cameraId: string;
  latDeg: number;
  lonDeg: number;
  mastM: number; // z0 = DEM ground at the site (z14) + mastM
}
export type HorizonOut =
  | {
      type: "progress";
      requestId: number;
      cameraId: string;
      tilesDone: number;
      tilesTotal: number;
    }
  | {
      type: "done";
      requestId: number;
      cameraId: string;
      profileDeg: Float32Array; // 360 values, transferred
      groundM: number;
      z0M: number;
      limitM: number;
      imagerySources: string[]; // dataset prefixes, sorted
    }
  | { type: "error"; requestId: number; cameraId: string; message: string };
```

### Propagation: sample lifecycle

1. The main thread (`ephemeris.ts`) creates the worker with `new Worker(new URL("../workers/propagation.worker.ts", import.meta.url), { type: "module" })` and sends `init` with the active camera's `site`.
2. It sends `loadGroup` for `stations`, then `visual`. It sends `starlink` the first time `layers.starlink` turns on, and again on a later turn-on only after a `groupError` (no retry loop). The worker fetches and parses the file (`parseGpFile`), dedupes by NORAD id (`appendGroup`), builds satrecs with `json2satrec`, and replies `groupLoaded` with the appended catalog rows. Docked duplicates get `valid = 0` in every sample.
3. On every `groupLoaded` the main thread allocates a pool of 3 buffers of `Float32Array(totalCount × SAMPLE_STRIDE).buffer` and flushes (step 7).
4. The grid: `t_k = k × D`, `D = selectSampleStepMs(state)` (100 ms × rate; 100 ms in live mode). `timeMs` always travels as a plain number.
5. Steady state: the main thread holds samples `k` and `k+1` with `t_k ≤ render time < t_k+1`, and one request for `k+2` is in flight. When the render time passes `t_k+1`, sample `k`'s buffer is reused for the request for `k+3`. The worker has about 100 ms of wall time to answer. If a sample is late, hold every object at the newest sample (no extrapolation) until it arrives.
6. Each request transfers its buffer: `worker.postMessage(msg, [buffer])`. The worker writes into it with `writeSample` and transfers it back in the `sample` reply. Transferring detaches the sender's copy, so nobody keeps a reference to a buffer it has sent.
7. Flush when the render time leaves `[t_k, t_k + 2D]` (a seek, step, Now or jump), when `D` changes, when the group mask changes (`selectGroupMask`: Starlink toggled), when the site changes (`setSite`), or when a group loads. `SampleClient` (`src/state/sampleClient.ts`) holds this logic without a `Worker`, so Node tests drive it. A flush bumps `generation`, returns held samples to the pool, and requests `k` and `k+1` for the new time (two in flight once). Replies with an older `generation` go straight back to the pool.
8. If no spare buffer is ready, skip that request; never allocate per tick.
9. `computeMs` in each reply is `performance.now()` around the propagation loop: the worker budget in section 9.
10. Never use `createMultiThreadRuntime`. Until M9 every object goes through `writeSample`. From M9, Starlink samples always go through `writeCulledSample` (M9 step 2): each sample propagates one tenth of Starlink plus every candidate within `cullLimitKm(stepMs)`, and extrapolates the other rows along their held velocity; stations and visual are always propagated in full. `BulkPropagator` with `createSingleThreadRuntime()` ships only if it measures faster than culling on a target laptop (M9 step 3).
11. The GP source (M9 step 14f). Until M9 every `loadGroup` URL is `` `${import.meta.env.BASE_URL}data/gp/<group>.json` `` made absolute. From M9, while the active camera is a `local-video` camera with a `sidecarUrl` whose clip has loaded and whose `<clip>.gp/meta.json` answered OK with a JSON content type (probed once per clip), the source is `clipGpBaseUrl(sidecarAbsUrl)`: the clip's own element sets (section 8, "Recorded clips", "Element sets for a clip"). When the source changes, `ephemeris.ts` terminates the worker and starts a new one as at startup (`init`, then `loadGroup` for `stations`, `visual`, and `starlink` when `layers.starlink` is on), every `data.gp` entry goes to `loading`, and the catalogue is rebuilt: the worker's catalogue only appends. The protocol does not change.

### Propagation: tracks and incoming

1. Tracks: send `tracks` when the selection changes, when the set of satellites inside the camera frame changes (cap 100; Starlink only when selected), or when `floor(simTimeMs / 20000)` changes; at most 10 per second. The worker rebuilds every requested track on every request, on the absolute 20 s grid (selected ± 10 min, 61 points; others ± 3 min, 19 points): a full rebuild at the cap measured 1.2–1.3 ms median in a Chromium worker, so no per-satellite cache is kept. It replies with every requested track.
2. Sky paths (M3): `requestSkyPaths` sends `skyPaths` for `[t − 30 s − 2D, t + 120 s + 2D]` on the absolute `SKY_PATH_STEP_MS` grid, for the trails (last 30 s) and the selected satellite's next 2 minutes. Send when the tracked set or the selection changes, or `floor(t / 2000)` changes; at most 10 per second. Replies with an older `requestId` or `generation` are ignored.
3. Arcs (M4): for a live still-image camera with `exposureSec` > 1, `ephemeris.ts` sends one `arc` request each time `frameTimeMs` changes: `startMs = frameTimeMs − exposureSec × 500`, `stepMs` 5,000, `steps = floor(exposureSec / 5) + 1`, and a transferred `Float32Array(steps × count × SAMPLE_STRIDE)`.
4. Incoming (M8): send `setCamera` whenever the camera model changes, and `setHorizonProfile` whenever `selectHorizonProfileDeg` changes (after `setSite`, which resets the worker's profile to null); flush the `IncomingClient` after each. `IncomingClient` sends `incoming` at most once per wall-clock second, one in flight, none while paused and unchanged, and none while `selectIncomingActive` is false (60× and 600× while playing). The worker (`collectIncoming`) skips the whole pass when no group in `groups` meets its Sun cutoff now; skips docked objects, objects at or below −5° apparent now, and objects already visible in the frame; runs `incomingEtaSec` with the profile on the rest, which tests sunlit and above-horizon at each future sample (there is no "sunlit now" filter: it would miss satellites leaving Earth's shadow inside the frame); and replies with entries sorted by `etaSec`, then index, plus `computeMs`.

### Horizon

1. `bindHorizonWorker` (`bindHorizon.ts`) subscribes to the active camera and its site. When it fires, it sends `compute` if the camera has no entry in `data.horizon`, or its entry is `idle` or `error`, so an `error` entry is retried only when that camera is selected again. A `loading` or `ready` entry is reused, except when the camera id is the same as on the listener's previous call and its site's `latDeg`, `lonDeg` or `mastM` differs: then the entry belongs to the old site, and the binding resets it and computes again. That happens when a clip camera is replaced by a clip from another site (`local-replay` loading a `cfht-starcam` clip after starting on Subaru's placeholder site, M5 step 10). Every camera gets a profile, synthetic ones included. Its cleanup sets entries it left `loading` back to `idle` (StrictMode).
2. The worker plans tiles with `tilesForSite`, fetches them with plain `GET` (no custom headers, no `HEAD`), decodes each with `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })` and a `willReadFrequently` 2D `OffscreenCanvas` context, reads `x-amz-meta-x-imagery-sources` (kept as dataset prefixes such as `eudem`, `srtm`), and posts `progress` messages. Any failed tile ends the compute with `error`: there is no partial profile.
3. `z0 = DEM ground at the site (z14) + mastM`. It runs `horizonProfileDeg` and transfers `profileDeg` in `done`.
4. The main thread stores it with `setHorizon(cameraId, ...)`. Results for a camera that is no longer active are kept (the cache is per camera).
5. Until a profile is `ready` (and on `error`), every consumer uses the geometric horizon: `horizonAltAtAzDeg(null, az)` returns 0.

<a id="6-domain-module-apis"></a>

## 6. Module APIs

Each block is a module's public surface, written in declaration form (`.d.ts` syntax) so it type-checks without bodies. A `[Mn]` tag gives the milestone that adds a name; untagged names land with the module. Implement each as ordinary exported functions and constants in the files listed in section 3, re-exported from the module's `index.ts`. Tests target exactly these names. Hot-path functions take an `out` array and an `offset` and allocate nothing.

```ts
// src/domain/time/index.ts — public API (declaration form): epoch-ms arithmetic. No Date objects leave this module. [Mn] = landing milestone.
export type ClockRate = 1 | 10 | 60 | 600;
/** Closed interval of available imagery steps, epoch ms: [firstStepMs, lastStepMs]. */
export type TimeInterval = readonly [startMs: number, endMs: number];

export const MAX_WALL_DELTA_MS: 250; // [M0]
export const SCRUB_HALF_RANGE_MS: 43_200_000; // [M0]
export const SKY_RECOMPUTE_MS: 2_000; // [M2]
export const BASE_SAMPLE_STEP_MS: 100; // [M3]
export const TRACK_STEP_MS: 20_000; // [M3]
export const STREAM_DELAY_MAX_MS: 120_000; // [M5]
export const STREAM_DELAY_FINE_MS: 10_000; // [M5]
export const GOES_STEP_MS: 600_000; // [M7]
export const GOES_RETENTION_MS: 7_776_000_000; // [M7] 90 days

/** [M3] Propagation grid spacing D = 100 ms × rate (live mode passes rate 1). */
export function sampleStepMs(rate: ClockRate): number;
/** [M0] Replay without video: simTimeMs + min(max(wallDeltaMs, 0), 250) × rate. */
export function advanceReplayMs(simTimeMs: number, wallDeltaMs: number, rate: ClockRate): number;
/** [M0] Clamps into [centerMs − 12 h, centerMs + 12 h], inclusive. */
export function clampToScrubRangeMs(timeMs: number, centerMs: number): number;
/** [M5] Live YouTube: anchorWallMs + (mediaSec − anchorMediaSec) × 1000 − streamDelayMs. Freezes while the player stalls. */
export function youtubeLiveTimeMs(
  anchorWallMs: number,
  anchorMediaSec: number,
  mediaSec: number,
  streamDelayMs: number,
): number;
/** [M5] Rounds to whole ms and clamps to [0, STREAM_DELAY_MAX_MS]. Callers drop non-finite input first. */
export function clampStreamDelayMs(ms: number): number;
/** [M5] (nowMs − anchorWallMs) − (mediaSec − anchorMediaSec) × 1000: pauses and stalls add, a skip forward subtracts. */
export function youtubeStallMs(anchorWallMs: number, anchorMediaSec: number, nowMs: number, mediaSec: number): number;
/** [M5] The streamDelayMs that makes youtubeLiveTimeMs(...) equal frameUtcMs for the frame shown at mediaSec. */
export function streamDelayForFrameMs(
  anchorWallMs: number,
  anchorMediaSec: number,
  mediaSec: number,
  frameUtcMs: number,
): number;
/** [M5] Local video: startUtcMs + mediaTimeSec × 1000. */
export function localVideoTimeMs(startUtcMs: number, mediaTimeSec: number): number;
/** [M5] UTC of media time 0 from one frame whose UTC is known. */
export function clipStartUtcMs(frameUtcMs: number, mediaSec: number): number;
/** [M3] CelesTrak EPOCH has no zone suffix: append "Z" before parsing. */
export function parseOmmEpochMs(epoch: string): number;
/** [M0] "2026-10-11T03:20:00Z" (seconds, truncated, never rounded; GIBS rejects "hh:mmZ"). */
export function isoUtcSeconds(timeMs: number): string;
/** [M1] "2026-10-11". */
export function isoDateUtc(timeMs: number): string;
/** [M1] "2026-10-09 17:30:00" (24-hour) in an IANA zone; one cached Intl.DateTimeFormat per zone. */
export function formatZonedDateTime(timeMs: number, timeZone: string): string;
/** [M2] "03:20" for twilight markers and the "Imagery as of HH:MM UTC" label; truncates to the minute. */
export function formatUtcHhMm(timeMs: number): string;
/** [M3] Math.floor(timeMs / stepMs) × stepMs. */
export function floorToStepMs(timeMs: number, stepMs: number): number;
/**
 * [M7] Parses a GIBS <Domain> text "a/b/PT10M,c/d/PT10M,..." (items may also be "a/b" or "a"). A bare
 * "YYYY-MM-DD" is 00:00:00Z. Starts snap up and ends down to the 10-minute grid; empty items drop; the rest
 * are sorted and touching intervals joined. "" gives []. Throws on a malformed time or a period other than PT10M.
 */
export function parseGoesDomain(domain: string): TimeInterval[];
/**
 * [M7] Latest step ≤ floor10(timeMs) that lies inside an interval and ≤ latestStepMs (null: no cap); null if none.
 * In a gap it gives the last step before the gap.
 */
export function goesStepMs(
  timeMs: number,
  intervals: readonly TimeInterval[],
  latestStepMs: number | null,
): number | null;
/**
 * [M7] A fresh poll merged into the stored domain: steps up to next's last step come from next, later steps of prev
 * are kept (a lagging replica never shrinks the end), touching intervals join, and the result is clipped to steps
 * ≥ ceil10(newest end − GOES_RETENTION_MS). An empty next returns prev itself.
 */
export function mergeGoesIntervals(
  prev: readonly TimeInterval[],
  next: readonly TimeInterval[],
): readonly TimeInterval[];
/** [M7] Splits the interval that lists stepMs; returns the same reference when stepMs is not a listed step. */
export function removeGoesStep(intervals: readonly TimeInterval[], stepMs: number): readonly TimeInterval[];
/** [M7] Timeline ticks: each interval clipped to [ceil10(fromMs), floor10(toMs)] and ≤ latestStepMs (null: no cap). */
export function goesStepsInRange(
  intervals: readonly TimeInterval[],
  latestStepMs: number | null,
  fromMs: number,
  toMs: number,
): TimeInterval[];
/**
 * [M1] UTC date of the latest 13:30 local-mean-solar-time pass (NOAA-20's afternoon pass, local time = UTC + lon/15 h)
 * at siteLonDeg that is at least 4 h before timeMs. Flips at 03:51:52.536Z at Maunakea.
 */
export function trueColorDateUtc(timeMs: number, siteLonDeg: number): string;
/**
 * [M4] "2026-10-11T06:04:01" (seconds optional) read off a burned-in clock in an IANA zone → epoch ms.
 * null if malformed, an impossible date, an unknown zone, or a wall time skipped by a DST change;
 * an ambiguous wall time (the repeated autumn hour) gives the earlier instant.
 */
export function localDateTimeToUtcMs(localIso: string, timeZone: string): number | null;
```

```ts
// src/domain/geo/index.ts — public API (declaration form): WGS-84, ECEF, ENU, spherical rays. Hot-path functions write into `out` at `offset`. [Mn] = landing milestone.
/** [M2] Observer for astronomy and propagation. heightM = lens height above mean sea level. */
export interface ObserverSite {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM: number;
}
/** [M3] Row-major 3×3 matrix, length 9. */
export type Mat3 = Float64Array;

export const WGS84_A_KM: 6378.137; // [M3]
export const WGS84_B_KM: 6356.7523142; // [M3]
/** [M6] Footprint and destination sphere radius. Never mix with WGS-84 positions. */
export const EARTH_MEAN_RADIUS_KM: 6371.0088;
export const EARTH_ROTATION_RAD_S: 7.292115e-5; // [M3]

/** [M2] Result in [0, 360). */
export function wrap360(deg: number): number;
/** [M2] Result in [−180, 180). Compare results with a tolerance: wrap180(44.8) is 44.799999999999955. */
export function wrap180(deg: number): number;
/** [M2] Great-circle separation between two horizontal directions (haversine form). */
export function angularSeparationDeg(az1Deg: number, alt1Deg: number, az2Deg: number, alt2Deg: number): number;
/** [M3] Columns are East, North, Up in ECEF for geodetic latDeg/lonDeg (brief matrix). */
export function enuToEcefMatrix(latDeg: number, lonDeg: number, out?: Mat3): Mat3;
/** [M3] out[offset..+2] = M · (eKm, nKm, uKm). */
export function enuToEcef(m: Mat3, eKm: number, nKm: number, uKm: number, out: Float64Array, offset: number): void;
/** [M3] out[offset..+2] = Mᵀ · (dxKm, dyKm, dzKm). */
export function ecefToEnu(m: Mat3, dxKm: number, dyKm: number, dzKm: number, out: Float64Array, offset: number): void;
/** [M3] WGS-84 geodetic → ECEF km (same model as satellite.js geodeticToEcf). */
export function geodeticToEcefKm(latDeg: number, lonDeg: number, heightM: number, out: Float64Array, offset: number): void;
/** [M3] Unit ENU vector (cos alt sin az, cos alt cos az, sin alt). */
export function azAltToEnuUnit(azDeg: number, altDeg: number, out: Float64Array, offset: number): void;
/** [M3] out = [azDeg in [0, 360), altDeg] (geometric); az = atan2(E, N). */
export function enuToAzAltDeg(eKm: number, nKm: number, uKm: number, out: Float64Array, offset: number): void;
/** [M3] One-step Bowring latitude, lon = atan2(y, x): out = [latDeg, lonDeg]. Max error ≈ 1e-7° vs eciToGeodetic. */
export function ecefToLatLonDeg(xKm: number, yKm: number, zKm: number, out: Float64Array, offset: number): void;
/** [M3] lonDeg + k·360 such that |result − prevLonDeg| ≤ 180. */
export function unwrapLonDeg(prevLonDeg: number, lonDeg: number): number;
/** [M3] Unwraps interleaved [lon, lat, lon, lat, ...] pairs in place, starting from a lon in [−180, 180). */
export function unwrapLonLatPairsInPlace(lonLatDeg: Float64Array, pairCount: number): void;
/** [M6] Spherical destination point (great circle, EARTH_MEAN_RADIUS_KM), out = [latDeg, lonDeg in [−180, 180)]. */
export function destinationLatLonDeg(
  latDeg: number, lonDeg: number, azDeg: number, distanceM: number,
  out: Float64Array, offset: number,
): void;
/** [M8] Footprint model: O = (R + h)·û with R = EARTH_MEAN_RADIUS_KM. */
export function sphericalObserverKm(latDeg: number, lonDeg: number, heightM: number, out: Float64Array, offset: number): void;
/** [M8] Forward root t of |O + t·d| = radiusKm for a unit d; null if there is no real root or t ≤ 0. */
export function raySphereExitKm(
  oxKm: number, oyKm: number, ozKm: number,
  dx: number, dy: number, dz: number,
  radiusKm: number,
): number | null;
/** [M8] Distance to the first hit of the sphere radiusKm in front of O, or null if the ray misses it. A tangent counts as a hit. */
export function raySphereEntryKm(
  oxKm: number, oyKm: number, ozKm: number,
  dx: number, dy: number, dz: number,
  radiusKm: number,
): number | null;
/** [M8] Spherical: out = [asin(z/|P|), atan2(y, x)] in degrees. Footprint vertices only. */
export function sphericalLatLonDeg(xKm: number, yKm: number, zKm: number, out: Float64Array, offset: number): void;
/** [M8] −acos(R / (R + h)) in degrees; −2.081° at 4,204 m. */
export function geometricDipDeg(heightM: number): number;
/** [M8] WGS-84 geodetic height (km) of an ECEF point: one-step Bowring φ, then p·cos φ + z·sin φ − a·√(1 − e²·sin²φ). */
export function geodeticHeightKm(xKm: number, yKm: number, zKm: number): number;
```

```ts
// src/domain/orbits/index.ts — public API (declaration form): OMM handling, the packed sample layout, propagation into it, interpolation, visibility, incoming, culling, passes. [Mn] = landing milestone; untagged names land in M3.
import type { OMMJsonObject, SatRec } from "satellite.js";
import type { CameraModel } from "../camera";
import type { Mat3, ObserverSite } from "../geo";
import type { ClockRate } from "../time";

export type GpGroup = "stations" | "visual" | "starlink"; // [M0]
/** Index i of this array is bit i of a GroupMask. */
export const GP_GROUPS: readonly ["stations", "visual", "starlink"];
export type GroupMask = number;
export const ISS_NORAD_ID: 25544; // [M3]
export const STALE_ELEMENTS_DAYS: 7;
/** Sun geometric altitude cutoff for "visible": −6° stations/visual, −12° starlink. */
export const SUN_CUTOFF_DEG: Readonly<Record<GpGroup, number>>;

/** Packed per-object sample: Float32Array(count × SAMPLE_STRIDE), satrec-index order. */
export const SAMPLE_STRIDE: 8;
export const SampleField: {
  readonly eKm: 0; // topocentric ENU position from the observer
  readonly nKm: 1;
  readonly uKm: 2;
  readonly veKmS: 3; // Earth-fixed velocity in ENU: Mᵀ(eciToEcf(v) − ω × r_ecf)
  readonly vnKmS: 4;
  readonly vuKmS: 5;
  readonly sunlit: 6; // 1 if shadowFraction < 0.5, else 0 (step value, never interpolated)
  readonly valid: 7; // 1 if propagate succeeded and the object is active, else 0
};

/** public/data/gp/meta.json, written by scripts/fetch-gp.ts. count = records in the file, before dedupe and docking. */
export type GpMeta = Record<GpGroup, { fetchedAtMs: number; count: number; sha256: string }>;

export interface CatalogEntry {
  readonly noradId: number; // up to 6 digits; never assume 5
  readonly name: string;
  readonly group: GpGroup;
  readonly epochMs: number;
  /**
   * NORAD id of the host (lowest id of the cluster) when this object is docked: near-identical elements and
   * within 1 km at the later epoch and 45 min later (M3 step 3). Docked objects are not drawn.
   */
  readonly dockedWith: number | null;
  readonly omm: OMMJsonObject;
}

/** Throws on a non-array or on records that are not usable OMM (M3 step 3). [] is valid. */
export function parseGpFile(json: unknown): OMMJsonObject[];
/** Appends one group: drops NORAD ids already in seenNoradIds, marks docked objects. Mutates seenNoradIds. */
export function appendGroup(
  seenNoradIds: Set<number>,
  group: GpGroup,
  omms: readonly OMMJsonObject[],
): CatalogEntry[];
export function elementAgeDays(epochMs: number, timeMs: number): number;

/** Per-tick constants shared by every object (built once per sample request). */
export interface PropagationContext {
  readonly timeMs: number;
  readonly date: Date;
  readonly gmstRad: number;
  readonly sunEciAu: { readonly x: number; readonly y: number; readonly z: number };
  readonly observerEcefKm: Float64Array; // WGS-84, from geodeticToEcf
  readonly enuToEcef: Mat3;
  /** Sun geometric altitude at the observer (no refraction), from sunPos → eciToEcf → look angles. */
  readonly sunAltDeg: number;
}
export function createPropagationContext(timeMs: number, site: ObserverSite): PropagationContext;
/** propagate + ENU + Earth-fixed velocity + shadow, written at out[index × SAMPLE_STRIDE]. Returns false (valid = 0) on null. */
export function writeSample(satrec: SatRec, ctx: PropagationContext, out: Float32Array, index: number): boolean;

export type InterpMode = "linear" | "hermite";
/** "linear" up to 60×, "hermite" at 600×. */
export function interpModeForRate(rate: ClockRate): InterpMode;
/**
 * ENU position of object `index` at timeMs between samples a (tAMs) and b (tBMs), s clamped to [0, 1].
 * Writes [eKm, nKm, uKm] to out; returns false if either sample is invalid.
 */
export function interpolateEnuKm(
  a: Float32Array, tAMs: number,
  b: Float32Array, tBMs: number,
  index: number, timeMs: number, mode: InterpMode,
  out: Float64Array, offset: number,
): boolean;
/** Sunlit flag from the sample nearer in time. */
export function sunlitAt(a: Float32Array, tAMs: number, b: Float32Array, tBMs: number, index: number, timeMs: number): boolean;
/** sunlit AND sunAltDeg ≤ SUN_CUTOFF_DEG[group] AND apparentAltDeg > horizonDeg. */
export function isVisible(sunlit: boolean, sunAltDeg: number, group: GpGroup, apparentAltDeg: number, horizonDeg: number): boolean;
/**
 * Ground-track points on the absolute 20 s grid (multiples of TRACK_STEP_MS) covering
 * [centerMs − halfSpanMs, centerMs + halfSpanMs]. Writes unwrapped [lonDeg, latDeg] pairs; returns the pair count.
 */
export function trackLonLatDeg(satrec: SatRec, centerMs: number, halfSpanMs: number, out: Float64Array): number;

// ---- [M8] incoming check (incoming.ts)
export const INCOMING_STEP_MS: 5_000;
export const INCOMING_STEPS: 12;
export const INCOMING_MIN_ALT_DEG: -5;
/**
 * First t + 5k s (k = 1…12) at which the satellite projects inside [0, W] × [0, H], is sunlit, and its apparent
 * altitude is above horizonAltAtAzDeg(horizonProfileDeg, az). null if none, or if propagation fails.
 */
export function incomingEtaSec(
  satrec: SatRec,
  site: ObserverSite,
  camera: CameraModel,
  timeMs: number,
  horizonProfileDeg: Float32Array | null,
): number | null;
export interface IncomingHit {
  readonly index: number;
  readonly etaSec: number;
}
/**
 * The worker's incoming pass (M8 step 4): per-request Sun gate on SUN_CUTOFF_DEG, skips docked objects, groups
 * outside `groups`, objects at or below INCOMING_MIN_ALT_DEG and objects already in the frame; no "sunlit now"
 * filter. Sorted by etaSec, then index.
 */
export function collectIncoming(
  satrecs: readonly SatRec[],
  groupIndex: Uint8Array,
  skip: Uint8Array,
  groups: GroupMask,
  site: ObserverSite,
  camera: CameraModel,
  timeMs: number,
  horizonProfileDeg: Float32Array | null,
): IncomingHit[];

// ---- [M9] Starlink culling (cull.ts) and the main-thread sky cut-off (visibility.ts)
export const CULL_SLICES: 10;
export const CULL_RANGE_KM: 4150;
export const CULL_SPEED_KM_S: 8;
/** CULL_RANGE_KM + CULL_SPEED_KM_S × (CULL_SLICES + 2) × stepMs / 1000. */
export function cullLimitKm(stepMs: number): number;
export interface CullState {
  readonly held: Float32Array;
  readonly heldTimeMs: Float64Array;
  readonly candidate: Uint8Array;
  lastGeneration: number;
  lastK: number;
}
export function createCullState(count: number): CullState;
/** Sample k with culled rows (cull[i] = 1) propagated only on their slice or as candidates; returns the propagated count. */
export function writeCulledSample(
  state: CullState,
  satrecs: readonly SatRec[],
  skip: Uint8Array,
  cull: Uint8Array,
  ctx: PropagationContext,
  out: Float32Array,
  k: number,
  stepMs: number,
  generation: number,
): number;
export const SKY_CUTOFF_GEOMETRIC_DEG: -3;
/** u < 0 && u² > sin²(3°)·(e² + n² + u²): below −3° geometric, no trigonometry. */
export function belowSkyCutoff(eKm: number, nKm: number, uKm: number): boolean;

// ---- [M5] passes (passes.ts): scripts/find-passes.ts (M5) and the tour (M9)
export interface Pass {
  readonly riseMs: number; // geometric altitude crosses minAltDeg upward, ±1 s
  readonly culminationMs: number; // ±1 s
  readonly setMs: number;
  readonly maxAltDeg: number; // geometric
  readonly sunlitAtCulmination: boolean;
  readonly sunAltDegAtCulmination: number; // geometric
}
/** Scans [fromMs, toMs] every stepMs with writeSample, then bisects rise and set and finds the culmination on a 1 s grid. */
export function findPasses(
  satrec: SatRec,
  site: ObserverSite,
  fromMs: number,
  toMs: number,
  stepMs: number,
  minAltDeg: number,
): Pass[];
/** A stretch of time during which an object is visible inside a camera's frame. */
export interface FrameSpan {
  readonly enterMs: number; // first sample inside the frame and visible
  readonly exitMs: number; // last such sample
  readonly enterAzAltDeg: readonly [azDeg: number, altDeg: number]; // apparent
  readonly exitAzAltDeg: readonly [azDeg: number, altDeg: number];
  readonly maxAltDeg: number; // apparent, over the span's samples
}
/**
 * [M5] Spans in [fromMs, toMs], sampled every stepMs (1,000 in find-passes), where the object is visible
 * (isVisible with SUN_CUTOFF_DEG[group] and the geometric horizon, 0°) and projectAzAltDeg puts it inside
 * [0, W] × [0, H]. Ascending; a span still open at toMs ends there. Terrain can end a real span earlier.
 */
export function frameSpans(
  satrec: SatRec,
  group: GpGroup,
  site: ObserverSite,
  camera: CameraModel,
  fromMs: number,
  toMs: number,
  stepMs: number,
): FrameSpan[];
```

```ts
// src/domain/astro/index.ts — public API (declaration form): Sun, Moon, planets, stars, twilight. Every astronomy-engine call gets a Date or an AstroTime. PlanetName lands in M0, everything else in M2.
import type { AstroTime, Observer } from "astronomy-engine";
import type { ObserverSite } from "../geo";

export type PlanetName = "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn" | "Uranus";
/** Fixed body order for every body array: sun, moon, then planets. */
export const BODY_IDS: readonly ["sun", "moon", "planet:Mercury", "planet:Venus", "planet:Mars", "planet:Jupiter", "planet:Saturn", "planet:Uranus"];
/** Fields per body in a body array. */
export const BODY_STRIDE: 4; // [azDeg, altDeg (apparent, 'normal'), mag, phaseFraction]
/**
 * stars.json row. Rows are sorted by vmag, then HR, so a magnitude limit is a prefix. name: the IAU-CSN proper
 * name, else the Bayer designation ("ι Tel", "ψ6 Aur"), else the Flamsteed one ("61 Cyg"), else "" (shown as "HR n").
 */
export type StarRow = readonly [raDegJ2000: number, decDegJ2000: number, vmag: number, hr: number, name: string];

export function makeObserver(site: ObserverSite): Observer;
/** MakeTime(new Date(timeMs)). Build one per pass and reuse it. */
export function astroTimeAt(timeMs: number): AstroTime;
/** Equator(body, t, obs, true, true) then Horizon(..., 'normal') for all BODY_IDS, written into out (length 8 × BODY_STRIDE). */
export function computeBodies(time: AstroTime, observer: Observer, out: Float64Array): void;
/** Same pipeline with Horizon(..., undefined): airless, for the Horizons AIRLESS fixture. */
export function bodyAirlessAzAltDeg(bodyIndex: number, time: AstroTime, observer: Observer, out: Float64Array, offset: number): void;
/** J2000 unit vectors (cos δ cos α, cos δ sin α, sin δ), Float64Array(3 × rows.length). */
export function starUnitVectors(rows: readonly StarRow[]): Float64Array;
/**
 * One Rotation_EQJ_HOR per call, inlined over all stars; az = (360 − atan2(w, n)) mod 360,
 * alt = atan2(u, hypot(n, w)) + Refraction('normal', alt). Writes [azDeg, altDeg] pairs. Allocates nothing per star.
 */
export function rotateStarsAzAltDeg(time: AstroTime, observer: Observer, unitJ2000: Float64Array, count: number, outAzAltDeg: Float32Array): void;
/** geometricAltDeg + Refraction('normal', geometricAltDeg). Used for satellites at every altitude. */
export function apparentAltDeg(geometricAltDeg: number): number;
/** apparentAltDeg + InverseRefraction('normal', apparentAltDeg). Footprint rays use geometric altitude. */
export function geometricAltDeg(apparentAltDeg: number): number;
/** Horizon(t, obs, ra, dec) with no refraction (the SearchAltitude convention). */
export function sunGeometricAltDeg(time: AstroTime, observer: Observer): number;
/** SearchAltitude(Body.Sun, obs, direction, start, limitDays, −6)?.date: −1 = civil dusk, +1 = civil dawn. */
export function civilTwilightMs(observer: Observer, startMs: number, direction: -1 | 1, limitDays: number): number | null;
/** Every civil dusk and dawn inside [centerMs − halfRangeMs, centerMs + halfRangeMs], ascending. Searches forward only (M2 step 5). */
export function twilightMarkersMs(observer: Observer, centerMs: number, halfRangeMs: number): { duskMs: number[]; dawnMs: number[] };
/** true when lastSkyMs is null or |simTimeMs − lastSkyMs| ≥ SKY_RECOMPUTE_MS. */
export function needsSkyRecompute(simTimeMs: number, lastSkyMs: number | null): boolean;
```

```ts
// src/domain/camera/index.ts — public API (declaration form): lens models, sky ↔ pixel, calibration fit, footprint, GeoPose. [Mn] = landing milestone; LensModel and Calibration land in M0, other untagged names in M2.
// Pixels: u right, v down, continuous, image corners at (0, 0) and (W, H), so the centre is W/2 (not (W − 1)/2).
// Unit-focal coordinates: x right, y up, before × focalPx.
import type { ObserverSite } from "../geo";

export type LensModel =
  | "rectilinear"
  | "fisheye-equidistant"
  | "fisheye-equisolid"
  | "fisheye-stereographic"
  | "fisheye-orthographic";

export interface Calibration {
  azDeg: number; // optical axis azimuth; 0 on a zenith-locked fisheye (normalizeCalibration folds it into roll)
  altDeg: number; // optical axis altitude; 90 on a zenith fisheye
  rollDeg: number; // ρ in x' = x cos ρ − y sin ρ
  focalPx: number; // UI shows HFOV derived from it
  cxPx: number; // principal point
  cyPx: number;
  k1: number; // radial distortion, all lens models: s = 1 + k1 r² + k2 r⁴, r in unit-focal coordinates
  k2: number; // constrained: 1 + 3 k1 r² + 5 k2 r⁴ ≥ MIN_DISTORTION_SLOPE for r ≤ rMaxUnit (see CameraModel)
  flipX: boolean; // mirrored all-sky images
  streamDelayMs: number; // the only copy; read via selectStreamDelayMs
  rmsDeg: number | null; // quality of the last fit
  updatedAtMs: number;
}

export interface CameraModelInput {
  readonly lens: LensModel;
  readonly calibration: Calibration;
  readonly widthPx: number;
  readonly heightPx: number;
}
/** Precomputed trig and limits. Rebuild on every calibration change (cheap); never per frame. */
export interface CameraModel extends CameraModelInput {
  readonly zenithLocked: boolean; // fisheye with altDeg = 90
  readonly thetaMaxRad: number; // cull angle from the optical axis: π/2 for fisheyes (a zenith fisheye culls alt < 0)
  readonly rMaxUnit: number; // undistorted corner radius in unit-focal coordinates, capped at the fisheye horizon radius
}
/** [M2] M2 supports only the zenith equidistant fisheye and throws for anything else; M4 adds every lens and tilt. */
export function createCameraModel(input: CameraModelInput): CameraModel;

/** [M2] r/f at the horizon for a zenith fisheye: π/2, √2, 2, 1; Infinity for rectilinear. */
export function horizonRadiusUnit(lens: LensModel): number;
/** [M4] HFOV = 2·θ(W/(2f)) with θ = atan r | r | 2 asin(r/2) | 2 atan(r/2) | asin r (k1 = k2 = 0, cx = W/2). */
export function hfovDeg(lens: LensModel, widthPx: number, focalPx: number): number;
/** [M4] (W/2)/ρ(HFOV/2): the inverse of hfovDeg. */
export function focalPxForHfov(lens: LensModel, widthPx: number, hfovDeg: number): number;
/** [M2] M2 synthetic sky: W = H = sizePx, altDeg 90, rollDeg 180, focalPx = (sizePx/2)/(π/2), k1 = k2 = 0. */
export function syntheticFisheyeCalibration(sizePx: number): Calibration;
/** [M4] Smallest g′ that distortionValid accepts: at 0.05 the inverse Newton converges in ≤ 8 iterations for every lens. */
export const MIN_DISTORTION_SLOPE: 0.05;
/** [M4] true when g′(r) = 1 + 3k1r² + 5k2r⁴ ≥ MIN_DISTORTION_SLOPE for all r in [0, rMaxUnit]; false for non-finite input. */
export function distortionValid(k1: number, k2: number, rMaxUnit: number): boolean;
/**
 * [M4] Runs on every calibration write: clamps altDeg to [−90, 90]; a fisheye at altDeg 90 gets
 * rollDeg = wrap180(rollDeg − azDeg) and azDeg = 0; otherwise azDeg = wrap360(azDeg), rollDeg = wrap180(rollDeg).
 */
export function normalizeCalibration(lens: LensModel, c: Calibration): Calibration;

/**
 * [M2] Sky → pixel, closed form, no allocation. Writes [uPx, vPx] (v down) and returns true;
 * returns false when culled: non-finite input, cos c ≤ 0 (rectilinear), θ > thetaMaxRad, or r_u > 1.05·rMaxUnit.
 */
export function projectAzAltDeg(model: CameraModel, azDeg: number, altDeg: number, out: Float64Array, offset: number): boolean;
/**
 * [M2] Batch form for stars and satellites. azAltDeg holds [az, alt] pairs; writes [u, v] pairs to outUvPx and
 * 1/0 to outVisible; returns the number projected. Arrays are allocated once by the caller and reused.
 */
export function projectBatch(
  model: CameraModel,
  azAltDeg: Float32Array | Float64Array,
  count: number,
  outUvPx: Float32Array | Float64Array,
  outVisible: Uint8Array,
): number;
/** [M2] OpenLayers pixel-projection coordinate of a pixel: [uPx, heightPx − vPx]. */
export function toSkyMapCoord(model: CameraModel, uPx: number, vPx: number, out: Float64Array | number[], offset: number): void;
/**
 * [M4] Pixel → sky. Undoes flip, principal point, focal length, Newton-undistorts (≤ 10 iterations, step < 1e-9),
 * un-rolls, then inverts the lens. Writes [azDeg in [0, 360), altDeg]. Returns false when there is no
 * preimage, Newton fails (g′ ≤ 0 or residual ≥ 1e-6 px) or the pixel is outside a fisheye's horizon circle.
 * rd = 0 returns the optical axis (A0, h0) without calling any library.
 */
export function unprojectPixel(model: CameraModel, uPx: number, vPx: number, out: Float64Array, offset: number): boolean;
/** [M4] Newton solve of r(1 + k1 r² + k2 r⁴) = rd from r = rd; null on failure. */
export function undistortRadius(rd: number, k1: number, k2: number): number | null;

/** [M4] Azimuth range the frame covers, from the inverse-projected boundary; "full" when the zenith is in frame. */
export type AzimuthCoverage = { readonly kind: "full" } | { readonly kind: "range"; readonly fromAzDeg: number; readonly toAzDeg: number };
export function frameAzimuthCoverage(model: CameraModel, samplesPerEdge: number): AzimuthCoverage; // [M4]

// ---- [M8] footprint (footprint.ts)
export const FOOTPRINT_SAMPLES_PER_EDGE: 16;
export const FOOTPRINT_PRESETS_KM: readonly [420, 480];
export const FOOTPRINT_FALLBACK_HEIGHT_KM: 420;
export const FOOTPRINT_CLIP_EPS_DEG: 1e-6;
/** Most pairs footprintLonLatDeg can write: 8 × samplesPerEdge. */
export function footprintMaxPairs(samplesPerEdge: number): number;
/**
 * Orbit-height footprint on a sphere R = 6371.0088 km, O = (R + h)·û. Walks 4·samplesPerEdge boundary samples
 * (fisheye samples moved onto the horizon circle), clips in geometric altitude to
 * max(dip, geometricAltDeg(profile)) + FOOTPRINT_CLIP_EPS_DEG by bisecting each crossing and replacing every
 * below-clip run with clip-curve points (M8 step 3), drops any ray that hits the Earth first (a safety net),
 * and writes [lonDeg, latDeg] pairs into out (≥ footprintMaxPairs(samplesPerEdge) pairs), unwrapped starting
 * nearest site.lonDeg. Returns the pair count: 0 when the frame shows no sky, the ring would enclose a pole, or
 * heightKm ≤ the site height.
 */
export function footprintLonLatDeg(
  model: CameraModel,
  site: ObserverSite,
  heightKm: number,
  samplesPerEdge: number,
  horizonProfileDeg: Float32Array | null,
  out: Float64Array,
): number;

// ---- [M4] calibration fit and acceptance (fit.ts)
export interface FitPair {
  readonly uPx: number;
  readonly vPx: number;
  readonly azDeg: number; // apparent ('normal' refraction), the same values the overlay draws
  readonly altDeg: number;
}
export interface FitOptions {
  readonly fitK1: boolean;
  readonly fitTilt: boolean; // frees a zenith-locked fisheye's axis; a tilted start always fits the full rotation
  readonly maxIterations: number; // Levenberg–Marquardt
  readonly rejectSigma: number; // 3: drop the worst pair beyond 3σ of the others and refit
}
export interface FitResult {
  readonly calibration: Calibration; // start values with fitted fields replaced, normalized
  readonly residualPx: Float64Array; // per pair, same order as the input
  readonly residualDeg: Float64Array;
  readonly rejected: Uint8Array; // 1 = dropped by the 3σ rule
  readonly rmsPx: number;
  readonly rmsDeg: number;
  readonly iterations: number;
}
/**
 * Fits the rotation, f, cx, cy (+ k1) on pixel residuals; a zenith-locked start fits roll only unless fitTilt.
 * Keeps distortionValid true at every accepted step. Returns null with fewer than 4 usable pairs or no convergence.
 */
export function fitCalibration(
  lens: LensModel,
  widthPx: number,
  heightPx: number,
  start: Calibration,
  pairs: readonly FitPair[],
  options: FitOptions,
): FitResult | null;
export interface AcceptancePair {
  readonly kind: "star" | "planet";
  readonly named: boolean; // non-empty stars.json name
  readonly altDeg: number;
  readonly role: "fit" | "holdout";
  readonly rejected: boolean;
  readonly residualDeg: number;
}
export interface AcceptanceReport {
  readonly namedFitStars: number;
  readonly rmsDeg: number;
  readonly maxFitDeg: number;
  readonly holdoutStars: number;
  readonly holdoutPlanets: number;
  readonly maxHoldoutDeg: number | null;
  readonly pass: boolean;
}
/**
 * Pass: ≥ 10 named, non-rejected fit stars at alt ≥ minAltDeg (20 fisheye, 10 rectilinear); RMS ≤ 0.25° and each
 * ≤ 0.5° over the non-rejected fit pairs; ≥ 3 holdout stars and ≥ 1 holdout planet at alt ≥ minAltDeg, each ≤ 0.5°.
 */
export function calibrationAcceptance(lens: LensModel, pairs: readonly AcceptancePair[]): AcceptanceReport;
/** [M5] One click on a satellite during the M5 acceptance check. */
export interface SatelliteCheckSample {
  readonly timeMs: number;
  readonly residualDeg: number;
}
export interface SatelliteCheckSummary {
  readonly count: number;
  readonly firstMs: number | null;
  readonly lastMs: number | null;
  readonly maxGapMs: number | null;
  readonly maxDeg: number | null;
  readonly medianDeg: number | null;
  readonly pass: boolean;
}
/**
 * [M5] pass: ≥ 10 samples, every residual finite and ≤ limitDeg, and no uncovered gap > 2,500 ms. A gap's uncovered
 * part is the time between consecutive samples minus its overlap with hiddenMs (stretches where the object is known
 * to be hidden, e.g. behind a dome; disjoint). maxGapMs is the largest uncovered gap. hiddenMs defaults to [].
 */
export function satelliteCheckSummary(
  samples: readonly SatelliteCheckSample[],
  limitDeg: number,
  hiddenMs?: readonly (readonly [fromMs: number, toMs: number])[],
): SatelliteCheckSummary;

// ---- [M4] GeoPose (geopose.ts)
/** OGC GeoPose 1.0 Basic-YPR (21-056r11), keys from the vendored schema. */
export interface GeoPoseBasicYpr {
  position: { lat: number; lon: number; h: number }; // h: metres above the WGS-84 ellipsoid
  angles: { yaw: number; pitch: number; roll: number }; // degrees
}
/** yaw = wrap180(90 − azDeg), pitch = −altDeg, roll = wrap180(rollDeg); zenith fisheye → (90, −90, roll). */
export function toGeoPose(latDeg: number, lonDeg: number, ellipsoidHeightM: number, calibration: Calibration, zenithLocked: boolean): GeoPoseBasicYpr;
/** Inverse of toGeoPose, from the rotation matrix. At pitch ≈ −90: azDeg = 0, rollDeg = wrap180(roll + yaw − 90). */
export function fromGeoPose(pose: GeoPoseBasicYpr): { azDeg: number; altDeg: number; rollDeg: number };
/** R = Rz(yaw)·Ry(pitch)·Rx(roll) from ENU (row-major). Round-trip tests compare these matrices. */
export function geoPoseRotation(yawDeg: number, pitchDeg: number, rollDeg: number, out?: Float64Array): Float64Array;
/** ajv (vendored schema, compiled on first call) plus lat ∈ [−90, 90], lon ∈ [−180, 180]. */
export function validateGeoPose(value: unknown): { ok: true; pose: GeoPoseBasicYpr } | { ok: false; errors: string[] };
```

Two library details for this module, both checked with tsc 7.0.2 (`moduleResolution: "bundler"`) and run with tsx:

1. `geopose.ts` uses the named import `import { Ajv } from "ajv"` (the default import fails under `nodenext`) and loads the vendored schema with an import attribute, `with { type: "json" }`. No `resolveJsonModule` setting is needed under `bundler`. The official schema has no ranges and allows extra properties, so `validateGeoPose` also checks `Number.isFinite`, lat and lon itself.
2. In proj4 cross-check tests, call `forward<[number, number]>(...)` and `inverse<[number, number]>(...)` on the converter; without the type argument the result is `number[]`, so each element is `number | undefined` under `noUncheckedIndexedAccess`. Every `gnom` and `laea` definition needs both `+x_0=0` and `+y_0=0`. The inverse returns azimuth in (−180°, 180°]: normalise with `((lon % 360) + 360) % 360`.

```ts
// src/domain/terrain/index.ts — public API (declaration form): Terrarium decode, tile plan, horizon march, hillshade constants. Lands in M6.
export const TERRARIUM_URL: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRARIUM_MAX_ZOOM: 15;
export const TILE_SIZE_PX: 256;
export const REFRACTION_KAPPA: 0.13;
export const EARTH_RADIUS_M: 6_371_000;
export type TileZoom = 8 | 9 | 10 | 12 | 14;
export interface TileKey {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** R × 256 + G + B / 256 − 32768 (channels 0–255). (128, 0, 0) → 0 m. */
export function decodeTerrariumM(r: number, g: number, b: number): number;
/** RGBA bytes of one 256×256 tile → Float32Array(65536) of metres, row-major from the north-west corner. */
export function decodeTerrariumTile(rgba: Uint8ClampedArray, out: Float32Array): void;
/** α = atan((zM − z0M − dM²(1 − κ)/(2R)) / dM) in degrees. No clamping here. */
export function apparentElevationDeg(zM: number, z0M: number, dM: number): number;
/** z14 < 1.5 km, z12 < 8 km, z10 < 30 km, z9 < 60 km, z8 beyond; each boundary belongs to the coarser zoom. */
export function zoomForDistanceM(dM: number): TileZoom;
/** max(100 km, 1.05·sqrt(2R·max(z0M, 0)/(1 − κ))). */
export function marchLimitM(z0M: number): number;
/** Numeric Map key (z·2^15 + x)·2^15 + y: no string per sample. */
export function tileId(z: number, x: number, y: number): number;
/** Web-Mercator global pixel at zoom z: X = (lon + 180)/360·256·2^z − 0.5, Y = (1 − asinh(tan φ)/π)/2·256·2^z − 0.5. */
export function lonLatToWorldPx(lonDeg: number, latDeg: number, z: number, out: Float64Array, offset: number): void;
/** Bilinear elevation in metres at a point; NaN when a needed tile is missing. dM is the ground distance from the site. */
export type ElevationSampler = (latDeg: number, lonDeg: number, dM: number, zoom: TileZoom) => number;
/** Bilinear sampler over decoded tiles keyed by tileId; x wraps at the antimeridian, y clamps at the poles. */
export function createTileSampler(tiles: ReadonlyMap<number, Float32Array>): ElevationSampler;
/** The one march: d = 20 m, then d += max(10 m, 0.01·d) while d ≤ limitM, spherical destination points. */
export function marchRay(
  latDeg: number,
  lonDeg: number,
  azDeg: number,
  limitM: number,
  visit: (latDeg: number, lonDeg: number, dM: number, zoom: TileZoom) => void,
): void;
/** Every tile the march touches (four bilinear texels per sample, zoomForDistanceM) plus the site's z14 tiles. azimuthsDeg defaults to 0…359. */
export function tilesForSite(latDeg: number, lonDeg: number, limitM: number, azimuthsDeg?: readonly number[]): TileKey[];
/**
 * For az = 0..359: marchRay, z = max(z, 0) (Terrarium oceans are seabed), keep the largest apparentElevationDeg.
 * NaN samples are skipped; a ray with no valid sample gives NaN. Writes 360 values in degrees.
 */
export function horizonProfileDeg(
  sample: ElevationSampler,
  latDeg: number,
  lonDeg: number,
  z0M: number,
  limitM: number,
  out: Float32Array,
): void;
/** Linear interpolation between the two neighbouring whole degrees (359 wraps to 0); 0 (geometric horizon) when profileDeg is null. */
export function horizonAltAtAzDeg(profileDeg: Float32Array | null, azDeg: number): number;
/** Ground size of one texel at tile zoom z: 40075016.686/(256·2^z)·cos(lat). The hillshade divides central differences by 2 × this. */
export function texelGroundM(tileZ: number, latDeg: number): number;
```

### State, app and map modules

The modules outside `src/domain` that more than one milestone uses. Every block here and in this section type-checks with tsc 7.0.2 against the section 4 and 5 types (strict, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`).

```ts
// State modules — public API (declaration form). [Mn] = landing milestone.

// ---- src/state/actions.ts [M0]
import type { StoreApi } from "zustand/vanilla";
import type { Actions, AppState } from "./types";
/** All 45 actions from M0. One whose milestone has not landed throws Error("actions.<name> lands in M<n>"). */
export function createActions(set: StoreApi<AppState>["setState"], get: StoreApi<AppState>["getState"]): Actions;

// ---- src/state/clockLoop.ts [M0]
import type { AppStore } from "./store";
export type FrameUpdater = (simTimeMs: number) => void;
/** requestAnimationFrame in the app; a manual fake in unit tests. */
export interface FrameScheduler {
  request(callback: (wallMs: number) => void): number;
  cancel(handle: number): void;
}
/** [M0] Starts the one loop (throws if one is running). Returns an idempotent stop(). */
export function startClockLoop(store: AppStore, scheduler?: FrameScheduler): () => void;
/** [M0] Runs fn every frame after the tick, in registration order. A throwing fn is removed and logged once. */
export function registerFrameUpdater(fn: FrameUpdater): () => void;
/** [M3] Frames since start, incremented at the start of each frame callback. */
export function frameCount(): number;
/** [M5] The YouTube player's clock, registered by mountYoutubePlayer. */
export interface YoutubeMediaClock {
  readonly kind: "youtube";
  /** player.getCurrentTime() when it is a finite number, else null. */
  mediaSec(): number | null;
  /** Taken at the first PLAYING with a finite getCurrentTime() > 0 after a video id loads; null before. */
  anchor(): { readonly wallMs: number; readonly mediaSec: number } | null;
  /** mediaReferenceTimeMs(player): undocumented, null when absent. */
  mediaReferenceTimeMs(): number | null;
}
/** [M5] A local clip's clock, registered by bindBackground. */
export interface LocalMediaClock {
  readonly kind: "local-video";
  readonly startUtcMs: number;
  /** rVFC metadata.mediaTime of the frame on screen while playing; video.currentTime when paused or seeking. */
  mediaSec(): number;
  /** Sets video.currentTime clamped to [0, duration]. */
  seekToSec(mediaSec: number): void;
}
export type MediaClock = YoutubeMediaClock | LocalMediaClock; // [M5]
/** [M5] One media clock at a time; null unregisters. Resets the loop's "user moved time" memory. */
export function setMediaClock(clock: MediaClock | null): void;
export function getMediaClock(): MediaClock | null; // [M5]

// ---- src/state/skyCache.ts [M2]
import type { Observer } from "astronomy-engine";
import type { StarRow } from "../domain/astro";
import type { ObserverSite } from "../domain/geo";
import type { AppStore } from "./store";
export interface SkyCache {
  rows: readonly StarRow[]; // stars.json, brightest first
  unitJ2000: Float64Array; // 3 × rows.length
  starCount: number; // prefix with vmag ≤ the current limit
  starAzAltDeg: Float32Array; // 2 × rows.length, apparent
  readonly bodies: Float64Array; // BODY_IDS.length × BODY_STRIDE; NaN until the first pass
  lastSkyMs: number | null;
  site: ObserverSite | null;
  observer: Observer | null;
}
export function createSkyCache(): SkyCache;
export const skyCache: SkyCache;
export function starCountForLimit(rows: readonly StarRow[], vmag: number): number;
export function setStars(cache: SkyCache, rows: readonly StarRow[], vmagLimit: number): void;
/** true if starCount changed (then lastSkyMs is cleared). */
export function setStarLimit(cache: SkyCache, vmagLimit: number): boolean;
export function invalidateSky(cache: SkyCache): void;
/** true if it recomputed: a new site object, or needsSkyRecompute. */
export function updateSky(cache: SkyCache, simTimeMs: number, site: ObserverSite): boolean;
export function loadStars(store: AppStore): Promise<void>;

// ---- src/state/objectId.ts [M3]
import type { ObjectId } from "./types";
/** sat:<1–9 digits, no leading 0>, planet:<PlanetName> (exact case), star:<1–9110>, moon, sun; else null. */
export function parseObjectId(raw: string): ObjectId | null;
export function noradIdOf(id: ObjectId | null): number | null;

// ---- src/state/sampleClient.ts [M3]
import type { GroupMask } from "../domain/orbits";
import type { PropagationIn, PropagationOut } from "../workers/protocol";
export const POOL_SIZE: 3;
export interface HeldSample {
  k: number;
  timeMs: number;
  data: Float32Array<ArrayBuffer>;
  sunAltDeg: number;
}
/** b === a while the next sample is late (hold, never extrapolate). */
export interface SamplePair {
  a: HeldSample;
  b: HeldSample;
}
/** Section 5 sample lifecycle without a Worker, so Node tests can drive it. */
export class SampleClient {
  generation: number;
  constructor(post: (msg: Extract<PropagationIn, { type: "sample" }>, transfer: Transferable[]) => void);
  resize(totalCount: number): void;
  flush(): void;
  onSample(reply: Extract<PropagationOut, { type: "sample" }>): void;
  /** Flushes when stepMs or groups change, or the render time leaves [t_first, t_first + 2D]. */
  frame(renderMs: number, stepMs: number, groups: GroupMask): SamplePair | null;
}

// ---- src/state/ephemeris.ts [M3]
import type { PropagationOut, SkyPathOut, TrackOut } from "../workers/protocol";
import type { AppStore } from "./store";
import type { ObjectId } from "./types";
export interface SatCatalog {
  count: number;
  noradIds: Int32Array;
  names: string[];
  groupIndex: Uint8Array;
  epochMs: Float64Array;
  dockedWith: Int32Array;
  indexByNorad: Map<number, number>;
}
export interface SatFrame {
  timeMs: number;
  ready: boolean;
  sunAltDeg: number;
  enuKm: Float64Array;
  azAltDeg: Float64Array; // altitude apparent
  rangeKm: Float64Array;
  lonLatDeg: Float64Array;
  mercator: number[]; // EPSG:3857 [x, y] per index
  flags: Uint8Array; // bit 0 valid, 1 sunlit, 2 above horizon, 3 visible
}
export interface Ephemeris {
  catalog: SatCatalog;
  frame: SatFrame;
  tracks: Map<number, TrackOut>;
  skyPaths: Map<number, SkyPathOut>;
  pathsVersion: number;
  /** [M8] The latest accepted incoming reply, or null. */
  incoming: Extract<PropagationOut, { type: "incoming" }> | null;
}
export const ephemeris: Ephemeris;
export function startEphemeris(store: AppStore): () => void;
/** Computes once per frameCount(); registered at boot and called first by every satellite layer updater. */
export function updateEphemerisFrame(simTimeMs: number): SatFrame;
export function requestTracks(timeMs: number, selectedIndex: number | null, otherIndices: Int32Array): void;
export function requestSkyPaths(fromMs: number, toMs: number, indices: Int32Array): void;
/** Docked ids map to their host's index. */
export function indexOfObjectId(id: ObjectId): number | null;
/** [M8] Geodetic height of object `index` in the current frame; null when not ready or not valid. */
export function heightKmOf(index: number): number | null;

// ---- src/state/incomingClient.ts [M8]
import type { GroupMask } from "../domain/orbits";
import type { PropagationIn, PropagationOut } from "../workers/protocol";
type IncomingReply = Extract<PropagationOut, { type: "incoming" }>;
export class IncomingClient {
  constructor(post: (msg: Extract<PropagationIn, { type: "incoming" }>) => void);
  /** Once per frame: at most one request per second of wall time, one in flight, none when inactive or unchanged. */
  frame(wallMs: number, simTimeMs: number, active: boolean, groups: GroupMask): void;
  /** Clears latest, ignores replies to earlier requests, requests on the next frame. */
  flush(): void;
  onReply(reply: IncomingReply): void;
  readonly latest: IncomingReply | null;
}

// ---- src/state/footprintStatus.ts [M8]
/** Written in place by bindFootprint, read by the UI through useTick4Hz. */
export interface FootprintStatus {
  heightKm: number | null; // null while the footprint layer is off
  source: "preset" | "selected" | "fallback";
  pairCount: number; // 0: nothing drawn
}
export const footprintStatus: FootprintStatus;
```

```ts
// App modules — public API (declaration form). [Mn] = landing milestone.

// ---- src/app/cameras.ts [M1]
import type { CameraConfig } from "../state/types";
/** Entries keyed by id in file order. Throws one Error listing every problem (M1 step 5). */
export function parseCameraRegistry(json: unknown): Record<string, CameraConfig>;
/** Ids that reach the store; the milestone that enables an entry adds it (camera registry, section 2). */
export const ENABLED_CAMERA_IDS: readonly string[];
/** The enabled subset, in file order. */
export function enabledCameras(all: Record<string, CameraConfig>): Record<string, CameraConfig>;

// ---- src/app/url.ts [M1]
import type { AppStore } from "../state/store";
import type { AppState, ObjectId } from "../state/types";
export interface UrlState {
  cam: string | null;
  tMs: number | null; // only an ISO 8601 UTC value ending in Z; anything else is null
  sel: ObjectId | null; // [M3]
  demo: boolean; // [M9] true only for ?demo=1
}
export function parseUrlState(search: string): UrlState;
/** "?cam=<id>", plus "&t=<isoUtcSeconds>" in replay, "&sel=<id>" (M3) and "&demo=1" (M9); colons written raw. */
export function writeUrlState(state: AppState): string;
/** Writes once now, then delayMs after the last discrete change (trailing debounce); never per tick. */
export function startUrlSync(store: AppStore, write: (search: string) => void, delayMs?: number): () => void;
/** [M9] Absolute link to this view: always the current t in replay (even while playing), none in live, never demo. */
export function shareUrl(state: AppState, href: string): string;

// ---- src/app/keyboard.ts [M1]
import type { AppStore } from "../state/store";
/** The parts of a KeyboardEvent the handler reads; Node tests pass plain objects. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
}
/** true when handled. Ignores inputs, defaultPrevented events, Alt/Ctrl/Meta chords and Space on a button. */
export function handleKeyDown(store: AppStore, e: KeyLike): boolean;
/** One keydown listener on window; preventDefault() when handled. Returns the remover. */
export function installKeyboard(store: AppStore): () => void;
/** [M9] One row per shortcut, rendered by KeyboardShortcuts.tsx, so the list and the handler cannot drift. */
export interface KeyMapRow {
  readonly keys: string;
  readonly effect: string;
  readonly notes: string;
}
export const KEY_MAP: readonly KeyMapRow[]; // [M9]

// ---- src/app/credits.ts [M1]
import type { Credit, LayersState } from "../state/types";
export const GIBS_CREDIT: Credit; // [M1]
export const OSM_NE_CREDIT: Credit; // [M1] Coastlines and Reference_Labels, ODbL-1.0
export const TRUE_COLOR_INSTRUMENT: "NOAA-20 / VIIRS"; // [M1] changes together with TRUE_COLOR_LAYER
export const BSC5_CREDIT: Credit; // [M2]
export const IAU_WGSN_CREDIT: Credit; // [M2]
export const CELESTRAK_CREDIT: Credit; // [M3]
export const TERRAIN_CREDIT: Credit; // [M6] link to the joerd attribution document
/** [M6] The 11 lines of the joerd "Required attribution" block, verbatim. */
export const TERRAIN_SOURCE_STATEMENTS: readonly string[];
export const GOES_SUBTITLE: "GOES-West/ABI"; // [M7]
/**
 * GIBS_CREDIT when gibsReady and any GIBS layer is on; OSM_NE_CREDIT when gibsReady and coastlines is on; CELESTRAK_CREDIT
 * while satellites or starlink is on, whatever gibsReady is. Keys land with their layers: trueColor and
 * coastlines in M1, satellites and starlink in M3, goesIr in M7. Returns a new array: call it during render.
 */
export function dataCredits(
  layers: Pick<LayersState, "trueColor" | "coastlines" | "goesIr" | "satellites" | "starlink">,
  gibsReady: boolean,
): Credit[];
/** [M2] BSC5_CREDIT and IAU_WGSN_CREDIT while stars are on, else []. */
export function starCredits(starsOn: boolean): Credit[];

// ---- src/app/testHooks.ts [M3]
import type { FootprintStatus } from "../state/footprintStatus";
import type { ObjectId } from "../state/types";
export type ViewId = "sky" | "ground"; // the members of MapId
export interface OverheadTestHooks {
  frame(): number; // frameCount()
  readyFrame(): number | null; // first frame in which the sample client returned a pair
  selectionFrame(): number | null; // frame in which selection.selectedId last changed
  highlight(view: ViewId): { id: ObjectId | null; frame: number | null }; // last drawn, and since when
  clientPoint(view: ViewId, id: ObjectId): { x: number; y: number } | null; // viewport CSS px
  footprint(): FootprintStatus; // [M8]
  incoming(): { timeMs: number; computeMs: number; entries: { noradId: number; etaSec: number }[] } | null; // [M8]
  commits(): number; // [M9] React Profiler commits (development build only)
}
declare global {
  interface Window {
    __overhead?: OverheadTestHooks;
  }
}
/** main.tsx installs the hooks only when navigator.webdriver is true. */
export function installTestHooks(hooks: OverheadTestHooks): void;
/** Called from each selection layer's postrender. */
export function recordHighlight(view: ViewId, id: ObjectId | null): void;

// ---- src/app/clip.ts [M5]
import type { Calibration, CameraConfig, Credit, LocalVideoCamera } from "../state/types";
/** How the sidecar's startUtcMs was measured (section 8, "Recorded clips"). */
export type ClipTimingMethod = "hls-program-date-time" | "burned-in-clock" | "satellite" | "manual";
export interface ClipTiming {
  readonly method: ClipTimingMethod;
  readonly detail: string; // how, for people; further keys (cross-checks) are allowed and ignored
}
/** The pass a clip was cut for, in media seconds: predicted by scripts/find-passes.ts or measured on the video. */
export interface ClipPass {
  readonly noradId: number;
  readonly inFrameFromMediaS: number; // first moment inside the frame and visible
  readonly inFrameToMediaS: number; // last such moment
  readonly visibleMediaS?: readonly (readonly [fromS: number, toS: number])[]; // seen in the video, e.g. between domes
}
/**
 * recordings/<clip>.json, next to its video (O2). Plain JSON; every field without "?" is required, and keys not
 * listed here (provenance) are allowed and ignored. The clip plays as registry camera cameraId: its site, lens and
 * image size, drawn at that camera's W × H.
 */
export interface ClipSidecar {
  readonly cameraId: string; // a youtube or still-image registry camera
  readonly videoFile: string; // file name in the sidecar's folder, no "/": e.g. "subaru-2026-10-11-iss.mp4"
  readonly startUtcMs: number; // UTC epoch ms of media time 0
  readonly startUncertaintyS: number; // ± seconds on startUtcMs, ≥ 0
  readonly timingSource: ClipTiming;
  readonly durationS: number; // > 0 and ≤ 43,200 (the ± 12 h scrubber)
  readonly width: number; // encoded frame width, px
  readonly height: number; // encoded frame height, px; width:height within 0.5 % of the camera's W:H
  readonly fps: number;
  readonly sourceVideoId: string | null; // the YouTube video id it was recorded from; null for other sources
  readonly credit: Credit; // non-empty text; on screen while the clip is active
  readonly calibration?: Calibration; // fitted on this clip, in the camera's W × H pixels; the clip camera starts from it
  readonly pass?: ClipPass;
}
/** Lists every problem. startUtcMs must lie between 2000-01-01 and nowMs + 1 day. */
export function parseClipSidecar(
  json: unknown,
  registry: Readonly<Record<string, CameraConfig>>,
  nowMs: number,
): { ok: true; sidecar: ClipSidecar } | { ok: false; errors: string[] };
/** videoFile resolved against the sidecar's absolute URL. */
export function clipVideoUrl(sidecarAbsUrl: string, sidecar: ClipSidecar): string;
/**
 * The camera a loaded clip runs as: entry's id, name and source.sidecarUrl; site, lens, imageSize and termsNote
 * from registry[sidecar.cameraId]; defaults = sidecar.calibration ?? that camera's defaults, with streamDelayMs 0;
 * the sidecar's credit; source.sourceCameraId, videoUrl and startUtcMs filled in. null when sidecar.cameraId is
 * not in the registry or differs from a non-null entry.source.sourceCameraId.
 */
export function clipCamera(
  entry: LocalVideoCamera,
  sidecar: ClipSidecar,
  videoUrl: string,
  registry: Readonly<Record<string, CameraConfig>>,
): LocalVideoCamera | null;
/** [M9] The clip's own element sets: ".../recordings/<clip>.json" → ".../recordings/<clip>.gp/" (absolute, no query or hash). */
export function clipGpBaseUrl(sidecarAbsUrl: string): string;
```

```ts
// Map modules — public API (declaration form). [Mn] = landing milestone.

// ---- src/map/registry.ts [M1]
import type OlMap from "ol/Map";
export type MapId = "ground" | "sky";
export const registry: Map<MapId, OlMap>;
/**
 * Registers the map and returns its cleanup, the one implementation of the section 4 map lifecycle: run every
 * disposer, dispose every layer, map.dispose(), and delete the entry only if it still points at this map.
 */
export function registerMap(id: MapId, map: OlMap, disposers: ReadonlyArray<() => void>): () => void;
/** Called by the clock loop on frames where the sim time changed. */
export function renderSyncAll(): void;

// ---- src/map/pick.ts [M3]
export const WORLD_WIDTH_M: 40_075_016.685578488;
export const PICK_RADIUS_PX: 6;
/** Nearest index within radius (map units) of (x, y), or −1. Wraps dx by worldWidth only when worldWidth > 0. */
export function pickNearest(
  x: number,
  y: number,
  xy: ArrayLike<number>,
  skip: Uint8Array,
  count: number,
  radius: number,
  worldWidth: number,
): number;

// ---- src/map/classPoints.ts [M3]
import type Feature from "ol/Feature";
import type MultiPoint from "ol/geom/MultiPoint";
import type VectorSource from "ol/source/Vector";
/** Writes count points in place and calls changed(); removes the feature while empty and adds it back after (WebGL). */
export function writeClassPoints(source: VectorSource, feature: Feature<MultiPoint>, flat: number[], count: number): void;

// ---- src/map/sky/createSkyMap.ts [M2]
import type ImageLayer from "ol/layer/Image";
import type VectorLayer from "ol/layer/Vector";
import type OlMap from "ol/Map";
import type { Pixel } from "ol/pixel";
import type Projection from "ol/proj/Projection";
import type ImageSource from "ol/source/Image";
import type VectorSource from "ol/source/Vector";
import type View from "ol/View";
import type { CameraModel } from "../../domain/camera";
import type { SkyCache } from "../../state/skyCache";
import type { AppStore } from "../../state/store";
import type { ObjectId } from "../../state/types";
/** Functions are closures, not methods that use `this`: updateFrame is passed to registerFrameUpdater unbound. */
export interface SkyMapHandle {
  readonly map: OlMap;
  readonly gridLayer: VectorLayer<VectorSource>;
  readonly starsLayer: VectorLayer<VectorSource>;
  readonly bodiesLayer: VectorLayer<VectorSource>;
  setCameraModel(model: CameraModel): void; // called by bindSkyCamera
  updateFrame(simTimeMs: number): void; // registered with registerFrameUpdater
  readonly satellitesLayer: VectorLayer<VectorSource>; // [M3]
  readonly starlinkLayer: VectorLayer<VectorSource>; // [M3]
  readonly trailsLayer: VectorLayer<VectorSource>; // [M3]
  readonly selectionLayer: VectorLayer<VectorSource>; // [M3]
  readonly hoverElement: HTMLElement; // [M3] ol/Overlay element; SkyView portals HoverCard into it
  pick(pixel: Pixel): ObjectId | null; // [M3]
  readonly backgroundLayer: ImageLayer<ImageSource>; // [M4] still image (M4) or video frames (M5)
  setPanZoom(on: boolean): void; // [M4] true for still-image and local-video cameras
  /** [M5] true for youtube cameras: pointer-events none on the target and on the HoverCard overlay's container, map picking off, ol/Overlay hit targets on. */
  setPassThrough(on: boolean): void;
  readonly horizonLayer: VectorLayer<VectorSource>; // [M6]
  setHorizonProfile(profileDeg: Float32Array | null): void; // [M6]
}
export function createSkyMap(target: HTMLElement, store: AppStore, cache: SkyCache): SkyMapHandle;
/** Pixel projection of one camera frame: a pixel (u, v) is the coordinate [u, H − v]. */
export function skyPixelProjection(widthPx: number, heightPx: number): Projection;
/** One view per frame size; maxResolution = max(W, H) so the frame fits any container. */
export function createSkyView(widthPx: number, heightPx: number): View;
/** Fits the current view's whole frame into the map's size. */
export function fitSkyFrame(map: OlMap): void;
/** The map createSkyMap builds: no controls or interactions (M4's setPanZoom adds them), refitted on change:size. */
export function createSkyOlMap(target: HTMLElement, widthPx: number, heightPx: number): OlMap;
```

The pure part of `scripts/record-clip.ts` (section 8, "Recorded clips"), which its unit tests target. It type-checks under `tsconfig.node.json` with `@types/node` 26.6.5:

```ts
// Script modules — public API (declaration form). [M5]

// ---- scripts/record-clip.ts
/** One media segment of a YouTube live HLS playlist (itag 270: 5.0 s each on 2026-10-11). */
export interface HlsSegment {
  readonly sq: number; // media sequence number; equals the /sq/<n>/ in its URL
  readonly programDateTimeMs: number; // the head #EXT-X-PROGRAM-DATE-TIME + the EXTINF durations before it
  readonly durationS: number; // EXTINF
  readonly url: string; // signed and carries the client's IP: never logged or written to disk
}
export interface MediaPlaylist {
  readonly mediaSequence: number; // #EXT-X-MEDIA-SEQUENCE
  readonly segments: readonly HlsSegment[];
}
/** Throws when the head has no #EXT-X-PROGRAM-DATE-TIME or a segment follows an #EXT-X-DISCONTINUITY. */
export function parseMediaPlaylist(text: string): MediaPlaylist;
/** The segments that overlap [fromMs, toMs), in order. Throws unless the window lies inside the playlist. */
export function selectSegments(playlist: MediaPlaylist, fromMs: number, toMs: number): HlsSegment[];
```

Modules used by one milestone are specified in that stage file. Their exports, so nothing else picks the same names:

| Module | Exports | Spec |
| ------ | ------- | ---- |
| `scripts/fetch-gibs-caps.ts` | `GIBS_CAPS_LAYERS`, `GIBS_CAPS_MATRIX_SETS`, `trimGibsCapabilities`, `snapshotProblems`; `main` runs only when executed directly, so tests can import it | M1 step 1 |
| `src/map/ground/layers/gibs.ts` | `TRUE_COLOR_LAYER`, `OVERLAY_LAYERS`, `LEVEL9`, `GibsCapabilities`, `parseGibsCapabilities`, `gibsWmtsOptions(caps, layer, matrixSet, dropLimits = false)`, `createTrueColorLayer`, `createOverlayLayers`, `loadGibsCapabilities(url)`, `getGibsCapabilities()` | M1 step 10 |
| `src/map/ground/layers/site.ts`, `createGroundMap.ts` | `createSiteLayer()`; `createGroundMap(target, store, caps): () => void` | M1 steps 11, 13 |
| `src/map/sync/bindGibs.ts`, `bindSite.ts` | `bindTrueColorDate(store, source)`; `bindSite(store, feature, view)` (the wedge from M4) | M1 steps 11, 12 |
| `tests/helpers/store.ts` | `storeAt(iso)` | M1 section 5 |
| `src/map/sky/layers/stars.ts`, `grid.ts`, `bodies.ts` | `StarsLayer`, `createStarsLayer(capacity, fillStyle)`, `setStarCount`; `buildGridFeatures(model)`, `createGridLayer()`; `bodyLabel(id, phaseFraction)` | M2 step 8 |
| `src/map/sync/bindSkyCamera.ts` | `bindSkyCamera(store, sky: Pick<SkyMapHandle, "setCameraModel">)`; M4 widens `sky` to also pick `"setPanZoom"`, M5 to also pick `"setPassThrough"` | M2 step 8, M4 step 11, M5 |
| `src/map/sky/layers/hitTargets.ts` | `HIT_TARGET_MIN_PX` (24), `HitTargets`, `createHitTargets(map, store)`: the `ol/Overlay` buttons and their frame updater (section 4, "Sky over video" rule 6) | M5 |
| `scripts/fetch-gp.ts` | `MIN_REFETCH_MS`, `shouldFetch(meta, group, nowMs)`, `gpUrl(group, baseUrl?)`, `fetchGp(options)`; the CLI runs only when executed directly | M3 step 8 |
| `src/app/persist.ts` | `loadCalibrations(storage, registry)`, `startCalibrationPersistence(store, storage)`, `buildCalibrationFile(state, nowMs)`, `parseCalibrationFile(json, registry)`, `CalibrationFileV1` (`format: "overhead.calibration"`, `version: 1`) | M4 step 8 |
| `src/map/sky/layers/background.ts` | `StillRefreshOptions`, `startStillImageRefresh(layer: ImageLayer<ImageSource>, projection, options)` (M4); `createVideoSource(video, widthPx, heightPx, projection)`, `onVideoFrames(video, onFrame)` (M5) | M4 step 10, M5 step 11 |
| `src/map/sync/bindBackground.ts` | `bindBackground(store, layer: ImageLayer<ImageSource>, start = startStillImageRefresh)`; it builds each camera's projection with `skyPixelProjection` when it starts that camera | M4 step 10, M5 step 11 |
| `src/app/youtube.ts` | `YtPlayer`, `YtEvent`, `YtPlayerOptions`, `YtNamespace`, `YT_IFRAME_API_URL`, `loadYoutubeIframeApi`, `parseYoutubeIdFromHtml`, `resolveYoutubeVideoId(resolverUrl, fallbackId, fetchFn?, timeoutMs?, cache?)`, `mediaReferenceTimeMs`, `videoStatusForYtState`, `videoStatusForYtError`, `mountYoutubePlayer(wrapper, camera, videoId, store, onRestart): { destroy(): void }` | M5 steps 4, 5 |
| `src/app/clip.ts` | the names in section 6 (App modules) plus `loadClipFromSidecarUrl(store, cameraId, fetchFn?)` (a clip camera with a `sidecarUrl`, on activation) and `loadClip(files, store)` (`local-replay`, picked files). From M9, `loadClipFromSidecarUrl` probes the video with one `Range: bytes=0-1` request through a module-private `playableClipUrl`: 206 streams from the URL, 200 with a `video/` type reads the file into a Blob (Chromium cannot seek a video served without ranges), anything else is "not part of this build"; and `clipGpBaseUrl` is exported | M5 step 10; M9 steps 14d, 14f |
| `scripts/find-passes.ts` | `FindPassesOptions` (with `gpDir`, `--gp`), `parseFindPassesArgs(argv, nowMs)`, `CameraPassSpan`, `findCameraPasses(options, readText)`; `main` runs only when executed directly | M5 step 16; section 8 "Recorded clips" |
| `scripts/record-clip.ts` | `HlsSegment`, `MediaPlaylist`, `parseMediaPlaylist(text)`, `selectSegments(playlist, fromMs, toMs)` (section 6, Script modules), `RecordClipOptions`, `parseRecordClipArgs(argv)`, `ClipProbe`, `buildClipSidecar(...)`; `main` runs only when executed directly | M5 steps 16, 17; section 8 "Recorded clips" |
| `scripts/check-clip-pass.ts` | `ClipTrack`, `CheckClipPassOptions`, `parseCheckClipPassArgs(argv)`, `CssRect`, `clientToImagePx(clientX, clientY, mapRect, widthPx, heightPx)`, `PassSample`, `alongTrackOffsetS(samples, maxGapS?)`, `pixelSeparationDeg(reference, a, b)`; `main` runs only when executed directly | M5 steps 16, 18 |
| `scripts/fetch-deploy-clips.ts` | `DEPLOY_CLIP_MAX_BYTES`, `DeployClipFile`, `DEPLOY_CLIP_FILES`, `DEPLOY_CLIP_GP`, `fetchDeployClip(file, outDir, fetchFn?)`, `copyClipGp(fromDir, toDir)`; `main` runs only when executed directly | M9 step 14c |
| `src/map/sync/bindHorizon.ts` | `HorizonWorkerLike`, `bindHorizonWorker(store, createWorker?)`, `bindSkyHorizon(store, sky)` | M6 steps 7, 9 |
| `src/map/sync/bindHillshade.ts` | `bindHillshadeTexel(map, layer, source)` (no store), `bindHillshadeSun(store, layer)` | M6 step 11 |
| `src/map/ground/layers/hillshade.ts`, `src/map/sky/layers/horizon.ts` | `createHillshadeLayer()`, `COS_INCIDENCE`; `createHorizonLayer()`, `buildSkylineCoords(model, profileDeg)` | M6 steps 9, 11 |
| `tests/helpers/decodePng.ts`, `terrainFixtures.ts` | `decodePng(bytes)`; `fixtureSampler(site, keys)` | M6 step 5 |
| `src/map/ground/layers/goes.ts` | `GOES_LAYER`, `LEVEL6`, `GOES_OPACITY`, `goesDomainUrl(nowMs)`, `goesProbeUrl(stepMs)`, `domainTextFromXml(xml)`, `createGoesLayer(caps)` | M7 step 4 |
| `src/map/sync/bindGoes.ts` | `bindGoesTime` (section 4), `GOES_POLL_MS`, `GOES_MAX_FALLBACKS`, `GoesSession`, `createGoesSession`, `bindGoesLayer(store, layer, source, session)`, `GoesPollDeps`, `bindGoesDomainPoll(store, session, deps)` | M7 step 5 |
| `src/map/ground/layers/footprint.ts`, `src/map/sync/bindFootprint.ts` | `createFootprintLayer()`; `bindFootprint(store, polygon)` | M8 step 8 |
| `src/app/demo.ts` | `DemoStepId`, `DemoContext`, `DemoStep`, `DEMO_STEPS`, `DEMO_PASS_WINDOW_MS`, `DEMO_LEAD_MS`, `chooseDemoPass`, `loadDemoAnchorMs(baseUrl, site)`, `goesWindowNote(simTimeMs, nowMs)`, `startDemoRunner(store, anchorMs)` | M9 step 10 |
| `src/workers/bulk.ts` (conditional) | `createStarlinkBulk(recs)`, `StarlinkBulk`, `writeBulkSample(bulk, rows, ctx, out)` | M9 step 3 |

## 7. Conventions

### Units

1. Names carry units: `azDeg`, `altDeg`, `latDeg`, `lonDeg`, `rollDeg`, `rangeKm`, `heightM`, `heightKm`, `focalPx`, `uPx`, `vPx`, `timeMs`, `stepMs`, `etaSec`, `mediaSec`.
2. Degrees in the store, the UI, messages and public APIs. Radians only inside domain functions and at the `satellite.js` boundary.
3. Kilometres for orbits, ECEF and ENU. Metres for terrain and site heights.
4. Pixels: `u` right, `v` down, origin at the image's top-left corner. Pixel coordinates are continuous: the image corners are (0, 0) and (W, H), pixel `i` covers `[i, i + 1)`, and the centre is W/2, not (W − 1)/2. In the OpenLayers sky map a pixel is the coordinate `[u, H − v]` (`toSkyMapCoord`); a click's image pixel is `(x, H − y)` from `event.coordinate`.
5. Heights: `site.heightM` is the lens above mean sea level and is the observer height for `astronomy-engine` (`heightM` m) and `satellite.js` (`heightM / 1000` km). DEM heights are orthometric. GeoPose `h = heightM + geoidSepM` (ellipsoidal). The datum difference is under 0.3 px on the overlay.
6. Latitude is geodetic everywhere except on the footprint sphere.

### Time

1. Time is a `number` of UTC epoch milliseconds everywhere. A `Date` is built only at a library boundary (`satellite.js`, `astronomy-engine`, `Intl`).
2. `astronomy-engine` never gets a number: a number means days since J2000. Pass `new Date(ms)` or one `astroTimeAt(ms)` per pass.
3. Never store epoch ms in a `Float32Array` (about 23.5 s of error).
4. CelesTrak `EPOCH` has no zone suffix: parse it with `parseOmmEpochMs`, which appends `Z`.
5. The UI shows UTC and the camera's local time (`site.timeZone`), both labelled.

The clock loop (`src/state/clockLoop.ts`, section 6) is one `requestAnimationFrame` loop, started once at module scope in `main.tsx` with `startClockLoop(store)`; a second start throws, and `stop()` is idempotent. Unit tests pass a manual `FrameScheduler`. The first frame has a wall delta of 0. From M9, each frame callback is wrapped in `performance.measure("overhead:frame", …)` and the measure is cleared at once. Each frame:

1. Compute the sim time from the mode and the active camera:
   - live, `synthetic` (or the registry not loaded yet): `Date.now()` (M1). If `|Date.now() − rangeCenterMs|` exceeds `SCRUB_HALF_RANGE_MS`, call `jumpToNow()` instead, so long live sessions keep the scrubber around now (also for YouTube).
   - live, `still-image`: `camera.frameTimeMs ?? Date.now()`, the capture time of the image on screen, or now before the first image (M4).
   - live, `youtube` (M5): with no media clock or no anchor yet, `Date.now() − selectStreamDelayMs(state)`. With an anchor, `youtubeLiveTimeMs(anchor.wallMs, anchor.mediaSec, mediaSec(), selectStreamDelayMs(state))`, where the anchor is taken at the first PLAYING with a finite `getCurrentTime()` > 0 (the real player reports 0, and once null, before that). A null `mediaSec()` skips the tick. The time freezes while the player pauses or buffers, so stalls are tracked. Rate is locked to 1; play/pause, scrub, step and rate changes switch to replay.
   - replay without video (M0): `advanceReplayMs(simTimeMs, wallDeltaMs, rate)` while playing (wall delta clamped to 250 ms), then `clampToScrubRangeMs`; reaching the ± 12 h edge pauses the clock.
   - `local-video` (M5, always replay): with a `LocalMediaClock` registered, `localVideoTimeMs(startUtcMs, mediaSec())`. If `clock.simTimeMs` differs from the value the loop wrote last frame, the user seeked, stepped, scrubbed or recentred: call `seekToSec((simTimeMs − startUtcMs) / 1000)` once and keep `simTimeMs`. Never `advanceReplayMs` while a clip is registered; no tick before one is. `playbackRate` accepts only 0.0625–16 in Chromium: set it in `try/catch`, and offer only 1× and 10× while a clip is loaded.
   - The YouTube player and the local `<video>` register their clocks with `setMediaClock` (one at a time) and unregister on cleanup.
2. Call `actions.tick(simTimeMs)` if it changed. Bindings run synchronously.
3. Run the frame updaters registered with `registerFrameUpdater`, in registration order, playing or paused: satellite interpolation and `MultiPoint` writes, the sky recompute when `needsSkyRecompute` is true (≥ 2 s of sim time in either direction, or a camera change), and the next sample request. An updater that throws is removed and logged once with `console.error`; the clock keeps running.
4. On frames where the sim time changed, call `renderSyncAll()` (`renderSync()` on every map in the registry). Without it, OpenLayers draws one frame late, or only every other frame. On other frames OpenLayers schedules its own renders (interaction, tile loads, `changed()`), so a paused map makes 0 renders per idle second.

### Azimuth and altitude

1. Azimuth is degrees clockwise from north in `[0, 360)`, east = 90. Both libraries already agree. `satellite.js` returns radians (`atan2(−topE, topS) + π`); `astronomy-engine` `Horizon` and `HorizonFromVector` return degrees.
2. The `Rotation_EQJ_HOR` frame is x = north, y = west, z = up, so `az = atan2(−y, x)`.
3. Altitude is apparent (refracted) for everything drawn, picked or compared with the terrain horizon. Geometric altitude is used only for the Sun's twilight cutoff and for footprint rays.

### Refraction

1. One model: `astronomy-engine` `'normal'` (sea-level Saemundsson), unscaled, for stars, planets and satellites alike.
2. Stars: inline loop adding `Refraction('normal', alt)`. Planets: `Horizon(..., 'normal')`. Satellites: `apparentAltDeg(geometric)` at every altitude, with no 10° cutoff.
3. The Sun test for satellite visibility uses geometric altitude (≤ −6° for stations and visual, ≤ −12° for Starlink).
4. The terrain horizon (κ = 0.13) is already apparent.
5. Airless: `Horizon(..., undefined)`; `HorizonFromVector(v, '')` (its parameter is a required `string`).
6. Footprint rays convert apparent to geometric with `geometricAltDeg` before intersecting.

### Interpolation

1. Never interpolate azimuth, altitude, longitude or the sunlit flag.
2. Sky: interpolate topocentric ENU, linear up to 60× and Hermite with the Earth-fixed velocity at 600× (`interpModeForRate`). Then `enuToAzAltDeg`, then `apparentAltDeg`. Measured errors: linear ENU 0.0024° at 60×, Hermite 0.0017° at 600×, linear az/alt 14–28° at 600×.
3. Ground: `ECEF = O + M · ENU` (WGS-84 observer `O`, `M = enuToEcefMatrix`), then `ecefToLatLonDeg`, then EPSG:3857.
4. The sunlit flag comes from the nearer sample (`sunlitAt`).

### Errors

1. Functions that can fail return `null` or `false` (documented in section 6). Callers pass the `null` up. An object without a position is not drawn and not pickable; it is never drawn at 0, 0.
2. Throw only for invalid input files at load (`parseGpFile`) and programmer errors.
3. `propagate` returning `null` sets `valid = 0`; log the NORAD id and `satrec.error` once per object per session.
4. Non-finite numbers never reach OpenLayers geometries or proj4 (which throws on them).
5. Every fetch sets a `LoadStatus`; the UI shows `loading` and `error` states. No retry loops. `fetch-gp.ts` stops at the first non-200 and fails its workflow.
6. Never leave a WMTS source on a `Time` whose tiles failed, and never select such a `Time` again in the session. OpenLayers keeps the errored tiles under that `Time`'s key and never requests them again, so returning to it makes 0 requests, fires no new `tileloaderror`, re-renders at 60 fps and never fires `rendercomplete`.
   - True colour (M1, `bindTrueColorDate`): on a tile error, revert to the last `Time` that loaded a tile and remember the failed one for the session.
   - GOES (M7, `bindGoesLayer`): remove the failed step from `data.goes.intervals` for the session through `setGoesDomain`, so `selectGoesStepMs` moves to the previous listed step and the caption never names a step that is not on screen. After 3 fallbacks in a row the next failure sets `data.goes.status` to `error`, which hides the layer until a poll succeeds.
   - Each 404 is also a console error in Chromium, so e2e mocks never answer 404: these paths are unit-tested.
7. `localStorage` is always inside `try/catch`.

### Credits

1. Every source shows its credit on screen while it is visible. The active camera's `credit` and `termsNote` are visible at all times. `Credits.tsx` is a `<section aria-label="Credits">` rendered at all times, outside every pane and panel; the OpenLayers attribution control is off.
2. Camera credits come from `CameraConfig.credit` (and, for a clip, its sidecar, M5). Data-source credits come from `src/app/credits.ts` (section 6):
   - NASA GIBS (`GIBS_CREDIT`, M1), while GIBS is ready and any GIBS layer is on: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." Instrument lines: "Imagery: NOAA-20 / VIIRS, <date>" while true colour is on (M1), and "Imagery: GOES-West/ABI, Band 13 Clean Infrared" while `goesIr` is on (M7).
   - GIBS Coastlines and Reference_Labels (`OSM_NE_CREDIT`, M1), while GIBS is ready and `coastlines` is on: "© OpenStreetMap contributors, Natural Earth", linked to `https://www.openstreetmap.org/copyright`, licence ODbL-1.0.
   - Stars (`BSC5_CREDIT`, `IAU_WGSN_CREDIT`, M2), while `stars` is on: "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR" (DOI 10.26093/cds/vizier) and "Star names: IAU WGSN" (CC BY).
   - Orbital elements (`CELESTRAK_CREDIT`, M3), while `satellites` or `starlink` is on: "Orbital elements: CelesTrak".
   - Terrain (`TERRAIN_CREDIT` and `TERRAIN_SOURCE_STATEMENTS`, M6), while `hillshade` is on or the active camera's horizon is `loading` or `ready`: "Terrain: AWS Terrain Tiles (Tilezen Joerd), data sources and attribution", linked to `https://github.com/tilezen/joerd/blob/master/docs/attribution.md`, plus all 11 lines of that document's "Required attribution" block. The list may instead be built per view from each tile's `x-amz-meta-x-imagery-sources` header mapped to the document's statements, but never from a fixed subset; M6 shows the full block, because hillshade tiles load through `<img>`, whose headers are not readable. The Mapzen line is not required.
3. A recorded clip shows its sidecar's `credit` (for the StarCam clips, the camera's own credit, "NAOJ & Asahi Shimbun"). Recordings are never committed. The root README (M9) lists every credit and licence, and `readme.test.ts` checks it against `credits.ts` and `cameras.json`.

### Accessibility

1. Every control is keyboard-reachable with a visible focus ring. Never remove the browser's focus ring without a replacement.
2. `prefers-reduced-motion: reduce` hides the trails (their toggle reads "(off: reduced motion)", M3), makes "Show on map" and Follow jump instead of animating, turns CSS transitions and animations off, and changes tour steps without animation (M9).
3. Meaning never rides on colour alone: sunlit and shadowed satellites differ in shape; behind-terrain objects are dimmed and labelled in the Inspector; camera, layer and GOES statuses are text.
4. Live regions announce changes, never a ticking value. The incoming chip section contains one `aria-live="polite"` element that announces only a new first entry, never the countdown (M8); the tour region likewise holds its caption in one (M9). Readouts that change at 4 Hz are never live regions.
5. Each map container has an `aria-label` naming what it shows. A map that takes keyboard pan and zoom is focusable (`role="application"`, `aria-roledescription="map"`, `tabIndex` 0; M1). The sky view is a `<section>` with a text alternative: the "Above the horizon" list (M2) and the "Satellites above the horizon" buttons (M3).
6. Pointer targets are at least 24 × 24 CSS px; OpenLayers' control buttons are enlarged to 24 px (M9). The hit targets over a YouTube player (M5) follow the same minimum and are named by `aria-label`. They are not tab stops: keyboard users select the Sun, Moon, planets and satellites from the text alternative (rule 5).

## 8. Testing

### Unit tests

1. Vitest 5, `environment: "node"`, files `tests/unit/**/*.test.ts`, run by `npm test` (`vitest run`).
2. `tests/unit/setup.ts` replaces `globalThis.fetch` with a stub that throws, so no unit test reaches the network. Fixtures are read from `tests/fixtures` with `node:fs`.
3. Unit tests cover all of `src/domain`, the selectors, the actions and the bindings. Bindings are tested with a store from `createAppStore` (or `storeAt(iso)` from `tests/helpers/store.ts`, M1, which loads the committed, enabled registry) and real OpenLayers sources where they work without a DOM (`VectorSource`, `WMTS` built from an options object). `WMTSCapabilities` needs `DOMParser`, so capabilities parsing is tested in e2e. Unit tests inject `fetchFn` where a module fetches.
4. Seeded random tests use mulberry32 with seed `20261011`.
5. Performance is never asserted in Vitest. The budgets are Chromium budgets (section 9): the app propagates in a browser worker, and Node timings do not transfer (one `collectIncoming` call with Starlink took 14.4–16.5 ms in Node 26.11.1 arm64 and 9.6 ms p95 in a Chromium worker, M8).

### End-to-end tests

1. Playwright 1.64, one Chromium project, always headless. Run `npx playwright install chromium` once (CI: `npx playwright install --with-deps chromium`); 1.64 needs chromium-1248.
2. `webServer` is `vite preview --port 4173 --strictPort` over the built app, with `reuseExistingServer: !process.env.CI`. CI never runs `npm run dev`. `forbidOnly: !!process.env.CI`. The app is served under the H1 base: `baseURL` is `http://localhost:4173/Overhead/` (with the trailing slash), and specs navigate base-relative, `page.goto("./")` or `page.goto("./?cam=…&t=…")`, never `goto("/…")`. Playwright resolves `goto` like `new URL(path, baseURL)`, so `"/?t=…"` leaves the base and reaches the app only through `vite preview`'s 302, and any other root path is a 404 that the guard reports (M0 step 9, gotcha 19). Manual checks use `http://localhost:5173/Overhead/` (`npm run dev`) or `http://localhost:4173/Overhead/` (`npm run preview`).
3. Every spec imports `test` and `expect` from `tests/e2e/fixtures.ts`, which also exports `APP_ORIGIN` (`"http://localhost:4173"`, the origin only, without the base) and the `Guard` type. Two auto fixtures:
   - `guard` (M0) registers the catch-all `context.route("**/*", …)` first. A request whose origin is not `APP_ORIGIN` is aborted and recorded. It also records `console` errors (pages and workers) and `pageerror` events, and at teardown fails the test on any of the three. Milestones never edit it.
   - `routes` (M1) takes `guard` as a parameter, so Playwright sets it up after the catch-all and tries its routes first (routes match newest first). Every milestone adds its mocks inside `routes`, never "after the catch-all" elsewhere. A spec that needs a different answer adds a `page.route`, which runs before the shared `context.route`.
   - `context.route` mocks cover dedicated-worker fetches too (checked with Playwright 1.64 and Chromium headless shell 153: both `context.route` and `page.route` fulfilled a module worker's cross-origin `fetch`).

   The routes, by milestone:
   - `**/gibs.earthdata.nasa.gov/**`, checked in this order: `HEAD` (M7) → 200, no body, with `layer-time-actual: <the request's Time>`, `access-control-expose-headers: layer-time-actual` and `access-control-allow-origin: *` (the probe also carries `Request=GetTile`, so HEAD must be matched first); a path containing `/1.0.0/GOES-West_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/` (M7) → `tests/fixtures/gibs/goes-domain.xml`; `Request=GetTile` (M1) → `tile.jpg` when `Format` is `image/jpeg`, else `tile.png`; anything else → aborted and recorded. The capabilities snapshot and `cameras.json` are same-origin.
   - same-origin `**/data/gp/*.json` (M3): `tests/fixtures/gp/*`, so satellite positions do not change when `fetch-gp.yml` commits new data.
   - `**/www.cfht.hawaii.edu/**` and `**/www.allskykamera.space/**` (M4): `tests/fixtures/gibs/tile.jpg` (`image/jpeg`, 256 × 256).
   - `**/www.youtube.com/**` (M5): path `/iframe_api` → `tests/fixtures/youtube/iframe_api.js` (`text/javascript`), the stub player; anything else aborted and recorded.
   - same-origin `**/recordings/**` (M5): `subaru-2026-10-11-iss.json` → `tests/fixtures/video/test-pattern.sidecar.json` and `test-pattern.webm` → `tests/fixtures/video/test-pattern.webm`, so the clip camera loads the test pattern. Without this route `vite preview` answers `/Overhead/recordings/…` with `index.html` (status 200, `text/html`), which the app reports as "not part of this build" (section 8, "Serving clips"). `route.fulfill` ignores `Range` and answers 200 with the whole file, so from M9 the routed clip takes `loadClipFromSidecarUrl`'s Blob path (M9 step 14d).
   - `**/astroasahi.github.io/**` (M5): any path → `tests/fixtures/youtube/astroasahi.html` (status 200, `access-control-allow-origin: *`), whose meta refresh names the fixture id `Fixture0001`.
   - `**/s3.amazonaws.com/elevation-tiles-prod/**` (M6, shared because from M6 every camera's horizon worker fetches tiles): `terrarium/{z}/{x}/{y}.png` → `tests/fixtures/terrain/walenstadt/…` or `maunakea/…` if the file exists, else `tests/fixtures/terrain/flat.png`, with `access-control-allow-origin: *`, `access-control-expose-headers: x-amz-meta-x-imagery-sources` and `x-amz-meta-x-imagery-sources` from that site's `sources.json` (empty for `flat.png`). Without the expose header the worker reads no imagery sources.
4. Never fulfil a mock with 404 or abort a request in a passing test: Chromium logs every failed resource load as a console error, which fails the guard. A test that expects console errors (M4's offline still image) removes exactly those from `guard.consoleErrors` at its end.
5. Specs fix the sim time with `?t=` inside the fixtures' time windows. With KVP encoding, GIBS `Time` is a query parameter whose colons are encoded (`%3A`): read it with `URLSearchParams`, which decodes them.
6. Perf specs (`npm run perf`, `PERF=1`) run on Chrome for Testing (`channel: "chromium"`) with the GPU from M9; the default headless shell renders WebGL on SwiftShader. Spec helpers that count passes use a `PerformanceObserver`: the app clears its `overhead:*` measures at once.

### Fixtures

Network tools run by hand on a developer machine and commit their output. CI never runs them.

| Fixture | Path | Generated by | Date | Tolerance / use |
| ------- | ---- | ------------ | ---- | --------------- |
| CelesTrak OMM snapshot | `tests/fixtures/gp/{stations,visual,starlink}.json`, `meta.json` | The verification download, already committed with its `meta.json` (sha256s match). Only if it is lost: one run of `scripts/fetch-gp.ts --out tests/fixtures/gp` (counts against CelesTrak's limits) | 2026-10-11T03:50:21Z (22 / 156 / 11,102 objects; 11,277 unique) | Inputs for orbit tests and e2e. Regenerate the ISS fixture whenever this changes. |
| ISS reference pass | `tests/fixtures/iss-pass-maunakea.json` | `scripts/fixtures/iss-pass-skyfield.py`: Skyfield on ISS 25544 from the committed `stations.json`, observer 19.8253°, −155.4689°, 4,204 m; az, el, range and sub-point every 10 s over the passes above 10° in the 24 h after the OMM fetch, plus the shadow transitions | at generation | great-circle az/alt ≤ 0.05°, range ≤ 0.1 km, sub-point ≤ 0.005°, sunlit transitions within 2 s of Skyfield's `is_sunlit` flips (the script writes them at 1 s resolution). Measured on the 2026-10-11 OMM: 0.0038°; e.g. 2026-10-11T15:08:11Z az 171.268°, el 19.338°, range 1045.48 km (Skyfield) |
| Polaris | inline constants | HR 424, J2000 RA 37.95456°, Dec +89.26411°; Maunakea 19.8253°, −155.4689°, 4,204 m; 2026-10-10T08:00Z | 2026-10-11 | az 0.592°, alt 20.151° ('normal'), 20.105° airless; ± 0.01° (the refraction term is only 0.045°) |
| Planets | `tests/fixtures/horizons-airless-maunakea-2026-10-10.json` | `scripts/fetch-horizons-fixture.ts`: JPL Horizons API, `EPHEM_TYPE=OBSERVER`, `CENTER='coord@399'`, `SITE_COORD='-155.4689,19.8253,4.204'`, `QUANTITIES=4`, `APPARENT=AIRLESS`, 8 bodies, 2026-10-10 00:00 → 2026-10-11 00:00 UT, 20 min. Shape: `{ generator, fetchedAtUtc, query, site, bodies: { <BODY_IDS key>: { command, rows: [isoUtc, azDeg, elDeg][] } } }`, 73 rows per body | at generation | great-circle separation < 0.05° vs `Horizon(..., undefined)` on rows with el > 0, at least 30 such rows per body (measured worst 0.0058°) |
| Twilight | inline constants | astronomy-engine, Skyfield and USNO agree | 2026-10-11 | from 2026-10-10T10:00Z at the Polaris site: dusk 2026-10-11T04:24:11Z, dawn 2026-10-10T15:53:03Z; ± 60 s |
| Refraction | inline constants | astronomy-engine 2.1.19 | 2026-10-11 | `Refraction('normal', alt)`: 0° → 0.48303, 10° → 0.09013, 20° → 0.04569, 45° → 0.01688; ± 1e-5 |
| Star catalogue | `public/data/stars.json` | `scripts/build-stars.ts` from CDS V/50 `catalog.gz` (padded to 197 characters, 14 records without position skipped) and IAU-CSN by HR number | at generation | exactly 8,404 rows at V ≤ 6.5, sorted by vmag then HR; HR 424 named Polaris; names per `StarRow` (section 6) |
| Lens cross-checks | none (seeded points) | proj4 2.22.0 with `+proj=longlat +R=1 +no_defs` | n/a | M2 (zenith equidistant): closed form vs proj4 `aeqd` < 1e-9. M4 (every lens and pose): closed form vs proj4 within a relative 1e-12·max(1, ‖p‖) for 50 points per lens and pose (rectilinear: unprojected pixels inside the image; fisheyes: uniform on the sphere within 90° of the axis, which covers tilted poses); forward then inverse < 1e-6 px; facing west (az0 270°, alt0 20°, f 2742, cx 1920) az 300° lands at u ≈ 3381; W = H = 1024 zenith fisheye at roll 180°: N horizon `[512, 1024]`, E `[0, 512]`, S `[512, 0]`, W `[1024, 512]` |
| Frame coverage | inline constants | gnomonic inverse | 2026-10-11 | f 2742 px, 3840 × 2160, az0 90°: azimuth span 70.0° at alt0 0°, 82.0° (48.98°–131.02°) at alt0 20°, 117.1° at alt0 45°; ± 0.05° |
| Calibration pairs | `tests/fixtures/calibration/cfht-nanaao-pairs.json` | exported from the Calibration panel on a real `cfht-nanaao` frame (pixel coordinates, target ids, frame time, start calibration; no image) | at generation | refit meets the M4 acceptance: ≥ 10 named stars at alt ≥ 20°, RMS ≤ 0.25°, each ≤ 0.5°, 1 planet + 3 held-out ≤ 0.5° |
| GeoPose | `src/domain/camera/schemas/GeoPose.Basic.YPR.Schema.json`; `tests/fixtures/geopose/GeoPose.Basic.YPR.Instance.00.json` … `.03.json` | downloaded once from `https://schemas.opengis.net/geopose/1.0/` | 2026-10-11 | schema sha256 `5508d26aed6f546384ac1e1b9d1117f201179a2b32200ad28af3e5209c765640`; the instances must validate (their angles are radians: never use them as angle fixtures); round trips compare `geoPoseRotation` matrices within 1e-12 |
| GIBS | `public/data/gibs-capabilities.xml`; `tests/fixtures/gibs/tile.jpg`, `tile.png`; `tests/fixtures/gibs/goes-domain.xml` | `scripts/fetch-gibs-caps.ts` keeps the VIIRS NOAA-20/21 true-colour, GOES-West Band 13, Coastlines and Reference_Labels layers and the Level6 and Level9 matrix sets, with every ResourceURL template and `TileMatrixSetLimits` as served (M1 step 1). `tile.jpg` is a real NOAA-20 tile (z5 2/14, 2026-10-10) and `tile.png` an empty Reference_Labels tile (M1 step 2). The domain file is the DescribeDomains window 2026-10-07T12:00:00Z--2026-10-11T00:00:00Z, with two gaps and a bare-date midnight (M7 step 1) | at generation | e2e uses the snapshot same-origin; times in specs must lie inside its windows |
| Terrain decode and formulas | inline constants | joerd docs and the verification run | 2026-10-11 | (128, 0, 0) → 0 m; (137, 219, 68) → 2523.2656 m; wall `apparentElevationDeg(1000, 0, 10000)` 5.672 ± 0.001° (no-curvature 5.7106° must fail); march over an analytic 1,000 m plateau from 10 km: 5.67 ± 0.05°; flat sea from 4,204 m: −1.9407° at 248.1 km, assert ± 0.01° and ± 2 km |
| Walenstadt horizon | `tests/fixtures/terrain/walenstadt/{z}/{x}/{y}.png`, `sources.json` | `scripts/fetch-terrain-fixture.ts`: every tile `tilesForSite(47.1236, 9.3242, 100000)` returns (45 tiles, 5.58 MB); `sources.json` maps `"z/x/y"` to the tile's `x-amz-meta-x-imagery-sources` | at generation | ground 467.6 ± 3 m; az 0° 32.7 ± 0.3°; az 270° 2.0 ± 0.3°; maximum about 32.9° near az 2°, minimum about 1.8° near az 276° (± 0.3°, azimuth ± 2°) |
| Maunakea open-ocean ray | `tests/fixtures/terrain/maunakea/{z}/{x}/{y}.png`, `sources.json` | the same script: `tilesForSite(19.82552, −155.47587, marchLimitM(4148), [0])`, the Subaru StarCam's azimuth 0° (10 tiles, 1.15 MB; `14/1116/7271` also holds the CFHT point) | at generation | z0 = fixture ground + 13 m = 4,147.6 m: az 0° −1.93 ± 0.02° (measured −1.9277°, sea tangent at 245.3 km); only `profile[0]` is asserted |
| Flat tile | `tests/fixtures/terrain/flat.png` | the same script: a 256 × 256 RGB PNG of (128, 0, 0) (564 B) | at generation | the e2e S3 route serves it for every tile not in a site fixture |
| Footprint | inline constants | spherical model (M8 prototype) | 2026-10-11 | from 19.8253°, −155.4689°, 4,204 m, H = 420 km: straight-up ray t = 415.796 km (H − h), hit lat/lon = site within 1e-9°; a ray at az 90°, alt −3° hits the Earth 93.4 km out, so `raySphereEntryKm` rejects it (inside `footprintLonLatDeg` such directions are replaced by clip-curve points before any ray is cast); dip −2.081°. Subaru defaults (3840 × 2160, az 81.2°, alt 19.6°, f 2742, site 19.82552°, −155.47587°, 4,148 m), H 420, null profile, 16 per edge: 66 pairs, pair 0 (−151.946464, 23.598321) ± 1e-6°, no vertex beyond the limb distance 2,482.234 km |
| Incoming pass | inline constants | M8 prototype on the committed OMM snapshot; regenerate whenever the snapshot changes | 2026-10-11 | ISS enters the Subaru frame (visible-in-frame predicate) at 2026-10-11T15:09:54.955Z ± 2 ms; on the synthetic fisheye it leaves Earth's shadow at 15:05:39.300Z ± 2 ms; `collectIncoming` on the fisheye at 15:05:07Z (mask 0b011) gives [25544: 35, 19046: 55], at 15:06:07Z [10114: 50]; Subaru at 15:09:22Z gives [25544: 35] |
| YouTube stub | `tests/fixtures/youtube/iframe_api.js`, `astroasahi.html` | hand-written (M5 step 14) | M5 | the stub mirrors the real widget: `YT.Player` (throws on an invalid id; replaces its host with a `srcdoc` iframe, and `destroy()` restores it), `playVideo`, `pauseVideo`, `mute`, `getCurrentTime` (extrapolated by up to 1 s while playing), `getPlayerState`, `setSize`, `getIframe`, `destroy`; events `onReady`, `onStateChange`, `onError` (101, 150, 153) and `onAutoplayBlocked`; `getMediaReferenceTime` only while `window.__ytStub.mediaReferenceSec` is set; test hooks on `window.__ytStub`, including the options each `YT.Player` was created with (e2e asserts `playerVars.fs` 0) and the clicks its iframe received (e2e asserts a click on an empty part of the overlay reaches it). `astroasahi.html` redirects to the fixture id `Fixture0001` |
| Test clip | `tests/fixtures/video/test-pattern.webm`, `test-pattern.sidecar.json` | `scripts/fixtures/make-test-clip.ts`: Playwright `recordVideo` of a 320 × 180 canvas with four coloured quadrants and a moving square; generated, CC0, not a sky recording | at generation | VP9, 25 fps, 7.00 s; the sidecar is a `ClipSidecar` ("Recorded clips" below) that starts it at 2026-10-11T08:00:00.000Z on `subaru-starcam`. e2e loads it both as picked files (`local-replay`) and through the `**/recordings/**` route (`subaru-2026-10-11-iss`), and uses only the quadrant colours (± 40 per channel) and the duration |
| Recorded ISS pass, 2026-10-11 | `recordings/subaru-2026-10-11-iss.mp4` and `.json`: local only, never committed, never in CI | cut by hand on 2026-10-11 from the Subaru StarCam's DVR window, the procedure `scripts/record-clip.ts` automates ("Recorded clips" below) | 2026-10-11 | M5 acceptance (the drawn marker within 1° of the ISS at all 94 tracked seconds: scripted `check-clip-pass` run, by hand, against `npm run dev`) and M8 acceptance (the chip before entry, by hand); the facts and the sidecar are under "Recorded clips" below |
| ISS track on the 2026-10-11 clip | `tests/fixtures/video/subaru-2026-10-11-iss-track.json` (a `ClipTrack`, M5 step 18) | the clip analysis's per-frame ISS centroid tracker (brightest 3 × 3 sum, then the background-subtracted centroid within 5 px; 4,711 clean frames), sampled at every even media second across the four visible stretches, with 221, 257 and 265 s standing in for 220, 258 and 264 s; numbers only, the clip is not committed (M5 step 14.6) | 2026-10-11 | 94 samples `[mediaS, uPx, vPx]` in 1920 × 1080 continuous px, from media 80 s (1905.4, 144.9) to 290 s (456.3, 820.3). Input to `check-clip-pass.ts`, which compares the drawn marker by angle through the sidecar's star fit; the M5 prototype gave max 0.543° (media 94 s), median 0.269°, `alongTrackOffsetS` +0.867 s with `tests/fixtures/gp` |
| ISS span in the Subaru frame | inline constants | the M5 prototype of `frameSpans` (satellite.js and astronomy-engine) on the committed `stations.json` (ISS epoch 2026-10-09T22:48:38.797Z), Subaru defaults (az 81.2°, alt 19.6°, f 2742, 3840 × 2160, site 19.82552°, −155.47587°, 4,148 m), 1 s samples, geometric horizon | 2026-10-11 | over 2026-10-11T14:00Z–17:00Z exactly one span: enter 15:09:55Z at az 120.760°, alt 28.756°; exit 15:15:09Z at az 52.065°, alt 0.002° (the set); `maxAltDeg` 28.756°; Sun −16.19° at entry. Times ± 1 s, angles ± 0.05° |
| HLS media playlist | `tests/fixtures/hls/dvr-playlist.m3u8` | segments 887655–887658 of the itag 270 DVR playlist fetched 2026-10-11T15:21:49Z, under a head of `#EXT-X-VERSION:3`, `#EXT-X-TARGETDURATION:5`, `#EXT-X-MEDIA-SEQUENCE:887655`, `#EXT-X-DISCONTINUITY-SEQUENCE:132` and `#EXT-X-PROGRAM-DATE-TIME:2026-10-11T15:08:30.039+00:00`; each URL replaced by `https://example.invalid/sq/<n>/seg.ts`, because real URLs carry the client IP and a signature | 2026-10-11 | `parseMediaPlaylist`: 4 segments, `sq` 887655 at 15:08:30.039Z, 5.0 s each; `selectSegments` for [15:08:31Z, 15:08:41Z) gives 887655–887657 |

### Recorded clips

Under O2, replay clips are recorded from a StarCam's YouTube stream into `recordings/`, which is gitignored and never committed. A clip is two files, `<clip>.mp4` and `<clip>.json` (a `ClipSidecar`, section 6), plus the element sets of its day in `<clip>.gp/`, which the app reads from M9 ("Element sets for a clip" below). The app reads nothing else in `recordings/`.

**Finding a pass** with `npx tsx scripts/find-passes.ts --cam <camera id> [--norad 25544] [--from <ISO Z>] [--hours 48] [--calibration <file>] [--gp <dir>]`:

1. Read `public/data/cameras.json` with `parseCameraRegistry`, and `<gp>/stations.json` and `visual.json`, where `<gp>` is `--gp` (default `public/data/gp`, the files `fetch-gp.yml` commits; run `git pull` first). The script never calls CelesTrak.
2. Build the camera model from the camera's defaults, or from a `CalibrationFileV1` export (M4) given with `--calibration`.
3. Run `findPasses(satrec, site, fromMs, toMs, 10_000, 0)`, then `frameSpans(satrec, group, site, camera, riseMs − 60_000, setMs + 60_000, 1_000)` on each pass. The 60 s margins are needed because `findPasses` works in geometric altitude while `frameSpans` tests the apparent altitude: refraction keeps a satellite above the apparent horizon after its geometric set (10 s for the ISS on 2026-10-11).
4. Print one line per span: enter and exit in UTC and in `site.timeZone`, az and alt at both ends, `maxAltDeg`, the Sun's geometric altitude at entry, and the element-set age.
5. Spans use the geometric horizon, so terrain or the domes can end a real span earlier.
6. Choose the recording window from the output:
   - start at least 60 s before entry (`INCOMING_STEPS × INCOMING_STEP_MS`, the incoming look-ahead), so M8's chip can be checked on the clip;
   - end after exit.

   With the Subaru defaults the 2026-10-11 clip starts 84.8 s before the predicted entry and ends 81.1 s after the predicted set. On the video the ISS appears at media 78.7 s; the fitted calibration predicts entry at media 79.8 s (M8).

**Recording** with `npx tsx scripts/record-clip.ts --cam <youtube camera id> --from <ISO Z> --to <ISO Z> --name <clip> [--norad <id>] [--yt-dlp <command>] [--ffmpeg <path>]`. It cuts the window from the stream's DVR window after the fact; it never records at the live edge.

1. **Tools.** It needs yt-dlp and ffmpeg. On 2026-10-11 they were yt-dlp 2026.08.19 (`uvx yt-dlp`) and a static ffmpeg 7.1 arm64 build. Pass yt-dlp `--js-runtimes node:<process.execPath>`, because YouTube's player challenges need a JS runtime.
2. **Video id.** `resolveYoutubeVideoId(camera.source.resolverUrl, camera.source.youtubeVideoId, fetch)` (M5) gives the current live id.
3. **Timing.** Wait until `--to` has passed. `--from` must lie inside the DVR window, which on 2026-10-11 covered the last 3,600 s.
4. **Playlist.** `yt-dlp -f 270 -g https://www.youtube.com/watch?v=<id>` prints the HLS media playlist URL for itag 270: 1080p H.264, video only (the stream has no muxed formats). Fetch the playlist and parse it with `parseMediaPlaylist`. On 2026-10-11 it held 720 segments of 5.0 s, with one `#EXT-X-PROGRAM-DATE-TIME` at its head and no discontinuities. Each segment's `/sq/<n>/` equalled `#EXT-X-MEDIA-SEQUENCE` plus its index, and its PROGRAM-DATE-TIME was the head's plus 5 s per segment before it.
   - `parseMediaPlaylist` ignores every tag other than `#EXT-X-MEDIA-SEQUENCE`, the head `#EXT-X-PROGRAM-DATE-TIME`, `#EXTINF` and `#EXT-X-DISCONTINUITY`. The real playlist also held `#EXT-X-VERSION:3`, `#EXT-X-TARGETDURATION:5`, `#EXT-X-DISCONTINUITY-SEQUENCE:132` and an ad-marker pair about every 180 s (`#EXT-X-DATERANGE:CLASS="CUEPOINT-AD",…`, then `#EXT-X-CUEPOINT:…,TYPE=AD`); the video after each marker is the camera's.
   - Match `#EXT-X-DISCONTINUITY` against the whole line: a prefix test also matches `#EXT-X-DISCONTINUITY-SEQUENCE` and rejects every real playlist (M5 step 17.1).
5. **Segments.** `selectSegments(playlist, fromMs, toMs)` picks the segments. Download each with a plain GET (on 2026-10-11 each returned 200, `application/octet-stream`). Concatenate them in sequence order into `<clip>-dvr.ts`, which is kept. The playlist and segment URLs expire about 6 h after they are issued and carry the client's IP address, so the script never logs them or writes them to disk.
6. **Remux** with `ffmpeg -i <clip>-dvr.ts -map 0:v -c copy -movflags +faststart <clip>.mp4`. Chromium cannot play MPEG-TS: headless Chromium 156 answered `canPlayType("video/mp2t")` with "" and failed a `.ts` source with MediaError 4 (`DEMUXER_ERROR_COULD_NOT_OPEN`). The remuxed MP4 loaded with duration 480 and 1920 × 1080 video. It starts at media time 0, and the browser's `currentTime` matches ffmpeg's `pts_time`: on the 2026-10-11 clip, a seek to 100.80 s showed 05:10:10 and a seek to 100.85 s showed 05:10:11.
7. **Sidecar.** `buildClipSidecar` writes `<clip>.json`:
   - `startUtcMs`: the first segment's PROGRAM-DATE-TIME, with `timingSource.method` `"hls-program-date-time"` and `startUncertaintyS` 0.2 (it covers the 0.144 s by which PROGRAM-DATE-TIME preceded the burned-in clock on 2026-10-11);
   - `durationS`: 5 s per segment, checked against ffmpeg's duration;
   - `width`, `height` and `fps` from `ffmpeg -i`;
   - `sourceVideoId`, and the camera's `credit` with `href` set to the watch URL of that id;
   - `pass` from `frameSpans` over the window when `--norad` is given, converted to media seconds.

   The script also writes `<clip>.segments.json` as its log (`sq`, PROGRAM-DATE-TIME and bytes per segment, no URLs), and copies `public/data/gp/` (`stations.json`, `visual.json`, `starlink.json` and `meta.json`) into `<clip>.gp/`: the element sets of the day, which the timing check uses and, from M9, the app replays the clip with ("Element sets for a clip" below).
8. **Adopt the burned-in clock when the camera shows one.** It is the camera's own capture clock; the Subaru StarCam shows HST at the lower right.
   - Crop the clock and tile a few seconds of frames with ffmpeg (`select='between(n\,a\,b)'`, `showinfo`, `crop`, `tile`; the exact command is in M5 "Recording a clip" step 4).
   - Find the frame where the seconds digit changes. Media 0 is that second in UTC minus the frame's `pts_time`, within one frame step (1/fps).
   - Write that `startUtcMs` with `timingSource.method` `"burned-in-clock"`. Set `startUncertaintyS` to cover the PROGRAM-DATE-TIME difference and the satellite cross-check below.
9. **Check the timing against a satellite.** Run `scripts/check-clip-pass.ts` on a measured track of the ISS (a committed track, or a Satellite check export, M5 step 13) with `--gp recordings/<clip>.gp` and read `alongTrackOffsetS`, δ (M5 "Recording a clip" step 6). With element sets at most 24 h old, |δ| ≤ `startUncertaintyS` confirms the clock: record δ under `timingSource` and keep `startUtcMs`. A larger |δ| with fresh elements, or a camera without a clock, sets `startUtcMs += round(δ × 1000)` with `timingSource.method` `"satellite"`. Old elements look like a clock error (0.88 s with the 40.3 h set on 2026-10-11), so never move the start on them. The in-app Satellite check only measures; it never moves the start.

Do not record at the live edge with yt-dlp and stop it with Ctrl-C. The first attempt on 2026-10-11 did, and two things went wrong:

- yt-dlp remuxes HLS output to MP4 (its FixupM3u8 step) only when a download finishes normally; a 20 s `--download-sections` test that day ran it, the interrupted recording did not. The file was left as MPEG-TS under an `.mp4` name (`ffmpeg -i` reports `mpegts`, `start: 1.400000`).
- By its burned-in clock it started at 15:10:15.18Z, 26 s after the ISS had entered the frame on the video (15:09:48.88Z).

**Serving clips.** Every path below is under the H1 base `/Overhead/`; the app resolves `sidecarUrl` against `import.meta.env.BASE_URL`.

1. **Dev.** `npm run dev` serves the project root under the base, so `recordings/<clip>.json` and its MP4 load as they are. Vite 8.3.4's dev server answered `/Overhead/recordings/x.json` with 200 `application/json` and a ranged MP4 request with 206 `video/mp4`, while `/recordings/x.json` (outside the base) got 404.
2. **Preview.** `vite build` copies only `public/`, so `dist/` holds no recordings. `vite preview` answers `/Overhead/recordings/…` with `index.html` (200, `text/html`). `loadClipFromSidecarUrl` treats any answer that is not OK or not JSON as "This clip is not part of this build": video status `error`, camera status `offline`, the "Replay a local clip" offer. No request fails, so no console error is logged. GitHub Pages answers a missing file with 404 instead, which gives the same message plus the browser's failed-load log.
3. **Production (M9 step 14).** The deployed build serves the 2026-10-11 clip from its own origin. A two-pass H.264 copy (23,515,809 bytes, 22.43 MiB, 1920 × 1080, 30 fps, same timing as the master) and the unchanged sidecar are published as assets of the release `clips-2026-10-11` on the public repository `FalconXYX/Overhead`. `npm run build:pages` (only in `deploy.yml`) downloads them into `dist/recordings/`, checking size and sha256, and copies the clip's element sets into `dist/recordings/<clip>.gp/`. Recordings never enter git. The copy stays under a 25 MiB ceiling for bandwidth (GitHub Pages' soft limit of 100 GB a month; the 148.6 MB master would cost 6.3 times as much per play). GitHub Pages answers byte ranges with 206, so the video streams and seeks from its URL; a server that ignores `Range` (Playwright's `route.fulfill`) gets the Blob path (section 6, `clip.ts` row).

**Element sets for a clip.** A satellite marker on a clip is only as good as the element sets' distance from the pass (0.08 s, 0.30 s and 0.88 s along-track with sets 20 h, 11 h and 40.3 h old on 2026-10-11), and `public/data/gp/` moves on every 6 h.

1. `record-clip.ts` copies `public/data/gp/` into `recordings/<clip>.gp/` when it cuts a clip (step 7 above). The 2026-10-11 clip's set is the committed snapshot `tests/fixtures/gp/` (fetched 2026-10-11T03:50:21Z, 11.3 h before the pass; ISS epoch 2026-10-09T22:48:38Z). That clip was cut by hand, so make its directory once with `mkdir -p recordings/subaru-2026-10-11-iss.gp && cp tests/fixtures/gp/*.json recordings/subaru-2026-10-11-iss.gp/`.
2. Until M9 the app always propagates `data/gp/`. The hand checks therefore choose the set themselves: `check-clip-pass.ts --gp <dir>` routes the app's GP requests (both `data/gp/` and `recordings/<clip>.gp/`) to `<dir>` (M5 step 18), and M8's manual check copies `tests/fixtures/gp/` into `public/data/gp/` for the session (M8 acceptance 3).
3. From M9 the app propagates a clip camera's own `recordings/<clip>.gp/` when it exists (section 5, "Propagation: sample lifecycle" rule 11), and the deploy ships it (`DEPLOY_CLIP_GP`, M9 step 14f).

**The 2026-10-11 clip.** These facts were measured on `recordings/subaru-2026-10-11-iss.mp4` with sha256 `cf952b8d5b2ade856b33d953b2da0b71f2b0b2716d97db1225f95386ceaa74e2`. Re-measure them if the clip is re-cut.

- **Format.** MP4, H.264 High, 1920 × 1080 at 30 fps, video only, 480.00 s (14,400 frames), 148,643,811 bytes, starting at media time 0.
- **Source.** DVR segments 887655–887750 (96 × 5 s) of `Kj5DjRYkzD8` itag 270, from the playlist fetched 2026-10-11T15:21:49Z. Running `selectSegments` on that playlist for [15:08:30.039Z, 15:16:30.039Z) gives exactly these 96. Their concatenation (153,519,296 bytes, the sum of the segment sizes; kept as `subaru-2026-10-11-iss-dvr.ts`) remuxes with step 6 to a file byte-identical to the MP4.
- **Start time.** Media 0 is 2026-10-11T15:08:30.183Z by the burned-in clock, the adopted value.
  - The clock reads 05:08:33 HST from 2.833 s, 05:10:11 from 100.833 s and 05:15:11 from 400.833 s. That puts media 0 at 15:08:30.167–15:08:30.200Z, with no drift over 398 s.
  - The first segment's PROGRAM-DATE-TIME, 15:08:30.039Z, is 0.144 s earlier.
- **Predicted ISS pass (25544).** With the committed OMM, the Subaru defaults (the published pointing, f 2742) and the geometric horizon, the ISS is inside the frame and visible from 15:09:54.955Z (media 84.8 s, az 120.8°, alt 28.8°) until it sets at about 15:15:09.0Z (media 398.9 s, az 52.1°). It stays sunlit throughout. The Sun is at −16.5° at media 0 and −14.6° at the end. M8's incoming fixture gives ETA 35 s at 15:09:22Z (media 51.8 s).
- **Measured on the video.** These come from the measurements recorded in the clip's sidecar, written by the recording step on 2026-10-11:
  - A star fit (73 BSC stars at 3 epochs, rms 0.65 px) gave az 81.2322°, alt 19.6185°, roll 0.7698°, f 2525.93 px and k1 −0.00992 in 3840 × 2160 pixels, with `rmsDeg` 0.0294. The published centre used f 2742 px; M5 makes this fit the `subaru-starcam` defaults.
  - On the video the ISS enters at the right edge at media 78.7 s and is lost behind the left-hand dome at 290.43 s (with the fit and the committed OMM the model puts the entry at 79.8 s). It is visible over 78.7–228.0 s, 238.0–241.5 s, 256.0–258.4 s and 260.8–290.43 s.
  - Fitting the ephemeris to the ISS track puts the committed OMM (epoch 40.3 h before the pass) 0.879 s behind the clock-derived time. Fresher element sets (20 h and 11 h old) were 0.08 s and 0.30 s behind. The ISS crosses this frame at up to 0.53°/s, so 0.879 s is at most about 0.47°, inside M5's 1° acceptance.

The contract fields of `recordings/subaru-2026-10-11-iss.json`, with `detail` shortened. The file on disk also carries provenance keys, which `parseClipSidecar` ignores. Typed `satisfies ClipSidecar` under tsc 7.0.2, and the file on disk type-checks against `ClipSidecar` too:

```json
{
  "cameraId": "subaru-starcam",
  "videoFile": "subaru-2026-10-11-iss.mp4",
  "startUtcMs": 1791731310183,
  "startUncertaintyS": 0.3,
  "timingSource": {
    "method": "burned-in-clock",
    "detail": "HST clock at lower right: the seconds digit changes at frames 25 + 30k, so media 0 = 05:08:30.183 HST ± 0.017 s"
  },
  "durationS": 480,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "sourceVideoId": "Kj5DjRYkzD8",
  "credit": { "text": "NAOJ & Asahi Shimbun", "href": "https://www.youtube.com/watch?v=Kj5DjRYkzD8", "licence": null, "licenceHref": null },
  "calibration": { "azDeg": 81.2322, "altDeg": 19.6185, "rollDeg": 0.7698, "focalPx": 2525.93, "cxPx": 1920, "cyPx": 1080, "k1": -0.00992, "k2": 0, "flipX": false, "streamDelayMs": 0, "rmsDeg": 0.0294, "updatedAtMs": 1791733561911 },
  "pass": {
    "noradId": 25544,
    "inFrameFromMediaS": 78.7,
    "inFrameToMediaS": 290.43,
    "visibleMediaS": [[78.7, 228], [238, 241.5], [256, 258.4], [260.8, 290.43]]
  }
}
```

`startUncertaintyS` 0.3 covers the clock reading (± 0.017 s), the PROGRAM-DATE-TIME difference (0.144 s) and the two fresh element sets (0.08 s and 0.30 s).

The e2e sidecar, `tests/fixtures/video/test-pattern.sidecar.json`:

```json
{
  "cameraId": "subaru-starcam",
  "videoFile": "test-pattern.webm",
  "startUtcMs": 1791705600000,
  "startUncertaintyS": 0,
  "timingSource": { "method": "manual", "detail": "Generated test pattern; the start is fixed" },
  "durationS": 7,
  "width": 320,
  "height": 180,
  "fps": 25,
  "sourceVideoId": null,
  "credit": { "text": "Test pattern generated for the Overhead e2e tests", "href": null, "licence": "CC0-1.0", "licenceHref": null }
}
```

### CI

1. `ci.yml` (one job, `check`) on every push and pull request: Node 26 from `.nvmrc`, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx playwright install --with-deps chromium`, `npm run e2e`, then upload `playwright-report/` and `test-results/` (kept 14 days) unless cancelled. Lint and type errors fail before the browser download.
2. CI never calls CelesTrak, GIBS, S3, YouTube, JPL Horizons or a camera. `fetch-gp.yml` is the only workflow that reaches a third party: it skips a group whose `meta.json` stamp is under 2 h old, always requests `FORMAT=json`, stops at the first non-200 (including 403), commits only changed files, and after a push dispatches `deploy.yml` (a push made with `GITHUB_TOKEN` starts no workflow).
3. `deploy.yml` (M0 step 15) builds `main` with the same Node and `npm ci`, then `npm run build` (`npm run build:pages` from M9, which also downloads the release-asset clip copies, "Serving clips" above), and publishes `dist/` to GitHub Pages. It runs no tests: branch protection keeps a red commit off `main`.

## 9. Performance budgets

Benchmarks run in Chromium through Playwright on a laptop (`npm run perf`; on this Apple-silicon Mac, launched from the arm64 Node 26, O4), never in Node and never in CI. From M9 the perf project uses Chrome for Testing (`channel: "chromium"`) with the GPU at 1440 × 900, DPR 2: the default headless shell renders WebGL on SwiftShader. M9 records a Chrome performance trace unthrottled and with 4× CPU throttling (CDP `Emulation.setCPUThrottlingRate`) with Starlink loaded (about 11,280 objects) and attaches both to the pull request. CDP throttling slows the main thread only, so the 4× trace says nothing about the worker.

| Work | Rate | Budget | How it is measured |
| ---- | ---- | ------ | ------------------ |
| Main thread per frame: clock tick, bindings, satellite interpolation and `MultiPoint` writes, sky updates, `renderSyncAll()` | 60 fps | unthrottled: ≥ 59 fps and ≤ 6 ms per frame (p95); 4× CPU throttle: ≥ 55 fps and ≤ 16 ms (p95) | `performance.measure` named `overhead:frame` around each clock-loop callback (M9), cleared at once and collected with a `PerformanceObserver` over 10 s at 60× with Starlink loaded (`starlink.perf.ts`) |
| Propagation worker, stations + visual (about 178 objects) | 10 Hz on the fixed grid | ≤ 4 ms per tick (p95) | `computeMs` from 600 consecutive `sample` replies (`propagation.perf.ts`, M3) |
| Propagation worker, with Starlink | 10 Hz | ≤ 10 ms per tick (p95), gated from M9 | same. M3 records it ungated: the plain loop measured p95 about 18 ms paced at 10 Hz under load. M9's culling measured p95 2.1–2.6 ms at 1× to 60× and 4.1–5.1 ms at 600× |
| Incoming pass in the propagation worker, with Starlink | 1 Hz | ≤ 20 ms (p95) | `computeMs` from 60 consecutive `incoming` replies (`incoming.perf.ts`, M8); measured 9.6 ms |
| Sky recompute: stars (inline loop), Sun, Moon, planets | whenever sim time moves ≥ 2 s (every frame at 600×) | ≤ 2 ms per pass (p95), first cold pass excluded | `performance.measure` named `overhead:sky` over 10 s at 600× and limit 6.5 (`sky.perf.ts`, M2) |
| React commits while playing, no user input | 4 Hz shared ticker | ≤ 4 commits per second | React `<Profiler>` `onRender` calls over 10 s at 60× on the `NODE_ENV=development` build (`npm run build:dev`, served with `PERF_OUTDIR=dist-dev`; `commits.perf.ts`, M9). The Profiler counts nothing in a production build, even with `--mode development` |

Rules that keep these budgets:

1. App code on the hot path allocates nothing per frame: typed arrays are allocated once and reused. (OpenLayers itself allocates an event per `changed()`.)
2. Moving satellites are one `MultiPoint` per group and style class, written in place and followed by one `geometry.changed()` per frame; never one `Point.setCoordinates` per satellite. On `WebGLVector`, a `MultiPoint` created empty never renders, and one emptied later never redraws: remove its feature while empty and add it back (`writeClassPoints`, M3).
3. Ground tracks stay on a canvas `VectorLayer`: `WebGLVector` does not draw unwrapped geometry beyond ± 180°.
4. Picking is a nearest-neighbour search in pixel space (`PICK_RADIUS_PX`, 6 CSS px) over the projected arrays; the ISS, the selected and the hovered objects are separate `Point` features with labels.
5. `WMTSCapabilities` parses only the trimmed snapshot, once, on the main thread.
6. The hillshade pushes its Sun variables (`sunAzDeg`, `sunAltDeg`) at most once per second. `texelGroundM` is pushed on `moveend` and whenever the tile zoom changes (`getZForResolution`), so slopes never use a stale texel size.
7. `new VectorSource({ features: arr, useSpatialIndex: false })` adopts `arr` as its backing array, so `removeFeature` then mutates `arr`. Pass a copy (`[...arr]`) when the code also indexes that array (M9 gotcha 4).
8. Every `overhead:*` user-timing measure is cleared right after it is recorded; tests collect them with a `PerformanceObserver`, which still receives every entry.
