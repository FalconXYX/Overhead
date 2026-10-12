// tests/unit/horizonWorker.test.ts — horizon.worker.ts's own part (M6 step 6): the createImageBitmap options, plain
// GETs with the URL only, one compute at a time in arrival order, the transferred profile, and error replies. Driven
// in Node: the worker's addEventListener, postMessage, fetch, createImageBitmap and OffscreenCanvas are stubbed, and
// every tile is the committed flat.png (0 m), so the profile is the sea horizon from mastM.
import { afterEach, describe, expect, it, vi } from "vitest";
import { apparentElevationDeg, marchLimitM } from "../../src/domain/terrain";
import type { HorizonIn, HorizonOut } from "../../src/workers/protocol";
import { decodePng } from "../helpers/decodePng";
import { flatPngBytes } from "../helpers/terrainFixtures";

interface Posted {
  msg: HorizonOut;
  transfer: Transferable[];
}

interface Harness {
  send(msg: HorizonIn): void;
  posted: Posted[];
  fetchArgs: unknown[][];
  bitmapOptions: unknown[];
}

/** Imports a fresh worker module with stubbed globals. `failUrl` answers 503 for URLs containing it. */
async function startWorker(failUrl: string | null = null): Promise<Harness> {
  const posted: Posted[] = [];
  const fetchArgs: unknown[][] = [];
  const bitmapOptions: unknown[] = [];
  let listener: ((e: MessageEvent<HorizonIn>) => void) | null = null;
  vi.stubGlobal("addEventListener", (type: string, fn: (e: MessageEvent<HorizonIn>) => void) => {
    expect(type).toBe("message");
    listener = fn;
  });
  vi.stubGlobal("postMessage", (msg: HorizonOut, options: { transfer?: Transferable[] }) => {
    posted.push({ msg, transfer: options.transfer ?? [] });
  });
  const flat = flatPngBytes();
  vi.stubGlobal("fetch", async (...args: unknown[]) => {
    fetchArgs.push(args);
    const url = String(args[0]);
    if (failUrl !== null && url.includes(failUrl)) return new Response("", { status: 503 });
    return new Response(new Blob([new Uint8Array(flat)]), {
      status: 200,
      headers: { "x-amz-meta-x-imagery-sources": "etopo1/ETOPO1_Bed_g.tif" },
    });
  });
  // A bitmap is the decoded RGBA; drawImage keeps it; getImageData hands it back.
  vi.stubGlobal("createImageBitmap", async (blob: Blob, options: unknown) => {
    bitmapOptions.push(options);
    return { rgba: decodePng(new Uint8Array(await blob.arrayBuffer())).rgba, close: () => {} };
  });
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext(type: string, options: { willReadFrequently?: boolean }) {
        expect(type).toBe("2d");
        expect(options.willReadFrequently).toBe(true);
        let drawn: Uint8ClampedArray = new Uint8ClampedArray(0);
        return {
          clearRect: () => {},
          drawImage: (bmp: { rgba: Uint8ClampedArray }) => {
            drawn = bmp.rgba;
          },
          getImageData: () => ({ data: drawn }),
        };
      }
    },
  );
  vi.resetModules();
  await import("../../src/workers/horizon.worker");
  return {
    send(msg) {
      if (listener === null) throw new Error("the worker registered no message listener");
      listener(new MessageEvent("message", { data: msg }));
    },
    posted,
    fetchArgs,
    bitmapOptions,
  };
}

const compute = (requestId: number, mastM: number): HorizonIn => ({
  type: "compute",
  requestId,
  cameraId: `cam-${requestId}`,
  latDeg: 10,
  lonDeg: 20,
  mastM,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("horizon.worker", () => {
  it("answers one compute at a time, in arrival order, and transfers the profile", async () => {
    const w = await startWorker();
    w.send(compute(1, 100));
    w.send(compute(2, 200));
    await vi.waitFor(() => expect(w.posted.filter((p) => p.msg.type === "done")).toHaveLength(2), {
      timeout: 20_000,
    });
    // Every message of request 1 precedes every message of request 2.
    const ids = w.posted.map((p) => p.msg.requestId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const progress = w.posted.filter((p) => p.msg.type === "progress" && p.msg.requestId === 1);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress.at(-1)?.msg;
    if (last?.type !== "progress") throw new Error("no progress");
    expect(last.tilesDone).toBe(last.tilesTotal);

    const done = w.posted.find((p) => p.msg.type === "done" && p.msg.requestId === 2);
    if (done?.msg.type !== "done") throw new Error("no done");
    expect(done.msg.cameraId).toBe("cam-2");
    expect(done.msg.groundM).toBe(0);
    expect(done.msg.z0M).toBe(200);
    expect(done.msg.limitM).toBe(marchLimitM(200));
    expect(done.msg.imagerySources).toEqual(["etopo1"]);
    expect(done.msg.profileDeg).toHaveLength(360);
    expect(done.transfer).toEqual([done.msg.profileDeg.buffer]);
    // Flat sea from 200 m: the march's best sample sits near the sea-horizon tangent.
    const sea = Math.max(
      ...Array.from({ length: 2000 }, (_, k) => apparentElevationDeg(0, 200, 20 + k * 50)),
    );
    for (const v of done.msg.profileDeg) expect(Math.abs(v - sea)).toBeLessThan(0.01);
  });

  it("fetches with the URL only (plain GET) and decodes without colour management", async () => {
    const w = await startWorker();
    w.send(compute(1, 10));
    await vi.waitFor(() => expect(w.posted.some((p) => p.msg.type === "done")).toBe(true), {
      timeout: 20_000,
    });
    expect(w.fetchArgs.length).toBeGreaterThan(0);
    for (const args of w.fetchArgs) {
      expect(args).toHaveLength(1);
      expect(String(args[0])).toMatch(
        /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/,
      );
    }
    for (const options of w.bitmapOptions) {
      expect(options).toEqual({ colorSpaceConversion: "none", premultiplyAlpha: "none" });
    }
  });

  it("a failed tile ends the compute with error, and the next compute still runs", async () => {
    const w = await startWorker("/terrarium/8/");
    w.send(compute(1, 10));
    w.send({ ...compute(2, 10), latDeg: 0.01 });
    await vi.waitFor(() => expect(w.posted.filter((p) => p.msg.type === "error")).toHaveLength(2), {
      timeout: 20_000,
    });
    const errors = w.posted.map((p) => p.msg).filter((m) => m.type === "error");
    expect(errors.map((m) => m.requestId)).toEqual([1, 2]);
    expect(errors[0]?.message).toMatch(/^terrain tile 8\/\d+\/\d+: HTTP 503$/);
    expect(w.posted.some((p) => p.msg.type === "done")).toBe(false);
  });
});
