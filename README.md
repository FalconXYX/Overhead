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

## Credits

None yet. M1 adds NASA GIBS.
