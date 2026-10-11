# M1 · Ground map

One pull request on branch `m1-ground-map`. Contracts: [README.md](README.md). Precedence: [`../DECISIONS.md`](../DECISIONS.md), then the README, then this file. Evidence: [gibs.md](../verification/gibs.md), [openlayers.md](../verification/openlayers.md), [architecture.md](../verification/architecture.md), [tooling.md](../verification/tooling.md), [sources.md](../verification/sources.md), [geopose.md](../verification/geopose.md), [terrain.md](../verification/terrain.md).

"Verified" means run on 2026-10-11 in a throwaway copy of the app built from these steps: Node 26.11.1 arm64 with `@types/node` 26.6.5 (O4), TypeScript 7.0.2 (`tsc -b`, strict, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`), Biome 2.5.15, Vitest 5.0.3, Vite 8.3.4, ol 10.11.0, zustand 5.0.15, React 19.3.0, Playwright 1.64.0 with headless Chromium 1248 (156.0.8078.4), and live GIBS where stated. Every code block is an excerpt of a file that passed `tsc -b`, `biome ci --error-on-warnings`, the unit tests and the e2e specs below. The copy has `.nvmrc` `26`, `engines.node` `">=26"` and the step 5 `cameras.json` exactly as printed; its last full run (16:20–16:30 UTC) passed `tsc -b`, `biome ci` (62 files), 73 unit tests, `vite build` and the 9 e2e specs. In the same window `scripts/fetch-gibs-caps.ts` (step 1) ran against live GIBS under Node 26.11.1 arm64 and wrote a 28,645 B snapshot from the filtered response (no fallback, no `snapshotProblems`).

## 1. Goal and scope

The ground map (EPSG:3857) shows NASA GIBS daily true colour from NOAA-20 VIIRS, the GIBS Coastlines and Reference_Labels overlays, and a marker at the active camera's site, with credits on screen at all times. A minimal timeline drives `clock.simTimeMs`, and the true-colour `Time` follows it through the first store-to-map binding. M1 also fixes the patterns later milestones copy: the trimmed capabilities snapshot, KVP-only GIBS sources, the StrictMode-safe map lifecycle with the registry, and the binding shape.

Out of scope:

- The sky view and its layers, twilight markers, star credits (M2). M0's sky placeholder stays.
- Satellites, selection, `?sel=`, Esc, Inspector (M3).
- CameraPicker, wedge, calibration, `C` (M4); YouTube, video, stream delay (M5); terrain and hillshade (M6); the GOES layer, DescribeDomains, HEAD probes and GOES ticks (M7); footprint (M8); demo (M9). The GOES layer stays in the snapshot, and `gibsWmtsOptions` ships the `dropLimits` option M7 uses.
- Enabling any camera other than `synthetic-maunakea`. The later entries are committed in M1 but stay disabled until their milestone (step 5).
- Detecting an all-black true-colour tile and stepping back a day. [gibs.md](../verification/gibs.md) claim 1 calls it optional; the 4 h rule in step 3 avoids black tiles.
- Visual design (layout, colours, panel placement, marker look). It is settled during the build from screenshots. This file fixes behaviour, content, states, keyboard and accessibility.

## 2. Prerequisites

1. M0 is merged. M1 uses: the store files and hooks ([README section 4](README.md#store)), `clockLoop.ts` with `startClockLoop`/`registerFrameUpdater`, `tests/unit/setup.ts` (throwing `fetch`), `tests/e2e/fixtures.ts` (catch-all abort, console-error guard), `App.tsx` with one `ErrorBoundary` per pane, CI and the deploy (M0 step 15).
2. Network on a developer machine, once: step 1 (snapshot) and step 2 (two tile fixtures). CI never reaches GIBS.
3. Accounts: none. GIBS needs no key. Hosting and CI come from M0.
4. Decisions ([DECISIONS](../DECISIONS.md)). O1, O2 and O4 are decided. In M1 they change only the two StarCam `termsNote` strings, which milestone adds the `local-video` entries, and the `local-video` source fields `parseCameraRegistry` checks (step 5); `fetch-gibs-caps.ts` uses Node 26's global `fetch`. O3 is open: M1 reads `clock`, `camera.activeId`, `camera.registry`, `layers.trueColor`, `layers.coastlines`, `data.cameras`, `data.gibs` and `ui.panel`. If O3 changes: propose those fields, plus `recenter`, in this pull request.

## 3. Deliverables

Create:

| Path | What |
| ---- | ---- |
| `scripts/fetch-gibs-caps.ts` | fetch, trim, check and write the snapshot (step 1) |
| `public/data/gibs-capabilities.xml` | committed snapshot, 28,645 B |
| `public/data/cameras.json` | five entries, one enabled (step 5) |
| `tests/fixtures/gibs/tile.jpg`, `tile.png` | e2e tile stubs (step 2) |
| `src/app/cameras.ts` | `parseCameraRegistry`, `ENABLED_CAMERA_IDS`, `enabledCameras` (step 5) |
| `src/app/url.ts` | `parseUrlState`, `writeUrlState`, `startUrlSync` (step 6) |
| `src/app/keyboard.ts` | `handleKeyDown`, `installKeyboard` (step 7) |
| `src/app/credits.ts` | `GIBS_CREDIT`, `OSM_NE_CREDIT`, `TRUE_COLOR_INSTRUMENT`, `dataCredits` (step 8) |
| `src/map/registry.ts` | `registry`, `registerMap`, `renderSyncAll` (step 9) |
| `src/map/ground/layers/gibs.ts` | snapshot loading and KVP WMTS sources (step 10) |
| `src/map/ground/layers/site.ts` | site marker layer (step 11) |
| `src/map/sync/bindLayers.ts`, `bindSite.ts`, `bindGibs.ts` | steps 11 and 12 |
| `src/map/ground/createGroundMap.ts` | map, layers, registration, bindings (step 13) |
| `src/ui/GroundView.tsx`, `Timeline.tsx`, `LayerToggles.tsx`, `Credits.tsx` | steps 13 and 15 |
| `tests/helpers/store.ts` | `storeAt(iso)`: a store with the committed, enabled registry |
| `tests/unit/actions.test.ts`, `selectors.test.ts`, `cameras.test.ts`, `url.test.ts`, `keyboard.test.ts`, `credits.test.ts`, `gibsSnapshot.test.ts`, `registry.test.ts`, `bindGibs.test.ts`, `bindSite.test.ts`, `bindLayers.test.ts` | section 5 |
| `tests/e2e/gibs-time.spec.ts`, `ground-map.spec.ts` | section 5 |

Change:

| Path | Change |
| ---- | ------ |
| `src/domain/time/index.ts` | add `isoDateUtc`, `trueColorDateUtc`, `formatZonedDateTime` (step 3) |
| `src/state/types.ts`, `actions.ts`, `selectors.ts` | M1 actions, `recenter`, three selectors (step 4) |
| `src/state/clockLoop.ts` | live branch for synthetic cameras; `renderSyncAll()` (step 14) |
| `src/main.tsx`, `src/app/App.tsx` | boot order, panes, `ol/ol.css` (step 16) |
| `tests/unit/time.test.ts`, `clockLoop.test.ts`, `store.test.ts` | M1 cases; M0's "later actions throw" list (step 4) |
| `tests/e2e/fixtures.ts`, `smoke.spec.ts` | `routes` auto fixture with the GIBS route; Play test starts from `?t=` (step 17) |
| `README.md` (root), `docs/DECISIONS.md` | M1 section; section 8 below |

## 4. Steps

Build in this order. Write each unit test (section 5) before its code and watch it fail.

### Step 1. Capabilities snapshot

`scripts/fetch-gibs-caps.ts`, run by hand: `npx tsx scripts/fetch-gibs-caps.ts [outPath]` (default `public/data/gibs-capabilities.xml`). It exports `GIBS_CAPS_LAYERS` (the five ids below), `GIBS_CAPS_MATRIX_SETS` (`GoogleMapsCompatible_Level6`, `GoogleMapsCompatible_Level9`), `trimGibsCapabilities` and `snapshotProblems`.

1. GET `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities&LAYER=VIIRS_NOAA20_CorrectedReflectance_TrueColor,VIIRS_NOAA21_CorrectedReflectance_TrueColor,GOES-West_ABI_Band13_Clean_Infrared,Coastlines,Reference_Labels`. Throw on any status but 200. The `LAYER` filter works only in this KVP form ([gibs.md](../verification/gibs.md) claim 3). Verified: 200, 43,630 B in 0.28 s, CORS `*`, the five layers and all seven GoogleMapsCompatible matrix sets (Level3, 6, 7, 8, 9, 12, 13).
2. Trim with regexes (Node has no `DOMParser`). This is safe: `Layer` elements are not nested and their first `<ows:Identifier>` is the layer id; a top-level matrix set starts `<TileMatrixSet><ows:Identifier>`, while the `<TileMatrixSet>Name</TileMatrixSet>` inside a link does not.

   ```ts
   /** Drops every Layer and every top-level TileMatrixSet whose identifier is not kept. */
   export function trimGibsCapabilities(
     xml: string,
     keepLayers: readonly string[] = GIBS_CAPS_LAYERS,
     keepMatrixSets: readonly string[] = GIBS_CAPS_MATRIX_SETS,
   ): string {
     return xml
       .replace(/<Layer>[\s\S]*?<\/Layer>/g, (block) => {
         const id = /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(block)?.[1] ?? "";
         return keepLayers.includes(id) ? block : "";
       })
       .replace(
         /<TileMatrixSet>\s*<ows:Identifier>([^<]+)<\/ows:Identifier>[\s\S]*?<\/TileMatrixSet>/g,
         (block, id: string) => (keepMatrixSets.includes(id) ? block : ""),
       );
   }
   ```

3. `snapshotProblems(xml): string[]` returns one message per failed check, `[]` when usable: the layer ids are exactly the five; the matrix sets are exactly Level6 and Level9; the `GetTile` operation lists `<ows:Value>KVP</ows:Value>` (Gotcha 4); exactly 3 `{Time}` ResourceURL templates exist (NOAA-20, NOAA-21, GOES); the GOES `Layer` still has `<TileMatrixSetLimits>`, so M7's workaround stays tested. GIBS writes attributes in single quotes (`<ows:Operation name='GetTile'>`, `template='…'`): a regex written for double quotes finds nothing and rejects a good snapshot.
4. If the filtered response has problems after trimming, fetch the same URL without `LAYER` and trim that (`console.warn` first). If problems remain, throw and write nothing. Verified: the full document (5,841,324 B, 8.1 s) trims to a snapshot that gives the same OpenLayers options for all five layers as the filtered one; only attribute order and Time defaults differ.
5. Prepend `<!-- Trimmed GIBS capabilities written by scripts/fetch-gibs-caps.ts at <ISO time> from <URL> -->` and write. Verified: 28,645 B, 3,496 B gzipped, `snapshotProblems` `[]`.
6. Run `main` only when executed directly: `if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(...)`. Verified: `tsx` runs it, and Vitest imports the exports without reaching the throwing `fetch`.
7. Commit the file. Regenerate it only when a layer id or matrix set changes. The app never reads Time values from it: they are stale by design. True-colour Time is computed (step 3), and M7 takes GOES times from DescribeDomains.

### Step 2. Tile fixtures

NOAA-20 imagery is NASA/NOAA data (CC0 unless marked, [gibs.md](../verification/gibs.md) claim 6). The Reference_Labels tile over Hawaii at z5 is empty, so it carries no OSM data. Run once, commit, and put the commands in the root README:

```sh
mkdir -p tests/fixtures/gibs
B='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?style=default&tilematrixset=GoogleMapsCompatible_Level9&Service=WMTS&Request=GetTile&Version=1.0.0&TileMatrix=5&TileCol=2&TileRow=14'
curl -fo tests/fixtures/gibs/tile.jpg "$B&layer=VIIRS_NOAA20_CorrectedReflectance_TrueColor&Format=image%2Fjpeg&Time=2026-10-10"
curl -fo tests/fixtures/gibs/tile.png "$B&layer=Reference_Labels&Format=image%2Fpng"
```

Verified: `tile.jpg` 19,949 B, 256 × 256, 0 % black, sha256 `a3359e2d…ea248c0d`; `tile.png` 155 B, 256 × 256, fully transparent, sha256 `1cd99521…6d89a6d2`.

### Step 3. Time functions (test first)

In `src/domain/time/index.ts` ([README section 6](README.md#6-domain-module-apis)):

1. `isoDateUtc(timeMs)`: `new Date(timeMs).toISOString().slice(0, 10)`.
2. `trueColorDateUtc(timeMs, siteLonDeg)`. Rule ([gibs.md](../verification/gibs.md) claim 1): T is the latest instant at or before `timeMs − 4 h` at which local mean solar time at the site (UTC + lon/15 h) is 13:30, NOAA-20's afternoon pass. Return T's UTC date. In ms:
   - `passOffsetMs = (13.5 − siteLonDeg / 15) × 3_600_000` (the pass's UTC time of day; may be negative or above 24 h);
   - `passMs = Math.floor((timeMs − 14_400_000 − passOffsetMs) / 86_400_000) × 86_400_000 + passOffsetMs`;
   - return `isoDateUtc(passMs)`, memoised on `passMs` in a one-entry module cache, so the per-frame selector allocates nothing.
   - Flips: Maunakea (−155.4689) every day at 03:51:52.536Z, Walenstadt (9.3242) at 16:52:42.192Z.
   - This is the rule in [README section 6](README.md#6-domain-module-apis). A "local solar noon" rule would flip 1.5 h earlier and request imagery 2.5 h after the pass, against an observed latency of 2 to 3.5 h.
   - Live check at 09:58Z on 2026-10-11, NOAA-20 tile 5/2/14 over Maunakea: 2026-10-08, 10-09 and 10-10 were 200 and 0 % black (18,767, 17,210 and 19,949 B); 2026-10-11 was 200 and 100 % black (1,665 B); 2026-10-12 was 404. The rule gives 2026-10-10.
3. `formatZonedDateTime(timeMs, timeZone): string`, for example `"2026-10-09 17:30:00"`. Use one cached `Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })` per zone and assemble `formatToParts` as `YYYY-MM-DD hh:mm:ss`. Node 26.11.1 and Chromium 1248 gave identical strings for 206 instants in four zones, including `00:00:00` at local midnight and both 2026 Zurich DST changes (README section 6).

### Step 4. Store

1. Implement the actions the [README actions table](README.md#actions) lands in M1: `setMode`, `setRate`, `stepBy`, `seek`, `jumpToNow`, `setRegistry`, `setActiveCamera`, `setLayer`, `toggleLayer`, `setLoadStatus`, `openPanel`, `togglePanel`. `stepBy` and `seek` keep `playing`; `jumpToNow` keeps the mode.
2. Implement `recenter(timeMs)` ([README actions](README.md#actions)): `simTimeMs = rangeCenterMs = timeMs`, mode `replay`, `playing` false. `seek` clamps to ± 12 h of `rangeCenterMs`, so without it a `?t=` far from now cannot be applied.
3. Add `selectActiveCamera`, `selectSite` and `selectTrueColorDate` exactly as in the [README](README.md#selectors).
4. M0's `store.test.ts` "every action from a later milestone throws" now excludes these 13 actions. The remaining 27 must throw `/^actions\.<name> lands in M[2-9]$/` (verified against the 44-action `Actions` type).

### Step 5. `public/data/cameras.json` and `src/app/cameras.ts`

Commit these five entries. The two `local-video` entries, `local-replay` and `subaru-2026-10-11-iss`, land with M5, which inserts them after `cfht-starcam`: each plays a recorded clip through its `ClipSidecar` (O2, [README camera registry](README.md#camera-registry)). `ask053-walenstadt` lands only after the owner agrees in writing. All five entries pass `parseCameraRegistry` (verified).

```json
[
  {
    "id": "synthetic-maunakea", "name": "Computed sky, Maunakea", "kind": "synthetic", "source": null,
    "site": { "latDeg": 19.8253, "lonDeg": -155.4689, "heightM": 4204, "mastM": 0, "geoidSepM": 24.23, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 1024, "heightPx": 1024 }, "lens": "fisheye-equidistant",
    "defaults": { "azDeg": 0, "altDeg": 90, "rollDeg": 180, "focalPx": 325.94932345220167, "cxPx": 512, "cyPx": 512, "k1": 0, "k2": 0, "flipX": false, "streamDelayMs": 0, "rmsDeg": null, "updatedAtMs": 0 },
    "credit": { "text": "Computed sky (no camera image)", "href": null, "licence": null, "licenceHref": null }, "termsNote": ""
  },
  {
    "id": "cfht-nanaao", "name": "CFHT Nānā ao all-sky (visible)", "kind": "still-image",
    "source": { "imageUrl": "https://www.cfht.hawaii.edu/~nanaao/last_vis.png", "refreshSec": 60, "corsEnabled": false, "captureLagMs": 40000, "exposureSec": 0 },
    "site": { "latDeg": 19.8253, "lonDeg": -155.4689, "heightM": 4204, "mastM": 0, "geoidSepM": 24.23, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 1232, "heightPx": 1232 }, "lens": "fisheye-equidistant",
    "defaults": { "azDeg": 227.3, "altDeg": 88.26, "rollDeg": 44.8, "focalPx": 373.1, "cxPx": 619.6, "cyPx": 609.8, "k1": 0.003, "k2": 0, "flipX": true, "streamDelayMs": 0, "rmsDeg": null, "updatedAtMs": 0 },
    "credit": { "text": "Nānā ao all-sky image © CFHT", "href": "https://www.cfht.hawaii.edu/en/gallery/nanaao.php", "licence": "GFDL-1.3-or-later", "licenceHref": "https://www.gnu.org/licenses/fdl-1.3.html" },
    "termsNote": "GNU Free Documentation License 1.3 or later"
  },
  {
    "id": "subaru-starcam", "name": "Subaru-Asahi StarCam (east, live)", "kind": "youtube",
    "source": { "youtubeVideoId": "Kj5DjRYkzD8", "resolverUrl": "https://astroasahi.github.io/maunakea_east/" },
    "site": { "latDeg": 19.82552, "lonDeg": -155.47587, "heightM": 4148, "mastM": 13, "geoidSepM": 24.32, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 3840, "heightPx": 2160 }, "lens": "rectilinear",
    "defaults": { "azDeg": 81.2, "altDeg": 19.6, "rollDeg": 0, "focalPx": 2742, "cxPx": 1920, "cyPx": 1080, "k1": 0, "k2": 0, "flipX": false, "streamDelayMs": 50000, "rmsDeg": null, "updatedAtMs": 0 },
    "credit": { "text": "NAOJ & Asahi Shimbun", "href": "https://www.youtube.com/channel/UCiN7OwV8g8dMm_E0xphBVig", "licence": null, "licenceHref": null },
    "termsNote": "YouTube embed; non-commercial use with credit"
  },
  {
    "id": "cfht-starcam", "name": "CFHT-Asahi StarCam (west, live)", "kind": "youtube",
    "source": { "youtubeVideoId": "Q3UhCgsWDw8", "resolverUrl": "https://astroasahi.github.io/maunakea_west/" },
    "site": { "latDeg": 19.8253, "lonDeg": -155.4689, "heightM": 4204, "mastM": 0, "geoidSepM": 24.23, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 3840, "heightPx": 2160 }, "lens": "rectilinear",
    "defaults": { "azDeg": 270, "altDeg": 20, "rollDeg": 0, "focalPx": 2742, "cxPx": 1920, "cyPx": 1080, "k1": 0, "k2": 0, "flipX": false, "streamDelayMs": 50000, "rmsDeg": null, "updatedAtMs": 0 },
    "credit": { "text": "CFHT & Asahi Shimbun in collaboration with Subaru Telescope, NAOJ", "href": "https://www.cfht.hawaii.edu/en/gallery/starcam.php", "licence": null, "licenceHref": null },
    "termsNote": "YouTube embed; non-commercial use with credit"
  },
  {
    "id": "synthetic-walenstadt", "name": "Computed sky, Walenstadt", "kind": "synthetic", "source": null,
    "site": { "latDeg": 47.1236, "lonDeg": 9.3242, "heightM": 467.6, "mastM": 0, "geoidSepM": 47.08, "timeZone": "Europe/Zurich" },
    "imageSize": { "widthPx": 1024, "heightPx": 1024 }, "lens": "fisheye-equidistant",
    "defaults": { "azDeg": 0, "altDeg": 90, "rollDeg": 180, "focalPx": 325.94932345220167, "cxPx": 512, "cyPx": 512, "k1": 0, "k2": 0, "flipX": false, "streamDelayMs": 0, "rmsDeg": null, "updatedAtMs": 0 },
    "credit": { "text": "Computed sky (no camera image)", "href": null, "licence": null, "licenceHref": null }, "termsNote": ""
  }
]
```

Where the fixed values come from:

- **Subaru (corrected):** site 19.82552°, −155.47587° and mast 13 m from arXiv 2508.00245; pointing az 81.2°, alt 19.6° from its Table 2.3; credit "NAOJ & Asahi Shimbun", non-commercial ([sources.md](../verification/sources.md) claims 5, 9, 28; DECISIONS "Data sources"). The resolver pages returned `Kj5DjRYkzD8` and `Q3UhCgsWDw8` with CORS `*` at about 10:00Z on 2026-10-11.
- **Synthetic cameras:** `heightM` 4204 is CFHT's published altitude and the Polaris and flat-sea fixture height, not DEM ground (about 4171 m, [terrain.md](../verification/terrain.md)). `focalPx` 325.94932345220167 is 1024/π, which equals `syntheticFisheyeCalibration(1024).focalPx`.
- **`geoidSepM`:** EGM96 from pyproj 3.8.0 / PROJ 9.8.1 with network grids (`EPSG:4326+5773` to `EPSG:4979`): CFHT coordinates 24.226 m, Subaru 24.316 m, Walenstadt 47.084 m, rounded to 0.01 m. Without the network grids PROJ silently returns 0.
- **`cfht-nanaao`:** copied verbatim from [M4 step 9](M4-camera-model.md), which owns it (tilted equidistant fit on two 2025 frames).
- **`subaru-starcam`, `cfht-starcam`:** copied from [M5 step 2](M5-live-video.md), which owns them (names and `termsNote` included). Under O1 both `termsNote` values are exactly `"YouTube embed; non-commercial use with credit"`, and M5 step 2 must carry the same strings: M9's `readme.test.ts` compares them as exact substrings.
- Compared field by field on 2026-10-11 (script, after the O1 edit): `cfht-nanaao` is identical to the M4 step 9 block, and the two StarCam entries are identical to the M5 step 2 block in every field other than `termsNote`.

Provisional fields. The milestone that enables an entry owns its final values, edits it in place, and moves its id into `ENABLED_CAMERA_IDS`:

| Entry (enabled in) | Provisional | Settled by |
| ------------------ | ----------- | ---------- |
| `synthetic-maunakea` (M1) | `mastM` (M6 sets 33: DEM ground 4,170.9 m + 33 = `heightM`) | M6 |
| `cfht-nanaao` (M4) | `imageSize` and `lens` (two 2025 frames), every `defaults` field, `captureLagMs`, `exposureSec`, `mastM` | M4 step 18 refit on a 2026 frame; `naturalWidth` of the first frame; M6 for `mastM` |
| `subaru-starcam` (M5) | `heightM` (DEM 4135 + 13 m; the paper says 4153), `focalPx` (70° nominal; lens and sensor give about 2589; the star fit on the 2026-10-11 clip gave 2525.93), `azDeg`/`altDeg` (published centre; the fit gave 81.2322°/19.6185°, roll 0.7698°, k1 −0.00992), `streamDelayMs` (measured 45–57 s), `youtubeVideoId`, `credit.href` | night-frame calibration (the clip's star fit, [README camera registry](README.md#camera-registry)); the runtime resolver |
| `cfht-starcam` (M5) | `site` (CFHT's published point; mount unknown), every `defaults` field (az 270 only says "faces west"), `youtubeVideoId` | M5 calibration; the resolver; M6 for `mastM` (33) |
| `synthetic-walenstadt` (M6) | `heightM` (Terrarium z15 467.6; swissALTI3D 465.2) | M6 |

`src/app/cameras.ts`:

1. `parseCameraRegistry(json: unknown): Record<string, CameraConfig>`: entries keyed by id in file order. It throws one `Error` whose message lists every problem ([Errors](README.md#errors) rule 2): not a non-empty array; an id missing, duplicated or not `/^[a-z0-9-]+$/`; `DEFAULT_CAMERA_ID` absent; `kind` not one of the four; `source` not `null` for `synthetic`; for `still-image` an `imageUrl` not starting `https://`, `refreshSec < STILL_IMAGE_MIN_REFRESH_SEC`, a non-boolean `corsEnabled`, or negative `captureLagMs`/`exposureSec`; for `youtube` an id not `/^[A-Za-z0-9_-]{11}$/` or a `resolverUrl` neither string nor null; for `local-video` a `sidecarUrl`, `sourceCameraId` or `videoUrl` neither string nor null, or a `startUtcMs` neither number nor null; `latDeg` outside ±90 or `lonDeg` outside ±180; a non-finite `heightM` or `geoidSepM`; `mastM < 0`; a `timeZone` that `new Intl.DateTimeFormat("en-US", { timeZone })` rejects (it throws `RangeError`); `imageSize` not positive integers; `lens` not one of the five; any of the 12 `Calibration` fields missing or mistyped; `focalPx ≤ 0`; the principal point outside the image; empty `credit.text`; `termsNote` not a string.
2. `ENABLED_CAMERA_IDS: readonly string[] = ["synthetic-maunakea"]` and `enabledCameras(all)`, the enabled subset in file order. Only that subset goes into `setRegistry`, so M2 and M3 see exactly one camera.

### Step 6. `src/app/url.ts`

Rules from [README URL and persistence](README.md#url-and-persistence), plus:

1. `interface UrlState { cam: string | null; tMs: number | null }` (M3 adds `sel`, M9 `demo`).
2. `parseUrlState(search)` reads with `URLSearchParams` (it decodes `%3A`). `t` is accepted only if it matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/` and `Date.parse` is finite; otherwise `tMs` is `null`. Zone-less values are rejected, never guessed (Gotcha 11).
3. `writeUrlState(state)` returns `?cam=<encodeURIComponent(activeId)>`, plus `&t=<isoUtcSeconds(simTimeMs)>` in replay mode. Write the colons raw: `URLSearchParams.toString()` would give `t=2026-10-10T15%3A30%3A00Z` (verified).
4. `startUrlSync(store, write, delayMs = 250): () => void` subscribes with `shallow` to `[activeId, mode, playing ? null : simTimeMs]` and calls `write(writeUrlState(state))` once at start and then 250 ms after the last change (trailing debounce). So the URL follows camera, mode, pause and every seek or step while paused, never ticks while playing. `main.tsx` passes a writer that calls `history.replaceState(null, "", search + location.hash)` inside `try/catch` and `console.warn`s on failure. Reason: WebKit throws `SecurityError: Attempt to use history.replaceState() more than 100 times per 10 seconds` (verified in Playwright WebKit 2370; Chromium 1248 accepted 1,000 calls), and a held arrow key repeats about 30 times a second.

### Step 7. `src/app/keyboard.ts`

`handleKeyDown(store: AppStore, e: KeyLike): boolean` returns true when it handled the key. `KeyLike` has `key`, `shiftKey`, `altKey`, `ctrlKey`, `metaKey`, `defaultPrevented` and `target: unknown`, so Node tests pass plain objects. `installKeyboard(store): () => void` adds one `keydown` listener on `window`, calls `preventDefault()` when the handler returns true, and returns the remover.

Keys from [README Keyboard](README.md#keyboard): `" "` `togglePlay()`; ArrowLeft/ArrowRight `stepBy(∓1000)`, with Shift `∓60000`; `[`/`]` previous/next of 1, 10, 60, 600, clamped at the ends; `l`/`L` `togglePanel("layers")`.

The handler returns false (does nothing) when:

1. the target's `tagName` is INPUT, TEXTAREA or SELECT, or it `isContentEditable` (README rule);
2. `defaultPrevented` is true. OpenLayers `KeyboardPan` on the focused map calls `preventDefault()` before the event reaches `window` (verified: arrow on the focused map, `defaultPrevented` true at `window`, time unchanged);
3. Alt, Ctrl or Meta is held (Cmd+[ is browser Back);
4. the key is Space and the target is a BUTTON. Otherwise the handler's `preventDefault()` cancels the button's own activation. Verified: Space on a focused "Forward 1 minute" stepped 60 s with this rule, and toggled play without stepping when the rule was removed.

### Step 8. `src/app/credits.ts`

1. `GIBS_CREDIT: Credit`: text exactly as in [README Credits](README.md#credits) (verified on the GIBS docs page today), `href` `https://nasa-gibs.github.io/gibs-api-docs/`, no licence.
2. `OSM_NE_CREDIT`: text `© OpenStreetMap contributors, Natural Earth` (the Reference_Labels layer-metadata subtitle), `href` `https://www.openstreetmap.org/copyright`, `licence` `ODbL-1.0`, `licenceHref` `https://opendatacommons.org/licenses/odbl/` (both 200). OSM requires the credit and a licence link ([gibs.md](../verification/gibs.md) claim 6).
3. `TRUE_COLOR_INSTRUMENT = "NOAA-20 / VIIRS"`, the layer-metadata subtitle of `TRUE_COLOR_LAYER` (verified; NOAA-21's is `NOAA-21 / VIIRS`). Change both constants together.
4. `dataCredits(layers, gibsReady): Credit[]` ([README section 6](README.md#state-app-and-map-modules)). M1 lands it with `layers: Pick<LayersState, "trueColor" | "coastlines">`; M3 adds `satellites` and `starlink`, M7 adds `goesIr`. In M1 it returns `[]` unless `gibsReady`; then `GIBS_CREDIT` when either layer is on, and `OSM_NE_CREDIT` when `coastlines` is on. (From M3, `CELESTRAK_CREDIT` does not depend on `gibsReady`.) Callers pass `store.getState().layers`. It returns a new array: call it during render, never inside `useAppState` (React error #185).

### Step 9. `src/map/registry.ts`

The one implementation of [README Map lifecycle](README.md#map-lifecycle) steps 1–3. `createGroundMap` uses it now; `SkyView` (M2) calls `registerMap("sky", …)` with its binding and frame-updater disposers.

```ts
import type OlMap from "ol/Map";

export type MapId = "ground" | "sky";

export const registry = new Map<MapId, OlMap>();

export function registerMap(
  id: MapId,
  map: OlMap,
  disposers: ReadonlyArray<() => void>,
): () => void {
  registry.set(id, map);
  return () => {
    for (const dispose of disposers) dispose();
    for (const layer of map.getAllLayers()) layer.dispose();
    map.dispose(); // also clears the target; it does not dispose layers
    if (registry.get(id) === map) registry.delete(id);
  };
}

/** Called by clockLoop.ts on frames where the sim time changed. */
export function renderSyncAll(): void {
  for (const map of registry.values()) map.renderSync();
}
```

### Step 10. `src/map/ground/layers/gibs.ts`

Every GIBS source in the app comes from `gibsWmtsOptions`. KVP is required because, by default, `optionsFromCapabilities` picks REST and spreads tiles over three templates, two without `{Time}` ([openlayers.md](../verification/openlayers.md) claim 1). The type narrows `WMTSCapabilities#read`, which returns `any`.

```ts
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import TileLayer from "ol/layer/Tile";
import WMTS, { optionsFromCapabilities, type Options as WmtsOptions } from "ol/source/WMTS";

export const TRUE_COLOR_LAYER = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
export const OVERLAY_LAYERS = ["Coastlines", "Reference_Labels"] as const;
export const LEVEL9 = "GoogleMapsCompatible_Level9";

interface CapsLink {
  TileMatrixSet: string;
  TileMatrixSetLimits?: unknown;
}
interface CapsLayer {
  Identifier: string;
  TileMatrixSetLink: CapsLink[];
}
export interface GibsCapabilities {
  Contents: { Layer: CapsLayer[] };
}

/** WMTSCapabilities#read is typed `any`: narrow it once, here. Main thread only (DOMParser). */
export function parseGibsCapabilities(xml: string): GibsCapabilities {
  const caps: unknown = new WMTSCapabilities().read(xml);
  const layers = (caps as { Contents?: { Layer?: unknown } } | null)?.Contents?.Layer;
  if (!Array.isArray(layers)) throw new Error("GIBS capabilities: no Contents/Layer");
  return caps as GibsCapabilities;
}

/** A copy of caps in which `layer` has no TileMatrixSetLimits. GIBS publishes wrong ones for GOES (M7). */
function withoutLimits(caps: GibsCapabilities, layer: string): GibsCapabilities {
  const Layer = caps.Contents.Layer.map((l) =>
    l.Identifier !== layer
      ? l
      : {
          ...l,
          TileMatrixSetLink: l.TileMatrixSetLink.map((k) => ({ TileMatrixSet: k.TileMatrixSet })),
        },
  );
  return { ...caps, Contents: { ...caps.Contents, Layer } };
}

export function gibsWmtsOptions(
  caps: GibsCapabilities,
  layer: string,
  matrixSet: string,
  dropLimits = false,
): WmtsOptions {
  const opts = optionsFromCapabilities(dropLimits ? withoutLimits(caps, layer) : caps, {
    layer,
    matrixSet,
    requestEncoding: "KVP",
    crossOrigin: "anonymous",
  });
  if (opts === null) throw new Error(`GIBS: ${layer} not in capabilities`);
  if (opts.matrixSet !== matrixSet) throw new Error(`GIBS: ${layer} has no ${matrixSet}`);
  if (opts.requestEncoding !== "KVP" || opts.urls?.length !== 1)
    throw new Error(`GIBS: no KVP GetTile for ${layer}`);
  return opts;
}

/** Time is set here: the capabilities Default is today's UTC date, whose tiles are black. */
export function createTrueColorLayer(caps: GibsCapabilities, dateUtc: string): TileLayer<WMTS> {
  const opts = gibsWmtsOptions(caps, TRUE_COLOR_LAYER, LEVEL9);
  return new TileLayer({ source: new WMTS({ ...opts, dimensions: { Time: dateUtc } }) });
}
```

The rest of the file: `createOverlayLayers(caps)` returns one `TileLayer` per `OVERLAY_LAYERS` id from `gibsWmtsOptions(caps, id, LEVEL9)`. `loadGibsCapabilities(url)` fetches, throws on `!res.ok`, parses, calls `gibsWmtsOptions` for the three M1 layers so a bad snapshot fails at load, and keeps the result in a module variable that `getGibsCapabilities()` returns (`null` before or after a failure).

Verified on the snapshot in headless Chromium:

- **Level9 layers:** `urls` `["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?"]`, encoding KVP, style `default`, EPSG:3857, `wrapX` true, `crossOrigin` `anonymous`, grid `maxZoom` 9, z5 range 0–31 × 0–31.
- **Formats and dimensions:** VIIRS is `image/jpeg` with `dimensions` `{ Time: "2026-10-11" }`, the black Default. The overlays are `image/png` with `{}`.
- **GOES:** with limits, `maxZoom` 5 and z5 columns 0–13, rows 0–18. With `dropLimits`, `maxZoom` 6 and z5 0–31 × 0–31. The shared `caps` was unchanged afterwards.
- **Parse cost:** about 1 ms for the snapshot, against 161–167 ms for the full document.
- **Tile URL** for [5, 2, 14]: `…/wmts.cgi?layer=VIIRS_NOAA20_CorrectedReflectance_TrueColor&style=default&tilematrixset=GoogleMapsCompatible_Level9&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix=5&TileCol=2&TileRow=14&Time=2026-10-10`.
- **Live run:** the built app at `?t=2026-10-10T08:00:00Z` made 18 requests per layer, all 200 with `access-control-allow-origin: *`, and logged no console errors.

### Step 11. Site marker and layer visibility

1. `layers/site.ts`: `createSiteLayer(): { layer: VectorLayer<VectorSource<Feature<Point>>>; feature: Feature<Point> }`, one feature. The marker is labelled with the feature's `name`; its look is visual design.
2. `sync/bindSite.ts`: `bindSite(store, feature, view): () => void` subscribes to `selectActiveCamera` with `shallow` and `fireImmediately`. For a camera it sets `new Point(fromLonLat([site.lonDeg, site.latDeg]))`, sets `name` to `camera.name`, and centres the view there. For `undefined` it clears the geometry. M4 adds the wedge here.
3. `sync/bindLayers.ts`: `bindLayerVisible`, copied from the [README](README.md#binding-rules).

### Step 12. `src/map/sync/bindGibs.ts`: the binding pattern

The first binding that also listens to OpenLayers. Every later binding has the same shape: a selector returning a primitive, `shallow`, `fireImmediately`, listeners that only mutate OpenLayers objects, and one returned function that removes everything it added ([Binding rules](README.md#binding-rules)).

```ts
import { unByKey } from "ol/Observable";
import type WMTS from "ol/source/WMTS";
import { shallow } from "zustand/vanilla/shallow";
import { selectTrueColorDate } from "../../state/selectors";
import type { AppStore } from "../../state/store";

export function bindTrueColorDate(store: AppStore, source: WMTS): () => void {
  let lastGood: string | null = null;
  // OpenLayers never re-requests an errored tile: going back to a failed Time would spin the map.
  const failed = new Set<string>();
  const currentTime = (): unknown => source.getDimensions().Time;
  const keys = [
    source.on("tileloadend", (e) => {
      const time = currentTime();
      if (e.tile.key === source.getKey() && typeof time === "string") lastGood = time;
    }),
    source.on("tileloaderror", (e) => {
      const time = currentTime();
      if (e.tile.key !== source.getKey() || typeof time !== "string" || time === lastGood) return;
      failed.add(time);
      if (lastGood !== null) source.updateDimensions({ Time: lastGood });
    }),
  ];
  const unsubscribe = store.subscribe(
    selectTrueColorDate,
    (date) => {
      if (date === null) return;
      source.updateDimensions({ Time: failed.has(date) && lastGood !== null ? lastGood : date });
    },
    { equalityFn: shallow, fireImmediately: true },
  );
  return () => {
    unsubscribe();
    unByKey(keys);
  };
}
```

- The dimension key must be exactly `Time` ([gibs.md](../verification/gibs.md) claim 4).
- `updateDimensions` with an unchanged value is a no-op (`setKey`, `ol/source/Tile.js:149`), so the immediate first call costs nothing.
- `TileImage` stamps each tile with the source key when it creates it (`ol/source/TileImage.js:216`), so `e.tile.key !== source.getKey()` filters late events from an older Time.
- This is [README Errors](README.md#errors) rule 6. Verified in headless Chromium with the new date answering 404: `Time` went back to the old date and the map made 0 `postrender` events in the next idle second. With the very first Time failing there is nothing to go back to: the layer stays empty, idle 0 `postrender`, and one `map.render()` gave 1 `postrender` and 1 `rendercomplete` (no spin).
- A failed Time is never selected again in the session. OpenLayers keeps the errored tiles under that Time's key and never requests them again, so no new `tileloaderror` fires. Verified in headless Chromium: after the revert, stepping back across the flip and forward again with a binding that only reverts put `Time` back on the failing date, made 0 requests, 60 `postrender` per idle second and no `rendercomplete`. With the `failed` set, `Time` stayed on the good date and the map idled (0 `postrender`). The same held when the first Time failed, a later date loaded, and the clock went back to the first date. M7 measured the same for GOES ([M7](M7-weather-imagery.md) Gotcha 3).
- An error on the Time that last loaded a tile (`time === lastGood`) changes nothing.

### Step 13. `createGroundMap` and `GroundView`

`createGroundMap(target: HTMLElement, store: AppStore, caps: GibsCapabilities | null): () => void`:

1. Build `new View({ center: [0, 0], zoom: 6, minZoom: 2, maxZoom: 12 })`. Level9 tiles overzoom past z9; `bindSite` centres the view.
2. If `caps` is not null and `selectTrueColorDate(store.getState())` is not null: create the true-colour layer with that date, so the black Default is never requested, then the two overlay layers. Bind with `bindLayerVisible(store, "trueColor", trueColor)`, `bindTrueColorDate(store, source)` and `bindLayerVisible(store, "coastlines", overlay)` for each overlay.
3. Add the site layer last and bind it with `bindSite`.
4. Create `new OlMap({ target, layers, view, controls: defaultControls({ attribution: false }) })`: `Credits.tsx` is the only credit display.
5. Return `registerMap("ground", map, disposers)`.

`GroundView.tsx` imports no OpenLayers module ([import rule 4](README.md#3-file-layout)). Its effect builds the map only when the data it needs have settled:

```tsx
useEffect(() => {
  const el = ref.current;
  if (el === null || cameras !== "ready" || (gibs !== "ready" && gibs !== "error")) return;
  // A new map on every run: StrictMode runs mount, cleanup, mount in development.
  return createGroundMap(el, store, gibs === "ready" ? getGibsCapabilities() : null);
}, [cameras, gibs]);
```

The container is a `div` with `data-map="ground"`, `role="application"`, `aria-roledescription="map"`, `tabIndex={0}` and the `aria-label` "Ground map around the camera site: <camera name>". It is focusable so OpenLayers `KeyboardPan` and `KeyboardZoom` work. Put `// biome-ignore lint/a11y/noNoninteractiveTabindex: <reason>` on the line directly above `tabIndex`. It needs a non-zero size, set with any CSS (Gotcha 15).

States, shown with `role="status"` (wording may change, meaning may not):

- `data.cameras` loading: "Loading cameras…".
- `data.cameras` error: "Camera list failed to load" and a Reload button.
- `data.gibs` loading: "Loading NASA imagery…".
- `data.gibs` error: "NASA imagery unavailable". The map then shows only the site marker.

Verified in a development build under `<StrictMode>`. With the data ready before mount, the registry log was `set, delete, set`, with one `.ol-viewport`, 36 GIBS requests (the same as one mount, so the disposed map requested nothing) and no console errors. With the data arriving after mount (the real boot order), the log was a single `set`.

### Step 14. `src/state/clockLoop.ts`

1. **Live branch:** when `mode` is `live` and the active camera is `synthetic` (or the registry has not loaded), sim time is `Date.now()`. If `|Date.now() − rangeCenterMs| > SCRUB_HALF_RANGE_MS`, call `jumpToNow()` instead, so long live sessions keep the scrubber around now.
2. **Render:** after the tick and the frame updaters, call `renderSyncAll()` only on frames where `simTimeMs` changed. OpenLayers schedules its own renders for interaction, tile loads and toggles. Verified on the ground map: 0 `postrender` per idle second while paused, 60–61 per second while playing. Why `renderSync` at all: [architecture.md](../verification/architecture.md) claim 5 (one frame late, or 30 fps).

### Step 15. Timeline, Layers panel, Credits

All three follow the [React rules](README.md#react-rules) and the [accessibility rules](README.md#accessibility).

`Timeline.tsx` re-renders only through `useTick4Hz` and reads `store.getState().clock` during render:

1. A "Live" button with `aria-pressed` = `mode === "live"`. In replay it calls `jumpToNow()` then `setMode("live")`; in live, `setMode("replay")`. A text with `data-testid="time-mode"` reads "Live" or "Replay".
2. One play button labelled "Play" or "Pause" (`useClockControls`), calling `togglePlay`.
3. Rate: a `fieldset` with legend "Rate" and four radios "1×", "10×", "60×", "600×" calling `setRate`.
4. Buttons "Back 1 minute", "Back 1 second", "Forward 1 second", "Forward 1 minute" calling `stepBy`.
5. Scrubber: `<input type="range" aria-label="Simulation time" min={-43200} max={43200} step={1}>`, value `round((simTimeMs − rangeCenterMs) / 1000)`, `aria-valuetext` the UTC readout, `onChange` → `seek(rangeCenterMs + value × 1000)`, then re-render `Timeline` in the same handler (for example `const [, rerender] = useReducer((n: number) => n + 1, 0)` and `rerender()` after `seek`). The input is controlled and `Timeline` otherwise re-renders only at 4 Hz, so React resets the thumb to the stale value after every change. Verified: without the re-render, 20 ArrowRight presses on the focused slider moved the clock 1 s and a mouse drag stuck; with it, 20 presses moved 20 s and the drag followed the pointer. This is a re-render on the user's own input, not a subscription to `clock.simTimeMs` (React rule 5).
6. A "Now" button calling `jumpToNow`.
7. Readouts: UTC `<time data-testid="time-utc">` with `isoUtcSeconds(simTimeMs)`, and local `data-testid="time-local"` with `` `${formatZonedDateTime(simTimeMs, site.timeZone)} ${site.timeZone}` `` (for example `2026-10-09 17:30:00 Pacific/Honolulu`). The local readout is not a `<time>` element: M0's smoke spec reads the Timeline region's only `time`, and a second one fails it with a strict-mode violation (verified). No `aria-live`: four updates a second would flood a screen reader.

`LayerToggles.tsx`:

1. A "Layers" button with `aria-expanded` = `ui.panel === "layers"` and `aria-controls="layers-panel"`, calling `togglePanel("layers")` (also `L`). The panel is `<section id="layers-panel" aria-label="Layers" hidden={!open}>`.
2. Checkbox `True colour (NOAA-20 / VIIRS, <selectTrueColorDate>)` for `layers.trueColor`, and "Coastlines and place labels" for `layers.coastlines`, both calling `toggleLayer`.
3. While `data.gibs` is not `ready`, both are disabled and the panel shows the same status text as the map.

`Credits.tsx` is a `<section aria-label="Credits">` rendered at all times, outside every pane and panel. In order:

1. the active camera's `credit` (linked when `href` is set; licence linked when set) and its `termsNote` when non-empty;
2. `dataCredits(...)`;
3. while GIBS is ready and true colour is on, `Imagery: NOAA-20 / VIIRS, <date>`.

External links use `target="_blank" rel="noopener noreferrer"`. (`<footer aria-label>` fails Biome's `useAriaPropsSupportedByRole`.)

### Step 16. `main.tsx` and `App.tsx`

Boot order in `main.tsx`:

1. `import "ol/ol.css"` (OpenLayers' own control styles; without it the hidden rotate button shows).
2. `const url = parseUrlState(location.search)`. If `url.tMs !== null`, call `actions.recenter(url.tMs)`. Otherwise call `actions.setMode("live")`, with a `console.warn` when a `t` was present but rejected.
3. `installKeyboard(store)`, `startClockLoop(store)`, then render (M0's `StrictMode`).
4. Cameras:
   1. `setLoadStatus("cameras", "loading")`.
   2. Fetch `${import.meta.env.BASE_URL}data/cameras.json`, then `parseCameraRegistry` and `setRegistry(enabledCameras(all))`.
   3. `setActiveCamera(url.cam)` if that id is enabled, else `DEFAULT_CAMERA_ID`. `console.warn` "not enabled yet" for a known id and "unknown" otherwise.
   4. `setLoadStatus("cameras", "ready")`, then `startUrlSync`.
   5. On any failure, `console.error` and `"error"`.
5. In parallel: `setLoadStatus("gibs", "loading")`, then `loadGibsCapabilities` with `${import.meta.env.BASE_URL}data/gibs-capabilities.xml`, then `"ready"`, or `"error"` after `console.error`.

`App.tsx` keeps M0's three panes: `LayerToggles` and `GroundView` go in "Ground map", `Timeline` replaces `ClockStatus` in "Timeline", and `Credits` follows `<main>`. Placement is visual design. M0's acceptance check `grep -rn "import.meta.env" src` now finds `import.meta.env.BASE_URL`, which is not a secret.

### Step 17. e2e fixture

In `tests/e2e/fixtures.ts`, add a second auto fixture, `routes`, that takes `guard` as a parameter. M0 step 9 says milestones add mocks after the guard and never edit it, and M0 Gotcha 15 names this pattern. Because `routes` depends on `guard`, Playwright sets it up after the catch-all, and it tries the newest matching route first. Later milestones add their routes inside `routes`. Excerpt (M0's `guard` entry stays as it is):

```ts
import { fileURLToPath } from "node:url";
import { test as base, expect, type Route } from "@playwright/test";

const GIBS_TILE_JPG = fileURLToPath(new URL("../fixtures/gibs/tile.jpg", import.meta.url));
const GIBS_TILE_PNG = fileURLToPath(new URL("../fixtures/gibs/tile.png", import.meta.url));

export const test = base.extend<{ guard: Guard; routes: undefined }>({
  // guard: M0's auto fixture, unchanged.
  // Depends on `guard`, so it is set up after the catch-all and its routes are tried first.
  routes: [
    async ({ context, guard }, use) => {
      await context.route("**/gibs.earthdata.nasa.gov/**", (route: Route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("Request") !== "GetTile") {
          guard.blockedRequests.push(url.href);
          return route.abort("blockedbyclient");
        }
        const jpeg = url.searchParams.get("Format") === "image/jpeg";
        return route.fulfill({
          status: 200,
          path: jpeg ? GIBS_TILE_JPG : GIBS_TILE_PNG,
          contentType: jpeg ? "image/jpeg" : "image/png",
          headers: { "access-control-allow-origin": "*" },
        });
      });
      await use(undefined);
    },
    { auto: true },
  ],
});
```

Type the fixture `undefined`, not `void`: Biome's `noConfusingVoidType` warns on `void`, and `--error-on-warnings` fails CI (verified). With this fixture all 9 specs passed.

Never fulfil a tile with 404: Chromium logs every 404 as a console error, which fails the guard (verified: 12 errors for 12 tiles). The snapshot and `cameras.json` are same-origin and need no route. In M0's `smoke.spec.ts`, the Play test must start at `/?t=2026-10-10T03:30:00Z`: without `t` the app now starts live and playing.

### Step 18. Documentation

Root `README.md`: an "M1 · Ground map" section with what the map shows, the snapshot command (step 1), the tile commands (step 2) and the credits. Append section 8 to `docs/DECISIONS.md`.

## 5. Tests

Unit tests run in Vitest, `environment: "node"`, with no network. `storeAt(iso)` in `tests/helpers/store.ts` builds `createAppStore(initialState(Date.parse(iso), DEFAULT_CAMERA_ID))` and calls `setRegistry(enabledCameras(parseCameraRegistry(<committed cameras.json read with node:fs>)))`. Integer-ms results are exact (`toBe`). All of the following passed (73 unit tests, M0's included).

| File | Checks | Fixture and tolerance |
| ---- | ------ | --------------------- |
| `time.test.ts` | `trueColorDateUtc` | exact strings: Maunakea −155.4689 at 2026-10-11T04:00:00Z → `2026-10-10`, 03:51:52Z → `2026-10-09`, 03:51:53Z → `2026-10-10`; 2026-10-10T03:30:00Z → `2026-10-08`, 04:00:00Z and 08:00:00Z → `2026-10-09`. Walenstadt 9.3242: 2026-10-11T03:00:00Z → `2026-10-10`; 2026-10-10T20:00:00Z → `2026-10-10`; 2026-10-10T16:52:42Z → `2026-10-09`, 2026-10-10T16:52:43Z → `2026-10-10`. Subaru −155.47587: 2026-10-11T03:51:54Z → `2026-10-09`, 03:51:55Z → `2026-10-10`. Lon −179.9: 2026-10-11T05:29:35Z → `2026-10-10`, 2026-10-11T05:29:37Z → `2026-10-11`. Lon 179.9: 2026-10-11T05:30:23Z → `2026-10-10`, 2026-10-11T05:30:25Z → `2026-10-11`. Lon 0: 2026-10-11T17:29:59.999Z → `2026-10-10`, 2026-10-11T17:30:00Z → `2026-10-11`. Plus 2,000 seeded pairs (mulberry32, seed 20261011; lon uniform in [−180, 180); time uniform over 2026) against a local-frame reference (local pass = local midnight + 13.5 h, at or before t − 4 h), all equal; and the same string instance for two calls 1 s apart |
| `time.test.ts` | `isoDateUtc`, `formatZonedDateTime` | `isoDateUtc(1791603000123)` `2026-10-10`; Honolulu at 2026-10-10T03:30Z `2026-10-09 17:30:00`, at 10:00Z `2026-10-10 00:00:00`; Europe/Zurich at 03:30Z `2026-10-10 05:30:00`, 2026-12-10T03:30Z `2026-12-10 04:30:00`, 2026-10-10T22:00Z `2026-10-11 00:00:00` |
| `actions.test.ts` | M1 actions | `recenter(1791603000000)` from live gives exactly `{ mode: "replay", playing: false, rate: 1, simTimeMs, rangeCenterMs }`; `stepBy(+13 h)` stops at centre + 43,200,000 and switches to replay; `seek(centre − 50 h)` gives −43,200,000; `setRate(60)` in live gives replay at 60; `setMode("live")` gives rate 1 and playing; `jumpToNow` under `vi.setSystemTime` sets both times; `setActiveCamera` clears `frameTimeMs`; `togglePanel("layers")` twice returns to `null` |
| `selectors.test.ts` | `selectTrueColorDate`, `selectSite` | `2026-10-08` at 2026-10-10T03:30:00Z, `2026-10-09` after 30 min; `null` with an empty registry; `selectSite` returns the same reference across 100 ticks |
| `store.test.ts` (M0) | unlanded actions | 27 remain; each throws `/^actions\.<name> lands in M[2-9]$/` |
| `cameras.test.ts` | committed file | ids in order `synthetic-maunakea`, `cfht-nanaao`, `subaru-starcam`, `cfht-starcam`, `synthetic-walenstadt`; `enabledCameras` keeps only the first; its `focalPx` equals 1024/π to 1e-9; Subaru `site` deep-equals the step 5 values and `defaults` match az 81.2, alt 19.6, f 2742, delay 50,000. A duplicated entry plus `latDeg` 91 and `timeZone` `Not/AZone` on one entry throws one Error naming all three; `[]` throws `cameras.json: expected a non-empty array` |
| `url.test.ts` | parse, write, sync | `?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z` → `{ cam, tMs: 1791603000000 }`; `%3A`-encoded and `T03:30Z` give the same; `.123Z` keeps the ms; `2026-10-10T03:30:00`, `2026-10-10`, `2026-13-45T99:99:00Z`, `+00:00` and empty give `null`. Replay at 1791603000123 writes `?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z`; live writes `?cam=synthetic-maunakea`. `startUrlSync` with fake timers: 1 write at start; 30 steps write nothing until 250 ms after the last, then exactly one (`…T04:00:00Z`); `play` is one more write; 100 ticks while playing write nothing |
| `keyboard.test.ts` | `handleKeyDown` with plain objects | ArrowRight +1,000 ms; Shift+ArrowLeft −60,000 ms; 780 Shift+ArrowRight stop at +43,200,000; returns false and changes nothing for an INPUT target, a contenteditable target, `defaultPrevented`, Meta+`]` and Ctrl+ArrowRight; `]` 1 → 10, five more clamp at 600, `[` gives 60; Space on a BUTTON returns false, elsewhere toggles play; `l` then Shift+`L` opens and closes Layers |
| `credits.test.ts` | `dataCredits` | the four layer combinations with `gibsReady` true; `[]` when false |
| `gibsSnapshot.test.ts` | committed snapshot, scripts imported | `snapshotProblems(snapshot)` `[]`, size < 40,000 B; removing the GetTile operation yields exactly the KVP message; `trimGibsCapabilities` on a 2-layer, 2-set string keeps and drops by id |
| `registry.test.ts` | `registerMap` with fake maps | the first cleanup logs `unbind`, `layer.dispose`, `map.dispose` in that order and leaves a newer entry in place; `renderSyncAll` reaches it; the second cleanup empties the registry |
| `bindGibs.test.ts` | `bindTrueColorDate` on a real `WMTS` built from options (no DOM) | grid `new WMTSTileGrid({ origin: getTopLeft(EPSG:3857 extent), resolutions: 156543.03392804097 / 2^z for z 0–9, matrixIds "0"–"9" })`, KVP, `image/jpeg`, Time `2026-10-08`, store at 2026-10-10T03:30:00Z. Binding: 0 `change` events. 30 × `stepBy(60000)`: exactly 1, Time `2026-10-09`, tile URL for [5, 2, 14] ends `&Time=2026-10-09`. After unbind, 30 steps back: still 1. Revert: dispatch `new TileSourceEvent("tileloadend", tile)` for `new Tile([5, 2, 14], TileState.LOADED)` with `tile.key = source.getKey()`, step to 2026-10-09, dispatch `tileloaderror` with the old key (no change), then with the current key: Time back to `2026-10-08`. A first-Time error with nothing loaded leaves Time unchanged. No return to a failed Time: after that revert, 30 steps back and 30 forward (the selector gives `2026-10-08`, then `2026-10-09` again) leave Time `2026-10-08`; and with `2026-10-08` failing first and `2026-10-09` then loading, 30 steps back leave Time `2026-10-09`. Both cases fail on a binding without the `failed` set |
| `bindSite.test.ts` | `bindSite`, real `View` and `Feature` | coordinates equal `fromLonLat([-155.4689, 19.8253])` (−17306718.78, 2252346.76 to 0.01 m) and the view centre; `name` is the camera name; 1 geometry change over 100 ticks; with the full registry, `setActiveCamera("synthetic-walenstadt")` moves both; nothing moves after unbind |
| `bindLayers.test.ts` | `bindLayerVisible` | two overlay layers start hidden when `coastlines` is false and both show after `toggleLayer` |
| `clockLoop.test.ts` (M0's file) | live branch, render | with `vi.useFakeTimers({ toFake: ["Date"] })`: live gives `simTimeMs === Date.now()`; at centre + 43,200,001 ms it recentres (both times equal now, still live). A fake map in `registry`: 0 `renderSync` calls over 10 paused frames, 10 over 10 playing frames |

End-to-end (Playwright, the shared fixture, `vite preview`, default 1280 × 720 viewport):

`tests/e2e/gibs-time.spec.ts`, "every true-colour tile request carries the clock's date, before and after a date change". This is the acceptance test.

1. Record every request to `gibs.earthdata.nasa.gov` whose `Request` is `GetTile` as `{ layer, time: searchParams.get("Time"), tile: "TileMatrix/TileRow/TileCol" }`. `URLSearchParams` decodes `%3A` ([README end-to-end tests](README.md#end-to-end-tests) item 5). Count completions with `requestfinished` and `requestfailed`.
2. `goto("/?t=2026-10-10T03:30:00Z")`. Assert the map's bounding box is at least 512 × 256 px.
3. Wait for quiet: `expect.poll` every 100 ms (timeout 10 s) until there is at least one request, none is pending, and nothing changed for 500 ms.
4. Assert: at least 4 true-colour requests; their `Time` set is exactly `{"2026-10-08"}`; every overlay request has no `Time`; `time-utc` reads `2026-10-10T03:30:00Z`; `time-local` reads `2026-10-09 17:30:00 Pacific/Honolulu`.
5. Note the count, then press `Shift+ArrowRight` 30 times (focus on the page, not the map).
6. Assert `time-utc` reads `2026-10-10T04:00:00Z` and the URL ends `?cam=synthetic-maunakea&t=2026-10-10T04:00:00Z`. Wait for quiet.
7. Over requests after the mark: at least as many true-colour requests as before; their `Time` set is exactly `{"2026-10-09"}`; their tile set equals the first set. Over the whole test, the true-colour `Time` set is exactly `{"2026-10-08", "2026-10-09"}`, so the capabilities Default never appears.

Verified: 18 true-colour and 36 overlay requests at load; 18 new true-colour requests, all `2026-10-09`, on the same tiles; no overlay re-requests. Two mutations failed it: dropping `requestEncoding: "KVP"` (no KVP tile requests; the guard blocked every REST tile request), and a binding that never calls `updateDimensions` (0 new requests).

`tests/e2e/ground-map.spec.ts` (all verified):

1. **"credits follow the layers"** at `?t=2026-10-10T03:30:00Z`: the Credits region contains "Computed sky (no camera image)", the GIBS acknowledgement, "Imagery: NOAA-20 / VIIRS, 2026-10-08" and a link "© OpenStreetMap contributors, Natural Earth" to `https://www.openstreetmap.org/copyright`. Press `l` and uncheck "Coastlines and place labels": "OpenStreetMap" disappears. Uncheck the "True colour" checkbox: "GIBS" disappears. The camera credit stays throughout.
2. **"timeline controls and keys"**: `time-mode` reads Replay; Space shows "Pause", Space again "Play"; `]` checks "10×"; Space on a focused "Forward 1 minute" gives `03:31:00Z` and leaves "Play"; a click gives `03:32:00Z`; `fill("-3600")` on the "Simulation time" slider gives `02:30:00Z`; then, with the slider focused, 20 × ArrowRight gives `02:30:20Z` (without the step 15 re-render it gives `02:30:01Z`).
3. **"arrow keys pan a focused map and leave the clock alone"**: one `.ol-viewport`; with the map focused, ArrowRight reaches `window` with `defaultPrevented` true and the time stays put; after `blur()`, ArrowRight adds 1 s.
4. **"live without t"**: at `/`, "Live" has `aria-pressed="true"`, `time-utc` is within 5 s of the test's `Date.now()`, and the URL ends `?cam=synthetic-maunakea`.
5. **"URL fallbacks"**: `?cam=nope&t=…` and `?cam=synthetic-walenstadt&t=…` both end on `?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z` (a `console.warn` is allowed); `?t=2026-10-10T03:30:00` (no `Z`) starts in Live. `synthetic-walenstadt` is the committed camera enabled last (M6), so M4 and M5 leave this case alone and M6 removes it.
6. **"map container is named"**: the role `application` named "Ground map around the camera site: Computed sky, Maunakea" is visible.

## 6. Acceptance criteria

1. The [definition of done](README.md#definition-of-done) holds: typecheck, lint, unit, build and e2e exit 0 in CI; no console errors and no third-party requests in any spec.
2. `gibs-time.spec.ts` passes. Before the date change every true-colour tile request carries `Time=2026-10-08`. After it, every one carries `2026-10-09` and none `2026-10-08`. The new requests cover every initial tile, and exactly two distinct `Time` values occur.
3. Every unit test in section 5 passes, including the 18 `trueColorDateUtc` cases, the 2,000 seeded pairs and the `bindTrueColorDate` counts (0, 1, revert, 1 after unbind) and its two no-return-to-a-failed-Time cases.
4. `public/data/gibs-capabilities.xml` was written by the script, is under 40,000 B, and passes `snapshotProblems`.
5. Credits are on screen at all times. The OSM line shows exactly while the overlays are on; the GIBS lines show while any GIBS layer is on.
6. Space, ← → (with Shift), `[` `]` and `L` work, and each has an on-screen control. The keys do nothing inside inputs or on the focused map, and Space activates a focused button instead of toggling play. Each ArrowRight on the focused "Simulation time" slider adds exactly 1 s.
7. `?t=` opens paused replay at that time. An unknown or not-yet-enabled `?cam=` falls back to the default. Stepping while paused updates the URL 250 ms after the last step.
8. In `npm run dev` (StrictMode), after load, `document.querySelectorAll('[data-map="ground"] .ol-viewport').length` is 1 and the console is clean. CI runs the production build, where effects run once, so this is a manual check.

Evidence in the pull request:

- The CI log lines with the unit and e2e test names (`npx vitest run --reporter=verbose`, `npm run e2e`).
- A screenshot of `npm run dev` at `/?t=2026-10-10T08:00:00Z` against live GIBS: Hawaii true colour for 2026-10-09, overlays, the site marker, the timeline and the credits.
- A clip of 20 s or less: from `/?t=2026-10-10T03:45:00Z`, step across 03:51:52Z with DevTools Network filtered by `Time=`, showing `2026-10-08` give way to `2026-10-09`.
- The trace from `npx playwright test gibs-time --trace on` (`test-results/…/trace.zip`, about 2.8 MB).
- The output of the criterion 8 check.

## 7. Gotchas

1. **OpenLayers defaults to REST for GIBS.** The GetTile operation lists RESTful first, so `optionsFromCapabilities` without `requestEncoding` collects three templates. About two thirds of tiles never carry `Time`, and those URLs return 200, so the bug is silent. Re-verified on the snapshot: REST, 3 urls, 1 with `{Time}`. Always use `gibsWmtsOptions`. ([openlayers.md](../verification/openlayers.md) claim 1, [gibs.md](../verification/gibs.md) claims 8 and 13)
2. **The capabilities Default is today's UTC date, which is black.** OpenLayers copies it into `dimensions` (`ol/source/WMTS.js:452`), so set `Time` when constructing the source. A black tile is a 200, so the error revert cannot catch it; only the 4 h rule prevents it. ([gibs.md](../verification/gibs.md) claims 1 and 4)
3. **A 404 Time makes OpenLayers spin.** With stale tiles from the previous Time, the map re-renders at about 60 fps and never fires `rendercomplete`. Revert, as in step 12. OpenLayers never re-requests an errored tile, so returning to a failed Time fires no new error and spins again: the binding must remember failed Times (step 12). Each 404 is also a console error, so test the revert in unit tests, never in e2e. ([openlayers.md](../verification/openlayers.md) claim 6)
4. **KVP needs `OperationsMetadata`.** With the operations removed from the snapshot, `requestEncoding: "KVP"` silently returned REST with 3 urls (verified). The script and `gibsWmtsOptions` both check for it.
5. **An unlinked matrix set falls back silently.** `optionsFromCapabilities` uses the layer's first `TileMatrixSetLink` when the requested set is not linked (`ol/source/WMTS.js:413`). Asking NOAA-20 for Level6 returned Level9 (verified). `gibsWmtsOptions` throws instead.
6. **`WMTSCapabilities` needs `DOMParser`.** It runs only on the main thread, never in a worker or in Vitest's Node environment, and `read()` returns `any`. Unit tests check the snapshot text; e2e covers parsing. ([gibs.md](../verification/gibs.md) claim 3, [openlayers.md](../verification/openlayers.md) claim 15)
7. **The `_15m` overlays misrender in EPSG:3857** (opaque black tiles and HTTP 500s). Use `Coastlines` and `Reference_Labels` on Level9. ([gibs.md](../verification/gibs.md) claim 10)
8. **StrictMode and disposal.** React 19 runs effects mount, cleanup, mount in development. `map.dispose()` does not dispose layers, and a disposed layer has a null source. Build everything inside the effect run. An effect re-run caused by a dependency change is not doubled, so the double mount appears only when the data are ready before mount. ([openlayers.md](../verification/openlayers.md) claim 5, [tooling.md](../verification/tooling.md) claim 6)
9. **Arrow keys belong to a focused map.** OpenLayers keyboard interactions listen on the map target, need `tabIndex`, and call `preventDefault`. The global handler skips `defaultPrevented` events. (verified)
10. **Space on a focused button.** The global handler's `preventDefault()` cancels the button's activation, so without the BUTTON rule Space toggles play instead of pressing the button. (verified)
11. **`Date.parse` without a zone is local time.** In Pacific/Honolulu, `2026-10-10T03:30:00` became 13:30Z in both Node and Chromium, while the date-only `2026-10-10` parsed as UTC midnight. Reject `?t=` without `Z`. (verified)
12. **WebKit rate-limits `history.replaceState`** to 100 calls per 10 s and then throws `SecurityError`. Debounce the writer and wrap it in `try/catch`. (verified)
13. **The true-colour date is not the UTC date.** At Maunakea it flips at 03:51:52.5Z. A spec that changes the date must cross that instant: 2026-10-10T03:30Z gives `2026-10-08`, and 04:00Z gives `2026-10-09`.
14. **`Time` is case-sensitive, and so are the KVP parameter names.** OpenLayers writes `layer`, `Request`, `Format`, `TileMatrix`, `TileCol`, `TileRow` and `Time`. Route matchers and recorders must read exactly these names with `searchParams.get`. ([gibs.md](../verification/gibs.md) claim 4)
15. **A zero-size map requests nothing.** Without styling, the container div has height 0, OpenLayers fetches no tiles, and the acceptance test fails on its first count. Give the container a size; the spec asserts at least 512 × 256 px.
16. **`ol/ol.css` is functional.** Without it, OpenLayers controls are unstyled and the rotate control (`ol-hidden`) stays visible. (verified by screenshot)
17. **`vite build` warns about a chunk over 500 kB** (about 564 kB, 172 kB gzipped, mostly OpenLayers). It is a warning, not a failure. Code splitting belongs to M9's performance pass.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M1's contract lines under "Contract changes from the implementation docs": the 13:30 true-colour pass, never reselecting a failed `Time`, `renderSyncAll()` only when sim time changed, `registerMap` as the one map cleanup, and `cameras.json` with `ENABLED_CAMERA_IDS`. Append the rest.

- True colour uses NOAA-20 only. NOAA-21 stays in the snapshot as the manual alternate; `TRUE_COLOR_LAYER` and `TRUE_COLOR_INSTRUMENT` change together. Reason: both were complete over Hawaii for 20 days; one layer keeps the e2e simple.
- The snapshot is the `LAYER`-filtered KVP capabilities, trimmed by regex to 5 layers and Level6/Level9. The script falls back to trimming the full document, refuses to write a snapshot that fails its checks, and the app never reads its Time values. Reason: 28.6 KB instead of 5.84 MB; Time values in a committed file are stale.
- GIBS sources set `crossOrigin: "anonymous"`. Reason: GIBS sends `access-control-allow-origin: *`; pixel reads stay possible.
- The Layers label keeps the requested true-colour date after a tile-error revert. Reason: showing the displayed date needs new state.
- The scrubber is a controlled range input, so `Timeline` re-renders in its own `onChange`. Reason: with only the 4 Hz re-render, React resets the thumb and keyboard steps on the slider are lost.
- e2e route mocks live in an auto fixture `routes` that depends on `guard`. Reason: M0's guard stays unedited, and the dependency orders the routes after the catch-all.
- e2e tile stubs are a real NOAA-20 tile and an empty Reference_Labels tile, chosen by `Format`. Reason: real decodable images, no OSM data committed.
- Live mode on a synthetic camera recentres the scrubber with `jumpToNow()` once now leaves ± 12 h. Reason: long live sessions.
- The app starts live when the URL has no `t`. Reason: the default camera is synthetic, whose live time is `Date.now()`.
- `?t=` must end in `Z`; the URL carries raw colons and `t` only in replay; writes are debounced 250 ms and wrapped in `try/catch`. Reason: zone-less dates parse as local time; readable links; the WebKit limit.
- The key handler also skips `defaultPrevented` events, Alt/Ctrl/Meta chords and Space on buttons. The ground map container is focusable (`role="application"`, Biome suppression). Reason: OpenLayers keyboard pan and zoom; Cmd+[ is Back; Space must press the focused button.
- The OpenLayers attribution control is off; the always-rendered Credits region is the only credit display; `ol/ol.css` is imported. Reason: one place that is always visible; working controls.
- `geoidSepM` is EGM96 from PROJ: 24.23 m at the CFHT point, 24.32 m Subaru, 47.08 m Walenstadt. `synthetic-walenstadt` uses `Europe/Zurich`. Reason: same method everywhere; Zurich and Vaduz agreed at every half hour from 2020 to 2030.
- The ground view starts at zoom 6 (min 2, max 12), centred on the site, and recentres on a camera change. Reason: Level9 overzooms acceptably to 12.

