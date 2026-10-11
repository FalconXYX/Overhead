// src/state/sampleClient.ts — the README section 5 sample lifecycle without a Worker, so Node tests can drive it
// (M3 step 11). ephemeris.ts owns the one instance and wires `post` to the propagation worker.
import { type GroupMask, SAMPLE_STRIDE } from "../domain/orbits";
import type { PropagationIn, PropagationOut } from "../workers/protocol";

type SampleRequest = Extract<PropagationIn, { type: "sample" }>;
type SampleReply = Extract<PropagationOut, { type: "sample" }>;

/** Buffers per catalogue size: samples k and k + 1 held, k + 2 in flight. */
export const POOL_SIZE = 3;

export interface HeldSample {
  k: number;
  timeMs: number; // k × stepMs, a plain number (never Float32)
  data: Float32Array<ArrayBuffer>; // count × SAMPLE_STRIDE
  sunAltDeg: number;
}

/** b === a while the next sample is late (hold, never extrapolate). */
export interface SamplePair {
  a: HeldSample;
  b: HeldSample;
}

/**
 * Section 5 sample lifecycle without a Worker, so Node tests can drive it.
 *
 * Every buffer of the current size is always in exactly one place: the pool, `held`, or with the worker. A request
 * transfers its buffer (the sender's copy detaches, gotcha 16) and only the reply brings it back, so the client never
 * keeps a reference to a buffer it has posted.
 */
export class SampleClient {
  /** Bumped by every flush; replies from an older generation go straight back to the pool. */
  generation = 0;
  private readonly post: (msg: SampleRequest, transfer: Transferable[]) => void;
  private pool: ArrayBuffer[] = [];
  /** Current-generation samples, sorted by k. */
  private held: HeldSample[] = [];
  /** k of every current-generation request not answered yet. */
  private readonly inFlight = new Set<number>();
  /** byteLength of the current buffers: count × SAMPLE_STRIDE × 4. */
  private bufferBytes = 0;
  private stepMs = Number.NaN;
  private groups: GroupMask = -1;

  constructor(post: (msg: SampleRequest, transfer: Transferable[]) => void) {
    this.post = post;
  }

  /**
   * After a group loads: a pool of POOL_SIZE buffers for totalCount objects, then a flush. Samples of the old size
   * are dropped, here and when they come back from the worker. The same size keeps the buffers it has.
   */
  resize(totalCount: number): void {
    const bytes = totalCount * SAMPLE_STRIDE * Float32Array.BYTES_PER_ELEMENT;
    if (bytes !== this.bufferBytes || this.pool.length + this.held.length === 0) {
      this.bufferBytes = bytes;
      this.held = [];
      this.pool = [];
      for (let i = 0; i < POOL_SIZE; i++) this.pool.push(new ArrayBuffer(bytes));
    }
    this.flush();
  }

  /**
   * Starts a new generation: held samples go back to the pool and the in-flight set is cleared, so the next frame
   * requests its samples again. Requests still with the worker come back stale and return to the pool then.
   */
  flush(): void {
    this.generation++;
    for (const h of this.held) this.pool.push(h.data.buffer);
    this.held = [];
    this.inFlight.clear();
  }

  /** A sample reply from the worker. */
  onSample(reply: SampleReply): void {
    if (reply.buffer.byteLength !== this.bufferBytes) return; // from before a resize: dropped
    if (reply.generation !== this.generation) {
      this.pool.push(reply.buffer); // stale: the in-flight set already belongs to the new generation
      return;
    }
    this.inFlight.delete(reply.k);
    const sample: HeldSample = {
      k: reply.k,
      timeMs: reply.timeMs,
      data: new Float32Array(reply.buffer),
      sunAltDeg: reply.sunAltDeg,
    };
    let at = this.held.length;
    while (at > 0 && (this.held[at - 1]?.k ?? Number.NEGATIVE_INFINITY) >= sample.k) at--;
    const same = this.held[at];
    if (same !== undefined && same.k === sample.k) {
      this.pool.push(same.data.buffer); // a duplicate k: keep the newer one
      this.held[at] = sample;
    } else {
      this.held.splice(at, 0, sample);
    }
  }

  /** Flushes when stepMs or groups change, or the render time leaves [t_first, t_first + 2D]. */
  frame(renderMs: number, stepMs: number, groups: GroupMask): SamplePair | null {
    if (stepMs !== this.stepMs || groups !== this.groups) {
      this.stepMs = stepMs;
      this.groups = groups;
      this.flush();
    }
    const k = Math.floor(renderMs / stepMs);
    const first = this.held[0];
    // Flush when the render time leaves [t_first, t_first + 2D] (seek, step, Now, a long stall).
    if (first !== undefined && (renderMs < first.timeMs || renderMs > first.timeMs + 2 * stepMs)) {
      this.flush();
    }
    // Release samples older than k once the next one is held: their buffers go to the next requests.
    while (this.held.length > 1 && (this.held[0]?.k ?? k) < k && (this.held[1]?.k ?? k + 1) <= k) {
      const old = this.held.shift();
      if (old !== undefined) this.pool.push(old.data.buffer);
    }
    // Keep k, k + 1 and k + 2 held or in flight, as far as the pool allows; never allocate here.
    for (let j = k; j <= k + 2; j++) {
      if (this.inFlight.has(j) || this.heldAt(j) !== null) continue;
      const buffer = this.pool.pop();
      if (buffer === undefined) break;
      this.inFlight.add(j);
      this.post({ type: "sample", generation: this.generation, k: j, stepMs, groups, buffer }, [
        buffer,
      ]);
    }
    let a: HeldSample | null = null; // the newest held sample at or before k
    for (const h of this.held) if (h.k <= k) a = h;
    if (a === null) return null;
    return { a, b: this.heldAt(a.k + 1) ?? a }; // b === a: the next sample is late, hold
  }

  private heldAt(k: number): HeldSample | null {
    for (const h of this.held) if (h.k === k) return h;
    return null;
  }
}
