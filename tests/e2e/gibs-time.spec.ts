// tests/e2e/gibs-time.spec.ts — the M1 acceptance test: every true-colour tile request carries the clock's date.
// [Redesign] On the recorded clip, served as starting just before the true-colour date flips (paused: reduced motion).
import type { Page, Request } from "@playwright/test";
import {
  CLIP_ID,
  clipReady,
  clipStartingAt,
  expect,
  expectSimTime,
  focusBody,
  openPopover,
  test,
} from "./fixtures";

const TRUE_COLOR = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";

interface TileRequest {
  layer: string | null;
  time: string | null;
  tile: string; // "TileMatrix/TileRow/TileCol"
  encoding: "KVP" | "REST";
  template: string | null; // REST only: "default" or "default/default"
}

/** A REST tile path: /wmts/epsg3857/best/<layer>/default[/default]/<matrix set>/<z>/<row>/<col>.<ext>. */
const REST_TILE =
  /^\/wmts\/epsg3857\/best\/([^/]+)\/(default(?:\/default)?)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.\w+$/;

/** URLSearchParams decodes %3A; GIBS KVP parameter names are case-sensitive (Gotcha 14). */
function gibsTile(request: Request): TileRequest | null {
  const url = new URL(request.url());
  if (url.hostname !== "gibs.earthdata.nasa.gov") return null;
  const p = url.searchParams;
  if (p.get("Request") === "GetTile") {
    return {
      layer: p.get("layer"),
      time: p.get("Time"),
      tile: `${p.get("TileMatrix")}/${p.get("TileRow")}/${p.get("TileCol")}`,
      encoding: "KVP",
      template: null,
    };
  }
  const rest = REST_TILE.exec(url.pathname);
  if (rest === null) return null;
  const [, layer = null, template = null, , z, row, col] = rest;
  return { layer, time: null, tile: `${z}/${row}/${col}`, encoding: "REST", template };
}

/** Records every GIBS GetTile request and counts the ones still in flight. */
function recordTiles(page: Page) {
  const requests: TileRequest[] = [];
  let pending = 0;
  let lastChangeMs = Date.now();
  page.on("request", (request) => {
    const tile = gibsTile(request);
    if (tile === null) return;
    requests.push(tile);
    pending += 1;
    lastChangeMs = Date.now();
  });
  const done = (request: Request): void => {
    if (gibsTile(request) === null) return;
    pending -= 1;
    lastChangeMs = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return {
    requests,
    /** At least one request, none pending, and nothing changed for 500 ms. */
    quiet: () =>
      expect
        .poll(() => requests.length > 0 && pending === 0 && Date.now() - lastChangeMs >= 500, {
          intervals: [100],
          timeout: 10_000,
        })
        .toBe(true),
  };
}

const trueColor = (list: readonly TileRequest[]) => list.filter((r) => r.layer === TRUE_COLOR);
const times = (list: readonly TileRequest[]) => new Set(list.map((r) => r.time));
const tiles = (list: readonly TileRequest[]) => new Set(list.map((r) => r.tile));

test.use({ reducedMotion: "reduce" });

test("every true-colour tile request carries the clock's date, before and after a date change", async ({
  page,
}) => {
  const recorder = recordTiles(page);
  // NOAA-20's 13:30 pass at the Subaru StarCam's longitude, plus the 4 h latency: the date flips at 03:51:54.2Z.
  // The URL's t (as a shared link has it) sets the clock before the first frame: no tiles for the page's opening time.
  await clipStartingAt(page, "2026-10-10T03:51:51Z");
  await page.goto("./?t=2026-10-10T03:51:51Z");
  await clipReady(page, "paused");

  const map = page.locator('[data-map="ground"]');
  const box = await map.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(320);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(256);

  await recorder.quiet();
  const before = [...recorder.requests];
  const beforeTrueColor = trueColor(before);
  expect(beforeTrueColor.length).toBeGreaterThanOrEqual(4);
  expect(times(beforeTrueColor)).toEqual(new Set(["2026-10-08"]));
  expect(beforeTrueColor.every((r) => r.encoding === "KVP")).toBe(true);
  const overlays = before.filter((r) => r.layer !== TRUE_COLOR);
  expect(overlays.length).toBeGreaterThan(0);
  expect(overlays.every((r) => r.time === null)).toBe(true);
  // Coastlines over KVP; Reference_Labels over REST, spread over both of its templates (KVP gives GIBS's empty tile).
  const coastlines = overlays.filter((r) => r.layer === "Coastlines");
  const labels = overlays.filter((r) => r.layer === "Reference_Labels");
  expect(coastlines.length).toBeGreaterThan(0);
  expect(coastlines.every((r) => r.encoding === "KVP")).toBe(true);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((r) => r.encoding === "REST")).toBe(true);
  expect(new Set(labels.map((r) => r.template))).toEqual(new Set(["default", "default/default"]));
  expect(tiles(labels)).toEqual(tiles(coastlines));
  await expectSimTime(page, "2026-10-10T03:51:51Z");
  await expect(page.getByTestId("time-local")).toHaveText("17:51 in Hawaii");

  // Cross the flip with the page focused, not the map: four 1 s steps.
  const mark = recorder.requests.length;
  await focusBody(page);
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
  await expectSimTime(page, "2026-10-10T03:51:55Z");
  await expect(page).toHaveURL(new RegExp(`\\?cam=${CLIP_ID}&t=2026-10-10T03:51:55Z$`));
  await recorder.quiet();

  const afterTrueColor = trueColor(recorder.requests.slice(mark));
  expect(afterTrueColor.length).toBeGreaterThanOrEqual(beforeTrueColor.length);
  expect(times(afterTrueColor)).toEqual(new Set(["2026-10-09"]));
  expect(tiles(afterTrueColor)).toEqual(tiles(beforeTrueColor));
  // The capabilities Default (today's black date) never appears.
  expect(times(trueColor(recorder.requests))).toEqual(new Set(["2026-10-08", "2026-10-09"]));
  console.log(
    `true colour: ${beforeTrueColor.length} at load, ${afterTrueColor.length} after the date change; ` +
      `overlays: ${overlays.length} at load, ${recorder.requests.slice(mark).length - afterTrueColor.length} after`,
  );
});

test("a sim time ahead of the real clock requests the newest pass the real clock has reached", async ({
  page,
}) => {
  // Real time 2026-10-11T19:20Z, a clip 12 h ahead of it. The sim time alone would give 2026-10-11, whose tiles GIBS
  // serves as 200 black JPEGs; the real clock gives 2026-10-10.
  await page.clock.install({ time: Date.parse("2026-10-11T19:20:00Z") });
  await clipStartingAt(page, "2026-10-12T07:20:00Z");
  const recorder = recordTiles(page);
  await page.goto("./");
  await clipReady(page, "paused");
  await recorder.quiet();
  const requested = trueColor(recorder.requests);
  expect(requested.length).toBeGreaterThanOrEqual(4);
  expect(times(requested)).toEqual(new Set(["2026-10-10"]));
  // The credit names the date the map shows.
  const credits = await openPopover(page, "Credits", "Credits");
  await expect(credits).toContainText("Imagery: NOAA-20 / VIIRS, 2026-10-10");
});
