// tests/unit/bindHorizon.test.ts — M6 steps 7 and 9: bindHorizonWorker against a plain-object fake worker (one compute
// per camera and site, the latest requestId only, the error retry rule, the site-change recompute, the StrictMode
// cleanup) and bindSkyHorizon.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindHorizonWorker,
  bindSkyHorizon,
  type HorizonWorkerLike,
} from "../../src/map/sync/bindHorizon";
import type { AppStore } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import type { HorizonIn, HorizonOut } from "../../src/workers/protocol";
import { storeAt } from "../helpers/store";

const T = "2026-10-11T15:20:00Z";
const MAUNAKEA = "synthetic-maunakea";
const WALENSTADT = "synthetic-walenstadt";

interface FakeWorker extends HorizonWorkerLike {
  readonly posted: HorizonIn[];
  terminated: number;
}

function fakeWorker(): FakeWorker {
  return {
    posted: [],
    terminated: 0,
    onmessage: null,
    postMessage(message) {
      this.posted.push(message);
    },
    terminate() {
      this.terminated += 1;
    },
  };
}

/** Delivers a reply the way a Worker does. */
const reply = (worker: HorizonWorkerLike, data: HorizonOut): void =>
  worker.onmessage?.(new MessageEvent("message", { data }));

const profileOf = (deg: number): Float32Array => new Float32Array(360).fill(deg);

function done(msg: HorizonIn, profileDeg: Float32Array, imagerySources = ["srtm"]): HorizonOut {
  return {
    type: "done",
    requestId: msg.requestId,
    cameraId: msg.cameraId,
    profileDeg,
    groundM: 0,
    z0M: 0,
    limitM: 100_000,
    imagerySources,
  };
}

const entry = (store: AppStore, id: string) => store.getState().data.horizon[id];

/** The registry with `id`'s site replaced by a copy carrying `patch`. */
function withSite(store: AppStore, id: string, patch: Partial<CameraConfig["site"]>): void {
  const { registry } = store.getState().camera;
  const camera = registry[id];
  if (camera === undefined) throw new Error(`no camera ${id}`);
  store
    .getState()
    .actions.setRegistry({ ...registry, [id]: { ...camera, site: { ...camera.site, ...patch } } });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("bindHorizonWorker", () => {
  it("creates the worker lazily and sends one compute at subscribe from the registry's site", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const create = vi.fn(() => worker);
    const site = store.getState().camera.registry[MAUNAKEA]?.site;
    const stop = bindHorizonWorker(store, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(worker.posted).toEqual([
      {
        type: "compute",
        requestId: expect.any(Number),
        cameraId: MAUNAKEA,
        latDeg: site?.latDeg,
        lonDeg: site?.lonDeg,
        mastM: site?.mastM,
      },
    ]);
    expect(site?.mastM).toBe(33); // M6 step 8
    expect(entry(store, MAUNAKEA)).toEqual({
      status: "loading",
      profileDeg: null,
      imagerySources: [],
    });
    // Clock ticks change nothing.
    store.getState().actions.tick(Date.parse(T) + 1_000);
    expect(worker.posted).toHaveLength(1);
    stop();
  });

  it("stores done as ready with the transferred array itself; progress is ignored", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const stop = bindHorizonWorker(store, () => worker);
    const [msg] = worker.posted;
    if (msg === undefined) throw new Error("no compute");
    reply(worker, {
      type: "progress",
      requestId: msg.requestId,
      cameraId: MAUNAKEA,
      tilesDone: 3,
      tilesTotal: 46,
    });
    expect(entry(store, MAUNAKEA)?.status).toBe("loading");
    const profile = profileOf(-1.9);
    reply(worker, done(msg, profile, ["etopo1", "srtm"]));
    const stored = entry(store, MAUNAKEA);
    expect(stored?.status).toBe("ready");
    expect(stored?.profileDeg).toBe(profile);
    expect(stored?.imagerySources).toEqual(["etopo1", "srtm"]);
    stop();
  });

  it("ignores a done with an older requestId", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const stop = bindHorizonWorker(store, () => worker);
    const [first] = worker.posted;
    if (first === undefined) throw new Error("no compute");
    reply(worker, done({ ...first, requestId: first.requestId - 1 }, profileOf(5)));
    expect(entry(store, MAUNAKEA)?.status).toBe("loading");
    expect(entry(store, MAUNAKEA)?.profileDeg).toBeNull();
    stop();
  });

  it("reuses a loading or ready entry: switching away and back sends nothing", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const stop = bindHorizonWorker(store, () => worker);
    const [maunakea] = worker.posted;
    if (maunakea === undefined) throw new Error("no compute");
    reply(worker, done(maunakea, profileOf(-1.9)));

    store.getState().actions.setActiveCamera(WALENSTADT);
    expect(worker.posted).toHaveLength(2); // Walenstadt has no entry yet
    expect(worker.posted[1]?.cameraId).toBe(WALENSTADT);
    store.getState().actions.setActiveCamera(MAUNAKEA); // ready: nothing
    store.getState().actions.setActiveCamera(WALENSTADT); // still loading: nothing
    expect(worker.posted).toHaveLength(2);
    // A result for a camera that is no longer active is still stored (the cache is per camera).
    store.getState().actions.setActiveCamera(MAUNAKEA);
    const walenstadt = worker.posted[1];
    if (walenstadt === undefined) throw new Error("no compute");
    reply(worker, done(walenstadt, profileOf(30)));
    expect(entry(store, WALENSTADT)?.status).toBe("ready");
    stop();
  });

  it("error sets error and warns; it is retried only when the camera is selected again", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const stop = bindHorizonWorker(store, () => worker);
    const [first] = worker.posted;
    if (first === undefined) throw new Error("no compute");
    reply(worker, {
      type: "error",
      requestId: first.requestId,
      cameraId: MAUNAKEA,
      message: "terrain tile 8/17/111: HTTP 503",
    });
    expect(entry(store, MAUNAKEA)?.status).toBe("error");
    const warn = vi.mocked(console.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("HTTP 503");
    // An unrelated state change does not retry.
    store.getState().actions.setLayer("horizon", false);
    expect(worker.posted).toHaveLength(1);
    store.getState().actions.setActiveCamera(WALENSTADT);
    store.getState().actions.setActiveCamera(MAUNAKEA);
    expect(worker.posted.map((m) => m.cameraId)).toEqual([MAUNAKEA, WALENSTADT, MAUNAKEA]);
    expect(entry(store, MAUNAKEA)?.status).toBe("loading");
    stop();
  });

  it("recomputes when the active camera keeps its id but its site moves; an equal site sends nothing", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const stop = bindHorizonWorker(store, () => worker);
    const [first] = worker.posted;
    if (first === undefined) throw new Error("no compute");
    reply(worker, done(first, profileOf(-1.9)));
    expect(entry(store, MAUNAKEA)?.status).toBe("ready");

    // A new site object with the same values (a clip of the same camera): nothing.
    withSite(store, MAUNAKEA, {});
    expect(worker.posted).toHaveLength(1);
    // A field the profile does not depend on: nothing.
    withSite(store, MAUNAKEA, { geoidSepM: 30 });
    expect(worker.posted).toHaveLength(1);

    // 1° further north, while the entry is ready: one new compute with the new latitude.
    withSite(store, MAUNAKEA, { latDeg: first.latDeg + 1 });
    expect(worker.posted).toHaveLength(2);
    const second = worker.posted[1];
    expect(second).toMatchObject({ cameraId: MAUNAKEA, latDeg: first.latDeg + 1 });
    expect(second?.requestId).toBeGreaterThan(first.requestId);
    expect(entry(store, MAUNAKEA)).toEqual({
      status: "loading",
      profileDeg: null,
      imagerySources: [],
    });
    // A late reply to the old request is ignored.
    reply(worker, done(first, profileOf(7)));
    expect(entry(store, MAUNAKEA)?.status).toBe("loading");
    if (second === undefined) throw new Error("no compute");
    const moved = profileOf(-2);
    reply(worker, done(second, moved));
    expect(entry(store, MAUNAKEA)?.profileDeg).toBe(moved);
    // mastM is part of the site the profile depends on.
    withSite(store, MAUNAKEA, { mastM: 0 });
    expect(worker.posted).toHaveLength(3);
    stop();
  });

  it("waits for the registry, then computes", () => {
    const store = storeAt(T);
    const { registry } = store.getState().camera;
    store.getState().actions.setRegistry({});
    const worker = fakeWorker();
    const create = vi.fn(() => worker);
    const stop = bindHorizonWorker(store, create);
    expect(create).not.toHaveBeenCalled();
    store.getState().actions.setRegistry(registry);
    expect(worker.posted).toHaveLength(1);
    stop();
  });

  it("cleanup terminates the worker and resets the entries it left loading to idle", () => {
    const store = storeAt(T);
    const worker = fakeWorker();
    const stop = bindHorizonWorker(store, () => worker);
    const [maunakea] = worker.posted;
    if (maunakea === undefined) throw new Error("no compute");
    reply(worker, done(maunakea, profileOf(-1.9)));
    store.getState().actions.setActiveCamera(WALENSTADT); // left loading
    stop();
    expect(worker.terminated).toBe(1);
    expect(entry(store, WALENSTADT)?.status).toBe("idle");
    expect(entry(store, MAUNAKEA)?.status).toBe("ready");
    // StrictMode's second mount computes it again with a new worker.
    const second = fakeWorker();
    const stop2 = bindHorizonWorker(store, () => second);
    expect(second.posted.map((m) => m.cameraId)).toEqual([WALENSTADT]);
    stop2();
    expect(second.terminated).toBe(1);
  });
});

describe("bindSkyHorizon", () => {
  it("hands the active camera's profile to the sky map now and on every change", () => {
    const store = storeAt(T);
    const calls: (Float32Array | null)[] = [];
    const stop = bindSkyHorizon(store, { setHorizonProfile: (p) => calls.push(p) });
    expect(calls).toEqual([null]);
    const profile = profileOf(-1.9);
    store.getState().actions.setHorizon(MAUNAKEA, { status: "ready", profileDeg: profile });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(profile);
    store.getState().actions.tick(Date.parse(T) + 1_000);
    expect(calls).toHaveLength(2);
    store.getState().actions.setActiveCamera(WALENSTADT); // no entry: null
    expect(calls[2]).toBeNull();
    stop();
    store.getState().actions.setActiveCamera(MAUNAKEA);
    expect(calls).toHaveLength(3);
  });
});
