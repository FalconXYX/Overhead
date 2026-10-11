# M7 · Weather imagery

One pull request on branch `m7-weather-imagery`. Contracts: [README.md](README.md). Evidence: [gibs.md](../verification/gibs.md), [openlayers.md](../verification/openlayers.md), [architecture.md](../verification/architecture.md). Everything marked "verified" or "measured" was run on 2026-10-11 between 09:50Z and 10:15Z, against live GIBS and with the pinned packages: ol 10.11.0, zustand 5.0.15, React 19.3.0, TypeScript 7.0.2, Biome 2.5.15, Vitest 5.0.3, Playwright 1.64.0 (headless chromium-1248). Every code block below passed `tsc` (strict, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, M0's app options) and `biome ci --error-on-warnings`, and ran in Vitest or in headless Chromium. A review between 10:30Z and 10:45Z re-ran the TypeScript blocks through `tsc` 7.0.2 and Biome 2.5.15 against the installed packages, re-ran the unit fixture values, re-fetched the live URLs and HEAD probes, and repeated the scrub sequence in headless Chromium 156.

## 1. Goal and scope

The ground map gains a semi-transparent GOES-West Band 13 Clean Infrared overlay whose `Time` follows the clock: the latest step at or before the clock (floored to 10 minutes) that GIBS lists in DescribeDomains and that a HEAD probe has confirmed. A caption reads "Imagery as of HH:MM UTC", and the timeline marks where imagery exists. Scrubbing across a 10-minute boundary swaps the tile set exactly once.

Out of scope:

- GOES-East, Himawari and EUMETSAT. GOES-West does not cover Walenstadt: its tiles there are transparent ([gibs.md claim 18](../verification/gibs.md)). There is no "outside coverage" message.
- Per-tile time fallback (a custom `tileLoadFunction`). It mixes tile sets ([architecture.md claim 32](../verification/architecture.md)).
- Animating or preloading GOES steps, and retrying a failed step within the session.
- New URL parameters, new keys or persistence. `layers.goesIr` starts `false` on every load.
- Visual design: where the caption sits and how ticks, layer and toggle look. It is settled during the build from screenshots. This doc specifies behaviour, content, states, keyboard and accessibility only.

## 2. Prerequisites

1. M1 is merged. M7 uses these M1 pieces:
   - `gibs.ts`: `gibsWmtsOptions(caps, layer, matrixSet, dropLimits)` and `GibsCapabilities`;
   - the snapshot `public/data/gibs-capabilities.xml`, which already holds the GOES layer with its `TileMatrixSetLimits`;
   - `createGroundMap`, `GroundView`, `Timeline`, `LayerToggles`, `Credits` and `src/app/credits.ts`;
   - the e2e GIBS route and the wait-for-quiet rule in `gibs-time.spec.ts`.
2. M7 is the one parallel track ([README working agreement](README.md#working-agreement)). It may land before M2–M6. If `formatUtcHhMm` (M2) or `floorToStepMs` (M3) is not in `src/domain/time` yet, add it here with the README signature. If M6 has landed, the GOES layer goes above its hillshade.
3. Network on a developer machine, once, to run the `curl` in step 1. CI never reaches GIBS.
4. Accounts: none. GIBS needs no key. Hosting and CI come from M0.
5. Decisions ([DECISIONS](../DECISIONS.md)):
   - O1: GOES imagery is ground-map data; nothing in M7 draws on the video.
   - O2: replay clips are recorded from the StarCam streams. GIBS keeps GOES imagery for a rolling 90 days, so the GOES layer matches a clip only while the clip is less than 90 days old: the 2026-10-11 clip (media 0 at 15:08:30.183Z) until about 2027-01-09. M9 checks this for the demo.
   - O3 (open): the approved shape ([README section 4](README.md#store)) holds `data.goes.status`, `intervals` and `latestStepMs`, and the actions `setGoesDomain` and `setGoesStatus`. The load status is what lets the layer show a load error (README Errors rule 5). If O3 changes: propose any rejected `data.goes` field or action in this pull request.
   - O4 does not affect M7.

## 3. Deliverables

Create:

| Path | What |
| ---- | ---- |
| `tests/fixtures/gibs/goes-domain.xml` | One live DescribeDomains response with two gaps (step 1) |
| `src/map/ground/layers/goes.ts` | GOES constants, DescribeDomains and probe URLs, `createGoesLayer` (step 4) |
| `src/map/sync/bindGoes.ts` | `bindGoesTime` (README, unchanged), `bindGoesLayer`, `bindGoesDomainPoll`, `GoesSession` (step 5) |
| `tests/unit/goes.test.ts`, `tests/unit/bindGoes.test.ts` | Section 5 |
| `tests/e2e/goes-swap.spec.ts` | Section 5 |

Change:

| Path | Change |
| ---- | ------ |
| `src/domain/time/index.ts` | GOES constants and functions (step 2) |
| `src/state/actions.ts`, `selectors.ts` | `setGoesDomain`, `setGoesStatus`, the three GOES selectors (step 3) |
| `src/map/ground/createGroundMap.ts` | GOES layer and its two bindings (step 6) |
| `src/ui/LayerToggles.tsx`, `GroundView.tsx`, `Timeline.tsx`, `Credits.tsx`; `src/app/credits.ts` | Toggle, caption, ticks, credit (step 7) |
| `tests/e2e/fixtures.ts` | HEAD and DescribeDomains routes (step 8); the wait-for-quiet helper if it is still local to `gibs-time.spec.ts` (then that spec imports it) |
| `tests/unit/time.test.ts`, `selectors.test.ts`, `actions.test.ts`, `credits.test.ts` | GOES cases (section 5) |
| `tests/unit/store.test.ts` (M0) | "every later action throws": drop `setGoesDomain` and `setGoesStatus` from the list and lower the expected count by 2 |
| `README.md` (root), `docs/DECISIONS.md` | M7 section, section 8 below |

## 4. Steps

Build in this order. Write each unit test before its code and watch it fail.

### Step 1. DescribeDomains fixture

Run once and commit:

```sh
curl -o tests/fixtures/gibs/goes-domain.xml 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/GOES-West_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/2026-10-07T12:00:00Z--2026-10-11T00:00:00Z.xml'
```

Verified (and re-fetched at 10:31Z with the same result): 200, 466 B, `<Domains>` → `<DimensionDomain>` → `<ows:Identifier>time</ows:Identifier>`, `<Domain>…</Domain>`, `<Size>3</Size>`. The `<Domain>` text must be exactly:

`2026-10-07T12:00:00Z/2026-10-07T19:20:00Z/PT10M,2026-10-07T19:40:00Z/2026-10-07T21:00:00Z/PT10M,2026-10-07T21:20:00Z/2026-10-11/PT10M`

It holds the 19:30 and 21:10 gaps of 2026-10-07 (the last gaps before the fetch) and GIBS's bare-date form of midnight (`2026-10-11`). Do not pin a hash: the `BoundingBox` attribute order changes between responses. If a later run returns a different `<Domain>`, keep the committed file. Put the command in the root README's M7 section.

### Step 2. Time functions (test first)

All in `src/domain/time/index.ts`, all in epoch ms, no `Date` objects returned. `TimeInterval` is a closed range of 10-minute steps `[firstStepMs, lastStepMs]` ([README section 6](README.md#6-domain-module-apis)).

1. Constants: `GOES_STEP_MS = 600_000` and `GOES_RETENTION_MS = 7_776_000_000` (90 days). Measured retention is about 91 days: on 2026-10-11 at 09:53Z, 2026-07-12T09:00Z returned 200 and 2026-07-11T23:40Z returned 404.
2. `floorToStepMs(timeMs, stepMs)` is `Math.floor(timeMs / stepMs) * stepMs`. Only if M3 has not added it.
3. `formatUtcHhMm(timeMs)` truncates: `new Date(timeMs).toISOString().slice(11, 16)`. Only if M2 has not added it.
4. `parseGoesDomain(domain)` behaves as follows:
   - It splits on `,`. Each item is `a/b/PT10M`, `a/b` or `a`.
   - A time is `YYYY-MM-DDThh:mm:ssZ` or a bare `YYYY-MM-DD`, which means 00:00:00Z. GIBS writes midnight as a bare date, for example `2026-10-10/2026-10-10T06:00:00Z/PT10M` (verified).
   - Parse each time with a regex and `Date.UTC`. Reject it if `isoUtcSeconds` of the result does not give back the same text (for a bare date, compare with `<date>T00:00:00Z`). This catches `2026-13-45`, which `Date.UTC` would roll over.
   - Snap each start up and each end down to the 10-minute grid. Drop an item whose start ends up after its end.
   - Sort the items, then join any two that overlap or touch.
   - `""` returns `[]`. Any other period, or a malformed time such as `03:30Z` without seconds, throws.

   Live intervals are already aligned: 0 of 222 endpoints were off the grid in the 90-day response. GIBS also snaps an unaligned query window itself (`09:47–11:03` came back as `09:50–11:00`).
5. `goesStepMs(timeMs, intervals, latestStepMs)` does this:
   1. Set `s = floorToStepMs(timeMs, GOES_STEP_MS)`.
   2. If `latestStepMs` is not null, set `s = min(s, latestStepMs)`. A null `latestStepMs` means no cap; the README leaves this open.
   3. Binary-search for the last interval whose start is ≤ `s`.
   4. Return `s` if it is ≤ that interval's end, the interval's end if it is not, or `null` if no interval qualifies.

   In a gap, this gives the last step before the gap. Before the first listed step, it gives `null`.
6. `mergeGoesIntervals(prev, next): readonly TimeInterval[]` combines a fresh poll with the stored domain:
   - Every step up to and including `next`'s last step comes from `next`. Steps of `prev` before that point are dropped, including any before `next`'s first step.
   - Steps in `prev` after `next`'s last step are kept, so the largest end ever seen survives a lagging replica. The end flapped between 04:10 and 04:30 within one second in the gibs record.
   - Touching or overlapping intervals are joined, as in `parseGoesDomain`.
   - The result is clipped to steps ≥ ceil10(newest end − `GOES_RETENTION_MS`).
   - An empty `next` returns `prev` itself.

   Clip relative to the newest listed step, not `Date.now()`. Retention then needs no clock, and the e2e fixture keeps working whatever date CI runs on.
7. `removeGoesStep(intervals, stepMs): readonly TimeInterval[]` splits the interval that lists `stepMs`. It returns the same reference when `stepMs` is not a listed step, so the store does not change.
8. `goesStepsInRange(intervals, latestStepMs, fromMs, toMs): TimeInterval[]` clips each interval to `[ceil10(fromMs), floor10(toMs)]` and to ≤ `latestStepMs` (null: no cap), and drops empty ones. These are the timeline ticks.

`goesStepMs` took about 75 ns per call over the 111 live intervals (Node), so running it on every store update is fine.

### Step 3. Store and selectors

1. `types.ts` and `initialState.ts` already hold `data.goes.status` (initially `"idle"`) and `setGoesStatus(status: LoadStatus): void` from M0 ([README section 4](README.md#store)).
2. `actions.ts`: implement `setGoesDomain(intervals, latestStepMs)`, which stores both and keeps the array reference it is given, and `setGoesStatus(status)`. Replace M0's two `notYet(..., "M7")` placeholders.
3. `selectors.ts`: add `selectGoesStepMs` exactly as the [README](README.md#selectors) gives it, plus two more. Both return primitives.
   - `selectGoesVisible(s)` is `s.layers.goesIr && s.data.goes.status === "ready" && selectGoesStepMs(s) !== null`.
   - `selectGoesLabel(s): string | null` returns the first of these that applies. Use the strings exactly; they are the e2e and screen-reader text.

| State | Text |
| ----- | ---- |
| `layers.goesIr` off | `null` (nothing rendered) |
| status `idle` or `loading` | `Loading GOES-West availability…` |
| status `error`, no intervals | `GOES-West availability failed to load` |
| status `error`, intervals present (tile guard, step 5) | `GOES-West tiles failed to load` |
| `selectGoesStepMs` is `null` | `No GOES-West imagery for this time (NASA GIBS keeps 90 days)` |
| step on the sim time's UTC date | `Imagery as of 09:50 UTC` (`formatUtcHhMm(step)`) |
| step on an earlier UTC date | `Imagery as of 2026-10-10 23:40 UTC` (`isoDateUtc(step)` first) |

### Step 4. `src/map/ground/layers/goes.ts`

The URL builders mirror what OpenLayers writes. Unit test: `goesProbeUrl(t)` equals the KVP source's `getTileUrlFunction()([0, 0, 0], 1, proj)` at the same `Time`. Both URLs were fetched live: the DescribeDomains URL returned 200 in 0.16 s with 111 intervals (about 1 KB gzipped), and the probe URL returned 200 with `layer-time-actual`.

```ts
// src/map/ground/layers/goes.ts
import TileLayer from "ol/layer/Tile";
import WMTS from "ol/source/WMTS";
import {
  floorToStepMs,
  GOES_RETENTION_MS,
  GOES_STEP_MS,
  isoUtcSeconds,
} from "../../../domain/time";
import { type GibsCapabilities, gibsWmtsOptions } from "./gibs";

export const GOES_LAYER = "GOES-West_ABI_Band13_Clean_Infrared";
export const LEVEL6 = "GoogleMapsCompatible_Level6";
export const GOES_OPACITY = 0.6;
const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

/** DescribeDomains over the retention window. The end is now floored to the minute, so each poll gets a fresh answer. */
export function goesDomainUrl(nowMs: number): string {
  const start = isoUtcSeconds(floorToStepMs(nowMs - GOES_RETENTION_MS, GOES_STEP_MS));
  const end = isoUtcSeconds(floorToStepMs(nowMs, 60_000));
  return `${GIBS_BASE}/1.0.0/${GOES_LAYER}/default/${LEVEL6}/all/${start}--${end}.xml`;
}

/** KVP GetTile URL of tile 0/0/0 at one step, with the parameters OpenLayers writes: the HEAD probe. */
export function goesProbeUrl(stepMs: number): string {
  const time = encodeURIComponent(isoUtcSeconds(stepMs));
  return `${GIBS_BASE}/wmts.cgi?layer=${GOES_LAYER}&style=default&tilematrixset=${LEVEL6}&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=0&TileCol=0&TileRow=0&Time=${time}`;
}

/** Text of the <Domain> element ("" when empty), or null when there is none. Regex: no DOMParser in Node. */
export function domainTextFromXml(xml: string): string | null {
  return /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1] ?? null;
}

/** Hidden until bindGoesLayer shows it; its Time is set by bindGoesTime before then. */
export function createGoesLayer(caps: GibsCapabilities): { layer: TileLayer<WMTS>; source: WMTS } {
  const source = new WMTS(gibsWmtsOptions(caps, GOES_LAYER, LEVEL6, true));
  const layer = new TileLayer({ source, opacity: GOES_OPACITY, visible: false });
  return { layer, source };
}
```

- `dropLimits: true` is required. Verified in Chromium at the default zoom 6 over Maunakea: limits dropped gave 12 z6 requests, including `6/28/4`, the tile that contains the site; limits kept gave 4 z5 requests only.
- The source starts on the snapshot's capabilities `Default`. That time is the snapshot's creation date, which falls outside the 90-day window a few months later. The layer must stay hidden until `bindGoesTime` has set a real step (Gotcha 2).

### Step 5. `src/map/sync/bindGoes.ts`

`bindGoesTime(store, setTime)` is the [README binding](README.md#binding-rules), unchanged: one `updateDimensions` per 10-minute step. The file adds a session object, the layer binding and the poll.

```ts
// src/map/sync/bindGoes.ts (excerpt: the constants, GoesSession and bindGoesLayer)
import type BaseLayer from "ol/layer/Base";
import { unByKey } from "ol/Observable";
import type WMTS from "ol/source/WMTS";
import { shallow } from "zustand/vanilla/shallow";
import { removeGoesStep } from "../../domain/time";
import { selectGoesVisible } from "../../state/selectors";
import type { AppStore } from "../../state/store";

export const GOES_POLL_MS = 300_000;
/** Automatic one-step fallbacks in a row; the next failure sets data.goes.status to "error". */
export const GOES_MAX_FALLBACKS = 3;

/** Steps proved missing by a tile error. Shared by bindGoesLayer and bindGoesDomainPoll; one per map. */
export interface GoesSession {
  readonly missingStepsMs: Set<number>;
}
export const createGoesSession = (): GoesSession => ({ missingStepsMs: new Set() });

/** Time, visibility and the tile-error fallback for the GOES layer. */
export function bindGoesLayer(
  store: AppStore,
  layer: BaseLayer,
  source: WMTS,
  session: GoesSession,
): () => void {
  const stepByKey = new Map<string, number>(); // source key → step, for errors that arrive after a Time change
  let failuresInARow = 0;
  const unbindTime = bindGoesTime(store, (iso) => {
    source.updateDimensions({ Time: iso });
    stepByKey.set(source.getKey(), Date.parse(iso));
  });
  const keys = [
    source.on("tileloadend", (e) => {
      if (e.tile.key === source.getKey()) failuresInARow = 0;
    }),
    source.on("tileloaderror", (e) => {
      const stepMs = stepByKey.get(e.tile.key);
      if (stepMs === undefined || session.missingStepsMs.has(stepMs)) return;
      session.missingStepsMs.add(stepMs); // never requested again this session: OpenLayers keeps ERROR tiles
      const { data, actions } = store.getState();
      if (e.tile.key === source.getKey()) {
        failuresInARow += 1;
        if (failuresInARow > GOES_MAX_FALLBACKS) actions.setGoesStatus("error");
      }
      actions.setGoesDomain(removeGoesStep(data.goes.intervals, stepMs), data.goes.latestStepMs);
    }),
  ];
  const unbindVisible = store.subscribe(selectGoesVisible, (visible) => layer.setVisible(visible), {
    equalityFn: shallow,
    fireImmediately: true,
  });
  return () => {
    unbindTime();
    unbindVisible();
    unByKey(keys);
  };
}
```

How the fallback works:

1. A tile error is proof that its step is missing.
2. The binding removes that step from the store's intervals. `selectGoesStepMs` then moves to the previous listed step, `bindGoesTime` sets that step's Time, and the caption follows. This is DECISIONS' "a 404 falls back one step". It goes through the store so the caption never names a step that is not on screen. The writes come from OpenLayers `tileloaderror` listeners, not from a store listener, so [binding rule 4](README.md#binding-rules) still holds.
3. The step stays missing for the session (Gotcha 3). Errors that arrive after the Time has moved on still drop their step, but they do not move the layer.
4. After 3 fallbacks in a row, a fourth failure sets status `error`. `selectGoesVisible` then hides the layer, a hidden layer does not render, and so nothing loops. Verified in Chromium with every tile request failing: 48 requests (4 steps), then status `error`, 0 renders in the following idle second. When the status was set back to `ready`, as the next successful poll does, the layer came back on 09:10 (a step never tried) with 12 requests and 0 idle renders.

`bindGoesDomainPoll(store, session, deps: GoesPollDeps): () => void`, with `interface GoesPollDeps { fetchFn: (url: string, init: RequestInit) => Promise<Response>; nowMs: () => number }`. The rules:

1. Subscribe to `s.layers.goesIr` with `fireImmediately`. On: start. Off, or cleanup: stop. Nothing is fetched while the layer is off.
2. Start makes a new `AbortController`, polls once now, then polls every `GOES_POLL_MS` (5 min). Stop clears the interval and aborts the in-flight request.
3. Skip a poll while the previous poll of the same start is still running. Track it by the start's `AbortSignal`, so a restart is never blocked by an aborted poll.
4. If the status is `idle`, set `loading`.
5. Send `GET goesDomainUrl(nowMs())` with `{ cache: "no-store", signal }`. A non-2xx status, a missing `<Domain>` or a parse error throws.
6. Build `draft` as `mergeGoesIntervals(store intervals, next)` with every session-missing step removed. Its last end is `newest`.
7. If `latestStepMs` is null or `newest > latestStepMs`, send `HEAD goesProbeUrl(newest)` with `{ method: "HEAD", cache: "no-store", signal }`. Otherwise `confirmed` is the stored `latestStepMs` and no HEAD is sent.
   - The step is confirmed only when the status is 200 and `res.headers.get("layer-time-actual") === isoUtcSeconds(newest)`.
   - Otherwise (404, another status, a network error) `confirmed` is `goesStepMs(newest − GOES_STEP_MS, draft, null)`: fall back one listed step, without a second probe. `latestStepMs` then stays below `newest`, so the next poll probes again.
8. If the signal was aborted, write nothing. Otherwise re-read the store, because a tile error may have dropped a step during the awaits. Then:
   - merge again from the current intervals and remove the missing steps;
   - call `setGoesDomain(merged, max(old latestStepMs, confirmed))`, where a null counts as lower than any step (both null stays null), so `latestStepMs` never decreases;
   - then call `setGoesStatus("ready")`, which also clears a tile-guard `error`.
9. On failure: `console.warn` on the first failure of this binding only. Set status `error` only if there are no intervals yet; otherwise keep showing what is known. The next poll is the only retry.

Verified with Vitest fake timers: the first poll sends a GET and then a HEAD; a second poll with an unchanged newest step sends no HEAD; turning the layer off stops all requests.

### Step 6. `createGoesLayer` in `createGroundMap`

Inside M1's step 13 branch that builds the GIBS layers (`caps` not null), after the true-colour layer (and after M6's hillshade, if present) and before the overlays, so coastlines and labels draw on top of the clouds. `layers` is the layer array given to `new OlMap`, and `disposers` is the array M1 passes to `registerMap("ground", map, disposers)`; use whatever names M1's code has:

```ts
  // M7: directly after the true-colour layer (and M6's hillshade, if present), before the overlays.
  const goes = createGoesLayer(caps);
  const session = createGoesSession();
  layers.push(goes.layer);
  disposers.push(
    bindGoesLayer(store, goes.layer, goes.source, session),
    bindGoesDomainPoll(store, session, {
      fetchFn: (url, init) => fetch(url, init),
      nowMs: () => Date.now(),
    }),
  );
```

Keep the arrow wrapper on `fetch`. `{ fetchFn: fetch }` throws `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` in Chromium 156 (re-verified). `registerMap`'s cleanup already runs every disposer and disposes every layer.

Verified with this exact wiring in a React 19 development build under `<StrictMode>` (effect mount, cleanup, mount): one DescribeDomains request and one HEAD request after the toggle went on, and no GOES tile request before it.

### Step 7. UI

Follow the [README React rules](README.md#react-rules) and [Accessibility](README.md#accessibility).

1. `LayerToggles.tsx`: add a checkbox named "GOES-West infrared (Band 13, 10 minute)" bound to `layers.goesIr` (`toggleLayer("goesIr")`).
   - It is disabled while `data.gibs` is not `ready`, like M1's toggles.
   - Its `aria-describedby` points at the caption's `id`.
2. `GroundView.tsx`: add a small child component that renders the caption. It must be readable whenever the layer is on, including while the Layers panel is closed.
   - It re-renders through `useTick4Hz()` and reads `selectGoesLabel(store.getState())` during render.
   - It renders nothing when the label is `null`, and otherwise an element with `id="goes-status"` and `data-testid="goes-asof"`.
   - No `aria-live`: at 600× the text changes every wall-clock second.
   - Do not subscribe with `useAppState(selectGoesStepMs)`: each step change would be an extra React commit outside the 4 Hz ticker ([README section 9](README.md#9-performance-budgets)).
3. `Timeline.tsx`: while `layers.goesIr` is on and status is `ready`, render one element per segment of `goesStepsInRange(intervals, latestStepMs, rangeCenterMs − SCRUB_HALF_RANGE_MS, rangeCenterMs + SCRUB_HALF_RANGE_MS)`.
   - Container: `data-testid="goes-ticks"`, `aria-hidden="true"`. The caption carries the accessible information.
   - Each segment has `data-from` and `data-to` set to `isoUtcSeconds` of its first and last step, and sits along the scrubber track at `(t − (rangeCenterMs − 12 h)) / 24 h`.
   - Read the inputs from `store.getState()` in the existing `useTick4Hz` render, and memoize on the `intervals` reference, `latestStepMs` and `rangeCenterMs`.
   - Gaps must read as gaps by position, not by colour alone.
4. Credits:
   - `credits.ts`: `dataCredits` gains the `goesIr` key ([README section 6](README.md#state-app-and-map-modules)). `GIBS_CREDIT` appears when `gibsReady` and any of `trueColor`, `coastlines` and `goesIr` is on. Add `GOES_SUBTITLE = "GOES-West/ABI"`, the GIBS layer-metadata `subtitle` (verified; the title is "Clean Infrared (10.3 µm, Band 13, 10 minute)").
   - `Credits.tsx` shows "Imagery: GOES-West/ABI, Band 13 Clean Infrared" while GIBS is ready and `goesIr` is on, after M1's true-colour line.

### Step 8. e2e fixture routes

In `tests/e2e/fixtures.ts`, extend M1's `**/gibs.earthdata.nasa.gov/**` handler. Check the cases in this order:

1. `request.method() === "HEAD"`: fulfil 200, no body, with headers `access-control-allow-origin: *`, `access-control-expose-headers: layer-time-actual`, and `layer-time-actual: <the request's Time parameter>`. This must come first: the probe carries `Request=GetTile`, so M1's tile branch would otherwise answer it without the header.
2. The pathname contains `/1.0.0/GOES-West_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/`: fulfil 200 `text/xml` with `tests/fixtures/gibs/goes-domain.xml` and `access-control-allow-origin: *`, whatever the window in the URL.
3. `Request=GetTile`: M1's stub by `Format` (GOES is `image/png`, so `tile.png`).
4. Anything else: abort and record, as in M1.

Never fulfil 404: Chromium logs every 404 as a console error, for tiles and for a HEAD `fetch` alike (verified), and the shared fixture fails on console errors.

### Step 9. Documentation

Root `README.md`: an "M7 · Weather imagery" section covering:

- what the overlay shows, and that it lags real time by about 20–60 min;
- the fixture command from step 1;
- the GIBS and GOES-West/ABI credits.

Append section 8 below to `docs/DECISIONS.md`.

## 5. Tests

Unit tests (Vitest, `environment: "node"`, no network). The `time`, `selectors`, `goes` and `bindGoes` rows below ran green in a scratch copy (22 tests, the code from steps 2–5). A review on 2026-10-11 re-ran every fixture value in those rows against a second, independent implementation of the step 2 and step 5 prose, with the step 4 and step 5 code blocks verbatim: all equal. The `actions` and `credits` rows are new cases in M1's files.

| File | What it checks | Fixture and tolerance (exact unless stated) |
| ---- | -------------- | ------------------------------------------- |
| `time.test.ts` | `parseGoesDomain` | The committed fixture → `[[2026-10-07T12:00Z, 19:20Z], [19:40Z, 21:00Z], [21:20Z, 2026-10-11T00:00Z]]`. `""` → `[]`. `2026-10-10/2026-10-10/PT10M` → one single-step interval at 00:00Z. `09:47:00Z/11:03:00Z` → `[09:50, 11:00]`. `09:41:00Z/09:49:00Z` → `[]`. A bare `2026-10-10T09:50:00Z` → `[09:50, 09:50]`. These throw: `…T03:30Z/…`, `2026-10-10/2026-10-11/P1D`, `2026-13-45T99:99:00Z/…` |
| `time.test.ts` | `goesStepMs` on the fixture with latest 2026-10-11T00:00Z | `2026-10-10T09:58:00Z` → 09:50; `09:59:59.999Z` → 09:50; `10:00:00Z` → 10:00; gap: `2026-10-07T19:35Z` and `19:39:59Z` → 19:20, `19:40Z` → 19:40, `21:10Z` → 21:00; `2026-10-07T11:59:59Z` → `null`, `12:00Z` → 12:00; `2026-10-11T09:52Z` → 2026-10-11T00:00Z, or 2026-10-10T23:40Z with that as latest; latest 19:30Z (a gap) at `2026-10-07T20:00Z` → 19:20; latest `null` at 2026-10-12 → 2026-10-11T00:00Z; `[]` → `null`. Stepping 09:58:00 → 10:02:00 in 1 s steps yields exactly `[09:50, 10:00]` |
| `time.test.ts` | `mergeGoesIntervals`, `removeGoesStep`, `goesStepsInRange`, `formatUtcHhMm` | Merge keeps the larger end (next ends 08:40, prev 09:30 → 09:30). Next refills a removed step. An empty next returns `prev` itself (`toBe`). `[2026-07-01, 2026-10-11T09:30Z]` clips to start 2026-07-13T09:30Z. Remove: a single-step interval → `[]`; an unlisted 19:30 or off-grid 19:25 → the same reference; the newest step trims the last interval to 23:50; the first step trims a start to 12:10. Ticks for ±12 h around 2026-10-07T19:35Z → `[12:00, 19:20], [19:40, 21:00], [21:20, 2026-10-08T07:30]`. `formatUtcHhMm(09:50:59.999Z)` → `09:50` |
| `selectors.test.ts` | `selectGoesLabel`, `selectGoesVisible` | On one store at 2026-10-11T00:05Z: off → `null`; on → loading text; `error` with no intervals → its text; fixture with latest 2026-10-10T23:40Z and `ready` → `Imagery as of 2026-10-10 23:40 UTC` and visible `true`. Seek to 2026-10-10T12:05:00Z → `Imagery as of 12:00 UTC`. Domain `[2026-10-10T13:00Z, 23:40Z]` → the 90-day text and visible `false`. The tile-guard row is checked in `bindGoes.test.ts` |
| `actions.test.ts` | `setGoesDomain`, `setGoesStatus` | Stores the given array by reference and `latestStepMs`; status round-trips; nothing else in `data` changes |
| `goes.test.ts` | URL builders | `goesDomainUrl(2026-10-11T09:52:31Z)` → `…/all/2026-07-13T09:50:00Z--2026-10-11T09:52:00Z.xml`. `goesProbeUrl(09:30Z)` ends `&TileMatrix=0&TileCol=0&TileRow=0&Time=2026-10-11T09%3A30%3A00Z`. `domainTextFromXml` → `""` for `<Domain></Domain>`, `null` for a page without one |
| `bindGoes.test.ts` | `bindGoesTime` on a real KVP `WMTS` built from options (M1's grid recipe, 7 levels, `dimensions: { Time: "2026-10-01T00:00:00Z" }`) | The immediate call makes 1 `change` (Time 09:50). 240 × `stepBy(1000)` from 09:58 makes exactly 1 more (Time 10:00). `getTileUrlFunction()([0, 0, 0], 1, proj)` equals `goesProbeUrl(10:00)`. After unbind, 600 steps make 0 |
| `bindGoes.test.ts` | `bindGoesLayer` with `TileSourceEvent`s on `new Tile([6, 4, 28], state)` whose `key` is set by hand | Visible only when on, `ready` and a step exists; status `error` hides. From 10:05: an error on the current key moves the label to 09:50; a repeat for 10:00 changes nothing; a `tileloadend` resets the counter; 3 more failures give 09:40, 09:30, 09:20; the 4th sets `error` and hides; missing steps are `[10:00, 09:50, 09:40, 09:30, 09:20]`. A late error with an old key drops that step without moving the layer; stepping back past it lands on the step before |
| `bindGoes.test.ts` | `bindGoesDomainPoll` with an injected `fetchFn`, `vi.useFakeTimers()`, `advanceTimersByTimeAsync` | No request while off. Turning on: `loading`, then `GET` and `HEAD`, both `no-store`, with the exact URLs; `data.goes` equals `{ status: "ready", intervals: fixture, latestStepMs: 2026-10-11T00:00Z }`. +300,000 ms: one more GET, no HEAD. Off: no more requests over 900,000 ms. HEAD 404 → latest 2026-10-10T23:50Z. A session-missing 09:50 stays removed (label 09:40). A first GET of 503 → `error`, one `console.warn` (spy) |
| `credits.test.ts` | `dataCredits` | With `gibsReady` true: exactly `[GIBS_CREDIT]` with only `goesIr` on; `[]` with all three off. `[]` with `goesIr` on and `gibsReady` false |

End-to-end tests (Playwright, the shared fixture, `vite preview`). Record every request to `gibs.earthdata.nasa.gov` and classify it:

- HEAD by method, checked first: the probe also carries `Request=GetTile`, `layer=GOES-West_ABI_Band13_Clean_Infrared` and a `Time`, so it must never be counted as a tile;
- DescribeDomains by `/all/` in the path;
- GOES tiles: GET requests with `Request=GetTile` and `layer=GOES-West_ABI_Band13_Clean_Infrared`, kept as `{ time, tile: "z/row/col" }` read from `searchParams`, which decodes `%3A`.

"Wait for quiet" is M1's rule (`gibs-time.spec.ts` step 3). Move it into `tests/e2e/fixtures.ts` if it is still local to that spec.

`tests/e2e/goes-swap.spec.ts`:

1. **"scrubbing across a 10-minute boundary swaps the GOES tile set exactly once"** (the acceptance test). It counts distinct `Time` values among the mocked GOES tile requests, per boundary crossing.
   1. `goto("/?t=2026-10-10T09:58:00Z")` and wait for quiet. Assert 0 GOES tile, 0 DescribeDomains and 0 HEAD requests.
   2. Press `L` and check "GOES-West infrared (Band 13, 10 minute)". Expect `goes-asof` to read `Imagery as of 09:50 UTC` and the Credits region to contain `Imagery: GOES-West/ABI, Band 13 Clean Infrared`, then wait for quiet.
   3. Assert:
      - exactly 1 DescribeDomains and 1 HEAD, whose `Time` is `2026-10-11T00:00:00Z`;
      - at least 4 GOES requests, every `Time` `2026-10-10T09:50:00Z`;
      - every `TileMatrix` is `6`, and the tiles include `6/28/4`.
   4. Note the count N0 and the tile set A. Scrub: `slider = getByRole("slider", { name: "Simulation time" })`, then `await slider.fill(String(v))` for `v = 1 … 240` (09:58:01 → 10:02:00). Wait for quiet.
   5. Assert:
      - `time-utc` reads `2026-10-10T10:02:00Z` and `goes-asof` reads `Imagery as of 10:00 UTC`;
      - at least 1 request after N0, and every one of them has `Time` `2026-10-10T10:00:00Z`;
      - those requests cover every tile in A.
   6. Note N1. Scrub back with `v = 239 … 0` and wait for quiet. Assert `Imagery as of 09:50 UTC`, and that no request after N1 carries `10:00`. Measured: 0 requests, because OpenLayers reuses the cached 09:50 tiles.
   7. Over the whole test:
      - the distinct GOES `Time` values are exactly `["2026-10-10T09:50:00Z", "2026-10-10T10:00:00Z"]`, so the capabilities Default never appears;
      - every `(tile, Time)` pair was requested exactly once;
      - still 1 DescribeDomains and 1 HEAD.

   Measured with this sequence in a headless-Chromium harness (real OpenLayers 10.11 and React 19, a 768 × 512 map centred on Maunakea at zoom 6, the same routes): 12 tiles at 09:50, 12 new at 10:00 covering all 12, 0 on the way back, 0 on a second forward crossing, at most 1 request per pair, 0 renders in the idle second after each crossing, 1 DescribeDomains, 1 HEAD, 0 console errors. The 240 fills took about 415 ms. The same counts held at zoom 4.
2. **"a time inside a gap shows the step before it, and the ticks show the gap"**
   1. `goto("/?t=2026-10-07T19:35:00Z")` and turn the layer on as in test 1.
   2. Expect `Imagery as of 19:20 UTC`. Wait for quiet; at least one GOES request, and every GOES `Time` is `2026-10-07T19:20:00Z`.
   3. `goes-ticks` holds exactly 3 children with `data-from`/`data-to`: `2026-10-07T12:00:00Z`–`2026-10-07T19:20:00Z`, `2026-10-07T19:40:00Z`–`2026-10-07T21:00:00Z`, `2026-10-07T21:20:00Z`–`2026-10-08T07:30:00Z`.
   4. Note the count, then `slider.fill("300")` (19:40:00). Expect `Imagery as of 19:40 UTC`. Wait for quiet; at least one new GOES request, and every new one carries `2026-10-07T19:40:00Z`.
3. **"before the listed window: the 90-day message and no GOES tiles"**: `goto("/?t=2026-10-06T12:00:00Z")` and turn the layer on. Expect `No GOES-West imagery for this time (NASA GIBS keeps 90 days)`. After quiet, assert 0 GOES tile requests, 1 DescribeDomains and 1 HEAD. The fixture starts 24 h after this time, so the ± 12 h scrubber cannot reach a listed step.

Drive the scrubber with `fill()`: the 240 fills take about 415 ms and set one value per second. M1's scrubber re-renders in its own `onChange` (M1 step 15), so ArrowRight also steps 1 s per press, but `fill()` is faster and does not depend on focus. (In an earlier prototype without that re-render, 240 presses moved the time by only 3 s.)

## 6. Acceptance criteria

1. The [definition of done](README.md#definition-of-done) holds: typecheck, lint, unit, build and e2e are green in CI, with no console errors and no third-party requests.
2. `goes-swap.spec.ts` test 1 passes. Across the 10:00 boundary:
   - exactly 2 distinct `Time` values;
   - every post-crossing request carries the new step and together they cover the pre-crossing tile set;
   - each `(tile, Time)` pair is requested once, and the back-crossing requests no `10:00` tile;
   - z6 tiles are used, including `6/28/4`.
3. `bindGoes.test.ts` shows exactly 1 `Time` change across 09:58 → 10:02 (README M7 acceptance, unit half), plus the fallback, guard and poll counts listed in section 5.
4. Tests 2 and 3 of `goes-swap.spec.ts` pass: gap fallback with the right caption and ticks, and the 90-day message with no tile requests.
5. The caption is on screen whenever the layer is on and matches the step table in step 3. The GIBS acknowledgement and "GOES-West/ABI" credit show while the layer is on.
6. With the layer off, the app makes no DescribeDomains, HEAD or GOES tile request (test 1, step 1).
7. Manual check in `npm run dev`, live mode, layer on, with DevTools Network open:
   - the caption shows the last step in the latest DescribeDomains response, or the step before it when that response's HEAD returned 404 (typically 20–60 min before now; see Gotcha 12);
   - one DescribeDomains request every 5 min;
   - a HEAD request only on a poll whose newest listed step is newer than the last confirmed step (so a probe that missed is retried on the next poll), and none otherwise.

Evidence in the pull request:

- The CI log lines with the unit and e2e test names above.
- A screenshot of `npm run dev` against live GIBS at a Hawaiian night inside the last 90 days (for example `/?t=<date>T08:00:00Z`) with the GOES layer on, showing the caption, the ticks and the credits.
- A clip of 20 s or less: scrubbing across a :x0 boundary with DevTools Network filtered by `GOES-West`, showing one burst of new `Time` requests and none on the way back.
- The Playwright trace of `goes-swap.spec.ts` (`npx playwright test goes-swap --trace on`).
- The output of the step 1 `curl` and the fixture's `<Domain>` line.

## 7. Gotchas

1. **The GOES layer needs both M1 workarounds.**
   - KVP: with REST, two thirds of tiles carry no `Time`.
   - `dropLimits`: GIBS's `TileMatrixSetLimits` stop at z5, and OpenLayers keeps only the first range per level, so z6 and everything west of the antimeridian disappear.
   - Measured here: kept limits gave 4 z5 requests at zoom 6; dropped limits gave 12 z6 requests.
   - ([gibs.md claims 2, 13, 14](../verification/gibs.md), [openlayers.md claims 1, 14](../verification/openlayers.md))
2. **Never show the layer before a step is chosen.** `optionsFromCapabilities` copies the capabilities `<Default>` into `dimensions`.
   - In the snapshot that is the time it was written. Months later it is outside the 90-day window and returns 404.
   - In a comparison run whose visibility followed the toggle alone, the layer requested 12 tiles at the Default before the domain arrived.
   - `selectGoesVisible` requires a step. ([gibs.md claim 4](../verification/gibs.md))
3. **OpenLayers never re-requests an errored tile.**
   - The renderer caches tiles by source key. An `ERROR` tile is not enqueued again. When an older key has a loaded tile, OpenLayers draws it and sets `frameState.animate`.
   - Measured with a binding that only reverts to the last good Time (an earlier draft of README Errors rule 6):
     - the caption claimed 10:00 while 09:50 was on screen;
     - returning to 10:00 made 0 requests and rendered 60 frames per second, with no new `tileloaderror`.
   - Hence: drop the failed step for the session and select through the store. ([openlayers.md claim 6](../verification/openlayers.md); `renderer/canvas/TileLayer.js` `getOrCreateTile`, `enqueueTiles`, `findStaleTile_`)
4. **Tiles flap, even for older listed steps.** At 09:53–09:54Z, probes 22 s apart showed:
   - the listed step 09:20 returned 404 at 1 to 2 of z0–z6 over Maunakea, with the failing levels changing between probes;
   - the newer 09:30 returned 200 at all 7.
   - At 10:31Z the newest listed step 10:10 returned 200 on 0/0/0, then 404 on the same tile at 10:32Z, while 6/28/4 stayed 200.

   A HEAD 200 proves little. The tile-error fallback is the real safety net. ([gibs.md claims 5, 9](../verification/gibs.md))
5. **DescribeDomains is cached for 30 minutes per URL at GIBS's origin.** It sends `cache-control: public, max-age=1800`.
   - The same URL twice gave `x-cache-detail: "cache hit"` with `age: 12` on the second request.
   - A new window end gave a miss. Flooring the end to the minute makes every 5-minute poll a fresh URL.
   - `cache: "no-store"` covers the browser cache. ([gibs.md claims 3, 19](../verification/gibs.md))
6. **DescribeDomains format quirks** (all verified):
   - The `/1.0.0/` segment is required; without it the server returns 400.
   - The identifier is lowercase `time`. Never copy it into OpenLayers, whose key is `Time`.
   - Midnight is written as a bare date.
   - Windows are snapped to steps.
   - An empty window returns `<Domain></Domain><Size>0</Size>`.
   - An unbounded query lists purged steps back to 2021, so always send a window.
   - ([gibs.md claims 4, 17, 19](../verification/gibs.md))
7. **`Time` strings.** Use `isoUtcSeconds`: `hh:mmZ` without seconds returns 400. A time inside a step snaps down (09:35 returned `layer-time-actual: …09:30:00Z`), but a time in a gap returns 404. Flooring on the client is what stops a refetch every tick. ([gibs.md claim 7](../verification/gibs.md), [architecture.md claim 32](../verification/architecture.md))
8. **Probe tile 0/0/0, not the site's tile.** Outside the Earth disk, GIBS answers 200 with a 155 B transparent PNG and no `layer-time-actual` header. Measured on Europe tile 4/5/8, which covers Walenstadt (re-checked at 10:33Z for 09:30, 10:00 and 2026-10-10T12:00). A 404 there still means that tile is missing at that time, as for the newest step 10:10 at 10:32Z. ([gibs.md claim 18](../verification/gibs.md))
9. **Every 404 is a console error in Chromium, tile or HEAD.** Measured: 12 console errors for 12 failed tiles. So e2e mocks never return 404, and the fallback is unit-tested. In production, a HEAD probe that misses also logs one error. ([gibs.md claim 9](../verification/gibs.md))
10. **Playwright-fulfilled `fetch` responses still apply `Access-Control-Expose-Headers`.** Measured (and re-verified in Chromium 156 with `context.route`): without that header, `headers.get("layer-time-actual")` returned `null`, while a missing `Access-Control-Allow-Origin` went unnoticed. The HEAD `fetch` with `cache: "no-store"` sends no preflight, so the route sees only `HEAD`. GIBS sends both headers on tiles and HEADs (verified with an `Origin` header).
11. **90 days.** Retention is about 91 days.
    - Clip relative to the newest listed step, so CI keeps passing long after the fixture date.
    - A `?t=` older than the window shows the 90-day text and requests nothing.
    - A demo clip older than 90 days shows no clouds. ([gibs.md claims 12, 17](../verification/gibs.md))
12. **Live lag.** The newest listed step was 22 min old at 09:52Z (09:30), 27 min old at 10:07Z (09:40) and 21 min old at 10:31Z (10:10). The gibs record saw the DescribeDomains end up to about 47 min behind (the capabilities document up to 61 min). Add up to 5 min of poll interval. The caption shows the imagery time; never claim the clouds are "now". ([gibs.md claims 5, 12](../verification/gibs.md))
13. **One `fetch` wrapper.** A bare `fetch` stored on an object throws "Illegal invocation" in Chromium. Unit tests inject `fetchFn`, because `tests/unit/setup.ts` replaces the global `fetch` with a throwing stub.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds M7's contract lines under "Contract changes from the implementation docs": a failed step is dropped for the session, and `data.goes.status` with `setGoesStatus` is part of the store. Append the rest.

- GOES `Time` is the latest step ≤ floor10(sim time) that DescribeDomains lists and that is ≤ the HEAD-confirmed newest step. A null newest step means no cap. Reason: DECISIONS' rule, with the null case undefined in the README.
- DescribeDomains is fetched over `[floor10(now − 90 d), now floored to the minute]`, once when the layer turns on and then every 5 min while it stays on, never while it is off. Reason: about 1 KB per poll, and each URL misses GIBS's 30-minute origin cache.
- Merged availability keeps the largest end ever seen and is clipped 90 days before the newest listed step. Reason: replicas lag and flap, and the clip should not depend on the client clock.
- The probe is HEAD on tile 0/0/0. A step is confirmed only by 200 plus `layer-time-actual` equal to the step; otherwise the newest step falls back one listed step, without a second probe. Reason: out-of-disk tiles are 200 without the header.
- After 3 automatic fallbacks in a row, the 4th failure sets `data.goes.status = "error"` and hides the layer until the next successful poll. Reason: bounds the walk-back (48 requests when everything fails).
- The GOES layer is hidden until a step exists. Reason: the source starts on the snapshot's Default.
- The GOES layer sits above true colour and hillshade and below coastlines and labels, and starts at the brief's 60 % opacity (`GOES_OPACITY`; the final value is settled from screenshots). Reason: the geography stays readable over cloud.
- The caption text follows the table in step 3, with the UTC date prefixed when the step falls on another day. Reason: gaps last up to 51 steps, so the step can be on another date.
- Timeline ticks are the listed steps inside the ± 12 h range, capped at the confirmed newest step, and `aria-hidden`; the caption is the accessible equivalent. Reason: meaning by position, not colour.
- The e2e fixture is the DescribeDomains window 2026-10-07T12:00:00Z--2026-10-11T00:00:00Z. Reason: it contains two real gaps and the bare-date form.

