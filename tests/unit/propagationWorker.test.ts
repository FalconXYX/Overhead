// tests/unit/propagationWorker.test.ts — the propagation worker's message handling (M3 step 10, README section 5),
// driven in Node: the worker's global addEventListener and postMessage are stubbed, fetch serves the committed snapshot.
import { readFileSync } from "node:fs";
import { json2satrec } from "satellite.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CameraModelInput, syntheticFisheyeCalibration } from "../../src/domain/camera";
import { enuToAzAltDeg, type ObserverSite } from "../../src/domain/geo";
import {
  appendGroup,
  createPropagationContext,
  ISS_NORAD_ID,
  parseGpFile,
  SAMPLE_STRIDE,
  SampleField,
  trackLonLatDeg,
  writeSample,
} from "../../src/domain/orbits";
import { floorToStepMs, TRACK_STEP_MS } from "../../src/domain/time";
import {
  type CatalogDelta,
  type PropagationIn,
  type PropagationOut,
  SKY_PATH_STEP_MS,
} from "../../src/workers/protocol";

const SITE: ObserverSite = { latDeg: 19.8253, lonDeg: -155.4689, heightM: 4204 };
const SNAPSHOT_MS = 1791690621000; // 2026-10-11T03:50:21Z, meta.json fetchedAtMs
const T_PASS = Date.parse("2026-10-11T15:09:50Z"); // ISS at az 123.8°, geometric alt 28.84°, sunlit
const BASE = "http://localhost:4173/Overhead/data/gp/";

type Out<T extends PropagationOut["type"]> = Extract<PropagationOut, { type: T }>;
interface Posted {
  msg: PropagationOut;
  transfer: Transferable[];
}

function fixture(file: string): string {
  return readFileSync(new URL(`../fixtures/gp/${file}`, import.meta.url), "utf8");
}

const jsonResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

/** A fake fetch over the committed snapshot; `override` answers chosen URLs first (a Promise delays the answer). */
function snapshotFetch(override: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const custom = override[url];
    if (custom !== undefined) return custom();
    if (!url.startsWith(BASE)) throw new Error(`unexpected fetch ${url}`);
    return jsonResponse(fixture(url.slice(BASE.length)));
  };
  return { fn, calls };
}

interface Harness {
  send(msg: PropagationIn): void;
  posted: Posted[];
  of<T extends PropagationOut["type"]>(type: T): Out<T>[];
  fetchCalls: string[];
}

/** Imports a fresh worker module with stubbed globals. */
async function startWorker(override: Record<string, () => Response | Promise<Response>> = {}) {
  const posted: Posted[] = [];
  let listener: ((e: MessageEvent<PropagationIn>) => void) | null = null;
  vi.stubGlobal(
    "addEventListener",
    (type: string, fn: (e: MessageEvent<PropagationIn>) => void) => {
      expect(type).toBe("message");
      listener = fn;
    },
  );
  vi.stubGlobal("postMessage", (msg: PropagationOut, options: { transfer?: Transferable[] }) => {
    posted.push({ msg, transfer: options.transfer ?? [] });
  });
  const fetchStub = snapshotFetch(override);
  vi.stubGlobal("fetch", fetchStub.fn);
  vi.resetModules();
  await import("../../src/workers/propagation.worker");
  const harness: Harness = {
    send(msg) {
      if (listener === null) throw new Error("the worker registered no message listener");
      listener(new MessageEvent("message", { data: msg }));
    },
    posted,
    of: <T extends PropagationOut["type"]>(type: T) =>
      posted.map((p) => p.msg).filter((m): m is Out<T> => m.type === type),
    fetchCalls: fetchStub.calls,
  };
  return harness;
}

/** Waits until the worker has answered `n` loadGroup requests. */
async function loaded(w: Harness, n: number): Promise<void> {
  await vi.waitFor(() => {
    expect(w.of("groupLoaded").length + w.of("groupError").length).toBe(n);
  });
}

async function startedWithStationsAndVisual(): Promise<Harness> {
  const w = await startWorker();
  w.send({ type: "init", site: SITE, generation: 0 });
  w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
  w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
  await loaded(w, 2);
  return w;
}

function catalogOf(w: Harness): { noradIds: number[]; names: string[]; dockedWith: number[] } {
  const noradIds: number[] = [];
  const names: string[] = [];
  const dockedWith: number[] = [];
  for (const g of w.of("groupLoaded")) {
    noradIds.push(...g.catalog.noradIds);
    names.push(...g.catalog.names);
    dockedWith.push(...g.catalog.dockedWith);
  }
  return { noradIds, names, dockedWith };
}

/** The reference: the same snapshot through the domain functions directly. */
function referenceSatrecs() {
  const seen = new Set<number>();
  const entries = [
    ...appendGroup(seen, "stations", parseGpFile(JSON.parse(fixture("stations.json")))),
    ...appendGroup(seen, "visual", parseGpFile(JSON.parse(fixture("visual.json")))),
  ];
  return { entries, satrecs: entries.map((e) => json2satrec(e.omm)) };
}

function sampleRequest(count: number, k: number, stepMs: number, groups = 0b011, generation = 1) {
  const buffer = new ArrayBuffer(count * SAMPLE_STRIDE * 4);
  return { type: "sample", generation, k, stepMs, groups, buffer } as const;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadGroup", () => {
  it("appends stations then visual: dedupe, docking, catalogue rows, meta fetched once", async () => {
    const w = await startedWithStationsAndVisual();
    const [stations, visual] = w.of("groupLoaded");
    expect(stations).toMatchObject({ group: "stations", totalCount: 22, fetchedAtMs: SNAPSHOT_MS });
    expect(visual).toMatchObject({ group: "visual", totalCount: 175, fetchedAtMs: SNAPSHOT_MS });
    expect(stations?.catalog.firstIndex).toBe(0);
    expect(visual?.catalog.firstIndex).toBe(22);
    expect(visual?.catalog.noradIds.length).toBe(153); // 25544, 48274 and 66515 stay in stations
    expect(w.fetchCalls).toEqual([
      `${BASE}meta.json`,
      `${BASE}stations.json`,
      `${BASE}visual.json`,
    ]);

    const { noradIds, names, dockedWith } = catalogOf(w);
    expect(noradIds[0]).toBe(ISS_NORAD_ID);
    expect(names[0]).toBe("ISS (ZARYA)");
    expect(new Set(noradIds).size).toBe(175);
    const docked = new Map<number, number>();
    noradIds.forEach((id, i) => {
      if ((dockedWith[i] ?? -1) !== -1) docked.set(id, dockedWith[i] ?? -1);
    });
    expect(Object.fromEntries(docked)).toEqual({
      36086: 25544,
      49044: 25544,
      68837: 25544,
      100057: 25544,
      100712: 25544,
      100882: 25544,
      53239: 48274,
      54216: 48274,
      69049: 48274,
      69180: 48274,
    });
    expect([...(stations?.catalog.groupIndex ?? [])].every((g) => g === 0)).toBe(true);
    expect([...(visual?.catalog.groupIndex ?? [])].every((g) => g === 1)).toBe(true);
    const ref = referenceSatrecs();
    const epochs = w.of("groupLoaded").flatMap((g) => [...g.catalog.epochMs]);
    expect(epochs).toEqual(ref.entries.map((e) => e.epochMs));
  });

  it("transfers the catalogue's typed arrays", async () => {
    const w = await startedWithStationsAndVisual();
    const reply = w.posted.find((p) => p.msg.type === "groupLoaded");
    if (reply?.msg.type !== "groupLoaded") throw new Error("no groupLoaded");
    const c: CatalogDelta = reply.msg.catalog;
    expect(reply.transfer).toEqual([
      c.noradIds.buffer,
      c.groupIndex.buffer,
      c.epochMs.buffer,
      c.dockedWith.buffer,
    ]);
  });

  it("answers in arrival order even when a later group's file arrives first", async () => {
    let release: () => void = () => undefined;
    const slowStations = new Promise<Response>((resolve) => {
      release = () => resolve(jsonResponse(fixture("stations.json")));
    });
    const w = await startWorker({ [`${BASE}stations.json`]: () => slowStations });
    w.send({ type: "init", site: SITE, generation: 0 });
    w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
    await new Promise((r) => setTimeout(r, 20));
    expect(w.of("groupLoaded")).toHaveLength(0);
    expect(w.fetchCalls).not.toContain(`${BASE}visual.json`); // visual waits for stations
    release();
    await loaded(w, 2);
    expect(w.of("groupLoaded").map((g) => g.group)).toEqual(["stations", "visual"]);
    expect(catalogOf(w).noradIds[0]).toBe(ISS_NORAD_ID); // the ISS stays in stations
  });

  it("replies groupError on HTTP errors and non-OMM bodies, and later groups still load", async () => {
    const w = await startWorker({
      [`${BASE}starlink.json`]: () => new Response("<!doctype html>", { status: 200 }),
      [`${BASE}visual.json`]: () => new Response("gone", { status: 503 }),
    });
    w.send({ type: "init", site: SITE, generation: 0 });
    w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
    w.send({ type: "loadGroup", group: "starlink", url: `${BASE}starlink.json` });
    await loaded(w, 3);
    expect(w.of("groupLoaded").map((g) => g.group)).toEqual(["stations"]);
    const errors = w.of("groupError");
    expect(errors.map((e) => e.group)).toEqual(["visual", "starlink"]);
    expect(errors[0]?.message).toContain("503");
    expect(errors[1]?.message.length).toBeGreaterThan(0);
  });

  it("leaves the catalogue unchanged after a failed load, so a retry appends the same rows", async () => {
    let fail = true;
    const w = await startWorker({
      [`${BASE}visual.json`]: () =>
        fail ? jsonResponse('[{"OBJECT_NAME": "broken"}]') : jsonResponse(fixture("visual.json")),
    });
    w.send({ type: "init", site: SITE, generation: 0 });
    w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
    await loaded(w, 2);
    expect(w.of("groupError")).toHaveLength(1);
    fail = false;
    w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
    await loaded(w, 3);
    const visual = w.of("groupLoaded")[1];
    expect(visual?.catalog.firstIndex).toBe(22);
    expect(visual?.totalCount).toBe(175);
  });

  it("loads with fetchedAtMs null when meta.json fails or lacks the group, and fetches it once", async () => {
    const w = await startWorker({ [`${BASE}meta.json`]: () => new Response("", { status: 500 }) });
    w.send({ type: "init", site: SITE, generation: 0 });
    w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    w.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
    await loaded(w, 2);
    expect(w.of("groupLoaded").map((g) => g.fetchedAtMs)).toEqual([null, null]);
    expect(w.fetchCalls.filter((u) => u.endsWith("meta.json"))).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);

    const partial = await startWorker({
      [`${BASE}meta.json`]: () => jsonResponse('{"stations": {"fetchedAtMs": 5, "count": 22}}'),
    });
    partial.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    partial.send({ type: "loadGroup", group: "visual", url: `${BASE}visual.json` });
    await loaded(partial, 2);
    expect(partial.of("groupLoaded").map((g) => g.fetchedAtMs)).toEqual([5, null]);
  });
});

describe("sample", () => {
  it("writes every object at t_k = k × stepMs and returns the same buffer, transferred", async () => {
    const w = await startedWithStationsAndVisual();
    const k = T_PASS / 100;
    const req = sampleRequest(175, k, 100, 0b011, 7);
    w.send(req);
    const reply = w.posted.at(-1);
    if (reply?.msg.type !== "sample") throw new Error("no sample reply");
    expect(reply.msg).toMatchObject({ generation: 7, k, timeMs: T_PASS });
    expect(reply.msg.buffer).toBe(req.buffer);
    expect(reply.transfer).toEqual([req.buffer]);
    expect(reply.msg.computeMs).toBeGreaterThanOrEqual(0);

    const ctx = createPropagationContext(T_PASS, SITE);
    expect(reply.msg.sunAltDeg).toBe(ctx.sunAltDeg);
    expect(reply.msg.sunAltDeg).toBeCloseTo(-16.2, 1);
    const ref = referenceSatrecs();
    const expected = new Float32Array(175 * SAMPLE_STRIDE);
    ref.satrecs.forEach((satrec, i) => {
      if (ref.entries[i]?.dockedWith === null) writeSample(satrec, ctx, expected, i);
    });
    expect(new Float32Array(reply.msg.buffer)).toEqual(expected);

    // The ISS at 15:09:50Z: the e2e hover-card values (M3 section 5).
    const data = new Float32Array(reply.msg.buffer);
    const azAlt = new Float64Array(2);
    enuToAzAltDeg(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, azAlt, 0);
    expect(azAlt[0]).toBeCloseTo(123.812, 2);
    expect(azAlt[1]).toBeCloseTo(28.841, 2);
    expect(Math.hypot(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0)).toBeCloseTo(794.522, 1);
    expect(data[SampleField.sunlit]).toBe(1);
  });

  it("zeroes docked objects and objects outside the group mask", async () => {
    const w = await startedWithStationsAndVisual();
    const req = sampleRequest(175, T_PASS / 100, 100, 0b001);
    w.send(req);
    const data = new Float32Array(req.buffer);
    const { dockedWith } = catalogOf(w);
    for (let i = 0; i < 175; i++) {
      const slot = [...data.subarray(i * SAMPLE_STRIDE, (i + 1) * SAMPLE_STRIDE)];
      if (i >= 22 || (dockedWith[i] ?? -1) !== -1) expect(slot).toEqual(new Array(8).fill(0));
      else expect(slot[SampleField.valid]).toBe(1);
    }
    expect(data[SampleField.valid]).toBe(1); // the ISS
  });

  it("writes only the rows a smaller (pre-resize) buffer holds", async () => {
    const w = await startedWithStationsAndVisual();
    const req = sampleRequest(22, T_PASS / 100, 100);
    w.send(req);
    const reply = w.of("sample").at(-1);
    expect(reply?.buffer.byteLength).toBe(22 * SAMPLE_STRIDE * 4);
    expect(new Float32Array(req.buffer)[SampleField.valid]).toBe(1);
  });

  it("propagates for the site set last: setSite moves the observer", async () => {
    const w = await startedWithStationsAndVisual();
    const other: ObserverSite = { latDeg: 47.1, lonDeg: 9.3, heightM: 500 };
    w.send({ type: "setSite", site: other, generation: 2 });
    const req = sampleRequest(175, T_PASS / 100, 100, 0b011, 2);
    w.send(req);
    const satrec = referenceSatrecs().satrecs[0];
    if (satrec === undefined) throw new Error("no ISS");
    const expected = new Float32Array(SAMPLE_STRIDE);
    writeSample(satrec, createPropagationContext(T_PASS, other), expected, 0);
    expect([...new Float32Array(req.buffer).subarray(0, SAMPLE_STRIDE)]).toEqual([...expected]);
    const atHome = new Float32Array(SAMPLE_STRIDE);
    writeSample(satrec, createPropagationContext(T_PASS, SITE), atHome, 0);
    expect(expected[0]).not.toBe(atHome[0]);
  });

  it("warns once per object when propagation fails, with the NORAD id and satrec.error", async () => {
    const iss = (JSON.parse(fixture("stations.json")) as Record<string, unknown>[])[0];
    const bad = JSON.stringify([
      { ...iss, NORAD_CAT_ID: 99999, OBJECT_NAME: "BAD", BSTAR: 0.05, MEAN_MOTION_DOT: 0.1 },
    ]);
    const w = await startWorker({ [`${BASE}starlink.json`]: () => jsonResponse(bad) });
    w.send({ type: "init", site: SITE, generation: 0 });
    w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    w.send({ type: "loadGroup", group: "starlink", url: `${BASE}starlink.json` });
    await loaded(w, 2);
    const t = Date.parse("2027-01-01T00:00:00Z");
    const warnings = (): string[] => vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    const counts: number[] = [];
    for (let n = 0; n < 2; n++) {
      const req = sampleRequest(23, t / 100, 100, 0b111);
      w.send(req);
      const data = new Float32Array(req.buffer);
      expect([...data.subarray(22 * SAMPLE_STRIDE)]).toEqual(new Array(8).fill(0));
      expect(data[SampleField.valid]).toBe(1); // the ISS still propagates
      counts.push(warnings().length);
    }
    // Four real station objects have decayed by then too (66052, 67686, 67687, 67688); each warns once.
    expect(counts).toEqual([5, 5]);
    expect(warnings().filter((m) => m.includes("99999"))).toEqual([
      "NORAD 99999: propagation failed (satrec error 1)",
    ]);
  });

  it("[M9] culls Starlink on consecutive samples, and follows the request's group mask", async () => {
    const w = await startedWithStationsAndVisual();
    w.send({ type: "loadGroup", group: "starlink", url: `${BASE}starlink.json` });
    await loaded(w, 3);
    const count = 11_277;
    const k0 = Math.floor(T_PASS / 100);
    const run = (k: number, groups: number): Float32Array => {
      const req = sampleRequest(count, k, 100, groups, 3);
      w.send(req);
      return new Float32Array(req.buffer);
    };
    run(k0, 0b111); // a full pass after groupLoaded
    const second = run(k0 + 1, 0b111);
    // Stations and visual are always propagated in full: the ISS row equals writeSample at t_k.
    const satrec = referenceSatrecs().satrecs[0];
    if (satrec === undefined) throw new Error("no ISS");
    const iss = new Float32Array(SAMPLE_STRIDE);
    writeSample(satrec, createPropagationContext((k0 + 1) * 100, SITE), iss, 0);
    expect([...second.subarray(0, SAMPLE_STRIDE)]).toEqual([...iss]);
    let validStarlink = 0;
    for (let i = 175; i < count; i++)
      if (second[i * SAMPLE_STRIDE + SampleField.valid] === 1) validStarlink++;
    expect(validStarlink).toBeGreaterThan(11_000); // extrapolated rows keep their held valid flag
    // Starlink off: its rows are zeroed at once, stations and visual still propagate.
    const off = run(k0 + 2, 0b011);
    for (let i = 175; i < count; i++) expect(off[i * SAMPLE_STRIDE + SampleField.valid]).toBe(0);
    expect(off[SampleField.valid]).toBe(1);
  });

  it("replies with an error message, not a sample, before init", async () => {
    const w = await startWorker();
    w.send(sampleRequest(1, 1, 100));
    expect(w.posted.map((p) => p.msg.type)).toEqual(["error"]);
  });
});

describe("tracks", () => {
  it("rebuilds the selected track ±10 min and the others ±3 min on the absolute 20 s grid", async () => {
    const w = await startedWithStationsAndVisual();
    const t = T_PASS + 7_000; // inside a 20 s slot
    w.send({
      type: "tracks",
      requestId: 4,
      timeMs: t,
      selectedIndex: 0,
      otherIndices: Int32Array.from([22, 0, 23]),
    });
    const reply = w.posted.at(-1);
    if (reply?.msg.type !== "tracks") throw new Error("no tracks reply");
    expect(reply.msg.requestId).toBe(4);
    const tracks = reply.msg.tracks;
    expect(tracks.map((tr) => tr.index)).toEqual([0, 22, 23]); // the selected one once, first
    expect(tracks.map((tr) => tr.lonLatDeg.length / 2)).toEqual([61, 19, 19]);
    expect(tracks[0]?.firstPointMs).toBe(floorToStepMs(t, TRACK_STEP_MS) - 600_000);
    expect(tracks[1]?.firstPointMs).toBe(floorToStepMs(t, TRACK_STEP_MS) - 180_000);
    expect(reply.transfer).toEqual(tracks.map((tr) => tr.lonLatDeg.buffer));
    const ref = new Float64Array(122);
    const satrec = referenceSatrecs().satrecs[0];
    if (satrec === undefined) throw new Error("no ISS");
    expect(trackLonLatDeg(satrec, t, 600_000, ref)).toBe(61);
    expect(tracks[0]?.lonLatDeg).toEqual(ref);
  });

  it("skips indices it has no satellite for and still replies", async () => {
    const w = await startedWithStationsAndVisual();
    w.send({
      type: "tracks",
      requestId: 1,
      timeMs: T_PASS,
      selectedIndex: null,
      otherIndices: Int32Array.from([9999, -1]),
    });
    expect(w.of("tracks")).toEqual([{ type: "tracks", requestId: 1, tracks: [] }]);
  });
});

describe("skyPaths", () => {
  it("writes ENU on the absolute 2 s grid covering [fromMs, toMs], one context per step", async () => {
    const w = await startedWithStationsAndVisual();
    const fromMs = T_PASS - 30_000 - 200 + 300; // not on the grid
    const toMs = T_PASS + 120_000 + 200;
    w.send({
      type: "skyPaths",
      requestId: 9,
      generation: 3,
      fromMs,
      toMs,
      indices: Int32Array.from([0, 22]),
    });
    const reply = w.posted.at(-1);
    if (reply?.msg.type !== "skyPaths") throw new Error("no skyPaths reply");
    expect(reply.msg).toMatchObject({ requestId: 9, generation: 3 });
    const firstMs = Math.ceil(fromMs / SKY_PATH_STEP_MS) * SKY_PATH_STEP_MS;
    const steps = Math.floor((toMs - firstMs) / SKY_PATH_STEP_MS) + 1;
    expect(steps).toBe(75); // T is on the grid: [T − 28 s, T + 120 s]
    const [iss, other] = reply.msg.paths;
    expect(iss?.index).toBe(0);
    expect(other?.index).toBe(22);
    expect(iss?.firstPointMs).toBe(firstMs);
    expect(iss?.enuKm.length).toBe(3 * steps);
    expect(reply.transfer).toEqual(reply.msg.paths.map((p) => p.enuKm.buffer));
    const satrec = referenceSatrecs().satrecs[0];
    if (satrec === undefined) throw new Error("no ISS");
    const slot = new Float32Array(SAMPLE_STRIDE);
    for (const s of [0, 37, steps - 1]) {
      writeSample(satrec, createPropagationContext(firstMs + s * SKY_PATH_STEP_MS, SITE), slot, 0);
      expect([...(iss?.enuKm.subarray(3 * s, 3 * s + 3) ?? [])]).toEqual([...slot.subarray(0, 3)]);
    }
  });

  it("ends a path early at the first failed propagation", async () => {
    const iss = (JSON.parse(fixture("stations.json")) as Record<string, unknown>[])[0];
    const bad = JSON.stringify([
      { ...iss, NORAD_CAT_ID: 99999, OBJECT_NAME: "BAD", BSTAR: 0.05, MEAN_MOTION_DOT: 0.1 },
    ]);
    const w = await startWorker({ [`${BASE}starlink.json`]: () => jsonResponse(bad) });
    w.send({ type: "init", site: SITE, generation: 0 });
    w.send({ type: "loadGroup", group: "stations", url: `${BASE}stations.json` });
    w.send({ type: "loadGroup", group: "starlink", url: `${BASE}starlink.json` });
    await loaded(w, 2);
    const t = Date.parse("2027-01-01T00:00:00Z");
    w.send({
      type: "skyPaths",
      requestId: 1,
      generation: 0,
      fromMs: t,
      toMs: t + 10_000,
      indices: Int32Array.from([0, 22]),
    });
    const paths = w.of("skyPaths")[0]?.paths ?? [];
    expect(paths.map((p) => p.enuKm.length)).toEqual([18, 0]);
  });
});

describe("M8 incoming (step 5)", () => {
  /** synthetic-maunakea's camera, as ephemeris.ts sends it; SITE is its site. */
  const FISHEYE_INPUT: CameraModelInput = {
    lens: "fisheye-equidistant",
    calibration: syntheticFisheyeCalibration(1024),
    widthPx: 1024,
    heightPx: 1024,
  };
  const T_INCOMING = Date.parse("2026-10-11T15:05:07Z");
  const etas = (w: Harness): [number, number][] => {
    const { noradIds } = catalogOf(w);
    return (w.of("incoming").at(-1)?.entries ?? []).map((e) => [noradIds[e.index] ?? -1, e.etaSec]);
  };

  it("answers with no entries and computeMs 0 without a camera, or before init", async () => {
    const early = await startWorker();
    early.send({ type: "setCamera", camera: FISHEYE_INPUT });
    early.send({ type: "incoming", requestId: 1, timeMs: T_INCOMING, groups: 0b011 });
    expect(early.of("incoming")).toEqual([
      { type: "incoming", requestId: 1, timeMs: T_INCOMING, computeMs: 0, entries: [] },
    ]);

    const w = await startedWithStationsAndVisual();
    const before = w.posted.length;
    w.send({ type: "setCamera", camera: null });
    expect(w.posted).toHaveLength(before); // setCamera has no reply
    w.send({ type: "incoming", requestId: 5, timeMs: T_PASS, groups: 0b011 });
    expect(w.of("incoming")).toEqual([
      { type: "incoming", requestId: 5, timeMs: T_PASS, computeMs: 0, entries: [] },
    ]);
  });

  it("lists the ISS and SL-3 R/B 19046 on the fisheye at 15:05:07Z, sorted, with computeMs", async () => {
    const w = await startedWithStationsAndVisual();
    w.send({ type: "setCamera", camera: FISHEYE_INPUT });
    w.send({ type: "incoming", requestId: 7, timeMs: T_INCOMING, groups: 0b011 });
    const reply = w.of("incoming").at(-1);
    expect(reply).toMatchObject({ type: "incoming", requestId: 7, timeMs: T_INCOMING });
    expect(reply?.computeMs).toBeGreaterThan(0);
    expect(etas(w)).toEqual([
      [25544, 35],
      [19046, 55],
    ]);
    // Only the groups asked for: Starlink alone is not loaded, so nothing.
    w.send({ type: "incoming", requestId: 8, timeMs: T_INCOMING, groups: 0b100 });
    expect(etas(w)).toEqual([]);
  });

  it("uses the stored horizon profile, and setSite resets it to the geometric horizon", async () => {
    const w = await startedWithStationsAndVisual();
    w.send({ type: "setCamera", camera: FISHEYE_INPUT });
    w.send({ type: "setHorizonProfile", profileDeg: new Float32Array(360).fill(30) });
    w.send({ type: "incoming", requestId: 1, timeMs: T_INCOMING, groups: 0b011 });
    expect(etas(w)).toEqual([]); // both enter below 30°
    w.send({ type: "setSite", site: { ...SITE }, generation: 1 });
    w.send({ type: "incoming", requestId: 2, timeMs: T_INCOMING, groups: 0b011 });
    expect(etas(w).map(([norad]) => norad)).toEqual([25544, 19046]);
    w.send({ type: "setHorizonProfile", profileDeg: new Float32Array(360).fill(-0.27) });
    w.send({ type: "incoming", requestId: 3, timeMs: T_INCOMING, groups: 0b011 });
    expect(etas(w).map(([norad]) => norad)).toEqual([25544, 19046]);
  });
});
