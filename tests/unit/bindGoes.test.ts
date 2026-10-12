// tests/unit/bindGoes.test.ts — bindGoesTime, bindGoesLayer and bindGoesDomainPoll (M7 step 5) on a real KVP WMTS
// source and a live store. The poll gets an injected fetchFn: tests/unit/setup.ts blocks the global fetch.
import { readFileSync } from "node:fs";
import { getTopLeft } from "ol/extent";
import TileLayer from "ol/layer/Tile";
import { get as getProjection } from "ol/proj";
import type Projection from "ol/proj/Projection";
import { TileSourceEvent } from "ol/source/Tile";
import WMTS from "ol/source/WMTS";
import Tile from "ol/Tile";
import TileState from "ol/TileState";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isoUtcSeconds, removeGoesStep, type TimeInterval } from "../../src/domain/time";
import { GOES_LAYER, goesDomainUrl, goesProbeUrl, LEVEL6 } from "../../src/map/ground/layers/goes";
import {
  bindGoesDomainPoll,
  bindGoesLayer,
  bindGoesTime,
  createGoesSession,
  GOES_MAX_FALLBACKS,
  GOES_POLL_MS,
  type GoesSession,
} from "../../src/map/sync/bindGoes";
import { selectGoesLabel, selectGoesStepMs } from "../../src/state/selectors";
import type { AppStore } from "../../src/state/store";
import { storeAt } from "../helpers/store";

const at = (iso: string): number => Date.parse(iso);
const iv = (fromIso: string, toIso: string): TimeInterval => [at(fromIso), at(toIso)];
const FIXTURE_XML = readFileSync(
  new URL("../fixtures/gibs/goes-domain.xml", import.meta.url),
  "utf8",
);
/** parseGoesDomain of the committed fixture: the 19:30 and 21:10 gaps of 2026-10-07. */
const FIXTURE: readonly TimeInterval[] = [
  iv("2026-10-07T12:00:00Z", "2026-10-07T19:20:00Z"),
  iv("2026-10-07T19:40:00Z", "2026-10-07T21:00:00Z"),
  iv("2026-10-07T21:20:00Z", "2026-10-11T00:00:00Z"),
];
const LATEST = at("2026-10-11T00:00:00Z");

function epsg3857(): Projection {
  const projection = getProjection("EPSG:3857");
  if (projection === null) throw new Error("EPSG:3857 is always defined");
  return projection;
}

/** A real KVP WMTS from options (no DOM): Level6 as M1's grid recipe, 7 levels, image/png. */
function goesSource(): WMTS {
  const projection = epsg3857();
  const zooms = Array.from({ length: 7 }, (_, z) => z);
  return new WMTS({
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?",
    layer: GOES_LAYER,
    matrixSet: LEVEL6,
    format: "image/png",
    style: "default",
    requestEncoding: "KVP",
    projection,
    tileGrid: new WMTSTileGrid({
      origin: getTopLeft(projection.getExtent() ?? [0, 0, 0, 0]),
      resolutions: zooms.map((z) => 156543.03392804097 / 2 ** z),
      matrixIds: zooms.map(String),
    }),
    dimensions: { Time: "2026-10-01T00:00:00Z" },
  });
}

const time = (source: WMTS): unknown => source.getDimensions().Time;
const label = (store: AppStore): string | null => selectGoesLabel(store.getState());

/** A store at iso with the fixture domain loaded and the layer on. */
function readyStore(iso: string): AppStore {
  const store = storeAt(iso);
  const { actions } = store.getState();
  actions.setGoesDomain(FIXTURE, LATEST);
  actions.setGoesStatus("ready");
  actions.setLayer("goesIr", true);
  return store;
}

function steps(store: AppStore, n: number, deltaMs: number): void {
  for (let i = 0; i < n; i += 1) store.getState().actions.stepBy(deltaMs);
}

function dispatch(source: WMTS, type: "tileloadend" | "tileloaderror", key: string): void {
  const tile = new Tile([6, 4, 28], type === "tileloadend" ? TileState.LOADED : TileState.ERROR);
  tile.key = key;
  source.dispatchEvent(new TileSourceEvent(type, tile));
}

describe("bindGoesTime", () => {
  it("one Time change per 10-minute step across 09:58 → 10:02, and none after unbind", () => {
    const store = readyStore("2026-10-10T09:58:00Z");
    const source = goesSource();
    let changes = 0;
    source.on("change", () => {
      changes += 1;
    });
    const unbind = bindGoesTime(store, (iso) => source.updateDimensions({ Time: iso }));
    expect(changes).toBe(1); // the immediate call
    expect(time(source)).toBe("2026-10-10T09:50:00Z");
    steps(store, 240, 1000);
    expect(store.getState().clock.simTimeMs).toBe(at("2026-10-10T10:02:00Z"));
    expect(changes).toBe(2);
    expect(time(source)).toBe("2026-10-10T10:00:00Z");
    expect(source.getTileUrlFunction()([0, 0, 0], 1, epsg3857())).toBe(
      goesProbeUrl(at("2026-10-10T10:00:00Z")),
    );
    unbind();
    steps(store, 600, 1000);
    expect(changes).toBe(2);
  });

  it("calls nothing while there is no step", () => {
    const store = storeAt("2026-10-10T09:58:00Z");
    const seen: string[] = [];
    const unbind = bindGoesTime(store, (iso) => seen.push(iso));
    steps(store, 30, 60_000);
    expect(seen).toEqual([]);
    store.getState().actions.setGoesDomain(FIXTURE, LATEST);
    expect(seen).toEqual(["2026-10-10T10:20:00Z"]);
    unbind();
  });
});

describe("bindGoesLayer", () => {
  function setup(iso: string) {
    const store = readyStore(iso);
    const source = goesSource();
    const layer = new TileLayer({ source, visible: false });
    const session = createGoesSession();
    const unbind = bindGoesLayer(store, layer, source, session);
    return { store, source, layer, session, unbind };
  }

  it("visible only when on, ready and a step exists; status error hides", () => {
    const store = storeAt("2026-10-10T09:58:00Z");
    const source = goesSource();
    const layer = new TileLayer({ source, visible: true });
    const unbind = bindGoesLayer(store, layer, source, createGoesSession());
    expect(layer.getVisible()).toBe(false); // off, idle, no step
    const { actions } = store.getState();
    actions.setLayer("goesIr", true);
    expect(layer.getVisible()).toBe(false); // idle
    actions.setGoesStatus("ready");
    expect(layer.getVisible()).toBe(false); // ready but no step yet
    expect(time(source)).toBe("2026-10-01T00:00:00Z"); // the starting Default is never shown
    actions.setGoesDomain(FIXTURE, LATEST);
    expect(layer.getVisible()).toBe(true);
    expect(time(source)).toBe("2026-10-10T09:50:00Z");
    actions.setGoesStatus("error");
    expect(layer.getVisible()).toBe(false);
    actions.setGoesStatus("ready");
    expect(layer.getVisible()).toBe(true);
    actions.setLayer("goesIr", false);
    expect(layer.getVisible()).toBe(false);
    actions.setLayer("goesIr", true);
    expect(layer.getVisible()).toBe(true);
    unbind();
    actions.setLayer("goesIr", false);
    expect(layer.getVisible()).toBe(true);
  });

  it("hides before the first listed step", () => {
    const { store, layer } = setup("2026-10-07T13:00:00Z");
    expect(layer.getVisible()).toBe(true);
    store.getState().actions.seek(at("2026-10-07T11:55:00Z"));
    expect(selectGoesStepMs(store.getState())).toBeNull();
    expect(layer.getVisible()).toBe(false);
  });

  it("falls back one step per tile error, and the 4th failure in a row sets error and hides", () => {
    const { store, source, layer, session } = setup("2026-10-10T10:05:00Z");
    expect(label(store)).toBe("Imagery as of 10:00 UTC");
    const key1000 = source.getKey();

    dispatch(source, "tileloaderror", key1000);
    expect(label(store)).toBe("Imagery as of 09:50 UTC");
    expect(time(source)).toBe("2026-10-10T09:50:00Z");
    const afterFirst = store.getState();
    dispatch(source, "tileloaderror", key1000); // a repeat for 10:00 changes nothing
    expect(store.getState()).toBe(afterFirst);

    dispatch(source, "tileloadend", source.getKey()); // 09:50 loads a tile: the counter resets
    for (const next of ["09:40", "09:30", "09:20"]) {
      dispatch(source, "tileloaderror", source.getKey());
      expect(label(store)).toBe(`Imagery as of ${next} UTC`);
      expect(store.getState().data.goes.status).toBe("ready");
      expect(layer.getVisible()).toBe(true);
    }
    // GOES_MAX_FALLBACKS (3) in a row since the reset; the next failure stops the walk-back.
    expect(GOES_MAX_FALLBACKS).toBe(3);
    dispatch(source, "tileloaderror", source.getKey());
    expect(store.getState().data.goes.status).toBe("error");
    expect(layer.getVisible()).toBe(false);
    expect(label(store)).toBe("GOES-West tiles failed to load");
    expect([...session.missingStepsMs].map(isoUtcSeconds)).toEqual([
      "2026-10-10T10:00:00Z",
      "2026-10-10T09:50:00Z",
      "2026-10-10T09:40:00Z",
      "2026-10-10T09:30:00Z",
      "2026-10-10T09:20:00Z",
    ]);
    // The failed steps are gone from the store, which keeps the latest step.
    expect(store.getState().data.goes.latestStepMs).toBe(LATEST);
    expect(selectGoesStepMs(store.getState())).toBe(at("2026-10-10T09:10:00Z"));
  });

  it("a late error with an old key drops that step without moving the layer", () => {
    const { store, source, session } = setup("2026-10-10T09:58:00Z");
    const key0950 = source.getKey();
    steps(store, 4, 60_000); // 10:02
    expect(time(source)).toBe("2026-10-10T10:00:00Z");
    const before = store.getState().data.goes;
    dispatch(source, "tileloaderror", key0950);
    expect(time(source)).toBe("2026-10-10T10:00:00Z");
    expect(label(store)).toBe("Imagery as of 10:00 UTC");
    expect(store.getState().data.goes.status).toBe("ready");
    expect(store.getState().data.goes.intervals).not.toBe(before.intervals);
    expect(session.missingStepsMs.has(at("2026-10-10T09:50:00Z"))).toBe(true);
    // Stepping back past it lands on the step before.
    steps(store, 4, -60_000); // 09:58
    expect(label(store)).toBe("Imagery as of 09:40 UTC");
    expect(time(source)).toBe("2026-10-10T09:40:00Z");
  });

  it("ignores errors and loads from keys it never set, and stops after unbind", () => {
    const { store, source, layer, unbind } = setup("2026-10-10T09:58:00Z");
    const before = store.getState();
    dispatch(source, "tileloaderror", "some-other-key");
    expect(store.getState()).toBe(before);
    unbind();
    dispatch(source, "tileloaderror", source.getKey());
    expect(store.getState()).toBe(before);
    store.getState().actions.setGoesStatus("error");
    expect(layer.getVisible()).toBe(true);
    steps(store, 10, 60_000);
    expect(time(source)).toBe("2026-10-10T09:50:00Z");
  });
});

describe("bindGoesDomainPoll", () => {
  const NOW = at("2026-10-11T09:52:31Z");
  const DOMAIN_URL = goesDomainUrl(NOW);
  const PROBE_URL = goesProbeUrl(LATEST);

  interface Call {
    url: string;
    init: RequestInit;
  }

  /**
   * Answers the GET with the fixture and the HEAD with layer-time-actual equal to its Time, unless overridden. Like
   * fetch, it rejects when the signal is already aborted.
   */
  function fakeFetch(
    overrides: {
      get?: () => Response | Promise<Response>;
      head?: () => Response | Promise<Response>;
    } = {},
  ) {
    const calls: Call[] = [];
    const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      if (init.method === "HEAD") {
        if (overrides.head !== undefined) return overrides.head();
        const time = new URL(url).searchParams.get("Time") ?? "";
        return new Response(null, { status: 200, headers: { "layer-time-actual": time } });
      }
      if (overrides.get !== undefined) return overrides.get();
      return new Response(FIXTURE_XML, { status: 200 });
    };
    return { calls, fetchFn };
  }

  const gets = (calls: readonly Call[]) => calls.filter((c) => c.init.method !== "HEAD");
  const heads = (calls: readonly Call[]) => calls.filter((c) => c.init.method === "HEAD");

  function setup(
    iso: string,
    fetch: ReturnType<typeof fakeFetch>,
    session: GoesSession = createGoesSession(),
  ) {
    const store = storeAt(iso);
    const unbind = bindGoesDomainPoll(store, session, {
      fetchFn: fetch.fetchFn,
      nowMs: () => NOW,
    });
    return { store, unbind, session };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls only while the layer is on: GET then HEAD, then a GET every 5 min without a HEAD", async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch();
    const { store, unbind } = setup("2026-10-10T09:58:00Z", fetch);
    await vi.advanceTimersByTimeAsync(3 * GOES_POLL_MS);
    expect(fetch.calls).toEqual([]);
    expect(store.getState().data.goes.status).toBe("idle");

    store.getState().actions.setLayer("goesIr", true);
    expect(store.getState().data.goes.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.calls.map((c) => [c.url, c.init.method ?? "GET", c.init.cache])).toEqual([
      [DOMAIN_URL, "GET", "no-store"],
      [PROBE_URL, "HEAD", "no-store"],
    ]);
    expect(DOMAIN_URL).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/GOES-West_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/2026-07-13T09:50:00Z--2026-10-11T09:52:00Z.xml",
    );
    expect(fetch.calls.every((c) => c.init.signal instanceof AbortSignal)).toBe(true);
    expect(store.getState().data.goes).toEqual({
      status: "ready",
      intervals: FIXTURE,
      latestStepMs: LATEST,
    });
    expect(label(store)).toBe("Imagery as of 09:50 UTC");

    await vi.advanceTimersByTimeAsync(GOES_POLL_MS);
    expect(gets(fetch.calls)).toHaveLength(2);
    expect(heads(fetch.calls)).toHaveLength(1); // the newest step is already confirmed

    store.getState().actions.setLayer("goesIr", false);
    await vi.advanceTimersByTimeAsync(3 * GOES_POLL_MS);
    expect(fetch.calls).toHaveLength(3);
    // On again: one poll at once, and no HEAD for a newest step already confirmed.
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(gets(fetch.calls)).toHaveLength(3);
    expect(heads(fetch.calls)).toHaveLength(1);
    unbind();
    await vi.advanceTimersByTimeAsync(3 * GOES_POLL_MS);
    expect(fetch.calls).toHaveLength(4);
  });

  it("a HEAD 404 falls back one listed step, and the next poll probes again", async () => {
    vi.useFakeTimers();
    let headStatus = 404;
    const fetch = fakeFetch({
      head: () =>
        headStatus === 200
          ? new Response(null, {
              status: 200,
              headers: { "layer-time-actual": isoUtcSeconds(LATEST) },
            })
          : new Response(null, { status: headStatus }),
    });
    const { store } = setup("2026-10-11T00:05:00Z", fetch);
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().data.goes.latestStepMs).toBe(at("2026-10-10T23:50:00Z"));
    expect(store.getState().data.goes.status).toBe("ready");
    expect(label(store)).toBe("Imagery as of 2026-10-10 23:50 UTC");
    // latestStepMs is below the newest listed step, so the next poll probes again.
    headStatus = 200;
    await vi.advanceTimersByTimeAsync(GOES_POLL_MS);
    expect(heads(fetch.calls)).toHaveLength(2);
    expect(store.getState().data.goes.latestStepMs).toBe(LATEST);
    expect(label(store)).toBe("Imagery as of 00:00 UTC");
  });

  it("a probe without the matching layer-time-actual, or a network error, is a miss", async () => {
    vi.useFakeTimers();
    for (const head of [
      () => new Response(null, { status: 200 }), // outside the Earth disk: 200 without the header
      () =>
        new Response(null, {
          status: 200,
          headers: { "layer-time-actual": "2026-10-10T23:50:00Z" },
        }),
      () => {
        throw new TypeError("Failed to fetch");
      },
    ]) {
      const { store, unbind } = setup("2026-10-11T00:05:00Z", fakeFetch({ head }));
      store.getState().actions.setLayer("goesIr", true);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().data.goes.latestStepMs).toBe(at("2026-10-10T23:50:00Z"));
      expect(store.getState().data.goes.status).toBe("ready");
      unbind();
    }
  });

  it("a step missing this session stays removed after a poll", async () => {
    vi.useFakeTimers();
    const session = createGoesSession();
    session.missingStepsMs.add(at("2026-10-10T09:50:00Z"));
    const { store } = setup("2026-10-10T09:58:00Z", fakeFetch(), session);
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(label(store)).toBe("Imagery as of 09:40 UTC");
    await vi.advanceTimersByTimeAsync(GOES_POLL_MS);
    expect(label(store)).toBe("Imagery as of 09:40 UTC");
  });

  it("a tile error during the probe is kept: the poll merges again from the current store", async () => {
    vi.useFakeTimers();
    const session = createGoesSession();
    let resolveHead: (res: Response) => void = () => {};
    const fetch = fakeFetch({
      head: () =>
        new Promise<Response>((resolve) => {
          resolveHead = resolve;
        }),
    });
    const { store } = setup("2026-10-10T09:58:00Z", fetch, session);
    const { actions } = store.getState();
    const before = at("2026-10-10T23:50:00Z"); // below the fixture's newest step: the poll probes
    actions.setGoesDomain(FIXTURE, before);
    actions.setGoesStatus("ready");
    actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(heads(fetch.calls)).toHaveLength(1);
    // While the HEAD is in flight, a tile error drops 09:50 (as bindGoesLayer does).
    const failedMs = at("2026-10-10T09:50:00Z");
    session.missingStepsMs.add(failedMs);
    actions.setGoesDomain(removeGoesStep(store.getState().data.goes.intervals, failedMs), before);
    expect(label(store)).toBe("Imagery as of 09:40 UTC");
    resolveHead(
      new Response(null, { status: 200, headers: { "layer-time-actual": isoUtcSeconds(LATEST) } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(label(store)).toBe("Imagery as of 09:40 UTC");
    expect(store.getState().data.goes.latestStepMs).toBe(LATEST);
  });

  it("skips a poll while the previous one of the same start is running; turning off aborts it", async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch({ get: () => new Promise<Response>(() => {}) });
    const { store } = setup("2026-10-10T09:58:00Z", fetch);
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(2 * GOES_POLL_MS);
    expect(gets(fetch.calls)).toHaveLength(1);
    const first = fetch.calls[0]?.init.signal;
    store.getState().actions.setLayer("goesIr", false);
    expect(first?.aborted).toBe(true);
    // A restart is never blocked by the aborted poll.
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(gets(fetch.calls)).toHaveLength(2);
    expect(fetch.calls[1]?.init.signal?.aborted).toBe(false);
  });

  it("an aborted poll writes nothing and does not warn, even when its answer arrives afterwards", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveGet: (res: Response) => void = () => {};
    const fetch = fakeFetch({
      get: () =>
        new Promise<Response>((resolve) => {
          resolveGet = resolve;
        }),
    });
    const { store } = setup("2026-10-10T09:58:00Z", fetch);
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    store.getState().actions.setLayer("goesIr", false);
    const before = store.getState().data.goes;
    expect(before.status).toBe("loading");
    resolveGet(new Response(FIXTURE_XML, { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().data.goes).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a first GET of 503 sets error and warns once; later failures keep what is known", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let getStatus = 503;
    const fetch = fakeFetch({
      get: () =>
        getStatus === 200
          ? new Response(FIXTURE_XML, { status: 200 })
          : new Response("Service Unavailable", { status: getStatus }),
    });
    const { store } = setup("2026-10-10T09:58:00Z", fetch);
    store.getState().actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().data.goes.status).toBe("error");
    expect(label(store)).toBe("GOES-West availability failed to load");
    expect(heads(fetch.calls)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);

    getStatus = 200; // the next poll is the only retry
    await vi.advanceTimersByTimeAsync(GOES_POLL_MS);
    expect(store.getState().data.goes.status).toBe("ready");
    expect(label(store)).toBe("Imagery as of 09:50 UTC");

    getStatus = 500; // intervals present: keep showing them
    await vi.advanceTimersByTimeAsync(GOES_POLL_MS);
    expect(store.getState().data.goes.status).toBe("ready");
    expect(store.getState().data.goes.intervals).toEqual(FIXTURE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a page without <Domain> or a malformed domain is a failure", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const body of ["<html>Bad Request</html>", "<Domain>2026-10-10T03:30Z</Domain>"]) {
      const { store, unbind } = setup(
        "2026-10-10T09:58:00Z",
        fakeFetch({ get: () => new Response(body, { status: 200 }) }),
      );
      store.getState().actions.setLayer("goesIr", true);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().data.goes.status, body).toBe("error");
      unbind();
    }
  });

  it("a successful poll clears a tile-guard error; latestStepMs never decreases", async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch();
    const { store } = setup("2026-10-10T09:58:00Z", fetch);
    const { actions } = store.getState();
    actions.setGoesDomain(FIXTURE, at("2026-10-11T00:30:00Z"));
    actions.setGoesStatus("error");
    actions.setLayer("goesIr", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().data.goes.status).toBe("ready");
    // The stored 00:30 is newer than the fixture's newest step: no HEAD, and it stays.
    expect(store.getState().data.goes.latestStepMs).toBe(at("2026-10-11T00:30:00Z"));
    expect(gets(fetch.calls)).toHaveLength(1);
    expect(heads(fetch.calls)).toHaveLength(0);
  });
});
