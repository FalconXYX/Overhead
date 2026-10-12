// src/state/incomingClient.ts — incoming request pacing and the stale-reply filter (M8 step 6.1). It holds no
// Worker: ephemeris.ts passes the worker's postMessage and routes each `incoming` reply to onReply, so Node tests
// drive it directly.
import type { GroupMask } from "../domain/orbits";
import type { PropagationIn, PropagationOut } from "../workers/protocol";

/** The `incoming` request and reply of README section 5. */
export type IncomingRequest = Extract<PropagationIn, { type: "incoming" }>;
export type IncomingReply = Extract<PropagationOut, { type: "incoming" }>;

/** At most one request per this much wall time unless something forces one. */
const REQUEST_INTERVAL_WALL_MS = 1000;
/**
 * A sim-time move beyond this since the last request is a jump (a seek, Now, a still image's new capture time).
 * Playing at 1× or 10× moves sim time at most about 11 s between requests.
 */
const MAX_FORWARD_DRIFT_MS = 20_000;

export class IncomingClient {
  readonly #post: (msg: IncomingRequest) => void;
  #latest: IncomingReply | null = null;
  #nextId = 1;
  #minAcceptedId = 1;
  #inFlight = false;
  #dirty = true;
  #lastPostWallMs = Number.NEGATIVE_INFINITY;
  #lastTimeMs: number | null = null;
  #lastGroups: GroupMask | null = null;
  #lastId = 0;

  constructor(post: (msg: IncomingRequest) => void) {
    this.#post = post;
  }

  /** The latest accepted reply, or null. */
  get latest(): IncomingReply | null {
    return this.#latest;
  }

  /** Once per frame: at most one request per second of wall time, one in flight, none when inactive or unchanged. */
  frame(wallMs: number, simTimeMs: number, active: boolean, groups: GroupMask): void {
    if (!active) {
      // flush, so that a reply already in flight cannot set latest again while alerts are paused.
      if (this.#latest !== null || this.#inFlight) this.flush();
      this.#dirty = true;
      return;
    }
    const last = this.#lastTimeMs;
    if (last !== null && (simTimeMs < last || simTimeMs > last + MAX_FORWARD_DRIFT_MS)) {
      this.flush();
    }
    if (this.#inFlight) return;
    const dirty = this.#dirty;
    if (!dirty && wallMs - this.#lastPostWallMs < REQUEST_INTERVAL_WALL_MS) return;
    if (!dirty && simTimeMs === this.#lastTimeMs && groups === this.#lastGroups) return;
    const requestId = this.#nextId;
    this.#nextId += 1;
    this.#lastId = requestId;
    this.#inFlight = true;
    this.#dirty = false;
    this.#lastPostWallMs = wallMs;
    this.#lastTimeMs = simTimeMs;
    this.#lastGroups = groups;
    this.#post({ type: "incoming", requestId, timeMs: simTimeMs, groups });
  }

  /** Clears latest, ignores replies to earlier requests, requests on the next frame. */
  flush(): void {
    this.#latest = null;
    this.#minAcceptedId = this.#nextId;
    this.#inFlight = false;
    this.#dirty = true;
  }

  onReply(reply: IncomingReply): void {
    if (reply.requestId < this.#minAcceptedId) return;
    if (reply.requestId === this.#lastId) this.#inFlight = false;
    this.#latest = reply;
  }
}
