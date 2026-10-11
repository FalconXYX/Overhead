# M4 · Camera model and still images

Branch `m4-camera-model`, one pull request. Read [README](README.md) sections 2, 3 and 7 first. This file uses the paths, types and names defined there and does not restate them. [`../DECISIONS.md`](../DECISIONS.md) wins over both.

Numbers without a citation were measured for this file on 2026-10-11 with a scratch prototype of the algorithms below, on the pinned packages: proj4 2.22.0, ol 10.11.0, ajv 8.20.0, astronomy-engine 2.1.19, satellite.js 7.1.0, TypeScript 7.0.2, Vitest 5.0.3, rolldown 1.2.13 and Playwright 1.64.0 with headless Chromium 1248. Every TypeScript block was type-checked with tsc 7.0.2 (`strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`) and run; the JSON block was parsed and checked against M1's registry rules. The real-camera numbers come from the two archived Nānā ao frames in the Wayback Machine (`last_vis.png`, captures `20250323090011` and `20250716064809`).

## 1. Goal

M2 drew the sky through one lens, a zenith equidistant fisheye. M4 completes the camera model: all five lenses in closed form, pointed anywhere (tilted all-sky cameras included), with the shared tail (roll, distortion, focal length, principal point, flip) and the inverse. It then puts a real camera behind the overlay, the CFHT Nānā ao all-sky still image, which the user calibrates by hand or from star pairs; the calibration persists and its pose exports as OGC GeoPose validated against the official schema.

Out of scope:

- YouTube cameras, stream delay and local video (M5).
- Terrain, `synthetic-walenstadt` and `ask053-walenstadt` (M6; ASK053 also needs the owner's written permission). M4 builds and unit-tests what ASK053 needs (a CORS image, a burned-in Europe/Vaduz clock, 60 s exposure arcs) but adds no ASK053 entry.
- The orbit-height footprint and the incoming chip (M8).
- Automatic star detection, and reading burned-in clocks from pixels.
- proj4 at runtime. It is a test oracle only.
- Visual design. Layout, colours and panel placement are settled during the build from screenshots; this file specifies behaviour, content, states, keyboard and accessibility.

## 2. Prerequisites

- M2 and M3 are merged. M4 uses from them: `lens.ts`/`project.ts` (zenith equidistant), `createSkyMap` with `setCameraModel`, `bindSkyCamera`, `skyCache` and `public/data/stars.json`, the astro functions (`makeObserver`, `astroTimeAt`, `starUnitVectors`, `rotateStarsAzAltDeg`, `computeBodies`, `sunGeometricAltDeg`), `wrap360`, `wrap180`, `angularSeparationDeg`, the propagation worker, the sky satellites layer and pixel-space picking. From M1: the committed but disabled `cfht-nanaao` entry, `ENABLED_CAMERA_IDS` in `src/app/cameras.ts`, and `registerMap`.
- No new dependency: ajv 8.20.0 and proj4 2.22.0 are pinned since M0.
- No accounts or keys. Two one-off network tasks, by hand:
  - Download the GeoPose schema and its four instances (step 1).
  - Record the calibration-pairs fixture on a clear night with Nānā ao's hatch open (step 18). `last_vis.png` returned 404 at every check on 2026-10-11: 04:06–05:29 UTC in [sources.md](../verification/sources.md) claim 6, 09:48 UTC here, when the weather server said `HATCH_CLOSED` at 73.7 % humidity, and again at 11:40 UTC (01:40 HST). Build steps 1–17 first.
- Decisions ([DECISIONS](../DECISIONS.md)):
  - O3 (open): M4 uses `camera.status`, `camera.frameTimeMs`, `calibrationUi` and `ui.panel`. If O3 changes: propose those fields in this pull request.
  - O1: a still image gets the full overlay set and map picking ([README camera kinds](README.md#camera-kinds)); the light set over video and the YouTube hit targets come in M5. O2 and O4: no effect.

## 3. Deliverables

New files:

| Path | Content |
| ---- | ------- |
| `src/domain/camera/inverse.ts` | `undistortRadius`, `unprojectPixel` |
| `src/domain/camera/coverage.ts` | `frameAzimuthCoverage` |
| `src/domain/camera/fit.ts` | `fitCalibration`, `calibrationAcceptance` |
| `src/domain/camera/geopose.ts` | `GeoPoseBasicYpr`, `geoPoseRotation`, `toGeoPose`, `fromGeoPose`, `validateGeoPose` |
| `src/domain/camera/schemas/GeoPose.Basic.YPR.Schema.json` | official schema, byte for byte |
| `src/domain/camera/schemas/PROVENANCE.md` | URL, sha256, size, date, © OGC, Apache-2.0 copy |
| `src/app/persist.ts` | localStorage load and save; calibration file export, parse and import |
| `src/map/sky/layers/background.ts` | `StillRefreshOptions` and `startStillImageRefresh` for the `ImageLayer<ImageSource>` background |
| `src/map/sync/bindBackground.ts` | refresh loop per camera, status, `frameTimeMs`, freeze while calibrating |
| `src/ui/CameraPicker.tsx`, `src/ui/CalibrationPanel.tsx` | steps 13 and 14 |
| `tests/unit/inverse.test.ts`, `coverage.test.ts`, `geopose.test.ts`, `fit.test.ts`, `calibrationFixture.test.ts`, `persist.test.ts`, `bindBackground.test.ts`, `arcs.test.ts` | section 5 |
| `tests/e2e/calibration-export.spec.ts` | section 5 |
| `tests/fixtures/geopose/GeoPose.Basic.YPR.Instance.00.json` … `.03.json` | official instances |
| `tests/fixtures/calibration/cfht-nanaao-pairs.json` | exported from the panel on a real frame (step 18) |

Changed files:

| Path | Change |
| ---- | ------ |
| `src/domain/camera/lens.ts`, `project.ts`, `index.ts` | all lenses, tilted fisheyes, culls, `rMaxUnit`, HFOV helpers, `distortionValid`, `normalizeCalibration` and `MIN_DISTORTION_SLOPE` |
| `src/domain/time/index.ts` | `localDateTimeToUtcMs` |
| `src/workers/propagation.worker.ts`, `src/state/ephemeris.ts` | the `arc` message of README section 5 (step 16) |
| `src/state/actions.ts` | the M4 rows of the [actions table](README.md#actions), `cancelImagePoint` included |
| `src/state/clockLoop.ts` | live time for still-image cameras |
| `src/app/cameras.ts` | `"cfht-nanaao"` added to `ENABLED_CAMERA_IDS` (step 9) |
| `src/map/sky/createSkyMap.ts`, `layers/stars.ts` | background layer (`SkyMapHandle.backgroundLayer`); pan, zoom and calibration clicks for image cameras (`setPanZoom`); `renderBuffer` on the stars layer (step 11) |
| `src/ui/SkyView.tsx` | `bindBackground(store, sky.backgroundLayer)` in the `registerMap` bindings |
| `src/map/sky/layers/satellites.ts` | exposure arcs |
| `src/map/sync/bindSkyCamera.ts`, `bindSite.ts` | camera kind → view and interactions; the site wedge |
| `src/app/keyboard.ts` | `C`, calibration nudges, Esc cancels a pending point |
| `src/app/App.tsx`, `src/main.tsx` | mount picker and panel; load persisted calibrations |
| `public/data/cameras.json` | `cfht-nanaao` edited in place only if step 18 changes its values (M1 already committed it) |
| `tests/unit/lens.test.ts`, `time.test.ts`, `actions.test.ts` | section 5 rows |
| `tests/unit/store.test.ts` (M0) | "every later action throws": drop the 12 M4 actions of the [actions table](README.md#actions) from the list and lower the expected count by 12 (10 remain) |
| `tests/unit/cameras.test.ts` (M1) | the expected `enabledCameras` ids gain `cfht-nanaao`, in file order |
| `tests/e2e/fixtures.ts` | CFHT and AllSkyKamera mocks inside M1's `routes` fixture |
| `docs/DECISIONS.md`, `README.md` | section 8 lines; the root README's M4 section |

## 4. Steps

Build in this order. For every formula, write the failing test from section 5 first, then implement. Degrees at every API, radians inside; unit-focal coordinates are x right, y up, before × `focalPx`.

### Step 1. Vendor the GeoPose schema

1. Download `https://schemas.opengis.net/geopose/1.0/schemata/GeoPose.Basic.YPR.Schema.json` into `src/domain/camera/schemas/`. `shasum -a 256` must print `5508d26aed6f546384ac1e1b9d1117f201179a2b32200ad28af3e5209c765640` (969 bytes, `Last-Modified: Wed, 09 Apr 2025 01:48:37 GMT`, re-fetched 2026-10-11).
2. Download `…/geopose/1.0/instances/GeoPose.Basic.YPR.Instance.00.json` … `.03.json` into `tests/fixtures/geopose/` (174, 173, 173 and 174 bytes).
3. `PROVENANCE.md`: the URL, sha256, size, retrieval date, "Copyright (c) 2022 Open Geospatial Consortium" and Apache-2.0 through the byte-identical copy in `github.com/opengeospatial/GeoPose` (`standard/standard/schemata/`). Warn: never use `GeoPose.Basic.Euler.Schema.json` or the repo's `Data/Schemata` draft, which says `location` ([geopose.md](../verification/geopose.md) claim 2).
4. Never fetch the schema at runtime or in CI.

### Step 2. Forward model for every lens (`lens.ts`, `project.ts`)

1. Radius ρ(θ) for θ, the angle from the optical axis, and its inverse:

   | Lens | ρ(θ) | θ(ρ) | `horizonRadiusUnit` |
   | ---- | ---- | ---- | ------------------- |
   | `rectilinear` | tan θ | atan ρ | ∞ |
   | `fisheye-equidistant` | θ | ρ | π/2 |
   | `fisheye-equisolid` | 2 sin(θ/2) | 2 asin(min(ρ/2, 1)) | √2 |
   | `fisheye-stereographic` | 2 tan(θ/2) | 2 atan(ρ/2) | 2 |
   | `fisheye-orthographic` | sin θ | asin(min(ρ, 1)) | 1 |

2. `hfovDeg(lens, W, f) = 2·θ(W/(2f))` and `focalPxForHfov(lens, W, hfov) = (W/2)/ρ(hfov/2)`. The `min` clamps cap orthographic at 180° and equisolid at 360°. An all-sky lens can exceed 180°: Nānā ao at f 373.1 gives 189.2° (equidistant), so the UI labels it "Field across the width".
3. `createCameraModel(input)`:
   - `zenithLocked` = a fisheye with `altDeg === 90`. A locked model uses the axis A₀ = 0, h₀ = 90 whatever `azDeg` holds.
   - Precompute sin and cos of h₀, A₀ and ρ, and `sx = flipX ? −1 : 1`. At h₀ = 90 use exactly sin = 1 and cos = 0 (gotcha G1).
   - `thetaMaxRad` = π/2 for every lens.
   - `rMaxUnit`: r_dc = the largest `hypot(u − cx, v − cy)/f` over the 4 image corners; r_uc = `undistortRadius(r_dc, k1, k2)`. Rectilinear: r_uc, or `NaN` when it is null, which makes the calibration invalid. Fisheye: `min(horizonRadiusUnit, r_uc ?? Infinity)`; a circular fisheye's corners lie outside its image circle.
   - Delete M2's throw for other lenses.
4. `projectAzAltDeg`, one code path for all lenses around the axis (A₀, h₀); non-finite input returns false:
   - cos c = sin h₀ sin h + cos h₀ cos h cos(A − A₀); X = cos h sin(A − A₀); Y = cos h₀ sin h − sin h₀ cos h cos(A − A₀).
   - Rectilinear: cull cos c ≤ 0; x = X/cos c, y = Y/cos c.
   - Fisheye: θ = atan2(hypot(X, Y), cos c); cull θ > `thetaMaxRad`; (x, y) = ρ(θ)·(X, Y)/hypot(X, Y), or (0, 0) on the axis. Do not multiply by f here.
   - Tail: x′ = x cos ρ − y sin ρ, y′ = x sin ρ + y cos ρ; r² = x′² + y′²; cull r > 1.05·`rMaxUnit`; s = 1 + k1 r² + k2 r⁴; u = cx + sx·f·s·x′, v = cy − f·s·y′.
   - At A₀ = 0, h₀ = 90 this is M2's polar form. M2's tests must pass unchanged.
5. `projectBatch` keeps its M2 shape and runs the same arithmetic.
6. `distortionValid(k1, k2, rMaxUnit)`: false for any non-finite input. g′(r) = 1 + 3k1r² + 5k2r⁴ is a quadratic in s = r²; check it at s = rMax² and at the vertex s* = −3k1/(10k2) when k2 > 0 and 0 < s* < rMax². Require g′ ≥ `MIN_DISTORTION_SLOPE` = 0.05 (README section 6; DECISIONS refines its earlier "> 0"; gotcha G4).
7. `normalizeCalibration(lens, c)` runs on every calibration write:
   - Clamp `altDeg` to [−90, 90].
   - Fisheye at `altDeg` 90: `rollDeg = wrap180(rollDeg − azDeg)`, `azDeg = 0`. Otherwise `azDeg = wrap360(azDeg)`, `rollDeg = wrap180(rollDeg)`.
   - Why: (A₀, 90, ρ) is the same rotation as (0, 90, ρ − A₀). At f 375, locking a camera at (37, 89.9999, 150) with the fold moved the image 6.5e-4 px; ignoring the stale azimuth turned it by 37°, which moves horizon points about 374 px. With `azDeg` kept at 0, a later ↓ nudge to 89.95 moves the image 0.33 px instead of about 374 px.

### Step 3. Inverse (`inverse.ts`)

1. `undistortRadius(rd, k1, k2)`: Newton from r = rd, r ← r − (g(r) − rd)/g′(r) with g(r) = r(1 + k1r² + k2r⁴). Stop when |step| < 1e-9. Return null if g′ ≤ 0 at an iterate, after 10 iterations without converging, or if r < 0.
2. `unprojectPixel(model, u, v, out, offset)`:
   1. Non-finite input returns false.
   2. x_d = sx(u − cx)/f, y_d = −(v − cy)/f, r_d = hypot(x_d, y_d).
   3. r_d = 0: write (A₀, h₀), which is (0, 90) when locked, and return true. Write the calibration's degrees (`wrap360(azDeg)`, `altDeg`), not a degree → radian → degree round trip, which is inexact for 239 of the 3,600 azimuths 0.0°, 0.1° … 359.9°.
   4. r = `undistortRadius(r_d, k1, k2)`. Return false if null or if |g(r) − r_d|·f ≥ 1e-6 px. Scale (x_d, y_d) by r/r_d.
   5. Un-roll: x = x′ cos ρ + y′ sin ρ, y = −x′ sin ρ + y′ cos ρ.
   6. p = hypot(x, y). On a fisheye return false if p > `horizonRadiusUnit`. θ = θ(p).
   7. In ENU, d = cos θ·F + (sin θ/p)(x·R̂ + y·Û), with F = (cos h₀ sin A₀, cos h₀ cos A₀, sin h₀), R̂ = (cos A₀, −sin A₀, 0) and Û = (−sin h₀ sin A₀, −sin h₀ cos A₀, cos h₀).
   8. az = `wrap360(atan2(d_E, d_N))`, alt = atan2(d_U, hypot(d_E, d_N)).

   No proj4 call: its `gnom` inverse returns NaN at the principal point ([proj4-lens.md](../verification/proj4-lens.md) claim 5).

### Step 4. Frame coverage (`coverage.ts`)

`frameAzimuthCoverage(model, samplesPerEdge)`; callers pass 16 ([architecture.md](../verification/architecture.md) claim 17).

1. If `projectAzAltDeg(model, 0, 90)` lands inside [0, W] × [0, H], return `{ kind: "full" }`. That is every zenith or slightly tilted fisheye, and the 2742 px StarCam from alt₀ 68.502° (atan(2742/1080)) up.
2. Otherwise unproject `samplesPerEdge` points per edge, corners included, and sort their azimuths. The range runs clockwise from the azimuth after the largest circular gap to the one before it, so it may cross 0°.
3. Fewer than 2 unprojected samples: `{ kind: "full" }`.

### Step 5. GeoPose (`geopose.ts`)

Use the convention in [DECISIONS](../DECISIONS.md) "GeoPose" and copy it into the file header.

1. `geoPoseRotation(yaw, pitch, roll)`: R = Rz(yaw)·Ry(pitch)·Rx(roll), row-major. Its columns are the body axes in ENU: x = optical axis F, y = image-left, z = image-up, where image-right = cos ρ R̂ − sin ρ Û and image-up = sin ρ R̂ + cos ρ Û.
2. `toGeoPose(lat, lon, h, c, zenithLocked)`: locked gives (90, −90, `wrap180(roll)`); otherwise (`wrap180(90 − az)`, −alt, `wrap180(roll)`). Callers pass h = `site.heightM + site.geoidSepM`. `flipX` is not part of the pose: a mirror is not a rotation.
3. `fromGeoPose(pose)` works from the matrix, so it accepts any angles. F = column 0, up = column 2. If hypot(F_E, F_N) < 1e-9: az 0, alt 90, roll = atan2(up_E, −up_N), which equals `wrap180(roll + yaw − 90)` at pitch −90. Otherwise az = `wrap360(atan2(F_E, F_N))`, alt = atan2(F_U, hypot(F_E, F_N)) and roll = atan2(up·R̂, up·Û) with R̂, Û at that (az, alt).
4. `validateGeoPose`. Compile lazily (gotcha G9):

```ts
import { Ajv, type ValidateFunction } from "ajv"; // the default import fails under nodenext (TS2351)
import schema from "./schemas/GeoPose.Basic.YPR.Schema.json" with { type: "json" };

export interface GeoPoseBasicYpr {
  position: { lat: number; lon: number; h: number };
  angles: { yaw: number; pitch: number; roll: number };
}

let validator: ValidateFunction<GeoPoseBasicYpr> | null = null; // compiled on first use

export function validateGeoPose(value: unknown): { ok: true; pose: GeoPoseBasicYpr } | { ok: false; errors: string[] } {
  validator ??= new Ajv({ allErrors: true, strict: true }).compile<GeoPoseBasicYpr>(schema);
  if (!validator(value)) {
    return { ok: false, errors: (validator.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`) };
  }
  // ajv's "number" already rejects NaN and Infinity. The schema has no ranges and allows extra properties.
  const errors: string[] = [];
  if (value.position.lat < -90 || value.position.lat > 90) errors.push("/position/lat must be in [-90, 90]");
  if (value.position.lon < -180 || value.position.lon > 180) errors.push("/position/lon must be in [-180, 180]");
  return errors.length === 0 ? { ok: true, pose: value } : { ok: false, errors };
}
```

### Step 6. Calibration fit (`fit.ts`)

`fitCalibration(lens, W, H, start, pairs, options)`. Each `FitPair` is a clicked pixel plus its target's apparent az/alt ('normal' refraction) at `frameTimeMs`.

1. State: the rotation R (from `geoPoseRotation` of `toGeoPose(start)`'s angles), `focalPx`, `cxPx`, `cyPx`, `k1`. `k2` and `flipX` are never fitted.
2. Parameters: a rotation increment ω in body axes, trial R′ = R·Exp(ω) (Rodrigues), then Δf, Δcx, Δcy and, with `fitK1`, Δk1. "Roll only" means ω about body x, the optical axis; at the zenith that is the rotation about the vertical. Convert R′ to (az, alt, roll) with the step 5.3 extraction; roll-only forces az 0, alt 90. Why: (az, alt, roll) is singular at the zenith, where az and roll are one rotation (at alt 89.999999°, az + 0.001° and roll − 0.001° gave the same pixels to 1e-10 px); an increment on R is not.
3. Residuals: for each active pair, the target's pixel under the trial model minus the click. Project with step 2.4's arithmetic **without** the r > 1.05·`rMaxUnit` frame cull, requiring g′(r) > 0 at the point instead. A trial that fails `distortionValid`, has f ≤ 0, or puts a target behind a rectilinear camera or beyond 90° from a fisheye axis costs ∞. Why: with the frame cull, a StarCam start 10° off in azimuth returned null in 33 of 50 trials; without it, 0 of 50 even 30° off.
4. Jacobian: central differences with steps 1e-6 rad (ω), 1e-3 px (f, cx, cy) and 1e-7 (k1); one-sided when one side costs ∞, a zero column when both do.
5. Levenberg–Marquardt: solve (JᵀJ + λ·diag(JᵀJ))δ = −Jᵀr from λ = 1e-3. A step that lowers Σr² is kept and λ ← max(λ/10, 1e-12); otherwise λ ← min(10λ, 1e12), up to 12 tries. Converged when a kept step lowers the cost by less than a relative 1e-10, or no try is kept. Not converged after `options.maxIterations` (the panel passes 100): return null.
6. Stages, in the first round only:
   - Stage A: roll only when `start` is a zenith-locked fisheye, the full rotation otherwise; f, cx, cy; k1 held.
   - Stage B: everything requested: the full rotation unless the start is locked and `fitTilt` is false, plus k1 when `fitK1`.
   - Why: freeing the axis and k1 at once from a start 90° off in roll ran into a degenerate solution (f 14–62 px, k1 0.4–4.0). With the stages, fisheye starts 3° to 179° off in roll converged in all 1,000 trials.
7. 3σ rejection, after each converged fit (gotcha G7): take the active pair with the largest pixel residual. If it exceeds `rejectSigma` (3) × the RMS residual of the *other* active pairs, mark it rejected and refit (stage B). One pair per round, at most 10 rounds. Fewer than 4 pairs at the start: return null. Never reject a pair when that would leave fewer than 4 active pairs; stop rejecting instead, so rejection alone never turns a fit into "fewer than 4 pairs". (On 60 seeded 4-pair Nānā ao-like fits, with and without one pair moved 30 px, no rejection fired either way; the rule is a guarantee, not a tuning.)
8. Result: `calibration` = `start` with az, alt, roll, f, cx, cy (and k1) replaced and `rmsDeg` set to the fit's `rmsDeg`, through `normalizeCalibration`. `residualPx[i]` is the pixel distance for every input pair; `residualDeg[i]` is `angularSeparationDeg` between the unprojected click and the target (NaN if the click does not unproject). `rmsPx` and `rmsDeg` cover the non-rejected pairs; `iterations` sums all stages and rounds. A fit takes 4–7 ms for 14–90 pairs (Node), so it runs on the main thread.

`calibrationAcceptance(lens, pairs)` (shared by the panel and the fixture test): `minAltDeg` is 20 for fisheyes and 10 for rectilinear lenses. Pass requires ≥ 10 named (non-empty `stars.json` name), non-rejected fit stars at alt ≥ `minAltDeg`; RMS ≤ 0.25° and every value ≤ 0.5° over the non-rejected fit pairs; ≥ 3 holdout stars and ≥ 1 holdout planet at alt ≥ `minAltDeg`, each ≤ 0.5°.

### Step 7. Burned-in clocks (`src/domain/time`)

`localDateTimeToUtcMs` reads a wall-clock stamp in an IANA zone. It returns null inside a DST gap, takes the earlier instant in the repeated autumn hour, and rejects impossible dates:

```ts
/**
 * "2026-10-11T06:04:01" (seconds optional) read off a burned-in clock in an IANA zone -> epoch ms.
 * null if malformed, an impossible date, an unknown zone, or a wall time skipped by a DST change.
 * An ambiguous wall time (the repeated hour in autumn) gives the earlier instant.
 */
export function localDateTimeToUtcMs(localIso: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localIso);
  if (m === null) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi, s); // the wall-clock fields read as if they were UTC
  const back = new Date(wall);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null; // 2026-02-30 rolls over
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return null; // RangeError: unknown time zone
  }
  /** The zone's wall clock at instant t, read as if it were UTC. */
  const wallAt = (t: number): number => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(t)) if (part.type !== "literal") p[part.type] = Number(part.value);
    return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  };
  // The zone offsets a day either side cover any DST change; keep the earliest instant whose wall clock matches.
  const day = 86_400_000;
  const candidates = [wall - (wallAt(wall - day) - (wall - day)), wall - (wallAt(wall + day) - (wall + day))];
  const hits = candidates.filter((t) => wallAt(t) === wall);
  return hits.length === 0 ? null : Math.min(...hits);
}
```

Capture-time rules (entered by the user under "Image time", step 14):

- **Nānā ao** burns `YYYY-MM-DD HH:MM` in HST into the bottom-left corner, to the minute, with no zone label. Use stamp + 30 s. In both archived frames `Last-Modified` was 38 s and 40 s after the stamped minute.
- **ASK053** burns `DD-MM-YYYY HH:MM:SS` in Europe/Vaduz time into the top-left corner (fetched 2026-10-11T10:09:27Z: "11-10-2026 12:08:01", which is 10:08:01Z). The UI asks for ISO order. Treat the stamp as the exposure start and use stamp + `exposureSec` × 500 ms, mid-exposure. Confirm against a satellite trail on the first ASK053 night frame in M6.
- Until a time is entered, `frameTimeMs` = load time − `captureLagMs`. The UI marks it "estimated (± 30 s)".

### Step 8. Store actions and persistence

1. Implement the M4 rows of the [actions table](README.md#actions):
   - `updateCalibration`, `importCalibration` and `applyFit` pass the result through `normalizeCalibration` and leave the state unchanged when `distortionValid` fails for the camera's model. `applyFit` stamps `updatedAtMs` like `updateCalibration`.
   - `addImagePoint` replaces any pending point. `completePair` is a no-op without one and replaces an existing pair with the same `targetId`. `cancelImagePoint()` clears `pendingPx`.
   - Pairs belong to one frame: `setActiveCamera` now also clears `calibrationUi` (pairs, `pendingPx`, `fit`), and `clearPairs()` runs when a new still image loads. This extends M1's `setActiveCamera` ([README actions](README.md#actions)).
2. `persist.ts` takes a `Storage`-like object (`window.localStorage` in the app, a Map-backed stub in tests). Every `getItem`, `setItem` and `JSON.parse` sits inside `try/catch`; a failure means defaults ([README](README.md#url-and-persistence)).
   - **Load** key `overhead.calibration.v1`. Keep an entry only if its camera id is in the registry, all 12 fields have their types (finite numbers, boolean `flipX`, number or null `rmsDeg`) and `distortionValid` holds for that camera's model. `main.tsx` calls `importCalibration` for each one after `cameras.json` loads, before the first render.
   - **Save**: subscribe to `s.camera.calibration` and write the whole record on every change. It is one small JSON string, so no throttle is needed.
   - **Export**: a `CalibrationFileV1`: `format`, `version`, `exportedAtMs`, `cameraId`, `lens`, `imageSize`, `frameTimeMs`, the current calibration and the pairs (`imagePx`, `targetId`, `role`). Download `overhead-calibration-<cameraId>-<YYYYMMDDTHHMMSSZ>.json` through a `Blob`, `URL.createObjectURL` and a clicked `<a download>`, then revoke the URL.
   - **Import**: check `format` `"overhead.calibration"`, `version` 1, a known camera id, the registry's lens and image size, field types and `distortionValid`. Show every error; on success call `importCalibration`. The UI ignores a file's pairs; they serve review and the fixture.

### Step 9. Registry entry

M1 already committed `cfht-nanaao` in `public/data/cameras.json`, right after `synthetic-maunakea`, identical to the block below (checked field by field), and left it out of `ENABLED_CAMERA_IDS` ([M1 step 5](M1-ground-map.md)). M4 owns the entry:

1. Add `"cfht-nanaao"` to `ENABLED_CAMERA_IDS` in `src/app/cameras.ts`. Until then `?cam=cfht-nanaao` names a camera that is not in the store, and every e2e test in this file fails.
2. Do not add a second entry. Edit this one in place only when step 18 changes its values. It passes M1's `parseCameraRegistry` rules.

```json
{
  "id": "cfht-nanaao",
  "name": "CFHT Nānā ao all-sky (visible)",
  "kind": "still-image",
  "source": { "imageUrl": "https://www.cfht.hawaii.edu/~nanaao/last_vis.png", "refreshSec": 60, "corsEnabled": false, "captureLagMs": 40000, "exposureSec": 0 },
  "site": { "latDeg": 19.8253, "lonDeg": -155.4689, "heightM": 4204, "mastM": 0, "geoidSepM": 24.23, "timeZone": "Pacific/Honolulu" },
  "imageSize": { "widthPx": 1232, "heightPx": 1232 },
  "lens": "fisheye-equidistant",
  "defaults": { "azDeg": 227.3, "altDeg": 88.26, "rollDeg": 44.8, "focalPx": 373.1, "cxPx": 619.6, "cyPx": 609.8, "k1": 0.003, "k2": 0, "flipX": true, "streamDelayMs": 0, "rmsDeg": null, "updatedAtMs": 0 },
  "credit": { "text": "Nānā ao all-sky image © CFHT", "href": "https://www.cfht.hawaii.edu/en/gallery/nanaao.php", "licence": "GFDL-1.3-or-later", "licenceHref": "https://www.gnu.org/licenses/fdl-1.3.html" },
  "termsNote": "GNU Free Documentation License 1.3 or later"
}
```

Where the values come from:

- **Lens and defaults**: a fit of 71 and 93 named stars (V ≤ 4, alt ≥ 20°) found automatically in the two archived frames. Tilted equidistant with k1, after 5 saturated stars per frame were rejected: RMS 0.038° and 0.040°, worst 0.091° and 0.112°; pose az 227.0/227.5, alt 88.28/88.24, roll 44.5/45.1, f 373.0/373.2 px, principal point (619.7, 609.7)/(619.5, 609.8), k1 0.003. A calibration from either frame predicts the other frame's stars to RMS 0.08–0.09°, worst 0.43°. The defaults are the mean. Step 18 refits them on a 2026 frame.
- **Lens choice**: on the same pairs, equisolid matches the RMS only with k1 = 0.054, stereographic gives 0.071–0.074°, orthographic 0.69–0.75° (fails). Equidistant needs the least correction.
- **Orientation**: north up, east right, the mirror of the usual all-sky view ([sources.md](../verification/sources.md) claim 6), hence `flipX`. The pose is a locked roll of 177.5° plus a 1.74° tilt toward az 227°.
- **Image**: 1232 × 1232 in both frames. The image circle is centred at (622.7, 601.7) with radius 589.8 px, and the corners are black.
- **`geoidSepM`**: 24.23, the EGM96 value M1 uses for the same coordinates.
- **`captureLagMs`**: the file is written 8–10 s after mid-minute and the app polls every 60 s, so load − capture ≈ 8–10 s + U(0, 60) s; the mean is 40 s.
- **`exposureSec`**: CFHT does not publish it, so 0 draws dots. **`mastM`**: unknown; ask CFHT during M4. M1 commits 0, and M6 sets 33 m (DEM ground 4,170.9 m + 33 m = `heightM`) unless a measured value exists. It matters only to M6's horizon.

### Step 10. Still-image background

1. `createSkyMap` adds `new ImageLayer<ImageSource>()` (`import type ImageSource from "ol/source/Image"`) with no source as the bottom layer and exposes it as `SkyMapHandle.backgroundLayer`. `ImageSource` and not `ImageStatic`: M5 puts an `ImageCanvas` source on the same layer, which `ImageLayer<ImageStatic>` rejects (TS2739).
2. `layers/background.ts` holds the refresh loop. A new `ImageStatic` per refresh is the only way to reload ([openlayers.md](../verification/openlayers.md) claim 11). `stop()` puts the shown source back when a request is still in flight; otherwise that image would replace the frozen frame after the loop stopped, with no `onLoad`, so `frameTimeMs` and the pairs would belong to the previous image:

```ts
import type ImageLayer from "ol/layer/Image";
import type Projection from "ol/proj/Projection";
import type ImageSource from "ol/source/Image";
import ImageStatic from "ol/source/ImageStatic";

export interface StillRefreshOptions {
  readonly imageUrl: string;
  readonly refreshSec: number; // >= STILL_IMAGE_MIN_REFRESH_SEC (60)
  readonly corsEnabled: boolean;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly onLoad: (loadedAtMs: number, naturalWidthPx: number, naturalHeightPx: number) => void;
  readonly onError: () => void; // 404 and network errors alike; the previous image stays on screen
}

/** Swaps in a new ImageStatic every refreshSec. The next request is scheduled only after the previous load ends. */
export function startStillImageRefresh(layer: ImageLayer<ImageSource>, projection: Projection, o: StillRefreshOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let shown = layer.getSource(); // the source whose image is on screen
  let pending: ImageStatic | null = null; // the source still loading
  const scheduleNext = (): void => {
    if (!stopped) timer = setTimeout(load, o.refreshSec * 1000);
  };
  function load(): void {
    const sep = o.imageUrl.includes("?") ? "&" : "?";
    const source = new ImageStatic({
      url: `${o.imageUrl}${sep}t=${Date.now()}`, // cache-buster
      projection,
      imageExtent: [0, 0, o.widthPx, o.heightPx],
      crossOrigin: o.corsEnabled ? "anonymous" : null, // null: a no-cors request; a CORS request to a server without CORS headers fails
    });
    source.once("imageloadend", (e) => {
      if (stopped) return;
      shown = source;
      pending = null;
      const el = e.image.getImage(); // an ImageBitmap in Chromium (ol/Image decode), else the HTMLImageElement
      const [w, h] = el === null ? [0, 0] : el instanceof HTMLImageElement ? [el.naturalWidth, el.naturalHeight] : [el.width, el.height];
      o.onLoad(Date.now(), w, h); // may stop this loop
      scheduleNext();
    });
    source.once("imageloaderror", () => {
      if (stopped) return;
      pending = null;
      o.onError();
      scheduleNext();
    });
    pending = source;
    layer.setSource(source); // the renderer keeps drawing the previous image until this one has loaded
  }
  load();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    if (pending !== null) layer.setSource(shown); // a load in flight would change the frozen image without onLoad
  };
}
```

   In headless Chromium 1248 with Playwright's fake clock: the first request carried `?t=<ms>` with no `Origin` header (`sec-fetch-mode: no-cors`); after `runFor(59_000)` nothing more was requested; the second request came exactly 60,000 ms after the first load ended; the image reported 1232 × 1232; a 404 fired `imageloaderror`. Stopping 0.5 s into a 3 s request kept the previous image on screen (centre pixel unchanged after the request finished) and fired no `onLoad`; without the stop, the new image appeared.
3. `bindBackground(store, layer: ImageLayer<ImageSource>, start = startStillImageRefresh)`: the injectable `start` lets unit tests run without a DOM. Pass `start` the projection `skyPixelProjection(widthPx, heightPx)` (M2) of the camera being started, never one captured when the binding was created: M2's `setCameraModel` swaps the view, and its projection, whenever the frame size changes. A source in another camera's projection throws `No transform available between sky-px-1232x1232 and sky-px-1024x1024` as an uncaught error and never loads (checked in Chromium). A new `Projection` with the view's code is enough: OpenLayers' `equivalent()` compares codes and units. The binding subscribes to `[s.camera.activeId, s.ui.panel === "calibration", s.camera.frameTimeMs !== null]` and keeps at most one loop running:
   - Still-image camera, panel closed: run the loop (if it is not already running).
   - Panel open with an image on screen: stop the loop and keep the image (frozen while calibrating). Panel closed again: start at once.
   - Camera change: stop, `layer.setSource(null)`, then start for the new camera if it is a still-image camera.
4. `onLoad`: `setFrameTimeMs(loadedAtMs − captureLagMs)`, `setCameraStatus(id, "live")`, `clearPairs()`. If the natural size differs from `imageSize`, show "Image is W × H px; the calibration assumes W′ × H′ px" in the sky view and the panel. Never log it as a console error.
5. `onError`: `setCameraStatus(id, "daytime")` when `sunGeometricAltDeg(astroTimeAt(Date.now()), makeObserver(site)) > 0`, else `"offline"`. Keep `frameTimeMs`: the old image stays.
6. `clockLoop.ts`, live mode on a still-image camera: sim time = `frameTimeMs ?? Date.now()`. With no image yet, the sky shows now.
7. In replay mode keep refreshing the image, show "Image captured HH:MM:SS UTC" beside the overlay time, and offer "Back to live".
8. The camera's `credit.text` with its link, the licence link and `termsNote` stay visible at all times ([README](README.md#credits)).
9. Never read the image's pixels: Nānā ao taints the canvas ([openlayers.md](../verification/openlayers.md) claim 23).

### Step 11. Sky view for image cameras

1. `bindSkyCamera` calls `SkyMapHandle.setPanZoom(on)` with `on` true for `still-image` cameras. Then the map gets `defaults({ altShiftDragRotate: false, pinchRotate: false })` from `ol/interaction/defaults`, and a view built with `extent: [0, 0, W, H]`, `constrainOnlyCenter: true`, `enableRotation: false`, `maxResolution` = the fitted resolution (`view.getResolutionForExtent([0, 0, W, H], map.getSize())`) and `minResolution: 0.125`. Synthetic cameras keep M2's fixed view with no interactions. Two OpenLayers rules, checked on ol 10.11.0:
   - View limits are fixed at construction: `setMinZoom` is ignored once `maxResolution` is set (`getMinZoom()` stays 0). Each refit therefore builds a new view, as M2's `setCameraModel` does.
   - OpenLayers snaps `minResolution` to `maxResolution / 2ⁿ`, so the zoom-in limit lands between 4 and 8 screen px per image px: fitted 2.0533 gives 0.1283 (7.8 px), and M2's `maxResolution` 1232 would give 0.1504 (6.6 px).
2. The container is focusable, like M1's ground map, so OpenLayers' keyboard pan and zoom work. A "Fit frame" button restores the whole frame. Refit on resize only while the view is at its fitted state.
3. Calibration clicks use `singleclick`, which does not fire on a double-click zoom. The image pixel is (u, v) = (x, H − y) from `event.coordinate`.
4. Pan and zoom would break M2's star renderer ([M2](M2-synthetic-sky.md) gotcha 20): OpenLayers passes the custom renderer only the points inside the view extent buffered by the layer's `renderBuffer` (100 px by default), so `visible[i]` and `radiusPx[i]` would belong to the wrong star. Create the stars layer with `renderBuffer: 1_000_000` in `createStarsLayer` (`new VectorLayer({ source, style, renderBuffer: 1_000_000 })`). Checked in headless Chromium on a 3840 × 2160 pixel projection with 1,000 points spread over the frame: with `renderBuffer` 1,000,000 the renderer received all 1,000 at every resolution and centre tried (4.8, 0.5 and 0.125); with the default it received 1–7 whenever the view was zoomed in. The cost is the unzoomed cost: every star of the frame is replayed, and the canvas clips what is off screen.
5. `SkyView`'s `aria-label` for a `still-image` camera reads "Computed sky over the image from <camera name>". M2's wording ("zenith fisheye, north up, east left") describes only the synthetic cameras; M5 gives the `youtube` and `local-video` wording. M2's e2e locator `/Computed sky/` still matches.

### Step 12. Re-projection and the site wedge

1. `bindSkyCamera` builds the model with `createCameraModel` whenever the active camera or `selectCalibration` changes. M2's `setCameraModel` already re-projects every layer from the cached az/alt.
2. `bindSite` draws the wedge from `frameAzimuthCoverage(model, 16)`. `"full"`: `circular([lon, lat], radiusM, 64)` from `ol/geom/Polygon`. `"range"`: a polygon from the site through `offset([lon, lat], radiusM, azDeg·π/180)` from `ol/sphere` every 2° from `fromAzDeg` clockwise to `toAzDeg`, back to the site (`offset` bearings are clockwise from north: π/2 moved 10 km east). Transform both from EPSG:4326 to EPSG:3857. The radius and style are visual choices.
3. Both M4 cameras are fisheyes, so both show a full circle; the range case is unit-tested now and first seen in M5.

### Step 13. CameraPicker

1. List every registry entry in `cameras.json` order with its name, kind and status.
2. Status is text plus an icon or shape, never colour alone: "Live", "Offline", "Daytime", "Not checked" (`unknown`). Synthetic cameras are always "Live". A still camera shows its stored status; one not active since load shows "Not checked". Only the active camera is ever polled.
3. Use a native radio group (`<fieldset>`, `<legend>`, `<input type="radio">`), so the arrow keys and Space work. Choosing an entry calls `setActiveCamera(id)`; `url.ts` writes `?cam=`.

### Step 14. CalibrationPanel

`togglePanel("calibration")` from the `C` key or a button. While it is open: stars are limited to V ≤ 4 (`selectStarMagLimit`), planets and the Moon show, and the still image is frozen. Opening it on a still-image camera calls `setMode("live")`, so the overlay is at `frameTimeMs`.

1. **Header**: camera name and lens, read-only. On fisheyes, "Compare lens models" fits each fisheye lens from the current calibration (`focalPx` scaled by the ratio of horizon radii, k1 0) and lists `rmsDeg`, k1 and the acceptance result per lens. It never changes the registry.
2. **Pointing and lens**: for `azDeg`, `altDeg`, `rollDeg`, `focalPx`, `cxPx`, `cyPx` and `k1`, a labelled native range input plus a numeric input, each with its unit.

   | Field | Range | Step |
   | ----- | ----- | ---- |
   | `azDeg` | 0–360, wrapping; disabled while `zenithLocked` | 0.01° |
   | `altDeg` | −10–90 rectilinear, 0–90 fisheye | 0.01° |
   | `rollDeg` | −180–180 | 0.01° |
   | `focalPx` | 0.5–2 × the default | 0.1 px |
   | `cxPx`, `cyPx` | 0–W, 0–H | 0.1 px |
   | `k1` | smallest k1 that passes `distortionValid` (40-step bisection, recomputed when f, cx or cy change) to +0.5 | 0.0001 |

   Beside `focalPx`, show `hfovDeg` and an HFOV input that sets `focalPx` through `focalPxForHfov`. `k2` is read-only (only an import changes it). `flipX` is a checkbox.
3. **Image time** (still cameras): `frameTimeMs` in UTC and in `site.timeZone`, both labelled, marked "estimated (± 30 s)" until entered, plus "Image frozen while calibrating". "Enter burned-in time" is `<input type="datetime-local" step="1">`; apply step 7's rule for the camera, then `setFrameTimeMs`.
4. **Star pairs**, while an image is on screen:
   - The first `singleclick` inside [0, W] × [0, H] calls `addImagePoint(u, v)`.
   - A second click within 6 screen px of a catalogue marker (stars V ≤ 4 and planets) calls `completePair`. Any other click replaces the pending point.
   - The panel always lists the 3 catalogue objects nearest the pending point in image pixels under the current calibration, as buttons.
   - Keyboard path: "Add point at view centre" with a centre crosshair. Pan the focused map with the arrows, press the button, then pick from the 3 nearest.
   - The pair table: target name (or "HR n"), role toggle (fit or holdout), residual in px and degrees, rejected flag, Remove. Plus "Clear pairs". Sort by residual on request so bad pairs stand out.
5. **Fit**:
   - "Fit k1" and "Fit tilt" checkboxes, both on by default. "Fit tilt" is `FitOptions.fitTilt` and shows only while the calibration is a zenith-locked fisheye; a tilted calibration always fits the full rotation. With fewer than 8 fit pairs the fit holds k1 (and a locked camera's tilt) and says so.
   - The Fit button is enabled at ≥ 4 fit pairs. Targets are computed at `frameTimeMs`: stars through `starUnitVectors` and `rotateStarsAzAltDeg`, planets through `computeBodies`, both apparent.
   - Call `fitCalibration` with `maxIterations: 100`, `rejectSigma: 3`; compute holdout residuals with `unprojectPixel` and `angularSeparationDeg`; call `applyFit` with `residualPx` and `rejected` aligned to `calibrationUi.pairs` (holdouts are measured, never rejected). Keep the per-pair degrees and the `calibrationAcceptance` report in component state.
   - Show RMS in px and degrees, the largest fit and holdout errors, and the acceptance checklist, each line with its count and threshold.
   - Null shows "Fit failed" and the reason: fewer than 4 pairs, a target behind the camera with the current pointing (align roughly first), or no convergence.
6. **Files**: "Reset" asks to confirm, then `resetCalibration`. "Export JSON" and "Import JSON" follow step 8. "Export GeoPose": `toGeoPose(lat, lon, heightM + geoidSepM, calibration, zenithLocked)`, then `validateGeoPose`; on success download `geopose-<cameraId>.json`, holding the pose plus `"x-overhead": { cameraId, lens, convention, heightDatum }` (the schema allows extra properties). On failure show the errors and download nothing. "Import GeoPose" validates, warns when the position is > 0.01° or > 100 m from the site, and applies the `fromGeoPose` angles through `updateCalibration`.
7. **Accessibility**: every control has a label with its unit; range inputs carry `aria-valuetext` such as "227.30 degrees". Pair state ("Point set at u 612.4, v 433.0. Choose its star.") and fit results go to an `aria-live="polite"` region. Focus stays in the panel after each action.

### Step 15. Keyboard (`src/app/keyboard.ts`)

1. `C` calls `togglePanel("calibration")`.
2. While the panel is open, per the [README keyboard table](README.md#keyboard): ← / → change `azDeg` by −/+ 0.05°, or `rollDeg` on a zenith-locked fisheye; ↑ / ↓ change `altDeg` by ± 0.05°; Shift makes it 0.5°; all through `updateCalibration`. ↑ on a locked fisheye stays at 90; ↓ unlocks it (step 2.7 keeps that continuous). Time stepping is off.
3. Esc calls `cancelImagePoint()` when a point is pending, else `select(null)`.
4. M1's handler already skips events whose `defaultPrevented` is set, so the arrows pan a focused sky map instead of nudging.

### Step 16. Exposure arcs

Only for a still-image camera with `exposureSec` > 1, in live mode (sim time = `frameTimeMs`).

1. Each time `frameTimeMs` changes, send the `arc` message (README section 5): `startMs = frameTimeMs − exposureSec × 500`, `stepMs` 5,000, `steps = floor(exposureSec / 5) + 1` (13 for 60 s), the visible groups, and a transferred `Float32Array(steps × count × SAMPLE_STRIDE)`.
2. The worker, for each step s: `ctx = createPropagationContext(startMs + s × stepMs, site)`, then `writeSample(satrec_i, ctx, out, s × count + i)` for every object.
3. The sky satellites layer draws one `MultiLineString` per group and style class, written once per arc reply. Each step's ENU goes through `enuToAzAltDeg`, `apparentAltDeg` and `projectAzAltDeg`. A segment is drawn only when both ends are valid, sunlit, projected and above the horizon, so a satellite entering shadow ends its trail as on the image. 5 s chords stayed within 0.104 px of the true ISS path on the Nānā ao model (42 windows above 20°).
4. While arcs show, hide that camera's dots and trails. Picking uses the ordinary position at `frameTimeMs`, the arc's midpoint.

### Step 17. End-to-end spec

Write `tests/e2e/calibration-export.spec.ts` (section 5). Inside M1's `routes` auto fixture in `tests/e2e/fixtures.ts` ([README section 8](README.md#end-to-end-tests)), add a `context.route` for `www.cfht.hawaii.edu` and `www.allskykamera.space` that fulfils `tests/fixtures/gibs/tile.jpg` (`image/jpeg`, 256 × 256). Tests needing a 404 add a `page.route`, which takes precedence.

### Step 18. Record the pairs fixture and settle the defaults

1. On a clear night with `last_vis.png` returning 200, open `?cam=cfht-nanaao` and the panel.
2. Read the HST minute off the image and enter it under "Image time".
3. Zoom in. Click the centre of each star's whole blob, not its brightest pixel (gotcha G15). Add ≥ 14 named fit stars (V 1–4 preferred) at alt ≥ 20°, spread over every azimuth, plus 3 named holdout stars and 1 holdout planet at alt ≥ 20°. Saturn (magnitude 0.2–0.4 from mid-October to early November 2026) serves: on the night of 2026-10-11/12 HST it stays above 24° from 20:00 to 04:00 HST, and it transits at about 72° (23:41 HST on 2026-10-11, 22:42 on 2026-10-25, 21:56 on 2026-11-05; astronomy-engine, 'normal' refraction). At 22:00 HST in mid-October it is only at about 60°.
4. Export JSON before pressing Fit, so the file's calibration is the start. Commit it as `tests/fixtures/calibration/cfht-nanaao-pairs.json` (no image).
5. Run "Compare lens models". Commit the lens with the lowest RMS (prefer the smaller |k1| within 0.01°) and set `defaults` to the fit, with `rmsDeg` null and `updatedAtMs` 0.
6. Record the lens, tilt and RMS in `DECISIONS.md`.

### Step 19. Docs

Root `README.md`: an "M4 · Camera model and still images" section with the lens table, the calibration workflow, the Nānā ao credit and licence, and the schema download command. Append section 8 to `docs/DECISIONS.md`.

## 5. Tests

Unit tests import through the module indexes; seeded tests use mulberry32 with seed `20261011`. Measured values are from the prototype.

| File · test | Fixture and how it is made | Tolerance (measured) |
| ----------- | -------------------------- | -------------------- |
| `lens.test.ts` · closed form vs proj4 | Poses below. 50 seeded points per pose and lens inside the field. `projectAzAltDeg` with roll 0, k = 0, no flip; unit-focal x = (u − cx)/f, y = (cy − v)/f. proj4 through the helper below. | ‖Δ‖ ≤ 1e-12·max(1, ‖p‖) (worst 2.1e-15, 0.0012 of the bound over 2,200 points). proj4's inverse returns the sample within 1e-9° (3.1e-12°). |
| `lens.test.ts` · orientation | West-facing: az₀ 270, alt₀ 20, f 2742, cx 1920, cy 1080 | ± 1e-3 px: az 300 alt 20 → (3381.180, 946.092); az 240 → u 458.820; az 270 alt 40 → v 81.994 |
| `lens.test.ts` · zenith fisheye | `syntheticFisheyeCalibration(1024)`, alt 0 exactly | ± 1e-9 px, as pixels (u, v): N (512, 0), E (0, 512), S (512, 1024), W (1024, 512), which are the README's map coordinates [u, H − v] N [512, 1024], E [0, 512], S [512, 0], W [1024, 512]; with `flipX`, E (1024, 512), W (0, 512). S must project (G1). |
| `lens.test.ts` · HFOV | inline | `hfovDeg("rectilinear", 3840, 2742)` 70.0009 ± 1e-4; `focalPxForHfov("rectilinear", 3840, 70)` 2742.044 ± 1e-3; f for 180° at W 1232: 392.158, 435.578, 308.000, 616.000 ± 1e-3; f → HFOV → f relative 1e-12 (1.2e-15) |
| `lens.test.ts` · distortion bounds (k2 = 0) | bisection on `createCameraModel` + `distortionValid` | ± 1e-5: StarCam (3840 × 2160, f 2742) −0.22909 = (m − 1)(2 + m)²/(27r_dc²) with m 0.05, r_dc 0.80339; 1232² with f = 616/`horizonRadiusUnit`: −0.12834, −0.15833, −0.07917, −0.31667 = (m − 1)/(3r_h²). Valid at bound + 1e-6, invalid at bound − 1e-6. |
| `lens.test.ts` · culls | inline | zenith alt 0 true, −0.001 false; orthographic alt −30 false (it would fold onto +30); rectilinear behind the camera false; NaN false |
| `lens.test.ts` · `normalizeCalibration` | equidistant f 375, 2,000 seeded points | (37, 89.9999, 150) locked → (0, 90, 113), shift ≤ 1e-3 px (6.5e-4); then 90 → 89.95 shift ≤ 0.5 px (0.33) |
| `inverse.test.ts` · round trips | 200 seeded valid calibrations per lens: random roll and `flipX`, k1 ∈ ±0.1, k2 0 or ±0.01, cx/cy ± 20 px, 30 % locked fisheyes; 50 in-frame pixels each (fisheye pixels outside the circle skipped) | pixel → sky → pixel < 1e-6 px (7.3e-12); sky → pixel → sky < 1e-9° (1.4e-12); 0 failures in 50,000 |
| `inverse.test.ts` · edges | inline | principal point of an (300, 20) camera → exactly (300, 20); `undistortRadius(0.80339, −0.2293, 0)` converges (9 iterations), −0.2296 → null; at each lens's 0.05-margin bound (the bounds row above) every radius up to `rMaxUnit` converges in ≤ 8 iterations; pixel (5, 5) of a 1232² zenith fisheye → false; NaN → false |
| `coverage.test.ts` | f 2742, 3840 × 2160, az₀ 90, roll 0 | ± 0.05°: alt₀ 0 → 55.00–125.00; 20 → 48.98–131.02; 45 → 31.47–148.53; roll 5 at 20 → 49.79–131.53; 68 → 0.77–179.23; 68.6 → full; az₀ 350 at 20 → 308.98–31.02; zenith fisheye and a 2° tilted fisheye → full |
| `geopose.test.ts` · mapping | per lens 400 seeded poses (25 % locked fisheyes, random `flipX`, k1 0.02, f 800) × 20 points: project through the `geoPoseRotation(toGeoPose(…))` body axes (b = Rᵀd, right = −b_y, up = b_z), the lens and the tail | ≤ 1e-9 px vs `projectAzAltDeg` (1.4e-12) |
| `geopose.test.ts` · zenith and round trips | inline and seeded | `geoPoseRotation(100, −90, −10)` = `(90, −90, 0)` ± 1e-15; `fromGeoPose(yaw, −90, roll)` → (0, 90, `wrap180(roll + yaw − 90)`) ± 1e-9 for 2,000 pairs; to → from → to matrices ± 1e-12 over 10,000 poses (1.1e-15); a locked camera with stored `azDeg` 37 exports yaw 90 |
| `geopose.test.ts` · schema | vendored schema, `tests/fixtures/geopose/*` | sha256 equals the pin; the 4 instances and an export with `"x-overhead"` are valid; errors exactly: `location` → `["/ must have required property 'position'"]`, yaw `"0"`, NaN or Infinity → `["/angles/yaw must be number"]`, lat 999 → `["/position/lat must be in [-90, 90]"]` |
| `fit.test.ts` · StarCam-like recovery | truth (81.6, 19.9, roll 0.7, f 2700, c (1925, 1075), k1 −0.03); start (81.2, 19.6, 0, 2742, centre, 0); 20 seeded pairs spread over the frame at alt ≥ 10°, 2 px noise per axis | error at 400 unseen in-frame stars at alt ≥ 10° ≤ 0.3° (worst of 100 seeds 0.258°, median 0.052°) |
| `fit.test.ts` · tilt | equidistant truth tilted 2° (az 135, alt 88, roll −45, f 376, c (622, 601), k1 −0.03, `flipX`); start locked (0, 90, 180); 40 seeds × 14 pairs at alt ≥ 20°, 1 px noise | mean `rmsDeg` locked ≥ 0.25 and with `fitTilt` ≤ 0.22 (40-seed means 0.316 and 0.179) |
| `fit.test.ts` · robustness | Nānā ao-like truth (227, 88.25, 45, f 373, c (620, 610), k1 0.003, `flipX`), 14 pairs, 1 px noise; the StarCam truth above, 14 pairs, 2 px | start roll 179° off: all 100 seeds converge with `rmsDeg` ≤ 0.3; StarCam start az +30°: all 50 converge with `rmsDeg` ≤ 0.2; 3 pairs → null |
| `fit.test.ts` · 3σ | the 2° tilt truth, 12 pairs, 1 px noise, pair 0 moved 30 px, 60 seeds; plus 60 clean fits | pair 0 rejected in ≥ 50 (55), no other pair rejected (0); ≤ 2 pairs rejected over the clean fits (1); `distortionValid` holds on every result |
| `fit.test.ts` · `calibrationAcceptance` | hand-made `AcceptancePair` lists | each threshold flips `pass` on its own, including 9 named stars, 0.26° RMS, one 0.51° holdout, no planet, alt 19.9° on a fisheye |
| `calibrationFixture.test.ts` | `cfht-nanaao-pairs.json` (step 18); targets recomputed at `frameTimeMs` from `public/data/stars.json` and `computeBodies` | `calibrationAcceptance(...).pass`; a refit from roll + 3° and f × 1.02 matches the first within 0.01° on every pair (3.4e-11° on the archived frames) |
| `time.test.ts` · `localDateTimeToUtcMs` | inline | exact: ("2026-10-11T06:04:01", Europe/Vaduz) → 04:04:01Z; ("2025-07-15T20:47", Pacific/Honolulu) → 2025-07-16T06:47:00Z; Vaduz 2026-03-29T02:30 → null, 03:00 → 01:00Z; 2026-10-25T02:30 → 00:30Z, 03:00 → 02:00Z; "11-10-2026 06:04:01", "2026-02-30T00:00", "2026-10-11T24:00" and zone "Not/AZone" → null; same results with TZ set to Honolulu and Kolkata |
| `actions.test.ts` · M4 actions | `createAppStore` with the committed registry, `vi.setSystemTime` | exact. On `synthetic-maunakea`: `updateCalibration({ azDeg: 37 })` stores `azDeg` 0, `rollDeg` 143 (`wrap180(180 − 37)`) and `updatedAtMs` = now; `updateCalibration({ k1: −0.5 })` fails `distortionValid` (g′ at r = π/2 is −2.70) and leaves `camera.calibration` the same reference. `importCalibration` and `applyFit` normalize and reject the same way; `applyFit` also stamps `updatedAtMs` and writes each pair's `residualPx` and `rejected` and the `fit` summary. `resetCalibration` deletes the entry. A second `addImagePoint` replaces the pending point; `completePair` without one changes nothing; a second pair with the same `targetId` replaces the first. `cancelImagePoint` clears `pendingPx`. `setActiveCamera` resets `calibrationUi` to `{ pairs: [], pendingPx: null, fit: null }` |
| `persist.test.ts` | Map-backed `Storage`; stubs whose `getItem` or `setItem` throw | load drops unknown ids, wrong types and invalid distortion; throwing stubs give defaults and no exception; export → parse round-trips; a file with another lens or size is rejected with a message |
| `bindBackground.test.ts` | store from `createAppStore`; a real `ImageLayer`; fake `start` capturing its projection and options; `vi.setSystemTime` | load → `frameTimeMs` = load − 40,000, status live, pairs cleared; error at 2026-10-11T08:00Z → offline, at 22:00Z → daytime; panel open → stopped, close → restarted, never two loops at once; camera change → stopped and `setSource(null)`; after `synthetic-maunakea` → `cfht-nanaao` the projection passed to `start` has code `sky-px-1232x1232`; options carry the camera's `imageUrl`, `refreshSec` and `corsEnabled`. (The `crossOrigin` mapping lives in `startStillImageRefresh` and was checked in Chromium: `"anonymous"` sends `Origin`, `null` does not.) |
| `arcs.test.ts` | committed ISS OMM | step s, object i of an arc buffer equals `writeSample` at `startMs + s·stepMs`, bit for bit |

Cross-check poses (A₀, h₀): (81.2, 19.6), (270, 20), (0, 0), (180, 45), (300, −5), (123.4, 67.8), (200, 80), (37, 86.3), and zenith-locked (0, 90) for the fisheyes. Rectilinear points are unprojected uniform pixels of 3840 × 2160 at f 2742; fisheye points are uniform on the sphere within 90° of the axis, at f = 616/`horizonRadiusUnit`, 1232². The helper:

```ts
import proj4 from "proj4";
import type { LensModel } from "../../src/domain/camera";

const SKY = "+proj=longlat +R=1 +no_defs";
const PROJ: Record<LensModel, string> = {
  rectilinear: "gnom",
  "fisheye-equidistant": "aeqd",
  "fisheye-equisolid": "laea",
  "fisheye-stereographic": "stere",
  "fisheye-orthographic": "ortho",
};

/** proj4's unit-focal (x right, y up) for an optical axis at (axisAzDeg, axisAltDeg). A zenith-locked fisheye passes (0, 90). */
export function proj4UnitXY(lens: LensModel, axisAzDeg: number, axisAltDeg: number, azDeg: number, altDeg: number): [number, number] {
  // gnom and laea return NaN unless both +x_0=0 and +y_0=0 are given.
  const conv = proj4(SKY, `+proj=${PROJ[lens]} +lat_0=${axisAltDeg} +lon_0=${axisAzDeg} +x_0=0 +y_0=0 +R=1 +no_defs`);
  return conv.forward<[number, number]>([azDeg, altDeg]); // without the type argument the result is number[]
}
```

### End-to-end: `tests/e2e/calibration-export.spec.ts`

Each test calls `page.clock.install({ time: new Date("2026-10-11T08:00:00Z") })` (22:00 HST) before `goto("/?cam=cfht-nanaao")`, then `page.clock.runFor(1000)` so the app renders. The CFHT mock serves the 256 × 256 `tile.jpg`. A test that expects console errors removes exactly those from the shared guard at its end; the guard object is shared by reference, so M0's fixture stays unedited:

```ts
import type { Guard } from "./fixtures";

/** Drops expected console errors before the shared guard checks them at teardown. Call at the end of the test. */
function allowConsoleErrors(guard: Guard, allowed: readonly RegExp[]): void {
  const rest = guard.consoleErrors.filter((m) => !allowed.some((re) => re.test(m)));
  guard.consoleErrors.splice(0, guard.consoleErrors.length, ...rest);
}
```

1. **No-CORS still image, 60 s refresh.** A `page.route` on `last_vis.png` records each request's URL and `await route.request().allHeaders()`. The first URL ends `last_vis.png?t=<digits>` and its headers have no `origin` key. The picker shows "Live"; the size notice reads 256 × 256 against 1232 × 1232. `fastForward(30_000)` then `runFor(100)`: still 1 request. `fastForward(31_000)` then `runFor(100)`, then poll (`expect.poll`, the request arrives asynchronously): exactly 2, with different `t`.
2. **404 means offline.** The route fulfils 404. The picker shows "Offline" and the camera credit is still visible. Then `allowConsoleErrors(guard, [/^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/, /^EncodingError: The source image cannot be decoded\.$/])`; a fulfilled 404 image logs exactly these two. Save this test's screenshot for the PR.
3. **Export calibration JSON.** Press `C`, click "Export JSON", take `page.waitForEvent("download")`, read `download.path()`: `format` `"overhead.calibration"`, `version` 1, `cameraId` `"cfht-nanaao"`, calibration equal to the registry defaults.
4. **Export GeoPose validates.** Click "Export GeoPose"; the download passes `validateGeoPose` in Node and its angles equal `toGeoPose(defaults)` within 1e-9: yaw −137.3, pitch −88.26, roll 44.8; position (19.8253, −155.4689, h 4228.23).
5. **Keyboard and persistence.** With the panel open, blur the active element first, so that neither a panel input (the handler ignores inputs, and a focused range input would take the arrow itself) nor the focused map (whose `KeyboardPan` takes it) has focus. Press → once: the azimuth input reads 227.35. Reload: still 227.35. On `?cam=synthetic-maunakea` (zenith-locked), → turns roll 180 into −179.95 and the azimuth input is disabled; Shift+↓ gives altitude 89.50 and enables it.
6. **Import rejects a foreign file.** `setInputFiles` with a `CalibrationFileV1` whose `lens` is `"rectilinear"`: the live region names the lens mismatch and the calibration is unchanged.
7. **Pair flow.** Click the image 4 times; after each click choose the first of the 3 nearest. The pair table has 4 rows and Fit is enabled; pressing it announces either a result or "Fit failed" in the live region.

## 6. Acceptance criteria and PR evidence

1. `npm run typecheck`, `lint`, `test`, `build` and `e2e` pass in CI. Paste the Vitest summary listing every file in section 5.
2. Every tolerance in section 5 holds.
3. `calibrationFixture.test.ts` passes on the committed real-frame fixture: ≥ 10 named stars at alt ≥ 20°, RMS ≤ 0.25°, every fit star ≤ 0.5°, 1 planet and 3 held-out stars ≤ 0.5°. Paste the printed acceptance report.
4. `calibration-export.spec.ts` passes; the exported GeoPose validates against the vendored schema.
5. Screenshot: Nānā ao with the overlay after the fit, the panel's checklist all passing, the credit and licence link. Visual design is settled from this screenshot.
6. A clip of 30 s or less: a keyboard nudge, a pair made through the 3-nearest list, Fit, then Export GeoPose.
7. Screenshot of the picker showing "Offline", from e2e test 2.
8. `npm run build`: `grep -c "must have required property"` prints 0 for the propagation worker chunk, which starts importing the camera module in M8.
9. `DECISIONS.md` holds section 8 plus the chosen lens, tilt and RMS from step 18.

## 7. Gotchas

- **G1. cos 90° ≠ 0.** `Math.cos(π/2)` is 6.1e-17, so a zenith model built with plain trig gets cos c = −6.1e-17 at the S horizon and culls it. Use exact 1 and 0 at h₀ = 90 (found here).
- **G2. proj4 traps.** `gnom` and `laea` need both `+x_0=0` and `+y_0=0`. `const p = conv.forward([az, alt])` is `number[]`, so `p[0]` is `number | undefined` (TS2322). The inverse returns azimuth in (−180°, 180°] and NaN at the gnomonic centre; ortho gives `undefined` below its horizon; non-finite input throws. Sample only points inside the field: whole-hemisphere gnomonic sampling fails about 1 % of trials ([proj4-lens.md](../verification/proj4-lens.md) claims 4, 5, 7, 10, 12, 17).
- **G3. Folds.** Orthographic maps alt −30 onto +30: cull before projecting. Negative k1 folds at r = 1/√(−3k1), inside the image circle for k1 = −0.2 ([proj4-lens.md](../verification/proj4-lens.md) claims 1, 4, 6).
- **G4. g′ > 0 is not enough for a 10-step Newton.** At the exact bound the iteration slows: with margins of 0 and 0.004, one radius per fisheye bound needed more than 10 iterations; 0.01 needed 10, 0.02 needed 9–10, and 0.05 at most 8 for all five lenses. Hence `MIN_DISTORTION_SLOPE` 0.05, which moves the StarCam's k1 floor only from −0.22953 to −0.22909.
- **G5. The zenith is degenerate and real all-sky cameras tilt.** Nānā ao is tilted about 1.7°: a zenith-locked fit left RMS 0.20° and 0.29° (worst 0.42° and 0.52°; the second frame fails acceptance) where the tilted fit gave 0.04°. Synthetic 2° and 3.7° tilts left 0.32° and 0.51° locked ([architecture.md](../verification/architecture.md) claim 20). Hence rotation increments and `fitTilt`.
- **G6. The fit's basin.** Without stage A and without dropping the frame cull inside the fit, rough starts fail (step 6, items 3 and 6). Never call `projectAzAltDeg` inside the cost function.
- **G7. 3σ against the overall RMS cannot catch one bad pair in a small set.** One residual can never exceed 3 × the RMS of n ≤ 9 values. That rule caught 0 of 60 wrong clicks at n = 10 and 29 of 60 at n = 12; comparing with the RMS of the other pairs caught 50 and 55. A median-based σ rejected up to 14 good pairs per 60 fits.
- **G8. GeoPose traps** ([geopose.md](../verification/geopose.md) claims 2, 3, 7, 11): naive `yaw = 90 − az` on a locked fisheye with stored az 37 gives yaw 53 instead of 90; flipping the roll sign moved StarCam pixels up to 305 px; the compass convention (yaw = az, pitch = +alt) puts points behind the camera; the official instances are in radians (schema checks only); the default `import Ajv` fails under `nodenext`; ajv compiles with `new Function`, which a CSP without `'unsafe-eval'` blocks.
- **G9. Compile ajv lazily.** With a module-level `compile`, every bundle that imports the camera index carries ajv: a worker-like bundle grew from 2.3 kB (1.1 kB gzipped) to 122.3 kB (36.1 kB) under rolldown 1.2.13. The M8 propagation worker imports the camera module.
- **G10. `ImageStatic` reloads only by swapping the source.** It has no `setUrl`, and `source.refresh()` makes no request. The swap loads during a render pass, waits while the view animates, and keeps the old image until the new one decodes ([openlayers.md](../verification/openlayers.md) claim 11). In Chromium the decoded image is an `ImageBitmap`, which has no `naturalWidth`.
- **G11. Nānā ao has no CORS headers.** With `crossOrigin` set, a real server without CORS fails the load and logs three errors. Playwright-fulfilled responses load either way, so the e2e test asserts the absence of the `Origin` request header; route handlers do not see `sec-fetch-mode` ([sources.md](../verification/sources.md) claim 7).
- **G12. Failed image loads log console errors.** `ol/Image.js:191` calls `console.error` ("EncodingError: The source image cannot be decoded."), and a route-fulfilled 404 adds "Failed to load resource … 404 (Not Found)". A closed hatch logs at least the OpenLayers error once a minute in production (a real-server 404 logged only that one); only e2e test 2 allows them.
- **G13. 404 means the hatch is closed, even at night**, and even at 73.7 % humidity ([sources.md](../verification/sources.md) claim 6). Do not use `last.png` (a 3-panel mosaic). `last_ir.png` (1240 × 1227) is a second camera: DECISIONS allows it, but it needs its own registry entry and calibration, so M4 ships only `last_vis.png`.
- **G14. Time errors hide in the pose.** Stars move 0.25° per minute at dec 0 ([architecture.md](../verification/architecture.md) claim 21). A free-axis fit absorbs a wrong frame time as a rotation, so the stars still fit but the pose is wrong by that rotation and shows on the next frame (30 s = 0.125°). Enter the stamp, use the +30 s rule, and keep the image frozen while calibrating.
- **G15. Saturated objects are elongated blobs.** V < 0.5 stars and the planets are 5–8 px saturated smears in Nānā ao frames. A centroid around the brightest pixel was 1.6–4.5 px (0.2–0.5°) off; the whole blob's centroid was within 0.3–1.6 px (Jupiter 0.9 px, 0.14°). Click the middle of the whole blob.
- **G16. Spread the pairs.** 12 random StarCam pairs gave a median worst unseen error of 0.10°, but 0.75° in the worst of 100 draws; 20 pairs gave 0.26° worst. On the real frames, 12 random named stars with 1 px click noise met the acceptance in 26 and 27 of 30 draws.
- **G17. Rounding.** With the usual modulo form, `((d + 180) % 360 + 360) % 360 − 180`, `wrap180(44.8)` is 44.799999999999955. Compare angles with a tolerance, never with `===`.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M4's contract lines under "Contract changes from the implementation docs": `MIN_DISTORTION_SLOPE` 0.05, and `fitTilt` with `normalizeCalibration`. Append the rest.

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
- GeoPose export adds `"x-overhead"` (camera id, lens, convention, height datum); import applies angles only, from the rotation matrix, warning beyond 0.01° or 100 m. Reason: OGC's own examples use another convention ([geopose.md](../verification/geopose.md) claim 3).
- `validateGeoPose` compiles on first call. Reason: ajv stays out of bundles that never validate (2.3 kB against 122.3 kB).
- Calibration files are `overhead.calibration` version 1; localStorage is written on every calibration change, and invalid stored entries are dropped. Reason: small data; no throttle needed.
- Exposure arcs: a worker `arc` message on a 5 s grid over the exposure, sunlit segments only, live mode only. Reason: 5 s chords stay within 0.1 px of the ISS path.
- The e2e CFHT and AllSkyKamera mocks serve `tile.jpg`; a test that expects console errors removes exactly those from the shared guard at its end. Reason: no new image fixture, and M0's guard stays unedited.

