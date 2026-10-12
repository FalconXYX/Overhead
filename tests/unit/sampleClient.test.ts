// tests/unit/sampleClient.test.ts — the README section 5 sample lifecycle without a Worker (M3 step 11, section 5).
// A fake worker answers each request after a fixed wall-clock latency; the app's frame loop runs at 60 fps.
import { describe, expect, it } from "vitest";
import { SAMPLE_STRIDE, SampleField } from "../../src/domain/orbits";
import { POOL_SIZE, SampleClient, type SamplePair } from "../../src/state/sampleClient";
import type { PropagationIn, PropagationOut } from "../../src/workers/protocol";

type SampleRequest = Extract<PropagationIn, { type: "sample" }>;
type SampleReply = Extract<PropagationOut, { type: "sample" }>;

const FRAME_MS = 1000 / 60;
const T0 = Date.parse("2026-10-11T15:09:50Z");
const STATIONS_AND_VISUAL = 0b011;
const ALL_GROUPS = 0b111;
const COUNT = 175; // ISS + visual, drawn

/** The worker's side: answers every request after `latencyMs` of wall time, writing k into the buffer. */
class FakeWorker {
  readonly requests: SampleRequest[] = [];
  /** Every distinct ArrayBuffer ever posted. In Node nothing is really transferred, so identity is stable. */
  readonly buffers = new Set<ArrayBuffer>();
  latencyMs: number;
  private readonly pending: { dueMs: number; reply: SampleReply }[] = [];
  wallMs = 0;

  constructor(latencyMs: number) {
    this.latencyMs = latencyMs;
  }

  readonly post = (msg: SampleRequest, transfer: Transferable[]): void => {
    expect(transfer).toEqual([msg.buffer]);
    this.requests.push(msg);
    this.buffers.add(msg.buffer);
    const data = new Float32Array(msg.buffer);
    for (let i = 0; i < data.length / SAMPLE_STRIDE; i++) {
      data[i * SAMPLE_STRIDE] = msg.k % 1000; // a marker: which k this buffer holds
      data[i * SAMPLE_STRIDE + SampleField.valid] = 1;
    }
    const reply: SampleReply = {
      type: "sample",
      generation: msg.generation,
      k: msg.k,
      timeMs: msg.k * msg.stepMs,
      sunAltDeg: -16.2,
      computeMs: 0.2,
      buffer: msg.buffer,
    };
    this.pending.push({ dueMs: this.wallMs + this.latencyMs, reply });
  };

  /** Hands every reply due by wallMs to the client, oldest first. */
  deliver(client: SampleClient, wallMs: number): void {
    this.wallMs = wallMs;
    this.pending.sort((p, q) => p.dueMs - q.dueMs);
    while (
      this.pending.length > 0 &&
      (this.pending[0]?.dueMs ?? Number.POSITIVE_INFINITY) <= wallMs
    ) {
      const next = this.pending.shift();
      if (next !== undefined) client.onSample(next.reply);
    }
  }

  /** Replies not yet delivered, oldest first (for tests that deliver by hand). */
  takeAll(): SampleReply[] {
    const replies = this.pending.map((p) => p.reply);
    this.pending.length = 0;
    return replies;
  }
}

interface RunStats {
  frames: number;
  /** Frames before the first pair. */
  warmup: number;
  /** Null frames after the first pair. */
  nulls: number;
  /** Frames with b === a (the next sample is late) after the first pair. */
  holds: number;
}

/**
 * Plays `frames` frames from wall time `startWallMs`, render time = renderAt(wallMs). Checks on every pair that the
 * client never extrapolates: a is at or before the render time, and b (when not a) is the next grid sample after it.
 */
function play(
  client: SampleClient,
  worker: FakeWorker,
  opts: {
    frames: number;
    startWallMs?: number;
    renderAt: (wallMs: number) => number;
    stepMs: number;
    groups?: number;
    onFrame?: (frame: number, pair: SamplePair | null) => void;
  },
): RunStats {
  const stats: RunStats = { frames: opts.frames, warmup: 0, nulls: 0, holds: 0 };
  let ready = false;
  for (let f = 0; f < opts.frames; f++) {
    const wallMs = (opts.startWallMs ?? 0) + f * FRAME_MS;
    worker.deliver(client, wallMs);
    const renderMs = opts.renderAt(wallMs);
    const pair = client.frame(renderMs, opts.stepMs, opts.groups ?? STATIONS_AND_VISUAL);
    opts.onFrame?.(f, pair);
    if (pair === null) {
      if (ready) stats.nulls++;
      else stats.warmup++;
      continue;
    }
    ready = true;
    const { a, b } = pair;
    expect(a.timeMs).toBe(a.k * opts.stepMs);
    expect(a.timeMs).toBeLessThanOrEqual(renderMs);
    expect(a.data[0]).toBe(a.k % 1000);
    if (b === a) {
      stats.holds++;
    } else {
      expect(b.k).toBe(a.k + 1);
      expect(renderMs).toBeLessThan(b.timeMs);
      expect(b.data[0]).toBe(b.k % 1000);
    }
  }
  return stats;
}

const RATES = [1, 10, 60, 600] as const;

describe("SampleClient: steady state", () => {
  it.each(RATES)(
    "plays 10 s at %i× with 20 ms latency: 0 holds, 0 empty frames, 3 buffers",
    (rate) => {
      const worker = new FakeWorker(20);
      const client = new SampleClient(worker.post);
      client.resize(COUNT);
      const stepMs = 100 * rate;
      const stats = play(client, worker, {
        frames: 600,
        renderAt: (wallMs) => T0 + wallMs * rate,
        stepMs,
      });
      expect(stats.warmup).toBeLessThanOrEqual(2); // the first replies arrive 20 ms after the first frame
      expect(stats.nulls).toBe(0);
      expect(stats.holds).toBe(0);
      expect(worker.buffers.size).toBe(POOL_SIZE);
      for (const buffer of worker.buffers)
        expect(buffer.byteLength).toBe(COUNT * SAMPLE_STRIDE * 4);
      // Every request is on the absolute grid, in the client's current generation.
      for (const r of worker.requests) {
        expect(r.stepMs).toBe(stepMs);
        expect(r.groups).toBe(STATIONS_AND_VISUAL);
        expect(Number.isInteger(r.k)).toBe(true);
      }
    },
  );

  it("requests k, k + 1 and k + 2 first, nearest first, and never more than the pool", () => {
    const worker = new FakeWorker(20);
    const client = new SampleClient(worker.post);
    client.resize(COUNT);
    expect(client.frame(T0 + 50, 100, STATIONS_AND_VISUAL)).toBeNull();
    const k = Math.floor((T0 + 50) / 100);
    expect(worker.requests.map((r) => r.k)).toEqual([k, k + 1, k + 2]);
    expect(client.frame(T0 + 60, 100, STATIONS_AND_VISUAL)).toBeNull();
    expect(worker.requests).toHaveLength(3); // the pool is empty: skip, never allocate
  });

  it("returns null before the first resize and posts nothing", () => {
    const worker = new FakeWorker(20);
    const client = new SampleClient(worker.post);
    expect(client.frame(T0, 100, STATIONS_AND_VISUAL)).toBeNull();
    expect(worker.requests).toHaveLength(0);
  });

  it("holds sample timeMs as the plain number k × stepMs, never a Float32 value", () => {
    const worker = new FakeWorker(0);
    const client = new SampleClient(worker.post);
    client.resize(1);
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    worker.deliver(client, 0);
    const pair = client.frame(T0 + 1, 100, STATIONS_AND_VISUAL);
    expect(pair?.a.timeMs).toBe(T0);
    expect(pair?.b.timeMs).toBe(T0 + 100);
    expect(pair?.a.sunAltDeg).toBe(-16.2);
    expect(Math.fround(T0)).not.toBe(T0); // the reason it must stay a number
  });
});

describe("SampleClient: seeks, stalls and flushes", () => {
  it.each(RATES)("recovers from a 1 h seek at %i×: 2 empty frames, then none", (rate) => {
    const worker = new FakeWorker(20);
    const client = new SampleClient(worker.post);
    client.resize(COUNT);
    const stepMs = 100 * rate;
    const before = play(client, worker, {
      frames: 120,
      renderAt: (wallMs) => T0 + wallMs * rate,
      stepMs,
    });
    expect(before.nulls + before.holds).toBe(0);
    const generation = client.generation;
    const seekWallMs = 120 * FRAME_MS;
    const empty: number[] = [];
    const after = play(client, worker, {
      frames: 480,
      startWallMs: seekWallMs,
      renderAt: (wallMs) => T0 + 3_600_000 + (wallMs - seekWallMs) * rate,
      stepMs,
      onFrame: (f, pair) => {
        if (pair === null) empty.push(f);
      },
    });
    expect(client.generation).toBe(generation + 1); // one flush
    expect(empty).toEqual([0, 1]);
    expect(after.nulls).toBe(0);
    expect(after.holds).toBe(0);
    expect(worker.buffers.size).toBe(POOL_SIZE);
  });

  it.each(RATES)(
    "with 150 ms latency at %i× it holds instead of extrapolating, never empty",
    (rate) => {
      const worker = new FakeWorker(150);
      const client = new SampleClient(worker.post);
      client.resize(COUNT);
      const stats = play(client, worker, {
        frames: 600,
        renderAt: (wallMs) => T0 + wallMs * rate,
        stepMs: 100 * rate,
      });
      expect(stats.holds).toBeGreaterThan(0);
      expect(stats.nulls).toBe(0);
      expect(worker.buffers.size).toBe(POOL_SIZE);
    },
  );

  it("a flush with requests outstanding (mask change, 60 ms latency, 60×) holds for 2 frames at most", () => {
    const worker = new FakeWorker(60);
    const client = new SampleClient(worker.post);
    client.resize(COUNT);
    const rate = 60;
    const stepMs = 100 * rate;
    const before = play(client, worker, {
      frames: 300,
      renderAt: (wallMs) => T0 + wallMs * rate,
      stepMs,
      groups: STATIONS_AND_VISUAL,
    });
    expect(before.nulls + before.holds).toBe(0);
    // The same run continues with Starlink switched on: one flush with a request for k + 2 in flight.
    const generation = client.generation;
    const after = play(client, worker, {
      frames: 300,
      startWallMs: 300 * FRAME_MS,
      renderAt: (wallMs) => T0 + wallMs * rate,
      stepMs,
      groups: ALL_GROUPS,
    });
    expect(client.generation).toBe(generation + 1);
    expect(after.warmup).toBeLessThanOrEqual(Math.ceil(60 / FRAME_MS)); // until the new k and k + 1 arrive
    expect(after.nulls).toBe(0);
    expect(after.holds).toBeLessThanOrEqual(2); // 12 if the flush kept the stale k + 2 in the in-flight set
    expect(worker.requests.at(-1)?.groups).toBe(ALL_GROUPS);
    expect(worker.buffers.size).toBe(POOL_SIZE);
  });

  it("flushes when stepMs changes or the group mask changes", () => {
    const worker = new FakeWorker(0);
    const client = new SampleClient(worker.post);
    expect(client.generation).toBe(0);
    client.resize(COUNT);
    expect(client.generation).toBe(1);
    client.frame(T0, 100, STATIONS_AND_VISUAL); // the first frame sets stepMs and groups: one flush
    const g = client.generation;
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    expect(client.generation).toBe(g);
    worker.deliver(client, 0);
    client.frame(T0, 1000, STATIONS_AND_VISUAL);
    expect(client.generation).toBe(g + 1);
    worker.deliver(client, 0);
    client.frame(T0, 1000, ALL_GROUPS);
    expect(client.generation).toBe(g + 2);
    expect(worker.requests.at(-1)).toMatchObject({
      generation: g + 2,
      stepMs: 1000,
      groups: ALL_GROUPS,
    });
  });

  it("flushes when the render time leaves [t_first, t_first + 2D], in both directions", () => {
    const worker = new FakeWorker(1000);
    const client = new SampleClient(worker.post);
    client.resize(1);
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    for (const r of worker.takeAll()) client.onSample(r);
    const g = client.generation;
    expect(client.frame(T0 + 150, 100, STATIONS_AND_VISUAL)?.a.timeMs).toBe(T0 + 100); // k released
    expect(client.frame(T0 + 120, 100, STATIONS_AND_VISUAL)).not.toBeNull(); // t_first is now T0 + 100
    expect(client.generation).toBe(g);
    expect(client.frame(T0 + 99, 100, STATIONS_AND_VISUAL)).toBeNull(); // before t_first: a step back
    expect(client.generation).toBe(g + 1);

    const forward = new SampleClient(worker.post);
    forward.resize(1);
    forward.frame(T0, 100, STATIONS_AND_VISUAL);
    for (const r of worker.takeAll()) forward.onSample(r);
    const h = forward.generation;
    expect(forward.frame(T0 + 200, 100, STATIONS_AND_VISUAL)).not.toBeNull(); // t_first + 2D: inside
    expect(forward.generation).toBe(h);
    const late = new SampleClient(worker.post);
    late.resize(1);
    late.frame(T0, 100, STATIONS_AND_VISUAL);
    for (const r of worker.takeAll()) late.onSample(r);
    const j = late.generation;
    expect(late.frame(T0 + 201, 100, STATIONS_AND_VISUAL)).toBeNull(); // past t_first + 2D: a stall or a jump
    expect(late.generation).toBe(j + 1);
  });
});

describe("SampleClient: replies", () => {
  it("returns a stale-generation reply to the pool without touching the in-flight set", () => {
    const worker = new FakeWorker(1000);
    const client = new SampleClient(worker.post);
    client.resize(1);
    const k = Math.floor(T0 / 100);
    client.frame(T0, 100, STATIONS_AND_VISUAL); // posts k, k+1, k+2 in generation g
    const g = client.generation;
    const old = worker.takeAll();
    client.flush();
    expect(client.frame(T0, 100, STATIONS_AND_VISUAL)).toBeNull();
    expect(worker.requests).toHaveLength(3); // the pool is empty until the old buffers return
    const [first, ...rest] = old;
    if (first === undefined) throw new Error("no requests");
    client.onSample(first); // generation g: recycled, not held
    expect(client.frame(T0, 100, STATIONS_AND_VISUAL)).toBeNull();
    expect(worker.requests).toHaveLength(4);
    expect(worker.requests[3]).toMatchObject({ k, generation: g + 1 });
    for (const r of rest) client.onSample(r);
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    expect(worker.requests.slice(4).map((r) => r.k)).toEqual([k + 1, k + 2]);
    for (const r of worker.takeAll()) client.onSample(r);
    const pair = client.frame(T0, 100, STATIONS_AND_VISUAL);
    expect(pair?.a.k).toBe(k);
    expect(pair?.b.k).toBe(k + 1);
    expect(worker.buffers.size).toBe(POOL_SIZE);
  });

  it("drops a reply whose buffer has the size from before a resize", () => {
    const worker = new FakeWorker(1000);
    const client = new SampleClient(worker.post);
    client.resize(2);
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    const old = worker.takeAll();
    client.resize(3); // a group loaded: three new buffers of the new size
    for (const r of old) client.onSample(r);
    for (let f = 0; f < 4; f++) {
      client.frame(T0, 100, STATIONS_AND_VISUAL);
      for (const r of worker.takeAll()) client.onSample(r);
    }
    const posted = worker.requests.slice(old.length);
    expect(posted.length).toBeGreaterThan(0);
    for (const r of posted) expect(r.buffer.byteLength).toBe(3 * SAMPLE_STRIDE * 4);
    expect(worker.buffers.size).toBe(2 * POOL_SIZE);
    const pair = client.frame(T0, 100, STATIONS_AND_VISUAL);
    expect(pair?.a.data.length).toBe(3 * SAMPLE_STRIDE);
  });

  it("keeps its buffers when resized to the same count", () => {
    const worker = new FakeWorker(20);
    const client = new SampleClient(worker.post);
    client.resize(COUNT);
    play(client, worker, { frames: 60, renderAt: (w) => T0 + w, stepMs: 100 });
    client.resize(COUNT); // a group that added no new objects
    const stats = play(client, worker, {
      frames: 60,
      startWallMs: 60 * FRAME_MS,
      renderAt: (w) => T0 + w,
      stepMs: 100,
    });
    expect(stats.nulls).toBe(0);
    expect(worker.buffers.size).toBe(POOL_SIZE);
  });

  it("orders held samples by k whatever order the replies arrive in, and holds a late one", () => {
    const worker = new FakeWorker(1000);
    const client = new SampleClient(worker.post);
    client.resize(1);
    const k = Math.floor(T0 / 100);
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    const [rk, rk1, rk2] = worker.takeAll();
    if (rk === undefined || rk1 === undefined || rk2 === undefined) throw new Error("3 requests");
    client.onSample(rk2);
    client.onSample(rk);
    // k + 1 is late: hold k (b === a), never extrapolate toward k + 2.
    const hold = client.frame(T0 + 50, 100, STATIONS_AND_VISUAL);
    expect(hold?.a.k).toBe(k);
    expect(hold?.b).toBe(hold?.a);
    client.onSample(rk1);
    const pair = client.frame(T0 + 60, 100, STATIONS_AND_VISUAL);
    expect(pair?.a.k).toBe(k);
    expect(pair?.b.k).toBe(k + 1);
  });

  it("releases a sample once the render time passes the next one, and reuses its buffer for k + 3", () => {
    const worker = new FakeWorker(1000);
    const client = new SampleClient(worker.post);
    client.resize(1);
    const k = Math.floor(T0 / 100);
    client.frame(T0, 100, STATIONS_AND_VISUAL);
    const first = worker.takeAll();
    for (const r of first) client.onSample(r);
    const pair = client.frame(T0 + 100, 100, STATIONS_AND_VISUAL); // now in [t_k+1, t_k+2)
    expect(pair?.a.k).toBe(k + 1);
    expect(pair?.b.k).toBe(k + 2);
    const next = worker.requests.at(-1);
    expect(next?.k).toBe(k + 3);
    expect(next?.buffer).toBe(first[0]?.buffer); // sample k's buffer
  });
});
