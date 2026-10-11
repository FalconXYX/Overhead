# Overhead

Overhead draws satellites, the ISS, the Moon, planets and bright stars onto live sky-camera video and images, linked to an OpenLayers ground map.

## Requirements

- Node 26, arm64. Run `nvm use` (it reads `.nvmrc`), then check that `node -p process.arch` prints `arm64`.
- `npm ci` to install the pinned dependencies.
- `npx playwright install chromium` once, for the end-to-end tests (Playwright 1.64 needs Chromium 1248).

## Scripts

| Script | What it does |
| ------ | ------------ |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b`, then `vite build` into `dist/` |
| `npm run preview` | serves the last build with `vite preview` |
| `npm run typecheck` | `tsc -b` over the four project references |
| `npm test` | Vitest unit tests (`tests/unit`) |
| `npm run e2e` | Playwright end-to-end tests (`tests/e2e`), headless Chromium against `vite preview`. It serves the last `npm run build`, so build first. |
| `npm run perf` | Playwright performance specs (`tests/perf`), run by hand, never in CI. Like `npm run e2e` it serves the last `npm run build`, so build first. `sky.perf.ts` prints the `overhead:sky` pass p95 at V ≤ 6.5 and 600× (budget ≤ 2 ms); `propagation.perf.ts` prints the propagation worker's time per sample, for ISS + visual (budget p95 ≤ 4 ms) and with Starlink (recorded only). |
| `npm run lint` | `biome ci --error-on-warnings .` |
| `npm run format` | `biome check --write .` |

## Deploy

GitHub Pages, deployed from GitHub Actions (public repository `FalconXYX/Overhead`). `.github/workflows/deploy.yml` builds with `npm run build` into `dist/`, using Node from `.nvmrc`, and publishes on every push to `main`. Vite's `base` is `/Overhead/` (Pages paths are case-sensitive and follow the repo name).

- Production: `https://parthjain.ca/Overhead/`. `parthjain.ca` is the `FalconXYX.github.io` user site, so project sites appear under it.
- No per-branch previews: CI checks every pull request, and `npm run build && npm run preview` shows a build locally at `http://localhost:4173/Overhead/`.
- Pages is enabled with Source: **GitHub Actions** (done 2026-10-11).

## Documentation

- [Implementation contracts](docs/implementation/README.md) and the per-milestone build steps
- [Decisions](docs/DECISIONS.md)
- The claim-by-claim verification records behind those decisions (`docs/verification/`) are kept locally and are not published.

## Milestones

- [ ] M0 · Scaffold
- [ ] M1 · Ground map
- [ ] M2 · Synthetic sky
- [ ] M3 · Satellites
- [ ] M4 · Camera model and still images
- [ ] M5 · Live video
- [ ] M6 · Terrain
- [ ] M7 · Weather imagery
- [ ] M8 · Footprint and alerts
- [ ] M9 · Polish and ship

## M0 · Scaffold

- Every quality gate (lint, typecheck, unit tests, build, e2e) runs in CI on Node 26 against an empty app.
- The shell shows three placeholder panes (Sky view, Ground map, Timeline), each inside its own error boundary.
- The whole store is in place, with the replay clock loop and Play/Pause; every later action is a placeholder that throws.

## M1 · Ground map

- The ground map (EPSG:3857, OpenLayers) shows NASA GIBS daily true colour from NOAA-20 VIIRS (`VIIRS_NOAA20_CorrectedReflectance_TrueColor`), the GIBS `Coastlines` and `Reference_Labels` overlays, and a labelled marker at the active camera's site. The view starts at zoom 6 centred on the site. `Reference_Labels` is requested through its REST tile templates: GIBS answers every KVP `GetTile` for it with the same transparent tile. The time-enabled layers use KVP.
- The true-colour `Time` follows the clock: it is the UTC date of the latest 13:30 local-mean-solar-time pass (NOAA-20's afternoon pass) at the site that is at least 4 h old, counted from the sim time or the real clock, whichever is earlier (a pass that has not happened yet has only black tiles). At Maunakea it flips at 03:51:52.5Z. A `Time` whose tiles fail reverts to the last one that loaded and is never selected again in the session.
- The Timeline has Live, Play/Pause, rates 1×/10×/60×/600×, ±1 s and ±1 min steps, a ±12 h scrubber, Now, and UTC and camera-local readouts. The Layers panel toggles true colour and the overlays. Credits are on screen at all times.
- Keys: Space play/pause, ← → step 1 s (Shift: 1 min), `[` `]` previous/next rate, `L` Layers. They do nothing inside inputs or on the focused map (where the arrows pan), and Space presses a focused button.
- URL: `?t=2026-10-10T03:30:00Z` (UTC, must end in `Z`) opens paused replay at that time; without `t` the app starts live. `?cam=<id>` picks an enabled camera from `public/data/cameras.json`; only `synthetic-maunakea` is enabled in M1, and any other id falls back to it.

The capabilities snapshot `public/data/gibs-capabilities.xml` is trimmed from live GIBS by a script, run by hand only when a layer id or matrix set changes (CI never reaches GIBS):

```sh
npx tsx scripts/fetch-gibs-caps.ts            # writes public/data/gibs-capabilities.xml
```

The e2e tile stubs were downloaded once: a real NOAA-20 tile, and the 155 B fully transparent PNG that GIBS returns for any KVP `Reference_Labels` request, which stands in for every overlay tile so no OSM data is committed:

```sh
mkdir -p tests/fixtures/gibs
B='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?style=default&tilematrixset=GoogleMapsCompatible_Level9&Service=WMTS&Request=GetTile&Version=1.0.0&TileMatrix=5&TileCol=2&TileRow=14'
curl -fo tests/fixtures/gibs/tile.jpg "$B&layer=VIIRS_NOAA20_CorrectedReflectance_TrueColor&Format=image%2Fjpeg&Time=2026-10-10"
curl -fo tests/fixtures/gibs/tile.png "$B&layer=Reference_Labels&Format=image%2Fpng"
```

## M2 · Synthetic sky

- The Sky view draws the sky over the active camera's site at the clock's sim time, as a zenith fisheye (equidistant, horizon on the frame edge) seen from below: north up, east left. It shows stars from the Bright Star Catalogue sized by magnitude, the Sun, Moon and planets (Mercury to Uranus) with labels, and an alt/az grid (altitude circles every 10°, azimuth lines every 10°) with N, E, S and W at 5° altitude. A new Moon (illuminated fraction below 0.02) is labelled "Moon (new)" with a hollow marker. The view always shows the whole frame and has no pan or zoom.
- The sky is recomputed whenever the sim time has moved ≥ 2 s either way since the last pass (every frame at 600×), and at once after a camera, calibration or star-limit change.
- Below the map, an "Above the horizon" list names each body above the horizon with its azimuth and altitude in whole degrees, for example "Saturn, az 120°, alt 58°". It is the view's text alternative. While the star catalogue loads the view says "Loading star catalogue". If it fails, it says "Star catalogue failed to load", and the grid, Sun, Moon and planets still draw.
- The Timeline shows a Dusk and a Dawn button for each civil twilight (Sun 6° below the horizon) inside the ±12 h scrubber range. Each button is named in full, for example "Civil dusk 04:24 UTC (18:24 local)", and jumps the clock there.
- The Layers panel adds "Stars", "Sun, Moon and planets" and "Alt/az grid" toggles, and a "Star magnitude limit" slider (V 1 to 6.5 in steps of 0.5, default 4.5) that shows the star count, for example "V ≤ 4.5 (904 stars)".

`public/data/stars.json` (8,404 stars at V ≤ 6.5, brightest first) is built by hand from CDS V/50 and the IAU-CSN name list. Commit only the output. The script prints its summary line with both inputs' sha256s:

```sh
npx tsx scripts/build-stars.ts                                         # downloads both inputs
npx tsx scripts/build-stars.ts --catalog <catalog.gz> --csn <IAU-CSN.txt>   # local copies
```

The planet test fixture `tests/fixtures/horizons-airless-maunakea-2026-10-10.json` holds JPL Horizons AIRLESS az/el tables for the Sun, Moon and six planets at Maunakea on 2026-10-10. It is fetched once with the script below, which makes eight requests to the Horizons API, 500 ms apart. Unit tests and CI only read the committed file.

```sh
npx tsx scripts/fetch-horizons-fixture.ts
```

## M3 · Satellites

- Both views draw the ISS and CelesTrak's "visual" group (the brightest satellites), plus Starlink when its toggle is on. Positions are propagated with SGP4 (satellite.js) in a Web Worker on a fixed sim-time grid (every 100 ms × rate) and interpolated every frame: linearly up to 60×, with Hermite at 600×. Sunlit and shadowed satellites differ in shape. Docked vehicles (POISK, CREW DRAGON 13 and the others on the ISS and Tiangong) are folded into their station and listed in its Inspector entry.
- Sky view: satellites above the horizon, a 30 s trail behind each (off under reduced motion, or with the Trails toggle), and a labelled marker for the ISS and for the selected and hovered objects; the selected satellite also gets a dotted line for its next 2 minutes. Below the map, a "Satellites above the horizon" list of buttons, highest first, is the keyboard path to every drawn satellite, for example "ISS (ZARYA), NORAD 25544, az 124°, alt 29°, sunlit".
- Ground map: every satellite's sub-point (WebGL points), the ISS and the selected and hovered satellites as labelled markers, the selected satellite's ground track ±10 min, emphasised, and ±3 min tracks for the satellites in the sky frame.
- Picking: hover a satellite, star, planet, the Sun or the Moon in the sky view (or a satellite on the ground map) for a hover card with az, alt, range and lit state; click to select it in both views. A click on empty space, or Esc, clears the selection. The Inspector shows the selection's details, element age ("Stale elements" past 7 days), whether it is visible to the eye, and "Show on map", "Follow" and "Clear selection".
- URL: `?sel=sat:25544` (also `planet:Jupiter`, `star:424`, `moon`, `sun`) selects on load and follows the selection.
- Layers: "Satellites (ISS and brightest)", "Starlink (about 11,100; loads 4.7 MB)" and "Trails", each with its load status, for example "165 objects, elements fetched 2026-10-11 03:50 UTC". Starlink's 4.7 MB file is fetched only when its toggle is first turned on.

Orbital elements are OMM JSON from CelesTrak in `public/data/gp/` (`stations.json`, `visual.json`, `starlink.json`, and `meta.json` with each group's fetch time, record count and sha256). The app fetches only these files from its own origin. They are refreshed by `.github/workflows/fetch-gp.yml`, every 6 h and by hand (`workflow_dispatch`):

- It runs `GP_CONTACT_URL=<repository URL> npx tsx scripts/fetch-gp.ts --out public/data/gp`, which sends `User-Agent: overhead-fetch-gp/1.0 (+<repository URL>)` and always asks for `FORMAT=json`.
- Each group is skipped while its `meta.json` stamp is under 2 h old. The groups are fetched one at a time, and the run stops at the first non-200 answer (CelesTrak's 403 "not updated since your last download" included), never following a redirect and never retrying: CelesTrak firewalls an address after 50 errors in 2 h. A group file is rewritten only when its sha256 changes; its stamp is always refreshed.
- Exit codes: 0 when every group was fetched or skipped, 1 after a stop (`Stopped: <error>`) or a corrupt `meta.json`, 2 on bad arguments or a missing or invalid `GP_CONTACT_URL`.
- The workflow then commits only changed files under `public/data/gp/`, also after a stop (the groups fetched before it are kept), and, on `main`, dispatches the Deploy workflow, because a push made with the workflow token starts no other workflow.
- Never run the script from a dev machine or a test: every run counts against CelesTrak's limits. Unit tests use a fake `fetch`, and e2e serves `tests/fixtures/gp/` for `data/gp/*.json`, so positions in tests never change.

The test snapshot in `tests/fixtures/gp/` is CelesTrak's data of 2026-10-11T03:50:21Z (22 stations, 156 visual and 11,102 Starlink records; 11,277 unique objects). The ISS reference fixture `tests/fixtures/iss-pass-maunakea.json` (Skyfield passes over Maunakea in the 24 h after that fetch) is regenerated by hand whenever the snapshot changes. It needs `uv`, and downloads DE421 (17 MB) once into `~/.cache/skyfield`. Two runs give byte-identical output:

```sh
uv run --with skyfield==1.55 --with sgp4==2.27 python scripts/fixtures/iss-pass-skyfield.py
# 3 passes, 93 samples, 31 shadow transitions -> <path>/tests/fixtures/iss-pass-maunakea.json
```

Measured on 2026-10-11 (Apple M2; Node 26.11.1 arm64; Chromium 156 headless shell, arm64):

| Check | Result |
| ----- | ------ |
| ISS vs Skyfield, 93 samples (`orbits.test.ts`) | az/alt within 0.0038°, range within 0.037 km, sub-point within 0.00039°; all 31 sunlit flips within 1 s |
| Sun altitude vs astronomy-engine, every 10 min | within 0.0046° |
| Sub-points (closed-form Bowring) vs satellite.js `eciToGeodetic`, 11,280 records | 9.7e-8° latitude, 8.5e-14° longitude |
| Interpolation error, ISS zenith pass (`interpolate.test.ts`) | linear 2.4e-3° at 60×; Hermite 4.1e-5° at 600× (linear would be 0.22°) |
| Worker time per sample at 10 Hz (`npm run perf`) | ISS + visual (175 objects): p50 0.1 ms, p95 0.2 ms (budget 4 ms); with Starlink (11,277): p50 5.1 ms, p95 5.4 ms |

## Credits

- Imagery: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." ([GIBS](https://nasa-gibs.github.io/gibs-api-docs/)). True colour: NOAA-20 / VIIRS.
- Coastlines and place labels: © OpenStreetMap contributors, Natural Earth ([copyright](https://www.openstreetmap.org/copyright); [ODbL-1.0](https://opendatacommons.org/licenses/odbl/)).
- Cameras: each camera's credit and terms come from `public/data/cameras.json` and are shown while it is active.
- Stars (shown while the Stars layer is on): Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR ([doi:10.26093/cds/vizier](https://doi.org/10.26093/cds/vizier)).
- Star names (shown while the Stars layer is on): IAU WGSN ([IAU-CSN](https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt); CC BY).
- Orbital elements (shown while the Satellites or Starlink layer is on): [CelesTrak](https://celestrak.org). The elements are fetched by `fetch-gp.yml` under CelesTrak's usage policy: at most once per group every 2 h, stopping at the first error.
