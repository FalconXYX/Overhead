# Decisions

Every non-obvious choice, with a one-line reason. Seeded on 2026-10-11 from the verification run in [`docs/verification/`](verification/README.md). Where this file and `overview.md` disagree, this file wins until the brief is updated.

## Decided by Parth (2026-10-11)

| # | Decision | Notes |
| - | -------- | ----- |
| O1 | **The OpenLayers overlay is drawn on top of the YouTube player.** Drawing over the video is the point of the project. The video overlay is deliberately light: a curated subset of objects and labels, readable on moving video. The dense data (Starlink, tracks, footprint, imagery, terrain) lives on the ground map. | Parth's call, made knowingly: YouTube's Required Minimum Functionality ("Overlays and frames") is not followed. Engineering consequences still apply. Player controls must stay usable, so the map target gets `pointer-events: none` and only DOM hit targets (`ol/Overlay`, `stopEvent: false`) take clicks. A channel can block embedding, so fall back to replay. |
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
- Performance claims are benchmarked in headless Chromium (Playwright), not Node. Reason: Node under Rosetta ran propagation about 3× slower than Chrome.

## Contract changes from the implementation docs

Appended on 2026-10-11 by the cross-document consistency pass over `implementation/`. Each line is a contract in [`implementation/README.md`](implementation/README.md) that a stage file worked out. Where a line refines an earlier line in this file, it says which; the later line wins. Lines marked "confirm" need Parth's yes ([README "Assumed until Parth confirms"](implementation/README.md#assumed-until-parth-confirms)).

### Store and process

- The O3 store shape includes `recenter(timeMs)` (M1), `cancelImagePoint()` (M4), `data.goes.status` with `setGoesStatus` (M7) and `ui.demo.paused` with `setDemoPaused` (M9): 44 actions in all. Reason: `?t=` can lie beyond ± 12 h of now, Esc must cancel a pending calibration point, the DescribeDomains poll needs a load status (README Errors rule 5), and the tour needs a pause.
- `createActions` returns all 44 actions from M0; an action whose milestone has not landed throws `Error("actions.<name> lands in M<n>")`. Reason: the `Actions` type is complete from M0 (O3), and a silent no-op would hide wiring mistakes.
- `cameras.json` holds every known camera from M1; only `ENABLED_CAMERA_IDS` reach the store, and the milestone that enables an entry settles and edits it in place. Reason: the corrected Subaru facts are validated from M1, while earlier milestones still see one camera.

### Tooling and hosting

- `tsconfig.node.json` uses `module: "esnext"` and `moduleResolution: "bundler"` with its own `tsBuildInfoFile`. This replaces the `nodenext` sketch in `verification/tooling.md`. Reason: under `nodenext` a script that imports `src/domain` fails with TS2834, and `tsx` resolves extensionless imports.
- Biome adds `noNonNullAssertion` and `noConsole` (allowing `error` and `warn`; off in `scripts/` and `tests/`) as errors, and excludes `public/data` and `tests/fixtures`. Reason: `!` defeats `noUncheckedIndexedAccess`, stray logs reach production, and generated JSON is not Biome-formatted.
- `package.json` `allowScripts` denies the esbuild and fsevents install scripts. Reason: npm 11.19 skips unlisted install scripts with a warning, and both packages work without theirs.
- CI runs lint, typecheck, unit tests and the build, then installs Chromium 1248 and runs e2e, and uploads the Playwright report and traces. No `postinstall` downloads browsers. Reason: lint and type errors fail before the browser download, and Pages installs dependencies on every build.
- Hosting is Cloudflare Pages through its Git integration (build `npm run build`, output `dist`, Node from `.nvmrc`, no variables), with `main` protected by the CI `check` job. Confirm: it needs a Cloudflare account, and branch protection needs a public repository on GitHub Free. Fallback: GitHub Pages from Actions (no per-branch previews, `base: "/<repo>/"`). Reason: per-branch preview URLs without secrets, root-path serving, a Referer sent and no COOP/COEP.
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
