import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUrlState, startUrlSync, writeUrlState } from "../../src/app/url";
import { storeAt } from "../helpers/store";

const T = 1791603000000; // 2026-10-10T03:30:00Z

afterEach(() => {
  vi.useRealTimers();
});

describe("parseUrlState", () => {
  it("reads cam and a UTC t", () => {
    expect(parseUrlState("?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z")).toEqual({
      cam: "synthetic-maunakea",
      tMs: T,
    });
  });

  it("accepts a leap day", () => {
    expect(parseUrlState("?t=2028-02-29T00:00:00Z").tMs).toBe(Date.UTC(2028, 1, 29));
  });

  it("accepts %3A-encoded colons, minutes-only and milliseconds", () => {
    expect(parseUrlState("?cam=synthetic-maunakea&t=2026-10-10T03%3A30%3A00Z").tMs).toBe(T);
    expect(parseUrlState("?t=2026-10-10T03:30Z").tMs).toBe(T);
    expect(parseUrlState("?t=2026-10-10T03:30:00.123Z").tMs).toBe(T + 123);
  });

  it("rejects anything that is not ISO 8601 UTC ending in Z", () => {
    for (const t of [
      "2026-10-10T03:30:00",
      "2026-10-10",
      "2026-13-45T99:99:00Z",
      "2026-02-30T00:00:00Z", // V8 rolls it to 2026-03-02: never guessed
      "2026-04-31T12:00Z",
      "2026-10-10T24:00:00Z",
      "2026-10-10T03:30:00+00:00",
      "",
    ]) {
      expect(parseUrlState(`?t=${encodeURIComponent(t)}`).tMs, t).toBeNull();
    }
    expect(parseUrlState("").tMs).toBeNull();
    expect(parseUrlState("").cam).toBeNull();
    expect(parseUrlState("?cam=").cam).toBeNull();
  });
});

describe("writeUrlState", () => {
  it("writes t (whole seconds, raw colons) only in replay", () => {
    const store = storeAt("2026-10-10T03:30:00.123Z");
    expect(writeUrlState(store.getState())).toBe("?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z");
    store.getState().actions.setMode("live");
    expect(writeUrlState(store.getState())).toBe("?cam=synthetic-maunakea");
  });
});

describe("startUrlSync", () => {
  it("writes at start, then 250 ms after the last discrete change, never per tick", () => {
    vi.useFakeTimers();
    const store = storeAt("2026-10-10T03:30:00Z");
    const writes: string[] = [];
    const stop = startUrlSync(store, (search) => writes.push(search));
    expect(writes).toEqual(["?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z"]);

    for (let i = 0; i < 30; i += 1) {
      store.getState().actions.stepBy(60_000);
      vi.advanceTimersByTime(100);
    }
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(149);
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual([
      "?cam=synthetic-maunakea&t=2026-10-10T03:30:00Z",
      "?cam=synthetic-maunakea&t=2026-10-10T04:00:00Z",
    ]);

    store.getState().actions.play();
    vi.advanceTimersByTime(250);
    expect(writes).toHaveLength(3);

    for (let i = 1; i <= 100; i += 1) {
      store.getState().actions.tick(T + 1_800_000 + i * 16);
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(3);

    stop();
    store.getState().actions.pause();
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(3);
  });
});
