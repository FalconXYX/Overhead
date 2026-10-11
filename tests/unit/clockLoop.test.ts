import type OlMap from "ol/Map";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registry } from "../../src/map/registry";
import {
  type FrameScheduler,
  registerFrameUpdater,
  startClockLoop,
} from "../../src/state/clockLoop";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { ClockRate } from "../../src/state/types";
import { storeAt } from "../helpers/store";

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
  const store = createAppStore(initialState(T0, DEFAULT_CAMERA_ID));
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
    const store = createAppStore(initialState(T0, DEFAULT_CAMERA_ID));
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
    const store = createAppStore(initialState(T0, DEFAULT_CAMERA_ID));
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
    const store = createAppStore(initialState(T0, DEFAULT_CAMERA_ID));
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
    const store = createAppStore(initialState(T0, DEFAULT_CAMERA_ID));
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
    const store = createAppStore(initialState(T0, DEFAULT_CAMERA_ID));
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
