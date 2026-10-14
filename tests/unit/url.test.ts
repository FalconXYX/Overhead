import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUrlState, shareUrl, startUrlSync, writeUrlState } from "../../src/app/url";
import type { ObjectId } from "../../src/state/types";
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
      sel: null,
      demo: false,
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

  it("[Redesign] t is a time in the recorded clip: written on the clip, never on a live camera", () => {
    const store = storeAt("2026-10-11T15:09:30.400Z");
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-2026-10-11-iss");
    expect(writeUrlState(store.getState())).toBe(
      "?cam=subaru-2026-10-11-iss&t=2026-10-11T15:09:30Z",
    );
    actions.setActiveCamera("subaru-starcam");
    expect(writeUrlState(store.getState())).toBe("?cam=subaru-starcam"); // even if replay were set
    actions.setMode("live");
    actions.select("sat:25544");
    expect(writeUrlState(store.getState())).toBe("?cam=subaru-starcam&sel=sat:25544");
    expect(shareUrl(store.getState(), "https://parthjain.ca/Overhead/")).toBe(
      "https://parthjain.ca/Overhead/?cam=subaru-starcam&sel=sat:25544",
    );
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

describe("?sel= (M3)", () => {
  it("parses object ids with raw or %3A-encoded colons", () => {
    expect(parseUrlState("?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544")).toEqual({
      cam: "synthetic-maunakea",
      tMs: Date.parse("2026-10-11T15:09:50Z"),
      sel: "sat:25544",
      demo: false,
    });
    expect(parseUrlState("?sel=sat%3A25544").sel).toBe("sat:25544");
    expect(parseUrlState("?sel=sat:100882").sel).toBe("sat:100882");
    expect(parseUrlState("?sel=planet:Jupiter").sel).toBe("planet:Jupiter");
    expect(parseUrlState("?sel=star:424").sel).toBe("star:424");
    expect(parseUrlState("?sel=moon").sel).toBe("moon");
    expect(parseUrlState("?sel=sun").sel).toBe("sun");
  });

  it("an invalid or missing sel is null", () => {
    for (const raw of ["", "sat:", "sat:0", "sat:025544", "planet:jupiter", "Moon", "star:9111"]) {
      expect(parseUrlState(`?sel=${encodeURIComponent(raw)}`).sel, raw).toBeNull();
    }
    expect(parseUrlState("?cam=synthetic-maunakea").sel).toBeNull();
    expect(parseUrlState("").sel).toBeNull();
  });

  it("writes &sel= last with a raw colon, in replay and in live", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    expect(writeUrlState(store.getState())).toBe("?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z");
    actions.select("sat:25544");
    expect(writeUrlState(store.getState())).toBe(
      "?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544",
    );
    actions.setMode("live");
    expect(writeUrlState(store.getState())).toBe("?cam=synthetic-maunakea&sel=sat:25544");
    actions.hover("moon"); // hover never reaches the URL
    actions.select(null);
    expect(writeUrlState(store.getState())).toBe("?cam=synthetic-maunakea");
  });

  it("round trip: every kind of id reads back as written", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const ids: ObjectId[] = [
      "sat:25544",
      "sat:100882",
      "planet:Uranus",
      "star:7001",
      "moon",
      "sun",
    ];
    for (const id of ids) {
      store.getState().actions.select(id);
      const search = writeUrlState(store.getState());
      expect(parseUrlState(search).sel, search).toBe(id);
      // URLSearchParams.toString() would write sat%3A25544; both forms read back.
      const encoded = `?${new URLSearchParams(search.slice(1)).toString()}`;
      expect(parseUrlState(encoded).sel, encoded).toBe(id);
    }
  });

  it("startUrlSync follows the selection after the debounce, never the hover", () => {
    vi.useFakeTimers();
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    const writes: string[] = [];
    const stop = startUrlSync(store, (search) => writes.push(search));
    expect(writes).toEqual(["?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z"]);
    actions.select("sat:25544");
    vi.advanceTimersByTime(249);
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(writes[1]).toBe("?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544");
    actions.hover("sat:25544");
    actions.hover(null);
    actions.setFollow(true);
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(2);
    actions.select(null); // Esc
    vi.advanceTimersByTime(250);
    expect(writes[2]).toBe("?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z");
    stop();
    actions.select("moon");
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(3);
  });
});

describe("?demo=1 and shareUrl (M9)", () => {
  const PAGE =
    "http://localhost:4173/Overhead/?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&demo=1#x";

  it("demo is true only for ?demo=1", () => {
    expect(parseUrlState("?demo=1").demo).toBe(true);
    expect(parseUrlState("?cam=synthetic-maunakea&demo=1").demo).toBe(true);
    for (const search of [
      "",
      "?demo=0",
      "?demo=",
      "?demo",
      "?demo=true",
      "?demo=yes",
      "?demo=01",
    ]) {
      expect(parseUrlState(search).demo, search).toBe(false);
    }
  });

  it("writeUrlState appends &demo=1 while the tour runs, last", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.select("sat:25544");
    actions.startDemo();
    expect(writeUrlState(store.getState())).toBe(
      "?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544&demo=1",
    );
    actions.stopDemo();
    expect(writeUrlState(store.getState())).toBe(
      "?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&sel=sat:25544",
    );
  });

  it("startUrlSync writes when the tour starts and when it stops, not on its steps", () => {
    vi.useFakeTimers();
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    const writes: string[] = [];
    const stop = startUrlSync(store, (search) => writes.push(search));
    actions.startDemo();
    vi.advanceTimersByTime(250);
    expect(writes).toEqual([
      "?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z",
      "?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z&demo=1",
    ]);
    actions.setDemoStep(3);
    actions.setDemoPaused(true);
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(2);
    actions.stopDemo(); // Esc or "Exit tour"
    vi.advanceTimersByTime(250);
    expect(writes[2]).toBe("?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z");
    stop();
  });

  it("shareUrl in replay while playing carries the current t and sel, never demo", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.select("sat:25544");
    actions.startDemo();
    actions.play();
    actions.tick(Date.parse("2026-10-11T15:09:52.700Z")); // the address bar still says 15:09:50 while playing
    const link = shareUrl(store.getState(), PAGE);
    expect(link).toBe(
      "http://localhost:4173/Overhead/?cam=synthetic-maunakea&t=2026-10-11T15:09:52Z&sel=sat:25544",
    );
    expect(new URL(link).searchParams.has("demo")).toBe(false);
    expect(new URL(link).hash).toBe("");
  });

  it("shareUrl in live mode has no t, so the link opens live", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.setMode("live");
    expect(shareUrl(store.getState(), PAGE)).toBe(
      "http://localhost:4173/Overhead/?cam=synthetic-maunakea",
    );
    actions.select("moon");
    expect(shareUrl(store.getState(), PAGE)).toBe(
      "http://localhost:4173/Overhead/?cam=synthetic-maunakea&sel=moon",
    );
  });

  it("round trip: a shared link parses back to the same camera, time and selection", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.setActiveCamera("synthetic-walenstadt");
    actions.select("planet:Jupiter");
    actions.tick(Date.parse("2026-10-11T15:10:03Z"));
    const link = new URL(shareUrl(store.getState(), "https://parthjain.ca/Overhead/?demo=1"));
    expect(link.pathname).toBe("/Overhead/");
    expect(parseUrlState(link.search)).toEqual({
      cam: "synthetic-walenstadt",
      tMs: Date.parse("2026-10-11T15:10:03Z"),
      sel: "planet:Jupiter",
      demo: false,
    });
  });
});
