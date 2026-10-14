// tests/unit/youtube.test.ts — M5 section 5: the resolver page parser, the resolver, the status mappers, and the
// pure steps of the live clock (anchor, rebuffer prompt); and the player lifecycle (mountYoutubePlayer, step 5) with a
// fake IFrame API and fake observers. The real loader and the DOM are covered by the e2e spec.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mediaReferenceTimeMs,
  mountYoutubePlayer,
  nextYoutubeAnchor,
  parseYoutubeIdFromHtml,
  REBUFFER_PROMPT_MIN_MS,
  REBUFFER_WATCH_START,
  type RebufferWatch,
  resolveYoutubeVideoId,
  videoStatusForYtError,
  videoStatusForYtState,
  watchRebuffer,
  type YoutubePlayerEnv,
  YT_IFRAME_API_URL,
  type YtNamespace,
  type YtPlayer,
  type YtPlayerOptions,
} from "../../src/app/youtube";
import { getMediaClock, setMediaClock } from "../../src/state/clockLoop";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig, VideoState, YoutubeCamera } from "../../src/state/types";
import { M5_CAMERA_ENTRIES } from "../helpers/m5Cameras";
import { TEST_CAMERA_ID } from "../helpers/store";

/** The resolver page markup fetched from astroasahi.github.io on 2026-10-11, with its link replaced. */
const page = (url: string): string =>
  `<!DOCTYPE html>\n<html>\n<head>\n<meta http-equiv="refresh" content="0; url=${url}">\n<title>Redirecting...</title>\n</head>\n<body>\nRedirecting...\n</body>\n</html>\n`;

const fixtureHtml = readFileSync(
  new URL("../fixtures/youtube/astroasahi.html", import.meta.url),
  "utf8",
);

describe("parseYoutubeIdFromHtml", () => {
  it("reads both link forms the four resolver pages used on 2026-10-11", () => {
    // maunakea_east, maunakea_west, alma, kiso (M5 step 4.2).
    expect(parseYoutubeIdFromHtml(page("https://youtu.be/Kj5DjRYkzD8"))).toBe("Kj5DjRYkzD8");
    expect(parseYoutubeIdFromHtml(page("https://youtu.be/Q3UhCgsWDw8"))).toBe("Q3UhCgsWDw8");
    expect(parseYoutubeIdFromHtml(page("https://youtube.com/live/BVKRAzTSnB0"))).toBe(
      "BVKRAzTSnB0",
    );
    expect(parseYoutubeIdFromHtml(page("https://youtu.be/_HZDjlfTuvQ"))).toBe("_HZDjlfTuvQ");
  });

  it("reads the committed fixture page, the real markup with the id Fixture0001", () => {
    expect(fixtureHtml).toContain("<title>Redirecting...</title>");
    expect(parseYoutubeIdFromHtml(fixtureHtml)).toBe("Fixture0001");
  });

  it("reads watch?v= links with other query parameters before or after the id", () => {
    expect(parseYoutubeIdFromHtml(page("https://www.youtube.com/watch?v=Kj5DjRYkzD8&t=0s"))).toBe(
      "Kj5DjRYkzD8",
    );
    expect(
      parseYoutubeIdFromHtml(page("https://www.youtube.com/watch?feature=share&v=Q3UhCgsWDw8")),
    ).toBe("Q3UhCgsWDw8");
  });

  it("accepts content before http-equiv, single-quoted URLs and any letter case", () => {
    expect(
      parseYoutubeIdFromHtml(
        `<META CONTENT="0; URL='https://youtu.be/Kj5DjRYkzD8'" HTTP-EQUIV="Refresh">`,
      ),
    ).toBe("Kj5DjRYkzD8");
    expect(
      parseYoutubeIdFromHtml(
        `<meta http-equiv='refresh' content='5;url=https://youtu.be/Q3UhCgsWDw8'>`,
      ),
    ).toBe("Q3UhCgsWDw8");
  });

  it("gives null for ids of the wrong length, links outside a meta refresh, and pages without one", () => {
    expect(parseYoutubeIdFromHtml(page("https://youtu.be/Kj5DjRYkzD8X"))).toBeNull(); // 12 characters
    expect(parseYoutubeIdFromHtml(page("https://youtu.be/Kj5DjRYkzD"))).toBeNull(); // 10 characters
    expect(parseYoutubeIdFromHtml(page("https://www.youtube.com/watch?v=Kj5DjRYkzD8X"))).toBeNull();
    expect(
      parseYoutubeIdFromHtml(
        `<html><body><a href="https://youtu.be/Kj5DjRYkzD8">Watch</a></body></html>`,
      ),
    ).toBeNull();
    expect(
      parseYoutubeIdFromHtml(`<meta name="description" content="https://youtu.be/Kj5DjRYkzD8">`),
    ).toBeNull();
    expect(parseYoutubeIdFromHtml("<!doctype html><title>Overhead</title>")).toBeNull();
    expect(parseYoutubeIdFromHtml("")).toBeNull();
  });

  it("skips a refresh without a video link and reads the next one", () => {
    const html = `<meta http-equiv="refresh" content="600"><meta http-equiv="refresh" content="0; url=https://youtu.be/Kj5DjRYkzD8">`;
    expect(parseYoutubeIdFromHtml(html)).toBe("Kj5DjRYkzD8");
  });
});

type FetchFn = typeof fetch;
const RESOLVER = "https://astroasahi.github.io/maunakea_east/";
const FALLBACK = "Kj5DjRYkzD8";

/** A fake fetch that records its calls and answers with the given Response. */
function fakeFetch(respond: () => Response | Promise<Response>): {
  fetchFn: FetchFn;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { fetchFn, calls };
}

describe("resolveYoutubeVideoId", () => {
  it("returns the id from a 200 resolver page", async () => {
    const { fetchFn, calls } = fakeFetch(
      () => new Response(fixtureHtml, { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn)).resolves.toEqual({
      id: "Fixture0001",
      source: "resolver",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(RESOLVER);
    expect(calls[0]?.init?.cache).toBe("default");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the cache mode through: the re-resolve after an error uses no-cache", async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response(fixtureHtml));
    await resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn, 5_000, "no-cache");
    expect(calls[0]?.init?.cache).toBe("no-cache");
  });

  it("falls back on a non-OK answer, naming its status", async () => {
    const { fetchFn } = fakeFetch(() => new Response("Not Found", { status: 404 }));
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn)).resolves.toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "resolver HTTP 404",
    });
  });

  it("falls back when the page holds no id", async () => {
    const { fetchFn } = fakeFetch(
      () => new Response("<!doctype html><title>Overhead</title>", { status: 200 }),
    );
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn)).resolves.toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "no video id in resolver page",
    });
  });

  it("falls back with the error's message when fetch throws", async () => {
    const fetchFn: FetchFn = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn)).resolves.toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "Failed to fetch",
    });
    const syncThrow = (() => {
      throw new Error("boom");
    }) as unknown as FetchFn;
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, syncThrow)).resolves.toMatchObject({
      source: "fallback",
      reason: "boom",
    });
  });

  it("falls back without fetching when there is no resolver", async () => {
    const fetchFn = vi.fn<FetchFn>();
    await expect(resolveYoutubeVideoId(null, FALLBACK, fetchFn)).resolves.toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "no resolver",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("times out through the signal, as the real fetch does", async () => {
    // Never answers, but rejects with the signal's reason when it aborts, like the real fetch. A fake that
    // ignored the signal would hang: the timeout works only through the signal.
    const fetchFn: FetchFn = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === null || signal === undefined) return;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const started = performance.now();
    const result = await resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn, 50);
    expect(result).toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "The operation was aborted due to timeout",
    });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("never throws, even when the body cannot be read", async () => {
    const { fetchFn } = fakeFetch(() => {
      const response = new Response("x");
      vi.spyOn(response, "text").mockRejectedValue(new Error("body stream broke"));
      return response;
    });
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, fetchFn)).resolves.toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "body stream broke",
    });
    const rejectsWithString: FetchFn = () => Promise.reject("offline");
    await expect(resolveYoutubeVideoId(RESOLVER, FALLBACK, rejectsWithString)).resolves.toEqual({
      id: FALLBACK,
      source: "fallback",
      reason: "offline",
    });
  });
});

describe("status mappers", () => {
  it("maps player errors: 101, 150 and 153 are embed-blocked, everything else is error", () => {
    expect(videoStatusForYtError(2)).toBe("error");
    expect(videoStatusForYtError(5)).toBe("error");
    expect(videoStatusForYtError(100)).toBe("error");
    expect(videoStatusForYtError(101)).toBe("embed-blocked");
    expect(videoStatusForYtError(150)).toBe("embed-blocked");
    expect(videoStatusForYtError(153)).toBe("embed-blocked");
    expect(videoStatusForYtError(999)).toBe("error");
  });

  it("maps player states", () => {
    expect(videoStatusForYtState(-1)).toBe("loading");
    expect(videoStatusForYtState(0)).toBe("ended");
    expect(videoStatusForYtState(1)).toBe("playing");
    expect(videoStatusForYtState(2)).toBe("paused");
    expect(videoStatusForYtState(3)).toBe("buffering");
    expect(videoStatusForYtState(5)).toBe("paused");
  });

  it("treats an undocumented state as loading", () => {
    expect(videoStatusForYtState(4)).toBe("loading");
    expect(videoStatusForYtState(Number.NaN)).toBe("loading");
  });

  it("loads the documented IFrame API script", () => {
    expect(YT_IFRAME_API_URL).toBe("https://www.youtube.com/iframe_api");
  });
});

/** A player with only the documented methods; extra properties are added per test. */
function stubPlayer(extra: Record<string, unknown> = {}): YtPlayer {
  const player = {
    playVideo() {},
    pauseVideo() {},
    mute() {},
    getCurrentTime: () => 0,
    getPlayerState: () => -1,
    setSize() {},
    getIframe: () => {
      throw new Error("no DOM in unit tests");
    },
    destroy() {},
    ...extra,
  };
  return player as unknown as YtPlayer;
}

describe("mediaReferenceTimeMs", () => {
  it("is null when the undocumented method is absent", () => {
    expect(mediaReferenceTimeMs(stubPlayer())).toBeNull();
  });

  it("converts the method's UTC seconds to ms, called on the player", () => {
    const player = stubPlayer({
      base: 1_791_705_579,
      getMediaReferenceTime(this: { base: number }) {
        return this.base;
      },
    });
    expect(mediaReferenceTimeMs(player)).toBe(1_791_705_579_000);
  });

  it("rejects values that are not UTC seconds, and a method that throws", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      4_399_105.5,
      0,
      "1791705579",
      null,
    ]) {
      expect(mediaReferenceTimeMs(stubPlayer({ getMediaReferenceTime: () => value }))).toBeNull();
    }
    const throwing = stubPlayer({
      getMediaReferenceTime: () => {
        throw new Error("not ready");
      },
    });
    expect(mediaReferenceTimeMs(throwing)).toBeNull();
    expect(mediaReferenceTimeMs(stubPlayer({ getMediaReferenceTime: 1_791_705_579 }))).toBeNull();
  });
});

describe("nextYoutubeAnchor", () => {
  const T = Date.parse("2026-10-11T08:00:00Z");

  it("anchors at the first PLAYING with a finite getCurrentTime() above 0", () => {
    expect(nextYoutubeAnchor(null, 1, 4_419_786.46, T)).toEqual({
      wallMs: T,
      mediaSec: 4_419_786.46,
    });
  });

  it("waits through the early UNSTARTED and BUFFERING events and the 0 or null readings", () => {
    expect(nextYoutubeAnchor(null, -1, 0, T)).toBeNull();
    expect(nextYoutubeAnchor(null, 3, 0, T)).toBeNull();
    expect(nextYoutubeAnchor(null, 3, 4_419_786.46, T)).toBeNull(); // not PLAYING
    expect(nextYoutubeAnchor(null, 1, 0, T)).toBeNull();
    expect(nextYoutubeAnchor(null, 1, null, T)).toBeNull();
    expect(nextYoutubeAnchor(null, 1, Number.NaN, T)).toBeNull();
    expect(nextYoutubeAnchor(null, 1, -2, T)).toBeNull();
    expect(nextYoutubeAnchor(null, 1, "4419786", T)).toBeNull();
  });

  it("keeps the first anchor through later pauses, rebuffers and plays", () => {
    const anchor = { wallMs: T, mediaSec: 4_399_105.5 };
    expect(nextYoutubeAnchor(anchor, 1, 4_399_200, T + 120_000)).toBe(anchor);
    expect(nextYoutubeAnchor(anchor, 2, 4_399_200, T + 120_000)).toBe(anchor);
  });
});

describe("watchRebuffer", () => {
  const T = Date.parse("2026-10-11T08:00:00Z");
  type Status = VideoState["status"];
  /** Feeds a sequence of [status, nowMs] and returns every non-null measurement. */
  const run = (steps: readonly (readonly [Status, number])[]): number[] => {
    let watch: RebufferWatch = REBUFFER_WATCH_START;
    const measured: number[] = [];
    for (const [status, nowMs] of steps) {
      const next = watchRebuffer(watch, status, nowMs);
      watch = next.watch;
      if (next.rebufferMs !== null) measured.push(next.rebufferMs);
    }
    return measured;
  };

  it("measures a rebuffer from entering buffering to the next playing (e2e test 9: 2 s)", () => {
    expect(
      run([
        ["loading", T],
        ["buffering", T + 300],
        ["playing", T + 700],
        ["buffering", T + 30_000],
        ["playing", T + 32_000],
      ]),
    ).toEqual([2_000]);
  });

  it("ignores the start-up buffering and rebuffers shorter than 1 s", () => {
    expect(REBUFFER_PROMPT_MIN_MS).toBe(1_000);
    expect(
      run([
        ["buffering", T],
        ["playing", T + 5_000],
      ]),
    ).toEqual([]);
    expect(
      run([
        ["playing", T],
        ["buffering", T + 1_000],
        ["playing", T + 1_999],
        ["buffering", T + 3_000],
        ["playing", T + 4_000],
      ]),
    ).toEqual([1_000]);
  });

  it("keeps the first mark while buffering repeats, and through a pause, until the next playing", () => {
    expect(
      run([
        ["playing", T],
        ["buffering", T + 1_000],
        ["buffering", T + 2_000],
        ["paused", T + 3_000],
        ["playing", T + 6_000],
      ]),
    ).toEqual([5_000]);
  });

  it("starts over for a new player, an ended stream or an error", () => {
    for (const reset of ["idle", "loading", "ended", "error", "embed-blocked"] as const) {
      expect(
        run([
          ["playing", T],
          ["buffering", T + 1_000],
          [reset, T + 2_000],
          ["buffering", T + 2_500],
          ["playing", T + 9_000],
        ]),
      ).toEqual([]);
    }
  });
});

// ---- mountYoutubePlayer (step 5), with a fake IFrame API and fake observers

/** One fake YT.Player: records its calls; the test fires its events. */
class FakePlayer {
  static created: FakePlayer[] = [];
  readonly calls: string[] = [];
  readonly sizes: [number, number][] = [];
  currentTime: unknown = 0;
  destroyed = false;
  readonly host: HTMLElement;
  readonly options: YtPlayerOptions;
  constructor(host: HTMLElement, options: YtPlayerOptions) {
    this.host = host;
    this.options = options;
    FakePlayer.created.push(this);
  }
  playVideo() {
    this.calls.push("playVideo");
  }
  pauseVideo() {
    this.calls.push("pauseVideo");
  }
  mute() {
    this.calls.push("mute");
  }
  getCurrentTime() {
    return this.currentTime as number;
  }
  getPlayerState() {
    return -1;
  }
  setSize(w: number, h: number) {
    this.sizes.push([w, h]);
  }
  getIframe(): HTMLIFrameElement {
    throw new Error("no DOM in unit tests");
  }
  destroy() {
    this.destroyed = true;
  }
  get api(): YtPlayer {
    return this as unknown as YtPlayer;
  }
  ready() {
    this.options.events?.onReady?.({ target: this.api });
  }
  state(data: number) {
    this.options.events?.onStateChange?.({ target: this.api, data });
  }
  error(data: number) {
    this.options.events?.onError?.({ target: this.api, data });
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const SUBARU_T = Date.parse("2026-10-11T08:00:00Z");

/** A live store on subaru-starcam, a fake wrapper and env, and the mounted player. */
async function mountHarness(
  options: { resolvedId?: string; mayReResolve?: boolean; failApi?: boolean } = {},
) {
  FakePlayer.created = [];
  const store: AppStore = createAppStore(initialState(SUBARU_T, TEST_CAMERA_ID));
  const registry: Record<string, CameraConfig> = {};
  for (const entry of M5_CAMERA_ENTRIES)
    registry[entry.id] = structuredClone(entry) as CameraConfig;
  store.getState().actions.setRegistry(registry);
  store.getState().actions.setActiveCamera("subaru-starcam");
  store.getState().actions.setMode("live");
  const camera = registry["subaru-starcam"] as YoutubeCamera;
  let children: unknown[] = [];
  const wrapper = {
    replaceChildren: (...nodes: unknown[]) => {
      children = nodes;
    },
    getBoundingClientRect: () => ({ width: 960.4, height: 539.6 }),
  } as unknown as HTMLElement;
  const host = { fake: "host" } as unknown as HTMLElement;
  let onSize: (w: number, h: number) => void = () => {};
  let onRatio: (ratio: number) => void = () => {};
  const stopped: string[] = [];
  let nowMs = SUBARU_T;
  const resolve = vi.fn(async (_url: string | null, fallbackId: string) => ({
    id: options.resolvedId ?? fallbackId,
    source: "resolver" as const,
  }));
  const env: Partial<YoutubePlayerEnv> = {
    loadApi: () =>
      options.failApi === true
        ? Promise.reject(new Error("YouTube IFrame API failed to load"))
        : Promise.resolve({ Player: FakePlayer as unknown as YtNamespace["Player"] }),
    createHost: () => host,
    observeSize: (_el, cb) => {
      onSize = cb;
      return () => stopped.push("size");
    },
    observeVisibility: (_el, cb) => {
      onRatio = cb;
      return () => stopped.push("visibility");
    },
    resolve,
    now: () => nowMs,
  };
  const restarts: string[] = [];
  const handle = mountYoutubePlayer(
    wrapper,
    camera,
    "Fixture0001",
    store,
    (id) => restarts.push(id),
    { env, mayReResolve: options.mayReResolve },
  );
  const childrenAtMount = children;
  await flush();
  const player = FakePlayer.created[0];
  return {
    store,
    camera,
    handle,
    player,
    host,
    resolve,
    restarts,
    stopped,
    childrenAtMount,
    children: () => children,
    size: (w: number, h: number) => onSize(w, h),
    ratio: (r: number) => onRatio(r),
    setNow: (ms: number) => {
      nowMs = ms;
    },
    video: () => store.getState().video,
    cameraStatus: () => store.getState().camera.status["subaru-starcam"],
    mode: () => store.getState().clock.mode,
  };
}

describe("mountYoutubePlayer", () => {
  afterEach(() => {
    setMediaClock(null);
    vi.restoreAllMocks();
  });

  it("swaps a host of its own into the wrapper and builds the player with fs 0 and the wrapper's size", async () => {
    const h = await mountHarness();
    expect(h.childrenAtMount).toEqual([h.host]);
    expect(FakePlayer.created).toHaveLength(1);
    expect(h.player?.host).toBe(h.host);
    expect(h.player?.options).toMatchObject({
      videoId: "Fixture0001",
      width: 960,
      height: 540,
      playerVars: { autoplay: 0, playsinline: 1, rel: 0, fs: 0 },
    });
    expect(h.video().status).toBe("loading");
    h.size(1440.4, 899.6);
    expect(h.player?.sizes).toEqual([[1440, 900]]);
  });

  it("mutes on ready and plays once, when more than half of the stage is visible", async () => {
    const h = await mountHarness();
    const player = h.player;
    if (player === undefined) throw new Error("no player");
    h.ratio(0.8);
    expect(player.calls).toEqual([]); // not ready yet
    h.ratio(0.33);
    player.ready();
    expect(player.calls).toEqual(["mute"]);
    h.ratio(0.44);
    h.ratio(0.5);
    expect(player.calls).toEqual(["mute"]);
    h.ratio(0.61);
    expect(player.calls).toEqual(["mute", "playVideo"]);
    h.ratio(0);
    h.ratio(1);
    expect(player.calls).toEqual(["mute", "playVideo"]); // a user's pause sticks
  });

  it("maps states to the status, and anchors at the first PLAYING with a time above 0", async () => {
    const h = await mountHarness();
    const player = h.player;
    if (player === undefined) throw new Error("no player");
    const clock = getMediaClock();
    expect(clock?.kind).toBe("youtube");
    if (clock?.kind !== "youtube") throw new Error("no YouTube clock");
    player.state(-1);
    expect(h.video().status).toBe("loading");
    player.state(3);
    expect(h.video().status).toBe("buffering");
    player.currentTime = 0;
    player.state(1); // the real player reported 0 at first (G9)
    expect(clock.anchor()).toBeNull();
    expect(h.cameraStatus()).toBe("live");
    player.currentTime = null;
    expect(clock.mediaSec()).toBeNull();
    player.currentTime = 4_399_105.5;
    h.setNow(SUBARU_T + 700);
    player.state(1);
    expect(clock.anchor()).toEqual({ wallMs: SUBARU_T + 700, mediaSec: 4_399_105.5 });
    expect(h.video().status).toBe("playing");
    player.state(2);
    expect(h.video().status).toBe("paused");
    player.currentTime = 4_399_200;
    h.setNow(SUBARU_T + 99_000);
    player.state(1);
    expect(clock.anchor()).toEqual({ wallMs: SUBARU_T + 700, mediaSec: 4_399_105.5 });
    expect(clock.mediaSec()).toBe(4_399_200);
    expect(clock.mediaReferenceTimeMs()).toBeNull();
  });

  it("autoplay blocked: paused", async () => {
    const h = await mountHarness();
    h.player?.options.events?.onAutoplayBlocked?.({ target: h.player.api });
    expect(h.video().status).toBe("paused");
  });

  it("errors 101 and 150: re-resolve with no-cache first; the same id falls back to replay", async () => {
    for (const code of [101, 150]) {
      const h = await mountHarness();
      h.player?.error(code);
      expect(h.resolve).toHaveBeenCalledWith(
        "https://astroasahi.github.io/maunakea_east/",
        "Fixture0001",
      );
      expect(h.video().status).not.toBe("embed-blocked"); // still resolving
      await flush();
      expect(h.video()).toEqual({ status: "embed-blocked", errorCode: code });
      expect(h.cameraStatus()).toBe("offline");
      expect(h.mode()).toBe("replay");
      expect(h.restarts).toEqual([]);
      h.handle.destroy();
    }
  });

  it("error 150 with a new id restarts through App, once; the next error gives up at once", async () => {
    const h = await mountHarness({ resolvedId: "Fixture0002" });
    h.player?.error(150);
    await flush();
    expect(h.restarts).toEqual(["Fixture0002"]);
    expect(h.video().status).not.toBe("embed-blocked");
    h.player?.error(150);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.video()).toEqual({ status: "embed-blocked", errorCode: 150 });
  });

  it("after a restart in this activation (mayReResolve false), errors give up without resolving", async () => {
    const h = await mountHarness({ mayReResolve: false, resolvedId: "Fixture0003" });
    h.player?.error(150);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.video()).toEqual({ status: "embed-blocked", errorCode: 150 });
  });

  it("error 100 re-resolves, then reports error; 153 warns and blocks; 2 and 5 report error", async () => {
    const h100 = await mountHarness();
    h100.player?.error(100);
    await flush();
    expect(h100.video()).toEqual({ status: "error", errorCode: 100 });
    h100.handle.destroy();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h153 = await mountHarness();
    h153.player?.error(153);
    expect(h153.resolve).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h153.video()).toEqual({ status: "embed-blocked", errorCode: 153 });
    expect([h153.cameraStatus(), h153.mode()]).toEqual(["offline", "replay"]);
    h153.handle.destroy();

    for (const code of [2, 5]) {
      const h = await mountHarness();
      h.player?.error(code);
      expect(h.resolve).not.toHaveBeenCalled();
      expect(h.video()).toEqual({ status: "error", errorCode: code });
      expect([h.cameraStatus(), h.mode()]).toEqual(["offline", "replay"]);
      h.handle.destroy();
    }
  });

  it("ENDED looks for a new id; with none the camera is offline and the status stays ended", async () => {
    const h = await mountHarness();
    h.player?.state(0);
    expect(h.video().status).toBe("ended");
    expect(h.resolve).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.video().status).toBe("ended");
    expect([h.cameraStatus(), h.mode()]).toEqual(["offline", "replay"]);
    const restarted = await mountHarness({ resolvedId: "Fixture0002" });
    restarted.player?.state(0);
    await flush();
    expect(restarted.restarts).toEqual(["Fixture0002"]);
  });

  it("an IFrame API that fails to load reports error, offline and replay", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await mountHarness({ failApi: true });
    expect(FakePlayer.created).toHaveLength(0);
    expect(h.video()).toEqual({ status: "error", errorCode: null });
    expect([h.cameraStatus(), h.mode()]).toEqual(["offline", "replay"]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("destroy: observers, the media clock (only its own), the player and the wrapper; later events are ignored", async () => {
    const h = await mountHarness({ resolvedId: "Fixture0002" });
    const player = h.player;
    if (player === undefined) throw new Error("no player");
    const clock = getMediaClock();
    player.error(150); // a re-resolve in flight
    h.handle.destroy();
    expect(h.stopped.sort()).toEqual(["size", "visibility"]);
    expect(getMediaClock()).toBeNull();
    expect(player.destroyed).toBe(true);
    expect(h.children()).toEqual([]);
    await flush();
    expect(h.restarts).toEqual([]); // the answer came after destroy
    const status = h.video();
    player.state(1);
    expect(h.video()).toBe(status);
    h.handle.destroy(); // idempotent
    expect(clock).not.toBeNull();

    // Another camera's clock registered meanwhile stays.
    const other = await mountHarness();
    const otherClock = getMediaClock();
    const third = await mountHarness();
    other.handle.destroy();
    expect(getMediaClock()).not.toBe(otherClock);
    expect(getMediaClock()).not.toBeNull();
    third.handle.destroy();
    expect(getMediaClock()).toBeNull();
  });

  it("a mount that is destroyed before the API loads never builds a player (StrictMode)", async () => {
    FakePlayer.created = [];
    const h = await mountHarness();
    expect(FakePlayer.created).toHaveLength(1);
    h.handle.destroy();
    // A second harness, destroyed synchronously after mounting: its loadApi resolves after destroy.
    const store = h.store;
    const wrapper = {
      replaceChildren: () => {},
      getBoundingClientRect: () => ({ width: 1, height: 1 }),
    };
    const handle = mountYoutubePlayer(
      wrapper as unknown as HTMLElement,
      h.camera,
      "Fixture0001",
      store,
      () => {},
      {
        env: {
          loadApi: () =>
            Promise.resolve({ Player: FakePlayer as unknown as YtNamespace["Player"] }),
          createHost: () => ({}) as HTMLElement,
          observeSize: () => () => {},
          observeVisibility: () => () => {},
        },
      },
    );
    handle.destroy();
    await flush();
    expect(FakePlayer.created).toHaveLength(1);
  });
});
