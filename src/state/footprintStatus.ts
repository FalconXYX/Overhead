// src/state/footprintStatus.ts — the footprint's height, its source and its pair count (M8 step 8.3). bindFootprint
// writes the fields in place on every recompute; the Layers panel and the test hooks read them during a useTick4Hz
// render. It is one object for the session: never reassign it.

/** Written in place by bindFootprint, read by the UI through useTick4Hz. */
export interface FootprintStatus {
  heightKm: number | null; // null while the footprint layer is off
  source: "preset" | "selected" | "fallback";
  pairCount: number; // 0: nothing drawn
}

export const footprintStatus: FootprintStatus = {
  heightKm: null,
  source: "fallback",
  pairCount: 0,
};
