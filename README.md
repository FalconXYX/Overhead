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
| `npm run perf` | Playwright performance specs (`tests/perf`); exits 1 with "No tests found" until M2 |
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

## Credits

- Imagery: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." ([GIBS](https://nasa-gibs.github.io/gibs-api-docs/)). True colour: NOAA-20 / VIIRS.
- Coastlines and place labels: © OpenStreetMap contributors, Natural Earth ([copyright](https://www.openstreetmap.org/copyright); [ODbL-1.0](https://opendatacommons.org/licenses/odbl/)).
- Cameras: each camera's credit and terms come from `public/data/cameras.json` and are shown while it is active.
