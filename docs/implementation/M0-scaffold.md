# M0 · Scaffold

Stage file for milestone M0. Read [`README.md`](README.md) sections 1–3, 7 and 8 first; this file uses their paths, types and names and does not repeat them. Precedence: [`../DECISIONS.md`](../DECISIONS.md), then the README, then this file.

Every config file and code block below was run on 2026-10-11 in a throwaway copy of the scaffold, with Node 26.11.1 arm64 (npm 11.20.0), the pinned packages and Playwright Chromium 1248, headless. The configs were copied out of this file's code blocks. `npm ci`, `npm install` (lockfile unchanged), lint, typecheck, the 21 unit tests, the build, both e2e tests, every step 14 negative control and `npm run perf` (gotcha 8) behaved as described. The same steps then ran in order on Ubuntu 24.04.5 (linux/arm64, Docker) with Node 26.11.1, and every one exited 0 once `libatomic1` was installed in the container (gotcha 18). After the switch to GitHub Pages under the `/Overhead/` base (DECISIONS H1), lint, typecheck, the unit tests, the build, both e2e tests (also with `CI=true`) and the base control in step 14 ran again on a copy of the repository's files, and `deploy.yml` passed actionlint 1.7.12. On GitHub, `FalconXYX/Overhead` ran the same files on 2026-10-11: CI run 38157417613 passed every step on the hosted `ubuntu-24.04` runner with Node 26.11.1, and Deploy run 38157417680 published `https://parthjain.ca/Overhead/`, which loaded the three panes in headless Chromium with no console error. Before the Node 26 switch, a reviewer had rebuilt the scaffold from this text alone in a second scratch copy, and all five gates, the negative controls and the guard checks behaved as described.

## 1. Goal

Every quality gate runs on an empty app. `npm run lint`, `typecheck`, `test`, `build` and `e2e` exit 0 in CI. GitHub Pages serves the app shell at `https://parthjain.ca/Overhead/`, deployed from `main` by GitHub Actions (DECISIONS H1); there are no per-branch previews. The shell has three placeholder panes, one error boundary per pane, the whole store from README section 4, and the replay clock loop.

Out of scope for M0:

1. Maps, OpenLayers objects, `src/map/**` (M1, M2).
2. URL state (`url.ts`), `keyboard.ts`, `cameras.json`, live mode (M1).
3. Workers, `src/workers/**`, `ephemeris.ts`, `skyCache.ts` (M2, M3).
4. Every action outside the M0 row of the [actions table](README.md#actions). Those actions exist as throwing placeholders.
5. Every selector. `selectors.ts` lands empty; each selector arrives with its first user.
6. Route mocks for third parties. M0 has only the catch-all guard.
7. Styling. The visual design (layout, colours, panel placement) is settled during the build from screenshots. M0 uses browser defaults.

## 2. Prerequisites

1. Milestones: none.
2. Data files: none.
3. Accounts:
   - the public GitHub repository `FalconXYX/Overhead` (H1), with Actions enabled and Pages set to deploy from GitHub Actions (step 15). No other account.
   - No API keys and no secrets: the app reads no `import.meta.env` variable other than `BASE_URL` (`"/Overhead/"`; M1 starts using it for data URLs; it is not a secret), and neither workflow needs a repository secret. Deploys use the workflow's own `GITHUB_TOKEN`.
4. Machine:
   - Node 26, arm64 (O4): `nvm install 26`, then `nvm alias default 26`. On 2026-10-11 that gives Node 26.11.1 with npm 11.20.0. Node 26 becomes LTS on 2026-10-28.
   - `uname -m` and `node -p process.arch` must both print `arm64`.
   - `which -a node` must print exactly one path, the nvm Node 26 (`~/.nvm/versions/node/v26.x.y/bin/node`). On 2026-10-11 it printed only `~/.nvm/versions/node/v26.11.1/bin/node`. Any other `node` on the `PATH` is a leftover install: remove it before `npm ci` (gotcha 9).
   - Every pinned package accepts Node 26. The `engines` fields in the installed packages are: vitest `^22.12.0 || ^24.0.0 || >=26.0.0`, vite, rolldown and `@vitejs/plugin-react` `^20.19.0 || >=22.12.0`, Playwright `>=20`, Biome `>=14.21.3`, TypeScript `>=16.20.0` and tsx `>=18.0.0`.
5. Repository state on 2026-10-11:
   - The remote is `https://github.com/FalconXYX/Overhead.git`. `main` already holds the docs and this scaffold: commit `80db984` ("Planning and Setup") and `8f6c858` ("Serve under /Overhead/ to match the GitHub Pages path"). Both went straight to `main`, before branch protection.
   - So M0's work is to check every file on `main` against this document, fix any difference on a branch `m0-scaffold`, and merge it through a pull request once `main` is protected (step 15). The differences found on 2026-10-11: `deploy.yml` still has a `workflow_call` trigger (step 15 removes it), and the root `README.md` lacks the dev URL and the redeploy line (step 12, items 3 and 4).
   - `.gitignore` keeps `recordings/` (O2) and `docs/verification/` out of git. Its comment on the second reads "verification evidence records stay local (Parth, 2026-10-11)". `git check-ignore -v docs/verification/README.md recordings/x.mp4` must print two lines, one for each pattern. Links from the committed docs into `docs/verification/` then resolve only in a local checkout.
   - Never `git add -A`: name the paths, so nothing under `recordings/` or a stray file is committed.

## 3. Deliverables

All paths are from the [file layout](README.md#3-file-layout).

| Path | What |
| ---- | ---- |
| `package.json` | add `engines` (`">=26"`), the nine scripts, `allowScripts`; add `@types/node` 26.6.5; remove `@types/proj4` |
| `package-lock.json` | regenerated by `npm install` |
| `.nvmrc` | `26` |
| `.gitignore` | already correct (it ignores `recordings/`, `docs/verification/`, `node_modules/`, `dist/` and the test output); no change |
| `biome.json` | recommended preset plus the stricter rules in step 4 |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.worker.json`, `tsconfig.node.json`, `tsconfig.test.json` | four project references |
| `vite.config.ts` | `base: "/Overhead/"`, `worker.format: "es"`, Vitest config |
| `playwright.config.ts` | one headless Chromium project, `vite preview` web server, both at `http://localhost:4173/Overhead/` |
| `index.html` | `lang="en"`, title `Overhead`, `#root` |
| `src/main.tsx` | start the clock loop, render `<App />` in `StrictMode` |
| `src/app/App.tsx` | shell: three labelled panes and the clock placeholder |
| `src/app/ErrorBoundary.tsx` | `ErrorBoundary` and its fallback `PaneError` |
| `src/state/types.ts`, `initialState.ts`, `store.ts`, `hooks.ts` | copied verbatim from README section 4 |
| `src/state/actions.ts` | `createActions`: 4 real actions, 41 throwing placeholders |
| `src/state/selectors.ts` | header comment only |
| `src/state/clockLoop.ts` | the replay frame loop and `registerFrameUpdater` |
| `src/domain/time/index.ts` | the M0 subset of the time API |
| `src/domain/astro/index.ts`, `camera/index.ts`, `orbits/index.ts` | `PlanetName`; `LensModel` and `Calibration`; `GpGroup` |
| `tests/unit/setup.ts` | blocks `fetch` |
| `tests/unit/network.test.ts`, `time.test.ts`, `store.test.ts`, `clockLoop.test.ts`, `errorBoundary.test.ts` | section 5 |
| `tests/e2e/fixtures.ts` | shared `test` with the guard fixture |
| `tests/e2e/smoke.spec.ts` | section 5 |
| `.github/workflows/ci.yml` | the CI job |
| `.github/workflows/deploy.yml` | the GitHub Pages deploy from `main` (step 15) |
| `README.md` (root) | stub: setup, scripts, deploy, M0 section |
| `docs/DECISIONS.md` | append the lines in section 8 |

## 4. Steps

### Step 1. Node and packages

1. Edit `package.json`. Keep every pinned version. Add `"@types/node": "26.6.5"` (the newest 26.x on npm on 2026-10-11) to `devDependencies`; remove `@types/proj4`, because proj4 2.22.0 ships its own types. Add these fields:

```json
  "engines": { "node": ">=26" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "e2e": "playwright test",
    "perf": "PERF=1 playwright test",
    "lint": "biome ci --error-on-warnings .",
    "format": "biome check --write ."
  },
  "allowScripts": { "esbuild": false, "fsevents": false }
```

2. Write `.nvmrc` containing `26`. `ci.yml` (step 10) and `deploy.yml` (step 15) both read it.
3. Run `npm install` to regenerate the lockfile.
   - Check that it still lists the Linux binaries CI needs: `grep -c 'linux-x64' package-lock.json` must be more than 0.
   - The lockfile must also have no `@types/proj4` entry.
4. npm 11.20.0 (with Node 26.11.1) skips dependency install scripts that `allowScripts` does not list, and warns about them (gotcha 10).
   - Neither package needs its script: esbuild runs from `@esbuild/<platform>`, and fsevents ships a prebuilt `fsevents.node`.
   - `npm install-scripts deny --all` writes the `allowScripts` block above.
5. Run `rm -rf node_modules && npm ci`. It must finish with no warnings.
6. Do not add a `postinstall` that downloads browsers: `deploy.yml` runs `npm ci` on every deploy and would download Chromium each time.

### Step 2. TypeScript project references

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.worker.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.test.json" }
  ]
}
```

`tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "ESNext.Disposable", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "erasableSyntaxOnly": true,
    "skipLibCheck": false,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": ["src/workers"]
}
```

`tsconfig.worker.json` and `tsconfig.test.json` each `extends` `./tsconfig.app.json` and override these keys:

| Key | `tsconfig.worker.json` | `tsconfig.test.json` |
| --- | ---------------------- | -------------------- |
| `tsBuildInfoFile` | `./node_modules/.tmp/tsconfig.worker.tsbuildinfo` | `./node_modules/.tmp/tsconfig.test.tsbuildinfo` |
| `lib` | `["ES2023", "ESNext.Disposable", "WebWorker"]` | inherited |
| `types` | `[]` | `["vite/client", "node"]` |
| `include` | `["src/workers", "src/domain"]` | `["tests"]` |
| `exclude` | `[]` | `[]` |

`tsconfig.node.json` does not extend the app config. It has its own `tsBuildInfoFile` (two projects that share one build-info file overwrite each other's state), no `jsx`, the DOM lib (Playwright's types need it), `types: ["node"]` and no `exclude`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "ESNext.Disposable", "DOM"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "erasableSyntaxOnly": true,
    "skipLibCheck": false,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts", "playwright.config.ts", "scripts"]
}
```

It uses `"module": "esnext"` and `"moduleResolution": "bundler"`, not `nodenext`, so scripts can import `src/domain` modules the same way `src` does. A script in `scripts/` that imports `../src/domain/time` passes `tsc -b` and runs with `npx tsx scripts/<name>.ts`. Under `nodenext` the same import fails with TS2834. Plain `node scripts/<name>.ts` also fails on it (`ERR_UNSUPPORTED_DIR_IMPORT`), so scripts always run through `npx tsx`.

The worker project also type-checks `src/domain` without the DOM lib. A `document` reference in `src/domain` therefore fails `tsc -b` (TS2584): the purity rule is enforced for free. `src/workers` may be absent in M0; `tsc -b` passes because `src/domain` has files.

### Step 3. Vite and Vitest

```ts
// vite.config.ts
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/Overhead/",
  plugins: [react()],
  // Required: Vite 8 defaults to "iife" workers, and the build then fails as soon as anything
  // imports satellite.js (top-level await in its WASM loader). See docs/DECISIONS.md, Tooling.
  worker: { format: "es" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
  },
});
```

`base` is the GitHub Pages path (H1). It is case-sensitive and must equal the repository name: on 2026-10-11 `https://parthjain.ca/Space-Opera/` answered 200 and `/space-opera/` 404, and the Pages API gives `FalconXYX/Overhead` the URL `parthjain.ca/Overhead/`. With it set, measured on 2026-10-11:

1. `vite build` writes `<script … src="/Overhead/assets/index-….js">` into `dist/index.html` and inlines `import.meta.env.BASE_URL` as `"/Overhead/"`.
2. `npm run dev` and `vite preview` serve the app at `/Overhead/`. Both answer `/` and `/?<query>` with a 302 to `/Overhead/?<query>`; any other path outside the base gets 404 `text/plain` ("did you mean to visit /Overhead/…").
3. So every runtime URL is built from `import.meta.env.BASE_URL` (H1). A root-relative `fetch("/data/…")` 404s in preview and fails the e2e guard (step 14).

Keep `worker.format` even though M0 has no worker. With it removed, one main-thread `import { json2satrec } from "satellite.js"` makes `vite build` exit 1. With it set, the build passes and warns that `node:module` and `node:worker_threads` were externalized (harmless).

```ts
// tests/unit/setup.ts — no unit test reaches the network. Fixtures are read with node:fs.
const blockedFetch: typeof fetch = (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`fetch is blocked in unit tests: ${url}`);
};
globalThis.fetch = blockedFetch;
```

### Step 4. Biome

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["**", "!!**/dist", "!!public/data", "!!tests/fixtures"]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "double" } },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended",
      "suspicious": {
        "noExplicitAny": "error",
        "noSkippedTests": "error",
        "noFocusedTests": "error",
        "noConsole": { "level": "error", "options": { "allow": ["error", "warn"] } }
      },
      "style": {
        "noNonNullAssertion": "error"
      }
    }
  },
  "overrides": [
    {
      "includes": ["scripts/**", "tests/**"],
      "linter": { "rules": { "suspicious": { "noConsole": "off" } } }
    }
  ],
  "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
```

1. `noNonNullAssertion` stops `xs[0]!` from bypassing `noUncheckedIndexedAccess`.
2. `noConsole` allows only `console.error` and `console.warn` in `src`. Scripts and tests may log.
3. `public/data` and `tests/fixtures` hold generated JSON. Without the exclusion, a compact OMM fixture fails `biome ci` with a format error.
4. Biome does not check `docs/**/*.md`.

### Step 5. Domain stubs (test first)

1. Write `tests/unit/time.test.ts` (section 5) and watch it fail.
2. Then implement in `src/domain/time/index.ts`, with the names and doc comments from [section 6](README.md#6-domain-module-apis) of the README:
   - `ClockRate` and `TimeInterval`;
   - `MAX_WALL_DELTA_MS = 250` and `SCRUB_HALF_RANGE_MS = 43_200_000`;
   - `advanceReplayMs(simTimeMs, wallDeltaMs, rate)`, which returns `simTimeMs + min(max(wallDeltaMs, 0), 250) × rate`;
   - `clampToScrubRangeMs(timeMs, centerMs)`, inclusive at ±43,200,000 ms;
   - `isoUtcSeconds(timeMs)`, which returns `` `${new Date(timeMs).toISOString().slice(0, 19)}Z` ``. It truncates milliseconds and never rounds.
3. The rest of the time API lands with its first user.
4. Create three type-only modules:
   - `src/domain/astro/index.ts` exports `PlanetName`;
   - `src/domain/orbits/index.ts` exports `GpGroup`;
   - `src/domain/camera/index.ts` exports `LensModel` and `Calibration`, copied from README section 6.

### Step 6. Store

1. Copy `types.ts`, `initialState.ts`, `store.ts` and `hooks.ts` verbatim from [README section 4](README.md#store). They are already Biome-formatted and pass `tsc -b` under the step 2 configs, so `npm run format` changes nothing (checked with Biome 2.5.15 and TypeScript 7.0.2).
2. Write `tests/unit/store.test.ts` first.
3. Then write `src/state/actions.ts`. `createActions(set: StoreApi<AppState>["setState"], get: StoreApi<AppState>["getState"]): Actions` ([README section 6](README.md#state-app-and-map-modules)) returns all 45 actions:
   - Real in M0: `tick` writes `clock.simTimeMs`; `play` sets `playing: true`; `pause` sets `playing: false, mode: "replay"`; `togglePlay` calls `pause()` or `play()` through `get().actions`.
   - Every other action is `notYet(name, milestone)`, with the milestone taken from the actions table. Each later milestone replaces its placeholders, test first.

```ts
// src/state/actions.ts (excerpt; 40 more notYet lines follow, one per remaining action)
import type { StoreApi } from "zustand/vanilla";
import type { Actions, AppState } from "./types";

type SetState = StoreApi<AppState>["setState"];
type GetState = StoreApi<AppState>["getState"];

/** Stands in for an action whose milestone has not landed. Calling it is a programmer error. */
function notYet(name: keyof Actions, milestone: `M${number}`): () => never {
  return () => {
    throw new Error(`actions.${name} lands in ${milestone}`);
  };
}

export function createActions(set: SetState, get: GetState): Actions {
  return {
    tick: (simTimeMs) => set((s) => ({ clock: { ...s.clock, simTimeMs } })),
    play: () => set((s) => ({ clock: { ...s.clock, playing: true } })),
    pause: () => set((s) => ({ clock: { ...s.clock, playing: false, mode: "replay" } })),
    togglePlay: () => (get().clock.playing ? get().actions.pause() : get().actions.play()),
    setMode: notYet("setMode", "M1"),
```

4. `src/state/selectors.ts` holds only its header comment. The selectors in README section 4 import `goesStepMs`, `sampleStepMs` and `trueColorDateUtc`, which do not exist until later milestones.

### Step 7. Clock loop (test first)

1. Write `tests/unit/clockLoop.test.ts` (section 5) against a manual `FrameScheduler`, and watch it fail.
2. Then implement:

```ts
// src/state/clockLoop.ts — the one requestAnimationFrame loop. M0: replay without video.
// Live sources land in M1 (synthetic), M4 (still image) and M5 (YouTube, local video).
import { advanceReplayMs, clampToScrubRangeMs } from "../domain/time";
import type { AppStore } from "./store";

export type FrameUpdater = (simTimeMs: number) => void;

/** requestAnimationFrame in the app; a manual fake in unit tests. */
export interface FrameScheduler {
  request(callback: (wallMs: number) => void): number;
  cancel(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

const updaters = new Set<FrameUpdater>();
let running = false;

/** Runs fn once per frame, after the tick, in registration order. Returns the unregister function. */
export function registerFrameUpdater(fn: FrameUpdater): () => void {
  updaters.add(fn);
  return () => {
    updaters.delete(fn);
  };
}

function runUpdaters(simTimeMs: number): void {
  for (const fn of updaters) {
    try {
      fn(simTimeMs);
    } catch (error) {
      updaters.delete(fn); // one failure must not stop the clock or flood the console
      console.error("Frame updater failed and was removed", error);
    }
  }
}

/** Starts the loop. Returns an idempotent stop(). A second start while one runs throws. */
export function startClockLoop(
  store: AppStore,
  scheduler: FrameScheduler = browserScheduler,
): () => void {
  if (running) throw new Error("clockLoop is already running");
  running = true;
  let lastWallMs: number | null = null;
  let handle = 0;
  let stopped = false;

  const frame = (wallMs: number): void => {
    try {
      const wallDeltaMs = lastWallMs === null ? 0 : wallMs - lastWallMs;
      lastWallMs = wallMs;
      const { clock, actions } = store.getState();
      let simTimeMs = clock.simTimeMs;
      let hitEdge = false;
      if (clock.mode === "replay" && clock.playing) {
        const advanced = advanceReplayMs(clock.simTimeMs, wallDeltaMs, clock.rate);
        simTimeMs = clampToScrubRangeMs(advanced, clock.rangeCenterMs);
        hitEdge = simTimeMs !== advanced;
      }
      if (simTimeMs !== clock.simTimeMs) actions.tick(simTimeMs);
      if (hitEdge) actions.pause();
      runUpdaters(simTimeMs);
      // M1: renderSyncAll() here, on frames where the sim time changed (README section 7).
    } finally {
      if (!stopped) handle = scheduler.request(frame);
    }
  };

  handle = scheduler.request(frame);
  return () => {
    if (stopped) return; // a stale stop() must not clear `running` for a newer loop
    stopped = true;
    running = false;
    scheduler.cancel(handle);
  };
}
```

Units: `wallMs` is the rAF timestamp in ms. `simTimeMs` is UTC epoch ms. The frame updaters run every frame, playing or paused. The next frame is requested in `finally`, so one throwing frame does not stop the clock.

### Step 8. Shell and error boundaries

1. Write `tests/unit/errorBoundary.test.ts` first.
2. `src/app/ErrorBoundary.tsx` is a class component with props `{ pane: string; children: ReactNode }` and state `{ error: Error | null }`.
   - `static getDerivedStateFromError(error: unknown)` turns any thrown value into an `Error`.
   - `render()` returns the children, or `<PaneError pane message onRetry />` when there is an error. `onRetry` resets `error` to `null`, which re-mounts the children.
   - Do not add `componentDidCatch` logging. React 19.3 already logs each caught error once with `console.error`.
3. `PaneError` renders `<div role="alert">` containing:
   - the text `"<pane> stopped working: <message>"`;
   - a `<button type="button">` whose text is `Retry <pane>`.
4. `src/app/App.tsx` renders `<main>` with `<h1>Overhead</h1>`, then three panes in this order: `Sky view`, `Ground map`, `Timeline`.
   - Each pane is `<section aria-label="<name>">` with an `<h2>` of the same name. Its content sits inside `<ErrorBoundary pane="<name>">`, so the fallback stays inside the named region.
   - The Sky view placeholder reads "The computed sky arrives in M2."; the Ground map placeholder reads "The ground map arrives in M1."
5. The Timeline pane holds `ClockStatus`, a placeholder that M1's `Timeline.tsx` replaces:
   - It calls `useTick4Hz()` and reads `store.getState().clock.simTimeMs` during render (React rule 5).
   - It gets `playing`, `rate` and `mode` from `useClockControls()`, and `togglePlay` from `useActions()`.
   - It renders a `<button type="button">` reading `Play` or `Pause` (from `playing`) that calls `togglePlay`.
   - It renders the line `<Live|Replay>, <rate>×, UTC <time dateTime={iso}>{iso}</time>`, where the first word comes from `mode`, `<rate>` is `rate`, and `iso = isoUtcSeconds(simTimeMs)`. In M0 it always reads `Replay, 1×, UTC …`.
6. `src/main.tsx` checks the root element:
   - `document.getElementById("root")`; if it is `null`, throw `Error("index.html has no #root element")`.
   - Call `startClockLoop(store)` at module scope, never inside an effect.
   - Render `<StrictMode><App /></StrictMode>` with `createRoot`.
   - URL parsing and `cameras.json` loading arrive in M1.
7. `index.html`: `<html lang="en">`, `<meta charset="UTF-8">`, a viewport meta, `<title>Overhead</title>`, `<div id="root">` and `<script type="module" src="/src/main.tsx">`.
   - Add no `<meta name="referrer">`.
   - Add no favicon link: headless Chromium requests only `/` and the JS bundle.

Accessibility in M0:

1. Every pane is a named region (`getByRole("region", { name })`).
2. Play/Pause and Retry are native buttons. Tab reaches them, and Enter and Space activate them.
3. The running UTC readout is not an `aria-live` region; a 4 Hz update would flood screen readers.
4. No CSS removes the browser's focus ring.
5. Global shortcuts land in M1 (`keyboard.ts`).

### Step 9. Playwright

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;
const perf = process.env.PERF === "1";

export default defineConfig({
  testDir: "tests",
  testMatch: perf ? "perf/**/*.perf.ts" : "e2e/**/*.spec.ts",
  forbidOnly: ci,
  retries: 0,
  workers: ci ? 1 : undefined,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173/Overhead/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: true },
    },
  ],
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/Overhead/",
    reuseExistingServer: !ci,
    timeout: 30_000,
  },
});
```

`baseURL` ends with the base and a slash. Specs navigate with base-relative paths: `page.goto("./")`, `page.goto("./?t=2026-10-10T03:30:00Z")`. Playwright resolves `goto` like `new URL(path, baseURL)`, so `"/?t=…"` leaves the base and reaches the app only through `vite preview`'s 302 (step 3), and `"/data/…"` is a 404.

```ts
// tests/e2e/fixtures.ts — every spec imports `test` and `expect` from here.
import { test as base, expect } from "@playwright/test";

export const APP_ORIGIN = "http://localhost:4173";

export interface Guard {
  consoleErrors: string[];
  pageErrors: string[];
  blockedRequests: string[];
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context, page }, use) => {
      const guard: Guard = { consoleErrors: [], pageErrors: [], blockedRequests: [] };
      // Register the catch-all FIRST: Playwright tries matching routes in reverse registration
      // order, so mocks added later (M1+) run before it.
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (new URL(url).origin === APP_ORIGIN) return route.fallback();
        guard.blockedRequests.push(url);
        return route.abort("blockedbyclient");
      });
      page.on("console", (message) => {
        if (message.type() === "error") guard.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => guard.pageErrors.push(error.message));
      await use(guard);
      expect(guard.blockedRequests, "requests to third parties").toEqual([]);
      expect(guard.pageErrors, "uncaught exceptions").toEqual([]);
      expect(guard.consoleErrors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
```

What the guard was shown to catch:

1. A page `fetch` to `https://example.com`.
2. A module worker's `fetch` to a third party.
3. `console.error` from the page or from a module worker. Worker messages arrive on the page's `console` event with `message.worker()` set.
4. Uncaught exceptions on the page or in a worker, which arrive as `pageerror`.

A later `context.route("**/example.org/**", fulfill)` in a test body won over the catch-all, so milestones add mocks after the guard and never edit it: from M1 they go inside the `routes` auto fixture, which depends on `guard` ([README section 8](README.md#end-to-end-tests)). Then:

1. Run `npx playwright install chromium` once. 1.64.0 needs revision 1248 (Chrome for Testing 156.0.8078.4). On mac-arm64 it downloads the full browser (186 MiB zip), the headless shell (99 MiB zip) and ffmpeg. Headless runs use the shell.
2. Run `npm run build`, then `npm run e2e`.

### Step 10. CI

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          if-no-files-found: ignore
          retention-days: 14
```

These are the steps of [README section 8, CI](README.md#ci): lint runs first, and the browser install sits just before `e2e`, so a lint or type error fails without waiting for the download.

How the workflow was checked:

1. `actionlint` 1.7.12 passes it. actionlint knows no inputs for the v7 actions, so every input above was checked against each action's `action.yml` at tag `v7`.
2. GitHub Actions sets `CI=true`. That turns on `forbidOnly`, Vitest's `allowOnly: false`, and a fresh `vite preview`.
3. Node 26 in CI comes from `.nvmrc`. `node-version-file: .nvmrc` reads `26`, which asks setup-node for the same thing as `node-version: 26`: the newest 26.x in its manifest. Keep the file input, so `.nvmrc` stays the one place the version is set (`deploy.yml` reads it too, step 15).
4. Node 26's Linux builds need `libatomic.so.1` (both `node-v26.11.1-linux-x64` and `-linux-arm64` list it as `NEEDED`; gotcha 18). The hosted `ubuntu-24.04` image (20261004.327.1) installs gcc 13, whose `libgcc-13-dev` depends on `libatomic1`, so the workflow needs no extra step.
5. It ran green on GitHub on 2026-10-11 (`FalconXYX/Overhead`, runs 38157297404 and 38157417613, image `ubuntu-24.04` 20261004.327.1). setup-node logged "Attempting to download 26..." and installed 26.11.1 x64; `npm ci` added 91 packages with no install-script warning; Biome checked 32 files; Vitest ran 21 tests; the build wrote `index-DzNXTc5e.js` at 226.83 kB (71.45 kB gzipped); Playwright downloaded Chrome for Testing 156.0.8078.4 (v1248); e2e passed 2 tests in 3.4–4.5 s. The `check` job took 49 s on the first run.

### Step 11. Local run of every gate

Run, in order: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`. Reference figures on an M2:

| Gate | Result |
| ---- | ------ |
| `tsc -b` | about 0.6 s cold |
| Vitest | 21 tests |
| `vite build` | `dist/assets/index-*.js` about 226.8 kB (71.5 kB gzipped): React plus zustand. This is the baseline for the "dependency over about 50 kB gzipped" rule. |
| e2e | 2 tests in about 3–4 s |

### Step 12. Root README stub

`README.md` contains:

1. One sentence on what Overhead is, from the brief's summary.
2. Requirements:
   - Node 26 arm64 (`nvm use`, then check `node -p process.arch`);
   - `npm ci`;
   - `npx playwright install chromium`.
3. A table of the nine scripts. Note that `npm run e2e` serves the last `npm run build`, and that `npm run dev` and `npm run preview` serve the app at `/Overhead/` (`http://localhost:5173/Overhead/` and `http://localhost:4173/Overhead/`).
4. Deploy: the production URL `https://parthjain.ca/Overhead/`, the sentence "GitHub Pages, deployed from `main` by `.github/workflows/deploy.yml`; there are no per-branch previews", and how to redeploy by hand (step 15, setup 3).
5. Links to `docs/implementation/README.md` and `docs/DECISIONS.md`, plus one line saying the verification records (`docs/verification/`) are kept locally and are not in the repository (`.gitignore`).
6. A milestone checklist, M0–M9.
7. An "M0 · Scaffold" section, three lines on what exists.
8. A "Credits" heading that says "none yet". M1 adds GIBS.

### Step 13. DECISIONS

Append the lines in section 8 to `docs/DECISIONS.md`.

### Step 14. Negative controls

These run locally and are never committed. Each must make its gate fail; paste the outputs into the pull request.

| Change | Gate | Expected failure |
| ------ | ---- | ---------------- |
| `export const a: any = 1;` in `src` | `npm run lint` | `lint/suspicious/noExplicitAny` |
| `it.skip(...)` in a unit test | `npm run lint` | `noSkippedTests` |
| `it.only(...)` in a unit test | `npm run lint` | `noFocusedTests` |
| `return xs[0]!;` | `npm run lint` | `noNonNullAssertion` |
| `console.log` in `src` | `npm run lint` | `noConsole` |
| `import Map from "ol/Map"` | `npm run lint` | `noShadowRestrictedNames` |
| `const n: number = xs[0]` in `src` or `tests` | `npm run typecheck` | TS2322 `number \| undefined` |
| `document.title` in `src/domain` | `npm run typecheck` | TS2584 |
| `test.only` in a spec | `CI=true npm run e2e` | `forbidOnly` |
| a page-side `console.error` or third-party `fetch` | `npm run e2e` | the guard |
| `void fetch("/data/gp/meta.json").catch(() => undefined);` in `main.tsx` (a URL without `BASE_URL`) | `npm run build && npm run e2e` | the guard: "Failed to load resource: the server responded with a status of 404 (Not Found)". The same line with `` `${import.meta.env.BASE_URL}data/gp/meta.json` `` passes |
| remove `if (hitEdge) actions.pause();` | `npm test` | the "+12 h" test |

### Step 15. Deploy: GitHub Pages from Actions (H1)

Production is `https://parthjain.ca/Overhead/`. `parthjain.ca` is Parth's user site (`FalconXYX.github.io`, custom domain `parthjain.ca`), so the `FalconXYX/Overhead` project site appears under it at `/Overhead/`, the repository's name (H1). `deploy.yml` publishes `main`, and there are no per-branch previews. A pull request is checked by CI, and a build is looked at locally with `npm run build && npm run preview` at `http://localhost:4173/Overhead/`.

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch: # fetch-gp.yml dispatches this after a data commit (M3)

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false # never cancel a deploy that is already publishing

jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

Rules:

1. **Triggers: `push` to `main` and `workflow_dispatch`, never `workflow_call`.**
   - M3's `fetch-gp.yml` pushes its data commits with `GITHUB_TOKEN`, and a push made with `GITHUB_TOKEN` starts no workflow. GitHub's docs name the exception: "`workflow_dispatch` and `repository_dispatch` events always create workflow runs."
   - So after a data push, `fetch-gp.yml` runs `gh workflow run deploy.yml --ref main` with `GH_TOKEN: ${{ github.token }}`, and adds `actions: write` to its `permissions` (M3 step 9). That change, added after M3's commit step, passed actionlint 1.7.12. The dispatched run builds "the last commit on the `GITHUB_REF` branch", which includes the data commit.
   - A `workflow_call` from `fetch-gp.yml` would publish stale data. A called workflow's `GITHUB_SHA` is "same as the caller workflow", and a scheduled caller's is "last commit on default branch" when the run started, which is before its own data push. (GitHub's "Events that trigger workflows" and "Triggering a workflow" pages, read on 2026-10-11.)
2. **Build.** The job uses the same Node (`.nvmrc`) and `npm ci` as CI, then `npm run build`. M9 step 14 changes that one step to `npm run build:pages`. It does not repeat lint, tests or e2e: branch protection (setup 4) keeps a red commit off `main`.
3. **Permissions and concurrency.** `contents: read`, `pages: write` and `id-token: write` are the minimum `actions/deploy-pages` names. The `pages` concurrency group never cancels, so a deploy that is publishing always finishes.
4. **Action inputs** were checked against each action's `action.yml` at its major tag, the newest releases on 2026-10-11:
   - `configure-pages@v6` (v6.0.0) takes no inputs here, and fails when Pages is off (gotcha 20);
   - `upload-pages-artifact@v5` (v5.0.0) takes `path`, tars that folder, and leaves out dotfiles unless `include-hidden-files: true`;
   - `deploy-pages@v5` (v5.0.1) gives the `page_url` output.

Measured on 2026-10-11 with `curl` and headless Chromium 156:

1. **Paths.** `https://parthjain.ca/Overhead/` answers 200, and `/Overhead` answers 301 to `/Overhead/`. Paths are case-sensitive (`/Space-Opera/` 200, `/space-opera/` 404), hence `base: "/Overhead/"` (step 3).
2. **Headers.** There is no `referrer-policy`, no COOP and no COEP; there is `access-control-allow-origin: *` and `cache-control: max-age=600`.
   - Without a `referrer-policy` header Chromium applies its default, `strict-origin-when-cross-origin`, so the YouTube embed gets the Referer it needs (error 153 otherwise, `verification/sources.md`).
   - GitHub Pages cannot set response headers, so only a `<meta>` in `index.html` could drop the Referer. Never add `<meta name="referrer" content="no-referrer">` (step 8).
3. **Byte ranges.** A `Range: bytes=0-1` request answers 206 with `content-range` and `accept-ranges: bytes`. MP4 files behave the same: on a 22,306,323-byte `video/mp4` file, `bytes=20000000-20000009` answered 206. M9 step 14 relies on this.
4. **Missing files** answer 404 `text/html` (GitHub's 404 page). `vite preview` answers 200 with `index.html` instead. A `fetch` that gets a 404 logs "Failed to load resource" in the console.
5. **Plain http is not redirected.** `http://parthjain.ca/Overhead/` answers 200 over http: the Pages API reports `https_enforced` false for the project, while the user site redirects to https. An http page is not a secure context, and `navigator.clipboard` is undefined there (headless Chromium 156 on a non-localhost http origin). Always link `https://parthjain.ca/Overhead/`; M9's "Copy link" checks for the clipboard first.
6. **Caching.** With `max-age=600`, a browser can show the previous deploy for up to 10 minutes.
7. **Limits** (GitHub's "GitHub Pages limits" page, read on 2026-10-11):
   - a published site may be no larger than 1 GB;
   - bandwidth has a soft limit of 100 GB a month;
   - a deployment times out after 10 minutes;
   - the soft limit of 10 builds an hour "does not apply if you build and publish your site with a custom GitHub Actions workflow".
   - The page states no per-file limit. The largest data file (`starlink.json`, 4.7 MB) is far inside these. M9 step 14 sizes the recorded clip.

Setup (one time):

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**. Do this before the first push that runs `deploy.yml`.
   - On 2026-10-11 the first Deploy run (38157297554) failed at `configure-pages` with "Get Pages site failed. Please verify that the repository has Pages enabled and configured to build using GitHub Actions", because Pages was still off.
   - After it was switched on, the next push deployed (run 38157417680). The Pages API now reports `build_type` `workflow` and `html_url` `http://parthjain.ca/Overhead/`.
2. GitHub created the `github-pages` environment with one deployment-branch rule, `main`. Leave it, so a run on another branch cannot deploy.
3. To redeploy without a push: Actions → Deploy → Run workflow, or `gh workflow run deploy.yml --ref main`.
4. Protect `main`: require a pull request and the `check` job of `CI`. Branch protection is available for public repositories on GitHub Free. On 2026-10-11 `main` was not protected yet.
   - From M3, `fetch-gp.yml` pushes data commits to the protected `main`. That needs a repository ruleset that requires `check` and lets that workflow's push bypass it ([README "Assumed until Parth confirms"](README.md#assumed-until-parth-confirms)); M3 proves it on the first manual run.
5. Add no secrets and no variables. The deploy authenticates with the run's own `GITHUB_TOKEN`.

## 5. Tests

All unit fixtures are inline constants. `T0 = Date.UTC(2026, 9, 11, 3, 20, 0)` is 2026-10-11T03:20:00Z. All time arithmetic is integer ms and is asserted exactly (`toBe`, tolerance 0). Each row was mutation-checked: breaking the named behaviour fails the test.

| File › test | Fixture and assertion |
| ----------- | --------------------- |
| `network.test.ts` › throws on any fetch | `fetch("https://gibs.earthdata.nasa.gov/")` throws `/fetch is blocked in unit tests/` |
| `time.test.ts` › adds the wall delta times the rate | `(T0, 16, 1)` → T0 + 16; `(T0, 100, 10)` → T0 + 1,000; `(T0, 16, 600)` → T0 + 9,600 |
| `time.test.ts` › clamps the wall delta to 250 ms | `(T0, 3,600,000, 600)` → T0 + 150,000; delta 250 → +250; delta 251 → +250 |
| `time.test.ts` › never runs backwards | `(T0, −40, 60)` → T0 |
| `time.test.ts` › keeps times inside ±12 h, inclusive | T0 + 43,200,000 stays; T0 + 43,200,001 → T0 + 43,200,000; T0 − 43,200,001 → T0 − 43,200,000 |
| `time.test.ts` › whole seconds, truncated | T0 → `"2026-10-11T03:20:00Z"`; T0 + 999 → same; 2026-12-31T23:59:59.500Z → `"2026-12-31T23:59:59Z"` |
| `store.test.ts` › initialState | `clock` equals `{ mode: "replay", playing: false, rate: 1, simTimeMs: T0, rangeCenterMs: T0 }`; `activeId` `"synthetic-maunakea"`; `starMagLimit` 4.5; `footprintHeightKm` null; the three `data.gp` entries are distinct objects |
| `store.test.ts` › tick writes simTimeMs and nothing else | `tick(T0 + 16)`; `rangeCenterMs` unchanged; `layers` and `actions` keep their references |
| `store.test.ts` › play, pause and togglePlay | the `playing` sequence true, false, true, false |
| `store.test.ts` › pause switches live to replay | start `{ mode: "live", playing: true }` → `{ mode: "replay", playing: false }` |
| `store.test.ts` › every later action throws and names its milestone | exactly 41 actions outside the M0 four; each `Reflect.apply(action, actions, [])` throws `/^actions\.<name> lands in M[1-9]$/`. Keep the list of unlanded names in the test: each milestone removes its own (README section 4, actions) |
| `clockLoop.test.ts` › does not tick while paused | 10 frames 16 ms apart → no `simTimeMs` change |
| `clockLoop.test.ts` › first frame has delta 0 | rate 10, frames at 1,000 / 1,016 / 1,032 → ticks `[T0 + 160, T0 + 320]` |
| `clockLoop.test.ts` › background-tab gap | rate 600, frames at 0 and 3,600,000 → T0 + 150,000 |
| `clockLoop.test.ts` › stops at +12 h and pauses | rate 600, 300 frames 250 ms apart → `simTimeMs` T0 + 43,200,000, `playing` false |
| `clockLoop.test.ts` › frame updaters | two updaters, the first unregistered after frame 2 → calls `a:0, b:0, a:16, b:16, b:32` (offsets from T0) |
| `clockLoop.test.ts` › throwing updater | runs once, `console.error` once (`vi.spyOn`), clock still reaches T0 + 32 |
| `clockLoop.test.ts` › stop() | the pending frame is cancelled; a new loop can start; calling the old `stop()` again leaves the new loop running (a third start still throws) |
| `clockLoop.test.ts` › second loop | `startClockLoop` throws `"clockLoop is already running"` |
| `errorBoundary.test.ts` › any thrown value becomes an Error | `getDerivedStateFromError("plain string").error?.message` is `"plain string"` |
| `errorBoundary.test.ts` › fallback markup | `renderToStaticMarkup(createElement(PaneError, …))` contains `<div role="alert">`, `Sky view stopped working: WebGL lost` and `<button type="button">Retry Sky view</button>` |

The manual scheduler in `clockLoop.test.ts` holds at most one pending callback, like rAF. `frame(wallMs)` runs it. `running` and the updater set are module state, so an `afterEach` calls every `stop()`, unregister and unsubscribe function the test created.

E2E tests, `tests/e2e/smoke.spec.ts`. Both use the guard and have no data fixture.

1. **"the shell loads with every pane"**
   - `goto("./")` (base-relative, step 9); the title is `Overhead`.
   - The regions `Sky view`, `Ground map` and `Timeline` are visible.
   - The Timeline's `time` element matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`.
2. **"Play advances the replay clock and Pause stops it"**
   - In M0, `goto("./")`. From M1 the app starts live and playing when the URL has no `t`, so M1 changes this test to start at `./?t=2026-10-10T03:30:00Z` (M1 step 17).
   - Read the readout, click `Play`, and expect the text to change within 3,000 ms.
   - Click `Pause` and wait 300 ms, so the 4 Hz readout catches up.
   - Read the readout again, wait 1,100 ms, and expect the same text.

## 6. Acceptance criteria

1. On the pull request and then on `main`, the `CI / check` job is green, with every step exit 0: `npm ci`, `lint`, `typecheck`, `test` (21 tests), `build`, the browser install and `e2e` (2 tests).
2. The e2e guard recorded no console errors, uncaught exceptions or third-party requests. Both specs passing shows this.
3. Every negative control in step 14 failed its gate.
4. The CI log and the Deploy log both show Node v26.x (setup-node prints `node: v26.11.1` or a later 26.x). The local `node -p process.arch` prints `arm64`, and `which -a node` prints one path (section 2, item 4).
5. After the merge, the Deploy run for that commit is green, and `https://parthjain.ca/Overhead/` (allow up to 10 minutes for the cache, step 15):
   - loads the three panes, with `<script … src="/Overhead/assets/index-….js">` in its HTML;
   - Play advances the UTC readout and Pause stops it;
   - the DevTools console shows no errors;
   - `curl -sI https://parthjain.ca/Overhead/` shows status 200 and no `cross-origin-embedder-policy`, no `cross-origin-opener-policy` and no `referrer-policy`;
   - `curl -sI https://parthjain.ca/Overhead` shows 301 to `https://parthjain.ca/Overhead/`.
6. No secrets:
   - `grep -rn "import.meta.env" src` prints nothing (from M1 its only hits are `import.meta.env.BASE_URL`);
   - the repository has no Actions secrets and no Actions variables;
   - `deploy.yml` has exactly the `push` (to `main`) and `workflow_dispatch` triggers, and the permissions `contents: read`, `pages: write` and `id-token: write`.
7. `main` requires the `check` job (step 15, setup 4). Either `gh api repos/FalconXYX/Overhead/branches/main/protection` (classic protection) or `gh api repos/FalconXYX/Overhead/rules/branches/main` (rulesets) lists a required status check named `check`. On 2026-10-11 the first answered 404 "Branch not protected" and the second `[]`.
8. `package-lock.json` has no `@types/proj4` and still lists the `linux-x64` binaries. `npm ci` prints no install-script warning.
9. `docs/DECISIONS.md` has the section 8 lines, and the root `README.md` has the step 12 contents.

Evidence in the pull request:

- the CI run link, and after the merge the Deploy run link;
- the output of `npx vitest run --reporter=verbose` (21 test names) and of `npm run e2e` (2 names);
- the step 14 transcript;
- one screenshot of `https://parthjain.ca/Overhead/`, for the record only: design is not judged in M0;
- the two `curl -sI` outputs.

No trace is needed. Playwright keeps one on failure (`retain-on-failure`), and CI uploads it with the HTML report.

## 7. Gotchas

1. **TypeScript 7 rejects old options.** `baseUrl` gives TS5102 and `moduleResolution: "node10"` gives TS5108. `types` defaults to `[]`, so `vite/client` and `node` must be listed. satellite.js's types need `ESNext.Disposable`. (`verification/tooling.md` claim 1)
2. **The default worker format breaks the build.** It fails on any satellite.js import, even on the main thread. Re-confirmed for this doc. (`verification/tooling.md` claim 2, `verification/satellite-js.md`)
3. **Banned tools.** typescript-eslint, vite-plugin-checker and ts-morph are banned (DECISIONS, Tooling): they call the old TypeScript JS API, which `typescript` 7.0.2 no longer exports. Type-check only with `tsc -b`. (`verification/tooling.md` claim 5)
4. **Biome's recommended preset is not enough.** It only warns on `any`, ignores `it.skip`, and errors on `import Map from "ol/Map"`. (`verification/tooling.md` claim 9)
5. **Playwright needs its own Chromium.** 1.64.0 requires Chromium 1248; an older cached build is not used, and the launch fails with "Executable doesn't exist". (`verification/tooling.md` claim 4)
6. **Never run `npm run dev` as a CI step.** The Vite dev server never exits, and under `CI=true` it skips its stdin-end shutdown. CI runs `vite preview` only through Playwright's `webServer`. (`verification/architecture.md` claim 25)
7. **`npm run e2e` with no `dist/` fails slowly.** `vite preview` serves 404 silently, and Playwright fails after 30 s with "Timed out waiting 30000ms from config.webServer". Locally, a stale `dist/` tests old code, so always build first. (Checked for this doc.)
8. **`npm run perf` exits 1 until M2.** It prints "No tests found" because no `tests/perf/*.perf.ts` exists yet; M2 adds `sky.perf.ts`. (Checked for this doc.)
9. **Use only the arm64 Node 26.** `node -p process.arch` must print `arm64` (section 2, item 4): an x64 Node installs the darwin-x64 builds of rolldown, Biome, lightningcss and the TypeScript compiler. After any switch of Node, run `rm -rf node_modules && npm ci`. (`verification/tooling.md` claim 10, DECISIONS O4)
10. **npm skips install scripts that `allowScripts` does not list.** npm 11.20.0 skips them and warns. Without the block, it printed "2 packages have install scripts not yet covered by allowScripts", naming `esbuild@0.28.2` (postinstall) and `fsevents@2.3.3` (install), and `npm install-scripts deny --all` wrote `{ "esbuild": false, "fsevents": false }`. `allowScripts` records the review; esbuild and fsevents work without their scripts. (Checked for this doc with Node 26.11.1; with the block, `npm ci` on GitHub's runner printed no warning.)
11. **zustand 5 typing and selectors.** The store creator needs its annotated return type (TS2345 otherwise). A React selector that returns a new object throws React error #185; use `useShallow`. (`verification/tooling.md` claims 8 and 17)
12. **StrictMode runs effects twice in development.** It runs mount, cleanup, mount. The clock loop therefore starts at module scope in `main.tsx`, and `startClockLoop` throws if started twice. (`verification/tooling.md` claim 6)
13. **Background tabs pause rAF.** The first delta after returning is huge, so `advanceReplayMs` clamps it to 250 ms (at 600×, a 1 h absence would otherwise jump about 25 days). (`verification/architecture.md` claim 5)
14. **React retries a failed render once before the boundary shows.** A component that throws only on its first render never shows the fallback: React 19.3 recovers and reports minified error #520 ("error during concurrent rendering but React was able to recover") as an uncaught error, which the guard records as a `pageerror`. To check the fallback by hand, throw on every render until a flag flips. A caught error is logged once with `console.error`, so the e2e guard fails any test where a pane crashes. (Checked in a production build for this doc.)
15. **Route order is reversed.** Playwright tries matching routes newest first. Register the guard's catch-all before every mock, which the auto fixture does. Add mocks in the spec body, or in a fixture that takes `guard` as a parameter so it is set up after the catch-all: M1's `routes` fixture does this, and every later mock goes there. (Checked for this doc.)
16. **Paste the README blocks verbatim.** They are Biome-formatted and pass `tsc -b` under these configs. A block retyped by hand, or one that lost its whitespace, fails `biome ci` on import order or line width; `npm run format` fixes that.
17. **Never add anything that breaks the embeds.** No `no-referrer` policy (YouTube error 153, `verification/sources.md`), and no COOP/COEP: they block non-CORS camera images or the YouTube iframe (`verification/architecture.md` claim 1). GitHub Pages sends none of these and cannot be configured to (step 15), so the only way in is a `<meta name="referrer">` or a `<meta http-equiv>` in `index.html`: add neither.
18. **Node 26 on Linux needs `libatomic1`.** In a bare `ubuntu:24.04` container the official Node 26.11.1 binary stops with "error while loading shared libraries: libatomic.so.1" (exit 127). `readelf -d` lists `libatomic.so.1` as `NEEDED` in both the linux-x64 and linux-arm64 builds. Install `libatomic1` before Node in any container or self-hosted runner; GitHub's hosted `ubuntu-24.04` image has it through gcc 13 (step 10). (Checked for this doc.)
19. **Navigate and fetch under the base.** The app lives at `/Overhead/`. A spec's `page.goto("/…")` and the app's `fetch("/…")` resolve against the origin, not the base. `vite preview` rescues only `/` and `/?<query>` with a 302; any other root path is a 404 that the guard reports (step 14). Use `goto("./…")` in specs and `import.meta.env.BASE_URL` in the app. (Checked for this doc.)
20. **Turn Pages on before the first deploy.** With Pages off, `configure-pages@v6` stops with "Get Pages site failed … Not Found" and Deploy fails; that happened to the first push on 2026-10-11. Switching the source to GitHub Actions does not re-run it: push again or dispatch Deploy (step 15, setup 1 and 3).
21. **A data commit deploys only if dispatched.** Pushes made with `GITHUB_TOKEN` start no workflow, so `deploy.yml`'s `push` trigger never sees `fetch-gp.yml`'s commits. `fetch-gp.yml` must run `gh workflow run deploy.yml --ref main`, and must not call `deploy.yml` through `workflow_call`, which would build the commit before the data push (step 15, rule 1). (GitHub's docs, read on 2026-10-11.)
22. **The http URL works but is not a secure context.** `http://parthjain.ca/Overhead/` is served without a redirect, and there `navigator.clipboard` is undefined. Link the https URL everywhere. (Measured on 2026-10-11.)
23. **Pages and `vite preview` disagree on missing files.** Pages answers 404 with GitHub's HTML page; `vite preview` and the dev server answer 200 with `index.html`. Code that checks for "not part of this build" must accept both: not OK, or not the expected content type (M5). (Measured on 2026-10-11.)

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M0's contract lines under "Contract changes from the implementation docs": `tsconfig.node.json` with `bundler`, the Biome rules, `allowScripts`, the CI order without a `postinstall`, and the throwing placeholder actions. Its hosting line there names GitHub Pages at `/Overhead/` (H1). Its "M0 · Scaffold" section already holds the e2e-after-build, ±12 h pause, throwing-updater and `ErrorBoundary` lines, and its section "Revisions for O1, O2, O4 and H1" holds the base-relative e2e navigation and the `deploy.yml` triggers, so do not append those again. Append these, under the "M0 · Scaffold" heading:

Under **Tooling**:

- A container or self-hosted runner installs `libatomic1` before Node 26. Reason: Node 26's Linux builds need `libatomic.so.1`, and a bare `ubuntu:24.04` image lacks it (Node exits 127); GitHub's hosted `ubuntu-24.04` image has it.

Under **Hosting** (new heading):

- Links to the app always use `https://parthjain.ca/Overhead/`. Reason: GitHub Pages serves the http URL without redirecting, and an http page has no `navigator.clipboard`.

If O3 changes: M0 lands only `ClockState` and the four M0 actions. `initialState.ts` shrinks to match, and each later milestone proposes its slices in its own pull request (README section 4).

