# Decisions

Every non-obvious choice, with a one-line reason. Seeded on 2026-10-11 from the verification run in `docs/verification/` (kept locally). Where this file and `overview.md` disagree, this file wins until the brief is updated.

## Decided by Parth (2026-10-11)

| # | Decision | Notes |
| - | -------- | ----- |
| O1 | **The OpenLayers overlay is drawn on top of the YouTube player.** Drawing over the video is the point of the project. The video overlay is deliberately light: a curated subset of objects and labels, readable on moving video. The dense data (Starlink, tracks, footprint, imagery, terrain) lives on the ground map. | Parth's call. Engineering consequences still apply. Player controls must stay usable, so the map target gets `pointer-events: none` and only DOM hit targets (`ol/Overlay`, `stopEvent: false`) take clicks. A channel can block embedding, so fall back to replay. |
| O2 | **The replay clip is recorded from the StarCam stream** with yt-dlp + ffmpeg, from the live edge or the DVR window, and kept locally in `recordings/` (gitignored). The first clip was recorded on 2026-10-11: a sunlit ISS pass crossing the Subaru StarCam frame from about 15:10 to 15:15 UTC. | Parth's call; download terms are not a blocker. Keep the on-screen credit "NAOJ & Asahi Shimbun". How the clip ships with a deploy (size limits per host) is an engineering question settled in M5/M9. |
| H1 | **Hosting: GitHub Pages, deployed from Actions, at `https://parthjain.ca/Overhead/`** (public repo `FalconXYX/Overhead`). Vite `base: "/Overhead/"` (GitHub Pages paths are case-sensitive and follow the repo name); every runtime URL goes through `import.meta.env.BASE_URL`; e2e serves `vite preview` under the same base. Production deploys from `main` only; there are no per-branch previews. | It matches Parth's other projects: `parthjain.ca` is his GitHub Pages user site (`FalconXYX.github.io`, CNAME `parthjain.ca`), so a project repo with Pages enabled appears at `parthjain.ca/<repo>`. Cloudflare Pages custom domains are whole hostnames and cannot serve a path under a domain hosted elsewhere. This replaces the Cloudflare Pages plan in M0 step 15. GitHub limits: git rejects files over 100 MB, a published site must stay under 1 GB, and bandwidth is soft-capped at 100 GB a month. |
| O4 | **Latest Node: 26.x (26.11.1, arm64).** Pin `.nvmrc` to `26`, set `engines.node` to `>=26`, use Node 26 in CI, and use `@types/node` 26. Node 26 becomes LTS on 2026-10-28. | Every pinned package accepts it: vitest `>=26.0.0`, vite and rolldown `>=22.12.0`. The machine was cleaned on 2026-10-11 down to a single Node 26.11.1 arm64; every Rosetta (x86_64) install was removed. |

## Open: needs Parth's call

| # | Decision | Recommended default | Why it is open |
| - | -------- | ------------------- | -------------- |
| O3 | Store-shape changes | **Approve the shape in [`implementation/README.md`](implementation/README.md#store).** | The brief says to ask before changing the store. Verification found missing state (footprint height, star pairs, data status per group, GOES availability, UI panels) and one duplicated field (`streamDelayMs`). |

## Tooling

- Biome 2.5.15 for lint and format. `noExplicitAny`, `noSkippedTests` and `noFocusedTests` are set to `error`, and CI runs `biome ci --error-on-warnings .`. Reason: typescript-eslint 8.x refuses to load with TypeScript 7, and Biome's recommended preset only warns on `any` and ignores `.skip`.
- `tsc -b` with four project references (app, worker, node, test), `lib` includes `ESNext.Disposable`, and there is no `baseUrl`. Reason: satellite.js types reference `Disposable`, TS 7 removed `baseUrl` (TS5102), and workers need the `WebWorker` lib instead of `DOM`.
- `vite.config.ts` sets `worker: { format: 'es' }`. Reason: Vite 8's default `iife` worker build fails as soon as anything imports `satellite.js`, because its WASM loader uses top-level await.
- Remove `@types/proj4` and add `@types/node` 26 (O4). Reason: proj4 2.22.0 ships its own types.
- Playwright uses only the `chromium` project, always headless. Run `npx playwright install chromium` because 1.64.0 needs chromium-1248. The `webServer` is `vite preview`, and `forbidOnly` is on in CI. Reason: this machine caches only chromium-1243, and the Vite dev server never exits, so CI must not run `npm run dev` as a step.
- Packages that call the old TypeScript JS API are banned: typescript-eslint, vite-plugin-checker and ts-morph. Reason: `typescript` 7.0.2 exports only its version and an unstable API.

## Time and astronomy

- Pass astronomy-engine a `Date`, or one `AstroTime` built per tick, never a number. Reason: a numeric time argument means days since J2000, not epoch ms.
- Recompute the sky (stars, planets, Sun, Moon) whenever sim time has moved ≥ 2 s in either direction since the last pass. Reason: a wall-clock 1 Hz timer leaves stars up to 600 s behind at 600×, about 138 px of error.
- Rotate stars with one `Rotation_EQJ_HOR` matrix per pass, inlined over a `Float64Array`. `HorizonFromVector` serves only as the test oracle. Reason: the hot path must not allocate.
- Refraction is `'normal'` for stars and planets. Satellites get `Refraction('normal', alt)` at every altitude, not only below 10°. Reason: a 10° cutoff makes a 0.09° jump and leaves satellites 1–3′ off the stars.
- Polaris fixture: az 0.592°, alt 20.151° with refraction (20.105° without), tolerance 0.01°. Reason: the brief's 0.59°/20.15° is correct but under-specified.
- The planet fixture is a JPL Horizons OBSERVER table with `APPARENT=AIRLESS`, compared with `Horizon(..., undefined)` as great-circle separation < 0.05° on rows with el > 0. Reason: comparing refracted with airless values gives false failures near the horizon.
- `SearchAltitude(Body.Sun, obs, -1, start, 1, -6)` is civil dusk (end of evening civil twilight), and `+1` is civil dawn. It returns `AstroTime | null`. Reason: the brief's wording was ambiguous.

## Satellites

- Use OMM JSON only, and always request `FORMAT=json`. Reason: the CelesTrak default changed to CSV on 2026-05-09, and objects with 6-digit numbers (since 2026-07-11) have no TLEs.
- `fetch-gp` skips a group whose stored stamp is under 2 h old, stops on any non-200 (including 403 "not updated since your last download"), and runs every 6–8 h. Reason: CelesTrak blocks an IP after 50 errors in 2 h, and the source data changes only 2–3 times a day.
- Dedupe by `NORAD_CAT_ID` across groups. Collapse docked vehicles that share elements into one marker. Flag element sets more than 7 days old. Reason: stations and visual overlap.
- Type parsed files as `OMMJsonObject[]` from satellite.js, not a hand-written interface. Reason: a hand-written interface fails strict TS 7 (TS2345).
- Use the plain JS loop for every group. Compute sub-points with a closed form from ECF (spherical or Bowring), not `eciToGeodetic`. Reason: measured in a Chrome worker on an M2, Starlink (11,102) takes about 6 ms per tick this way and 24–45 ms with `eciToGeodetic`. `BulkPropagator` (about 4.8 ms) is barely faster.
- Worker tick budget: ≤ 4 ms for ISS + visual, ≤ 10 ms with Starlink. If a target laptop goes over, first cull Starlink (full pass at 1 Hz, 10 Hz only for objects above −10°), then try `BulkPropagator` with `createSingleThreadRuntime()`. Reason: the measured numbers make the brief's "switch at 4 ms" rule unreachable for Starlink either way.
- Never use `createMultiThreadRuntime`. Reason: it needs cross-origin isolation (COOP/COEP), which would break the third-party tiles and embeds.
- Propagate on a fixed sim-time grid, `t_k = k·D` with `D = 100 ms × rate`. The worker always computes one sample ahead, and buffers ping-pong between threads. `timeMs` travels as a plain number. Reason: interpolation needs the future sample, a transferred buffer is detached, and Float32 epoch ms lose about 23.5 s.
- Interpolate in Cartesian coordinates (ENU for the sky, ECEF for the ground), never in az/alt. Use linear up to 60× and Hermite with velocity at 600×. Reason: linear az/alt was 14–28° off at 600×, Hermite ENU 0.0017°.
- Visible means: sunlit (shadow fraction < 0.5), the Sun's geometric altitude ≤ −6° (−12° for Starlink), and apparent altitude above the terrain horizon (geometric horizon until terrain loads). Reason: most Starlinks flagged by the −6° rule are fainter than magnitude 7.6.

## Rendering

- Moving satellites are drawn as one `MultiPoint` per group and style class (lit or shadowed). Coordinates are written into its flat array in place, followed by one `geometry.changed()` per frame. The ground map uses `WebGLVector`; the sky view uses canvas. Reason: per-feature `setCoordinates` costs 13–46 ms per frame for 11k points on either renderer, while this path costs 1–4 ms.
- Picking is a nearest-neighbour search in pixel space over the worker's position arrays. The selected, hovered and ISS markers are separate `Point` features with labels. Reason: a `MultiPoint` is a single feature to OpenLayers' hit detection.
- Ground tracks go on a canvas `VectorLayer` (default `wrapX`) with unwrapped longitudes. Reason: `WebGLVector` does not draw geometry beyond ±180°, so tracks vanish over Hawaii.
- Maps follow a StrictMode-safe lifecycle. Each effect run builds a new map. Cleanup unsubscribes the bindings, disposes the layers, calls `map.setTarget(undefined)` and deletes the registry entry. Reason: React 19 runs effects mount → cleanup → mount in dev, `map.dispose()` does not dispose layers (WebGL contexts leak), and a disposed layer cannot be reused.
- React reads the store with primitive selectors or `useShallow`. One shared 4 Hz ticker feeds every time-varying readout. Reason: an object-returning selector throws React error #185 in zustand 5, and separate intervals would commit separately.

## Camera model

- At runtime, project with the closed forms for all five lenses, writing into reused typed arrays. proj4 serves only as the cross-check in tests. Reason: no per-frame allocation, and proj4 throws on non-finite input.
- The radial distortion tail (k1, k2) applies to every lens, with r measured in unit-focal projected coordinates. k1 and k2 are constrained so that `1 + 3k1r² + 5k2r⁴ > 0` out to the corner radius. Reason: it is one uniform code path, real all-sky lenses deviate from ideal, and the constraint keeps the inverse monotonic.
- Cull fisheye points with alt < 0 (or θ > θmax) before projecting. Reason: the orthographic model folds the hidden hemisphere back into the image.
- A zenith fisheye fixes az = 0 and alt = 90 and fits only roll. A tilted all-sky camera uses `lat_0 = alt0, lon_0 = az0`. Reason: az and roll are degenerate at the zenith.
- The inverse runs Newton to tolerance (≤ 10 iterations), returns null on failure, and returns `(A0, h0)` when r = 0. Reason: five fixed steps can diverge for strong k1.
- The synthetic sky in M2 uses an equidistant zenith fisheye with W = H and `f = (W/2)/(π/2)`. Reason: the brief defined f only for rectilinear lenses.
- Calibration acceptance: at least 10 named stars at alt ≥ 10° (≥ 20° for all-sky), RMS ≤ 0.25°, every star within 0.5°, plus one planet and 3 held-out stars within 0.5°. Reason: success criterion 1 and M4 used different metrics.

## GeoPose

- Export OGC GeoPose 1.0 Basic-YPR (21-056r11) and validate against the vendored `GeoPose.Basic.YPR.Schema.json` (sha256 `5508d26a…765640`), never fetched at runtime or in CI. Reason: CI stays offline.
- Convention: R = Rz(yaw)·Ry(pitch)·Rx(roll) from ENU. The body axes are x = optical axis, y = image-left, z = image-up. Export uses `yaw = wrap180(90 − az)`, `pitch = −alt`, `roll = wrap180(roll)`. A zenith fisheye exports `(90, −90, roll)`. Reason: this is Req. 13 plus OGC's reference `YPRAngles.ToQuaternion`, verified against the forward model to 1e-13.
- Round-trip tests compare rotation matrices or reprojected pixels, not raw angles. Reason: angles are ambiguous at pitch −90.
- `site.heightM` is height above mean sea level. A per-site `geoidSepM` gives the GeoPose `h = heightM + geoidSepM`. Reason: GeoPose h is ellipsoidal, the DEM and astronomy-engine use MSL, and the overlay effect is < 0.3 px.
- `import { Ajv } from "ajv"`, the default draft-07 class. Also check lat/lon ranges in code. Reason: the default import fails under `nodenext`, and the official schema has no ranges.

## Terrain

- Fetch Terrarium tiles directly in the browser. CORS was verified on 2026-10-11 (`Access-Control-Allow-Origin: *`). Reason: the brief's `fetch-terrain` fallback is not needed.
- Choose the tile zoom by distance: z14 within 1.5 km, z12 to 8 km, z10 to 30 km, z9 to 60 km, z8 beyond. Reason: about 45 tiles (5.5 MB) per site, against 181 tiles (20 MB) in the brief's plan, with negligible angular error.
- The march starts at 20 m with 10 m steps, growing to 1% of distance, and steps with the spherical destination formula. The horizon uses `z = max(z, 0)`. Reason: Terrarium ocean pixels are seabed depth, and stepping in EPSG:3857 metres distorts distance.
- Add `site.mastM` to `CameraConfig`. Reason: z₀ needs the mast height (Subaru StarCam: 13 m).
- Decode tiles with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` and a `willReadFrequently` 2D context. Reason: colour management corrupts packed elevations.
- The hillshade is `WebGLTile` over `ol/source/ImageTile` (not `XYZ`) with `maxZoom: 15`. Gradients are measured in tile pixels with a Mercator `cosLat` correction. Reason: `XYZ` fails the TS types (TS2740), z16+ returns 404, and the shaded-relief example's `['resolution']` is wrong at fractional zoom.
- The synthetic wall gets two tests: the pure formula gives 5.672 ± 0.001°, and the full march over a synthetic DEM gives 5.67 ± 0.05°. Reason: sampling makes an exact match flaky.

## GIBS imagery

- Build sources with `optionsFromCapabilities(caps, { layer, matrixSet, requestEncoding: 'KVP' })`. Reason: in REST mode GIBS lists 3 tile templates, 2 of them without `{Time}`, and OpenLayers spreads tiles across all three.
- Delete `TileMatrixSetLimits` from GOES layers before calling `optionsFromCapabilities`. Reason: GIBS limits are irregular and OpenLayers keeps only the first range per level.
- Ship a trimmed capabilities snapshot (`scripts/fetch-gibs-caps.ts` writes `public/data/gibs-capabilities.xml`), parse it at startup, and poll the per-layer DescribeDomains document for freshness. Reason: the full document is 5.84 MB raw (207 KB gzipped), takes about 200 ms to parse on the main thread (DOMParser), and the snapshot doubles as the e2e fixture.
- The GOES step is the latest available step ≤ floor10(t) from the domain intervals. The newest step must be confirmed by a HEAD request, and a 404 falls back one step. Reason: latency is 20–40 min with flapping, and gaps return 404.
- True colour comes from `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (alternate `VIIRS_NOAA21_…`), dated to the latest local-midday pass that is at least 4 h old. Reason: "the clock's UTC date" is often not yet processed, or is night at the site.
- The overlays are `Coastlines` and `Reference_Labels` on `GoogleMapsCompatible_Level9`, credited to OpenStreetMap and Natural Earth. Reason: the `_15m` variants misrender in EPSG:3857, and OSM's ODbL requires credit.
- A demo clip must be less than 90 days old for the GOES overlay to match. Reason: GIBS keeps geostationary imagery for a rolling 90 days.

## Ground map

- Footprint height presets are 420 km (ISS) and 480 km (Starlink); the default is the selected satellite's current height. Use one spherical model: R = 6371.0088 km and O = (R + h)·û. Drop rays that hit the Earth first. Reason: SpaceX lowered the 550 km shell to about 480 km in 2026, and mixing WGS-84 with a spherical R shifts the hit about 13 km.
- The "incoming" chip forward-propagates candidates from t+5 to t+60 s in 5 s steps and runs each sample through the camera model. Reason: the fixed-height footprint caught only 24 of 59 real entries.
- The camera wedge shows the azimuth range the frame actually covers (from the inverse-projected boundary), or a full circle when the zenith is in frame. Reason: HFOV is not the azimuth span of a tilted camera.

## Live clock

- Live YouTube time is `Date.now() − streamDelayMs`, with stalls tracked through the player's state and `getCurrentTime()` deltas. Rate is fixed at 1, and any play/pause/scrub/step switches to replay. Reason: YouTube latency grows with every rebuffer and never catches up.
- `streamDelayMs` lives only in `Calibration`, read through `selectStreamDelayMs`. The Subaru default is 50,000 ms, and the slider covers 0–120 s with ±10 s fine control. Reason: the default embed plays 45–57 s behind real time, and 23 s even at the live head.
- `getMediaReferenceTime()` is an optional, feature-detected aid only. Reason: it is undocumented.
- A still-image camera's live time is the capture time of the image on screen. A local video is its own master clock. Replay without video advances by `min(wallDelta, 250 ms) × rate`. Reason: background tabs pause rAF, and the first delta after returning would be huge.

## Data sources

- Subaru-Asahi StarCam:
  - YouTube ID `Kj5DjRYkzD8` as of 2026-10-11, resolved from `https://astroasahi.github.io/maunakea_east/` (CORS `*`).
  - Pointing az 81.2°, alt 19.6° (arXiv 2508.00245 Table 2.3).
  - Site 19.82552°, −155.47587°, mast 13 m.
  - Credit "NAOJ & Asahi Shimbun"; non-commercial use only.
  - Reason: the brief's 90°/20° defaults were guesses, and the naoj.org redirect is JavaScript-only with no CORS.
- CFHT-Asahi StarCam: ID `Q3UhCgsWDw8`, resolved from `https://astroasahi.github.io/maunakea_west/`. Reason: `qh6Nqiq6LIg` ended on 2025-09-25.
- CFHT Nānā ao:
  - Use `last_vis.png` and `last_ir.png`, polled no more than once a minute, and treat 404 as "hatch closed".
  - Licence: © CFHT, GFDL 1.3+.
  - Leave `crossOrigin` unset (no CORS), so there is no pixel access.
  - Reason: `last.png` is a 3-panel mosaic, and the images are served without CORS headers.
- AllSkyKamera ASK053 (Walenstadt):
  - The image proxy serves a 1920×1440 JPEG with CORS `*`.
  - Capture time comes from the burned-in Europe/Vaduz timestamp (or manual entry), taken at mid-exposure; satellites are drawn as 60 s arcs.
  - Ground height is about 467 m.
  - Terms: ask the owner.
  - Reason: night exposures are 60 s, and the image file carries no time metadata.
- Stars:
  - Source: CDS V/50 `catalog.gz`, padded to 197 characters per line, skipping the 14 records with no position.
  - Proper names: joined from IAU-CSN by HR number and credited to IAU WGSN.
  - Size: 8,404 rows at V ≤ 6.5.
  - Reason: BSC5 itself has no proper names.

## Process

- The visual design (layout, colours, panel placement) is not fixed by the brief. It is settled during the build from screenshots. Reason: Parth asked that the brief's description of the look not be treated as ground truth.
- Performance claims are benchmarked in headless Chromium (Playwright), not Node. Reason: the app propagates in a browser worker, and Node timings do not transfer (one `collectIncoming` call with Starlink took 14.4–16.5 ms in Node 26.11.1 arm64, against 9.6 ms p95 in a Chromium worker; M8).

## Contract changes from the implementation docs

Appended on 2026-10-11 by the cross-document consistency pass over `implementation/`. Each line is a contract in [`implementation/README.md`](implementation/README.md) that a stage file worked out. Where a line refines an earlier line in this file, it says which; the later line wins. Lines marked "confirm" need Parth's yes ([README "Assumed until Parth confirms"](implementation/README.md#assumed-until-parth-confirms)).

### Store and process

- The O3 store shape includes `recenter(timeMs)` (M1), `cancelImagePoint()` (M4), `data.goes.status` with `setGoesStatus` (M7) and `ui.demo.paused` with `setDemoPaused` (M9), plus `setVideoLayer` (M5) for O1: 45 actions in all. Reason: `?t=` can lie beyond ± 12 h of now, Esc must cancel a pending calibration point, the DescribeDomains poll needs a load status (README Errors rule 5), and the tour needs a pause.
- `createActions` returns all 45 actions from M0; an action whose milestone has not landed throws `Error("actions.<name> lands in M<n>")`. Reason: the `Actions` type is complete from M0 (O3), and a silent no-op would hide wiring mistakes.
- `cameras.json` holds every known camera from M1; only `ENABLED_CAMERA_IDS` reach the store, and the milestone that enables an entry settles and edits it in place. Reason: the corrected Subaru facts are validated from M1, while earlier milestones still see one camera.

### Tooling and hosting

- `tsconfig.node.json` uses `module: "esnext"` and `moduleResolution: "bundler"` with its own `tsBuildInfoFile`. This replaces the `nodenext` sketch in `verification/tooling.md`. Reason: under `nodenext` a script that imports `src/domain` fails with TS2834, and `tsx` resolves extensionless imports.
- Biome adds `noNonNullAssertion` and `noConsole` (allowing `error` and `warn`; off in `scripts/` and `tests/`) as errors, and excludes `public/data` and `tests/fixtures`. Reason: `!` defeats `noUncheckedIndexedAccess`, stray logs reach production, and generated JSON is not Biome-formatted.
- `package.json` `allowScripts` denies the esbuild and fsevents install scripts. Reason: npm 11.19 skips unlisted install scripts with a warning, and both packages work without theirs.
- CI runs lint, typecheck, unit tests and the build, then installs Chromium 1248 and runs e2e, and uploads the Playwright report and traces. No `postinstall` downloads browsers. Reason: lint and type errors fail before the browser download, and Pages installs dependencies on every build.
- Hosting is GitHub Pages from Actions (H1): `deploy.yml` builds `main` with `npm ci` and `npm run build` (Node from `.nvmrc`, no secrets or variables) and publishes `dist/` at `https://parthjain.ca/Overhead/`, with `main` protected by the CI `check` job (the repository is public). This replaces the earlier Cloudflare Pages line. Reason: H1. Pages sends no COOP/COEP and no `referrer-policy`, so the YouTube embed gets its Referer, and it answers byte ranges (M0 step 15).
- `fetch-gp.yml` pushes its data commits straight to the protected `main`: a repository ruleset requires the CI `check` job and lets that workflow's push bypass it, proven on the first manual run (M3). Confirm; the alternatives are a pull-request-based data update or no required check. Reason: pushes made with `GITHUB_TOKEN` never start other workflows, so a data commit never gets the `check` run a required check waits for.

### Imagery, rendering and the clock

- The true-colour date is the UTC date of the latest 13:30 local-mean-solar-time pass (NOAA-20's afternoon pass) at least 4 h old; it flips at 03:51:52.5Z at Maunakea. Refines "latest local-midday pass". Reason: a noon rule flips 1.5 h earlier and requests imagery 2.5 h after the pass, inside the observed 2–3.5 h latency.
- A GIBS `Time` whose tiles failed is never selected again in the session: true colour reverts to the last `Time` that loaded a tile and remembers the failed one (M1); GOES removes the failed step from `data.goes.intervals` through `setGoesDomain` (M7). Refines "a 404 falls back one step". Reason: OpenLayers never re-requests an errored tile, so returning to that `Time` makes 0 requests and re-renders at 60 fps, and the GOES caption must name the step on screen.
- Map cleanup runs through `registerMap` (`src/map/registry.ts`): unsubscribe, dispose every layer, `map.dispose()`, then delete the registry entry if it still points at this map. Refines the Rendering line's `map.setTarget(undefined)`: `map.dispose()` calls `setTarget(null)` and also removes controls, interactions and the ResizeObserver. Reason: one tested cleanup order for both maps.
- `renderSyncAll()` runs only on frames where the sim time changed. Reason: OpenLayers renders on its own for interaction, tile loads and `changed()`; a per-frame `renderSync` redraws a paused map 60 times a second.
- Live time on a still-image camera is `frameTimeMs ?? Date.now()`. Live YouTube time is anchored at the first PLAYING with a finite `getCurrentTime()` > 0, and `streamDelayMs` is the latency at that anchor. Refines "Live clock". Reason: no image yet means the sky shows now; the real player reports 0, and once null, before it plays.
- Pixel coordinates are continuous: the image corners are (0, 0) and (W, H) and the centre is W/2. Reason: the orientation fixture assumes it, and calibration clicks must use the same convention.

### Satellite contracts

- Docked means: same group, near-identical elements (|Δn| ≤ 0.001 rev/day, |Δi| ≤ 0.05°, |ΔΩ| ≤ 0.05°, Δu ≤ 0.05°) and within 1 km at the later epoch and again 45 min later; the host is the lowest NORAD id. Refines "Collapse docked vehicles that share elements". Reason: CREW DRAGON 13 is docked but has its own element set (within 0.611 km of the ISS over 24 h).
- The worker rebuilds every requested ground track instead of caching tracks per satellite, and samples flush when the group mask changes. Reason: a full rebuild at the cap measured 1.2–1.3 ms; turning Starlink on changes which rows are valid.
- From M9 Starlink samples are always culled: one tenth of Starlink per sample plus every candidate within `4,150 km + 8 km/s × 12 × D`, other rows extrapolated along their held velocity. `BulkPropagator` ships only if it beats culling on a target laptop. Refines "If a target laptop goes over, first cull Starlink … then try BulkPropagator". Reason: M3 measured the plain loop at p95 about 18 ms paced at 10 Hz; culled it measured 2.1–2.6 ms at 1× to 60×, with 0 differences above −5°, while BulkPropagator was only about 10% faster than the plain loop.
- The incoming check has no "sunlit now" candidate filter: sunlit and above-horizon are tested at each future sample, with one Sun-cutoff gate per request. The worker gets the terrain profile through a `setHorizonProfile` message, named so it does not share a name with the store action `setHorizon`. Confirm the filter. Reason: satellites leaving Earth's shadow inside the frame are appearances; the snapshot gave 58/58 and 167/167 entries caught instead of 51/58 and 121/167.

### Camera-model contracts

- `distortionValid` requires g′(r) = 1 + 3k1r² + 5k2r⁴ ≥ 0.05 (`MIN_DISTORTION_SLOPE`) out to `rMaxUnit`. Refines "> 0". Reason: near g′ = 0 the inverse Newton needs more than the allowed 10 iterations; at 0.05 it converges in ≤ 8 for every lens.
- `FitOptions.fitTilt` frees a zenith-locked fisheye's axis, and the Calibration panel turns it on by default (held below 8 fit pairs); `normalizeCalibration` keeps `azDeg` 0 on a locked fisheye by folding it into roll. Refines "A zenith fisheye fixes az = 0 and alt = 90 and fits only roll". Reason: Nānā ao is tilted about 1.7°, and a locked fit failed the acceptance on one of two archived frames.

### Terrain contracts

- `horizonAltAtAzDeg` interpolates linearly between whole degrees. Reason: nearest-degree lookup disagreed with the drawn skyline by up to 0.74° at Walenstadt (35 px on the Subaru frame).
- `site.mastM` is 33 m for `synthetic-maunakea`, `cfht-nanaao` and `cfht-starcam` (all at the CFHT point) from M6, so DEM ground (4,170.9 m) + mast = their `heightM` 4,204 m. Confirm. Reason: with 0 the eye sits on a summit ridge and terrain covers up to +6.9° from az 61° to 216°.
- The hillshade's once-per-second limit applies to the Sun variables only; `texelGroundM` is pushed on `moveend` and whenever the tile zoom changes. Reason: a stale texel size halves or doubles slopes.

### Performance gates

- Perf runs use Chrome for Testing (`channel: "chromium"`) with the GPU at 1440 × 900, DPR 2. The main-thread gates are unthrottled ≥ 59 fps and frame p95 ≤ 6 ms, and at 4× CPU ≥ 55 fps and p95 ≤ 16 ms. React commits are counted on a `NODE_ENV=development` build. Confirm the 4× evidence. Reason: the headless shell renders WebGL on SwiftShader, a 4× frame cannot meet 6 ms (the 1× frame alone is 3.5–5 ms), CDP throttling leaves workers untouched, and the Profiler is inert in production builds.

## M0 · Scaffold

Appended on 2026-10-11 by M0 (`implementation/M0-scaffold.md` section 8). M0's contract lines are already under "Contract changes from the implementation docs". These lines belong under the Tooling, Live clock and Process headings above; they sit here because this file is append-only while other edits are in flight.

### Tooling

- e2e runs against `vite preview` of the last build; run `npm run build` first. Reason: CI must not run the dev server, and a missing `dist/` only shows up as a 30 s web-server timeout.

### Live clock

- The replay clock pauses when it reaches the ±12 h edge of the scrubber. Reason: a "playing" clock that cannot move is confusing.
- A frame updater that throws is removed and logged once with `console.error`; the clock keeps running. Reason: one bad updater must not freeze both views or log 60 errors a second.

### Process

- `ErrorBoundary` does not log in `componentDidCatch`. Reason: React 19.3 already logs each caught error once with `console.error`.

## M1 · Ground map

Appended on 2026-10-11 by M1 (`implementation/M1-ground-map.md` section 8). M1's contract lines (the 13:30 true-colour pass, never reselecting a failed `Time`, `renderSyncAll()` only when sim time changed, `registerMap` as the one map cleanup, `cameras.json` with `ENABLED_CAMERA_IDS`) are already under "Contract changes from the implementation docs".

### GIBS imagery

- True colour uses NOAA-20 only. NOAA-21 stays in the snapshot as the manual alternate; `TRUE_COLOR_LAYER` and `TRUE_COLOR_INSTRUMENT` change together. Reason: both were complete over Hawaii for 20 days; one layer keeps the e2e simple.
- The snapshot is the `LAYER`-filtered KVP capabilities, trimmed by regex to 5 layers and Level6/Level9. The script falls back to trimming the full document, refuses to write a snapshot that fails its checks, and the app never reads its Time values. Reason: 28.6 KB instead of 5.84 MB; Time values in a committed file are stale.
- GIBS sources set `crossOrigin: "anonymous"`. Reason: GIBS sends `access-control-allow-origin: *`; pixel reads stay possible.
- The Layers label keeps the requested true-colour date after a tile-error revert. Reason: showing the displayed date needs new state.

### Ground map

- The ground view starts at zoom 6 (min 2, max 12), centred on the site, and recentres on a camera change. Reason: Level9 overzooms acceptably to 12.
- The OpenLayers attribution control is off; the always-rendered Credits region is the only credit display; `ol/ol.css` is imported. Reason: one place that is always visible; working controls.
- `geoidSepM` is EGM96 from PROJ: 24.23 m at the CFHT point, 24.32 m Subaru, 47.08 m Walenstadt. `synthetic-walenstadt` uses `Europe/Zurich`. Reason: same method everywhere; Zurich and Vaduz agreed at every half hour from 2020 to 2030.

### Live clock

- Live mode on a synthetic camera recentres the scrubber with `jumpToNow()` once now leaves ± 12 h. Reason: long live sessions.
- The app starts live when the URL has no `t`. Reason: the default camera is synthetic, whose live time is `Date.now()`.
- The scrubber is a controlled range input, so `Timeline` re-renders in its own `onChange`. Reason: with only the 4 Hz re-render, React resets the thumb and keyboard steps on the slider are lost.
- "Frames where the sim time changed" compares the frame's sim time with the one the maps last rendered, not with the value at the start of the frame. Reason: a seek or step while paused then gets exactly one `renderSyncAll()` on the next frame, and a paused, untouched map still gets none.

### URL and keyboard

- `?t=` must end in `Z`; the URL carries raw colons and `t` only in replay; writes are debounced 250 ms and wrapped in `try/catch`. Reason: zone-less dates parse as local time; readable links; the WebKit limit.
- The key handler also skips `defaultPrevented` events, Alt/Ctrl/Meta chords and Space on buttons. The ground map container is focusable (`role="application"`, Biome suppression). Reason: OpenLayers keyboard pan and zoom; Cmd+[ is Back; Space must press the focused button.

### Testing

- e2e route mocks live in an auto fixture `routes` that depends on `guard`. Reason: M0's guard stays unedited, and the dependency orders the routes after the catch-all.
- e2e tile stubs are a real NOAA-20 tile and an empty Reference_Labels tile, chosen by `Format`. Reason: real decodable images, no OSM data committed.

## Revisions for O1, O2, O4 and H1

Appended on 2026-10-11 by the final consistency pass over `overview.md` and `implementation/`, after Parth decided O1, O2, O4 and H1. Each line is a contract in [`implementation/README.md`](implementation/README.md) or a stage file that the revisions settled. The stage files' section 8 lists no longer repeat these lines.

### Video overlay (O1)

- The overlay on a video draws a light set by default: the `satellites` layer's two groups (stations and visual, the ISS emphasised); labels only for the ISS, the selected or hovered object, the Sun, the Moon and the planets; stars to V ≤ 2 (`VIDEO_STAR_MAG_LIMIT`; V ≤ 4 while calibrating) as small marks named on hover; trails only for the selected object; the terrain skyline as a thin line. `layers.video` (`starlink`, `grid`, `denseLabels`) starts all false and gates only the sky view. Reason: O1 keeps the video readable (V ≤ 2 leaves 1–8 stars in the Subaru frame, V ≤ 3 leaves 7–22), while the ground map, the worker and the Inspector keep every object.
- Over a YouTube player the map target and the HoverCard overlay's container get `pointer-events: none`, and picking moves to `ol/Overlay` button hit targets (`stopEvent: false`, at least 24 × 24 CSS px). Reason: the player's controls stay usable, and OpenLayers sets `pointer-events: auto` on every overlay container.
- The player is created with `fs: 0`; a Fullscreen button puts the stage (player plus overlay) in fullscreen, and a `fullscreenchange` guard exits the player's own fullscreen. Reason: YouTube's fullscreen hides the overlay, and `fs: 0` leaves the `f` key working (measured); `disablekb: 1` would also remove the player's other keys.
- The player follows the stage with `setSize`, and the map with `fitSkyFrame`; both contain the 16:9 frame. Reason: the real player letterboxed into the same centred box as `view.fit` (rows 45–854 of a 1440 × 900 stage).

### Cameras and clips (O2)

- `subaru-starcam` defaults are the 2026-10-11 star fit: az 81.2322°, alt 19.6185°, roll 0.7698°, f 2525.93 px, k1 −0.00992, `rmsDeg` 0.0294. M1's published-centre values stay provisional until M5, and fixtures that name "the Subaru defaults" keep az 81.2°, alt 19.6°, roll 0, f 2742 inline. Reason: with the published centre and f 2742 the ISS marker was up to 3.0° off on the clip (a scale error no time shift removes), and existing fixture numbers must not move.
- Both StarCams' `termsNote` is "Non-commercial use only". M5 sets it in place over M1's provisional string, and a clip camera shows its source camera's note. Reason: `readme.test.ts` compares exact strings, and the note is true of a recording too.
- A clip is `recordings/<clip>.mp4` plus `recordings/<clip>.json`, a `ClipSidecar` (README section 6). The contract fields are required; other keys (provenance) are allowed and ignored; `calibration` is in the source camera's W × H pixels; `startUtcMs` comes from the burned-in clock when the camera shows one, else from the first segment's PROGRAM-DATE-TIME, with `startUncertaintyS` covering the cross-checks. Reason: the clip plays as its source camera, the camera clock is the capture time (PROGRAM-DATE-TIME was 0.144 s earlier on 2026-10-11), and provenance must not break parsing.
- `record-clip.ts` cuts a clip from the HLS DVR playlist by segment (PROGRAM-DATE-TIME), keeps the concatenation as `<clip>-dvr.ts`, remuxes with `-map 0:v -c copy -movflags +faststart`, and copies `public/data/gp/` (all three groups and `meta.json`) into `<clip>.gp/`. Reason: yt-dlp's section download cannot cut a live DVR window, Chromium cannot play MPEG-TS, and a clip must replay with the elements of its day.
- `find-passes.ts` runs `frameSpans` over each pass's [riseMs − 60 s, setMs + 60 s]. Reason: `findPasses` works in geometric altitude and `frameSpans` in apparent altitude; refraction kept the ISS up 10 s after its geometric set on 2026-10-11, which the bare window cut off.
- The M5 acceptance is `check-clip-pass.ts`, run by hand against `npm run dev`: the drawn marker at the 94 media seconds of the committed ISS track, compared by angle through the sidecar's star fit, every sample ≤ 1.0°. `--gp <dir>` routes both `data/gp/` and `recordings/<clip>.gp/` to `<dir>`; without it nothing is routed. Reason: it is repeatable and covers the whole visible pass, an angle is right across the gnomonic frame where a pixel threshold is not, and M9 runs the same tool against production's own element sets.
- `satelliteCheckSummary` takes `hiddenMs`, the stretches where the object is known to be hidden (from the sidecar's `pass.visibleMediaS`); only the uncovered part of a gap counts against the 2,500 ms rule. Reason: the domes hide the ISS for 10.0 s and 14.5 s on the 2026-10-11 clip, so the plain rule always failed there.
- `bindHorizonWorker` recomputes a camera's profile when the active camera keeps its id but its site changes (`latDeg`, `lonDeg` or `mastM`). Reason: `local-replay` takes the site of whichever clip loads, and its cached profile would belong to the previous site.

### Deploy (H1)

- The deployed 2026-10-11 clip is a two-pass x264 copy (390 kbit/s, 1920 × 1080, 23,515,809 bytes) published as an asset of the release `clips-2026-10-11` on `FalconXYX/Overhead`, and copied into `dist/recordings/` by `npm run build:pages` in `deploy.yml`, which checks size and sha256; its element sets go to `dist/recordings/<clip>.gp/`. Reason: recordings never enter git (O2); a sixth of the 148.6 MB master's bandwidth per play against GitHub Pages' soft 100 GB a month; the app's own origin keeps the canvas readable without CORS.
- A sidecar-URL clip whose server answers a `Range: bytes=0-1` probe with 200 is read into a Blob; 206 streams from the URL. Reason: Chromium cannot seek a video served without ranges (Playwright's `route.fulfill`), and GitHub Pages answers 206.
- From M9 a clip replays with its own element sets: the worker loads `recordings/<clip>.gp/` while that clip camera is active and the directory exists, and restarts when the source changes. Reason: `public/data/gp/` moves every 6 h; on this pass the ISS ran 0.08–0.88 s behind with sets 20–40 h old, and 2.9 s (about 1.5°) with a 3.7-day-old ephemeris; the worker's catalogue only appends.
- e2e runs under the H1 base: `baseURL` `http://localhost:4173/Overhead/`, and specs navigate base-relative (`./`, `./?t=…`), never `/…`. Reason: Playwright resolves `goto("/…")` against the origin, and under `base: "/Overhead/"` only `/` and `/?…` reach the app (through a 302).
- `deploy.yml` runs on `push` to `main` and `workflow_dispatch`, never `workflow_call`; `fetch-gp.yml` dispatches it after a data push (`gh workflow run deploy.yml --ref main`, `actions: write`). Reason: pushes made with `GITHUB_TOKEN` start no workflow, and a called workflow builds the caller's commit, which is the one before the data push.

## M1 · Review fixes

Appended on 2026-10-11 by the M1 review pass. These lines belong under "M1 · Ground map" above. They sit here because this file is append-only while other edits are in flight.

### GIBS imagery

- `Reference_Labels` is requested over REST, across both of its snapshot templates; every time-enabled layer stays on KVP. `gibsWmtsOptions` gains a fifth parameter, `encoding: "KVP" | "REST" = "KVP"`, after `dropLimits`. `OVERLAY_ENCODING` in `gibs.ts` picks the encoding per overlay (`Coastlines` stays KVP). A REST call throws when the layer has no tile template or has a Time dimension. Reason: GIBS answers every KVP `GetTile` for `Reference_Labels` with the same 155 B transparent tile, without `layer-identifier-*` headers, so no place label ever drew. REST serves the labels: "Maui" is in tile 6/28/4 (1,729 B, CORS `*`). The REST templates drop only `{Time}`, which this layer does not have. This corrects M1 step 2 ("the Reference_Labels tile over Hawaii at z5 is empty") and step 10 (KVP for every GIBS source).
- `tests/fixtures/gibs/tile.png` stays. It is GIBS's generic transparent KVP answer (sha256 `1cd99521…`), not a real empty label tile. The e2e `routes` fixture also serves it for `…/best/Reference_Labels/default[/default]/GoogleMapsCompatible_Level9/{z}/{row}/{col}.png`. This corrects the M1 Testing line "an empty Reference_Labels tile".
- `selectTrueColorDate` takes the date from `min(clock.simTimeMs, Date.now())`. The map binding, the Layers label and the Credits imagery line all read this selector. Reason: when the sim time is ahead of the real clock (the scrubber's right end, or playing at 600×), the 4 h rule picks a pass that has not happened yet. GIBS serves that date as 200 black tiles with no `layer-time-actual` header, so the tile-error revert never fires. The selector reads the real clock only when the state changes, which is every frame in live or while playing. A paused sim time ahead of now therefore keeps an older date, which has imagery, until the next change. This corrects M1 section 1 ("the 4 h rule in step 3 avoids black tiles") and the README selector block.
- After a tile-error revert, the Credits line "Imagery: NOAA-20 / VIIRS, <date>" also shows the requested date. Reason: the same as for the Layers label: showing the displayed date needs new state.

### Timeline and keyboard

- The "Simulation time" slider handles its keys in its own `onKeyDown`, from the store's clock, and calls `preventDefault()`:
  - ArrowLeft/Right/Up/Down step ± 1 s.
  - PageUp/PageDown step ± 8,640 s (Chromium's native step, a tenth of the range).
  - Home/End seek to ± 12 h from `rangeCenterMs`.
  - `onChange` (pointer drags and set values) stays an absolute `seek`.

  Reason: the native steps start from the thumb's DOM value. That value lags the clock by up to one 4 Hz render and drops the sub-second part of the offset, so one ArrowRight could add 0–2 s, or move the clock back by up to 150 s at 600×. Acceptance criterion 6 requires exactly 1 s.
- `handleKeyDown` also returns false when the target is inside a focused keyboard-pannable map, matched with `closest('[role="application"]')` (`MAP_SELECTOR` in `keyboard.ts`). This adds a fifth rule to README Keyboard. Reason: OpenLayers `KeyboardPan` prevents only unmodified arrows, so Shift+arrows, Space, `[`, `]` and `L` reached the window handler from the focused map. Criterion 6 says the keys do nothing on the focused map. README Accessibility rule 5 gives `role="application"` to every map that takes keyboard pan and zoom.
- `[` at 1× and `]` at 600× do nothing: no `setRate` call with the unchanged rate. Reason: `setRate` switches to replay, so `[` in Live silently left Live.
- A `?t=` value must also read back as written: `toISOString()` must start with `t` minus its `Z`. Reason: `Date.parse` rolls day overflow forward (`2026-02-30` becomes `2026-03-02`, and `T24:00` becomes the next day). A bad link is rejected, never guessed.

### Files and tests

- `tests/helpers/random.ts` exports `mulberry32(seed)`, and every seeded test (seed 20261011) imports it. Reason: one generator for M1, M2 and M4. README section 3 should list `random.ts [M1] mulberry32(seed)` under `tests/helpers/`, and section 6 should add it to the exports table.
- `src/ui/gibsStatus.ts` [M1] exports `gibsStatusText(gibs)`, which `GroundView` and `LayerToggles` share. Reason: a component file that also exports a plain function is not a React Fast Refresh boundary. README section 3 should list the file under `src/ui/`.
- `tests/unit/gibs.test.ts` checks `gibsWmtsOptions` and `createOverlayLayers` against a hand-built parse of the committed snapshot. Reason: Vitest's Node environment has no `DOMParser`.
- After M1, 28 placeholder actions remain (45 actions in all). M1 step 4.4 and the section 5 `store.test.ts` row still say 27 and 44.

## M2 · Synthetic sky

Appended on 2026-10-11 by M2 (`implementation/M2-synthetic-sky.md` section 8, then the integration pass). The continuous pixel convention is already under "Contract changes from the implementation docs". These lines belong under the Time and astronomy, Rendering, Camera model and Data sources headings above. They sit here because this file is append-only while other edits are in flight.

### Time and astronomy

- The twilight reference is Skyfield 1.55 + DE421 (to the second). USNO's API (to the minute) is a cross-check only. Reason: USNO rounding would use half of the ± 60 s tolerance.
- The Horizons fixture is one JSON file keyed by `BODY_IDS`, with rows `[isoUtc, azDeg, elDeg]`, 73 per body, and the test needs at least 30 above-horizon rows per body. `fetch-horizons-fixture.ts` also fails when a body returns anything other than 73 rows or the API answer has an `error` key. Reason: an empty or truncated table must not pass vacuously.
- `formatUtcHhMm` truncates to the minute (as M7 also specifies), and the marker's local time is `formatZonedDateTime(...).slice(11, 16)`, which truncates too. Reason: the UTC and local labels on a marker must agree.
- `twilightMarkersMs` restarts each search 1 h after a hit. Reason: same-direction crossings are about 24 h apart, and a restart at the hit itself can find it again.
- `skyCache.bodies` starts as NaN. Reason: zeros would read as eight bodies on the horizon at az 0 before the first pass.
- Sky passes are measured as `overhead:sky` and cleared at once; tests count them with a `PerformanceObserver`. Reason: user-timing entries would otherwise accumulate at 60 per second.

### Star catalogue

- `stars.json` rows are sorted by `vmag`, then HR. Reason: a magnitude limit is then a prefix, and `rotateStarsAzAltDeg`'s `count` skips the rest (904 of 8,404 at the default limit).
- Star names come from the IAU-CSN ASCII column, then the Bayer designation (Greek letter, index digit, constellation), then Flamsteed, else `""` shown as "HR n". Reason: BSC5 has no proper names, and ASCII avoids encoding issues (only 15 rows differ, none with an HR number).
- The star magnitude limit runs from 1 to 6.5 in steps of 0.5. `setStarMagLimit` clamps and ignores non-finite values, and returns the same state when the clamped value is unchanged. Reason: 6.5 is the catalogue's cut, and subscribers must not fire for a no-op (as `setLayer`).
- `build-stars.ts` warns and still writes when an input's size or sha256 differs from the recorded values. It throws on a duplicate HR in either input, an unknown Bayer abbreviation, a malformed field or a misaligned IAU-CSN row. Its summary line adds the Bayer and Flamsteed counts and both sha256s after the expected text, and an optional `--out <path>` sets the output. Reason: a new upstream file should be inspected rather than block the run, while a parse error must never produce a quietly wrong catalogue.

### Sky view

- Stars are drawn as one `MultiPoint` with a custom `Style.renderer` reading per-star visibility and radius from typed arrays. Reason: magnitude bins cost 5–8 ms per render at 8,404 stars, against 0.7–0.9 ms.
- The synthetic sky view has no interactions or controls and refits on resize. Its `View` sets `maxResolution` to max(W, H). Reason: the frame must match the camera image (M4 calibration, and from M5 the video under the map, O1), and OpenLayers' default cap of max(W, H)/256 stops the frame from fitting a container shorter than 256 px. M4 adds pan and zoom for still images.
- Culled stars are written at the frame centre with `visible` 0, never off-frame. When `setCameraModel` changes the frame size, it also calls `setStarCount`, which parks every point at the frame corner (0, 0), hidden, until the pass that the same call forces. Reason: OpenLayers drops off-extent `MultiPoint` coordinates before the custom renderer runs, which shifts the per-star arrays, and old-frame coordinates can lie outside a new, smaller frame.
- `createCameraModel` throws for anything other than a zenith equidistant fisheye until M4. Reason: M2 has no other camera; a silent fallback would hide a wrong `cameras.json`.
- The grid has altitude circles 0–80° every 10° and azimuth lines every 10° from alt 0° to 80°, sampled every 1° through the camera model. Letters N, E, S and W sit at alt 5°. Reason: the code is lens-independent, and the letters stay inside the frame.
- The sky region carries an "Above the horizon" text list as its text alternative, and is `aria-busy` until the star catalogue is `ready` or `error`. Reason: canvas content is invisible to screen readers; the list and the busy flag double as e2e hooks.
- The list's name comes from an `h3` through `aria-labelledby`. The "No Sun, Moon or planets above the horizon" fallback is a `<p>` after the list. The `role="status"` element is always rendered and is empty while idle or ready. Reason: the fallback is not a body, and a live region must exist before its text changes to be announced.
- The new Moon's marker is hollow rather than a different colour. Each body feature's id is its `BODY_IDS` string. Reason: the de-emphasis must not rely on colour (README Accessibility), and M3's picking can map a feature straight to an `ObjectId`.

### Timeline and Layers panel

- A twilight marker's visible text is "Dusk" or "Dawn". Its full name, "Civil dusk 04:24 UTC (18:24 local)", is the `aria-label` and the `title`. Reason: on Chromium's default 129 px scrubber the two Maunakea markers are about 62 px apart, so the full labels would overlap. The accessible name contains the visible word, and e2e locates markers by `/Civil dusk/`.
- Before the catalogue is ready, the magnitude-limit text reads "V ≤ 4.5 (loading star catalogue)" or "V ≤ 4.5 (star catalogue failed to load)" instead of "(0 stars)". A count of 1 says "star". The same text is the slider's `aria-valuetext`. Reason: "0 stars" would misreport a catalogue that has not arrived.

### Files and tests

- `LensModel` and `Calibration` are defined in `src/domain/camera/lens.ts`, and `index.ts` re-exports them. The public import path and shapes are unchanged. Reason: `lens.ts` needs both types, and defining them in `index.ts` would create a `lens.ts` → `index.ts` → `lens.ts` cycle.
- Exports beyond the README section 6 table: `MAX_STAR_ROWS` (`skyCache.ts`, imported by `createSkyMap.ts` as the stars layer's capacity); `starRadiusPx` and `setStarRadii` (`layers/stars.ts`); `BodyId`, `bodyRadiusPx`, `BodiesLayer`, `createBodiesLayer` and `writeBodies` (`layers/bodies.ts`); the parse helpers of both scripts (`main` runs only when executed directly, as in `fetch-gibs-caps.ts`). README section 6 should list them. Reason: they are shared between the layer, the sky map and the tests.
- `projectBatch` leaves a culled pair's `outUvPx` entries untouched and writes only `outVisible[i] = 0`. Reason: the caller decides what a culled point holds (the sky map writes the frame centre, gotcha 20).
- `selectStarMagLimit` lands without its `[M5]` over-video branch; M5 adds that line with `selectSkyOverVideo`. Reason: selectors land with their first user.
- `sky.spec.ts` adds two cases to M2 section 5: the catalogue's loading and failure states (the grid and bodies still draw), and keyboard access to the sky toggles, the limit slider and the twilight markers (acceptance criterion 8). Reason: both are acceptance requirements that no other test covers.
- `src/app/cameras.ts` checks each field through a `Fields<T>` table (one Check per key of Calibration, CameraSite and Credit, and per source kind), so a field added to a type must be validated; the messages and their order are unchanged. Reason: the hand-written checks could miss a new field silently.
- After M2, 27 placeholder actions remain (45 actions in all).

## M3 · Satellites

Appended on 2026-10-11 by M3 (`implementation/M3-satellites.md` section 8, then the integration pass). M3's contract lines (the positional docking rule; tracks rebuilt per request, with a flush on a group-mask change) are already under "Contract changes from the implementation docs". These lines belong under the Satellites, Rendering, Tooling and Process headings above. They sit here because this file is append-only while other edits are in flight.

### Satellites

- Stale elements: |sim time − epoch| > 7 days, shown in the Inspector and hover card, still drawn. Before the epoch the Inspector reads "Elements X days ahead of this time". Reason: DECISIONS asks for a flag, not removal.
- Stations and visual are always propagated; Starlink only while its toggle is on. Reason: the Inspector stays live, and Starlink's tick is far costlier (p50 5.1 ms against 0.1 ms, measured below).
- Interpolation clamps to [t_a, t_b]; a late sample holds the newest position. `sunlitAt` and the per-frame Sun altitude take the earlier sample on a tie or a non-finite time; interpolation holds the earlier sample for a non-finite time or span. Reason: README section 5 forbids extrapolation; one rule, never NaN.
- `parseGpFile`'s guard is stricter than step 3 lists: the optional string fields must be strings, `REV_AT_EPOCH` a string or number, numeric strings must look like decimals, and NORAD id strings must be all digits. Errors name the record index, the NORAD id and the reason. Reason: a sound type guard for `OMMJsonObject`; the whole snapshot passes.
- `parseOmmEpochMs` accepts only `YYYY-MM-DDThh:mm:ss[.fff…][Z]` and returns NaN for impossible dates (`2026-02-30`) and hour 24; digits past the millisecond are truncated, as `json2satrec` does. Reason: `Date.parse` rolls overflow forward (the same rule as `?t=`, M1).
- If `meta.json` fails or has no entry for a group, the group still loads with `fetchedAtMs` null and one `console.warn`, not a `groupError`. The worker fetches `meta.json` once. Reason: a broken stamp file must not hide satellites.
- A failed propagation logs one `console.warn` per object per session, with the NORAD id and `satrec.error`. Reason: README Errors rule 3. Four station objects (66052, 67686, 67687, 67688) fail by 2027-01-01; none fails at the e2e instant.
- Sky-path replies are dropped only for an older `requestId` or a request sent before the last `init`/`setSite`; tracks only for an older `requestId`. Reason: ENU paths depend only on the observer, and dropping them on every flush (seek, rate, mask) would starve a paused view.
- `SampleClient.resize` to the same byte size keeps its 3 buffers and only flushes; a resize to a new size drops the held samples. Reason: same-size stale replies would otherwise push the pool past 3.
- A worker `error` event (the script itself failed) logs `console.error` and sets every group still `loading` to `error`. Starlink is requested once per session, after stations and visual, and again only when its toggle is turned on after a `groupError`; a site change does not resend it. A camera switch to a site with the same latitude, longitude and height sends no `setSite` and no flush. Reason: nothing loading would ever arrive; no retry loop (step 11); nothing moved.
- The worker posts with `postMessage(msg, { transfer })`. Reason: the options form also type-checks under the DOM lib, so Node unit tests import the worker with stubbed globals.
- The ISS fixture is generated with Skyfield 1.55 and sgp4 2.27 (numpy 2.5.4, jplephem 2.24, CPython 3.12.13), DE421 cached in `~/.cache/skyfield`. It is one line of compact JSON (angles to 1e-5°, range to 1e-4 km), 7,783 bytes rather than the doc's 7,769, and `passes[].maxAltDeg` is the highest altitude on the 10 s grid (28.84°, 12.67°, 44.83°), not the altitude at `culminationMs` (28.8597°, 12.6756°, 44.8445°). Reason: step 4 fixes the fields but not the layout; a rerun in the integration pass was byte-identical; no test reads `maxAltDeg`.
- `public/data/gp/` is seeded from the verification snapshot (sha256s as in M3 step 1). Reason: the first deploy needs data without an extra CelesTrak download.
- The e2e instant is 2026-10-11T15:09:50Z (ISS at az 123.8°, alt 28.9°, 795 km, sunlit, Sun at −16.2°). Reason: inside the fixture pass, visible to the eye, a deterministic list of 8 satellites.

### fetch-gp

- `fetch-gp.ts` sends `User-Agent: overhead-fetch-gp/1.0 (+<repo URL>)`, uses `redirect: "manual"` and a 60 s timeout, treats a non-OMM 200 as an error, rewrites a group file only when its sha256 changes, and always refreshes the stamp. Reason: CelesTrak counts 301s and asks for a contact; unchanged data should not churn files.
- The workflow commits after a stop too (`if: !cancelled()`). Reason: groups fetched before the stop are valid.
- "Rewrite only on a sha256 change" compares against the bytes on disk, not `meta.json`'s hash. The body is hashed and written as raw bytes (`arrayBuffer()`, so CelesTrak's trailing CRLF is kept), and group files and `meta.json` go through a temp file and a rename. Reason: a missing or edited file is repaired, and a crash never leaves half a file.
- `shouldFetch` counts a stamp up to 2 h in the future as fresh (clock skew); a stamp further ahead is treated as wrong and the group is fetched. Reason: a corrupt future stamp would otherwise block fetching forever.
- `meta.json` is validated before any request: an object, known groups only, finite `fetchedAtMs`, a non-negative integer `count`, a 64-character lowercase hex `sha256`. `GP_CONTACT_URL` must be an http(s) URL with no credentials, `@`, whitespace or parentheses. Reason: a corrupt stamp file fails before CelesTrak sees a request, and the User-Agent never carries a personal e-mail address.
- CLI exit codes: 0 when every group was fetched or skipped; 1 after a stop (`Stopped: <error>`) or a corrupt `meta.json`; 2 on bad arguments or a missing or invalid `GP_CONTACT_URL`. The CLI logic is `runCli(args, env, deps)`; the entry-point block only sets `process.exitCode`. Reason: unit tests drive it in-process behind `setup.ts`'s fetch block.
- `fetch-gp.yml` dispatches `deploy.yml` only when it runs on `refs/heads/main`; a manual run from another branch pushes its data there and deploys nothing. `deploy.yml` loses the `workflow_call` trigger M0 had added for M3. Reason: production deploys from `main` only, and the Deploy H1 line says "never `workflow_call`".
- The first manual `fetch-gp` run (M3 acceptance criterion 5) happens right after merge, not before: GitHub runs a `workflow_dispatch` only for a workflow file on the default branch. That run also proves the assumed ruleset bypass (gotcha 6); if the push is rejected, report it to Parth instead of weakening the protection.

### Store, URL and keyboard

- Esc also clears the selection inside a focused map (an exception to M1's focused-map rule); inputs, prevented events and modifier chords still ignore it. Reason: OpenLayers never reads Escape, and a click on the ground map both selects and focuses it.
- `select`, `hover`, `setFollow` and `setGroupData` return the same state for a no-op, and `setGroupData` ignores keys whose value is `undefined`. Reason: subscribers must not fire for a no-op (as `setLayer` and `setStarMagLimit`).
- `frameCount()` never resets, also across clock-loop restarts. Reason: the ephemeris's once-per-frame cache compares against it.
- After M3, 23 placeholder actions remain (45 actions in all). The M3 doc's deliverables row says 22; 27 − 4 = 23.

### Rendering and picking

- The sky draws satellites with apparent altitude > 0 (the horizon profile from M6); the ground map draws every valid object. Reason: the ground map is global.
- The ISS, selected and hovered objects are drawn only as canvas `Point`s with labels, never in the class `MultiPoint`s. Reason: WebGL lags a frame and cannot draw text.
- An empty WebGL class feature is removed from its source and re-added when it has points. Every class, trail and marker write compares before writing and fires no change when nothing moved; `writeClassPoints` returns whether it changed anything. Reason: gotcha 10, and a paused map must make 0 renders per idle second.
- Picking radius 6 CSS px (README section 9), nearest candidate wins; a click on empty space clears the selection; the ground map uses `singleclick`. Reason: double-click zoom must not deselect.
- Markers are redrawn inside `bindSelection`'s listener (`SkyMapHandle.setSelection` [M3], and the ground map's own listener), not only in the frame updater. Reason: while paused, a frame-updater change would render one frame too late (N + 2).
- The selected and hovered satellites are marked and pickable whatever their layer toggle; the ISS label follows `layers.satellites`. Reason: a selection from the URL, the list or the other view must stay visible.
- Trails cover the last 30 s of sim time for drawn stations/visual satellites plus the selected one (cap 100), from worker `skyPaths` on an absolute 2 s grid; the selected satellite gets a dotted 2-minute path; reduced motion hides trails. The dotted path is not a trail: it shows with Trails off and under reduced motion, and with Trails off sky paths are requested for the selected satellite only. Reason: only the worker owns satrecs, and future positions need propagation.
- Ground tracks for the other satellites follow `layers.satellites`; the selected track always shows. Track and sky-path requests share `RequestGate`: one empty request after a non-empty one so stale lines clear, then none while nothing is tracked, and a change within 100 ms of the last request waits. Reason: at most 10 requests per second (gotcha 23).
- Follow and "Show on map" centre on the world copy nearest the view centre; Follow skips frames while the view animates or is being dragged, and a drag turns Follow off only when it is on. "Show on map" is a local function in `Inspector.tsx`. Reason: the ground view is not wrapped; the two must not fight; it has one caller and no README API.
- The satellite list's "drawn" means valid, not docked, apparent alt > 0 with the satellites layer on, plus the selected satellite while above the horizon, read from the ephemeris flags rather than the sky projection. Reason: identical for M3's zenith fisheye; M4's partial-sky lenses may need the projection test.
- Placeholder looks until the design pass: lit satellites a filled circle, shadowed ones a square (canvas `RegularShape`, WebGL `shape-points` 4); the selected marker a solid ring with a bold label, the hovered one a dashed ring; trails thin grey lines, the next path dotted; the selected ground track wider with a halo. Reason: Accessibility, lit and shadowed differ in shape; the look is settled from screenshots.

### UI

- The Inspector sits in its own `ErrorBoundary`, not a `Pane`. Reason: a `Pane` would name a second region "Inspector" and break e2e strict mode.
- A `sat:` id missing from the catalogue shows "Loading orbital elements…" while stations or visual (or a requested Starlink) is still loading, and the "not in the loaded groups" text only after that. A selected docked vehicle shows its own name and NORAD id, "Docked to <host> (NORAD n), shown at its position", and the host's live fields. Reason: no false "missing" during load; the doc did not cover docked selections.
- The Satellites toggle's status sums stations and visual and shows the older fetch stamp. Each status is a `role="status"` span outside the label, tied to the checkbox by `aria-describedby`. Reason: one toggle covers two groups, and the checkbox names stay fixed.
- The text and details shared by the Inspector, HoverCard and LayerToggles live in `src/ui/objectText.ts` [M3]. Reason: a component file that also exports functions is not a Fast Refresh boundary (as `gibsStatus.ts`, M1).

### Files and tests

- Test hooks exist only when `navigator.webdriver` is true. `highlight()` reports the selected id only while its marker is drawn (in the frame, valid, and on the ground map a `sat:` id), so it reads null before `readyFrame`. `readyFrame` comes from the hooks' own frame updater (the first `updateEphemerisFrame(t).ready`), `selectionFrame` from a `store.subscribe` on `selectedId`. `OverheadTestHooks` has only its M3 members. Reason: e2e needs positions and draw frames without reading pixels; `ephemeris.ts` never imports the hooks.
- The e2e `routes` fixture serves same-origin `**/data/gp/*.json` from `tests/fixtures/gp/` and records any other file name as blocked. Checked: with `dist/data/gp/` removed, `selection.spec.ts` still passes. Reason: positions must not move when `fetch-gp.yml` commits new data.
- Exports beyond the README section 6 table, which should list them: `createTestHooks(sources)` → `{ hooks, dispose }`, `TestHookSources`, `SatPositionsView` (`testHooks.ts`); `CELESTRAK_GP_URL`, `FETCH_TIMEOUT_MS`, `DEFAULT_OUT_DIR`, `FetchLike`, `StoredGpMeta`, `FetchGpOptions`, `FetchGpResult`, `CliDeps`, `parseGpMeta`, `userAgentFor`, `runCli` (`fetch-gp.ts`); `SkyMapHandle.setSelection`; the layer modules' names (`sky/layers/satellites.ts`: `TRAIL_MS`, `CLASS_COUNT`, `litImage`, `shadowedImage`, `SatClass`, `SkySatellites`, `SkySatelliteIds`, `createSkySatellites`, `writeSkySatellites`, `trackedSkyIndices`, `LineWriter`, `appendPathPoints`, `writeTrails`, `SkySatelliteList`, `skySatelliteList`; `sky/layers/selection.ts`: `NEXT_PATH_MS`, `MarkerRole`, `MarkerShape`, `MarkerSlot`, `MarkerLayer`, `markerStyle`, `placeMarker`, `hideMarker`, `createMarkerLayer`, `SkySelection`, `createSkySelection`, `SelectionTargets`, `SkyPositions`, `writeSkySelection`, `writeNextPath`; `ground/layers/satellites.ts`: `satelliteWebglStyle`, `GroundClass`, `GroundSatellites`, `createGroundSatellites`, `writeGroundSatellites`, `writeGroundMarkers`; `ground/layers/tracks.ts`: `GroundTracks`, `createTracksLayer`, `writeTracks`; `bindTracks.ts`: `MIN_REQUEST_INTERVAL_MS`, `MAX_TRACKED`, `RequestGate`, `framedTrackIndices`, `TrackDeps`, `bindTracks(store, tracks, deps?)`; `bindFollow.ts`: `FollowDeps`, `bindFollow(store, map, deps?)`); and `objectText.ts` (`azText`, `altText`, `rangeText`, `litText`, `GROUP_LABELS`, `isStale`, `elementAgeText`, `visibilityText`, `dockedText`, `missingSatelliteText`, `satelliteGroupsPending`, `groupStatusText`, `objectDetails` and its view types, `starMagnitudeText`, `bodyMagnitudeText`). `ephemeris.ts` has every README name except `heightKmOf` and `Ephemeris.incoming`, which wait for M8. README section 3 should list `src/ui/objectText.ts [M3]` and `tests/helpers/satFrame.ts [M3]`. Reason: shared between the two maps, the panels and the tests.
- Unit-test files beyond the M3 section 5 table: `visibility`, `propagationWorker`, `ephemeris`, `classPoints`, `bindTracks`, `groundTracks`, `bindFollow`, `skySatellites`, `skySelection`, `groundSatellites`, `testHooks`, `objectText`. Reason: unit tests cover all of `src/domain` and the bindings (README section 8).
- Measured in the integration pass (`npm run perf`, Chromium 156.0.8078.4 headless shell, native arm64, launched from Node 26.11.1 arm64 on an Apple M2, 600 samples at 1× after 5 dropped): ISS + visual (175 objects) p50 0.10 ms, p95 0.20 ms, max 0.30 ms against the 4 ms budget; with Starlink (11,277 objects) p50 5.10 ms, p95 5.40 ms, max 10.0 ms, recorded and not gated. Reason: README section 9 and M3 acceptance criterion 4.
- `vite build` warns that `node:module` and `node:worker_threads` are externalized for satellite.js's WASM build; that code never reaches `dist/` (checked), so the warnings are harmless. The worker chunk is 31.45 KB (the doc says 28 KB) and the startup chunk 248.5 KB gzipped; OpenLayers' WebGL text worker (38 KB gzipped) is a separate on-demand chunk that M3 never loads. Reason: M9 owns the bundle budget.
- Correction to the two lines above, from the final gate run after them: a second `npm run perf` gave ISS + visual p50 0.10 ms, p95 0.20 ms, max 0.40 ms and with Starlink p50 5.10 ms, p95 5.60 ms, max 11.2 ms (it shared the machine with `sky.perf.ts`, load average 14), so the Starlink p95 is 5.4–5.6 ms over two runs. `vite build` itself reports the startup chunk as 251.1 kB gzipped (the 248.5 KB above is `gzip -c`); compare that figure with M2's 204 KB. Reason: the numbers in this file must match the evidence in the pull request.

## M4 · Camera model and still images

Appended on 2026-10-11 from section 8 of [`implementation/M4-camera-model.md`](implementation/M4-camera-model.md), then the lines settled while building M4.

- All five lenses use one oblique-azimuthal code path around (A₀, h₀); a zenith-locked fisheye is A₀ = 0, h₀ = 90 with exact trig. Reason: tilted all-sky cameras come free, and cos 90° ≠ 0 culled horizon points.
- Fisheye `rMaxUnit` = min(horizon radius, undistorted corner radius), with ∞ when the corner has no preimage. Reason: a circular fisheye's corners lie outside its image circle.
- `normalizeCalibration` keeps `azDeg` 0 on a locked fisheye, folding any azimuth into roll (`roll − az`). Reason: a stale azimuth made unlocking jump 353 px.
- The fit uses body-axis rotation increments, two stages (axis held, then free), a central-difference Jacobian with one-sided fallback, Marquardt scaling from λ 1e-3, and no frame cull in its cost. Reason: (az, alt, roll) is singular at the zenith, and rough starts failed otherwise.
- 3σ rejects one pair per round when its residual exceeds 3 × the RMS of the other pairs, up to 10 rounds. Reason: the overall-RMS rule cannot catch one outlier with ≤ 9 pairs; a median rule rejected good pairs.
- 3σ rejection never leaves fewer than 4 active pairs. Reason: rejection alone must never turn a fit into "fewer than 4 pairs".
- The stars layer uses `renderBuffer: 1_000_000`. Reason: with pan and zoom OpenLayers drops stars outside the buffered view before the custom renderer runs, which misaligns the per-star arrays (1–7 of 1,000 points reached the renderer at resolution 0.125 with the default, all 1,000 with this value).
- Acceptance: `minAltDeg` 20 for fisheyes and 10 for rectilinear lenses; "named" means a non-empty `stars.json` name; RMS and the per-star limit cover the non-rejected fit pairs. Reason: one shared function for the panel and the fixture test.
- `cfht-nanaao` is `fisheye-equidistant` with defaults from the two archived 2025 frames, `captureLagMs` 40,000 and `exposureSec` 0 until step 18 refits them. Reason: equidistant needed k1 0.003 against 0.054 for equisolid at the same RMS.
- Manual capture time: Nānā ao stamp + 30 s; ASK053 stamp + `exposureSec`/2, to be checked against a trail in M6. Reason: Nānā ao stamps to the minute; ASK053 exposes 60 s at night.
- Still-image status: a load gives "live"; an error gives "daytime" if the Sun is above 0° at the site by the wall clock, else "offline". Only the active camera is polled. Reason: Nānā ao runs sunset to sunrise and returns 404 while closed.
- The still image is frozen while the panel is open, opening the panel on a still camera switches to live, and pairs are cleared on a new image or camera. Reason: pairs belong to one frame and one time.
- The image cameras' sky view allows pan, and zoom from the fitted frame in to `minResolution` 0.125 (OpenLayers snaps it to 4–8 screen px per image px), with a new view per refit; pair clicks use `singleclick`. Reason: 0.25° is about 1.6 px on Nānā ao; double-click must still zoom; view limits are fixed at construction.
- The background layer and the `layer` parameters of `startStillImageRefresh` and `bindBackground` are `ImageLayer<ImageSource>`. Reason: M5 puts an `ImageCanvas` source on the same layer, which `ImageLayer<ImageStatic>` rejects (TS2739).
- The still-image loop builds each source in the active camera's pixel projection and, when stopped mid-request, puts the shown source back. Reason: a stale projection throws "No transform available", and an in-flight image would replace the frozen frame without `onLoad`.
- GeoPose export adds `"x-overhead"` (camera id, lens, convention, height datum); import applies angles only, from the rotation matrix, warning beyond 0.01° or 100 m. Reason: OGC's own examples use another convention (`verification/geopose.md` claim 3).
- `validateGeoPose` compiles on first call. Reason: ajv stays out of bundles that never validate (2.3 kB against 122.3 kB).
- Calibration files are `overhead.calibration` version 1; localStorage is written on every calibration change, and invalid stored entries are dropped. Reason: small data; no throttle needed.
- Exposure arcs: a worker `arc` message on a 5 s grid over the exposure, sunlit segments only, live mode only. Reason: 5 s chords stay within 0.1 px of the ISS path.
- The e2e CFHT and AllSkyKamera mocks serve `tile.jpg`; a test that expects console errors removes exactly those from the shared guard at its end. Reason: no new image fixture, and M0's guard stays unedited.
- Real-frame calibration acceptance runs on `tests/fixtures/calibration/subaru-clip-pairs.json` until a clear Nānā ao night: 350 star and Jupiter pairs at 3 epochs of the 2026-10-11 Subaru StarCam clip (rectilinear, 1920 × 1080, alt ≥ 10°, continuous pixel coordinates), rebuilt byte for byte by `scripts/fixtures/clip-pairs.ts`; holdouts ψ UMa, Chertan, λ Hya and Jupiter at every epoch. From the provisional defaults (scaled to 1920 px) the fit gives RMS 0.0245° (0.647 px), worst kept fit pair 0.071°, worst holdout 0.038°, Jupiter 0.009°, and the same result to 6e-12° from roll + 3° and f × 1.02; the 3σ rule rejects 10 frame-edge pairs (2.4–4.4 px, the same stars at every epoch). `cfht-nanaao-pairs.json` stays a TODO for step 18. Reason: Nānā ao's hatch has been closed at every check, and the clip is a real frame with a known time.
- Saturated stars and planets are measured as the centroid of the whole blob, not a 5 × 5 window. Reason: the window put Jupiter about 5 px off; the blob centroid is within about 0.3 px.
- The Subaru star fit's RMS is 0.0415° (0.915 px at 1920) per pair; the 0.0294° (0.65 px) in "Revisions for O1, O2, O4 and H1" divided by 2n, so it was per axis. The clip sidecar, the M1, M5 and M9 docs, `implementation/README.md` and the inline test copies now say 0.0415, and M5 writes `rmsDeg` 0.0415. Reason: the project defines `rmsDeg` per pair.
- This supersedes M2's "`createCameraModel` throws for anything other than a zenith equidistant fisheye until M4": every lens and pointing is now built. Reason: M4 step 1–6.
- `store.test.ts` expects 11 placeholder actions after M4, not the 10 its M4 row says: 12 of the 23 left after M3 landed, and the 11 left are M5's `setStreamDelayMs`, `setVideoLayer`, `setVideoStatus`, M6's `setHorizon`, M7's `setGoesDomain`, `setGoesStatus`, M8's `setFootprintHeightKm` and M9's four demo actions. Reason: the doc's arithmetic was off by one.
- Exposure arcs are requested only when `exposureArcGrid` gives at least 2 steps (`exposureSec` ≥ 5); shorter exposures keep their dots. Reason: one step has no segment, and arcs hide the dots.
- The arc is re-requested on a new `frameTimeMs`, a group load, a Starlink toggle and a site change; on a group load or Starlink toggle the old arc stays until the reply, otherwise it is dropped at once. Requests are also sent in replay, and only drawing is limited to live mode (`drawableExposureArc`). Reason: a reply covers only the rows that existed when asked, the first image usually arrives before any group loads, and switching back to live shows the arc at once.
- While arcs show, `writeSkySatellites` draws no dots and `writeTrails` no trails, and only the selected satellite's path is requested; picking uses the position at `frameTimeMs` (the arc midpoint), and the ISS, selected and hovered markers stay at the midpoint. The arc style (a dark line on a light casing, 2, 1.5 and 1 px for stations, visual and Starlink) is a placeholder until screenshots. Reason: one mark per satellite; the look is settled from screenshots.
- `src/domain/camera/schemas/` is excluded from Biome (`"!!src/domain/camera/schemas"`). Reason: formatting would change the vendored schema's bytes and its sha256 pin.
- Exports beyond the README section 6 table, which should list them: `ExposureArc`, `Ephemeris.arc` and `drawableExposureArc` (`ephemeris.ts`); `writeSkyArcs` and `SkySatellites.arcsShown` (`sky/layers/satellites.ts`); `NANAAO_CREDIT` and `NANAAO_TERMS_NOTE` (`credits.ts`). Reason: shared by the sky map and the tests.
- In live mode only the wall clock recentres the scrubber (`jumpToNow` when `Date.now()` is more than 12 h from `rangeCenterMs`); a live time beyond the range, such as a still image's burned-in stamp entered with the wrong date, is clamped to the range edge. Reason: recentring on now while following an image time a day away ran `jumpToNow` and a store write on every frame (found by the M4 check).
- The sky view adds `SkyMapHandle.fitFrame()`, `setPendingPoint()` and, for image cameras, a focusable `role="application"` map named "Sky map over the image from <name>" with a "Fit frame" button; selection on pan-and-zoom cameras also moves to `singleclick`. Exports beyond README section 6: `PAN_ZOOM_MIN_RESOLUTION`, `cameraPansAndZooms`, `fittedSkyResolution`, `createPanZoomSkyView`, `isFittedSkyView` (`createSkyMap.ts`); `calibrationClickAt`, `applyPairClick` (`sky/calibrationClick.ts`); `bindBodiesVisible`, `bindPendingPoint` (`sync/bindCalibrationView.ts`); `SITE_WEDGE_RADIUS_M` (100 km, a placeholder), `WEDGE_CIRCLE_VERTICES`, `WEDGE_ARC_STEP_DEG` (`ground/layers/site.ts`); `WEDGE_SAMPLES_PER_EDGE`, `cameraWedgeGeometry` (`sync/bindSite.ts`). Reason: a double-click zoom must not select, and the maps, panel and tests share these.
- The image-size notice is a plain paragraph, not a second `role="status"`. Reason: `sky.spec`'s strict `region.getByRole("status")` locator.

## M5 · Live video

Appended on 2026-10-11 from section 8 of [`implementation/M5-live-video.md`](implementation/M5-live-video.md) (the lines it says are already in "Revisions for O1, O2, O4 and H1" are not repeated), then the lines settled while building M5.

- Clip cameras load a ClipSidecar from `sidecarUrl` on activation; anything that is not JSON means "not part of this build" (camera status `offline`), and a successful load sets `live`. `local-replay` takes picked files and needs the sidecar. Reason: `vite preview` and `npm run dev` answer `index.html` (200) for a missing file and GitHub Pages answers 404, and either means the clip is absent; a clip without a clock-derived start has no time; the picker reads `camera.status`, as for stills.
- The ISS track on the 2026-10-11 clip is committed as a fixture (`tests/fixtures/video/subaru-2026-10-11-iss-track.json`, numbers only); the clip is not. Reason: the acceptance must be repeatable; recordings stay local. Re-measured on the clip: median 0.08 px, max 0.93 px over the 94 samples.
- A local clip plays in a detached, muted `<video>`, drawn by `ImageCanvas` (`ratio: 1`) after each frame callback and each `seeked`; the video is the master clock, and a change of `simTimeMs` that the loop did not write seeks the video. Reason: frame and overlay come from the same media time.
- With a clip the rates are 1× and 10× only (Live is `aria-disabled`: "A clip has no live mode."; `[` and `]` cycle the same rates). Clips are at most 12 h, and loading one calls `recenter(startUtcMs)`. Reason: `playbackRate` ≤ 16; the ±12 h scrubber.
- The Range-probe/Blob rule lands in M5 (`loadClipFromSidecarUrl`), not M9. Reason: Playwright's `route.fulfill` ignores Range, and the e2e clip must seek.
- The e2e test clip `tests/fixtures/video/test-pattern.webm` is generated by `scripts/fixtures/make-test-clip.ts` with ffmpeg (lavfi, libvpx-vp9, one thread, bitexact): 7,365 bytes, 320 × 180, 25 fps, 7.00 s, byte-identical over two runs. Reason: reproducible, unlike Playwright's video recording.
- Picked files on `local-replay` always import their sidecar's calibration. Reason: picked files are a new clip, possibly of another camera (step 10.4.7 imported only when none was stored).
- On loading a clip the video seeks to the store's time, clamped to the clip; a loaded clip camera activated again with the clock outside it recentres on its start; only the first clip loaded on a page, and only when `?cam=` names its camera, keeps `?t=`. An initial `?cam=` local-video camera starts in paused replay. Reason: a kept `?t=` and switching cameras keep a usable time.
- "Copy pointing" and the Satellite check sit in the Calibration panel and report through its single polite live region; for local-video cameras the one `data-testid="video-status"` element is rendered by ClipControls. The Satellite check's samples clear on a new selection, a camera change or a new clip. Reason: one live region (`calibration-export.spec`, the panel test); e2e test 20.
- `clip.ts` takes the base URL from its caller instead of reading `import.meta.env`, and `loadClipFromSidecarUrl` takes an optional 4th `options` argument (abort signal, keepTime, probe, base URL, object-URL functions, now). Reason: the node tsconfig compiles `clip.ts` for the scripts, and the loader is tested without a DOM.
- `check-clip-pass.ts` also accepts a Satellite check export (format `overhead.satcheck`) as a track. Reason: a check made in the app can be replayed by the tool.
- e2e test 17 turns off "Terrain horizon". Reason: M6's skyline crosses the test pattern's lower quadrants.
- Exports beyond README section 6: from `clip.ts` `LOCAL_REPLAY_ID`, `CLIP_RATES`, `offeredRates`, `clipHiddenMs`, `sidecarFileName`, `sidecarToSave`, `formatClipDuration`, `VideoProbe`, `cannotPlayText`, `checkVideoProbe`, `SatelliteCheckRow`, `SatelliteCheckExport`, `satelliteCheckFileName`, `CLIP_TEXT`, `LoadedClip`, `ClipLoadState`, `getClipLoadState`, `subscribeClipLoads`, `claimUrlTime`, `probeVideo`, `ClipLoadOptions`, `copyClipPointing`; `startLocalVideo`, `LocalVideoDeps`, `StartLocalVideo` (`bindBackground.ts`); `createVideoSource`, `onVideoFrames` (`background.ts`); `setSatelliteCheckClicks`, `satelliteCheckClickAt` (`calibrationClick.ts`); `ClipControls`, `ClipControlsView`, `clipStatusText`, `CopyClipPointing`, `SatelliteCheck`; and the scripts' helpers. Reason: shared by the panels and the tests.
- The UI shows the delay plus the stall as "behind real time now". A rebuffer of ≥ 1 s shows a "check the delay" prompt; the delay is never changed automatically; `getMediaReferenceTime` is only a suggestion with an "Apply suggestion" button. Reason: DECISIONS "Live clock".
- On error 100, 101 or 150, or on ENDED, the id is re-resolved once with `cache: "no-cache"` before giving up, falling back to the current id (not the registry's last known one); `mountYoutubePlayer` takes a 6th optional argument `{ mayReResolve, env }`, and App passes `mayReResolve: !restarted`. Errors 101, 150 and 153 set `embed-blocked` and `offline`, switch to replay, destroy the player, and offer "Watch on YouTube", the camera's recorded clips and "Replay a local clip". Reason: dead and nonexistent ids report 150, live ids change on restart, and a failed lookup must give up instead of looping between ids.
- ENDED with no new id keeps status "ended", sets the camera offline and switches to replay, with "The stream ended, and no new video id was found." and Retry; an IFrame API that fails to load, or an invalid id, gives status "error", offline, replay and "The YouTube player could not start." with Retry. Reason: `embed-blocked` would misreport an ended stream.
- The player is muted with `mute()` in `onReady` and autoplays at most once per player, when the stage is more than half visible. Reason: a hidden page does not start the stream, and a user's pause sticks.
- A burned-in clock reading gets +500 ms. Reason: the clock shows whole seconds.
- Star pairs are off for YouTube cameras; pointing comes from the defaults, alignment by eye against the video, or "Copy pointing" from a clip of the same camera. Reason: clicks on the video belong to the player.
- `cfht-starcam` defaults (az 270°, alt 20°, f 2742 px, the CFHT site, `mastM` 33) are guesses until aligned. Reason: no clip of that camera yet; record the aligned values.
- Activating a camera goes through `activateCamera(store, id)` (`src/app/activateCamera.ts`): a youtube camera does `jumpToNow` then `setMode("live")`; a local-video camera goes to replay, paused, at 1× if the rate was 60× or 600×. `setActiveCamera` also resets `video`. Reason: one rule for the picker, the video panel and clip loading.
- Hit targets (`createHitTargets(map, store, drawn?, makeTarget?)`) are made only inside the frame [0, W] × [0, H] and are updated at the end of `updateFrame` and `setSelection`, from the sky map's own drawn list (the same arrays and checks as `pick`). Reason: the letterbox bars hold the player's controls, and the targets must read this frame's positions.
- `selectSkyDenseLabels` has no consumer yet: outside the light set the sky draws no extra labels, so "All labels on the video" changes nothing until a layer draws more. Reason: M2/M3 label only the ISS, selected and hovered markers.
- The two Apply buttons are "Apply video clock" and "Apply suggestion", and the clock input is "Video clock (<time zone>)". Reason: distinct accessible names.
- Over a video the stage is `width: 100%`, `max-width: calc(60vh × W/H)`, aspect W:H, a layout placeholder until screenshots; its fullscreen note's `role="status"` exists only for video cameras. Reason: `sky.spec.ts` requires one status element in the sky region on other cameras.
- The `bindSite` wedge for the settled Subaru defaults is 37.47505°–125.17394° (the M5 doc rounds it to 37.48°–125.17°).
- Exports beyond README section 6: `activateCamera`; `HIT_TARGET_MIN_PX`, `HitTargets`, `createHitTargets`; `bindSkyLayerVisible`; `StreamDelaySection`, `streamDelayText.ts`, `videoPanelText.ts`; `setMediaClock`, `getMediaClock`, `rememberedSimTimeMs` (`clockLoop.ts`). Reason: shared by the panels, the maps and the tests.

## M6 · Terrain

Appended on 2026-10-11 from section 8 of [`implementation/M6-terrain.md`](implementation/M6-terrain.md), then the lines settled while building M6. Step 15 (`ask053-walenstadt`) is not done: it waits for written permission.

- `synthetic-walenstadt` is enabled with M1's entry unchanged; its provisional `heightM` 467.6 is confirmed by the Terrarium z14 ground (467.63 m). Reason: M1 commits every entry and the enabling milestone settles it.
- Behind-terrain objects are dimmed by the skyline fill drawn above them, not by per-object style classes; the selection layer stays on top. Reason: one layer covers stars, bodies and satellites with no per-frame work.
- The `horizon` toggle hides only the drawing; visibility and the Inspector flag always use a ready profile. Reason: hiding a layer must not change what counts as visible.
- Any failed tile fails the whole profile (status `error`, geometric horizon). Reason: a partial profile would invent gaps in real ridges.
- The worker drops decoded tiles after each compute; the HTTP cache serves repeats. Reason: 11 MB per site, and S3's 2017 `Last-Modified` gives long heuristic freshness.
- `imagerySources` stores dataset prefixes (`eudem`, `srtm`, …), and the Credits region always shows the full "Required attribution" block while terrain is in use (`terrainInUse`). Reason: hillshade tiles load through `<img>`, whose headers are not readable, so a per-view list would be incomplete.
- The hillshade is lit by the Sun at the active camera's site, from `computeBodies` (apparent altitude); below 0° it switches to 315°/45° (`NIGHT_SUN_AZ_DEG`, `NIGHT_SUN_ALT_DEG`) and shows the night badge. `bindHillshadeSun` also watches the active site. Reason: the map is centred on the site, the badge and the sky view agree, and the registry's arrival or a `local-replay` site change must relight the relief.
- The hillshade source uses `interpolate: false`. Reason: band offsets then land on whole texels; linear filtering of packed bytes gave gradient errors up to 0.14 on Apple Metal.
- The hillshade layer is drawn at opacity 0.5 until screenshots settle it. Reason: the verified opaque grey hides the true colour.
- Brave's canvas noise is not worked around. Reason: DECISIONS mandates the `createImageBitmap` decode; the canvas-free decoder is the fix if Brave matters.
- Terrain fixtures: Walenstadt's full plan (45 tiles, 5.58 MB), the Subaru StarCam's azimuth-0 ray (10 tiles, 1.15 MB) and `flat.png`. Reason: the full Walenstadt set drives the e2e skyline; one open-ocean ray is enough for Maunakea.
- Frame flag bit 2 ("above horizon") uses the terrain horizon, as `isVisible` does; the sky still draws objects at apparent alt > 0, and `VisibilityFacts` gains `altDeg`, so "behind terrain" means not above the horizon but above 0°. Reason: the Inspector's reason comes from the flag and the altitude, with no second lookup.
- The horizon worker clears its canvas before each draw, creates its context lazily (`willReadFrequently`), answers one compute at a time and uses `addEventListener`. The Inspector shows terrain lines only for an object with a live position. Reason: no stale pixels between tiles; a line without a position has nothing to compare.
- `cfht-nanaao` and `cfht-starcam` take `mastM` 33 like `synthetic-maunakea`; no measured mount height was recorded. Reason: the same summit ridge; to be replaced by a measured value.
- Exports beyond README section 6: `HorizonWorkerLike`, `bindSkyHorizon` (`sync/bindHorizon.ts`); `buildSkylineCoords`, `writeSkyline`, `SkylineCoords` (`sky/layers/horizon.ts`); `SkyMapHandle.horizonLayer`, `setHorizonProfile`; `NIGHT_SUN_*`, `HILLSHADE_SUN_INTERVAL_MS`; `terrainInUse`, `TERRAIN_CREDIT`; `behindTerrain`, `terrainLines`, `horizonStatusText` (`objectText.ts`). Reason: shared by the maps, the panels and the tests.

## M7 · Weather imagery

Appended on 2026-10-11 from section 8 of [`implementation/M7-weather-imagery.md`](implementation/M7-weather-imagery.md), then the lines settled while building M7.

- GOES `Time` is the latest step ≤ floor10(sim time) that DescribeDomains lists and that is ≤ the HEAD-confirmed newest step; a null newest step means no cap. Reason: the rule above; README leaves the null case open.
- DescribeDomains is fetched over `[floor10(now − 90 d), now floored to the minute]` once when the layer turns on and every 5 min while it stays on, never while it is off. Reason: about 1 KB per poll, and each URL misses GIBS's 30-minute origin cache.
- Merged availability keeps the largest end ever seen and is clipped 90 days before the newest listed step. Reason: replicas lag and flap, and the clip must not depend on the client clock.
- The probe is a HEAD on tile 0/0/0. A step is confirmed only by a 200 plus `layer-time-actual` equal to the step; otherwise the newest step falls back one listed step, without a second probe. Reason: tiles outside the Earth disk return 200 without the header.
- After 3 automatic fallbacks in a row, the 4th failure sets `data.goes.status = "error"` and hides the layer until the next successful poll; a successful poll does not reset the tile guard's failure count, so after an error clears one more tile failure sets it again (bounded: one more step per poll). Reason: it bounds the walk-back (48 requests when everything fails).
- The GOES layer is hidden until a step exists. Reason: the source starts on the snapshot's Default time.
- The GOES layer sits above true colour and hillshade and below coastlines and labels, at the brief's 60 % opacity (`GOES_OPACITY`, settled from screenshots). Reason: geography stays readable over cloud.
- The caption follows the step 3 table, with the UTC date first when the step falls on another day. Reason: gaps last up to 51 steps, so the step can be on another date.
- Timeline ticks are the listed steps inside the ±12 h range, capped at the confirmed newest step, from a segment's first step to its last with a 1 px minimum, and `aria-hidden`; the caption is the accessible equivalent. Reason: meaning by position, not colour.
- The e2e fixture is the DescribeDomains window 2026-10-07T12:00:00Z--2026-10-11T00:00:00Z. Reason: it contains two real gaps and the bare-date form of midnight.
- `setGoesDomain` and `setGoesStatus` return the same state for a no-op (same array and step; same status). Reason: as `setLayer` and `select`, subscribers never fire for a no-op.
- `tests/e2e/fixtures.ts` exports `recordGibsRequests(page)`, M1's wait-for-quiet rule over every GIBS request (HEAD and DescribeDomains included); `gibs-time.spec.ts` keeps its local copy. Reason: M7 counts HEAD and DescribeDomains too.
- `dataCredits` takes `goesIr`, and the Credits region shows "Imagery: GOES-West/ABI, Band 13 Clean Infrared" while the layer is on. Reason: the GIBS acknowledgement covers GOES; the instrument is named.

## M5–M7 · Review fixes

Appended on 2026-10-11 after the single integration check over M5, M6 and M7.

- `startLocalVideo` defers its store writes (the reset of `frameTimeMs` and pairs in `stop()`, and the pause when the Calibration panel opens) to a microtask. Reason: both run inside `bindBackground`'s listener, and a nested write handed later listeners (`bindPendingPoint`, the URL sync) the older state, so a cleared pending point was redrawn (README binding rule 4).
- The Fullscreen note renders inside the sky region's one `role="status"` element. Reason: as for M4's image-size notice, a second status element would break a strict `region.getByRole("status")` locator.
- `video.spec` test 3 checks "Nothing selected." in the Inspector instead of the URL. Reason: the URL write is debounced 250 ms, so the URL check could not fail.
- `video.spec` test 6 polls `document.fullscreenElement` for up to 1 s, and test 13 scrolls the stage back into view after each camera switch before waiting for "playing". Reason: `exitFullscreen()` is asynchronous, and the picker click scrolls the stage out of view, where the autoplay gate (step 5.5) rightly holds the player in "loading".

## M8 · Footprint and alerts

Appended on 2026-10-11 from section 8 of [`implementation/M8-footprint-alerts.md`](implementation/M8-footprint-alerts.md), then the lines settled while building M8.

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
- `footprint.ts` inverts refraction with a capped copy of astronomy-engine's `InverseRefraction` (50 iterations, same stopping rule). Reason: the original never returns for about 0.1 % of apparent altitudes in [−90°, −64°] and within 3e-5° of +90°, which would hang the page for a camera whose boundary reaches the zenith or looks steeply down.
- `setCamera` follows `init` (it arrives inside `loadGroup`'s store write), and nothing is sent before the registry loads; the worker resets its horizon profile on `init` and `setSite`. `bindFootprint` subscribes to the active camera entry, not only its id, and `footprintStatus` is written before the polygon (an empty polygon is not rewritten). Reason: `init` is the worker's first message; a clip replaces `local-replay`'s entry in place; listeners and the label see this ring's values.
- The chip's live region is visually hidden, keeps its last text while the list is empty, and changes only for a new first NORAD id (state adjusted during render); the chip hides entries in the same render when both satellite layers are off or playback is at 60×/600×. The "nothing to draw" `role="status"` line is always mounted. Reason: no stale entries for a frame; a status region must exist before its text changes.
- `Ephemeris.incoming` is a readonly getter returning the session's `IncomingClient.latest`, and `incomingClient.ts` takes its message types from `protocol.ts` (`Extract<…, { type: "incoming" }>`). Reason: one client per worker session; M3's protocol has landed.
- Exports beyond README section 6, which should list them: `src/ui/incomingText.ts` [M8] (`IncomingReplyView`, `IncomingCatalogView`, `IncomingRow`, `INCOMING_SHOWN`, `INCOMING_PAUSED_TEXT`, `incomingSeconds`, `incomingRows`, `incomingButtonText`, `incomingButtonName`, `incomingMoreText`, `incomingAnnouncement`, `inspectorIncomingText`, `IncomingAnnouncement`, `NO_ANNOUNCEMENT`, `nextAnnouncement`, `FOOTPRINT_*` texts, `selectedHeightOptionText`); `IncomingChipView`, `IncomingChipViewProps`; `FootprintLayer`, `footprintLabel`; `IncomingRequest`, `IncomingReply` (`incomingClient.ts`); `FOOTPRINT_PRESETS_KM`; `TestHookSources.footprint` and `.satellites`. Reason: shared by the panels, the map and the tests (a component file that exports functions is not a Fast Refresh boundary).
- The propagation worker chunk is 38.95 kB (17.9 kB gzipped) against M3's 31.45 KB, and `grep -c "must have required property"` prints 0. Reason: M8 step 5.6–5.7 and M4 acceptance 8.

## M5–M8 · Measured on 2026-10-11

Apple M2; Node 26.11.1 arm64; Chromium headless shell, arm64.

- M5 acceptance (`check-clip-pass.ts` against `npm run dev`, `--gp recordings/subaru-2026-10-11-iss.gp`): 94 samples, max 0.54° at 94 s, median 0.27°, along-track +0.87 s: pass (limit 1.0°). Report in `recordings/subaru-2026-10-11-iss.check.json`.
- `npm run perf`: incoming `computeMs` with Starlink p50 9.80 ms, p95 12.20 ms, max 13.00 ms (budget p95 ≤ 20 ms); propagation ISS + visual (175 objects) p50 0.10 ms, p95 0.20 ms, max 0.40 ms (budget 4 ms); with Starlink (11,277) p50 5.00 ms, p95 5.30 ms, max 7.20 ms (recorded, gated in M9); sky at V ≤ 6.5 and 600× p50 1.60 ms, p95 1.90 ms, max 3.80 ms (budget 2 ms).
- `vite build`: the startup chunk is 349.0 kB gzipped (M3: 251.1 kB); ajv (GeoPose export and import) and M5–M8 account for the growth. The propagation worker chunk is 38.95 kB, the horizon worker 4.41 kB. Reason: M9 owns the bundle budget.
- e2e uses `page.getByRole("region", { name: "Calibration" }).locator('p[aria-live="polite"]')` for the panel's live region. Reason: M8's incoming chip has its own polite live region, so the page now has two.
- (M8 check) When the incoming check throws, the worker posts an empty `incoming` reply after the `error`, and `IncomingClient` flushes when it turns inactive with a reply in flight. Reason: the client waits for each reply before the next request, so a lost reply froze alerts; a late reply could set `latest` while 60×/600× play paused the alerts.

## M9 · Polish and ship

Appended on 2026-10-11 from section 8 of [`implementation/M9-polish-ship.md`](implementation/M9-polish-ship.md), then the lines settled while building M9.

- Starlink is always culled in the worker (`writeCulledSample`): one tenth per sample plus candidates within `cullLimitKm`, the rest extrapolated; a full pass runs after a flush, a skipped k or `setSite` (`resetCullState`). Node: 0 mismatches above −5° in about 17,000 checks per step size (100, 1,000, 6,000 and 60,000 ms); extrapolation error max 0.39 km at 1 s and 13.89 km at 6 s. `writeCulledSample` takes an optional `onFailed`, keeping M3's warn-once rule, and the worker keeps a separate `sampleSkip` mask (docked or group off) while the incoming check keeps the docked-only one. Reason: DECISIONS "first cull Starlink".
- Starlink ground positions update at 30 Hz, interleaved by index parity, except the selected and hovered objects; the sky skips Starlink rows below −3° geometric (`SKY_CUTOFF_GEOMETRIC_DEG`, `belowSkyCutoff`), and rows below it in both samples are skipped entirely. Cut rows get NaN altitude and range (the doc said leave them). A change of the selected or hovered row recomputes a paused frame; an interleaved frame needs the previous frame on the same generation, and an "unchanged" frame after one runs in full. Reason: the 4× gate; every sky consumer tests `alt > 0`, so a stale altitude would be drawn.
- BulkPropagator is not shipped: `src/workers/bulk.ts` is bit-identical to `writeSample` on all 11,102 Starlink rows but is never imported, and `tests/perf/bulk.perf.ts` measures it. Reason: in Node, culling is about 2.6× cheaper than bulk at 60× (p50 1.62 ms against 4.29 ms; plain 5.90 ms).
- `validateGeoPose`, `buildGeoPoseExport` and `parseGeoPoseImport` are async: ajv loads with `import()` on the first validation and compiles then; a failed load gives `GEOPOSE_VALIDATOR_UNAVAILABLE`, and the next call retries. Reason: ajv (118.2 kB, 35.4 kB gzipped) leaves the startup chunk; a synchronous caller anywhere at startup would pull it back.
- `build.chunkSizeWarningLimit` is 860, just above the 852.2 kB entry chunk (261.4 kB gzipped, from 349.0 kB); all startup JS is 1,020.1 kB, 331.1 kB gzipped over 4 files (entry, `activateCamera` 143.9 kB, `jsx-runtime` 23.0 kB, runtime). The propagation worker is 40.58 kB with no ajv, BulkPropagator or WASM. Reason: OpenLayers, React and astronomy-engine are needed for first paint.
- `overhead:frame` is measured in the clock loop's `finally`, and `commits()` reads a counter fed by `<Profiler onRender={recordCommit}>`; `npm run build:dev` builds the profiling bundle into `dist-dev/` (gitignored, like `lighthouse/`). A static audit found no per-frame store subscription. Reason: the React commit audit (step 5) needs a development build.
- `propagation.perf.ts` gates Starlink at 1×, 60× and 600×, pressing Home on the scrubber before each faster rate. The perf bench worker (`tests/perf/bench/propagators.worker.ts`) is built by Vite at test time and served from a route, never from `dist/`. Perf traces are attached gzipped and without screenshots. Reason: 600× must stay inside ±12 h; GitHub's 25 MB file limit.
- The sky bodies layer gets a copy of the features array (gotcha 4). The step 1.5 baseline on `main` was not run: it needs a checkout, which is Parth's.
- Step 14f: while a `local-video` camera with a `sidecarUrl` and a `videoUrl` is active and `<clip>.gp/meta.json` answers OK with a JSON content type and a JSON object body, the worker loads its element sets from `recordings/<clip>.gp/` (`clipGpBaseUrl`). The probe runs once per clip per session, and until it answers the source is `data/gp/`. A change of source terminates the worker and starts a new one (new clients, `resetEphemeris`, then `init`, the groups, `setCamera` and the profile), and messages from the old worker are ignored; `startEphemeris(store, { fetch })` takes an optional fetch. Reason: a clip replays with the elements of its day, and the worker's catalogue only appends.
- Exports beyond README section 6: `CULL_*`, `CullState`, `createCullState`, `resetCullState`, `cullLimitKm`, `writeCulledSample` (`cull.ts`); `SKY_CUTOFF_GEOMETRIC_DEG`, `belowSkyCutoff` (`visibility.ts`); `recordCommit` (`testHooks.ts`); `GeoPoseValidation` (`geopose.ts`); `GEOPOSE_VALIDATOR_UNAVAILABLE` (`persist.ts`); `EphemerisOptions` (`ephemeris.ts`).
- The perf project runs with Playwright's trace off. Reason: its screencast and snapshots ran inside the measured window.
- sky.perf's M9 regression came from moving to Chrome for Testing (`channel: "chromium"`): p50 1.6 → 2.3 ms on the same code, independent of viewport and DPR. The pass now rejects directions more than 90° in altitude from the camera axis before any trigonometry (`ModelGeometry.axisAltDeg`, `preCullDeg`), computes star refraction below −1° as astronomy-engine's −1° value × (alt + 90)/89 (bit-identical, tested) without `tan`, and uses `Math.sqrt` for `Math.hypot`. p50 1.3–1.5 ms, p95 1.8 ms. Reason: the 2 ms budget on the new browser.
- Ground Starlink is two WebGL layers split by row parity (`starlinkLayer` is a `LayerGroup`, 8 classes), and only dots within twice the view's bounding circle are written (`GroundDrawWindow`, x wrapping; nothing culled when the area spans the world; picking unchanged). Reason: OpenLayers rebuilds a whole WebGL layer on any change, and at the default zoom almost every Starlink is off screen. At 4× CPU: 45.9 → 57.7 fps, frame p95 21.2 → 15.0–15.3 ms (on the pre-styling layout).
- `ecefToLatLonDeg` computes sin θ and cos θ algebraically, within 1e-12° of the trigonometric form; the ephemeris frame keeps per-sample bitmaps (valid, below the sky cut-off) in 4 reusable slots; `framedTrackIndices` tests for Starlink first. Reason: the 4× frame budget.
- `starlink.perf.ts` requires both maps on screen at a real size (> 300 × 200, inside 1440 × 900) and DrawFrame events ≥ 0.9 × measured frames, and writes `drawFrames` and the map sizes to its JSON. Reason: a zero-height or overflowing map gave falsely good numbers (13 DrawFrame events in 10 s).
- The tour opens on the recorded clip `subaru-2026-10-11-iss`: step 1 seeks to media 60 s at 1×, and the video keeps the light overlay while the ground map shows the dense layers. It ends on the live `subaru-starcam` with the overlay on the player. A build without the clip runs the same steps on the computed sky. Reason: O1 and O2, while CI and local previews stay deterministic.
- The live step ends at once on `embed-blocked` or `error`, and after 15 s if the player is still not playing. Reason: the stream can be down or blocked, and the tour must not hang on it.
- The computed-sky anchor is the best ISS pass in the 48 h before `stations.fetchedAtMs`: ≥ 30°, Sun ≤ 0° preferred, minus 180 s (on the snapshot: 5 passes, culmination 67.24°, anchor 2026-10-10T15:53:58Z). Reason: deterministic in CI, imagery available, elements fresh.
- Lighthouse 13.5.0 runs through `npx`, by hand, on 3 URLs × 2 presets plus production; there is no axe dependency, and `a11y.spec` uses Playwright only. Reason: both are large and Lighthouse needs the network; neither is a test dependency (gotcha 13).
- OpenLayers control buttons are 24 × 24 CSS px (`src/app/a11y.css`), and the reduced-motion rules use `!important` with the lint rule suppressed. Reason: Lighthouse `target-size`; the rules must beat inline styles and `ol.css` transitions.
- `DemoContext` gains `sky: DemoSky`, and `startDemoRunner(store, anchorMs, sky?)` and `loadDemoAnchorMs(baseUrl, site, fetchFn?)` take optional arguments. Reason: step 2 reads the ISS altitude and the highest sunlit satellite from the frame on screen, and Node tests have no worker; README §8 rule 3 for fetch.
- Tour camera switches go through `activateCamera`, only when another camera is active, and the live step also calls `jumpToNow`. Reason: a bare `setActiveCamera` left a live-booted page in Live on the clip camera, and re-activating the active camera reset `video` to idle.
- `DEMO_STEP_COUNT` (10) lives in `types.ts`, and `demo.test` checks it against the steps. `setDemoStep` truncates to whole steps and ignores non-finite values; all four tour actions return the same state for a no-op. With them every action has landed, `notYet` is gone, and `store.test` checks that none of the 45 throws. Reason: `actions.ts` cannot import the lazy `demo.ts`.
- `DemoCaptions` is lazy-loaded and shown only while the tour runs, at the top of `<main>`; the intro counts as loading while the clip camera's video status is still idle; its status line is plain text, so the Tour region has one live region; the OGC step shows "Validating the pose…" until the asynchronous validation returns. Reason: no flash of an enabled "Start the tour"; one live region; GeoPose validation is a lazy chunk (M9 step 7).
- The key list (`KEY_MAP`, `KeyboardShortcuts`, a table named "Keyboard shortcuts") describes each key in plain words, not action calls. Reason: it is for people.
- `a11y.spec`'s focus walks start at each panel's toggle button. Reason: a walk from the top hit the 120-stop cap before the Calibration fields.
- A `?demo=` value other than 1 or 0 logs a `console.warn`, and the URL carries `&demo=1` while the tour runs; "Copy link" in the Timeline copies `shareUrl` and says "Link copied", with a fallback field. Reason: as M1 and M3 treat bad parameters; a shared link reopens the same state.
- Exports beyond README section 6: `DemoSky`, `demoClip`, `demoIntroState`, `demoStepNumber`, `demoContext`, `chooseDemoPass`, `goesWindowNote` (`demo.ts`); `GeoPoseResultView`; `KeyMapRow`, `KEY_MAP` (`keyboard.ts`); `shareUrl` (`url.ts`). Reason: shared by the captions, the README key table and the tests.
- `tests/perf/screens.perf.ts` saves 4 viewports (1440 × 900, 1280 × 800, 820 × 1180, 390 × 844) × 12 states, full page with `animations: "disabled"`, as `test-results/screens/<viewport>/<NN-state>.png`; state 7 saves the intro and step 1, so a set is 52 images, and every state passes the e2e guard. States 4 and 8 fix `Date` at 2026-10-11T08:00:00Z as their e2e specs do; state 8 scrolls the stage into view and outlines the invisible hit targets in dashed magenta; state 10 removes exactly its 500 console error. Reason: deterministic review images, and the hit targets' placement must be reviewable.
- `scripts/contact-sheet.ts --ffmpeg <path>` tiles each viewport's set into `test-results/screens/contact-sheet-<viewport>.png` (720 px cells padded to the tallest image, labelled with drawtext, 4 per row). Reason: one sheet per viewport for the pull request, with no new dependency.
- `DEPLOY_CLIP_FILES` holds the copy made on 2026-10-11 by the step 14a commands: the MP4 is 23,515,809 bytes, sha256 `5c0ac96b3e9bbb749a8b70fa3ccea911670046bbcdaa55e05ab147134c6d100c`, byte-identical to the doc's; the sidecar is 6,846 bytes, sha256 `9c0cc7bf4be47012781fd54590eda1f646275a6c5f9305b62320cceca61d3eeb`, not the doc's `ada14ce5…`. Reason: the sidecar changed after the doc measured it (the `rmsDeg` correction); gotcha 22.
- `copyClipGp` checks every group file against `meta.json` before it writes any, and `fetchDeployClip` cancels a non-200 body before it throws; `main` runs under the repository's `pathToFileURL(process.argv[1])` guard. Reason: a failed check writes nothing; the doc's `file://` string fails for paths that need escaping.
- `deploy.yml` runs `npm run build:pages` (`npm run build && tsx scripts/fetch-deploy-clips.ts`). The release `clips-2026-10-11` must exist before the first deploy from `main`, or the run fails with HTTP 404 and production keeps its last deploy. Reason: recordings never enter git (O2); Parth publishes the release himself.
- The README gives the Subaru star fit as 0.0415° rms per pair; its M0–M8 sections keep their bullets and numbers, and their commands move under "Development". Reason: DECISIONS M4 defines `rmsDeg` per pair; step 13's order.
- `readme.test.ts` also checks credit links and licences, both GIBS instrument lines, every enabled camera id, the production, tour and screenshot links, and the diagram's 16 nodes and 19 edges. Reason: a link or licence is part of the credit, and step 13 fixes the diagram.
- (M9 check) `RequestGate.reset()` forgets the last request, and the ground-track and sky-path updaters call it on every frame that is not ready. Reason: a 14f worker restart clears the tracks and paths already received, while the gate refused the same request again, so on `?cam=subaru-2026-10-11-iss&sel=sat:25544` the ISS track and next path stayed missing until sim time moved (up to 20 s at 1×).
- (M9 check) The tour's sensor caption says "73 stars fixed the pointing to 0.04°" (and the M9 doc's caption table with it). Reason: `rmsDeg` is 0.0415 per pair (M4).
- (M9 check) `demo.spec`'s element-set test matches requests by `/[/.]gp\//`. Reason: the clip's directory is `<clip>.gp/`, which `/gp/` never matched.

### Visual design

- Layout: split view. The sky view and the ground map sit side by side and fill the screen; the timeline is a bar along the bottom; Camera, Layers, Inspector and Calibration sit in a right sidebar; credits are one compact line that expands, always visible; below 900 px everything stacks. Reason: Parth's choice on 2026-10-11 from the first screenshot set, which had no styling at all.
- Theme: dark night-sky, near-black with muted blue-grey panels and one amber accent for the ISS, selection and focus; video and imagery stay the brightest things on screen. Reason: Parth's choice on 2026-10-11.
- Split view from 900 px: sky and ground side by side filling the screen, the timeline bar across the full width at the bottom, a right sidebar of 300–360 px; `#root` and the satellite list are `minmax(0, 1fr)` grids. Reason: both views visible at once; an unbounded grid column let the one-line credits widen the page to 8,930 px.
- Column ratio sky:ground is 5:6, or 3:2 when the camera is a video. Reason: the square fisheye is height-bound, a 16:9 video needs width, and the ground map stays ≥ 512 px at 1280.
- Sidebar order: Layers, the video panel, Camera with Calibration (scrolling on its own), and the Inspector pinned below them (at most 64 %). Reason: the panel L opens is in view, and a selection is always visible.
- Below 900 px a single column in DOM order (header, tour, sky, ground, timeline, sidebar), with the credits sticky at the bottom. Reason: reading order equals focus order.
- "Above the horizon" and the satellite buttons sit in a strip under the stage, capped at 22vh and scrolling, always in the DOM. Reason: they are the keyboard path to objects, and the sky keeps most of the pane.
- The incoming chip sits in a fixed-height header as one line that never wraps; the Tour captions head the right column (the top of the page below 900 px); Keyboard shortcuts is a header popover; LayerToggles moved from the Ground map pane to the sidebar, in its own error boundary. Reason: none of them cover the stage (O1), and a ticking chip that wrapped moved the layout under Playwright's clicks.
- Credits: one line with the camera credit first and never clipped; "Show all credits" (`aria-expanded`) or a keyboard-focused link expands it; below 900 px only the camera credit shows until expanded. Reason: visible at all times, compact, and it passes Lighthouse target-size.
- Palette as CSS custom properties (`src/app/theme.css`): page #07090d, panels #0e131b and #151c27, text #e6ebf2 and #a2afc1 (≥ 7.6:1 on panels), one amber accent #f5a623/#ffb547 for the ISS, the selection, pressed toggles, open disclosures and focus. Type: system UI stack, 13 px body, 11 px uppercase section labels, tabular and monospace time readouts. Focus: a 2 px amber outline at 2 px offset, inset inside scrollers and maps. Reason: a dense tool with no font download; one accent keeps meaning clear.
- State is shown in shape as well as colour: pressed toggles get a hollow or filled dot, the chosen camera a left bar, open disclosures a flipped chevron. Sliders get a neutral track and an amber thumb. Reason: never colour alone; a filled amber track outshone the imagery.
- Sky marks: light marks with dark outlines (lit satellites circles, shadowed ones dim squares with a light edge), light labels on dark halos, a faint blue-grey grid, a muted earth-tone skyline; the ISS is an amber mark of the same shape, the selection a solid amber ring, hover a dashed light ring, the next path amber dots. The computed fisheye sits on a navy disc, a CSS radial gradient (closest-side) matching the inscribed horizon circle. Reason: a dark background with shapes unchanged, and no extra canvas layer.
- Ground marks: satellites match the sky's; the selected track is amber on a dark casing, other tracks light; the site is a dark dot in a light ring; the wedge and footprint are light, never amber. Reason: amber means only the ISS and the selection.
- The YouTube stage width is rounded down to a multiple of 16 px. Reason: OpenLayers sizes the map from rounded `offsetWidth`, so a fractional stage put the overlay 1.22 image px off under fullscreen (video.spec test 5).
- `screens.perf.ts` states 4 and 8 use `page.clock.install` instead of `setFixedTime`, and `video.spec` test 13 runs at 820 × 720. Reason: a frozen `Date.now` keeps OpenLayers' tile fade-in transparent (the blank ground map in the first set); in the split view the stage never leaves the viewport, so the autoplay gate needs the stacked layout to be tested.

## M9 · Measured on the final layout, 2026-10-11

Apple M2; Node 26.11.1 arm64; Chromium 156.0.8078.4 (Chrome for Testing), headless; ANGLE Metal. Raw outputs were kept outside the repository.

- `npm run perf -- sky starlink`: sky at V ≤ 6.5 and 600× p50 1.60 ms, p95 2.00 ms, max 2.10 ms (budget p95 ≤ 2 ms: passes with no margin); Starlink at 60×, CPU 1×: 59.7 fps, frame p50 2.6 ms, p95 3.3 ms, 0 frames over 20 ms, propagate p95 1.8 ms; CPU 4×: 58.1 fps, frame p50 11.0 ms, p95 14.3 ms (gate 16 ms), 2 frames over 20 ms, propagate p95 2.3 ms; maps 496 × 587 (sky) and 597 × 695 (ground) at 1440 × 900, DrawFrame 599 and 582.
- `npm run perf -- propagation incoming bulk`: propagation ISS + visual p95 0.40 ms (budget 4 ms); with Starlink p95 3.00 / 2.90 / 6.00 ms at 1× / 60× / 600× (budget 10 ms); incoming `computeMs` with Starlink p50 13.10 ms, p95 14.90 ms (budget 20 ms); bench at 1× / 60× / 600×: plain p95 14.1 / 13.7 / 13.0 ms, culled 3.0 / 3.4 / 6.5 ms, bulk 8.9 / 8.8 / 7.9 ms, bulk bit-identical over 530,447 checks. Outcome: bulk is not shipped.
- `npm run build:dev && PERF_OUTDIR=dist-dev npm run perf -- commits`: 40 React commits in 10 s while playing at 60× with no input (gate 31–41).
- `vite build`: entry chunk 855.16 kB (262.34 kB gzipped), propagation worker 40.75 kB with no ajv. Lint, typecheck, 1,514 unit tests and 74 e2e pass.
- `docs/overview.png` (1440 × 900, 1.38 MB) is tour step 1 on the recorded clip at media 1:35.4 (15:10:05Z), captured headless from `npm run dev` at 1440 × 900 and DPR 2 with the tour paused, then scaled to 1440 px wide. Reason: step 1 starts at media 60 s and the ISS enters the frame at about 79 s, so the overlay is on the ISS only from then on.
