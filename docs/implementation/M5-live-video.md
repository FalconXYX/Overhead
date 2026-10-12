# M5 · Live video

Branch `m5-live-video`, one pull request. Read [README](README.md) sections 2, 3 and 7 first, then section 4 "[Sky over video](README.md#sky-over-video)" and section 8 "[Recorded clips](README.md#recorded-clips)". This file uses the paths, types and names defined there and does not restate them. [`../DECISIONS.md`](../DECISIONS.md) wins over both.

Where the numbers come from (all 2026-10-11):

- The pinned packages: ol 10.11.0, zustand 5.0.15, satellite.js 7.1.0, astronomy-engine 2.1.19, TypeScript 7.0.2, Vite 8.3.4, Playwright 1.64.0 driving headless Chromium 156.0.8078.4, Node 26.11.1.
- The real YouTube IFrame API, loaded from `www.youtube.com` in that browser with a desktop user agent. Five earlier sessions measured the lifecycle, errors and timing. Sessions at 16:13–16:40Z ran the live Subaru stream (`Kj5DjRYkzD8`) under an OpenLayers 10.11.0 map with `pointer-events: none` and an `ol/Overlay` hit target, and checked clicks, `fs`, the `f` key, stage fullscreen and letterboxing.
- The recorded clip `recordings/subaru-2026-10-11-iss.mp4` and its analysis (README "Recorded clips"): the burned-in clock, a 73-star calibration and a 4,711-frame ISS track.
- Computations for this file with satellite.js 7.1.0 and astronomy-engine 2.1.19 on the committed `tests/fixtures/gp/stations.json`, using the M4 forward and inverse model (it reproduces this file's earlier wedge, 40.36°–122.04°, and Uranus pixel, (1547, 1211), exactly).
- Every code block was type-checked with tsc 7.0.2 against the README section 4–6 declarations (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `moduleResolution: "bundler"`; scripts under `tsconfig.node.json` with `@types/node` 26.6.5) and passed `biome check` with M0's rules. The helpers in step 18 were run in Node 26 on the clip data. JSON blocks were checked with `satisfies`.

## 1. Goal

A YouTube StarCam plays in the sky view with the transparent sky map drawn on top of it. The overlay is the light set of README "Sky over video" rule 1; the dense data stays on the ground map. The overlay follows the player's own media clock, offset by a stream delay the user calibrates, so it freezes when the video pauses or rebuffers. Every click and hover outside a few small hit targets reaches the player, so its controls keep working. Fullscreen takes the player and the overlay together. If the stream cannot be embedded, the view falls back to replay.

Replay plays a clip recorded from the stream (O2) as the sky view's background, with the overlay drawn on the frames and the video as the master clock. On the 2026-10-11 clip, after calibration, the ISS marker is within 1° of the ISS in every sampled frame where the ISS is in view (section 6).

Out of scope:

- Seeking the YouTube player to replay time.
- Star-pair fitting on a live player. Clicks on the video belong to the player. Pointing for a YouTube camera comes from its defaults, manual alignment against the video, or "Copy pointing" from a calibrated clip of the same camera (step 10.7).
- Reading burned-in clocks or detecting satellites inside the app. The hand procedure in "Recording a clip" does both.
- Footprint and the incoming chip (M8), terrain (M6), and how a clip reaches a deployed build (M9).
- Visual design. Layout, colours and panel placement are settled during the build from screenshots. This file specifies behaviour, content, states, keyboard and accessibility.

## 2. Prerequisites

- M4 is merged: all lens models, `unprojectPixel`, the Calibration panel, persistence, `CameraPicker`, the background layer and `bindBackground`. M3 supplies the ISS, selection, `ephemeris.ts`, the test hooks and the HoverCard overlay; M2 supplies the sky map.
- No accounts, keys or new dependencies. Hosting is M0's GitHub Pages site at `https://parthjain.ca/Overhead/` (DECISIONS H1). On 2026-10-11 `curl -sI https://parthjain.ca/` showed no COOP/COEP and no `referrer-policy` header, so embeds get a Referer ([M0 gotcha 17](M0-scaffold.md)).
- Every URL the app builds goes through `import.meta.env.BASE_URL` (`"/Overhead/"`). Measured with Vite 8.3.4 and `base: "/Overhead/"`: `npm run dev` serves the app at `http://localhost:5173/Overhead/` and `recordings/x.json` at `/Overhead/recordings/x.json` (200 `application/json`; an MP4 Range request got 206 `video/mp4`), while `/recordings/x.json` got 404. Both dev and `vite preview` answer `/?<query>` with a 302 to `/Overhead/?<query>`.
- Decisions: O1, O2 and O4 are decided (`DECISIONS.md`, "Decided by Parth"). O3 is open. M5 uses `video`, `layers.video`, `camera.status` and `camera.frameTimeMs`, plus the actions `setStreamDelayMs`, `setVideoStatus` and `setVideoLayer`, from the proposed shape. If O3 changes, propose them in this pull request.
- Tools for the hand procedures (never CI): yt-dlp 2026.08.19 through `uvx`, ffmpeg 7.1 (a static arm64 build was used), Node 26.11.1.
- The 2026-10-11 clip and sidecar in `recordings/` on the machine that runs the acceptance (section 6). They are never committed.

## 3. Deliverables

New files:

| Path | Content |
| ---- | ------- |
| `src/app/youtube.ts` | IFrame API types and loader, `parseYoutubeIdFromHtml`, `resolveYoutubeVideoId`, `mediaReferenceTimeMs`, status mappers, `mountYoutubePlayer` |
| `src/app/clip.ts` | `ClipSidecar` and the README section 6 names, `loadClipFromSidecarUrl`, `loadClip`, sidecar download |
| `src/map/sky/layers/hitTargets.ts` | `HIT_TARGET_MIN_PX`, `HitTargets`, `createHitTargets` (step 8.3) |
| `src/domain/orbits/passes.ts` | `findPasses`, `frameSpans` (step 16) |
| `src/ui/VideoPanel.tsx` | status line, fallback offers, clip picker, clip information |
| `scripts/find-passes.ts`, `scripts/record-clip.ts`, `scripts/check-clip-pass.ts` | steps 16–18 |
| `scripts/fixtures/make-test-clip.ts` | writes the e2e test-pattern clip |
| `tests/fixtures/youtube/iframe_api.js`, `astroasahi.html` | stub IFrame API and resolver page |
| `tests/fixtures/video/test-pattern.webm`, `test-pattern.sidecar.json` | generated clip (24 kB) and its `ClipSidecar` |
| `tests/fixtures/video/subaru-2026-10-11-iss-track.json` | the measured ISS track on the 2026-10-11 clip (step 14.6) |
| `tests/fixtures/hls/dvr-playlist.m3u8` | trimmed real DVR playlist (step 14.7) |
| `tests/unit/youtube.test.ts`, `clip.test.ts`, `passes.test.ts`, `recordClip.test.ts`, `findPasses.test.ts`, `checkClipPass.test.ts` | section 5 |
| `tests/e2e/video.spec.ts` | section 5 |

Changed files:

| Path | Change |
| ---- | ------ |
| `src/domain/time/index.ts` | `youtubeLiveTimeMs`, `localVideoTimeMs`, the delay and clip helpers |
| `src/domain/orbits/index.ts` | re-export `Pass`, `findPasses`, `FrameSpan`, `frameSpans` |
| `src/domain/camera/fit.ts`, `index.ts` | `satelliteCheckSummary` |
| `src/state/actions.ts` | `setStreamDelayMs`, `setVideoStatus`, `setVideoLayer`; `setActiveCamera` also resets `video` |
| `src/state/selectors.ts` | `selectStreamDelayMs`, `selectLiveLocked`, `selectSkyOverVideo`, `selectSkyLayerVisible`, `selectSkyDenseLabels` and the M5 branch of `selectStarMagLimit`, exactly as in the [README](README.md#selectors) |
| `src/state/clockLoop.ts` | `setMediaClock`, `getMediaClock`; YouTube and local-video branches |
| `src/map/sky/createSkyMap.ts` | `setPassThrough`; hit targets; light-set label and trail gates (step 8) |
| `src/map/sky/layers/*.ts`, `src/map/sync/bindLayers.ts` | every sky layer binds through `bindSkyLayerVisible` |
| `src/map/sky/layers/background.ts` | `createVideoSource`, `onVideoFrames` |
| `src/map/sync/bindBackground.ts` | local-video branch |
| `src/map/sync/bindSkyCamera.ts` | `setPanZoom` also for `local-video`; `setPassThrough(kind === "youtube")` |
| `src/app/cameras.ts` | four ids in `ENABLED_CAMERA_IDS`; validation of `youtube` and `local-video` sources |
| `public/data/cameras.json` | `subaru-starcam` defaults settled and both StarCams' `termsNote` edited in place; `local-replay` and `subaru-2026-10-11-iss` inserted after `cfht-starcam` (step 2) |
| `src/main.tsx` | an initial `local-video` camera starts in replay |
| `src/app/keyboard.ts` | `[` and `]` cycle only the rates the Timeline offers |
| `src/app/App.tsx` | video-id resolution state (step 12.3), `VideoPanel` in its own `ErrorBoundary` |
| `src/ui/SkyView.tsx` | the sky stage: player wrapper, map target, Fullscreen button and guard (step 8) |
| `src/ui/CalibrationPanel.tsx` | stream-delay section, satellite check, copy pointing; pairs off for YouTube |
| `src/ui/LayerToggles.tsx` | the "On the video" group |
| `src/ui/Timeline.tsx`, `CameraPicker.tsx`, `Credits.tsx` | step 12 |
| `tests/e2e/fixtures.ts` | YouTube, astroasahi and recordings routes |
| `tests/unit/time.test.ts`, `clockLoop.test.ts`, `actions.test.ts`, `selectors.test.ts`, `bindLayers.test.ts`, `cameras.test.ts`, `fit.test.ts` | section 5 |
| `tests/unit/store.test.ts` (M0) | "every later action throws": drop `setStreamDelayMs`, `setVideoStatus` and `setVideoLayer`, leaving 8 |
| `docs/DECISIONS.md`, `README.md` | section 8; the M5 section |

## 4. Steps

Build in this order. For every formula, write the failing test from section 5 first.

### Step 1. Time helpers (`src/domain/time`)

Units: wall-clock and UTC times in epoch ms, media times in seconds.

1. Contract functions:
   - `youtubeLiveTimeMs(anchorWallMs, anchorMediaSec, mediaSec, streamDelayMs) = anchorWallMs + (mediaSec − anchorMediaSec) × 1000 − streamDelayMs`.
   - `localVideoTimeMs(startUtcMs, mediaTimeSec) = startUtcMs + mediaTimeSec × 1000`.
2. Helpers ([README section 6](README.md#6-module-apis)):
   - `STREAM_DELAY_MAX_MS` = 120,000 and `STREAM_DELAY_FINE_MS` = 10,000.
   - `clampStreamDelayMs(ms)` rounds to whole ms and clamps to [0, 120,000].
   - `youtubeStallMs(anchorWallMs, anchorMediaSec, nowMs, mediaSec) = (nowMs − anchorWallMs) − (mediaSec − anchorMediaSec) × 1000`. Pauses and stalls add to it; a skip forward subtracts.
   - `streamDelayForFrameMs(anchorWallMs, anchorMediaSec, mediaSec, frameUtcMs)` = the delay that makes `youtubeLiveTimeMs` equal `frameUtcMs` for the frame shown at `mediaSec`.
   - `clipStartUtcMs(frameUtcMs, mediaSec) = frameUtcMs − mediaSec × 1000`.
3. Meaning of the delay. `streamDelayMs` is the latency at the anchor: the first PLAYING with a finite `getCurrentTime()` > 0 after a video id loads. The overlay then follows the media clock, so later pauses and rebuffers need no new delay. "Behind real time now" is `streamDelayMs + youtubeStallMs(...)`.
4. Edge cases: media time before the anchor (a DVR rewind in the player) gives earlier times, which is correct; the stall is negative after a skip forward.

### Step 2. Registry entries and validation

M1 committed `subaru-starcam` and `cfht-starcam` (provisional, not enabled), and `parseCameraRegistry` rejects duplicate ids. So:

1. Edit those two entries in place to the values below. Two things change: `subaru-starcam.defaults`, settled from the star fit on the 2026-10-11 clip (M1's provisional-fields table names "night-frame calibration" as its source), and both `termsNote` values.
2. Insert `local-replay`, then `subaru-2026-10-11-iss`, right after `cfht-starcam` (picker order).
3. Add `"subaru-starcam"`, `"cfht-starcam"`, `"local-replay"` and `"subaru-2026-10-11-iss"` to `ENABLED_CAMERA_IDS` in `src/app/cameras.ts` ([M1 step 5](M1-ground-map.md)).

The final state of the four entries, checked with `satisfies CameraConfig[]` under tsc 7.0.2:

```json
[
  {
    "id": "subaru-starcam",
    "name": "Subaru-Asahi StarCam (east, live)",
    "kind": "youtube",
    "source": { "youtubeVideoId": "Kj5DjRYkzD8", "resolverUrl": "https://astroasahi.github.io/maunakea_east/" },
    "site": { "latDeg": 19.82552, "lonDeg": -155.47587, "heightM": 4148, "mastM": 13, "geoidSepM": 24.32, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 3840, "heightPx": 2160 },
    "lens": "rectilinear",
    "defaults": { "azDeg": 81.2322, "altDeg": 19.6185, "rollDeg": 0.7698, "focalPx": 2525.93, "cxPx": 1920, "cyPx": 1080, "k1": -0.00992, "k2": 0, "flipX": false, "streamDelayMs": 50000, "rmsDeg": 0.0415, "updatedAtMs": 0 },
    "credit": { "text": "NAOJ & Asahi Shimbun", "href": "https://www.youtube.com/channel/UCiN7OwV8g8dMm_E0xphBVig", "licence": null, "licenceHref": null },
    "termsNote": "Non-commercial use only"
  },
  {
    "id": "cfht-starcam",
    "name": "CFHT-Asahi StarCam (west, live)",
    "kind": "youtube",
    "source": { "youtubeVideoId": "Q3UhCgsWDw8", "resolverUrl": "https://astroasahi.github.io/maunakea_west/" },
    "site": { "latDeg": 19.8253, "lonDeg": -155.4689, "heightM": 4204, "mastM": 0, "geoidSepM": 24.23, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 3840, "heightPx": 2160 },
    "lens": "rectilinear",
    "defaults": { "azDeg": 270, "altDeg": 20, "rollDeg": 0, "focalPx": 2742, "cxPx": 1920, "cyPx": 1080, "k1": 0, "k2": 0, "flipX": false, "streamDelayMs": 50000, "rmsDeg": null, "updatedAtMs": 0 },
    "credit": { "text": "CFHT & Asahi Shimbun in collaboration with Subaru Telescope, NAOJ", "href": "https://www.cfht.hawaii.edu/en/gallery/starcam.php", "licence": null, "licenceHref": null },
    "termsNote": "Non-commercial use only"
  },
  {
    "id": "local-replay",
    "name": "Local clip (replay)",
    "kind": "local-video",
    "source": { "sidecarUrl": null, "sourceCameraId": null, "videoUrl": null, "startUtcMs": null },
    "site": { "latDeg": 19.82552, "lonDeg": -155.47587, "heightM": 4148, "mastM": 13, "geoidSepM": 24.32, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 3840, "heightPx": 2160 },
    "lens": "rectilinear",
    "defaults": { "azDeg": 81.2322, "altDeg": 19.6185, "rollDeg": 0.7698, "focalPx": 2525.93, "cxPx": 1920, "cyPx": 1080, "k1": -0.00992, "k2": 0, "flipX": false, "streamDelayMs": 0, "rmsDeg": 0.0415, "updatedAtMs": 0 },
    "credit": { "text": "Local clip: credit comes from its sidecar", "href": null, "licence": null, "licenceHref": null },
    "termsNote": "Played from this device only; never uploaded"
  },
  {
    "id": "subaru-2026-10-11-iss",
    "name": "Subaru StarCam: ISS pass, 2026-10-11 (recorded)",
    "kind": "local-video",
    "source": { "sidecarUrl": "recordings/subaru-2026-10-11-iss.json", "sourceCameraId": "subaru-starcam", "videoUrl": null, "startUtcMs": null },
    "site": { "latDeg": 19.82552, "lonDeg": -155.47587, "heightM": 4148, "mastM": 13, "geoidSepM": 24.32, "timeZone": "Pacific/Honolulu" },
    "imageSize": { "widthPx": 3840, "heightPx": 2160 },
    "lens": "rectilinear",
    "defaults": { "azDeg": 81.2322, "altDeg": 19.6185, "rollDeg": 0.7698, "focalPx": 2525.93, "cxPx": 1920, "cyPx": 1080, "k1": -0.00992, "k2": 0, "flipX": false, "streamDelayMs": 0, "rmsDeg": 0.0415, "updatedAtMs": 0 },
    "credit": { "text": "NAOJ & Asahi Shimbun", "href": "https://www.youtube.com/watch?v=Kj5DjRYkzD8", "licence": null, "licenceHref": null },
    "termsNote": "Non-commercial use only"
  }
]
```

Where the values come from:

- **`subaru-starcam` defaults.** The star fit on the 2026-10-11 clip: 73 BSC stars at media 56, 241 and 461 s, 207 pairs, rms 0.915 px per pair at 1920 width (0.0415°; 0.65 px, 0.0294° per axis), max 3.0 px. Az 81.2322 ± 0.002°, alt 19.6185 ± 0.002°, roll 0.7698 ± 0.005°, f 1262.96 ± 0.25 px at 1920 (2525.93 at 3840), k1 −0.00992 ± 0.0005. The three epochs agree to 0.004° in az, 0.002° in alt and 1 px in f, so the camera did not move during the clip. HFOV is 74.48°, not the nominal 70.0°.
  - The old defaults (az 81.2°, alt 19.6°, roll 0, f 2742, k1 0) missed the same stars by rms 51.7 px and max 89.7 px (1920 width), and put the ISS marker up to 3.0° off.
  - `distortionValid` holds: g′ = 0.977 at `rMaxUnit` 0.87885.
  - Fixtures that name "the Subaru defaults" (M8, README section 8) keep az 81.2°, alt 19.6°, f 2742 as their inline inputs. Only code that reads `cameras.json` sees the new values.
- **`cfht-starcam`.** The page says only "This camera faces west". The site is CFHT's. Every `defaults` field and `mastM` is a guess (M6 sets `mastM` 33). Align it by eye against the video on a clear night and record the values in `DECISIONS.md`.
- **`local-replay`.** A placeholder: `loadClip` replaces it at runtime (step 10.5). Its site and defaults are the Subaru StarCam's, with `streamDelayMs` 0.
- **`subaru-2026-10-11-iss`.** README "Camera registry". `loadClipFromSidecarUrl` replaces it at runtime through `clipCamera` (step 10.4). The files are not in the repository, so the entry loads only where `recordings/` is served (`npm run dev`).
- The video ids are the last known ones. `maunakea_east` still returned `youtu.be/Kj5DjRYkzD8` at 16:13Z.

`parseCameraRegistry` (M1) already checks the `youtubeVideoId` pattern `/^[A-Za-z0-9_-]{11}$/` (the real API throws "Invalid video id" otherwise). M5 adds these checks, each with a message naming the field:

- `youtube`: `resolverUrl` is null or an `https:` URL.
- `local-video`:
  - `sidecarUrl` is null, or a relative path (no scheme, no leading `/`) ending in `.json`;
  - `sourceCameraId` is null or the id of a `youtube` or `still-image` entry in the same file;
  - `videoUrl` and `startUtcMs` are null in the file (they are set at runtime);
  - `defaults.streamDelayMs` is 0.

### Step 3. Store actions and selectors

Implement the M5 rows of the [actions table](README.md#actions):

1. `setStreamDelayMs(ms)` ignores non-finite input and is a no-op unless the active camera is `youtube`. Otherwise it calls `updateCalibration({ streamDelayMs: clampStreamDelayMs(ms) })`.
2. `setVideoStatus(status, errorCode = null)` writes `video`.
3. `setVideoLayer(key, on)` writes a new `layers.video` object, and does nothing when the value is unchanged.
4. `setActiveCamera` also resets `video` to `{ status: "idle", errorCode: null }`.
5. Add the M5 selectors to `src/state/selectors.ts` exactly as in the [README](README.md#selectors): `selectStreamDelayMs`, `selectLiveLocked`, `selectSkyOverVideo`, `selectSkyLayerVisible`, `selectSkyDenseLabels`, and the `VIDEO_STAR_MAG_LIMIT` branch of `selectStarMagLimit`.

### Step 4. Video id and IFrame API (`src/app/youtube.ts`)

1. `resolveYoutubeVideoId(resolverUrl, fallbackId, fetchFn = fetch, timeoutMs = 5000, cache: RequestCache = "default")` never throws.
   - It fetches with `{ cache, signal: AbortSignal.timeout(timeoutMs) }`.
   - It returns `{ id, source: "resolver" }`, or `{ id: fallbackId, source: "fallback", reason }` when `resolverUrl` is null, the response is not OK, the page holds no id, or the fetch throws or times out.
   - The re-resolve after an error (step 5.8) passes `"no-cache"`, because the pages send `cache-control: max-age=600`.
2. The resolver pages are meta refreshes with `access-control-allow-origin: *`. They used two forms on 2026-10-11: `maunakea_east` → `youtu.be/Kj5DjRYkzD8`, `maunakea_west` → `youtu.be/Q3UhCgsWDw8`, `alma` → `youtube.com/live/BVKRAzTSnB0`, `kiso` → `youtu.be/_HZDjlfTuvQ`.
3. `videoStatusForYtState(state)`: −1 → `loading`, 0 → `ended`, 1 → `playing`, 2 and 5 → `paused`, 3 → `buffering`. `videoStatusForYtError(code)`: 101, 150, 153 → `embed-blocked`; anything else → `error`.
4. The loader, the parser and the undocumented-method probe:

```ts
// src/app/youtube.ts: the parts of the YouTube IFrame Player API the app uses.

/** Only the documented methods the app calls. */
export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  getCurrentTime(): number; // seconds; extrapolated by the widget while playing
  getPlayerState(): number; // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  setSize(widthPx: number, heightPx: number): void;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
export interface YtEvent {
  target: YtPlayer;
  data: number;
}
export interface YtPlayerOptions {
  videoId: string;
  width: number;
  height: number;
  playerVars?: { autoplay?: 0 | 1; playsinline?: 0 | 1; rel?: 0 | 1; fs?: 0 | 1 };
  events?: {
    onReady?: (event: { target: YtPlayer }) => void;
    onStateChange?: (event: YtEvent) => void;
    onError?: (event: YtEvent) => void;
    onAutoplayBlocked?: (event: { target: YtPlayer }) => void;
  };
}
export interface YtNamespace {
  Player: new (host: HTMLElement, options: YtPlayerOptions) => YtPlayer;
}
declare global {
  interface Window {
    YT?: Partial<YtNamespace>;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
let apiPromise: Promise<YtNamespace> | null = null;

/** Loads the IFrame API script once per page; every caller shares one promise. */
export function loadYoutubeIframeApi(): Promise<YtNamespace> {
  if (apiPromise !== null) return apiPromise;
  apiPromise = new Promise<YtNamespace>((resolve, reject) => {
    const tryResolve = (): boolean => {
      const Player = window.YT?.Player;
      if (typeof Player !== "function") return false;
      resolve({ Player });
      return true;
    };
    if (tryResolve()) return;
    const previous = window.onYouTubeIframeAPIReady; // the API calls this one global when it is ready
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (!tryResolve()) reject(new Error("YT.Player missing after onYouTubeIframeAPIReady"));
    };
    const script = document.createElement("script");
    script.src = YT_IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // the next activation of a YouTube camera may try again; no retry loop
      reject(new Error("YouTube IFrame API failed to load"));
    };
    document.head.append(script);
  });
  return apiPromise;
}

const ID = "([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])";
const ID_FORMS: readonly RegExp[] = [
  new RegExp(`youtu\\.be/${ID}`),
  new RegExp(`youtube\\.com/live/${ID}`),
  new RegExp(`youtube\\.com/watch\\?(?:[^"'\\s#]*&)?v=${ID}`),
];

/** The video id in a resolver page's meta refresh: youtu.be/ID, youtube.com/live/ID or watch?v=ID. Null if none. */
export function parseYoutubeIdFromHtml(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/http-equiv\s*=\s*["']?refresh\b/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    if (content === undefined) continue;
    for (const re of ID_FORMS) {
      const id = re.exec(content)?.[1];
      if (id !== undefined) return id;
    }
  }
  return null;
}

/** Undocumented, feature-detected: UTC ms of the frame on screen, or null. Never the only way to set the delay. */
export function mediaReferenceTimeMs(player: YtPlayer): number | null {
  const fn: unknown = Reflect.get(player, "getMediaReferenceTime");
  if (typeof fn !== "function") return null;
  const sec: unknown = fn.call(player);
  return typeof sec === "number" && Number.isFinite(sec) && sec > 1e9 ? sec * 1000 : null;
}
```

   With the stub, two calls returned the same `YT.Player`. With the real API, `onReady` fired after 0.3–0.4 s, PLAYING after 0.7–0.8 s, and `getMediaReferenceTime` existed as a function.

### Step 5. Player lifecycle (`mountYoutubePlayer`)

`mountYoutubePlayer(wrapper, camera, videoId, store, onRestart)` returns `{ destroy(): void }`. `wrapper` is the stage's player wrapper (`data-testid="video-player"`, step 8.1).

- `App.tsx` resolves the id (step 12.3). `SkyView` calls `mountYoutubePlayer` from an effect on the wrapper ref, keyed by camera id and resolved video id, while the active camera is `youtube` and `video.status` is neither `embed-blocked` nor `error`. The effect cleanup calls `destroy`. The player's effect is separate from the map's ([README "Map lifecycle"](README.md#map-lifecycle) rule 5).
- `onRestart(newId)` (step 5.8) hands App a new id, which re-runs the effect.
- React 19 StrictMode mounts, cleans up and mounts again; afterwards exactly one player is alive.

1. **Host element.** Create it imperatively: `const host = document.createElement("div"); wrapper.replaceChildren(host)`. `new YT.Player(host, …)` replaces `host` with its iframe, and `destroy()` puts `host` back (seen in the real API and in its `www-widgetapi.js`). Never pass a React-owned element.
2. **Construct** with `{ videoId, width, height, playerVars: { autoplay: 0, playsinline: 1, rel: 0, fs: 0 }, events }`, where `width` and `height` are the wrapper's size rounded to whole CSS px.
   - The API adds `enablejsapi=1`, `origin=<page origin>` and `widgetid` itself, and sets `referrerpolicy="strict-origin-when-cross-origin"`, `frameborder="0"` and `title="YouTube video player"` on the iframe. The real embed URL read `autoplay=0&playsinline=1&rel=0&fs=0&enablejsapi=1&origin=…`.
   - `fs: 0` removes the player's fullscreen button. With `fs: 1` the real player showed an "Enter full screen" button; with `fs: 0` it had none. YouTube's own fullscreen would show the video without the overlay; step 8.5 covers the `f` key, which `fs: 0` does not disable.
   - Keep the default controls: users pause, scrub the DVR and unmute with them through the overlay (step 8.2).
   - Do not pass `mute` as a player parameter; call `player.mute()` (step 5.4).
3. **Size.** A `ResizeObserver` on the wrapper calls `player.setSize(round(w), round(h))` on every change; the real API then set the iframe's `width` and `height` attributes. Without it, in a 1440 × 900 fullscreen stage, the iframe stayed at its old 960 × 540 while the map filled the screen.
4. **onReady:** call `player.mute()`, then check the autoplay gate.
5. **Autoplay gate.** Playback starts only once the stage is more than half visible, so a scrolled-away page does not start the stream.
   - Observe the wrapper with an `IntersectionObserver` with thresholds `[0, 0.25, 0.5, 0.51, 0.75, 1]`. Keep the latest `intersectionRatio`.
   - Call `playVideo()` once per player, when `onReady` has fired and the ratio is above 0.5. Never call it again automatically, so a user's pause sticks.
   - Measured with the stub: at 33 % and 44 % visible nothing played; after a scroll to 61 % `playVideo` ran once, muted, with 61.1 % of the iframe visible. Scrolling away and back did not call it again.
   - `onAutoplayBlocked` → `setVideoStatus("paused")`.
6. **onStateChange** → `setVideoStatus(videoStatusForYtState(data))`.
   - On PLAYING: `setCameraStatus(id, "live")`. If there is no anchor yet and `t = player.getCurrentTime()` is a finite number above 0, set the anchor `{ wallMs: Date.now(), mediaSec: t }`.
   - In the three sessions that played, the real player reported `getCurrentTime()` 0 during the early UNSTARTED and BUFFERING events, then a value such as 4,419,786.46 at PLAYING. In the first session one early event returned null.
   - On ENDED, re-resolve once (a live stream ends when it restarts), as for error 150 below.
7. **Media clock.** Register `setMediaClock({ kind: "youtube", mediaSec, anchor, mediaReferenceTimeMs })` (step 6), where `mediaSec()` returns `getCurrentTime()` only when it is a finite number, else null.
8. **onError:**

   | `data` | First time in this activation | Otherwise |
   | ------ | ----------------------------- | --------- |
   | 100, 101, 150 | Re-resolve with `cache: "no-cache"`. A different id → `onRestart(newId)` (a new player and a new anchor; VideoPanel shows the restart message). The same id → as in the next column. | `setVideoStatus("embed-blocked", data)` (100: `"error"`), `setCameraStatus(id, "offline")`, `setMode("replay")` |
   | 153 | `console.warn` that embeds need a Referer, then as in the next column | `embed-blocked`, `offline`, `setMode("replay")` |
   | 2, 5 | `setVideoStatus("error", data)`, `offline`, `setMode("replay")`; VideoPanel offers Retry | same |

   Error 150 is not only "embedding disabled". The ended stream `qh6Nqiq6LIg` and the nonexistent id `AAAAAAAAAAA` both raised 150, 0.3 s after `onReady`. Hence the re-resolve. Once the status is `embed-blocked` or `error`, SkyView's effect cleanup destroys the player and the stage keeps the sky map in the camera's framing ([README "Sky over video"](README.md#sky-over-video) rule 9).
9. **destroy():** disconnect both observers; `setMediaClock(null)` only if `getMediaClock()` is still this player's clock (another camera may have registered its own); `player.destroy()`; `wrapper.replaceChildren()`.

### Step 6. Clock loop (`src/state/clockLoop.ts`)

Add `setMediaClock(clock: MediaClock | null)` and `getMediaClock()` (types in [README section 6](README.md#state-app-and-map-modules)). One media clock exists at a time. `setMediaClock` also clears the loop's memory of the last sim time it wrote. After each frame the loop remembers `clock.simTimeMs` as it stands then. Per frame, before M0's replay branch:

1. **Live, active camera `youtube`:**
   - With no YouTube media clock, or no anchor yet: sim time = `Date.now() − selectStreamDelayMs(state)`.
   - With an anchor: if `mediaSec()` is null, do not tick this frame. Otherwise sim time = `youtubeLiveTimeMs(anchor.wallMs, anchor.mediaSec, mediaSec, selectStreamDelayMs(state))`.
   - Keep M1's rule: when `|Date.now() − rangeCenterMs| > SCRUB_HALF_RANGE_MS`, call `jumpToNow()` instead.
   - Rate stays 1. Play/pause, scrub, step and rate changes already switch to replay (M0 and M1 actions).
2. **Active camera `local-video` with a local media clock** (always replay):
   - If the loop has a remembered value and `clock.simTimeMs` differs from it, the user seeked, stepped, scrubbed or recentred. Call `seekToSec((simTimeMs − startUtcMs) / 1000)` once and keep `simTimeMs`.
   - Otherwise, including the first frame after `setMediaClock` (nothing remembered), the video wins: sim time = `localVideoTimeMs(startUtcMs, mediaSec())`.
   - Never call `advanceReplayMs` while a clip is registered.
3. **Active camera `local-video` with no local media clock** (no clip yet, or before `loadeddata`): no tick.
4. Every other case is unchanged (M0, M1, M4).

`requestVideoFrameCallback` callbacks ran before the `requestAnimationFrame` callbacks of the same frame (19 of 19 frames, DPR 1 and 2). The loop therefore reads the media time of the frame that `renderSyncAll()` draws.

### Step 7. `VideoPanel.tsx`

A region with `aria-label` "Video: <camera name>". It renders nothing for `synthetic` and `still-image` cameras. The player itself is not here; it sits in the sky stage (step 8).

For `youtube` cameras: a status line in a `role="status"` element with `data-testid="video-status"` and a `data-status` attribute holding `video.status`. The line changes on state changes only, never at 4 Hz. Wording may change; meaning may not:

| Condition | Message and controls |
| --------- | -------------------- |
| App is resolving the id | "Finding the current stream…" |
| resolved from the fallback (shown with the line below) | "Using the last known video id (<reason>)." |
| `idle` or `loading` | "Loading the player. It starts when more than half of it is visible." |
| `paused` | "Paused. Press play on the video; the sky waits for it." |
| `playing` | "Live. The sky follows the video, about N s behind real time." N = (delay + stall) / 1000, rounded, computed when the status or the delay changes. It is not re-rendered at 4 Hz: the extrapolated `getCurrentTime()` jitters, and a rounding flip would make the live region speak. |
| `buffering` | "Buffering. The sky waits for the video." |
| `playing` after a `buffering` of ≥ 1 s | "The video rebuffered for N s. Check the delay on the next satellite." plus Dismiss. VideoPanel measures it with `store.subscribe` on `video.status` (listeners run synchronously inside `setVideoStatus`): note `Date.now()` on entering `buffering` after the first `playing`, and compare on the next `playing`. |
| App restarted the player with a new id | "The stream restarted with a new id. Check the delay." |
| `ended` | "The stream ended. Looking for its new id…" |
| `embed-blocked` | "This stream cannot be played here (YouTube error <code>)." Then: a "Watch on YouTube" link to `https://www.youtube.com/watch?v=<id>` (`target="_blank"`, `rel="noopener noreferrer"`); one button "Replay the recorded clip: <clip camera name>" per enabled `local-video` camera whose `source.sourceCameraId` is this camera, in reverse `cameras.json` order, each calling `setActiveCamera(clipId)` as the picker does (step 12.2); and a "Replay a local clip" button that selects `local-replay` |
| `error` | "The player reported error <code>." plus Retry (App re-resolves with `"no-cache"` and remounts) |
| Sun above 0° at the site | "Daytime at the camera." Test `sunGeometricAltDeg(astroTimeAt(Date.now()), makeObserver(site)) > 0` (M4's wall-clock rule for stills) at most once per 60 s, from the `useTick4Hz` render. |
| replay mode | "Replay: the sky does not follow the video. Press Live to follow it." No time in this line: it would change at 4 Hz while replay plays. |

The camera's `credit` and `termsNote` show in the Credits region (M1) at all times.

For `local-video` cameras: the clip states in the same `data-testid="video-status"` element (its `data-status` is `video.status` here too; step 18 and the clip e2e tests wait on it), the picker (only for `local-replay`) and the clip information (step 10).

### Step 8. The sky stage: the overlay on the player

This step implements [README "Sky over video"](README.md#sky-over-video). Every measured behaviour below was run against the real player on 2026-10-11 unless it names a stand-in.

1. **Stage** (rule 4). `SkyView.tsx` renders one stage element (`data-testid="sky-stage"`) holding the sky map target (`data-testid="sky-map"`), the same element for every camera kind. For a `youtube` camera the stage has the aspect W:H and also holds the player wrapper (`data-testid="video-player"`). Both children fill the stage, and the map target is drawn above the wrapper. The map is transparent: no controls, no attribution, no background.
2. **Pass-through** (rule 5). `SkyMapHandle.setPassThrough(on)`:
   - On: set `pointer-events: none` on the map target element itself (not `.ol-viewport`); detach the map's `click`, `singleclick` and `pointermove` picking handlers; set `pointer-events: none` on the HoverCard overlay's container (`hoverElement.parentElement`, the `div` that `ol/Overlay` wraps around `SkyMapHandle.hoverElement`); call `hitTargets.setEnabled(true)`.
   - Off: undo each of these.
   - Why the HoverCard rule: OpenLayers sets `pointer-events: auto` on every overlay's container (`ol/Overlay.js` line 169). Checked with a `srcdoc` iframe standing in for the player: a 200 × 100 card over it took the click, and with its container set to `none` the click reached the iframe.
   - Measured on the real player: a click on an empty point of the overlay hit the iframe (`elementFromPoint` returned IFRAME) and paused the stream (state 2); a second click resumed it (state 1).
3. **Hit targets** (rule 6, `src/map/sky/layers/hitTargets.ts`):

```ts
// src/map/sky/layers/hitTargets.ts — public API (declaration form). [M5]
import type OlMap from "ol/Map";
import type { CameraModel } from "../../../domain/camera";
import type { AppStore } from "../../../state/store";

/** Smallest hit target edge, CSS px (README section 7, Accessibility rule 6). */
export const HIT_TARGET_MIN_PX: 24;
/** DOM hit targets over a YouTube player: one reusable ol/Overlay <button> per drawn, pickable object. */
export interface HitTargets {
  /** setPassThrough calls it: on creates and moves targets each frame; off parks every target. */
  setEnabled(on: boolean): void;
  /** Called by SkyMapHandle.setCameraModel; targets are placed with this model. */
  setCameraModel(model: CameraModel): void;
  /** Frame updater, registered after the sky layers' updaters so it reads this frame's positions. */
  update(simTimeMs: number): void;
}
export function createHitTargets(map: OlMap, store: AppStore): HitTargets;
```

   - Targets: exactly the objects the sky layers drew this frame among the ISS and the other stations and visual satellites (the `satellites` layer), the stars (V ≤ 2 over a video), the Sun, the Moon, the planets and the selected object. Use the same projected positions and visibility predicates the layers and `pick` use. Starlink gets none.
   - Each target is a `<button type="button">`, at least `HIT_TARGET_MIN_PX` × `HIT_TARGET_MIN_PX` CSS px, centred on the object, with the object's name as `aria-label` and `tabIndex` −1. It is placed with `new Overlay({ element, stopEvent: false, positioning: "center-center" })`.
   - `pointerenter` calls `hover(id)`; `pointerleave` calls `hover(null)` if the hover is still that id; `click` calls `select(id)`.
   - Overlays are created as needed, reused, and parked with `setPosition(undefined)`. None is created per frame. The selected object's target is placed last, so it wins overlaps.
   - Measured: a click on a 24 × 24 target over the real player fired its handler, and the player state stayed 1 (playing).
4. **Content box** (rule 8). The player letterboxes the video inside its iframe whenever the stage's aspect differs from 16:9, and the map's fitted view letterboxes the frame the same way.
   - The player follows the stage through step 5.3. The map follows through its own `ResizeObserver` and `fitSkyFrame` on `change:size`, as in M2.
   - Measured in a 1440 × 900 fullscreen stage: after `setSize(1440, 900)` the real player drew the video in rows 45–854, a centred 1440 × 810 box. That is the box `view.fit([0, 0, W, H], { size })` gives (README rule 8).
   - A view built with `extent: [0, 0, W, H]` and `constrainOnlyCenter: false` fits by cover instead: 1600 × 900, cropping 80 px on each side. M2's fixed view has no extent, and M4's pan-and-zoom view uses `constrainOnlyCenter: true`. Keep it that way.
5. **Fullscreen** (rule 7).
   - A "Fullscreen" button outside the stage, shown for `youtube` and `local-video` cameras, calls `stage.requestFullscreen()`. Player and overlay go fullscreen together, the stage fills the screen, and the browser's Esc exits.
   - The player's own fullscreen. `fs: 0` removes the button, but with the player focused the `f` key still made the iframe fullscreen (`document.fullscreenElement` was the iframe) with `fs: 0` and with `fs: 1`. The double-click on the video did not enter fullscreen in headless Chromium with either value.
   - The guard: SkyView listens for `fullscreenchange` on `document`. When `document.fullscreenElement` is inside the stage but is not the stage, it calls `document.exitFullscreen()`, and a polite status line says "Use this Fullscreen button to keep the sky on the video."
     - Measured: the guard left the iframe's fullscreen 16–17 ms after it began, with `fs: 0` and with `fs: 1`, on the live Subaru stream (the sessions above, and again at 19:05Z).
     - Switching to the stage inside the handler failed with "Permissions check failed": the handler has no user activation.
     - Do not pass `disablekb: 1`. It does stop `f`, but it also removes the player's other keys.
6. **Accessibility.** `SkyView`'s `aria-label` reads "Computed sky drawn over the live video from <camera name>" for `youtube` and "Computed sky drawn over the clip from <camera name>" for `local-video` (M4 words the still-image case; M2's locator `/Computed sky/` still matches). The text alternative (M2, M3) is unchanged and is the keyboard route to every object.
7. **`bindSkyCamera`** calls `setPanZoom(kind === "still-image" || kind === "local-video")` and `setPassThrough(kind === "youtube")` (README "Map lifecycle" rule 5). YouTube cameras keep M2's fixed, full-frame view with no interactions.
8. **The light set** (rules 1–3), while `selectSkyOverVideo` is true:
   - Every sky layer binds its visibility through `bindSkyLayerVisible`, never `bindLayerVisible`. That gates Starlink and the grid by `layers.video`.
   - The stars layer takes its count from `selectStarMagLimit` (V ≤ 2; V ≤ 4 while the Calibration panel is open). Star labels are drawn only when `selectSkyDenseLabels` is true. Stars are named on hover through the HoverCard.
   - Satellites: the ISS, the selected and the hovered objects keep their labelled `Point` features (M3). Any other satellite label M3 draws needs `selectSkyDenseLabels`.
   - Sun, Moon and planets keep their labels.
   - Trails: only the selected object's 30 s trail and its next 2-minute path (README section 5, "Sky paths"); `layers.trails` still gates them.
   - The Layers panel shows an "On the video" group while `selectSkyOverVideo` is true: checkboxes "Starlink on the video", "Grid on the video" and "All labels on the video", each calling `setVideoLayer`, unchecked by default. The Starlink one says it also needs the Starlink layer, which loads the data.
9. **Wedge.** The ground-map wedge (M4 `frameAzimuthCoverage(model, 16)`) shows 37.48°–125.17° (87.70° wide) for the settled `subaru-starcam` defaults and 228.98°–311.02° for `cfht-starcam`. The old Subaru defaults gave 40.36°–122.04°.

### Step 9. Stream delay in the Calibration panel

For `youtube` cameras the panel gains a "Stream delay" section. Star pairs are off, with the text "Star pairs need a still image or a clip. Align by eye against the video, or calibrate a recorded clip of this camera and copy its pointing here (step 10.7)." M4's manual pointing controls stay. With the overlay on the video, alignment by eye compares the drawn stars with the stars in the picture directly.

1. **Coarse:** a range input "Stream delay, seconds", 0–120, step 1. It calls `setStreamDelayMs(value × 1000)`.
2. **Fine:** a range input "Fine adjust, seconds", −10 to +10, step 0.1. On `pointerdown` or `focus` it captures the current delay as its centre. Each change calls `setStreamDelayMs(centre + value × 1000)`. On release or blur it returns to 0 and re-centres.
3. **Exact:** a number input labelled "Stream delay (exact), seconds", step 0.1.
4. **Readouts**, re-rendered by `useTick4Hz` from `getMediaClock()` and kept outside the panel's `aria-live` region:
   - "Delay at start of playback: 50.0 s";
   - "Behind real time now: 60.0 s (10.0 s of pauses and buffering)";
   - "Sky time: 21:59:10 HST" in `site.timeZone`. On the Subaru video, compare it with the burned-in clock at the lower right.
5. **Enter the video's clock:**
   - Pause the player with its own controls (they work through the overlay). That keeps live mode; the overlay freezes with the video.
   - The input is `<input type="datetime-local" step="1">`, prefilled with the sky time in `site.timeZone`. Its value drops the seconds when they are `:00` (`2026-10-10T21:59`); `localDateTimeToUtcMs` (M4) accepts both forms.
   - Apply: `frameUtcMs = localDateTimeToUtcMs(value, site.timeZone) + 500` (the middle of the burned-in second), then `streamDelayForFrameMs(anchor.wallMs, anchor.mediaSec, mediaSec(), frameUtcMs)`.
   - A null from `localDateTimeToUtcMs` shows "Enter a valid date and time" and changes nothing. A delay outside [0, 120,000] ms shows "That gives a delay of X s; check the time" and changes nothing. Otherwise it calls `setStreamDelayMs`.
   - The control is disabled before the anchor exists.
   - The burned-in clock has failed NTP sync by more than 10 s in the past (`verification/sources.md` claim 10), so confirm on a satellite. On 2026-10-11 it was right to within 0.3 s (README "Recorded clips").
6. **Suggestion**, only when `mediaReferenceTimeMs()` is non-null: "The player suggests 20.9 s (undocumented API)" plus Apply. The value is `streamDelayForFrameMs(anchor.wallMs, anchor.mediaSec, mediaSec(), mrtMs)`, rounded to 0.1 s, which equals `(now − mrt) − stall`. Never apply it automatically ([DECISIONS](../DECISIONS.md) "Live clock").
7. **Satellite step**, as text: "Wait for a bright satellite or the ISS. Drag the delay until its marker sits on the dot in the video." The ISS crossed the Subaru frame at up to 0.53°/s, so 1 s of delay error is up to about 0.5° there.
8. **Accessibility:** labels carry units; `aria-valuetext` reads "50.0 seconds"; results go to the panel's `aria-live="polite"` region. The global key handler ignores these inputs, so arrow keys stay native.

### Step 10. Clip sidecar and loading (`src/app/clip.ts`)

`ClipSidecar`, `ClipTiming`, `ClipPass`, `parseClipSidecar`, `clipVideoUrl` and `clipCamera` are declared in [README section 6](README.md#state-app-and-map-modules). M5 adds `loadClipFromSidecarUrl(store, cameraId, fetchFn = fetch)` and `loadClip(files, store)`.

1. **`parseClipSidecar(json, registry, nowMs)`** lists every problem, one message per field, and ignores keys the contract does not list. The on-disk sidecar also carries `format`, `version`, `startUtc`, `recordedWith` and more. The messages:
   - not a plain object → exactly `["sidecar must be a JSON object"]`;
   - `cameraId` not a `youtube` or `still-image` camera in the registry → "cameraId must name a youtube or still-image camera in cameras.json";
   - `videoFile` empty, or containing `/` or `\` → `videoFile must be a file name with no / or \` (one backslash at the end);
   - `startUtcMs` not finite → "startUtcMs must be a finite number"; before 2000-01-01T00:00:00Z or after `nowMs` + 86,400,000 → "startUtcMs is out of range";
   - `startUncertaintyS` not finite or negative → "startUncertaintyS must be a finite number ≥ 0";
   - `timingSource` not an object with a known `method` and a string `detail` → "timingSource needs a known method and a detail string";
   - `durationS` not in (0, 43,200] → "durationS must be > 0 and ≤ 43200";
   - `width` or `height` not a positive integer → "width and height must be positive integers"; otherwise, with a valid camera, width:height more than 0.5 % from the camera's W:H → "width:height differs from the camera's W:H by more than 0.5 %";
   - `fps` not finite and > 0 → "fps must be a finite number > 0";
   - `sourceVideoId` neither null nor `/^[A-Za-z0-9_-]{11}$/` → "sourceVideoId must be null or an 11-character YouTube id";
   - `credit` without non-empty `text`, or with `href`, `licence` or `licenceHref` not a string or null → "credit needs non-empty text, and href, licence and licenceHref as strings or null";
   - `calibration` present but not a full `Calibration` (12 typed fields) that passes `distortionValid` for the camera's lens → "calibration must be a full Calibration for the camera's lens";
   - `pass` present without a positive integer `noradId` and finite in-frame media times with 0 ≤ from ≤ to ≤ `durationS` → "pass needs a positive integer noradId and in-frame media times within the clip".

   A prototype of exactly these rules accepted the on-disk `recordings/subaru-2026-10-11-iss.json` (with its extra keys) and the e2e sidecar. It gave the 11 messages in section 5 for the broken object.
2. **`clipVideoUrl(sidecarAbsUrl, sidecar)`** = `new URL(sidecar.videoFile, sidecarAbsUrl).href`.
3. **`clipCamera(entry, sidecar, videoUrl, registry)`** does what README section 6 says.
   - The result keeps the entry's id, name and `sidecarUrl`, and fills in `sourceCameraId`, `videoUrl` and `startUtcMs`.
   - It takes `site`, `lens`, `imageSize` and `termsNote` from `registry[sidecar.cameraId]`, and the credit from the sidecar.
   - `defaults` is `{ ...(sidecar.calibration ?? source.defaults), streamDelayMs: 0 }`.
   - It returns null when `sidecar.cameraId` is not in the registry, or differs from a non-null `entry.source.sourceCameraId`.
4. **`loadClipFromSidecarUrl(store, cameraId, fetchFn = fetch)`**. VideoPanel runs it from an effect keyed by camera id when the active camera is `local-video` with a `sidecarUrl` and a null `videoUrl`. An `AbortController` per activation drops the result if the camera changed meanwhile.
   1. `setVideoStatus("loading")`; status line "Loading the clip…".
   2. `abs = new URL(entry.source.sidecarUrl, new URL(import.meta.env.BASE_URL, location.href)).href`, which is `…/Overhead/recordings/<clip>.json`; fetch it with `{ cache: "no-cache" }`.
   3. A response that is not OK, whose `content-type` does not contain `json`, or whose text does not parse as JSON means "This clip is not part of this build.": `setVideoStatus("error")`, `setCameraStatus(cameraId, "offline")`, and the "Replay a local clip" button.
      - `vite preview` answers a missing `/Overhead/recordings/…` file with `index.html` (200, `text/html`), and so does `npm run dev`. No request fails, so no console error is logged; this is the e2e case.
      - A GitHub Pages build that does not hold the file answers 404 (`https://parthjain.ca/Overhead/recordings/subaru-2026-10-11-iss.json` did on 2026-10-11). The result is the same message, and the browser logs the failed load. M9 step 14 ships the clip with the deploy, so production holds it from M9 on.
   4. `parseClipSidecar(json, registry, Date.now())`. Errors → `setVideoStatus("error")` and "The sidecar has problems:" followed by the list.
   5. `camera = clipCamera(entry, sidecar, clipVideoUrl(abs, sidecar), registry)`. Null → "The sidecar's cameraId (<id>) does not match this clip camera."
   6. Probe the video (step 10.6).
   7. Then, in order:
      - `setRegistry({ ...registry, [cameraId]: camera })`.
      - If the store has no `camera.calibration[cameraId]` (none persisted for this clip camera): `importCalibration(cameraId, { ...(sidecar.calibration ?? the source camera's current calibration), streamDelayMs: 0 })` (README actions table).
      - `setRate(1)` if `clock.rate` is 60 or 600 (a video cannot go faster than 16×).
      - `recenter(sidecar.startUtcMs)`, except on the first activation of a page loaded with `?t=`. Then keep the URL time: the clock loop seeks the clip to it, and a time outside the clip clamps to its ends.
      - `setVideoStatus("paused")`.
5. **`loadClip(files, store)`** for `local-replay`.
   - The VideoPanel file input is `<input type="file" accept="video/*,.json,application/json" multiple>`, and the clip and its sidecar arrive in one `change` event. Both arrived with their types: `video/webm` and `application/json`, and a picked `.json` next to the 2026-10-11 MP4 also arrived as `application/json`.
   - Anything other than exactly one video file and one `.json` → "Pick the clip and its .json sidecar together (scripts/record-clip.ts writes the sidecar)."
   - Parse the JSON as in 10.4.4.
   - If `sidecar.videoFile` differs from the picked file's name, add the note "The sidecar names <videoFile>; playing <name>." This does not block loading.
   - `videoUrl = URL.createObjectURL(file)`; `clipCamera(registry["local-replay"], …)`; probe (10.6); then 10.4.7. Revoke the previous clip's object URL.
6. **Probe.** Load the clip in a temporary muted `<video preload="metadata">`.
   - A `MediaError` means "This browser cannot play the file. Remux it to MP4: ffmpeg -i <file> -map 0:v -c copy -movflags +faststart <name>.mp4".
     - Chromium 156 answered `canPlayType` "probably" for VP8, VP9 and AV1 WebM, for H.264 and AV1 MP4, and for `video/mp4; codecs="avc1.640028"` (the 2026-10-11 clip). It answered "" for HEVC MP4 and for `video/mp2t`.
     - A `.ts` source failed with MediaError 4.
   - Reject a non-finite duration or one over 43,200 s.
   - Reject the clip when its aspect differs from W:H by more than 0.5 %. If only the size differs, say "The clip is w × h; it is drawn at W × H". The 2026-10-11 clip is 1920 × 1080 on a 3840 × 2160 camera, so it takes this branch, and the canvas function scales it (step 11).
   - If the duration differs from `durationS` by more than one frame (1/`fps` s), or the natural size from `width` × `height`, add a note; this does not block loading.
7. **"Copy pointing to <source camera name>"**, shown when the clip camera's `sourceCameraId` is set: `importCalibration(sourceCameraId, { ...clipCalibration, streamDelayMs: <that camera's current delay> })`. Only the geometry moves; the YouTube camera keeps its delay. This is how a star calibration made on a clip reaches the live camera.
8. **"Save sidecar"** downloads `<videoFile without extension>.json` through a `Blob`, `URL.createObjectURL` and a clicked `<a download>`. The file is the loaded sidecar object, every key kept, with `calibration` replaced by the clip camera's current calibration (`streamDelayMs` 0). Save it over `recordings/<clip>.json` to keep a calibration made in the app.
9. **Clip information**, re-rendered by `useTick4Hz`: file name, duration (m:ss.s), natural size, start and end in UTC and `site.timeZone`, `timingSource.method` and `startUncertaintyS` ("start ± 0.3 s from the burned-in clock"), status, credit and licence.
10. **Reloads.** Object URLs do not survive a reload, so `?cam=local-replay` shows the picker again. A clip camera with a `sidecarUrl` reloads from its URL.

### Step 11. Local video background

1. M4 already types the background layer, and the `layer` parameters of `startStillImageRefresh` and `bindBackground`, as `ImageLayer<ImageSource>`. That type accepts both an `ImageStatic` and an `ImageCanvas` source, and `setSource(null)`. (`ImageLayer<ImageStatic>` would reject an `ImageCanvas` source with TS2739, and passing an `ImageLayer<ImageSource>` to a parameter typed `ImageLayer<ImageStatic>` fails with TS2345.)
2. Add:

```ts
import type Projection from "ol/proj/Projection";
import ImageCanvasSource from "ol/source/ImageCanvas";

/** local-video background: draws the frame on screen into the camera's pixel extent [0, 0, W, H]. */
export function createVideoSource(
  video: HTMLVideoElement,
  widthPx: number,
  heightPx: number,
  projection: Projection,
): ImageCanvasSource {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable");
  return new ImageCanvasSource({
    projection,
    ratio: 1, // the default 1.5 builds a canvas 1.5 × the viewport on every frame
    canvasFunction(extent, resolution, pixelRatio, size) {
      const [minX = 0, , , maxY = 0] = extent; // Extent is number[]: each element is number | undefined
      const [w = 0, h = 0] = size; // canvas pixels (already × pixelRatio)
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const s = pixelRatio / resolution; // canvas pixels per image pixel
        ctx.drawImage(video, -minX * s, (maxY - heightPx) * s, widthPx * s, heightPx * s);
      }
      return canvas;
    },
  });
}

/** Calls onFrame(mediaTimeSec) for every presented frame until the returned stop() runs. */
export function onVideoFrames(
  video: HTMLVideoElement,
  onFrame: (mediaTimeSec: number) => void,
): () => void {
  let handle = 0;
  let stopped = false;
  const step = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata): void => {
    if (stopped) return;
    onFrame(metadata.mediaTime);
    handle = video.requestVideoFrameCallback(step); // one callback per frame: re-register every time
  };
  handle = video.requestVideoFrameCallback(step);
  return () => {
    stopped = true;
    video.cancelVideoFrameCallback(handle);
  };
}
```

   Measured in Chromium 156 with the test clip:
   - The canvas function ran once on the first render, not on plain re-renders, and exactly once per `changed()` + `renderSync()` (15 calls for 15 frames).
   - At 28 sampled points over 5 zooms and centres, at DPR 1 and 2, every quadrant colour was within 2 per channel.
   - The 320 × 180 clip drawn into a 3840 × 2160 extent fitted to a 640 × 400 container put each quadrant centre where the container geometry predicts.

   Measured with the 2026-10-11 MP4 (over http with byte ranges, `file://` and an object URL alike):
   - duration 480, 1920 × 1080;
   - `requestVideoFrameCallback` `mediaTime` stepped by exactly 0.0333 per frame while playing;
   - seeks landed on the right frame, as pixel comparison of the clock digits with ffmpeg's frames confirmed: `currentTime` 0.81 → `mediaTime` 0.8 (frame 24), 0.84 → 0.833333 (frame 25), 150.84 → 150.833333, 479.95 → 479.933333;
   - a `file://` page taints the canvas (`getImageData` throws `SecurityError`); an object URL does not.
3. `bindBackground` gets a local-video branch. It runs when the active camera is `local-video` with a non-null `videoUrl`:
   1. Create a detached `<video>` with `muted`, `playsInline`, `preload = "auto"` and `src = videoUrl`. Detached, `display: none` and visible elements all delivered 24–25 frame callbacks per second for the 25 fps clip.
   2. On `loadeddata`: `layer.setSource(createVideoSource(video, W, H, projection))` with the sky map's current pixel projection, as M4 does for stills.
   3. Start `onVideoFrames(video, (t) => { lastMediaSec = t; source.changed(); })`. On `seeked`, also call `source.changed()`. Set `lastMediaSec = video.currentTime` on `loadeddata`, `seeked` and `play`, so the first frame after a seek or a play never reads the old position.
   4. Register a `LocalMediaClock`:
      - `startUtcMs` from the camera's source;
      - `mediaSec()` = `video.currentTime` when `video.paused || video.seeking`, else `lastMediaSec`;
      - `seekToSec(s)` sets `currentTime` to `s` clamped to [0, `duration`]. `currentTime` reads the new value as soon as it is assigned, with `seeking` true.
   5. Store to video, through one subscription to `[clock.playing, clock.rate]`:
      - `playing` → `video.play()`. On rejection call `pause()` and `setVideoStatus("paused")`.
      - Not playing → `video.pause()`.
      - Rate → `video.playbackRate = rate` inside `try/catch`. Chromium accepts 0.0625–16 and throws `NotSupportedError` for 0.05, 16.01, 17, 60 and 600 (`verification/architecture.md` claim 5, re-measured).
   6. Video to store:
      - `play` → `setVideoStatus("playing")` and `setFrameTimeMs(null)`.
      - `pause` → `"paused"` and `setFrameTimeMs(localVideoTimeMs(startUtcMs, video.currentTime))`.
      - `seeked` while paused → the same `setFrameTimeMs`, and clear the star pairs, which belong to one frame (M4).
      - `waiting` → `"buffering"`.
      - `ended` → `pause()` and `"ended"`. At the end `paused` and `ended` were true and `currentTime` equalled the duration; a later `play()` restarts from 0.
      - `error` → `"error"` plus the step 10.6 message.
   7. Opening the Calibration panel calls `pause()`: the frame is frozen while calibrating, as for stills.
   8. Cleanup, on a camera change or a new clip, in this order: stop the frame callbacks; `setMediaClock(null)` only if `getMediaClock()` is still this clip's clock; `video.pause()`; `video.removeAttribute("src")`; `video.load()`; `layer.setSource(null)`.
4. The sky view treats `local-video` as an image camera (M4 step 11.1, through `setPanZoom(true)`): pan, zoom, `minResolution` 0.125 and the extent limit with `constrainOnlyCenter: true`. Map clicks pick objects and add star pairs; there is no player to pass events to.

### Step 12. Timeline, picker, keyboard and app

1. **Timeline:**
   - When `selectLiveLocked` is true, the mode readout has the description "Follows the video" (`aria-describedby`). `data-testid="time-mode"` itself still reads exactly "Live" or "Replay" (M1).
   - For a `local-video` camera the Live button has `aria-disabled="true"` and the description "A clip has no live mode".
   - While a clip is loaded the rate group offers only 1× and 10×. `keyboard.ts` cycles `[` and `]` over the same list.
2. **CameraPicker:**
   - YouTube and clip statuses come from `camera.status`, with M4's labels "Live", "Offline" and "Not checked" (`unknown`).
   - Only the active YouTube camera is resolved and embedded.
   - Selecting a `youtube` camera calls `jumpToNow()`, then `setMode("live")`. The exception is the first activation of a page loaded with `?t=`: it stays in replay.
   - Selecting a `local-video` camera (`local-replay` or a clip camera) calls `setMode("replay")` and `pause()`, plus `setRate(1)` if `clock.rate` is 60 or 600.
   - `main.tsx`: when the initial camera (`?cam=`) is `local-video`, call `setMode("replay")` instead of M1's `setMode("live")`.
3. **App.tsx:**
   - It owns the video-id resolution. While the active camera is `youtube`, an effect keyed by camera id runs `resolveYoutubeVideoId(source.resolverUrl, source.youtubeVideoId)` and keeps `{ cameraId, videoId, source, reason, restarted }` in state.
     - `onRestart(newId)` sets `videoId` and `restarted: true`.
     - Retry re-resolves with `"no-cache"` after `setVideoStatus("idle")`.
     - A camera change clears the state.
   - App passes `videoId` and `onRestart` to `SkyView`, and the resolution facts to `VideoPanel` as props. App re-renders only when this state changes.
   - It mounts `VideoPanel` inside its own `ErrorBoundary` (pane "Video").
4. **Credits:** while a clip camera is active, the Credits region shows the sidecar's credit, its licence link and the camera's `termsNote`.

### Step 13. Satellite check

In the Calibration panel, for image cameras (`local-video`, `still-image`), add a "Satellite check" section. It measures a satellite marker against the picture by hand, and its export is a track for step 18 on clips that have no measured track.

1. A toggle "Clicks add: star pairs | satellite check". It is enabled only while paused and while a satellite is selected: click its marker before switching the toggle, choose it in M3's "Satellites above the horizon" list, or open the page with `&sel=sat:25544`.
2. Each click records `{ timeMs: simTimeMs, uPx, vPx, residualDeg }`.
   - `residualDeg` = `angularSeparationDeg` between the click's az/alt from `unprojectPixel(model, uPx, vPx, out, 0)` and the selected satellite's apparent az/alt for this frame: `ephemeris.frame.azAltDeg` at `2 × indexOfObjectId(selectedId)` (M3), the values its marker is projected from.
   - A click that does not unproject is not recorded; say so.
3. Samples live in component state, not the store. They are cleared on a camera change or a new clip.
4. The table lists time, residual in degrees and in pixels, and Remove. Under it, the summary from `satelliteCheckSummary(samples, 1.0, hiddenMs)`, for example "12 samples, largest gap 2.0 s, max 0.85°, median 0.58°: pass".
   - `hiddenMs` comes from the clip's sidecar: when `pass.noradId` is the selected satellite and `pass.visibleMediaS` is present, the stretches between consecutive visible intervals, as `[startUtcMs + a × 1000, startUtcMs + b × 1000]`. Otherwise it is `[]`.
   - On the 2026-10-11 clip that gives media 228–238 s, 241.5–256 s and 258.4–260.8 s, where the domes hide the ISS. Without them, clicks every 2 s across the visible stretches leave a 16 s gap and fail; with them the largest uncovered gap is 2 s (a prototype of the README rule on those clicks: 94 samples, pass).
5. "Export check" downloads `overhead-satcheck-<cameraId>-<YYYYMMDDTHHMMSSZ>.json` with the clip name, the sidecar, the calibration, the satellite's element epoch, the samples and the summary.
6. Advance with the Timeline's "Forward 1 second" button, not with →: while the Calibration panel is open the arrow keys nudge the pointing ([README Keyboard](README.md#keyboard)).

### Step 14. Fixtures and e2e routes

1. `tests/fixtures/youtube/astroasahi.html`: the real page's markup (`<!DOCTYPE html>`, `<meta http-equiv="refresh" content="0; url=https://youtu.be/Fixture0001">`, title "Redirecting..."). `Fixture0001` is a valid 11-character id that is not a real stream, so a test can tell the resolver from the fallback.
2. `tests/fixtures/youtube/iframe_api.js`, a hand-written stub that mirrors the real widget:
   - **`YT.Player(host, options)`:**
     - It throws "Invalid video id" unless the id matches `/^[A-Za-z0-9_-]{11}$/`.
     - It replaces `host` with an `<iframe>` with `srcdoc` (so no request), `frameborder="0"`, `allowfullscreen`, and the given width and height. `destroy()` puts `host` back.
     - It pushes `options` to `window.__ytStub.options`.
   - **Methods:** `playVideo`, `pauseVideo`, `mute`, `getCurrentTime`, `getPlayerState`, `setSize` (sets the iframe's `width` and `height` attributes), `getIframe`, `destroy`.
   - **Events:** `onReady` after a 0 ms timeout, then state −1. `playVideo` emits 3 then 1, or `onAutoplayBlocked` when blocked.
   - **Inside its iframe:** on the iframe's `load`, it adds a `click` listener to `iframe.contentWindow` that pushes `[clientX, clientY]` to `window.__ytStub.clicks`. It also adds a `keydown` listener that calls `document.documentElement.requestFullscreen()` on `f`, as the real player does.
     - Checked in headless Chromium 156: a click on an empty point of a `pointer-events: none` OpenLayers target recorded one click at the expected iframe coordinates; a click on an `ol/Overlay` button recorded none; and `f` made the iframe fullscreen until the page's guard exited it.
   - **`getCurrentTime()`:** the stub media time plus `(Date.now()/1000 − last update) × 1`, capped at 1 s, only while playing. This is the real widget's rule.
   - **`getMediaReferenceTime`:** present only while `window.__ytStub.mediaReferenceSec` is a number.
   - **Hooks on `window.__ytStub`:**
     - `players`, `live()` and `options`;
     - `calls`: `{ fn }` entries; `playVideo` adds `visibleFraction` (the share of its iframe inside the viewport) and `muted`; `setSize` adds `w` and `h`;
     - `clicks`;
     - `mediaSec` (starts at 4,399,105.5), `setMedia(sec)`, `emitState(code)`, `emitError(code)`, `mediaReferenceSec`, `autoplayBlocked`.
   - Then it calls `window.onYouTubeIframeAPIReady` after a 0 ms timeout.
3. Routes inside M1's `routes` auto fixture in `tests/e2e/fixtures.ts` ([README section 8](README.md#end-to-end-tests)):
   - `**/www.youtube.com/**`: path `/iframe_api` → the stub (`text/javascript`); anything else on that host is aborted and recorded.
   - `**/astroasahi.github.io/**`: any path → `astroasahi.html`, status 200, `text/html`, `access-control-allow-origin: *`.
   - same-origin `**/recordings/**`: `subaru-2026-10-11-iss.json` → `tests/fixtures/video/test-pattern.sidecar.json`, and `test-pattern.webm` → `tests/fixtures/video/test-pattern.webm`, both with `route.fulfill({ path })`.
     - Checked in Chromium 156: the JSON arrived as `application/json`, and an unrouted path from an index-serving server arrived as `text/html`.
     - The routed WebM loaded and played with no console error, but it cannot seek: `route.fulfill` ignores `Range` (the request carried `bytes=0-`) and answers 200 with the whole file, and headless Chromium 156 then reported `seekable` [0, 0] and left a seek to 5 s at 0 (re-measured on 2026-10-11 with a 7 s VP9 WebM). No M5 test seeks a routed clip: tests 10 and 20 only load it, and test 18, which seeks, runs on picked files, whose object URL seeks. M9 step 14d adds the Blob path that makes a routed clip seekable; `npm run dev` and GitHub Pages answer ranges with 206.
   - A spec overrides any of these with `page.route`, which runs before the shared `context.route` (M4).
   - Never answer 404 or abort in a passing test. A fetch answered 404 and an aborted fetch each logged "Failed to load resource" as a console error. A 200 page with no id tests the resolver fallback cleanly, and a 200 `text/html` answer tests "not part of this build".
4. The test clip comes from `scripts/fixtures/make-test-clip.ts`, run by hand with `npx tsx scripts/fixtures/make-test-clip.ts` and committed:
   - It launches headless Chromium with `browser.newContext({ viewport: { width: 320, height: 180 }, recordVideo: { dir, size: { width: 320, height: 180 } } })`.
   - The page is one 320 × 180 canvas redrawn every frame: top-left quadrant `#ff0000`, top-right `#00ff00`, bottom-left `#0000ff`, bottom-right `#ffffff`, plus an 8 px black square moving along the bottom edge at 80 px/s.
   - It waits 6 s, then `context.close()`, which flushes the file, and moves the one `.webm` in `dir` to `tests/fixtures/video/test-pattern.webm`.
   - A prototype of exactly this script wrote 24,357 bytes: VP9, 25 fps, 320 × 180, duration 7.00 s, seekable to 7.00 s.
   - Tests use only the quadrant colours and the duration shown in the clip information, so a re-run changes no test.
5. `tests/fixtures/video/test-pattern.sidecar.json` is the README's e2e sidecar ("Recorded clips"): `subaru-starcam`, `videoFile` `test-pattern.webm`, `startUtcMs` 1791705600000 (2026-10-11T08:00:00.000Z), 320 × 180 at 25 fps, 7 s, credit "Test pattern generated for the Overhead e2e tests", licence `CC0-1.0`. It passes `parseClipSidecar`.
6. `tests/fixtures/video/subaru-2026-10-11-iss-track.json`, the measured ISS track that step 18 compares against.
   - It holds 94 samples, one per even media second across the four visible stretches. Where the even second's frame had no clean detection, it uses the next second (221 for 220, 265 for 264) or the previous one (257 for 258).
   - The samples come from the clip analysis's per-frame tracker, at `frame = 30 × mediaS`. The +0.5 converts a pixel index to the continuous convention.
   - The "clean" filter kept detections with flux ≥ 300 and 8 < x < 1,912. Every kept sample is within 5.2 px (1080p) of the star-calibrated prediction shifted by the fitted 0.879 s. The largest, 5.1 px, is at 80 s, where the ISS is entering at the right edge. At that offset the full 4,711-frame track had rms 0.95 px and max 5.27 px.
   - It type-checks as `satisfies ClipTrack` (step 18):

```json
{
  "clip": "subaru-2026-10-11-iss.json",
  "noradId": 25544,
  "widthPx": 1920,
  "heightPx": 1080,
  "method": "ISS centroid per frame (brightest 3x3 sum, then the background-subtracted centroid within 5 px), measured on 2026-10-11; whole media seconds, continuous pixel coordinates",
  "samples": [
    [80, 1905.4, 144.9], [82, 1867.7, 159.3], [84, 1833.4, 172.5], [86, 1800.1, 185], [88, 1765.9, 198.3], [90, 1735.3, 210.4],
    [92, 1704, 222], [94, 1673.7, 234.7], [96, 1646.4, 244.7], [98, 1618.5, 255.6], [100, 1591.5, 265.9], [102, 1564.6, 276.8],
    [104, 1539.5, 287], [106, 1513.9, 297.4], [108, 1490.3, 307.7], [110, 1467, 316.5], [112, 1443.5, 326.2], [114, 1420.1, 335.4],
    [116, 1399.1, 344.3], [118, 1377.4, 352.8], [120, 1356, 362.1], [122, 1336.3, 370.3], [124, 1315.7, 379], [126, 1295.9, 386.7],
    [128, 1277.3, 395.4], [130, 1257.8, 403.2], [132, 1239.4, 411.3], [134, 1222.4, 418.5], [136, 1205.1, 425.7], [138, 1187.4, 433.8],
    [140, 1170.4, 441.4], [142, 1153.9, 448.3], [144, 1137.6, 455.2], [146, 1121.6, 462.5], [148, 1106.3, 469.9], [150, 1090.6, 476.8],
    [152, 1076, 483.3], [154, 1061.3, 490.4], [156, 1046.7, 497.1], [158, 1032.4, 503.4], [160, 1018.6, 509.7], [162, 1005.1, 516.4],
    [164, 991.4, 522.6], [166, 978.7, 528.5], [168, 965.1, 534.3], [170, 952.3, 541.1], [172, 940, 546.9], [174, 927.8, 552.8],
    [176, 916, 558.6], [178, 904, 564.6], [180, 892.1, 570.5], [182, 880.8, 575.6], [184, 869.3, 581.6], [186, 858.4, 587.4],
    [188, 847.5, 592.6], [190, 836.6, 598.3], [192, 826.5, 603.3], [194, 815.8, 608.6], [196, 805.6, 613.8], [198, 795.5, 619.5],
    [200, 785.5, 624.4], [202, 776.3, 629.3], [204, 766.6, 634.3], [206, 757.1, 639.4], [208, 747.8, 644.3], [210, 738.6, 649.3],
    [212, 729.3, 654.2], [214, 720.7, 659.2], [216, 712, 664.1], [218, 703.2, 668.6], [221, 690.2, 675.8], [222, 686.1, 678.2],
    [224, 678, 682.7], [226, 669.8, 687.3], [228, 661.6, 691.9], [238, 622.7, 713.9], [240, 615.2, 718.4], [256, 559.1, 752.5],
    [257, 556.2, 754.7], [262, 539.3, 765.4], [265, 529.9, 771.3], [266, 526.9, 773.4], [268, 520.7, 777.3], [270, 514.3, 781.2],
    [272, 508.4, 785.2], [274, 502.4, 789.4], [276, 496.2, 793.2], [278, 490.4, 797.3], [280, 484.5, 801.2], [282, 478.6, 805.3],
    [284, 473.3, 808.8], [286, 467.2, 813], [288, 461.8, 816.5], [290, 456.3, 820.3]
  ]
}
```

7. `tests/fixtures/hls/dvr-playlist.m3u8` (README section 8 "Fixtures"). These are segments 887655–887658 of the itag 270 DVR playlist fetched at 15:21:49Z, under its real head, with every URL replaced, because real URLs carry the client IP and a signature:

```text
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:887655
#EXT-X-DISCONTINUITY-SEQUENCE:132
#EXT-X-PROGRAM-DATE-TIME:2026-10-11T15:08:30.039+00:00
#EXTINF:5.0,
https://example.invalid/sq/887655/seg.ts
#EXTINF:5.0,
https://example.invalid/sq/887656/seg.ts
#EXTINF:5.0,
https://example.invalid/sq/887657/seg.ts
#EXTINF:5.0,
https://example.invalid/sq/887658/seg.ts
```

### Step 15. End-to-end spec

Write `tests/e2e/video.spec.ts` as listed in section 5. Notes for writing it:

- `document.elementFromPoint` skips elements with `pointer-events: none`. So at an empty point over the player it returns the player's iframe, and at a hit target it returns the button. Use it to prove both.
- Map CSS px to image px with `clientToImagePx` (step 18) and the `[data-testid=sky-map]` bounding rect. The sky map canvas is CSS-scaled at DPR ≠ 1, so never use `canvas.clientWidth` (gotcha G20).
- Enter fullscreen with a real click on the Fullscreen button (it needs user activation), and leave it with `page.evaluate(() => document.exitFullscreen())`. In headless Chromium 156, `page.keyboard.press("Escape")` did not exit fullscreen.

### Step 16. Passes (`src/domain/orbits/passes.ts`) and `scripts/find-passes.ts`

1. `findPasses(satrec, site, fromMs, toMs, stepMs, minAltDeg)` and `frameSpans(satrec, group, site, camera, fromMs, toMs, stepMs)` as declared in README section 6.
   - `findPasses` scans with `writeSample`, bisects rise and set to 1 ms, and finds the culmination on a 1 s grid.
   - `frameSpans` samples every `stepMs`. A sample counts when the object is visible (`isVisible` with `SUN_CUTOFF_DEG[group]`, sunlit, apparent altitude above 0°) and `projectAzAltDeg` returns true with a pixel inside [0, W] × [0, H]. It relies on `projectAzAltDeg`'s cull (r > 1.05·`rMaxUnit`, M4). With the settled Subaru k1 of −0.00992, an object far off the axis would otherwise fold back into the frame (gotcha G13).
2. The declarations for all three scripts. README section 6 lists the `find-passes.ts` and `record-clip.ts` export names; `check-clip-pass.ts` is new in M5:

```ts
// Script modules added by M5 — public API (declaration form).
import type { ClipPass, ClipSidecar } from "../src/app/clip";
import type { FrameSpan } from "../src/domain/orbits";
import type { YoutubeCamera } from "../src/state/types";
import type { HlsSegment } from "./record-clip";

// ---- scripts/find-passes.ts
export interface FindPassesOptions {
  readonly cameraId: string; // --cam (required)
  readonly noradId: number; // --norad, default 25544
  readonly fromMs: number; // --from <ISO Z>, default nowMs
  readonly hours: number; // --hours, default 48
  readonly calibrationFile: string | null; // --calibration <CalibrationFileV1>, default null (the camera's defaults)
  readonly gpDir: string; // --gp <dir>, default "public/data/gp"
}
/** Throws Error(usage) on an unknown flag, a missing --cam or a --from without Z. */
export function parseFindPassesArgs(argv: readonly string[], nowMs: number): FindPassesOptions;
export interface CameraPassSpan extends FrameSpan {
  readonly sunAltDegAtEnter: number; // geometric
  readonly elementAgeH: number; // enterMs − the element set's EPOCH, hours
}
/** findPasses (10 s, 0°) then frameSpans (1 s) over each pass's [riseMs − 60 s, setMs + 60 s]; readText reads cameras.json, the GP files and the calibration file. */
export function findCameraPasses(
  options: FindPassesOptions,
  readText: (path: string) => string,
): CameraPassSpan[];

// ---- scripts/record-clip.ts (in addition to README section 6)
export interface RecordClipOptions {
  readonly cameraId: string; // --cam, a youtube camera
  readonly fromMs: number; // --from <ISO Z>
  readonly toMs: number; // --to <ISO Z>, > fromMs, at most 3,600 s after it
  readonly name: string; // --name, /^[a-z0-9][a-z0-9-]*$/: recordings/<name>.mp4 and .json
  readonly noradId: number | null; // --norad
  readonly ytDlp: readonly string[]; // --yt-dlp "<command>", split on spaces; default ["uvx", "yt-dlp"]
  readonly ffmpeg: string; // --ffmpeg <path>, default "ffmpeg"
}
export function parseRecordClipArgs(argv: readonly string[]): RecordClipOptions;
/** What `ffmpeg -i <name>.mp4` reported. */
export interface ClipProbe {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationS: number;
}
export function buildClipSidecar(input: {
  readonly camera: YoutubeCamera;
  readonly videoId: string;
  readonly segments: readonly HlsSegment[]; // selectSegments' result, in order
  readonly probe: ClipProbe;
  readonly videoFile: string;
  readonly pass: ClipPass | null;
}): ClipSidecar;

// ---- scripts/check-clip-pass.ts
/** A measured track of one object in a clip, e.g. tests/fixtures/video/subaru-2026-10-11-iss-track.json. */
export interface ClipTrack {
  readonly clip: string; // the sidecar's file name
  readonly noradId: number;
  readonly widthPx: number; // pixel grid of the samples
  readonly heightPx: number;
  readonly method: string;
  readonly samples: readonly (readonly [mediaS: number, uPx: number, vPx: number])[]; // whole seconds; continuous px
}
export interface CheckClipPassOptions {
  readonly cameraId: string; // --cam, a local-video camera with a sidecarUrl
  readonly trackFile: string; // --track
  readonly gpDir: string | null; // --gp <dir>; null (the default): no GP route, the app loads what the server holds
  readonly calibrationFile: string | null; // --calibration, imported through the Calibration panel first
  readonly url: string; // --url, default "http://localhost:5173/Overhead/" (npm run dev under the H1 base)
  readonly limitDeg: number; // --limit, default 1.0
}
export function parseCheckClipPassArgs(argv: readonly string[]): CheckClipPassOptions;
```

3. `find-passes.ts` main (README "Recorded clips", "Finding a pass"):
   - It reads `public/data/cameras.json` with `parseCameraRegistry`, and `<gpDir>/stations.json` and `visual.json`; it never calls CelesTrak.
   - It builds the camera model from the camera's defaults, or from a `CalibrationFileV1` export given with `--calibration`.
   - It prints one line per span: enter and exit in UTC and in `site.timeZone`, az and alt at both ends, `maxAltDeg`, the Sun's geometric altitude at entry, and the element-set age.
   - Spans use the geometric horizon; terrain or the domes can end a real span earlier.

### Step 17. `scripts/record-clip.ts`

It cuts a UTC window out of a StarCam's YouTube DVR window after the fact (README "Recorded clips", "Recording"). The pure functions:

1. `parseMediaPlaylist(text)`:
   - It reads `#EXT-X-MEDIA-SEQUENCE`, the head `#EXT-X-PROGRAM-DATE-TIME` and each `#EXTINF`. A segment's `programDateTimeMs` is the head's plus the EXTINF durations before it.
   - It throws when the head has no PROGRAM-DATE-TIME, when a segment follows an `#EXT-X-DISCONTINUITY`, or when a URL's `/sq/<n>/` differs from MEDIA-SEQUENCE plus the segment's index.
   - It ignores every other tag. The 2026-10-11 playlist also held `#EXT-X-VERSION:3`, `#EXT-X-TARGETDURATION:5`, `#EXT-X-DISCONTINUITY-SEQUENCE:132` and 20 ad-marker pairs, each an `#EXT-X-DATERANGE:CLASS="CUEPOINT-AD",…` line followed by `#EXT-X-CUEPOINT:…,TYPE=AD`, about every 180 s. Three of them sit inside the clip's window, before sq 887677, 887713 and 887749, and the video after them is the camera's (the burned-in clock steps once a second throughout).
   - Match `#EXT-X-DISCONTINUITY` against the whole line. A prefix test also matches the `#EXT-X-DISCONTINUITY-SEQUENCE` header and rejects every real playlist.
   - A prototype with these rules parsed the real playlist into 720 segments, and `selectSegments` gave sq 887655–887750 for the window below.
2. `selectSegments(playlist, fromMs, toMs)` returns the segments overlapping [fromMs, toMs), in order. It throws unless the window lies inside the playlist. On the 2026-10-11 playlist, [15:08:30.039Z, 15:16:30.039Z) gives exactly sq 887655–887750 (96 segments); `--from 2026-10-11T15:08:30Z` would also take 887654, which ends at 15:08:30.039Z.
3. `parseRecordClipArgs(argv)` throws `Error(usage)` for a missing flag, a time without `Z`, `--to` not after `--from`, a window over 3,600 s, or a bad `--name`.
4. `buildClipSidecar(input)` returns the contract fields:
   - `cameraId` = `camera.id` and `videoFile`;
   - `startUtcMs` = the first segment's `programDateTimeMs`;
   - `startUncertaintyS` 0.2. That covers the 0.144 s by which PROGRAM-DATE-TIME preceded the burned-in clock on 2026-10-11, the only measurement so far;
   - `timingSource` `{ method: "hls-program-date-time", detail: "first segment sq <n>, PROGRAM-DATE-TIME <ISO>" }`;
   - `durationS` = the sum of the segments' `durationS`;
   - `width`, `height` and `fps` from `probe`;
   - `sourceVideoId` = `videoId`;
   - `credit` = `{ ...camera.credit, href: "https://www.youtube.com/watch?v=<videoId>" }`;
   - `pass` when given.
5. `main`, run only when executed directly:
   1. Read the registry; the camera must be `youtube`. Get the live id with `resolveYoutubeVideoId(camera.source.resolverUrl, camera.source.youtubeVideoId, fetch)`.
   2. Stop with a message if `--to` is still in the future, or if `--from` is more than 3,540 s before now. The DVR window held the last 3,600 s; the margin covers the time to fetch.
   3. Run `<ytDlp…> --js-runtimes node:<process.execPath> -f 270 -g https://www.youtube.com/watch?v=<id>` with `execFile`. The first stdout line is the HLS media playlist URL. Fetch it with `fetch`, then `parseMediaPlaylist` and `selectSegments`.
   4. Download the segments with plain GETs, 6 at a time and up to 3 tries each, into memory in sequence order. Write their concatenation to `recordings/<name>-dvr.ts`. Never log or write a playlist or segment URL: they expire about 6 h after they are issued and carry the client's IP address.
   5. Run `<ffmpeg> -i recordings/<name>-dvr.ts -map 0:v -c copy -movflags +faststart recordings/<name>.mp4`. Then parse `<ffmpeg> -i recordings/<name>.mp4` stderr (`Duration: 00:08:00.00`, `1920x1080`, `30 fps`) into a `ClipProbe`. Stop if `probe.durationS` differs from the segment sum by more than 1/`fps`.
   6. With `--norad`, compute `frameSpans` over the window with the camera's defaults, convert the first span to media seconds and pass it as `pass`.
   7. Write `recordings/<name>.json` (`buildClipSidecar`), and `recordings/<name>.segments.json` (`sq`, PROGRAM-DATE-TIME and bytes per segment, no URLs).
   8. Copy `public/data/gp/stations.json`, `visual.json`, `starlink.json` and `meta.json` into `recordings/<name>.gp/`. These are the element sets as committed when the clip was cut. Step 18 and the timing check use them, and from M9 the app replays the clip with them (M9 step 14f), so the directory needs every group the app may load. The 2026-10-11 clip was cut by hand before this script existed: its set is the committed snapshot, copied once with `mkdir -p recordings/subaru-2026-10-11-iss.gp && cp tests/fixtures/gp/*.json recordings/subaru-2026-10-11-iss.gp/` (README "Recorded clips", "Element sets for a clip").
   9. Print the burned-in-clock command of "Recording a clip" step 4 with the file names filled in.

### Step 18. `scripts/check-clip-pass.ts` (the acceptance tool)

It measures the app's drawn marker against a measured track, frame by frame. Run it by hand against `npm run dev` (which serves `recordings/` at `/Overhead/recordings/`), never in CI. Its `main` runs only when the file is executed directly, as in `find-passes.ts` and `record-clip.ts`, so the unit tests import the helpers without starting a browser:

```text
npx tsx scripts/check-clip-pass.ts --cam <clip camera id> --track <ClipTrack file> [--gp <dir>] [--calibration <CalibrationFileV1>] [--url http://localhost:5173/Overhead/] [--limit 1.0]
```

1. **Inputs.**
   - Read the track. A satellite-check export (step 13.5) is also accepted: each sample becomes `[round((timeMs − startUtcMs) / 1000), uPx, vPx]` on the camera's W × H grid.
   - Read `public/data/cameras.json`, and fetch the clip camera's sidecar from `--url`.
   - The reference model is `createCameraModel({ lens, calibration: sidecar.calibration, widthPx: W, heightPx: H })` with the source camera's lens and size. Without a sidecar calibration, stop: "The check needs a star-calibrated sidecar."
2. **Browser.**
   - `chromium.launch()` from `@playwright/test` (headless), viewport 1600 × 1000.
   - `context.route("**/data/gp/*.json", …)` and `context.route("**/recordings/*.gp/*.json", …)` both answer from `--gp` with `route.fulfill({ path })` (the file name after the last `/`), so the app propagates the chosen element sets whichever GP source it uses: `data/gp/` until M9, or the clip's own `recordings/<clip>.gp/` from M9 (README section 5, "Propagation: sample lifecycle" rule 11). Without `--gp` (`gpDir` null) neither route is added, and the app uses what the server holds: that is how M9 checks production, which serves the clip's own set.
   - Go to `<url>?cam=<id>&sel=sat:<noradId>`. Wait until `[data-testid=video-status]` has `data-status="paused"`, `[data-testid=time-utc]` reads `isoUtcSeconds(startUtcMs)`, and `__overhead.readyFrame()` is not null.
3. **Optional calibration.** With `--calibration`, open the Calibration panel (C), `setInputFiles` on its "Import JSON" input (M4), wait for the success message, and close the panel (C).
4. **Samples**, in track order, from media 0:
   1. Press "Forward 1 minute" while 60 s or more remain to the sample's second, then "Forward 1 second" for the rest. Each press is `stepBy`, which the clock loop turns into one exact `seekToSec`. Sim time is then exactly `startUtcMs + mediaS × 1000`.
   2. Wait until `time-utc` reads `isoUtcSeconds(startUtcMs + mediaS × 1000)`, then 30 more frames (`__overhead.frame()`). Then read `__overhead.clientPoint("sky", "sat:<noradId>")` twice, 10 frames apart. Accept the reading when both are non-null and agree within 0.01 CSS px; otherwise retry for up to 5 s, then record "no marker". The wait covers a worker sample that arrives after the jump.
   3. `markerPx = clientToImagePx(x, y, skyMapRect, W, H)`, with the `[data-testid=sky-map]` bounding rect. The view must still be the fitted full frame, so the script never touches the map.
   4. `measuredPx = [uPx × W / track.widthPx, vPx × H / track.heightPx]` (× 2 for the 2026-10-11 track).
   5. `sepDeg = pixelSeparationDeg(reference, markerPx, measuredPx)`.
5. **Report.** Write `recordings/<clip stem>.check.json` with:
   - the options, the ISS epoch from the `stations.json` the app received (the script keeps that response's body through `page.on("response")`), and the calibration used;
   - every sample (`mediaS`, `markerPx`, `measuredPx`, `sepDeg`);
   - the count, max (with its `mediaS`), median, the samples over `--limit` or without a marker, and `alongTrackOffsetS`.

   Then print one line, such as "94 samples, max 0.54° at 94 s, median 0.27°, along-track +0.87 s: pass". The exit code is 0 only if every sample has a marker and `sepDeg ≤ limitDeg`.
6. The helpers (exported; `tests/unit/checkClipPass.test.ts` targets them). `clientToImagePx` and `alongTrackOffsetS` were run in Node 26 on the 2026-10-11 data:

```ts
// scripts/check-clip-pass.ts: the pure helpers (exported; tests/unit/checkClipPass.test.ts targets them).
import { type CameraModel, unprojectPixel } from "../src/domain/camera";
import { angularSeparationDeg } from "../src/domain/geo";

/** A rectangle in viewport CSS px, as getBoundingClientRect() returns it. */
export interface CssRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Viewport CSS px → camera image px, for a sky map whose view shows the whole W × H frame, centred and contained. */
export function clientToImagePx(
  clientX: number,
  clientY: number,
  mapRect: CssRect,
  widthPx: number,
  heightPx: number,
): [uPx: number, vPx: number] {
  const s = Math.min(mapRect.width / widthPx, mapRect.height / heightPx); // CSS px per image px
  const ox = (mapRect.width - widthPx * s) / 2;
  const oy = (mapRect.height - heightPx * s) / 2;
  return [(clientX - mapRect.left - ox) / s, (clientY - mapRect.top - oy) / s];
}

/** One compared sample: media time, and the drawn marker and the measured object, both in camera image px. */
export interface PassSample {
  readonly mediaS: number;
  readonly markerPx: readonly [uPx: number, vPx: number];
  readonly measuredPx: readonly [uPx: number, vPx: number];
}

/**
 * Least-squares along-track offset δ in seconds: the measured object sits where the marker will be δ s later.
 * The marker's image velocity is the difference to the neighbouring samples at most maxGapS away.
 */
export function alongTrackOffsetS(samples: readonly PassSample[], maxGapS = 3): number | null {
  let num = 0;
  let den = 0;
  samples.forEach((r, i) => {
    const prev = samples[i - 1];
    const next = samples[i + 1];
    const a = prev !== undefined && r.mediaS - prev.mediaS <= maxGapS ? prev : r;
    const b = next !== undefined && next.mediaS - r.mediaS <= maxGapS ? next : r;
    if (a === b) return;
    const dt = b.mediaS - a.mediaS;
    const vx = (b.markerPx[0] - a.markerPx[0]) / dt;
    const vy = (b.markerPx[1] - a.markerPx[1]) / dt;
    num += (r.measuredPx[0] - r.markerPx[0]) * vx + (r.measuredPx[1] - r.markerPx[1]) * vy;
    den += vx * vx + vy * vy;
  });
  return den > 0 ? num / den : null;
}

const scratch = new Float64Array(4);

/** Angle on the sky between two image pixels, both unprojected through the reference model; null if either fails. */
export function pixelSeparationDeg(
  reference: CameraModel,
  a: readonly [number, number],
  b: readonly [number, number],
): number | null {
  if (!unprojectPixel(reference, a[0], a[1], scratch, 0)) return null;
  if (!unprojectPixel(reference, b[0], b[1], scratch, 2)) return null;
  const [azA = Number.NaN, altA = Number.NaN, azB = Number.NaN, altB = Number.NaN] = scratch;
  return angularSeparationDeg(azA, altA, azB, altB);
}
```

7. Why angles and not pixels. The reference model is the star fit, so `sepDeg` is the marker's real error on the sky, whatever calibration the app is using.
   - 1° near the axis is 44.09 px at 3840 width with the fitted f (22.05 px at 1080p), and 47.86 px with the old f 2742 (23.93 px at 1080p).
   - The gnomonic projection stretches toward the edges, so a fixed pixel threshold is wrong there.
   - `pixelSeparationDeg` is the same computation as M4's inverse plus `angularSeparationDeg`. A Node prototype of it gave the expected numbers in section 6.

### Step 19. Acceptance run and docs

1. Run section 6 item 3 on the machine with the clip. Attach its report and a screen recording of the replay of 30 s or less to the pull request; never commit the source clip.
2. Write the M5 section of the root `README.md`:
   - the two StarCams with the sky drawn on the player, the light set and the "On the video" toggles;
   - pass-through and hit targets, and the Fullscreen button;
   - stream delay;
   - clip cameras and sidecars, and how to record a clip (the procedure below, shortened);
   - the credits.
3. Add the section 8 lines to `docs/DECISIONS.md`.

## Recording a clip

The hand procedure behind `recordings/subaru-2026-10-11-iss.*`, and how to repeat it for the next pass. `scripts/record-clip.ts` (step 17) automates steps 2–3 and writes a first sidecar. Steps 4–6 stay by hand.

1. **Find the next visible pass in frame.** Run `git pull` first, so `public/data/gp/` holds the latest element sets that `fetch-gp.yml` committed.

   ```text
   npx tsx scripts/find-passes.ts --cam subaru-starcam [--norad 25544] [--from <ISO Z>] [--hours 48] [--gp public/data/gp]
   ```

   With the settled defaults and the ISS elements in `tests/fixtures/gp` (epoch 2026-10-09T22:48:38.797Z), `--from 2026-10-11T14:00:00Z --hours 3 --gp tests/fixtures/gp` finds two passes. The second (16:42–16:51Z) is in daylight. The first rises at 15:04:35.6Z and sets at 15:14:59.2Z (geometric), and gives one span:
   - entry 15:09:50.6Z (05:09:50.6 HST) at az 123.43°, alt 28.84°;
   - exit 15:15:08.6Z at az 52.09°, alt 0.02°;
   - `maxAltDeg` 28.84°, the Sun at −16.21° at entry, elements 40.35 h old.

   `frameSpans` runs over the pass's [riseMs − 60 s, setMs + 60 s] (README "Finding a pass" step 3), so its samples fall on whole seconds from 15:03:35.6Z. Refraction keeps the ISS above the apparent horizon until 15:15:09.0Z (az 52.06°), 10 s after the geometric set, so the exit is the last sample before that. Over the pass's bare [riseMs, setMs] the exit would have been cut at 15:14:58.6Z (az 52.58°, alt 0.52°). Both runs used a Node prototype of `frameSpans` with satellite.js 7.1.0, astronomy-engine 2.1.19 and the M4 model.

   On the video the ISS entered at 15:09:48.9Z and went behind the left-hand dome at 15:13:20.6Z, before the geometric set. Choose a window that starts at least 60 s before entry (M8's incoming look-ahead) and ends after exit. The 2026-10-11 clip runs 15:08:30.039Z–15:16:30.039Z.
2. **Cut the window from the DVR within the hour.** The DVR window holds the last 3,600 s, so fetch within about 60 min of the window's start. On 2026-10-11 the playlist was fetched at 15:21:49Z and all segments were down by 15:22:53Z.

   ```text
   npx tsx scripts/record-clip.ts --cam subaru-starcam --from 2026-10-11T15:08:30.039Z --to 2026-10-11T15:16:30.039Z --name subaru-2026-10-11-iss --norad 25544 --ffmpeg <path to ffmpeg>
   ```

   The commands it automates, exactly as run on 2026-10-11 (yt-dlp 2026.08.19 through `uvx`, ffmpeg 7.1 static arm64, curl, Node 26.11.1):

   ```text
   uvx yt-dlp --js-runtimes "node:$HOME/.nvm/versions/node/v26.11.1/bin/node" -f 270 -g "https://www.youtube.com/watch?v=Kj5DjRYkzD8" > m3u8url.txt
   curl -s "$(cat m3u8url.txt)" -o manifest.m3u8
   # sq(t) = MEDIA-SEQUENCE + floor((t − head PROGRAM-DATE-TIME) / 5 s): 887655 … 887750 for 15:08:30.039Z … 15:16:30.039Z
   curl -s -f --retry 3 -o segs/<sq>.ts "<segment URL containing /sq/<sq>/>"    # 96 segments, 6 in parallel: 153,519,296 bytes in 6 s
   cat segs/887655.ts … segs/887750.ts > recordings/subaru-2026-10-11-iss-dvr.ts
   ```

   - Run these in a scratch directory outside the repository and delete it once the MP4 is checked. `m3u8url.txt` and `manifest.m3u8` hold signed URLs that carry the client's IP address (G24); only the concatenation goes into the project's `recordings/`.
   - The URL from `-g` contains `playlist_duration/3600` and `playlist_type/DVR`, and expires about 6 h after it is fetched.
   - The playlist held 720 segments of exactly 5.0 s, with `#EXT-X-MEDIA-SEQUENCE:887094`, one `#EXT-X-PROGRAM-DATE-TIME` (2026-10-11T14:21:45.039Z) on its first segment, and no discontinuities. Segment n's PROGRAM-DATE-TIME was 14:21:45.039Z + 5 s × (n − 887094). The live edge was about 4 s behind the wall clock.
   - itag 270 is 1080p H.264, video only; the stream has no muxed formats.
   - An ffmpeg-only route also worked in 19 s, packet-identical for all 14,400 frames: write a VOD playlist listing only the 96 segment URLs followed by `#EXT-X-ENDLIST`, then run `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto -i dvr.m3u8 -c copy -f mpegts out.ts`.
3. **Remux to MP4.** Chromium cannot play MPEG-TS.

   ```text
   ffmpeg -i recordings/subaru-2026-10-11-iss-dvr.ts -map 0:v -c copy -movflags +faststart recordings/subaru-2026-10-11-iss.mp4
   ```

   The result is a real MP4: `ftyp isom` with `moov` first, start 0.000, H.264 High (avc1.640028), 1920 × 1080, 30 fps, 480.000 s, 14,400 frames, a 5 s GOP and no B-frames, 148,643,811 bytes. Frame n is at media time n/30 s. `ffmpeg -i` reports `Duration: 00:08:00.00, start: 0.000000`.
4. **Pin the start time with the burned-in clock.** The Subaru StarCam burns its capture clock (HST, UTC−10) into the lower right of each frame.

   ```text
   ffmpeg -hide_banner -i recordings/subaru-2026-10-11-iss.mp4 -vf "select='between(n\,20\,31)',showinfo,crop=200:50:1450:925,tile=2x6" -fps_mode passthrough -frames:v 1 -y clock.png 2>&1 | grep -o 'n: *[0-9]* pts: *[0-9]* pts_time:[0-9.]*'
   ```

   - This tiles frames 20–31 (row by row, two per row) and prints their `pts_time`. `showinfo`'s `n:` counts the selected frames from 0, so `n: 4` is frame 24 at `pts_time:0.8`. Keep `-y`: without it ffmpeg asks before overwriting an existing `clock.png`, the question goes into the pipe, and the command prints nothing.
   - Tile 4 (the left tile of the third row: frame 24, 0.8 s) reads 05:08:30; tile 5 (frame 25, 0.833333 s) reads 05:08:31. Re-run on 2026-10-11 with the static ffmpeg 7.1.
   - The second therefore began between `pts_time` 0.8 and 0.833333. Media 0 = 05:08:31.000 HST − 0.816667 s = 05:08:30.183 HST ± 0.017 s, which is 2026-10-11T15:08:30.183Z, `startUtcMs` 1791731310183.
   - Repeat at two later seconds (change `between(n\,a\,b)`): the clock reads 05:10:11 from 100.833 s and 05:15:11 from 400.833 s. The seconds digit changed at frames 25 + 30k for all 480 transitions, so the video timeline and the camera clock agree in rate to better than 70 ppm.
   - Write `startUtcMs`, `timingSource` `{ method: "burned-in-clock", detail }` and `startUncertaintyS` into `recordings/<clip>.json`. The first segment's PROGRAM-DATE-TIME, 15:08:30.039Z, was 0.144 s earlier; `startUncertaintyS` must cover it.
5. **Calibrate on stars.** Run `npm run dev` and open `http://localhost:5173/Overhead/?cam=<clip camera>`, or pick both files in `local-replay`. Pause on a frame with stars and fit star pairs until M4's acceptance passes for a rectilinear lens (at least 10 named stars at alt ≥ 10°). Then "Save sidecar" (step 10.8) over `recordings/<clip>.json`.
   - The 2026-10-11 fit came from 60-frame stacks at media 56, 241 and 461 s, which bring out fainter stars. It gave the values in step 2.
   - Jupiter at top centre, (1056, 60) at media 56 s, fitted as a holdout within about 5 px.
6. **Refine the timing with the ISS track.** Trust the clock, but check it against the ISS with an element set no older than a day.
   1. Get a track. For 2026-10-11 it is the committed fixture (step 14.6). For a new clip, select the ISS (`&sel=sat:25544`), open the Satellite check (step 13), click the ISS every 2 s across its visible stretches, and export.
   2. Run `npx tsx scripts/check-clip-pass.ts --cam <clip camera> --track <track or export> --gp recordings/<clip>.gp` and read `alongTrackOffsetS`, δ. A positive δ means the ephemeris reaches the observed position δ s after the clip's clock time.
   3. Read δ together with the element-set age. On 2026-10-11 the full 4,711-frame track gave:
      - +0.879 s with the 40.3-h fixture set (+0.867 s from the 94-sample track);
      - +0.077 s with a 20.2-h set;
      - +0.297 s with a 10.9-h set;
      - +2.916 s with a NASA ephemeris from 2026-10-07.

      So δ grows with element age, and the clock was right.
   4. With a set at most 24 h old, |δ| ≤ `startUncertaintyS` confirms the clock: record δ under `timingSource` (extra keys are allowed) and keep `startUtcMs`.
   5. A larger |δ| with fresh elements means a clock fault. So does a camera with no clock. In either case set `startUtcMs += round(δ × 1000)` and `timingSource.method` `"satellite"`. Set `startUncertaintyS` to cover the spread of δ over separate stretches of the pass: on 2026-10-11 the 20.2-h set gave 0.082, 0.024, 0.175 and 0.086 s over four stretches.
7. **Write the sidecar.** The final `recordings/<clip>.json` holds the README contract fields: `cameraId`, `videoFile`, `startUtcMs`, `startUncertaintyS`, `timingSource`, `durationS`, `width`, `height`, `fps`, `sourceVideoId`, `credit`, `calibration` and `pass`. It may also hold provenance keys, which `parseClipSidecar` ignores. The 2026-10-11 file's contract fields are in README "Recorded clips". It holds `pass` `{ noradId: 25544, inFrameFromMediaS: 78.7, inFrameToMediaS: 290.43, visibleMediaS: [[78.7, 228], [238, 241.5], [256, 258.4], [260.8, 290.43]] }`, measured on the video.
8. **To replay it:** pick both files in `local-replay` on any build. Add a `cameras.json` entry with a `sidecarUrl` only for clips that the docs or tests name.

What failed on 2026-10-11, so do not do it:

- `--live-from-start -f 137 --download-sections "*10:00-18:00"`, and the same with `"*-900-420"`, both stop with "ERROR: This format cannot be partially downloaded". The live-from-start formats are DASH (137 = 1080p avc1.640028 at 4200k; 139 and 140 are audio only). yt-dlp's live-from-start path has no section support, and for a stream older than 120 h it starts 120 h back. This stream was about 51 days in.
- `-f 270 --download-sections "*10:00-10:20"` without live-from-start runs ffmpeg with `-ss` on the live HLS. ffmpeg logs "could not seek to position 49270.320" and then silently records 20 s from the live edge, the wrong window.
- Recording the live edge with yt-dlp and stopping it with Ctrl-C. The file stayed MPEG-TS under an `.mp4` name, because yt-dlp's remux runs only when a download finishes normally. By its clock it started at 15:10:15.18Z, 26 s after the ISS had entered the frame. It is kept as `recordings/subaru-2026-10-11-iss-live.ts`. Its frame 0 is packet-identical to DVR frame 3150 (media 105.000 s), and the 11,250 packets after it match.

## 5. Tests

### Unit tests

| File · test | Fixture and how it is made | Tolerance (measured) |
| ----------- | -------------------------- | -------------------- |
| `time.test.ts` · live time | Inline. Anchor wall T = 2026-10-11T08:00:00Z, anchor media 4,399,105.5 s, delay 50,000 | Exact. At the anchor → 07:59:10.000Z. Media + 20.25 s → 07:59:30.250Z. Media 4,399,105.8 → 4,399,125.8 gives T + 20,000 − 50,000 exactly. |
| `time.test.ts` · stall and delay | Same | Exact. `youtubeStallMs(T, aM, T + 30,000, aM + 20)` = 10,000; `(T, aM, T + 10,000, aM + 13)` = −3,000. `streamDelayForFrameMs(T, aM, aM + 20.25, T − 61,250)` = 81,500, and feeding it back into `youtubeLiveTimeMs` returns T − 61,250 exactly. |
| `time.test.ts` · clamp and clip | Inline | Exact. `clampStreamDelayMs`: −5 → 0, 130,000 → 120,000, 50,000.4 → 50,000, 49,999.5 → 50,000. `localVideoTimeMs(08:00:00.000Z, 2.25)` → 08:00:02.250Z. `clipStartUtcMs(08:00:12.500Z, 12.5)` → 08:00:00.000Z. `clipStartUtcMs(2026-10-11T15:08:31.000Z, 0.816667)` → 1791731310183 ± 1. |
| `youtube.test.ts` · parse | The four meta lines fetched 2026-10-11 (step 4.2), inline | `Kj5DjRYkzD8`, `Q3UhCgsWDw8`, `BVKRAzTSnB0`, `_HZDjlfTuvQ`. `watch?v=Kj5DjRYkzD8&t=0s` and `watch?feature=share&v=Q3UhCgsWDw8` parse. `content` before `http-equiv` with `URL='…'` parses. A 12-character or 10-character id, a plain `<a href>` link and a page with no meta give null. |
| `youtube.test.ts` · resolve | Fake `fetch` returning a `Response` | 200 page → `{ id, source: "resolver" }`. 404 → fallback, reason "resolver HTTP 404". No id → "no video id in resolver page". Throws `TypeError("Failed to fetch")` → reason "Failed to fetch". `resolverUrl` null → "no resolver". The `cache` argument reaches `fetch` (`"no-cache"` seen). A fake that never resolves but, like the real `fetch`, rejects with `init.signal.reason` when its signal aborts, with `timeoutMs` 50, falls back with reason "The operation was aborted due to timeout" (Node's message; measured 52 ms). A fake that ignores the signal would hang the test: the timeout works only through the signal. Never throws. |
| `youtube.test.ts` · mapping | Inline | Errors: 2 and 5 `error`; 100 `error`; 101, 150, 153 `embed-blocked`. States: −1 `loading`, 0 `ended`, 1 `playing`, 2 `paused`, 3 `buffering`, 5 `paused`. |
| `clip.test.ts` · `parseClipSidecar` | Inline: the README's contract JSON for the 2026-10-11 clip plus provenance keys (`format`, `version`, `startUtc`, `recordedWith`), the README e2e sidecar, and the broken object `{ cameraId: "synthetic-maunakea", videoFile: "a/b.mp4", startUtcMs: "x", timingSource: { method: "guess" }, durationS: 0, width: 1920, height: 1000, fps: 0, sourceVideoId: "abc", credit: {}, calibration: 3, pass: { noradId: 0 } }`; registry from `public/data/cameras.json` plus `synthetic-maunakea`; now 2026-10-11T16:00Z | Both real sidecars → ok. The broken object → exactly 11 messages, in the step 10.1 order: cameraId, videoFile, startUtcMs (finite), startUncertaintyS, timingSource, durationS, fps, sourceVideoId, credit, calibration, pass. There is no width:height message while `cameraId` is invalid. The e2e sidecar with `height` 200 → only the width:height message. With `startUtcMs` 2026-10-13T00:00Z and now 2026-10-11T10:00Z → `["startUtcMs is out of range"]`. With `cameraId` `local-replay` → only the cameraId message. `"x"` and `[]` → `["sidecar must be a JSON object"]`. |
| `clip.test.ts` · camera | Same | `clipVideoUrl("http://localhost:4173/Overhead/recordings/subaru-2026-10-11-iss.json", s)` → `http://localhost:4173/Overhead/recordings/subaru-2026-10-11-iss.mp4`. `clipCamera(subaru-2026-10-11-iss entry, …)` → source `{ sidecarUrl: "recordings/subaru-2026-10-11-iss.json", sourceCameraId: "subaru-starcam", videoUrl, startUtcMs: 1791731310183 }`, `defaults.focalPx` 2525.93, `streamDelayMs` 0, credit "NAOJ & Asahi Shimbun", `termsNote` from `subaru-starcam`, and the entry's name. An entry with `sourceCameraId` `cfht-starcam` → null. A sidecar without `calibration` → the `subaru-starcam` defaults with `streamDelayMs` 0. |
| `clockLoop.test.ts` · media clocks | Manual scheduler (M0), `vi.setSystemTime`, fake `MediaClock` objects | Live YouTube, no clock: sim = now − 50,000. Anchor (T, 4,399,105.5), media 4,399,125.75, now T + 30,000 → T − 29,750. Media null → no tick. Delay set to 30,000 → T − 9,750. Local clip, start S, media 2.25 → S + 2,250 on every frame whatever the rate and wall delta. `seek(S + 5,000)` → `seekToSec(5)` called once and sim S + 5,000. `seek(S + 9,000)` on a 7 s clip → `seekToSec(9)`, then (the fake clamps like the real one) the next frame reads S + 7,000. `setMediaClock(null)` → M0's replay branch again. |
| `actions.test.ts` | `createAppStore` with the registry | `setStreamDelayMs(130,000)` stores 120,000; NaN changes nothing; on a non-YouTube camera nothing changes. `setVideoStatus("embed-blocked", 150)` is stored. `setActiveCamera` resets `video`. `setVideoLayer("grid", true)` gives a new `layers.video` with only `grid` changed; repeating it leaves the same reference. |
| `selectors.test.ts` | `createAppStore` with the committed, enabled registry | Exact. `selectStreamDelayMs`: 50,000 on `subaru-starcam`, 22,000 after `setStreamDelayMs(22_000)`, 0 on `synthetic-maunakea` and on `subaru-2026-10-11-iss`. `selectLiveLocked`: true in live mode on `subaru-starcam`, false in replay there, false in live mode on `synthetic-maunakea`. `selectSkyOverVideo`: true on `subaru-starcam` and `local-replay`, false on `synthetic-maunakea` and `cfht-nanaao`. `selectStarMagLimit`: 4.5 on synthetic and still-image cameras, 2 on `youtube` and `local-video`, 4 with the Calibration panel open. `selectSkyLayerVisible("grid")`: false on `subaru-starcam` by default, true after `setVideoLayer("grid", true)`. `("starlink")` needs both `layers.starlink` and `layers.video.starlink`. `("stars")` is true. `selectSkyDenseLabels`: false on `subaru-starcam`, true on `synthetic-maunakea`, true after `setVideoLayer("denseLabels", true)`. |
| `bindLayers.test.ts` · `bindSkyLayerVisible` | Live store, a real `ol/layer/Vector` in Node | The README run: the grid shows on a synthetic camera, hides on a `youtube` camera, ignores a clock tick, shows again with `layers.video.grid`, follows `layers.grid` off and on, stays on for a `local-video` camera, and stops after unsubscribe. |
| `cameras.test.ts` | The committed `cameras.json`, plus variants | It parses. M1's file-order list gains `local-replay` and `subaru-2026-10-11-iss` after `cfht-starcam`. `enabledCameras` gives `synthetic-maunakea`, `cfht-nanaao`, `subaru-starcam`, `cfht-starcam`, `local-replay`, `subaru-2026-10-11-iss`. M1's Subaru `defaults` assertion becomes az 81.2322, alt 19.6185, roll 0.7698, f 2525.93, k1 −0.00992, delay 50,000. Each of these is rejected with a message naming the field: id `Kj5DjRYkzD8X` (12 characters), an `http:` resolver, `sidecarUrl` `/recordings/x.json`, `sourceCameraId` `synthetic-maunakea`, a non-null `videoUrl`, `startUtcMs: "x"`, and a `local-video` delay of 1. |
| `fit.test.ts` · `satelliteCheckSummary` | 12 samples 2,000 ms apart, residuals 0.30…0.85°; 13 samples at 0, 2, … 20 s and 30, 32 s, residual 0.5° | Pass, max 0.85, median 0.575, gap 2,000. One residual 1.01 → fail; exactly 1.0 → pass. 9 samples → fail. One 3,000 ms gap → fail. The 13 samples: without `hiddenMs` gap 10,000 → fail; with `hiddenMs` [[21,000, 29,000]] gap 2,000 → pass; with [[23,000, 29,000]] gap 4,000 → fail (prototype run in Node 26). Reversed order gives the same result. A NaN residual → fail. Empty → count 0, nulls, fail. |
| `passes.test.ts` · `findPasses` | ISS from `tests/fixtures/gp/stations.json`, site 19.82552°, −155.47587°, 4,148 m, 2026-10-11T14:00Z–17:00Z, 10 s, 0° | 2 passes. The first: rise 15:04:35.6Z ± 1 s, culmination 15:09:47Z ± 2 s at 28.835° ± 0.05° (geometric), set 15:14:59.2Z ± 1 s, `sunlitAtCulmination` true, Sun −16.22° ± 0.05°. |
| `passes.test.ts` · `frameSpans` | README "ISS span in the Subaru frame": the old Subaru defaults as inline inputs; and the settled `subaru-starcam` defaults from `cameras.json` over 15:05:00Z–15:20:00Z, 1 s | Old defaults: exactly one span, enter 15:09:55Z (az 120.760°, alt 28.756°), exit 15:15:09Z (az 52.065°, alt 0.002°), `maxAltDeg` 28.756°; ± 1 s and ± 0.05°. Settled defaults: exactly one span, enter 15:09:50Z (az 123.78°, alt 28.85°), exit 15:15:09Z, `maxAltDeg` 28.85°. With that model, `projectAzAltDeg` of az 172.11°, alt 18.99° (the ISS at 15:08:08Z, 84.51° off the axis) returns false. Without M4's cull it would land at (49, 1724), inside the frame, and open a false span at 15:08:08Z. |
| `findPasses.test.ts` | Inline argv | `["--cam", "subaru-starcam"]` with now N → norad 25544, `fromMs` N, hours 48, `gpDir` `public/data/gp`, `calibrationFile` null. `--from 2026-10-11T14:00:00` (no Z), an unknown flag or no `--cam` → throws. |
| `recordClip.test.ts` | `tests/fixtures/hls/dvr-playlist.m3u8`; inline playlists; the `subaru-starcam` entry | `parseMediaPlaylist`: 4 segments, `sq` 887655 at 15:08:30.039Z, 5.0 s each, `mediaSequence` 887655; the fixture's `#EXT-X-DISCONTINUITY-SEQUENCE:132` line does not throw. An inline two-segment playlist with an ad-marker pair in the real form (`#EXT-X-DATERANGE:CLASS="CUEPOINT-AD",…`, then `#EXT-X-CUEPOINT:…,TYPE=AD`) before its second segment → 2 segments, 5 s apart (step 17.1). `selectSegments` for [15:08:31Z, 15:08:41Z) → 887655–887657; for [15:08:20Z, 15:08:41Z) → throws. Throws on: no PROGRAM-DATE-TIME; an `#EXT-X-DISCONTINUITY` before a segment; a `/sq/887660/` URL at index 0. `parseRecordClipArgs`: defaults `ytDlp` `["uvx", "yt-dlp"]`, `ffmpeg` `"ffmpeg"`, `noradId` null; throws on `--to` before `--from`, on a 3,601 s window and on `--name Bad_Name`. `buildClipSidecar` on 887655–887657 with probe 1920 × 1080, 30 fps, 15 s → `startUtcMs` 1791731310039, `durationS` 15, method `"hls-program-date-time"`, `startUncertaintyS` 0.2, credit href `https://www.youtube.com/watch?v=<videoId>`, and it passes `parseClipSidecar`. |
| `checkClipPass.test.ts` | Inline | `clientToImagePx`: in the rect {left 100, top 50, width 1440, height 900} (letterboxed, s 0.375, 45 px bars), the CSS points of image (0, 0), (3840, 2160), (1920, 1080) and (1234.5, 678.9) map back to themselves within 1e-9. The CSS point (580, 320) in {100, 50, 960, 540} maps to (1920, 1080). `alongTrackOffsetS`: markers at (1000 + 10t, 500 − 5t) for t = 0, 2, 4, 6, 8 with measured = marker + 0.5 s × velocity → 0.5 exactly. One sample → null. Two samples 4 s apart → null. `parseCheckClipPassArgs` defaults: `gpDir` null, `url` `http://localhost:5173/Overhead/`, `limitDeg` 1, `calibrationFile` null; `--gp tests/fixtures/gp` gives `gpDir` `tests/fixtures/gp`. |

### End-to-end: `tests/e2e/video.spec.ts`

YouTube tests run at viewport 1280 × 720. Call `page.clock.setFixedTime(new Date("2026-10-11T08:00:00Z"))` (22:00 HST) before going to `./?cam=subaru-starcam` (specs navigate base-relative, M0 step 9). `setFixedTime` fixes `Date` but keeps timers and frames running: a prototype loop ran 19 frames, then 58. After PLAYING the sky time is 07:59:10Z (delay 50 s), and Uranus (az 73.12°, alt 16.72°) is the only Sun, Moon or planet in the frame. It sits at image (1577, 1206) with the settled defaults.

1. **Resolves the id and embeds one player.**
   - One request to `/maunakea_east/`.
   - `__ytStub.options[0]` has `videoId` `Fixture0001` and `playerVars` deep-equal to `{ autoplay: 0, playsinline: 1, rel: 0, fs: 0 }`. `[data-testid=video-player]` holds one iframe.
   - `calls` has `mute` before the only `playVideo`, whose `visibleFraction` is above 0.5.
   - "NAOJ & Asahi Shimbun" and "Non-commercial use only" are visible. After PLAYING the picker reads "Live".
2. **The sky map sits on the player.**
   - `[data-testid=sky-map]` and the player's iframe have the same box within 1 px, both inside `[data-testid=sky-stage]`.
   - The map target's computed `pointer-events` is `none`.
   - At `clientPoint("sky", "planet:Uranus")`, `elementFromPoint` is a `button` with `aria-label` "Uranus": the overlay is on top.
   - The "On the video" group is visible in the Layers panel with three unchecked boxes. On `./?cam=synthetic-maunakea` it is absent.
3. **Clicks pass through to the player.** Pick a point in the stage at least 30 CSS px from every hit-target button's box; `elementFromPoint` there is the iframe. Click it → `__ytStub.clicks` grows by exactly 1, and the URL has no `sel=`.
4. **Hit targets select and hover.**
   - Move to Uranus's `clientPoint` → the HoverCard shows "Uranus". At a point inside the HoverCard's box and outside every hit-target box, `elementFromPoint` is the player's iframe.
   - Click → the URL has `sel=planet:Uranus`, the Inspector shows "Uranus", and `__ytStub.clicks` did not grow.
5. **Stage fullscreen keeps the overlay on the content box.**
   - Record Uranus's image px with `clientToImagePx(clientPoint, sky-map rect, 3840, 2160)`.
   - `page.setViewportSize({ width: 1440, height: 900 })`, then click "Fullscreen". `document.fullscreenElement` is `[data-testid=sky-stage]`. Wait for a `setSize` call with w 1440, h 900; the iframe and the map target are both 1440 × 900.
   - Uranus's image px from the new `clientPoint` equals the recorded one within 1 image px (the frame is contained: a 1440 × 810 box 45 px from the top).
   - `document.exitFullscreen()`.
6. **The player's own fullscreen is undone.** Click an empty point (step 3's rule) to focus the stub iframe, then press `f`. Within 1 s `document.fullscreenElement` is null, and the note "Use this Fullscreen button to keep the sky on the video." is visible.
7. **Live time follows the media clock.**
   - After PLAYING, `time-utc` reads `2026-10-11T07:59:10Z` and `time-mode` reads "Live".
   - `setFixedTime(T + 30 s)` and `__ytStub.setMedia(4,399,125.5)` → `07:59:30Z`. Press C (focus outside the player): "Behind real time now: 60.0 s".
   - Fill "Stream delay (exact), seconds" with 30 → `07:59:50Z`.
8. **Timeline pause leaves the player alone.** Space → `time-mode` "Replay", the replay message shows, and the stub has no `pauseVideo` call. "Live" → "Live" again.
9. **Rebuffer prompt.** `emitState(3)`, `setFixedTime(+2 s)`, `emitState(1)` → the rebuffer message with "2 s".
10. **Embed errors fall back to replay**, for each of 101, 150 and 153:
    - `emitError(code)`. For 101 and 150 there is a second `/maunakea_east/` request, which returns the same id.
    - The status says "cannot be played here (YouTube error <code>)", with the link `https://www.youtube.com/watch?v=Fixture0001`. `[data-testid=video-player]` holds no iframe, and `[data-testid=sky-map]` is still in the stage.
    - The picker reads "Offline" and `time-mode` reads "Replay". There is no console error; 153 logs a warning only.
    - For 153, click "Replay the recorded clip: Subaru StarCam: ISS pass, 2026-10-11 (recorded)". The active camera becomes `subaru-2026-10-11-iss`; through the `**/recordings/**` route the test pattern loads, `time-utc` reads `2026-10-11T08:00:00Z` and `data-status` is `paused`.
11. **Re-resolve finds a new id.** `page.route` answers the second resolver request with `youtu.be/Fixture0002`. `emitError(150)` → one live player, with `Fixture0002`, and the restart message.
12. **Resolver fallback.** `page.route` answers `/maunakea_east/` with a 200 page without a meta refresh → `videoId` `Kj5DjRYkzD8` and "Using the last known video id".
13. **One player across switches.** subaru → cfht → subaru: after each, one iframe and `live().length === 1`. The cfht player requested `/maunakea_west/`.
14. **Suggestion from the player.** After PLAYING, set `mediaReferenceSec = (T − 21,000) / 1000` and press C. The panel offers "21.0 s"; Apply → `time-utc` `07:59:39Z`.
15. **Burned-in clock.** After PLAYING, press C. Enter `2026-10-10T21:59:20` (HST) in the video-clock input and Apply → "Delay at start of playback: 39.5 s" and `time-utc` `07:59:20Z` (`isoUtcSeconds` truncates 07:59:20.500).

Clip tests (no fake clock):

16. **Picked files on `local-replay`.**
    - At `./?cam=local-replay`, `setInputFiles([test-pattern.webm, test-pattern.sidecar.json])` → `data-status` `paused`, `time-utc` `2026-10-11T08:00:00Z`, `time-mode` "Replay".
    - Live is `aria-disabled`, and the rates are only 1× and 10×.
    - The sidecar credit and "CC0-1.0" are visible. The clip information names the start source "manual".
17. **The frame fills the camera's pixel extent.**
    - Turn off stars, planets, satellites and grid.
    - In the first `canvas` of the sky view, read the pixel at each quadrant centre (960, 540), (2880, 540), (960, 1620), (2880, 1620) of the 3840 × 2160 frame. Convert to canvas pixels through the container geometry: scale s = min(cw/3840, ch/2160), offsets ox = (cw − 3840 s)/2 and oy = (ch − 2160 s)/2, then canvas pixel = round((ox + u s) × k), round((oy + v s) × k), with k = `canvas.width / canvas.getBoundingClientRect().width`.
    - Expect red, green, blue and white within 40 per channel (measured worst 2).
18. **The video is the master clock.**
    - "Forward 1 second" twice → `08:00:02Z`.
    - Choose 10× and Play → `data-status` `ended`, `time-utc` equal to the end time in the clip information (`08:00:07Z` for the committed 7.00 s clip), and the button reads "Play".
19. **Sidecar errors are listed.** A copy of the sidecar with `"videoFile": "a/test-pattern.webm"` → the message `videoFile must be a file name with no / or \` is shown, and no clip loads (`time-utc` unchanged).
20. **A clip camera loads from its sidecar URL.** `./?cam=subaru-2026-10-11-iss` → through the `**/recordings/**` route, `data-status` `paused`, `time-utc` `2026-10-11T08:00:00Z`, the credit "Test pattern generated for the Overhead e2e tests", and the button "Copy pointing to Subaru-Asahi StarCam (east, live)" in the Calibration panel.
21. **Not part of this build.** `page.route("**/recordings/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Overhead</title>" }))`, then `./?cam=subaru-2026-10-11-iss` → "This clip is not part of this build.", the picker reads "Offline", and "Replay a local clip" is offered. No console error.

## 6. Acceptance criteria and PR evidence

1. The [definition of done](README.md#definition-of-done) holds. Paste the Vitest summary listing every file in section 5 and the Playwright list for `video.spec.ts`.
2. All e2e tests in section 5 pass with the YouTube stub, the generated clip and the routes.
3. **ISS pass on the 2026-10-11 clip (scripted, run by hand).**
   - **Setup.** `recordings/subaru-2026-10-11-iss.mp4` and `.json` (the sidecar with the star calibration) are present. Run `npm run dev` in one terminal; in another, run:

     ```text
     npx tsx scripts/check-clip-pass.ts --cam subaru-2026-10-11-iss --track tests/fixtures/video/subaru-2026-10-11-iss-track.json --gp tests/fixtures/gp
     ```

   - **What is measured.**
     - For each of the 94 track samples (one per even media second from 80 s to 290 s across the four visible stretches, with 221, 257 and 265 s standing in for frames without a clean detection; step 14.6), the script steps the clip to exactly that media second. It reads the app's drawn ISS marker through `__overhead.clientPoint("sky", "sat:25544")` and converts it to image px.
     - It compares the marker with the ISS centroid measured in that frame by angle on the sky through the star-fit model (step 18).
     - The app runs with the clip camera's own calibration (the sidecar's star fit) and the ISS elements in `tests/fixtures/gp` (epoch 2026-10-09T22:48:38.797Z, 40.3 h before the pass).
   - **Pass.** All 94 samples have a marker and every `sepDeg` ≤ 1.0°. Within each stretch the samples are 2 s apart, 1 or 3 s around the three substituted seconds. The ISS moves at most 19 px/s at 1080p (0.53°/s), and the error changes smoothly between samples.
   - **Expected values.** A Node prototype of the same comparison (satellite.js 7.1.0, the M4 model, site height 4,148 m) gave: max 0.543° (16.4 px at 1080p, media 94 s), median 0.269° (the mean of the middle two, as `satelliteCheckSummary` takes it), rms 0.306°, none over 1°, and `alongTrackOffsetS` +0.867 s. The app interpolates ENU between 100 ms samples (README: 0.0024° at 60×, less at 1×), so its numbers should match to a few thousandths of a degree. A larger difference means the marker, the conversion or the stepping is wrong; fix that, not the threshold.
   - **Why calibration is required.** The same comparison with the old Subaru defaults (f 2742, roll 0, k1 0) gave max 3.003° at 82 s, median 1.297°, and 54 of 94 samples over 1°. It is a scale error that changes sign across the frame centre, so no time shift fixes it. The best shift (+3.49 s) still left an rms of 29 px.
   - **Why the fixture elements.** They are committed, and their 40.3 h age costs about 0.9 s along-track: a mean along-track error of 7.7 px at 1080p, rms 8.57 px. Fresher sets would do better: a 20.2-h set put the calibrated marker within 0.13° (rms 1.2 px).
   - **Evidence:** the report `recordings/subaru-2026-10-11-iss.check.json` and its printed line. Add screenshots of the replay at media 94 s and 280 s with the marker on the ISS, and a screen recording of 30 s or less of the replay.
   - Optional evidence: repeat with `--calibration <file>` exported after an in-app star calibration of the clip that passed M4's checklist, and report its max.
4. **Live check by hand, on the real player** (a headed browser, `npm run dev`, `http://localhost:5173/Overhead/?cam=subaru-starcam`):
   - The player shows no fullscreen button. A click on the video pauses and resumes it through the overlay. Its controls bar, volume and DVR scrubber work.
   - "Fullscreen" takes the video and the overlay together; pressing `f` in the player is undone with the note.
   - At night, align the delay on a satellite or the ISS (step 9.7) and record the delay found.
5. Screenshots, from which the visual design is settled:
   - the Subaru StarCam live with the light overlay on the video, the credit visible and the Calibration panel's stream-delay section open;
   - the same in stage fullscreen;
   - the `embed-blocked` state from e2e test 10 with its offers;
   - the 2026-10-11 clip replaying with the ISS selected;
   - the ground-map wedge showing 37°–125°.
6. A short clip (30 s or less) of the live overlay freezing while the player buffers or is paused, then resuming in step.
7. `DECISIONS.md` has the section 8 lines, and the `cfht-starcam` values if they were aligned.

## 7. Gotchas

- **G1. Pass-through is per element.** CSS `pointer-events` applies to elements, not canvas pixels, and the page gets no pointer events while the pointer is over the cross-origin iframe. Set `none` on the map target itself: on `.ol-viewport` alone, the target div still blocked the iframe. Never toggle pass-through from `pointermove` (`verification/openlayers.md` claim 12).
- **G2. Every `ol/Overlay` container takes clicks.** OpenLayers sets `pointer-events: auto` on each overlay's container. The HoverCard overlay blocked clicks over the player until its container was set to `none` (step 8.2). Hit targets want exactly this behaviour; the card does not.
- **G3. `fs: 0` hides the button, not the `f` key.** With the player focused, `f` made the iframe fullscreen with `fs: 0`. The guard exits it (16–17 ms). The stage cannot take over fullscreen from the handler, which has no user activation. `disablekb: 1` would also remove the player's other keys.
- **G4. Keyboard focus lands in the player.** After a click on the video, key presses go to the iframe: YouTube's own keys work, and the app's shortcuts (Space, arrows, L, C) do nothing until focus returns to the page. Tests press app keys only after focusing the page.
- **G5. The player needs `setSize`.** The iframe keeps the size it was created with. In a 1440 × 900 fullscreen stage it stayed 960 × 540 until `setSize(1440, 900)`, while the map filled the screen.
- **G6. Letterboxing must match.** The player contains the video (rows 45–854 of a 1440 × 900 stage). The map must contain the frame the same way: a view with an `extent` and `constrainOnlyCenter: false` fits by cover and misaligns by 80 px per side there.
- **G7. Headless Escape does not leave fullscreen.** Use `document.exitFullscreen()` in tests; real browsers exit on Esc.
- **G8. YouTube latency only grows.** A 10 s pause added 11.5 s, and stalls added their full length. `Date.now() − delay` is then 10–50° wrong near culmination. `getCurrentTime()` deltas tracked every change to within 0.5 s (`verification/architecture.md` claim 21). Hence the media clock.
- **G9. `getCurrentTime()` is not a raw value.** While PLAYING the widget returns the last reported time plus up to 1 s of wall-clock extrapolation (`www-widgetapi.js`). Before the live position is known it returned 0, and once null. Anchor only on PLAYING with a finite value above 0.
- **G10. Error 150 also means "this id is dead".** The ended stream `qh6Nqiq6LIg` and a nonexistent id both gave 150. Live ids change when a stream restarts (`verification/sources.md` claim 2). Re-resolve once before showing the blocked state.
- **G11. Only the github.io resolvers work at runtime.** `naoj.org/PIO/LiveCam/cam_redirect.html` is a JavaScript redirect with no CORS. `embed/live_stream?channel=` picks any of the channel's concurrent streams (`verification/sources.md` claim 4). The resolver pages are cached for 600 s.
- **G12. The API swaps the host element.** Its iframe replaces the element passed in, and `destroy()` restores it. A React-owned host breaks reconciliation.
- **G13. A negative k1 folds far points back into the frame.** With the settled Subaru model (k1 −0.00992), the ISS at az 172.11°, alt 18.99° (15:08:08Z, 84.51° off the axis) has unit radius r = 10.41. So s = 1 + k1 r² = −0.0753, and without M4's cull (r > 1.05 × 0.87885 = 0.9228) the point lands at (49, 1724), inside the frame. Every projection path must go through `projectAzAltDeg`'s cull, including `frameSpans` and the hit targets.
- **G14. The delay varies a lot.**
  - The verification measured 43–60 s at first play and 22.7 s at the live head (`verification/sources.md` claim 10).
  - `getMediaReferenceTime` gave 17.8, 19.9 and 20.7 s at the first PLAYING in three sessions.
  - The 50 s default is only a starting point: calibrate each session. The undocumented suggestion is the fastest check when present.
- **G15. Referer.** Error 153 means no Referer. The API sets `referrerpolicy="strict-origin-when-cross-origin"` on its own iframe, so a page served with `Referrer-Policy: no-referrer` still played. Keep M0's header rule anyway.
- **G16. `playbackRate` stops at 16** (`verification/architecture.md` claim 5). Offer only 1× and 10× with a clip, and wrap the assignment in `try/catch`.
- **G17. No frame callbacks while paused.** After a paused seek Chromium 156 delivered one callback (media time 2.0), but other engines may not. Redraw on `seeked` as well, and scrub by setting `currentTime` (`verification/architecture.md` claim 5).
- **G18. `ImageCanvas` caches.** It redraws only after `changed()`, and its default `ratio` 1.5 builds a canvas 1.5 × the viewport every frame (`verification/openlayers.md` claim 21).
- **G19. Keep the background layer `ImageLayer<ImageSource>`.** `ImageLayer<ImageStatic>` plus `ImageCanvasSource` is TS2739, and an `ImageLayer<ImageSource>` passed to a parameter typed `ImageLayer<ImageStatic>` is TS2345.
- **G20. The map canvas is CSS-scaled.** At a device pixel ratio other than 1, OpenLayers sizes its canvas in device pixels and shrinks it with a CSS transform, so `canvas.clientWidth` equals `canvas.width`. Convert CSS px to canvas px with `canvas.width / canvas.getBoundingClientRect().width`.
- **G21. Failed fetches log console errors.** Both a 404 and an aborted request log "Failed to load resource", which fails the shared e2e fixture. Playwright-fulfilled responses load even without CORS headers ([M4](M4-camera-model.md) G11).
- **G22. Chromium cannot play MPEG-TS, and the extension lies.** An interrupted yt-dlp recording stays MPEG-TS under an `.mp4` name (`ffmpeg -i` reports `mpegts`). Always remux with `-c copy -movflags +faststart`.
- **G23. yt-dlp cannot cut a live DVR window.** `--download-sections` fails on the live-from-start DASH formats and silently records the live edge on HLS. Use the playlist's segments (step 17).
- **G24. The DVR holds one hour, and its URLs expire and identify you.** Cut a pass within about 60 min. Playlist and segment URLs last about 6 h and carry the client's IP. `record-clip.ts` keeps them in memory only; the hand procedure keeps them in a scratch directory outside the repository and deletes it. Never log or commit them.
- **G25. `file://` taints the canvas.** A page opened from `file://` cannot read video pixels (`SecurityError`); object URLs and `npm run dev` over http can.
- **G26. Old elements look like a clock error.** A start-time error, a stream-delay error and an old element set all shift a satellite along its track. On 2026-10-11 a 40-h ISS set lagged 0.88 s (a mean along-track error of 7.7 px at 1080p, up to about 0.5°) while the clock was right. Fix the start time from a clock; use satellites only to check it with elements under a day old (Recording a clip, step 6).
- **G27. Starlink element sets are worse.** On the clip, 23 tracks matched 20 Starlink satellites at ≤ 2.6 px rms with the star calibration, but each needed its own time shift: −16.3 to +7.8 s, median +0.27 s, only 7 within 1 s. That is against the 2026-10-11T03:50Z snapshot. A bright object 60 s behind the ISS matched CYGNUS NG-24 (68689) only after a 34 s shift. Do not use these for timing.

## 8. Decisions to append to `docs/DECISIONS.md`

`DECISIONS.md` already holds the YouTube anchor rule and O1/O2 themselves. Its section "Revisions for O1, O2, O4 and H1" also holds M5's lines on pass-through and hit targets, `fs: 0` and the fullscreen guard, the content box, the settled Subaru defaults, the StarCam `termsNote`, the clip sidecar, `record-clip.ts`, the `find-passes` window, the scripted acceptance and `satelliteCheckSummary`'s hidden stretches; do not append those again. Append the rest.

- Clip cameras load a `ClipSidecar` from `sidecarUrl` on activation; anything that is not JSON means "not part of this build". `local-replay` takes picked files and needs the sidecar. Reason: `vite preview` and `npm run dev` answer `index.html` (200) for a missing file and GitHub Pages answers 404, and either means the clip is absent; a clip without a clock-derived start has no time.
- The ISS track on the 2026-10-11 clip is committed as a fixture (numbers only); the clip is not. Reason: the acceptance must be repeatable; recordings stay local.
- The UI shows the delay plus the stall as "behind real time now". A rebuffer of ≥ 1 s shows a "check the delay" prompt; the delay is never changed automatically; `getMediaReferenceTime` is only a suggestion with an Apply button. Reason: DECISIONS "Live clock".
- On error 100, 101 or 150, or on ENDED, the id is re-resolved once with `cache: "no-cache"` before giving up. Errors 101, 150 and 153 set `embed-blocked` and `offline`, switch to replay, destroy the player, and offer "Watch on YouTube", the camera's recorded clips and "Replay a local clip". Reason: dead and nonexistent ids report 150, and live ids change on restart.
- The player is muted with `mute()` in `onReady` and autoplays at most once per player, when the stage is more than half visible. Reason: a hidden page does not start the stream, and a user's pause sticks.
- A burned-in clock reading gets +500 ms. Reason: the clock shows whole seconds.
- Star pairs are off for YouTube cameras. Pointing comes from the defaults, alignment by eye against the video, or "Copy pointing" from a clip of the same camera. Reason: clicks on the video belong to the player.
- A local clip plays in a detached, muted `<video>`, drawn by `ImageCanvas` (`ratio: 1`) after each frame callback and each `seeked`. The video is the master clock. A change of `simTimeMs` that the loop did not write seeks the video. Reason: frame and overlay come from the same media time.
- With a clip, the rates are 1× and 10× only. Clips are at most 12 h, and loading one calls `recenter(startUtcMs)`. Reason: `playbackRate` ≤ 16; the ± 12 h scrubber.
- `cfht-starcam` defaults (az 270°, alt 20°, f 2742 px, the CFHT site, mast 0 until M6 sets 33) are guesses until aligned. Record the aligned values.
