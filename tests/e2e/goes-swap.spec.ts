// tests/e2e/goes-swap.spec.ts — the M7 acceptance test: scrubbing across a 10-minute boundary swaps the GOES-West tile
// set exactly once. The routes fixture serves the committed DescribeDomains response and answers every HEAD probe
// with layer-time-actual equal to its Time, so the newest listed step (2026-10-11T00:00:00Z) is confirmed.
// [Redesign] On the recorded clip, served as starting a few seconds before each boundary (paused: reduced motion),
// stepped with the arrow keys; "Cloud imagery (10 min)" is the layer's switch.
import type { Page, Request } from "@playwright/test";
import {
  clipReady,
  clipStartingAt,
  creditsList,
  expect,
  expectSimTime,
  focusBody,
  openLayers,
  recordGibsRequests,
  test,
} from "./fixtures";

const GOES_LAYER = "GOES-West_ABI_Band13_Clean_Infrared";
const TOGGLE = "Cloud imagery (10 min)";

type GoesRequest =
  | { kind: "head"; time: string | null }
  | { kind: "domains" }
  | { kind: "tile"; time: string | null; matrix: string | null; tile: string }; // tile: "z/row/col"

/**
 * HEAD by method, checked first: the probe also carries Request=GetTile, the GOES layer and a Time. Then
 * DescribeDomains by /all/ in the path, then GOES GetTile requests. URLSearchParams decodes %3A.
 */
function classify(request: Request): GoesRequest | null {
  const url = new URL(request.url());
  const p = url.searchParams;
  if (request.method() === "HEAD") return { kind: "head", time: p.get("Time") };
  if (url.pathname.includes("/all/")) return { kind: "domains" };
  if (p.get("Request") !== "GetTile" || p.get("layer") !== GOES_LAYER) return null;
  return {
    kind: "tile",
    time: p.get("Time"),
    matrix: p.get("TileMatrix"),
    tile: `${p.get("TileMatrix")}/${p.get("TileRow")}/${p.get("TileCol")}`,
  };
}

/** Every GIBS request so far, classified. */
function goesRequests(requests: readonly Request[]) {
  const all = requests.map(classify);
  const tiles = all.flatMap((r) => (r?.kind === "tile" ? [r] : []));
  return {
    tiles,
    heads: all.flatMap((r) => (r?.kind === "head" ? [r] : [])),
    domains: all.filter((r) => r?.kind === "domains").length,
  };
}

const times = (list: readonly { time: string | null }[]) => [...new Set(list.map((r) => r.time))];

/** The Layers popover's switch; it stays disabled until the capabilities snapshot is ready. */
async function turnOnGoes(page: Page): Promise<void> {
  const layers = await openLayers(page);
  await layers.getByRole("checkbox", { name: TOGGLE }).check();
  await page.keyboard.press("Escape");
  await focusBody(page);
}

/** The clip from `startIso`, loaded and paused. */
async function openClipAt(page: Page, startIso: string): Promise<void> {
  await clipStartingAt(page, startIso);
  await page.goto("./");
  await clipReady(page, "paused");
}

/** One-second steps with the arrow keys (focus on body). */
async function step(page: Page, key: "ArrowRight" | "ArrowLeft", count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await page.keyboard.press(key);
}

test.use({ reducedMotion: "reduce" });

test("stepping across a 10-minute boundary swaps the GOES tile set exactly once", async ({
  page,
}) => {
  const recorder = recordGibsRequests(page);
  await openClipAt(page, "2026-10-10T09:59:57Z");
  await recorder.quiet();
  // Layer off: no DescribeDomains, no probe, no tile.
  const atLoad = goesRequests(recorder.requests);
  expect(atLoad.tiles).toHaveLength(0);
  expect(atLoad.heads).toHaveLength(0);
  expect(atLoad.domains).toBe(0);

  await turnOnGoes(page);
  const caption = page.getByTestId("goes-asof");
  await expect(caption).toHaveText("Imagery as of 09:50 UTC");
  await expect(creditsList(page)).toContainText("Imagery: GOES-West/ABI, Band 13 Clean Infrared");
  await recorder.quiet();

  const on = goesRequests(recorder.requests);
  expect(on.domains).toBe(1);
  expect(on.heads.map((r) => r.time)).toEqual(["2026-10-11T00:00:00Z"]);
  expect(on.tiles.length).toBeGreaterThanOrEqual(4);
  expect(times(on.tiles)).toEqual(["2026-10-10T09:50:00Z"]);
  expect(new Set(on.tiles.map((r) => r.matrix))).toEqual(new Set(["6"]));
  // 6/28/4 holds the site (Maunakea) at z6: the limits are dropped (Gotcha 1).
  expect(on.tiles.map((r) => r.tile)).toContain("6/28/4");
  const n0 = on.tiles.length;
  const setA = new Set(on.tiles.map((r) => r.tile));

  // 09:59:57 → 10:00:02, one second per step.
  await step(page, "ArrowRight", 5);
  await expectSimTime(page, "2026-10-10T10:00:02Z");
  await recorder.quiet();
  await expect(caption).toHaveText("Imagery as of 10:00 UTC");
  const forward = goesRequests(recorder.requests).tiles.slice(n0);
  expect(forward.length).toBeGreaterThanOrEqual(1);
  expect(times(forward)).toEqual(["2026-10-10T10:00:00Z"]);
  const forwardTiles = new Set(forward.map((r) => r.tile));
  for (const tile of setA) expect(forwardTiles.has(tile), tile).toBe(true);

  // Back across the boundary: OpenLayers reuses the cached 09:50 tiles.
  const n1 = goesRequests(recorder.requests).tiles.length;
  await step(page, "ArrowLeft", 5);
  await expectSimTime(page, "2026-10-10T09:59:57Z");
  await recorder.quiet();
  await expect(caption).toHaveText("Imagery as of 09:50 UTC");
  const back = goesRequests(recorder.requests).tiles.slice(n1);
  expect(back.filter((r) => r.time === "2026-10-10T10:00:00Z")).toEqual([]);

  // The whole test: two Time values (never the capabilities Default), each (tile, Time) once, one poll and one probe.
  const all = goesRequests(recorder.requests);
  expect(times(all.tiles).sort()).toEqual(["2026-10-10T09:50:00Z", "2026-10-10T10:00:00Z"]);
  const pairs = all.tiles.map((r) => `${r.tile}@${r.time}`);
  expect(new Set(pairs).size).toBe(pairs.length);
  expect(all.domains).toBe(1);
  expect(all.heads).toHaveLength(1);
  console.log(
    `GOES tiles: ${n0} at 09:50, ${forward.length} at 10:00, ${back.length} on the way back`,
  );
});

test("a time inside a gap shows the step before it", async ({ page }) => {
  const recorder = recordGibsRequests(page);
  // The fixture lists no 19:30 step on 2026-10-07: 19:39:55 shows 19:20 until 19:40.
  await openClipAt(page, "2026-10-07T19:39:55Z");
  await turnOnGoes(page);
  const caption = page.getByTestId("goes-asof");
  await expect(caption).toHaveText("Imagery as of 19:20 UTC");
  await recorder.quiet();
  const before = goesRequests(recorder.requests).tiles;
  expect(before.length).toBeGreaterThanOrEqual(1);
  expect(times(before)).toEqual(["2026-10-07T19:20:00Z"]);

  // 5 s later is 19:40:00, the first step after the gap.
  const mark = before.length;
  await step(page, "ArrowRight", 5);
  await expectSimTime(page, "2026-10-07T19:40:00Z");
  await expect(caption).toHaveText("Imagery as of 19:40 UTC");
  await recorder.quiet();
  const after = goesRequests(recorder.requests).tiles.slice(mark);
  expect(after.length).toBeGreaterThanOrEqual(1);
  expect(times(after)).toEqual(["2026-10-07T19:40:00Z"]);
});

test("before the listed window: the 90-day message and no GOES tiles", async ({ page }) => {
  // The fixture starts 24 h after this time.
  const recorder = recordGibsRequests(page);
  await openClipAt(page, "2026-10-06T12:00:00Z");
  await turnOnGoes(page);
  await expect(page.getByTestId("goes-asof")).toHaveText(
    "No GOES-West imagery for this time (NASA GIBS keeps 90 days)",
  );
  await recorder.quiet();
  const { tiles, heads, domains } = goesRequests(recorder.requests);
  expect(tiles).toHaveLength(0);
  expect(domains).toBe(1);
  expect(heads).toHaveLength(1);
});
