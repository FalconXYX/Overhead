// src/domain/time/index.ts — epoch-ms arithmetic. No Date objects leave this module.
// M0 subset; the rest of the README section 6 API lands with its first user.

export type ClockRate = 1 | 10 | 60 | 600;
/** Closed interval of available imagery steps, epoch ms: [firstStepMs, lastStepMs]. */
export type TimeInterval = readonly [startMs: number, endMs: number];

export const MAX_WALL_DELTA_MS = 250; // [M0]
export const SCRUB_HALF_RANGE_MS = 43_200_000; // [M0]

/** [M0] Replay without video: simTimeMs + min(max(wallDeltaMs, 0), 250) × rate. */
export function advanceReplayMs(simTimeMs: number, wallDeltaMs: number, rate: ClockRate): number {
  return simTimeMs + Math.min(Math.max(wallDeltaMs, 0), MAX_WALL_DELTA_MS) * rate;
}

/** [M0] Clamps into [centerMs − 12 h, centerMs + 12 h], inclusive. */
export function clampToScrubRangeMs(timeMs: number, centerMs: number): number {
  return Math.min(Math.max(timeMs, centerMs - SCRUB_HALF_RANGE_MS), centerMs + SCRUB_HALF_RANGE_MS);
}

/** [M0] "2026-10-11T03:20:00Z" (seconds, truncated, never rounded; GIBS rejects "hh:mmZ"). */
export function isoUtcSeconds(timeMs: number): string {
  return `${new Date(timeMs).toISOString().slice(0, 19)}Z`;
}
