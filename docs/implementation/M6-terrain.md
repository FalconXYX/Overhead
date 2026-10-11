# M6 · Terrain

Branch `m6-terrain`, one pull request. Read [README](README.md) sections 2, 3 and 7 first. This file uses the paths, types and names defined there and does not restate them. [`../DECISIONS.md`](../DECISIONS.md) wins over both.

Numbers without a citation were measured for this file on 2026-10-11 with the pinned packages (ol 10.11.0, astronomy-engine 2.1.19, TypeScript 7.0.2, Vitest 5.0.3, Biome 2.5.15, Playwright 1.64.0 driving headless Chromium 156 on SwiftShader). They came from a prototype of every module below, run against live S3 tiles and against the fixtures this milestone commits. Every code block was type-checked with tsc 7.0.2 (`strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, the lib of its tsconfig), formatted and linted with the M0 Biome config, and executed: domain code in Vitest, the worker and the hillshade in headless Chromium (`HorizonWorkerLike` is a type, checked with a fake). A second, independent prototype re-ran every block and number on the same day: a fresh tile download, a separate PNG decoder and tile planner, the worker against live S3 and a fulfilled route, and the hillshade pixel check on SwiftShader.

## 1. Goal

Give every camera a real horizon and give the ground map a relief lit by the real Sun. A module worker fetches Terrarium elevation tiles around the active camera, marches 360 rays and returns the apparent altitude of the terrain horizon per degree of azimuth. The sky view draws that profile through the camera model as a filled skyline; anything below it is dimmed, flagged in the Inspector and no longer counts as visible. The ground map gains a WebGL hillshade lit by the Sun at the clock time.

Out of scope:

- The footprint's horizon clip and the incoming chip (M8). They read the same profile through `horizonAltAtAzDeg`.
- Buildings and domes. The DEM is bare earth ([terrain.md](../verification/terrain.md) claim 9).
- Per-view terrain credits built from tile headers. M6 shows the full required list (step 12).
- A canvas-free PNG decoder for Brave (gotcha 6).
- `ask053-walenstadt`, unless its owner has granted permission in writing (step 15).
- Visual design. Colours, opacity, line weight and panel placement are settled during the build from screenshots. This file specifies behaviour, content, states, keyboard and accessibility.

## 2. Prerequisites

- M4 is merged (camera model with all lenses, `unprojectPixel`, `bindSkyCamera`, Inspector, CameraPicker). M5 is merged in build order, so `subaru-starcam`, the two clip cameras and `bindSkyLayerVisible` exist. Nothing here depends on the video itself.
- No accounts and no keys. Terrarium tiles are public on S3 with `Access-Control-Allow-Origin: *` ([terrain.md](../verification/terrain.md) claim 1).
- One network task, by hand, once: run `scripts/fetch-terrain-fixture.ts` (step 5) and commit its output (6.7 MB).
- Decisions ([DECISIONS](../DECISIONS.md)):
  - O3 (open): M6 uses only fields already in the approved store (`data.horizon`, `layers.horizon`, `layers.hillshade`, `setHorizon`). If O3 changes: propose `HorizonData` and `setHorizon` in this pull request.
  - O1: the horizon layer is part of the light set drawn over the video (README [Sky over video](README.md#sky-over-video) rule 1: the skyline plus behind-terrain dimming). It is the same layer on every camera kind, bound through `bindSkyLayerVisible` (step 9).
  - O2: `subaru-2026-10-11-iss` copies `subaru-starcam`'s site, so its profile equals the StarCam's; `cameraHeights.test.ts` covers it (section 5). O4: the fixture script uses `node:zlib`'s `crc32`, checked present in Node 26.11.1 (`crc32("hello")` is `0x3610a686`).

## 3. Deliverables

New files:

| Path | Content |
| ---- | ------- |
| `src/domain/terrain/terrarium.ts` | `TERRARIUM_URL`, `TERRARIUM_MAX_ZOOM`, `TILE_SIZE_PX`, `decodeTerrariumM`, `decodeTerrariumTile` |
| `src/domain/terrain/horizon.ts` | `REFRACTION_KAPPA`, `EARTH_RADIUS_M`, `apparentElevationDeg`, `zoomForDistanceM`, `marchLimitM`, `marchRay`, `horizonProfileDeg`, `horizonAltAtAzDeg`, `texelGroundM`; imports only types from `tiles.ts` |
| `src/domain/terrain/tiles.ts` | `TileZoom`, `TileKey`, `ElevationSampler`, `tileId`, `lonLatToWorldPx`, `createTileSampler`, `tilesForSite` |
| `src/domain/terrain/index.ts` | re-exports the three files |
| `src/workers/horizon.worker.ts` | fetch, decode, march; README section 5 protocol |
| `src/map/sky/layers/horizon.ts` | skyline line and fill: `createHorizonLayer`, `buildSkylineCoords` |
| `src/map/ground/layers/hillshade.ts` | `createHillshadeLayer`, `COS_INCIDENCE` |
| `src/map/sync/bindHorizon.ts` | `HorizonWorkerLike`, `bindHorizonWorker`, `bindSkyHorizon` |
| `src/map/sync/bindHillshade.ts` | `bindHillshadeTexel`, `bindHillshadeSun` |
| `scripts/fetch-terrain-fixture.ts` | writes `tests/fixtures/terrain/` |
| `tests/helpers/decodePng.ts` | `decodePng(bytes)` with `node:zlib` |
| `tests/helpers/terrainFixtures.ts` | `fixtureSampler(site, keys)` (step 5) |
| `tests/fixtures/terrain/walenstadt/{z}/{x}/{y}.png`, `sources.json` | 45 tiles, 5.58 MB |
| `tests/fixtures/terrain/maunakea/{z}/{x}/{y}.png`, `sources.json` | 10 tiles, 1.15 MB |
| `tests/fixtures/terrain/flat.png` | 564 B, (128, 0, 0) everywhere |
| `tests/unit/horizon.test.ts`, `cameraHeights.test.ts`, `skyHorizon.test.ts`, `bindHorizon.test.ts`, `hillshade.test.ts`, `bindHillshade.test.ts` | section 5 |
| `tests/e2e/terrain.spec.ts` | section 5 |

Changed files:

| Path | Change |
| ---- | ------ |
| `src/domain/geo/index.ts` | `destinationLatLonDeg` |
| `src/workers/protocol.ts` | `HorizonIn`, `HorizonOut` exactly as in README section 5 |
| `src/state/actions.ts` | `setHorizon` (replaces M0's "lands in M6" stub) |
| `src/state/selectors.ts` | `selectHorizonProfileDeg`, `selectHorizonStatus`, exactly as in the [README](README.md#selectors) (each selector lands with its first user) |
| `src/state/ephemeris.ts` | in `updateEphemerisFrame` (M3 step 11), pass the terrain horizon to `isVisible` instead of 0, and include the profile in the loop's skip check (step 10) |
| `src/app/cameras.ts` | add `"synthetic-walenstadt"` to `ENABLED_CAMERA_IDS` (step 8) |
| `src/map/sky/createSkyMap.ts` | horizon layer; `SkyMapHandle.horizonLayer`, `setHorizonProfile` |
| `src/map/ground/createGroundMap.ts` | hillshade layer and its three bindings |
| `src/ui/SkyView.tsx` | start `bindHorizonWorker` and `bindSkyHorizon`; "behind terrain" in the text-alternative lists (step 10) |
| `src/ui/GroundView.tsx` | night badge |
| `src/ui/Inspector.tsx` | terrain line and "Behind terrain" flag |
| `src/ui/LayerToggles.tsx` | `horizon` and `hillshade` toggles, horizon status text |
| `src/app/credits.ts`, `src/ui/Credits.tsx` | terrain credits |
| `public/data/cameras.json` | `site.mastM` 0 → 33 for `synthetic-maunakea`, `cfht-nanaao` and `cfht-starcam` (step 8; Parth to confirm, [README](README.md#assumed-until-parth-confirms)). The `synthetic-walenstadt` entry is already there from M1 and does not change. |
| `tests/e2e/fixtures.ts` | S3 Terrarium route inside M1's `routes` fixture |
| `tests/unit/visibility.test.ts` | horizon cases |
| `tests/unit/store.test.ts` (M0) | "every later action throws": drop `setHorizon` from the list and lower the expected count by 1 |
| `tests/unit/actions.test.ts`, `selectors.test.ts` | `setHorizon` merge from the idle default; both horizon selectors with and without an entry |
| `tests/unit/cameras.test.ts` (M1) | the expected `enabledCameras` ids gain `synthetic-walenstadt`, in file order |
| `tests/e2e/ground-map.spec.ts` (M1) | "URL fallbacks": drop the `?cam=synthetic-walenstadt` case, which now loads that camera. Every committed camera is enabled from here on, so only the unknown id `nope` and the zone-less `t` remain |
| `docs/DECISIONS.md`, `README.md` | section 8; M6 section with the fixture command |

## 4. Steps

Build in this order. For every formula, write the failing test from section 5 first.

### Step 1. Formulas: `terrarium.ts` and the top of `horizon.ts`

1. `decodeTerrariumM(r, g, b) = r·256 + g + b/256 − 32768`, channels 0–255. `decodeTerrariumTile(rgba, out)` reads R, G, B of each RGBA pixel, ignores alpha, and writes `Float32Array(65536)` row-major from the north-west corner.
2. `apparentElevationDeg(zM, z0M, dM) = atan((zM − z0M − dM²(1 − κ)/(2R))/dM)` in degrees, κ = `REFRACTION_KAPPA` 0.13, R = `EARTH_RADIUS_M` 6,371,000. The curvature term is 6.828e-8 m⁻¹ × d². No clamping here. The result is already apparent ([README Refraction](README.md#refraction) item 4).
3. `zoomForDistanceM(d)`: 14 for d < 1,500 m, 12 for < 8,000, 10 for < 30,000, 9 for < 60,000, else 8. Each boundary belongs to the coarser zoom.
4. `marchLimitM(z0M) = max(100,000, 1.05·√(2R·max(z0M, 0)/(1 − κ)))`. Clamp z0 first: a site below sea level gives `sqrt(negative) = NaN`, and `Math.max(100000, NaN)` is NaN. Values: 100,000 m for Walenstadt, 258,790 m for the Subaru StarCam (z0 4,147.6 m), 260,543 m for z0 = 4,204 m.
5. `texelGroundM(tileZ, latDeg) = 40,075,016.686/(256·2^tileZ)·cos(lat)`: 26.0 m at z12 at Walenstadt.

### Step 2. `destinationLatLonDeg` in `src/domain/geo`

Great-circle destination on the sphere of `EARTH_MEAN_RADIUS_KM`: δ = d/R, φ₂ = asin(sin φ₁ cos δ + cos φ₁ sin δ cos θ), λ₂ = λ₁ + atan2(sin θ sin δ cos φ₁, cos δ − sin φ₁ sin φ₂). Write `[latDeg, lonDeg]` with longitude wrapped to [−180, 180). The 1.4 ppm difference from `EARTH_RADIUS_M` is 0.35 m at 250 km and does not matter. Do not step in EPSG:3857 metres: at 47° N that puts the Churfirsten at 23.5° instead of 32.7° ([terrain.md](../verification/terrain.md) claim 7).

### Step 3. Tile plan and sampler: `tiles.ts`

1. `lonLatToWorldPx` is the README formula. The −0.5 puts pixel centres on integers, which is what bilinear sampling needs.
2. `tileId(z, x, y) = (z·2^15 + x)·2^15 + y`. The sampler runs about 200,000 times per profile, so map keys are numbers, never strings.
3. `createTileSampler(tiles)` returns the `ElevationSampler`. The four texels of one sample can sit in four different tiles; x wraps at the antimeridian and y clamps at the poles. A missing tile gives NaN.

```ts
/** Numeric Map key, no string allocation per sample: (z·2^15 + x)·2^15 + y. */
export function tileId(z: number, x: number, y: number): number {
  return (z * 32_768 + x) * 32_768 + y;
}

/** Bilinear sampler over decoded tiles (Float32Array(65536) each, keyed by tileId); NaN when a needed tile is missing. */
export function createTileSampler(tiles: ReadonlyMap<number, Float32Array>): ElevationSampler {
  const px = new Float64Array(2);
  const texel = (z: number, x: number, y: number): number => {
    const n = 2 ** z;
    const tx = (((x >> 8) % n) + n) % n; // wrap the antimeridian
    const ty = Math.min(Math.max(y >> 8, 0), n - 1);
    const tile = tiles.get(tileId(z, tx, ty));
    if (tile === undefined) return Number.NaN;
    const row = Math.min(Math.max(y - ty * 256, 0), 255);
    return tile[row * 256 + (x & 255)] ?? Number.NaN;
  };
  return (latDeg, lonDeg, _dM, zoom: TileZoom) => {
    lonLatToWorldPx(lonDeg, latDeg, zoom, px, 0);
    const X = px[0] ?? 0;
    const Y = px[1] ?? 0;
    const x0 = Math.floor(X);
    const y0 = Math.floor(Y);
    const fx = X - x0;
    const fy = Y - y0;
    // The four texels may lie in up to four different tiles.
    const top = texel(zoom, x0, y0) * (1 - fx) + texel(zoom, x0 + 1, y0) * fx;
    const bottom = texel(zoom, x0, y0 + 1) * (1 - fx) + texel(zoom, x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}
```

4. `tilesForSite(latDeg, lonDeg, limitM, azimuthsDeg?)` walks the same march as step 4 (call `marchRay`; never write a second loop) and collects, for every sample, the tiles of its four bilinear texels at `zoomForDistanceM(d)`, plus the site's own z14 tiles. `azimuthsDeg` defaults to 0…359; the fixture script passes `[0]`. `tilesForSite(lat, lon, 0)` returns only the site tiles. Measured plans:

| Site | z0 (m) | Limit | Tiles (z8/z9/z10/z12/z14) | Size |
| ---- | ------ | ----- | ------------------------- | ---- |
| `synthetic-walenstadt` | 467.6 | 100 km | 45 (7/9/9/11/9) | 5.58 MB |
| `subaru-starcam` | 4,147.6 | 258.8 km | 44 | 5.27 MB |
| `synthetic-maunakea`, `mastM` 33 | 4,203.9 | 260.5 km | 46 | 5.48 MB |

Planning takes 0.2–0.4 s in Node; it runs inside the worker.

### Step 4. The march: `horizonProfileDeg` and `horizonAltAtAzDeg`

```ts
const point = new Float64Array(2);
/** The one march: d = 20 m, then d += max(10 m, 0.01·d) while d ≤ limitM. Shared by the profile and the tile plan. */
export function marchRay(
  latDeg: number,
  lonDeg: number,
  azDeg: number,
  limitM: number,
  visit: (latDeg: number, lonDeg: number, dM: number, zoom: TileZoom) => void,
): void {
  for (let d = 20; d <= limitM; d += Math.max(10, 0.01 * d)) {
    destinationLatLonDeg(latDeg, lonDeg, azDeg, d, point, 0);
    visit(point[0] ?? 0, point[1] ?? 0, d, zoomForDistanceM(d));
  }
}

export function horizonProfileDeg(
  sample: ElevationSampler,
  latDeg: number,
  lonDeg: number,
  z0M: number,
  limitM: number,
  out: Float32Array,
): void {
  for (let az = 0; az < 360; az++) {
    let bestTan = Number.NEGATIVE_INFINITY; // atan is monotonic: keep the largest tangent, one atan per ray
    marchRay(latDeg, lonDeg, az, limitM, (la, lo, d, zoom) => {
      const z = sample(la, lo, d, zoom);
      if (Number.isNaN(z)) return; // missing tile (tests only; the worker never marches with gaps)
      const t = (Math.max(z, 0) - z0M - d * d * CURVATURE_PER_M) / d; // max(z, 0): ocean pixels are seabed
      if (t > bestTan) bestTan = t;
    });
    out[az] =
      bestTan === Number.NEGATIVE_INFINITY ? Number.NaN : (Math.atan(bestTan) * 180) / Math.PI;
  }
}
```

- `CURVATURE_PER_M` is `(1 − REFRACTION_KAPPA)/(2·EARTH_RADIUS_M)`, private to `horizon.ts`.
- A ray has 561 samples to 100 km and 657 to 258.8 km, about 202,000–237,000 per profile.
- The exact sequence matters for the plateau test: the first sample past 10 km is 10,059.09 m (the one before is 9,959.50 m), so the march returns 5.6383°, inside 5.67 ± 0.05°.
- `horizonAltAtAzDeg(profile, azDeg)` interpolates linearly between the two neighbouring whole degrees, wrapping 359 → 0, and returns 0 when `profile` is null. This is the README section 6 rule; an earlier draft used the nearest degree. The Walenstadt profile changes by up to 1.47° between neighbouring degrees (az 121–122), so nearest-degree lookup can disagree with the drawn skyline by 0.74°, which is 35 px on the Subaru frame.

### Step 5. Fixtures and the PNG helper

1. `tests/helpers/decodePng.ts`: `decodePng(bytes: Uint8Array): { width, height, rgba: Uint8ClampedArray }`. Walk the chunks; require IHDR bit depth 8, colour type 2, interlace 0; concatenate every IDAT; `inflateSync`; reverse the row filters 0–4 (None, Sub, Up, Average, Paeth) with 3 bytes per pixel and 769 bytes per row (1 filter byte + 768). Expand to RGBA with alpha 255. This decode gave profiles identical (max difference 0) to the browser's `createImageBitmap` path in step 6.
2. `scripts/fetch-terrain-fixture.ts`, run by hand with `npx tsx scripts/fetch-terrain-fixture.ts`:
   - `walenstadt/`: every tile of `tilesForSite(47.1236, 9.3242, 100_000)`.
   - `maunakea/`: `tilesForSite(19.82552, -155.47587, marchLimitM(4148), [0])`, the Subaru StarCam's open-ocean azimuth 0°. Its 10 tiles are `14/1116/7270`, `14/1116/7271`, `12/279/1816`, `12/279/1817`, `10/69/453`, `10/69/454`, `9/34/226`, `8/17/111`, `8/17/112`, `8/17/113`. `14/1116/7271` also holds the CFHT point used by `synthetic-maunakea`, `cfht-nanaao` and `cfht-starcam` (step 8). The test's limit, `marchLimitM(4147.6)` (258,789.7 m), is 12.5 m shorter than `marchLimitM(4148)`; it needs the same 10 tiles (checked).
   - Plain `fetch(url)` per tile; stop at the first non-200. Write `<site>/<z>/<x>/<y>.png` byte for byte, and `<site>/sources.json` mapping `"z/x/y"` to the tile's `x-amz-meta-x-imagery-sources` header.
   - Write `flat.png`: a 256 × 256 8-bit RGB PNG of (128, 0, 0), filter byte 0 on every row, IDAT from `deflateSync(raw, { level: 9 })`, chunk CRCs from `zlib.crc32`: 564 bytes. (The default deflate level gives 851 bytes; either decodes the same.)
   - Expected output: `walenstadt: 45 tiles, 5.58 MB`, `maunakea: 10 tiles, 1.15 MB`. Put the command and these numbers in the root README's M6 section.
3. `tests/helpers/terrainFixtures.ts` exports `fixtureSampler(site, keys)`: read each tile with `node:fs`, `decodePng`, `decodeTerrariumTile`, key by `tileId`, return `createTileSampler(map)`. Throw on a missing file, so a fixture test never passes on NaN-skipped samples. The `maunakea` fixture holds only the azimuth-0 ray: a 360° profile over it is finite at other azimuths (every ray starts inside the site's z14 tiles, and the NaN samples beyond are skipped) but meaningless, so its test asserts `profile[0]` only.

### Step 6. The worker: `src/workers/horizon.worker.ts`

Add `HorizonIn` and `HorizonOut` to `protocol.ts` exactly as in [README section 5](README.md#5-worker-protocols). The worker:

```ts
// src/workers/horizon.worker.ts
import {
  createTileSampler,
  decodeTerrariumTile,
  horizonProfileDeg,
  marchLimitM,
  TERRARIUM_URL,
  type TileKey,
  tileId,
  tilesForSite,
} from "../domain/terrain";
import type { HorizonIn, HorizonOut } from "./protocol";

const post = (msg: HorizonOut, transfer: Transferable[] = []): void =>
  self.postMessage(msg, transfer);
const ctx = new OffscreenCanvas(256, 256).getContext("2d", { willReadFrequently: true });

async function loadTile(
  k: TileKey,
  tiles: Map<number, Float32Array>,
  datasets: Set<string>,
): Promise<void> {
  if (ctx === null) throw new Error("OffscreenCanvas 2D context unavailable");
  const url = TERRARIUM_URL.replace("{z}", String(k.z))
    .replace("{x}", String(k.x))
    .replace("{y}", String(k.y));
  const res = await fetch(url); // plain GET: no custom headers and never HEAD (S3's CORS rejects both)
  if (!res.ok) throw new Error(`terrain tile ${k.z}/${k.x}/${k.y}: HTTP ${res.status}`);
  // "srtm/N19W156.tif, gmted/…, etopo1/ETOPO1_Bed_g.tif" → dataset prefixes
  for (const file of (res.headers.get("x-amz-meta-x-imagery-sources") ?? "").split(",")) {
    const dataset = file.trim().split("/")[0];
    if (dataset) datasets.add(dataset);
  }
  const bmp = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  ctx.drawImage(bmp, 0, 0); // no await from here to getImageData, so one shared context is safe
  bmp.close();
  const elevationM = new Float32Array(65536);
  decodeTerrariumTile(ctx.getImageData(0, 0, 256, 256).data, elevationM); // getImageData is on the context
  tiles.set(tileId(k.z, k.x, k.y), elevationM);
}

/** Fetches the missing tiles, 6 at a time; rejects on the first failure. */
async function loadAll(
  keys: readonly TileKey[],
  tiles: Map<number, Float32Array>,
  datasets: Set<string>,
  onTile: () => void,
): Promise<void> {
  const queue = keys.filter((k) => !tiles.has(tileId(k.z, k.x, k.y)));
  const lane = async (): Promise<void> => {
    for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
      await loadTile(k, tiles, datasets);
      onTile();
    }
  };
  await Promise.all(Array.from({ length: 6 }, lane));
}

async function compute({ requestId, cameraId, latDeg, lonDeg, mastM }: HorizonIn): Promise<void> {
  try {
    const tiles = new Map<number, Float32Array>(); // dropped after this compute
    const datasets = new Set<string>();
    await loadAll(tilesForSite(latDeg, lonDeg, 0), tiles, datasets, () => {});
    const groundM = createTileSampler(tiles)(latDeg, lonDeg, 0, 14);
    if (!Number.isFinite(groundM)) throw new Error("no DEM value at the site");
    const z0M = Math.max(groundM, 0) + mastM;
    const limitM = marchLimitM(z0M);
    const plan = tilesForSite(latDeg, lonDeg, limitM);
    let tilesDone = plan.filter((k) => tiles.has(tileId(k.z, k.x, k.y))).length;
    await loadAll(plan, tiles, datasets, () => {
      tilesDone += 1;
      post({ type: "progress", requestId, cameraId, tilesDone, tilesTotal: plan.length });
    });
    const profileDeg = new Float32Array(360);
    horizonProfileDeg(createTileSampler(tiles), latDeg, lonDeg, z0M, limitM, profileDeg);
    const imagerySources = [...datasets].sort();
    post({ type: "done", requestId, cameraId, profileDeg, groundM, z0M, limitM, imagerySources }, [
      profileDeg.buffer,
    ]);
  } catch (err) {
    post({
      type: "error",
      requestId,
      cameraId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<HorizonIn>) => {
  const msg = e.data;
  queue = queue.then(() => compute(msg)); // one compute at a time, in arrival order
};
```

- z0 comes from the z14 tiles at the site, before the plan, because the limit depends on it.
- Any failed tile ends the compute with `error`. Consumers then use the geometric horizon; there is no partial profile.
- `imagerySources` holds dataset prefixes, not file names: `["eudem", "gmted", "srtm"]` at Walenstadt, `["etopo1", "gmted", "ned13", "srtm"]` at Maunakea.
- Measured in headless Chromium: Walenstadt 1.0–1.2 s and Subaru 1.2 s from live S3 (45 and 44 tiles), 0.16–0.21 s from the e2e route. The profiles equal the Node run of step 5 exactly.
- Decoded tiles (256 KB each) are dropped after each compute. Repeat fetches come from the HTTP cache: S3 sends no `Cache-Control`, and `Last-Modified` is from 2017, so browsers cache heuristically ([terrain.md](../verification/terrain.md) claim 1).

### Step 7. Store wiring: `setHorizon` and `bindHorizonWorker`

1. `setHorizon(cameraId, patch)` merges `patch` into `data.horizon[cameraId]`, starting from `{ status: "idle", profileDeg: null, imagerySources: [] }`.
2. `bindHorizonWorker(store, createWorker?: () => HorizonWorkerLike)` in `bindHorizon.ts`. The default factory is `() => new Worker(new URL("../../workers/horizon.worker.ts", import.meta.url), { type: "module" })`; unit tests pass a plain-object fake. Type the factory with this interface, not with `Pick<Worker, …>`:

```ts
/** What bindHorizonWorker uses from a Worker. A real Worker and a plain-object fake both satisfy it. */
export interface HorizonWorkerLike {
  postMessage(message: HorizonIn): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<HorizonOut>) => void) | null;
}
```

   Checked with tsc 7.0.2 (app and test configs): the default factory is assignable to `() => HorizonWorkerLike`, the fake needs no cast, and a test delivers a reply with `fake.onmessage?.(new MessageEvent("message", { data: reply }))` (Node has a global `MessageEvent`). With `Pick<Worker, "postMessage" | "terminate" | "onmessage">` the fake builds, but calling its `onmessage` fails to type-check, because the handler's `this` must be a full `Worker`. Create the worker lazily, on the first compute.
3. Subscribe to `[camera.activeId, camera.registry[activeId]?.site ?? null]` with `shallow` and `fireImmediately: true`. Do not watch `data.horizon`: the listener writes it ([binding rule 4](README.md#binding-rules)).
4. When it fires and the camera exists: if its entry is missing, `idle` or `error`, take a new `requestId`, remember it as the latest for that camera, call `setHorizon(id, { status: "loading", profileDeg: null, imagerySources: [] })`, and post `{ type: "compute", requestId, cameraId, latDeg, lonDeg, mastM }` from `site`. A `loading` or `ready` entry sends nothing, so switching back to a camera reuses its cached profile. An `error` entry is retried only when that camera is selected again.
5. Replies: ignore `progress` (the store has no field for it). On `done` with the latest `requestId` for its camera: `setHorizon(cameraId, { status: "ready", profileDeg, imagerySources })`, storing the transferred array as is. On `error` with the latest `requestId`: `setHorizon(cameraId, { status: "error" })` and `console.warn` the message (the e2e guard fails only on errors).
6. Cleanup: unsubscribe, `terminate()`, then set every camera this binding left in `loading` back to `idle`. React StrictMode runs mount, cleanup, mount in development: without this reset the second mount sees `loading` and the profile never arrives.
7. `SkyView.tsx` starts `bindHorizonWorker` with the sky map's other bindings, so the [map lifecycle](README.md#map-lifecycle) cleanup stops it.

### Step 8. Registry entries

1. Enable `synthetic-walenstadt`. M1 already committed its entry in `public/data/cameras.json` ([M1 step 5](M1-ground-map.md)), with `heightM` marked provisional, and left it out of `ENABLED_CAMERA_IDS`. Add `"synthetic-walenstadt"` to `ENABLED_CAMERA_IDS` in `src/app/cameras.ts`; until then `?cam=synthetic-walenstadt` names a camera that is not in the store. Do not edit the entry: `heightM` 467.6 is the Terrarium z14 ground at the site (467.63 m; swissALTI3D gives 465.2 m, [terrain.md](../verification/terrain.md) claim 4), so the provisional value is now final. `mastM` 0, `geoidSepM` 47.08 and `timeZone` `Europe/Zurich` are already in it.
2. `synthetic-maunakea`: change `site.mastM` from 0 to 33 (Parth to confirm; DECISIONS "Contract changes from the implementation docs"). Its `heightM` 4204 is CFHT's published altitude, but the DEM ground there is 4,170.92 m. With `mastM` 0 the worker puts the eye on the ground of a summit ridge, and terrain rises up to +6.87° (az 186°) over az 61–216°. With 33 m, z0 = 4,203.9 m, every azimuth is negative (maximum −0.27° at az 200°), and the sea horizon is −1.9407°, matching the flat-sea fixture. `heightM` does not change, so the Polaris and planet fixtures are untouched.
3. `cfht-nanaao` and `cfht-starcam` sit on the same point with the same `heightM` 4204 and `mastM` 0. Their `mastM` is provisional (M1's table; M4 step 9 says to ask CFHT). With 0 they get the same +6.87° terrain. Unless M4 or M5 recorded a measured mount height, set both to 33 as well. If a measured mast exists, keep it and set `heightM` = 4,170.9 + `mastM` instead.
4. `cameraHeights.test.ts` keeps `heightM` and `mastM` consistent with the DEM (section 5).

### Step 9. Skyline layer: `src/map/sky/layers/horizon.ts`

1. `createHorizonLayer()` returns a canvas `VectorLayer` over a `VectorSource` created with `useSpatialIndex: false`, holding two features: the skyline (`MultiLineString`) and the fill (`MultiPolygon`).
2. `buildSkylineCoords(model, profileDeg)` is a pure function returning `{ line, fill }` coordinate arrays in sky-map coordinates (`toSkyMapCoord`), so it is unit-tested in Node:
   - Line: az = 0, 1, …, 360 at `profileDeg[az mod 360]`, each through `projectAzAltDeg`. Split the line wherever a point is culled.
   - Fill: one quad per degree, corners (az, top), (az + 1, top′), (az + 1, bottom′), (az, bottom). `top` is the profile value. `bottom` is the lowest altitude at that azimuth that still projects: if alt −90° projects, use it; otherwise bisect 12 times between −90° and `top` (resolution (top + 90°)/4096, 0.024° for a 10° top), keeping `top` projectable and the lower end culled. Skip a quad if `top` or `top′` does not project. This one rule fills to the horizon circle on a zenith fisheye (bottom 0°) and past the frame edge on a rectilinear camera (bottom where `r > 1.05·rMaxUnit`), with no lens-specific code.
   - A profile entirely below a zenith fisheye's horizon (Maunakea, −1.93°) gives an empty line and an empty fill.
3. Rebuild only in `setCameraModel` and the new `SkyMapHandle.setHorizonProfile(profileDeg | null)`, never per frame. `null` clears both features.
4. Layer order, bottom to top: background (M4), grid, stars, bodies (M2), trails, satellites, starlink (M3), horizon, selection. This is M3's order (step 13) with the horizon layer inserted below `selection`. The fill sits above every object, so anything behind terrain is dimmed by it; the selected marker and its label stay on top.
5. `bindSkyLayerVisible(store, "horizon", layer)`, as for every sky-view layer from M5 (README [Sky over video](README.md#sky-over-video) rule 2; the code is under [binding rules](README.md#binding-rules)). `selectSkyLayerVisible("horizon")` is plain `layers.horizon` on every camera kind: checked against the README selectors with a real `ol/layer/Vector` on synthetic, still-image, `youtube` and `local-video` cameras. `bindSkyHorizon(store, sky)` subscribes to `selectHorizonProfileDeg` (`fireImmediately`) and calls `sky.setHorizonProfile`.

### Step 10. Behind terrain: visibility and the Inspector

1. In `updateEphemerisFrame` (`src/state/ephemeris.ts`, M3 step 11), read `profile = selectHorizonProfileDeg(store.getState())` once per frame and pass `horizonAltAtAzDeg(profile, azDeg)` as `horizonDeg`. Before the profile is `ready` this is 0, the geometric horizon ([architecture.md](../verification/architecture.md) claim 13). M3 skips the loop when `simTimeMs`, the sample pair and the mask are unchanged: add the profile reference to that check. Otherwise, while paused, the visible flags keep the geometric horizon after the profile arrives.
2. Where the terrain horizon is below 0° (open sea seen from a summit), an object between it and 0° now counts as visible. Example: from `subaru-starcam` the profile is −1.93° at az 65–70°. Drawing does not change: the sky layers still draw only objects with apparent altitude above 0° (M3 step 13), so such an object is "Visible to the eye" in the Inspector but not drawn. At the Subaru frame centre (az 81.2°) the terrain horizon is +1.9° (interpolated between +1.96° at az 81 and +1.78° at az 82), above the frame's bottom edge (−1.9°).
3. The `horizon` toggle hides only the skyline and its fill. Visibility and the Inspector flag always use the profile when it is `ready`.
4. Inspector, for any selected object (satellite, star, planet, Sun, Moon), from `useTick4Hz` reads:
   - status `ready`: "Terrain horizon here: +32.7°" (signed, one decimal, at the object's azimuth), plus the exact text "Behind terrain" when the object's apparent altitude is at or below it;
   - `loading`: "Terrain horizon: loading";
   - `error`: "Terrain horizon: unavailable (geometric horizon used)";
   - `idle`: nothing.
   It is text, never colour alone ([README Accessibility](README.md#accessibility) item 3). In M3's satellite visibility line, the failing reason for an object above 0° but at or below the terrain horizon reads "behind terrain" instead of "below the horizon".
5. The sky view's text alternatives (M2's "Above the horizon" list and M3's "Satellites above the horizon" list) append ", behind terrain" to the accessible name of an item at or below the terrain horizon while the profile is `ready`. The dimming fill is visual only, so this is the non-visual equivalent.

### Step 11. Hillshade: `hillshade.ts` and `bindHillshade.ts`

1. The layer. Use `ImageTile`, not `XYZ`: `XYZ` fails strict tsc as a `WebGLTile` source with TS2740 ([terrain.md](../verification/terrain.md) claim 2).

```ts
// src/map/ground/layers/hillshade.ts
import WebGLTileLayer from "ol/layer/WebGLTile";
import ImageTile from "ol/source/ImageTile";
import { TERRARIUM_MAX_ZOOM, TERRARIUM_URL } from "../../../domain/terrain";

const DEG = Math.PI / 180;
/** Terrarium metres of the texel at offset (dx, dy). Band values arrive as 0..1. +dy is one texel south. */
const elevation = (dx: number, dy: number) => [
  "-",
  [
    "*",
    255,
    ["+", ["*", 256, ["band", 1, dx, dy]], ["band", 2, dx, dy], ["/", ["band", 3, dx, dy], 256]],
  ],
  32768,
];
const run = ["*", 2, ["var", "texelGroundM"]]; // central difference spans two texels
const dzdx = ["/", ["-", elevation(1, 0), elevation(-1, 0)], run]; // rise per ground metre east
const dzdy = ["/", ["-", elevation(0, 1), elevation(0, -1)], run]; // rise per ground metre south
const sunAz = ["*", DEG, ["var", "sunAzDeg"]]; // astronomy-engine azimuth: N = 0, E = 90
const sunAlt = ["*", DEG, ["var", "sunAltDeg"]];
/** cos(angle between the surface normal and the Sun). No atan and no '^': both misbehave on SwiftShader. */
export const COS_INCIDENCE = [
  "/",
  [
    "+",
    ["sin", sunAlt],
    ["*", ["cos", sunAlt], ["-", ["*", dzdy, ["cos", sunAz]], ["*", dzdx, ["sin", sunAz]]]],
  ],
  ["sqrt", ["+", 1, ["*", dzdx, dzdx], ["*", dzdy, dzdy]]],
];

export function createHillshadeLayer(): { layer: WebGLTileLayer; source: ImageTile } {
  const source = new ImageTile({
    url: TERRARIUM_URL,
    maxZoom: TERRARIUM_MAX_ZOOM, // z16 returns 404
    crossOrigin: "anonymous",
    interpolate: false, // NEAREST: band offsets land on whole texels
  });
  const layer = new WebGLTileLayer({
    source,
    visible: false,
    style: {
      // Every ['var', name] must be declared here, or the first render throws "Missing 'name' in style variables".
      variables: { sunAzDeg: 315, sunAltDeg: 45, texelGroundM: 1 },
      // Grey relief for verification. The final cosI → colour/opacity mapping is settled from screenshots.
      color: ["color", ["*", 255, ["clamp", COS_INCIDENCE, 0, 1]], 1],
    },
  });
  return { layer, source };
}
```

   Keep `COS_INCIDENCE` as is. The `color` above is opaque grey, which is what the pixel check in item 2 reads. The final mapping (colour, alpha or layer opacity) is settled from screenshots; whatever it is, the true-colour imagery must stay visible under the relief.

2. Texel size. Band offsets step one source texel, but `['resolution']` is the view's EPSG:3857 resolution, so the OpenLayers example's divisor is off by cos(lat) and by up to 2× between zooms ([terrain.md](../verification/terrain.md) claim 10, [openlayers.md](../verification/openlayers.md) claim 8). Push the true texel size instead:

```ts
/** Keeps texelGroundM equal to the ground size of one texel of the tiles OpenLayers is drawing. */
export function bindHillshadeTexel(
  map: OlMap,
  layer: WebGLTileLayer,
  source: ImageTile,
): () => void {
  const view = map.getView();
  const grid = source.getTileGrid();
  let lastZ = Number.NaN;
  const push = (force: boolean): void => {
    const resolution = view.getResolution();
    const center = view.getCenter();
    if (grid === null || resolution === undefined || center === undefined) return;
    const z = grid.getZForResolution(resolution, source.zDirection); // the same call the WebGL renderer makes
    if (!force && z === lastZ) return;
    lastZ = z;
    layer.updateStyleVariables({ texelGroundM: texelGroundM(z, toLonLat(center)[1] ?? 0) });
  };
  const keys = [
    view.on("change:resolution", () => push(false)),
    map.on("moveend", () => push(true)),
  ];
  push(true);
  return () => unByKey(keys);
}
```

   It imports `OlMap` (type), `unByKey` from `ol/Observable`, `toLonLat` from `ol/proj`, the layer and source types, and `texelGroundM`. It pushes once when bound, on `moveend`, and, during a zoom, only when the tile zoom changes (after the bind push, 4 pushes for a 1 s animated zoom from 9.2 to 12.2: three tile-zoom changes and `moveend`). Tile zoom switches at zoom z + 0.415, not z + 0.5, so never derive it with `Math.round`.

   Verified in headless Chromium on SwiftShader with this layer and this binding over synthetic Terrarium planes (20° slope, downslope azimuth 125°, Walenstadt latitude): zooms 10, 11.3, 11.41, 11.42, 12.41 and 12.9 (both sides of the 11.415 switch; pushed texel sizes 104.02, 52.01, 52.01, 26.00, 26.00 and 13.00 m) with Suns at 135°/30°, 300°/40° and 200°/15° gave centre pixels 194, 87 or 88, and 84 at every zoom, within one grey level of 255·cosI (194.19, 87.47, 83.82). The analytic controls for the 135°/30° Sun: dropping cos(lat) gives 176, and the z11 texel size that `Math.round(11.42)` would pick gives 164.

3. Sun: `bindHillshadeSun(store, layer)`.
   - Subscribe to `[clock.simTimeMs, camera.activeId, layers.hillshade]` with `shallow` and `fireImmediately`. Skip while the active camera is not in the registry.
   - While `hillshade` is off, do nothing and cancel any pending push. The returned cleanup unsubscribes and clears the pending timer.
   - Throttle on `performance.now()`, leading and trailing: push at once if 1,000 ms have passed since the last Sun push, otherwise schedule one push for the end of that second. The push reads `store.getState()` when it runs, so the last state always lands.
   - A push computes `computeBodies(astroTimeAt(simTimeMs), makeObserver(site), scratch)` for the active camera's site, into a `Float64Array(8 × BODY_STRIDE)` allocated once. The Sun is body 0: `scratch[0]` is azimuth, `scratch[1]` apparent altitude. If the altitude is below 0°, push `{ sunAzDeg: 315, sunAltDeg: 45 }`; otherwise push the Sun.
   - Example: Walenstadt at 2026-10-11T15:20:00Z gives az 244.56°, alt 12.69°; at 22:00:00Z the altitude is −47.19°, so 315/45.
4. Night badge, in `GroundView.tsx`: while `layers.hillshade` is on and the Sun's apparent altitude at the site is below 0° (from `skyCache.bodies[1]`, read during a `useTick4Hz` render), show the text "Night: fixed lighting (315°, 45°)".
5. In `createGroundMap`: add the layer above true colour and below Coastlines; start `bindLayerVisible(store, "hillshade", layer)`, `bindHillshadeTexel` and `bindHillshadeSun`. The M1 cleanup already disposes every layer, which releases the WebGL context.

### Step 12. Credits

`credits.ts` gains `TERRAIN_CREDIT` (text "Terrain: AWS Terrain Tiles (Tilezen Joerd), data sources and attribution", `href` `https://github.com/tilezen/joerd/blob/master/docs/attribution.md`, no licence) and `TERRAIN_SOURCE_STATEMENTS`, the 11 lines of the document's "Required attribution" block, verbatim (fetched 2026-10-11; line breaks joined, trailing ";" dropped):

1. ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736
2. Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017
3. Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich
4. Canada terrain data contains information licensed under the Open Government Licence – Canada
5. Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers
6. Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
7. Mexico terrain data source: INEGI, Continental relief, 2016
8. New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved)
9. Norway terrain data © Kartverket
10. United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved
11. United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.

`Credits.tsx` shows the credit and all 11 statements while terrain data is in use: `layers.hillshade` is on, or the active camera's horizon status is `loading` or `ready`. The Mapzen block does not apply to the AWS bucket. Never show a fixed subset: a ground-map hillshade over Walenstadt at z11+ already draws Austrian data ([terrain.md](../verification/terrain.md) claim 3).

### Step 13. Layers panel

`LayerToggles.tsx` gains "Terrain horizon" (`horizon`) and "Hillshade" (`hillshade`). The horizon toggle has a status text from `selectHorizonStatus`, linked with `aria-describedby` and rendered in a `role="status"` element so the change is announced: nothing for `idle`, "Loading terrain…", "Terrain ready", "Terrain unavailable: geometric horizon". No new shortcut: `L` opens the panel and the toggles are keyboard-reachable.

### Step 14. End-to-end route and spec

1. Inside M1's `routes` auto fixture in `tests/e2e/fixtures.ts` ([README section 8](README.md#end-to-end-tests)), add `context.route("**/s3.amazonaws.com/elevation-tiles-prod/**", …)`. It is part of the shared fixture, because from M6 on every spec loads a camera, and the worker fetches tiles for it. For `terrarium/{z}/{x}/{y}.png`, serve `tests/fixtures/terrain/walenstadt/…` or `maunakea/…` if the file exists, else `flat.png`. Never answer 404 (Chromium logs it as a console error). Headers: `access-control-allow-origin: *`, `access-control-expose-headers: x-amz-meta-x-imagery-sources`, and `x-amz-meta-x-imagery-sources` from that site's `sources.json` (empty for `flat.png`). Without the expose header, `imagerySources` came back empty from a fulfilled response.
   - Effect on earlier specs: at the default camera the plan mixes `maunakea/` fixture tiles with `flat.png`, which can only lower the profile. With `mastM` 33 its maximum is −0.49° (measured), so no object above 0° becomes "behind terrain" and the M1–M5 specs see the same visible set. If `mastM` stays 0 (33 not confirmed), the same mix gives +6.87° over az 61–216°; re-run every spec that asserts visibility.
2. `tests/e2e/terrain.spec.ts`: section 5.

### Step 15. `ask053-walenstadt`: only with written permission

Skip this step unless the owner has agreed in writing; record the agreement in `DECISIONS.md`. Then add the entry from the [README registry](README.md#camera-registry) to `cameras.json` (M1 left it out) and its id to `ENABLED_CAMERA_IDS`, with `mastM` 0 (unknown; 0–10 m moves the az 0° horizon by 0.16°), fit its lens on a clear night (M4 flow), check the mid-exposure time against a satellite trail ([M4](M4-camera-model.md) step 7), and do the by-eye skyline check on its image.

### Step 16. Docs

Append section 8 to `DECISIONS.md`. In the root README's M6 section, put the fixture command and its expected output, the live numbers from acceptance 9, and the credit rule.

## 5. Tests

Unit tests (Vitest, Node; `tests/unit/setup.ts` blocks `fetch`, so the fixture tests prove they read only committed files):

| File | Test | Fixture | Tolerance |
| ---- | ---- | ------- | --------- |
| `horizon.test.ts` | `decodeTerrariumM(128, 0, 0)` is 0; `(137, 219, 68)` is 2523.2656 | inline | exact; 1e-4 m |
| | wall formula `apparentElevationDeg(1000, 0, 10_000)` = 5.672 (5.67186); no-curvature 5.7106 must fail | inline | ± 0.001° |
| | `zoomForDistanceM` at 1,499 / 1,500 / 7,999 / 8,000 / 29,999 / 30,000 / 59,999 / 60,000 → 14, 12, 12, 10, 10, 9, 9, 8; `marchLimitM(467.6)` and `marchLimitM(-30)` = 100,000; `marchLimitM(4204)` = 260,543; `texelGroundM(12, 47.1236)` = 26.0 | inline | exact; ± 1 m; ± 0.05 m |
| | `lonLatToWorldPx(0, 0, 0)` = [127.5, 127.5]; `destinationLatLonDeg` 111,195.08 m north of 47.1236° is 48.1236°, same longitude; 1° east of 179.9° on the equator is −179.1° | inline | 1e-6° |
| | `horizonAltAtAzDeg`: null → 0; profile i/10: az 12.5 → 1.25, 359.5 → 17.95, −0.5 → 17.95 | inline | 1e-5° |
| | plateau: sampler `dM ≥ 10_000 ? 1000 : 0`, z0 0, limit 100 km: every azimuth (measured 5.6383°) | analytic | 5.67 ± 0.05° |
| | flat sea: sampler records `dM` and returns −4,000 (seabed, exercises the clamp), z0 4,204, `marchLimitM(4204)`: every azimuth −1.9407°; argmax of `apparentElevationDeg(0, 4204, d)` over azimuth 0's samples is 247.77 km | analytic | ± 0.01°; 248.1 ± 2 km |
| | Walenstadt: `fixtureSampler("walenstadt", tilesForSite(47.1236, 9.3242, 100_000))`; ground at the site (467.63); profile from z0 = ground: az 0° 32.753°, az 270° 1.955°; maximum 32.93° at az 2°, minimum 1.76° at az 276° (the README fixture row) | `terrain/walenstadt` | 467.6 ± 3 m; 32.7 ± 0.3°; 2.0 ± 0.3°; max and min ± 0.3° and at that azimuth ± 2° |
| | Maunakea open ocean: Subaru (19.82552, −155.47587), z0 = fixture ground + 13 = 4,147.6, rays from `tilesForSite(…, limit, [0])`: az 0° = −1.9277°, sea tangent at 245.3 km | `terrain/maunakea` | −1.93 ± 0.02° |
| `cameraHeights.test.ts` | For every `cameras.json` entry at a fixture site (`synthetic-maunakea`, `cfht-nanaao`, `cfht-starcam` at the CFHT point; `subaru-starcam`, `local-replay`, `subaru-2026-10-11-iss` at the Subaru point; `synthetic-walenstadt`): \|DEM ground from the fixture + `mastM` − `heightM`\| (measured −0.08 m at the CFHT point with `mastM` 33, −0.4 m at Subaru, +0.03 m at Walenstadt). The CFHT point's z14 tile `14/1116/7271` is in the `maunakea` fixture. | both | ≤ 3 m |
| `skyHorizon.test.ts` | `buildSkylineCoords` on `createCameraModel` of the 1024 zenith fisheye (f = 1024/π, roll 180): constant 10° profile puts az 0° at [512, 967.111] and az 90° at [56.889, 512]; every fill bottom lies at radius 512 from [512, 512]; a −1.93° profile gives empty line and fill | inline | 1e-3 px; 0.2 px; exact |
| `bindHorizon.test.ts` | fake worker, store from `createAppStore`: one `compute` at subscribe with the registry's lat, lon, `mastM` and status `loading`; `done` → `ready` with the same array; a `done` with an old `requestId` is ignored; switching away and back sends nothing; `error` → `error`, retried only on re-selection; cleanup calls `terminate` and resets `loading` to `idle` | inline | exact |
| `hillshade.test.ts` | `createHillshadeLayer()` builds in Node, max zoom 15; `layer.createRenderer()` (public on `WebGLTileLayer`) does not throw: the full style parses into GLSL source (the GPU compile is covered by e2e test 3); a layer whose style uses an undeclared `['var', 'nope']` throws `Missing 'nope' in style variables` from `createRenderer()`, not from the constructor | none | exact |
| `bindHillshade.test.ts` | real layer with a spied `updateStyleVariables`, `vi.useFakeTimers()` (it advances `performance.now()` too), Walenstadt camera: 60 ticks in 1 s give at most 2 Sun pushes; the last push carries the final time; 15:20:00Z pushes 244.56/12.69 (± 0.01°), 22:00:00Z pushes 315/45; nothing while `hillshade` is off | inline | as stated |
| `visibility.test.ts` | profile with [0] = 32.75, [270] = 1.96: a lit satellite at alt 20° with the Sun at −10° is not visible at az 0° and visible at az 270° | inline | exact |

`tests/e2e/terrain.spec.ts` (shared fixture with the step 14 route; no third-party requests, no console errors):

1. `/?cam=synthetic-walenstadt&t=2026-10-11T15:20:00Z&sel=star:1708`: open the Layers panel (`L`); it shows "Terrain ready". The Inspector shows "Behind terrain" for Capella (az 359.92°, apparent alt 3.37°, under a terrain horizon of 32.7° there). M3's Inspector already handles `star:` ids. Save a screenshot of the sky view for the PR.
2. Same URL with `sel=star:424`: Polaris (az 0.49°, alt 46.62°) does not show "Behind terrain".
3. Same camera, turn on "Hillshade": at least one Terrarium request comes from the ground map (its `request.resourceType()` is `"image"`; the worker's are `"fetch"`), the Credits region contains the terrain credit link and every one of the 11 `TERRAIN_SOURCE_STATEMENTS`, and "Night: fixed lighting (315°, 45°)" is absent. With `t=2026-10-11T22:00:00Z` the badge is present. Before each ground-map screenshot, click the map's zoom-in control 4 times (M1's view starts at zoom 6), so the relief comes from the `walenstadt` z10 fixture tiles instead of `flat.png`. Save both screenshots.

## 6. Acceptance criteria and PR evidence

1. The wall tests pass: formula 5.672 ± 0.001°, march 5.67 ± 0.05°. Evidence: `horizon.test.ts` output.
2. Flat sea from 4,204 m: −1.94 ± 0.01° at 248 ± 2 km. Evidence: the same output.
3. Real tiles: Walenstadt ground 467.6 ± 3 m, az 0° 32.7 ± 0.3°, az 270° 2.0 ± 0.3°; Maunakea open ocean −1.93 ± 0.02°. Evidence: the same output, and the fixture script's two lines.
4. Every registry height agrees with the DEM within 3 m (`cameraHeights.test.ts`).
5. The skyline follows the ridge by eye. Evidence: a `synthetic-walenstadt` screenshot showing the Churfirsten wall to the north (about 33°) and the low gap down the Walensee to the west (about 2°). If ASK053 permission exists, also a screenshot of the skyline over its image.
6. Behind terrain: e2e tests 1 and 2 pass; `visibility.test.ts` passes. Evidence: a short clip at 60× on `synthetic-walenstadt` of a satellite or star crossing the skyline, dimmed below it, with the Inspector flag changing.
7. Hillshade: e2e test 3 passes with no page or console error (a shader that fails to compile throws); `bindHillshade.test.ts` shows at most one Sun push per second. Evidence: day and night ground-map screenshots, the night one with the badge.
8. Credits: all 11 statements and the link are on screen while terrain is in use (e2e test 3).
9. Live check, by hand, `npm run build && npm run preview` with real S3, selecting each camera: the `done` reply for `synthetic-walenstadt` reports groundM 467.6, limit 100 km, 45 tiles; `subaru-starcam` groundM 4,134.6, z0M 4,147.6, limit 258.8 km, 44 tiles; `synthetic-maunakea` (and `cfht-nanaao`, `cfht-starcam` at the same point) groundM 4,170.9, z0M 4,203.9, limit 260.5 km, 46 tiles, profile maximum −0.27°. Paste the numbers and the time to `ready` (measured 1.0–1.2 s) into the PR, with the Playwright trace of `terrain.spec.ts`.
10. The definition of done in [README section 1](README.md#definition-of-done) holds.

## 7. Gotchas

1. **Ocean pixels are seabed.** Terrarium carries ETOPO1 bathymetry (−4,100 to −5,200 m around Hawaii). Without `max(z, 0)` the Maunakea sea horizon reads −2.9° to −3.2° instead of −1.93°. Clamp only in the march; the hillshade keeps raw values. ([terrain.md](../verification/terrain.md) claims 9, 13)
2. **Simple GET only.** S3 answers CORS for a plain GET with no custom headers. A preflight asking for any header, or a HEAD, returns 403 or no `Access-Control-Allow-Origin`, so a HEAD "probe" falsely reports the tiles as blocked. (claim 1)
3. **`XYZ` is not a `WebGLTile` source** under strict tsc (TS2740). Use `ol/source/ImageTile`. (claim 2; [openlayers.md](../verification/openlayers.md) claim 7)
4. **Zoom 15 is the top.** z16 returns 404; set `maxZoom: 15` on the source. The ground map stops at zoom 12, but the expression was verified to z15. (claim 14)
5. **`getImageData` lives on the 2D context.** `OffscreenCanvas` has no `getImageData` (TS2339). (claim 6)
6. **Brave adds noise to `getImageData`,** in workers too: about 85 red-channel bit flips per tile, each a ±256 m spike that becomes a false ridge. M6 accepts this. The fix, if Brave matters, is the canvas-free decoder (`DecompressionStream('deflate')` plus filter reversal), which needs a `DECISIONS.md` change. (claim 6)
7. **The march steps on the sphere.** Adding d to EPSG:3857 metres overstates distance by 1/cos(lat) (1.47× at Walenstadt) and gives up to 9.2° of error. (claim 7)
8. **The plateau test needs a plateau.** A wall thinner than the local step (about 100 m at 10 km) can fall between samples. (claim 8)
9. **`heightM` is not always DEM ground + mast.** CFHT's 4,204 m is 33 m above the Terrarium ground, which is why the three entries at the CFHT point need `mastM` 33 (step 8). The worker never reads `heightM`. ([terrain.md](../verification/terrain.md) claim 4)
10. **Copying the OpenLayers shaded-relief example is wrong twice:** `['resolution']` is the view resolution, not the texel size, and EPSG:3857 metres are 1/cos(lat) ground metres. Slopes come out flat by cos(lat) and jump by up to 2× at tile-zoom switches. (claim 10; [openlayers.md](../verification/openlayers.md) claim 8)
11. **SwiftShader, which headless CI uses, returns π for `atan(-0.0, +y)`** and folds `0.0 - x` into `-x`, which swaps north- and south-facing light wherever dzdx is 0. `COS_INCIDENCE` has no `atan` and no `^` (`pow` is undefined for negative bases). Pixel tests use non-cardinal aspects. ([openlayers.md](../verification/openlayers.md) claim 8)
12. **A missing style variable throws on the first render,** not in the constructor (verified: `createRenderer()` throws). Declare `sunAzDeg`, `sunAltDeg` and `texelGroundM` in `style.variables`. ([terrain.md](../verification/terrain.md) claim 22)
13. **Seams.** Textures use `CLAMP_TO_EDGE`, so the column at each tile edge shades with a halved gradient: a 1 px seam. Accept it. ([openlayers.md](../verification/openlayers.md) claim 8)
14. **Mobile GPUs with only `mediump`** cannot hold 32,768 + metres; the shader decode breaks (4,204 m reads 4,192 m). Desktop browsers use `highp`. ([terrain.md](../verification/terrain.md) claim 21; [openlayers.md](../verification/openlayers.md) claim 18)
15. **`marchLimitM` must clamp z0 at 0,** or a site below sea level gets a NaN limit and an empty march.
16. **Fulfilled responses hide custom headers** unless the route sends `access-control-expose-headers`. The real S3 sends it.
17. **StrictMode leaves `loading` behind** if cleanup terminates the worker mid-compute. Reset it to `idle` (step 7).
18. **Refraction near the horizon is approximate.** The terrain uses κ = 0.13; objects use astronomy-engine's sea-level `'normal'`, about 0.18° too large at the horizon at Maunakea's pressure. Objects within about 0.2° of the skyline can be flagged either way. ([terrain.md](../verification/terrain.md) claim 17)
19. **Domes are not in the DEM.** The Subaru frame's real obstructions (summit buildings) will not be masked; the computed skyline sits up to +4.1° on the summit cones at 0.2–0.8 km. (claim 9) On the 2026-10-11 clip the real ISS goes behind the large dome at media 228.0 s, shows through gaps at 238.0–241.5 s and 256.0–258.4 s, and is lost behind the left-hand dome at 290.43 s (az 59.5°, alt 6.9°), while the marker drawn over the video carries on across the domes ([README recorded clips](README.md#recorded-clips)).

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M6's contract lines under "Contract changes from the implementation docs": `mastM` 33 at the CFHT point, linear `horizonAltAtAzDeg`, and the hillshade push rules. Append the rest.

- `synthetic-walenstadt` is enabled with M1's entry unchanged; its provisional `heightM` 467.6 is confirmed by the Terrarium z14 ground (467.63 m). Reason: M1 commits every entry and the enabling milestone settles it.
- Behind-terrain objects are dimmed by the skyline fill drawn above them, not by per-object style classes; the selection layer stays on top. Reason: one layer covers stars, bodies and satellites with no per-frame work.
- The `horizon` toggle hides only the drawing; visibility and the Inspector flag always use a ready profile. Reason: hiding a layer must not change what counts as visible.
- Any failed tile fails the whole profile (status `error`, geometric horizon). Reason: a partial profile would invent gaps in real ridges.
- The worker drops decoded tiles after each compute; the HTTP cache serves repeats. Reason: 11 MB per site, and S3's 2017 `Last-Modified` gives long heuristic freshness.
- `imagerySources` stores dataset prefixes (`eudem`, `srtm`, …). The Credits region always shows the full "Required attribution" block while terrain is in use. Reason: hillshade tiles load through `<img>`, whose headers are not readable, so a per-view list would be incomplete.
- The hillshade is lit by the Sun at the active camera's site, from `computeBodies` (apparent altitude); below 0° it switches to 315°/45° and shows the night badge. Reason: the map is centred on the site, and the badge and the sky view agree.
- The hillshade source uses `interpolate: false`. Reason: band offsets then land on whole texels; linear filtering of packed bytes gave gradient errors up to 0.14 on Apple Metal.
- Brave's canvas noise is not worked around in M6. Reason: DECISIONS mandates the `createImageBitmap` decode; the canvas-free decoder is the fix if Brave matters.
- Terrain fixtures: Walenstadt's full plan (45 tiles, 5.58 MB) and the Subaru StarCam's azimuth-0 ray (10 tiles, 1.15 MB), plus `flat.png`. Reason: the full Walenstadt set drives the e2e skyline; one open-ocean ray is enough for Maunakea.

