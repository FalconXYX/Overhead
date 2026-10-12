// src/app/youtube.ts — the parts of the YouTube IFrame Player API the app uses (M5 steps 4 and 5): the API types,
// the resolver page parser and the resolver, the status mappers, the undocumented-method probe, the two pure steps of
// the live clock (the anchor and the rebuffer prompt), the IFrame API loader and the player lifecycle
// (mountYoutubePlayer), which registers the YouTube media clock (step 6.1).
import { getMediaClock, setMediaClock, type YoutubeMediaClock } from "../state/clockLoop";
import type { AppStore } from "../state/store";
import type { VideoState, YoutubeCamera } from "../state/types";

type VideoStatus = VideoState["status"];

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

// ---- the video id

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

/** resolveYoutubeVideoId's answer: the resolver's id, or the camera's last known id and why. */
export type ResolvedVideoId =
  | { readonly id: string; readonly source: "resolver" }
  | { readonly id: string; readonly source: "fallback"; readonly reason: string };

/** The message of anything thrown: an Error's (and DOMException's) message, else the value as a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The current live id from a resolver page (a meta refresh served with CORS *). Never throws: a null resolverUrl, a
 * non-OK answer, a page without an id, a thrown fetch and a timeout all give the fallback with a reason. The
 * timeout works only through the signal handed to fetchFn. The re-resolve after an error passes "no-cache",
 * because the pages send cache-control: max-age=600.
 */
export async function resolveYoutubeVideoId(
  resolverUrl: string | null,
  fallbackId: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000,
  cache: RequestCache = "default",
): Promise<ResolvedVideoId> {
  const fallback = (reason: string): ResolvedVideoId => ({
    id: fallbackId,
    source: "fallback",
    reason,
  });
  if (resolverUrl === null) return fallback("no resolver");
  try {
    const response = await fetchFn(resolverUrl, { cache, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return fallback(`resolver HTTP ${response.status}`);
    const id = parseYoutubeIdFromHtml(await response.text());
    return id === null ? fallback("no video id in resolver page") : { id, source: "resolver" };
  } catch (error) {
    // TypeError("Failed to fetch"), or the signal's DOMException: "The operation was aborted due to timeout".
    return fallback(messageOf(error));
  }
}

// ---- status mappers

/** onStateChange data → video.status: −1 loading, 0 ended, 1 playing, 2 and 5 (cued) paused, 3 buffering. */
export function videoStatusForYtState(state: number): VideoStatus {
  switch (state) {
    case 0:
      return "ended";
    case 1:
      return "playing";
    case 2:
    case 5:
      return "paused";
    case 3:
      return "buffering";
    default:
      return "loading"; // −1 (unstarted); YouTube documents no other code
  }
}

/** onError data → video.status: 101 and 150 (embedding disabled, or a dead id) and 153 (no Referer) block the embed. */
export function videoStatusForYtError(code: number): VideoStatus {
  return code === 101 || code === 150 || code === 153 ? "embed-blocked" : "error";
}

/** Undocumented, feature-detected: UTC ms of the frame on screen, or null. Never the only way to set the delay. */
export function mediaReferenceTimeMs(player: YtPlayer): number | null {
  const fn: unknown = Reflect.get(player, "getMediaReferenceTime");
  if (typeof fn !== "function") return null;
  let sec: unknown;
  try {
    sec = fn.call(player);
  } catch {
    return null; // an undocumented method may throw; the readout must not
  }
  return typeof sec === "number" && Number.isFinite(sec) && sec > 1e9 ? sec * 1000 : null;
}

// ---- pure steps of the live clock (DECISIONS "Live clock": stalls tracked through the player's state and
// getCurrentTime() deltas)

/** Where the live clock is anchored: wall time and media time at the first PLAYING. */
export interface YoutubeAnchor {
  readonly wallMs: number;
  readonly mediaSec: number;
}

/**
 * Step 5.6 as a pure step: on PLAYING (state 1), with no anchor yet and getCurrentTime() a finite number above 0,
 * anchor at { wallMs: nowMs, mediaSec }; otherwise keep the anchor as it is (the same object). The real player
 * reported 0, and once null, during the early UNSTARTED and BUFFERING events. A new video id means a new player and
 * so a new anchor: the caller starts again from null.
 */
export function nextYoutubeAnchor(
  anchor: YoutubeAnchor | null,
  playerState: number,
  currentTimeSec: unknown,
  nowMs: number,
): YoutubeAnchor | null {
  if (anchor !== null || playerState !== 1) return anchor;
  if (typeof currentTimeSec !== "number" || !Number.isFinite(currentTimeSec)) return null;
  return currentTimeSec > 0 ? { wallMs: nowMs, mediaSec: currentTimeSec } : null;
}

/** A buffering stretch at least this long earns VideoPanel's "check the delay" prompt (M5 step 7). */
export const REBUFFER_PROMPT_MIN_MS = 1_000;

/** VideoPanel's rebuffer measurement between video.status changes. */
export interface RebufferWatch {
  readonly playedOnce: boolean; // a "playing" was seen since the player started
  readonly bufferingSinceMs: number | null; // when the current rebuffer began, after the first "playing"
}
export const REBUFFER_WATCH_START: RebufferWatch = Object.freeze({
  playedOnce: false,
  bufferingSinceMs: null,
});

/**
 * One video.status change (M5 step 7). Notes nowMs on entering "buffering" after the first "playing" and keeps it
 * until the next "playing", which reports the stretch as rebufferMs when it lasted ≥ REBUFFER_PROMPT_MIN_MS (else
 * null). "idle", "loading", "ended", "error" and "embed-blocked" start over: a new player has no rebuffer yet.
 * "paused" keeps the mark. The delay itself is never changed here.
 */
export function watchRebuffer(
  watch: RebufferWatch,
  status: VideoStatus,
  nowMs: number,
): { watch: RebufferWatch; rebufferMs: number | null } {
  switch (status) {
    case "playing": {
      const since = watch.bufferingSinceMs;
      const rebufferMs = since === null ? null : nowMs - since;
      return {
        watch:
          watch.playedOnce && since === null ? watch : { playedOnce: true, bufferingSinceMs: null },
        rebufferMs: rebufferMs !== null && rebufferMs >= REBUFFER_PROMPT_MIN_MS ? rebufferMs : null,
      };
    }
    case "buffering":
      return {
        watch:
          watch.playedOnce && watch.bufferingSinceMs === null
            ? { playedOnce: true, bufferingSinceMs: nowMs }
            : watch,
        rebufferMs: null,
      };
    case "paused":
      return { watch, rebufferMs: null };
    default:
      return { watch: REBUFFER_WATCH_START, rebufferMs: null };
  }
}

// ---- the IFrame API loader (step 4.4)

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

// ---- the player lifecycle (step 5)

/** The documented player parameters: no autoplay request, inline, no related videos, no fullscreen button (O1). */
export const YT_PLAYER_VARS = { autoplay: 0, playsinline: 1, rel: 0, fs: 0 } as const;
/** The autoplay gate's IntersectionObserver thresholds; playback starts above AUTOPLAY_MIN_VISIBLE (step 5.5). */
export const AUTOPLAY_THRESHOLDS: readonly number[] = [0, 0.25, 0.5, 0.51, 0.75, 1];
export const AUTOPLAY_MIN_VISIBLE = 0.5;
/** Error 153: the embed got no Referer (M0 gotcha 17). */
export const YT_ERROR_NO_REFERER = 153;
/** Errors that may mean "this id is dead" (G10): re-resolve once before giving up. 100 is "not found". */
const RE_RESOLVE_ERRORS: ReadonlySet<number> = new Set([100, 101, 150]);
/** onStateChange codes the lifecycle acts on. */
const YT_ENDED = 0;
const YT_PLAYING = 1;

/** The browser pieces mountYoutubePlayer uses. Unit tests pass fakes; the app uses the defaults. */
export interface YoutubePlayerEnv {
  loadApi(): Promise<YtNamespace>;
  /** The element the API swaps for its iframe: never a React-owned one (G12). */
  createHost(): HTMLElement;
  /** Calls onSize(widthPx, heightPx) now and on every size change of `el`; returns the disconnect. */
  observeSize(el: HTMLElement, onSize: (widthPx: number, heightPx: number) => void): () => void;
  /** Calls onRatio(intersectionRatio) on every threshold crossing of `el`; returns the disconnect. */
  observeVisibility(el: HTMLElement, onRatio: (ratio: number) => void): () => void;
  resolve(resolverUrl: string | null, fallbackId: string): Promise<ResolvedVideoId>;
  now(): number;
}

const browserEnv: YoutubePlayerEnv = {
  loadApi: loadYoutubeIframeApi,
  createHost: () => document.createElement("div"),
  observeSize(el, onSize) {
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect !== undefined) onSize(rect.width, rect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  },
  observeVisibility(el, onRatio) {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) onRatio(entry.intersectionRatio);
      },
      { threshold: [...AUTOPLAY_THRESHOLDS] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  },
  // The re-resolve after an error: the pages send max-age=600, so bypass the cache.
  resolve: (resolverUrl, fallbackId) =>
    resolveYoutubeVideoId(resolverUrl, fallbackId, fetch, 5000, "no-cache"),
  now: () => Date.now(),
};

export interface MountYoutubeOptions {
  /**
   * false after App has already restarted this activation with a new id: errors 100, 101 and 150 and ENDED then give
   * up at once instead of re-resolving (step 5.8, "first time in this activation"). Default true.
   */
  readonly mayReResolve?: boolean;
  readonly env?: Partial<YoutubePlayerEnv>;
}

/**
 * Embeds `videoId` in `wrapper` (the sky stage's player wrapper) and keeps it running: size, the autoplay gate, the
 * status, the anchor and the media clock, and the error table of step 5.8. `onRestart(newId)` hands App a new id
 * found by the re-resolve; App then remounts with it. destroy() tears everything down; the map is never touched.
 */
export function mountYoutubePlayer(
  wrapper: HTMLElement,
  camera: YoutubeCamera,
  videoId: string,
  store: AppStore,
  onRestart: (newId: string) => void,
  options: MountYoutubeOptions = {},
): { destroy(): void } {
  const env: YoutubePlayerEnv = { ...browserEnv, ...options.env };
  const actions = () => store.getState().actions;
  let destroyed = false;
  let player: YtPlayer | null = null;
  let ready = false;
  let playRequested = false; // playVideo() runs at most once per player, so a user's pause sticks
  let visibleRatio = 0;
  let anchor: YoutubeAnchor | null = null;
  let reResolveLeft = options.mayReResolve ?? true;

  // 1. Host: created here, so the API's swap never touches a React-owned element (G12).
  const host = env.createHost();
  wrapper.replaceChildren(host);

  /** getCurrentTime() when it is a finite number; the real player once returned null before playing (G9). */
  const currentTime = (): number | null => {
    let t: unknown = null;
    try {
      t = player?.getCurrentTime();
    } catch {
      return null;
    }
    return typeof t === "number" && Number.isFinite(t) ? t : null;
  };

  // 7. The media clock, registered at once: until the anchor exists the loop shows now − delay.
  const clock: YoutubeMediaClock = {
    kind: "youtube",
    mediaSec: currentTime,
    anchor: () => anchor,
    mediaReferenceTimeMs: () => (player === null ? null : mediaReferenceTimeMs(player)),
  };
  setMediaClock(clock);

  const maybeAutoplay = (): void => {
    if (playRequested || !ready || player === null || !(visibleRatio > AUTOPLAY_MIN_VISIBLE))
      return;
    playRequested = true;
    player.playVideo();
  };

  /** Gives up on this player: the status, the camera offline and replay (README "Sky over video" rule 9). */
  const giveUp = (status: VideoStatus, errorCode: number | null): void => {
    const a = actions();
    a.setVideoStatus(status, errorCode);
    a.setCameraStatus(camera.id, "offline");
    a.setMode("replay");
  };

  /**
   * Error 100, 101 or 150, or ENDED: the first time in this activation, look for a new id (G10). A different id
   * restarts the player through App; the same id (or a failed lookup, which falls back to it) gives up.
   */
  const reResolveOr = (onSameId: () => void): void => {
    if (!reResolveLeft) {
      onSameId();
      return;
    }
    reResolveLeft = false;
    void env.resolve(camera.source.resolverUrl, videoId).then((result) => {
      if (destroyed) return;
      if (result.id !== videoId) onRestart(result.id);
      else onSameId();
    });
  };

  // 3. Size: the iframe keeps its creation size unless told (G5).
  const stopSize = env.observeSize(wrapper, (w, h) => {
    if (player !== null && w > 0 && h > 0) player.setSize(Math.round(w), Math.round(h));
  });
  // 5. The autoplay gate: more than half of the stage visible.
  const stopVisibility = env.observeVisibility(wrapper, (ratio) => {
    visibleRatio = ratio;
    maybeAutoplay();
  });

  actions().setVideoStatus("loading");
  env.loadApi().then(
    (YT) => {
      if (destroyed) return;
      const rect = wrapper.getBoundingClientRect();
      try {
        // 2. Construct; the API adds enablejsapi, origin and widgetid itself.
        player = new YT.Player(host, {
          videoId,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          playerVars: { ...YT_PLAYER_VARS },
          events: {
            // 4. Muted with mute(), never with a player parameter; then the autoplay gate.
            onReady: (e) => {
              if (destroyed) return;
              e.target.mute();
              ready = true;
              maybeAutoplay();
            },
            // 6. Status, live, the anchor; ENDED looks for the stream's new id.
            onStateChange: (e) => {
              if (destroyed) return;
              const a = actions();
              // The anchor first: listeners of the status (VideoPanel's "behind real time") read it.
              if (e.data === YT_PLAYING) {
                anchor = nextYoutubeAnchor(anchor, e.data, currentTime(), env.now());
              }
              a.setVideoStatus(videoStatusForYtState(e.data));
              if (e.data === YT_PLAYING) {
                a.setCameraStatus(camera.id, "live");
              } else if (e.data === YT_ENDED) {
                // A live stream ends when it restarts. With no new id, the camera is offline; "ended" stays.
                reResolveOr(() => {
                  a.setCameraStatus(camera.id, "offline");
                  a.setMode("replay");
                });
              }
            },
            onAutoplayBlocked: () => {
              if (!destroyed) actions().setVideoStatus("paused");
            },
            // 8. The error table.
            onError: (e) => {
              if (destroyed) return;
              const code = e.data;
              if (RE_RESOLVE_ERRORS.has(code)) {
                reResolveOr(() => giveUp(code === 100 ? "error" : "embed-blocked", code));
              } else if (code === YT_ERROR_NO_REFERER) {
                console.warn(
                  "YouTube error 153: the embed got no Referer. Serve the page without Referrer-Policy: no-referrer.",
                );
                giveUp("embed-blocked", code);
              } else {
                giveUp(videoStatusForYtError(code), code); // 2 and 5: VideoPanel offers Retry
              }
            },
          },
        });
      } catch (error) {
        // "Invalid video id" (the registry checks the pattern, so this is a resolver surprise).
        console.error("YouTube player could not start", error);
        giveUp("error", null);
      }
    },
    (error: unknown) => {
      if (destroyed) return;
      console.error("YouTube IFrame API unavailable", error);
      giveUp("error", null);
    },
  );

  return {
    // 9. Observers, the clock (only if still ours), the player, the wrapper's children.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopSize();
      stopVisibility();
      if (getMediaClock() === clock) setMediaClock(null);
      try {
        player?.destroy();
      } catch (error) {
        console.warn("YouTube player destroy failed", error);
      }
      player = null;
      wrapper.replaceChildren();
    },
  };
}
