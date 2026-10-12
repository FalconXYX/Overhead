// tests/unit/incomingClient.test.ts — IncomingClient request pacing and the stale-reply filter (M8 step 6.1).
import { describe, expect, it } from "vitest";
import {
  IncomingClient,
  type IncomingReply,
  type IncomingRequest,
} from "../../src/state/incomingClient";

const T0 = Date.parse("2026-10-11T15:05:07Z");

function setup(): { client: IncomingClient; posts: IncomingRequest[] } {
  const posts: IncomingRequest[] = [];
  return { client: new IncomingClient((msg) => posts.push(msg)), posts };
}

function reply(req: IncomingRequest | undefined): IncomingReply {
  if (req === undefined) throw new Error("no request to answer");
  return {
    type: "incoming",
    requestId: req.requestId,
    timeMs: req.timeMs,
    computeMs: 0.2,
    entries: [{ index: 3, etaSec: 35 }],
  };
}

describe("IncomingClient", () => {
  it("posts at most one request in flight, at most once per wall second, and nothing while paused", () => {
    const { client, posts } = setup();
    client.frame(0, T0, true, 0b011);
    expect(posts).toEqual([{ type: "incoming", requestId: 1, timeMs: T0, groups: 0b011 }]);
    client.frame(500, T0 + 500, true, 0b011);
    expect(posts).toHaveLength(1); // in flight
    client.onReply(reply(posts[0]));
    expect(client.latest?.requestId).toBe(1);
    client.frame(1000, T0 + 1000, true, 0b011);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ type: "incoming", requestId: 2, timeMs: T0 + 1000, groups: 0b011 });
    client.onReply(reply(posts[1]));
    // Paused: same sim time and groups.
    client.frame(3000, T0 + 1000, true, 0b011);
    expect(posts).toHaveLength(2);
    // A groups change after a wall second posts again.
    client.frame(3100, T0 + 1000, true, 0b111);
    expect(posts).toHaveLength(3);
    expect(posts[2]?.groups).toBe(0b111);
  });

  it("waits a wall second between requests even when sim time moves", () => {
    const { client, posts } = setup();
    client.frame(0, T0, true, 0b011);
    client.onReply(reply(posts[0]));
    client.frame(400, T0 + 4000, true, 0b011); // 10× play: sim moves, wall second not yet up
    expect(posts).toHaveLength(1);
    client.frame(1000, T0 + 10_000, true, 0b011);
    expect(posts).toHaveLength(2);
  });

  it("flush() clears latest, posts on the next frame, and ignores a late reply", () => {
    const { client, posts } = setup();
    client.frame(0, T0, true, 0b011);
    client.onReply(reply(posts[0]));
    client.frame(1000, T0 + 1000, true, 0b011);
    expect(posts).toHaveLength(2);
    client.flush();
    expect(client.latest).toBeNull();
    client.frame(1100, T0 + 1000, true, 0b011); // dirty: at once, though id 2 never came back
    expect(posts).toHaveLength(3);
    expect(posts[2]?.requestId).toBe(3);
    client.onReply(reply(posts[1])); // late reply 2
    expect(client.latest).toBeNull();
    client.onReply(reply(posts[2]));
    expect(client.latest?.requestId).toBe(3);
  });

  it("treats a sim-time jump as a flush: 30 s back or 60 s ahead posts at once, 10 s ahead does not", () => {
    const { client, posts } = setup();
    client.frame(0, T0, true, 0b011);
    client.onReply(reply(posts[0]));
    client.frame(200, T0 - 30_000, true, 0b011);
    expect(client.latest).toBeNull();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.timeMs).toBe(T0 - 30_000);
    // Still in flight, still within the wall second: a jump 60 s ahead flushes and posts anyway.
    client.frame(400, T0 + 30_000, true, 0b011);
    expect(posts).toHaveLength(3);
    expect(posts[2]?.timeMs).toBe(T0 + 30_000);
    client.onReply(reply(posts[1])); // the answer to the abandoned request is stale
    expect(client.latest).toBeNull();
    client.onReply(reply(posts[2]));
    expect(client.latest?.requestId).toBe(3);
    // 10 s ahead within the wall second: no flush, no post.
    client.frame(600, T0 + 40_000, true, 0b011);
    expect(posts).toHaveLength(3);
    expect(client.latest?.requestId).toBe(3);
  });

  it("posts nothing while inactive and keeps latest null", () => {
    const { client, posts } = setup();
    client.frame(0, T0, false, 0b011);
    client.frame(2000, T0 + 2000, false, 0b011);
    expect(posts).toHaveLength(0);
    expect(client.latest).toBeNull();
  });

  it("ignores a reply that was in flight when it turned inactive", () => {
    const { client, posts } = setup();
    client.frame(0, T0, true, 0b011);
    client.frame(16, T0 + 16, false, 0b011); // 60× play starts with the request in flight
    client.onReply(reply(posts[0]));
    expect(client.latest).toBeNull();
    client.frame(32, T0 + 32, true, 0b011); // active again: a fresh request at once
    expect(posts).toHaveLength(2);
  });

  it("clears latest when it turns inactive, and posts at once when it turns active again", () => {
    const { client, posts } = setup();
    client.frame(0, T0, true, 0b011);
    client.onReply(reply(posts[0]));
    expect(client.latest).not.toBeNull();
    client.frame(100, T0 + 100, false, 0b011);
    expect(client.latest).toBeNull();
    client.frame(200, T0 + 100, true, 0b011); // dirty: within the wall second and unchanged, still posts
    expect(posts).toHaveLength(2);
  });
});
