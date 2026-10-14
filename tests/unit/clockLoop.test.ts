import type OlMap from "ol/Map";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registry } from "../../src/map/registry";
import {
  type FrameScheduler,
  frameCount,
  type LocalMediaClock,
  registerFrameUpdater,
  setMediaClock,
  startClockLoop,
  type YoutubeMediaClock,
} from "../../src/state/clockLoop";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig, ClockRate } from "../../src/state/types";
import { M5_CAMERA_ENTRIES } from "../helpers/m5Cameras";
import { storeAt, TEST_CAMERA_ID } from "../helpers/store";

const T0 = Date.UTC(2026, 9, 11, 3, 20, 0); // 2026-10-11T03:20:00Z

/** Like requestAnimationFrame: at most one pending callback. frame(wallMs) runs it. */
class ManualScheduler implements FrameScheduler {
  private pending: ((wallMs: number) => void) | null = null;
  private pendingHandle = 0;
  private lastHandle = 0;

  request(callback: (wallMs: number) => void): number {
    if (this.pending !== null) throw new Error("a frame is already pending");
    this.pending = callback;
    this.lastHandle += 1;
    this.pendingHandle = this.lastHandle;
    return this.pendingHandle;
  }

  cancel(handle: number): void {
    if (handle === this.pendingHandle) this.pending = null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  frame(wallMs: number): void {
    const callback = this.pending;
    if (callback === null) throw new Error("no frame is pending");
    this.pending = null;
    callback(wallMs);
  }
}

// Every stop(), unregister and unsubscribe a test creates: the loop and the updater set are module state.
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  registry.clear();
});

function start(store: AppStore, scheduler: FrameScheduler): void {
  cleanups.push(startClockLoop(store, scheduler));
}

function register(fn: (simTimeMs: number) => void): () => void {
  const unregister = registerFrameUpdater(fn);
  cleanups.push(unregister);
  return unregister;
}

function playingStore(rate: ClockRate): AppStore {
  const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
  store.setState((s) => ({ clock: { ...s.clock, rate, playing: true } }));
  return store;
}

function recordTicks(store: AppStore): number[] {
  const ticks: number[] = [];
  cleanups.push(
    store.subscribe(
      (s) => s.clock.simTimeMs,
      (simTimeMs) => ticks.push(simTimeMs),
    ),
  );
  return ticks;
}

describe("clockLoop", () => {
  it("does not tick while paused", () => {
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    const ticks = recordTicks(store);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    for (let i = 0; i < 10; i += 1) scheduler.frame(1_000 + 16 * i);
    expect(ticks).toEqual([]);
    expect(store.getState().clock.simTimeMs).toBe(T0);
  });

  it("first frame has delta 0", () => {
    const store = playingStore(10);
    const ticks = recordTicks(store);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(1_000);
    scheduler.frame(1_016);
    scheduler.frame(1_032);
    expect(ticks).toEqual([T0 + 160, T0 + 320]);
  });

  it("background-tab gap", () => {
    const store = playingStore(600);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    scheduler.frame(3_600_000);
    expect(store.getState().clock.simTimeMs).toBe(T0 + 150_000);
  });

  it("stops at +12 h and pauses", () => {
    const store = playingStore(600);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    for (let i = 0; i < 300; i += 1) scheduler.frame(250 * i);
    const { clock } = store.getState();
    expect(clock.simTimeMs).toBe(T0 + 43_200_000);
    expect(clock.playing).toBe(false);
  });

  it("frame updaters", () => {
    const store = playingStore(1);
    const scheduler = new ManualScheduler();
    const calls: string[] = [];
    const unregisterA = register((simTimeMs) => calls.push(`a:${simTimeMs - T0}`));
    register((simTimeMs) => calls.push(`b:${simTimeMs - T0}`));
    start(store, scheduler);
    scheduler.frame(0);
    scheduler.frame(16);
    unregisterA();
    scheduler.frame(32);
    expect(calls).toEqual(["a:0", "b:0", "a:16", "b:16", "b:32"]);
  });

  it("throwing updater", () => {
    const store = playingStore(1);
    const scheduler = new ManualScheduler();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    register(() => {
      calls += 1;
      throw new Error("updater failed");
    });
    start(store, scheduler);
    scheduler.frame(0);
    scheduler.frame(16);
    scheduler.frame(32);
    expect(calls).toBe(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(store.getState().clock.simTimeMs).toBe(T0 + 32);
  });

  it("stop()", () => {
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    const first = new ManualScheduler();
    const stopFirst = startClockLoop(store, first);
    cleanups.push(stopFirst);
    expect(first.hasPending).toBe(true);
    stopFirst();
    expect(first.hasPending).toBe(false);

    const second = new ManualScheduler();
    start(store, second);
    stopFirst(); // a stale stop() must not clear `running` for the newer loop
    expect(second.hasPending).toBe(true);
    expect(() => startClockLoop(store, new ManualScheduler())).toThrow(
      "clockLoop is already running",
    );
  });

  it("second loop", () => {
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    start(store, new ManualScheduler());
    expect(() => startClockLoop(store, new ManualScheduler())).toThrow(
      "clockLoop is already running",
    );
  });
});

describe("clockLoop, M1", () => {
  it("live on a synthetic camera follows Date.now() and recentres past ±12 h", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const store = storeAt(new Date(T0).toISOString());
    store.getState().actions.setMode("live");
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    vi.setSystemTime(T0 + 1_234);
    scheduler.frame(0);
    expect(store.getState().clock.simTimeMs).toBe(Date.now());
    vi.setSystemTime(T0 + 43_200_000);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(T0 + 43_200_000);
    expect(store.getState().clock.rangeCenterMs).toBe(T0);
    vi.setSystemTime(T0 + 43_200_001);
    scheduler.frame(32);
    const { clock } = store.getState();
    expect(clock.simTimeMs).toBe(T0 + 43_200_001);
    expect(clock.rangeCenterMs).toBe(T0 + 43_200_001);
    expect(clock.mode).toBe("live");
  });

  it("live before the registry loads also follows Date.now()", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0 + 5_000);
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    store.getState().actions.setMode("live");
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    expect(store.getState().clock.simTimeMs).toBe(T0 + 5_000);
  });

  it("renderSyncAll runs only on frames where the sim time changed", () => {
    let renders = 0;
    registry.set("ground", {
      renderSync: () => {
        renders += 1;
      },
    } as unknown as OlMap);
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    for (let i = 0; i < 10; i += 1) scheduler.frame(16 * i);
    expect(renders).toBe(0);
    store.getState().actions.play();
    for (let i = 10; i < 20; i += 1) scheduler.frame(16 * i);
    expect(renders).toBe(10);
    store.getState().actions.pause();
    store.getState().actions.stepBy(1_000); // a step while paused: one render on the next frame
    for (let i = 20; i < 25; i += 1) scheduler.frame(16 * i);
    expect(renders).toBe(11);
  });
});

describe("clockLoop, M4", () => {
  it("live on a still-image camera follows frameTimeMs, and Date.now() before the first image", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const store = storeAt(new Date(T0).toISOString());
    const { actions } = store.getState();
    actions.setActiveCamera("cfht-nanaao");
    actions.setMode("live");
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    vi.setSystemTime(T0 + 1_234);
    scheduler.frame(0);
    expect(store.getState().camera.frameTimeMs).toBeNull();
    expect(store.getState().clock.simTimeMs).toBe(T0 + 1_234); // no image yet: the sky shows now

    const capturedMs = T0 + 1_234 - 40_000; // load time − captureLagMs
    store.getState().actions.setFrameTimeMs(capturedMs);
    vi.setSystemTime(T0 + 5_000);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(capturedMs);
    vi.setSystemTime(T0 + 9_000); // the wall clock runs on; the sky stays at the image's capture time
    scheduler.frame(32);
    expect(store.getState().clock.simTimeMs).toBe(capturedMs);
    expect(store.getState().clock.mode).toBe("live");
  });

  it("a capture time more than 12 h from now clamps to the range edge without recentring every frame", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const store = storeAt(new Date(T0).toISOString());
    const { actions } = store.getState();
    actions.setActiveCamera("cfht-nanaao");
    actions.setMode("live");
    actions.setFrameTimeMs(T0 - 86_400_000); // a burned-in stamp entered with yesterday's date
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    let writes = 0;
    const unsubscribe = store.subscribe(() => {
      writes += 1;
    });
    for (let i = 0; i < 10; i += 1) scheduler.frame(16 * i);
    unsubscribe();
    const { clock } = store.getState();
    expect(clock.rangeCenterMs).toBe(T0);
    expect(clock.simTimeMs).toBe(T0 - 43_200_000);
    expect(writes).toBe(1); // the first tick only
  });

  it("replay on a still-image camera still advances from simTimeMs, not frameTimeMs", () => {
    const store = storeAt(new Date(T0).toISOString());
    const { actions } = store.getState();
    actions.setActiveCamera("cfht-nanaao");
    actions.setFrameTimeMs(T0 - 600_000);
    actions.setMode("replay");
    actions.setRate(10);
    actions.play();
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    const before = store.getState().clock.simTimeMs;
    scheduler.frame(0);
    scheduler.frame(100);
    expect(store.getState().clock.simTimeMs).toBe(before + 1_000);
  });
});

describe("clockLoop, M3", () => {
  it("frameCount() counts frame callbacks, incremented before the tick and the updaters", () => {
    const store = playingStore(1);
    const scheduler = new ManualScheduler();
    const start0 = frameCount();
    const seenByUpdater: number[] = [];
    const seenByTick: number[] = [];
    register(() => seenByUpdater.push(frameCount() - start0));
    cleanups.push(
      store.subscribe(
        (s) => s.clock.simTimeMs,
        () => seenByTick.push(frameCount() - start0),
      ),
    );
    start(store, scheduler);
    expect(frameCount()).toBe(start0); // nothing before the first frame callback
    scheduler.frame(0);
    scheduler.frame(16);
    scheduler.frame(32);
    expect(frameCount() - start0).toBe(3);
    expect(seenByUpdater).toEqual([1, 2, 3]);
    expect(seenByTick).toEqual([2, 3]); // the first frame has delta 0: no tick
  });

  it("frameCount() also counts paused frames and frames whose updater threw", () => {
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    const scheduler = new ManualScheduler();
    vi.spyOn(console, "error").mockImplementation(() => {});
    register(() => {
      throw new Error("updater failed");
    });
    const start0 = frameCount();
    start(store, scheduler);
    for (let i = 0; i < 5; i += 1) scheduler.frame(16 * i);
    expect(frameCount() - start0).toBe(5);
  });

  it("frameCount() never goes back when a loop stops and a new one starts", () => {
    const store = createAppStore(initialState(T0, TEST_CAMERA_ID));
    const first = new ManualScheduler();
    const stopFirst = startClockLoop(store, first);
    cleanups.push(stopFirst);
    first.frame(0);
    const afterFirst = frameCount();
    stopFirst();
    const second = new ManualScheduler();
    start(store, second);
    second.frame(0);
    expect(frameCount()).toBe(afterFirst + 1);
  });
});

describe("clockLoop, M5 live YouTube (media clock)", () => {
  const T = Date.parse("2026-10-11T08:00:00Z"); // anchor wall time
  const A_MEDIA = 4_399_105.5; // anchor media time

  /** A fake YoutubeMediaClock: the anchor and the media time are set by the test. */
  function fakePlayer() {
    let media: number | null = null;
    let anchor: { wallMs: number; mediaSec: number } | null = null;
    const clock: YoutubeMediaClock = {
      kind: "youtube",
      mediaSec: () => media,
      anchor: () => anchor,
      mediaReferenceTimeMs: () => null,
    };
    return {
      clock,
      setMedia: (sec: number | null): void => {
        media = sec;
      },
      setAnchor: (a: { wallMs: number; mediaSec: number } | null): void => {
        anchor = a;
      },
    };
  }

  /** Live on subaru-starcam (delay 50,000 ms), at T. */
  function youtubeStore(): AppStore {
    const store = createAppStore(initialState(T, TEST_CAMERA_ID));
    const registry: Record<string, CameraConfig> = {};
    for (const entry of M5_CAMERA_ENTRIES)
      registry[entry.id] = structuredClone(entry) as CameraConfig;
    store.getState().actions.setRegistry(registry);
    store.getState().actions.setActiveCamera("subaru-starcam");
    store.getState().actions.setMode("live");
    return store;
  }

  function registerClock(clock: YoutubeMediaClock | null): void {
    setMediaClock(clock);
    cleanups.push(() => setMediaClock(null));
  }

  it("without a media clock, or before the anchor, the sky shows now − delay", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const store = youtubeStore();
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    expect(store.getState().clock.simTimeMs).toBe(T - 50_000);
    const { clock, setMedia } = fakePlayer();
    registerClock(clock);
    setMedia(0); // the real player reports 0 before it plays (G9)
    vi.setSystemTime(T + 1_000);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(T + 1_000 - 50_000);
  });

  it("follows the anchored media clock: T + 30 s with media + 20.25 s gives T − 29,750", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T + 30_000);
    const store = youtubeStore();
    const { clock, setMedia, setAnchor } = fakePlayer();
    setAnchor({ wallMs: T, mediaSec: A_MEDIA });
    setMedia(4_399_125.75);
    registerClock(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    expect(store.getState().clock.simTimeMs).toBe(T - 29_750);
    // A paused or buffering player holds its media time: the sky freezes, whatever the wall clock does.
    vi.setSystemTime(T + 40_000);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(T - 29_750);
  });

  it("a null media time skips the tick", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T + 30_000);
    const store = youtubeStore();
    const { clock, setMedia, setAnchor } = fakePlayer();
    setAnchor({ wallMs: T, mediaSec: A_MEDIA });
    setMedia(4_399_125.75);
    registerClock(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    const ticks = recordTicks(store);
    setMedia(null);
    scheduler.frame(16);
    scheduler.frame(32);
    expect(ticks).toEqual([]);
    expect(store.getState().clock.simTimeMs).toBe(T - 29_750);
  });

  it("a new delay moves the sky at once: delay 30,000 gives T − 9,750", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T + 30_000);
    const store = youtubeStore();
    const { clock, setMedia, setAnchor } = fakePlayer();
    setAnchor({ wallMs: T, mediaSec: A_MEDIA });
    setMedia(4_399_125.75);
    registerClock(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    store.getState().actions.setStreamDelayMs(30_000);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(T - 9_750);
  });

  it("replay ignores the player; setMediaClock(null) brings back M0's replay branch", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T + 30_000);
    const store = youtubeStore();
    const { clock, setMedia, setAnchor } = fakePlayer();
    setAnchor({ wallMs: T, mediaSec: A_MEDIA });
    setMedia(4_399_125.75);
    registerClock(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    const { actions } = store.getState();
    actions.pause(); // switches to replay, paused
    actions.play();
    scheduler.frame(100);
    expect(store.getState().clock.simTimeMs).toBe(T - 29_750 + 100);
    setMediaClock(null);
    scheduler.frame(200);
    expect(store.getState().clock.simTimeMs).toBe(T - 29_750 + 200);
  });

  it("keeps M1's recentre rule past ± 12 h of the scrubber", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const store = youtubeStore();
    store.getState().actions.recenter(T - 13 * 3_600_000);
    store.getState().actions.setMode("live");
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    expect(store.getState().clock.rangeCenterMs).toBe(T);
    expect(store.getState().clock.simTimeMs).toBe(T - 50_000);
  });
});

describe("clockLoop, M5 local clips (media clocks)", () => {
  const S = Date.parse("2026-10-11T08:00:00Z"); // the clip's startUtcMs

  /** A fake LocalMediaClock on a clip of durationS: seekToSec clamps to [0, durationS] like video.currentTime. */
  function fakeClip(mediaSec: number, durationS = 7) {
    const seeks: number[] = [];
    let media = mediaSec;
    const clock: LocalMediaClock = {
      kind: "local-video",
      startUtcMs: S,
      mediaSec: () => media,
      seekToSec: (sec) => {
        seeks.push(sec);
        media = Math.min(Math.max(sec, 0), durationS);
      },
    };
    const setMedia = (sec: number): void => {
      media = sec;
    };
    return { clock, seeks, setMedia };
  }

  /** A store on local-replay (a local-video camera) at S, plus the synthetic default camera. */
  function clipStore(): AppStore {
    const store = createAppStore(initialState(S, TEST_CAMERA_ID));
    const registry: Record<string, CameraConfig> = {};
    for (const entry of M5_CAMERA_ENTRIES)
      registry[entry.id] = structuredClone(entry) as CameraConfig;
    const synthetic = storeAt(new Date(S).toISOString()).getState().camera.registry[TEST_CAMERA_ID];
    if (synthetic !== undefined) registry[TEST_CAMERA_ID] = synthetic;
    store.getState().actions.setRegistry(registry);
    store.getState().actions.setActiveCamera("local-replay");
    return store;
  }

  function register(clock: LocalMediaClock | null): void {
    setMediaClock(clock);
    cleanups.push(() => setMediaClock(null));
  }

  it("the video is the clock: start S, media 2.25 → S + 2,250 on every frame, whatever the rate and wall delta", () => {
    const store = clipStore();
    const { actions } = store.getState();
    actions.setRate(10);
    actions.play();
    const { clock } = fakeClip(2.25);
    register(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    for (const wallMs of [0, 16, 250, 5_000, 5_016]) {
      scheduler.frame(wallMs);
      expect(store.getState().clock.simTimeMs).toBe(S + 2_250);
    }
    actions.setRate(1);
    scheduler.frame(6_000);
    expect(store.getState().clock.simTimeMs).toBe(S + 2_250);
  });

  it("follows the media time as the video plays", () => {
    const store = clipStore();
    const { clock, setMedia, seeks } = fakeClip(0);
    register(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    expect(store.getState().clock.simTimeMs).toBe(S);
    setMedia(0.8);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(S + 800);
    setMedia(479.933333);
    scheduler.frame(32);
    expect(store.getState().clock.simTimeMs).toBeCloseTo(S + 479_933.333, 3);
    expect(seeks).toEqual([]);
  });

  it("seek(S + 5,000) → seekToSec(5) once, and the sim time stays S + 5,000", () => {
    const store = clipStore();
    const { clock, seeks } = fakeClip(2.25);
    register(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    store.getState().actions.seek(S + 5_000);
    scheduler.frame(16);
    expect(seeks).toEqual([5]);
    expect(store.getState().clock.simTimeMs).toBe(S + 5_000);
    scheduler.frame(32);
    scheduler.frame(48);
    expect(seeks).toEqual([5]);
    expect(store.getState().clock.simTimeMs).toBe(S + 5_000);
  });

  it("a step, a recentre and a scrub each seek the video once", () => {
    const store = clipStore();
    const { clock, seeks } = fakeClip(2);
    register(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    const { actions } = store.getState();
    actions.stepBy(1_000);
    scheduler.frame(16);
    actions.stepBy(-60_000); // before the clip: the fake clamps to 0
    scheduler.frame(32);
    scheduler.frame(48);
    expect(seeks).toEqual([3, -57]);
    expect(store.getState().clock.simTimeMs).toBe(S);
    actions.recenter(S + 4_000);
    scheduler.frame(64);
    expect(seeks).toEqual([3, -57, 4]);
  });

  it("seek(S + 9,000) on a 7 s clip → seekToSec(9), then the next frame reads the clamped end, S + 7,000", () => {
    const store = clipStore();
    const { clock, seeks } = fakeClip(2.25, 7);
    register(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    store.getState().actions.seek(S + 9_000);
    scheduler.frame(16);
    expect(seeks).toEqual([9]);
    expect(store.getState().clock.simTimeMs).toBe(S + 9_000);
    scheduler.frame(32);
    expect(store.getState().clock.simTimeMs).toBe(S + 7_000);
    expect(seeks).toEqual([9]);
  });

  it("the first frame after setMediaClock reads the video, even when the store's time differs", () => {
    const store = clipStore();
    store.getState().actions.seek(S + 3_000);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0); // no clip yet: no tick
    expect(store.getState().clock.simTimeMs).toBe(S + 3_000);
    const { clock, seeks } = fakeClip(1.5);
    register(clock);
    scheduler.frame(16);
    expect(store.getState().clock.simTimeMs).toBe(S + 1_500);
    expect(seeks).toEqual([]);
  });

  it("[Redesign] setMediaClock with the time the clip was seeked to: a step before the next frame seeks the video", () => {
    const store = clipStore();
    store.getState().actions.seek(S + 3_000);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    const { clock, seeks } = fakeClip(3);
    setMediaClock(clock, S + 3_000); // as bindBackground's loadeddata, after its seek to the store's time
    cleanups.push(() => setMediaClock(null));
    store.getState().actions.stepBy(2_000); // a key press between loadeddata and the loop's next frame
    scheduler.frame(16);
    expect(seeks).toEqual([5]);
    expect(store.getState().clock.simTimeMs).toBe(S + 5_000);
    // Without a step, the video wins as before.
    scheduler.frame(32);
    expect(store.getState().clock.simTimeMs).toBe(S + 5_000);
  });

  it("no local clock on a local-video camera → no tick, even playing at 10×; advanceReplayMs never runs", () => {
    const store = clipStore();
    const { actions } = store.getState();
    actions.setRate(10);
    actions.play();
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    const ticks = recordTicks(store);
    for (let i = 0; i < 5; i += 1) scheduler.frame(100 * i);
    expect(ticks).toEqual([]);
    expect(store.getState().clock.simTimeMs).toBe(S);
  });

  it("setMediaClock(null) on a synthetic camera → M0's replay branch again", () => {
    const store = clipStore();
    const { clock } = fakeClip(2.25);
    register(clock);
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    expect(store.getState().clock.simTimeMs).toBe(S + 2_250);
    setMediaClock(null);
    const { actions } = store.getState();
    actions.setActiveCamera(TEST_CAMERA_ID);
    actions.setRate(10);
    actions.play();
    scheduler.frame(100);
    scheduler.frame(200);
    expect(store.getState().clock.simTimeMs).toBe(S + 2_250 + 2 * 1_000); // 100 ms × 10 per frame
  });

  it("a clip clock left registered does not drive a synthetic camera", () => {
    const store = clipStore();
    const { clock, seeks } = fakeClip(2.25);
    register(clock);
    const { actions } = store.getState();
    actions.setActiveCamera(TEST_CAMERA_ID);
    actions.play();
    const scheduler = new ManualScheduler();
    start(store, scheduler);
    scheduler.frame(0);
    scheduler.frame(100);
    expect(store.getState().clock.simTimeMs).toBe(S + 100);
    expect(seeks).toEqual([]);
  });
});

describe("clockLoop, M9", () => {
  it("measures overhead:frame from the start of each frame callback, after the updaters, and clears it", () => {
    const calls: string[] = [];
    const measure = vi.spyOn(performance, "measure").mockImplementation((name) => {
      calls.push(`measure ${name}`);
      return undefined as unknown as PerformanceMeasure;
    });
    const clear = vi.spyOn(performance, "clearMeasures").mockImplementation((name) => {
      calls.push(`clear ${name}`);
    });
    const scheduler = new ManualScheduler();
    start(playingStore(60), scheduler);
    register(() => calls.push("updater"));
    const before = performance.now();
    scheduler.frame(0);
    expect(calls).toEqual(["updater", "measure overhead:frame", "clear overhead:frame"]);
    const options = measure.mock.calls[0]?.[1];
    const startMs =
      typeof options === "object" && options !== null && "start" in options ? options.start : null;
    expect(typeof startMs).toBe("number");
    expect(Number(startMs)).toBeGreaterThanOrEqual(before);
    // A throwing updater still ends the measure, and the next frame is still scheduled.
    register(() => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    scheduler.frame(16);
    expect(measure).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledWith("overhead:frame");
    expect(scheduler.hasPending).toBe(true);
  });
});
