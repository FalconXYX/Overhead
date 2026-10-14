// tests/e2e/fixtures.ts — every spec imports `test` and `expect` from here.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page, type Request, type Route } from "@playwright/test";

export const APP_ORIGIN = "http://localhost:4173";

export interface Guard {
  consoleErrors: string[];
  pageErrors: string[];
  blockedRequests: string[];
}

// Real tiles: a NOAA-20 true-colour tile (z5 2/14, 2026-10-10) for image/jpeg, and for every PNG overlay tile the
// 256 × 256 fully transparent PNG that GIBS returns for any KVP Reference_Labels request, so no OSM data is
// committed (M1 step 2; it is not a real empty label tile).
const GIBS_TILE_JPG = fileURLToPath(new URL("../fixtures/gibs/tile.jpg", import.meta.url));
const GIBS_TILE_PNG = fileURLToPath(new URL("../fixtures/gibs/tile.png", import.meta.url));
const GIBS_REST_LABELS =
  /^\/wmts\/epsg3857\/best\/Reference_Labels\/default\/(default\/)?GoogleMapsCompatible_Level9\/\d+\/\d+\/\d+\.png$/;
// [M7] One live GOES-West DescribeDomains response (window 2026-10-07T12:00:00Z--2026-10-11T00:00:00Z, two gaps).
const GOES_DOMAIN_XML = fileURLToPath(new URL("../fixtures/gibs/goes-domain.xml", import.meta.url));
const GOES_DOMAINS_PATH =
  "/1.0.0/GOES-West_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/";
// The committed CelesTrak snapshot (M3 step 1), served for the app's own data/gp/*.json so satellite positions do not
// change when fetch-gp.yml commits new data to public/data/gp/.
const GP_FIXTURE_FILES = new Set(["stations.json", "visual.json", "starlink.json", "meta.json"]);
const gpFixture = (file: string): string =>
  fileURLToPath(new URL(`../fixtures/gp/${file}`, import.meta.url));
// [M6] The committed Terrarium tiles (scripts/fetch-terrain-fixture.ts) and their x-amz-meta-x-imagery-sources.
const TERRARIUM_PATH = /^\/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/;
const TERRAIN_SITES = ["walenstadt", "maunakea"] as const;
type TerrainSite = (typeof TERRAIN_SITES)[number];
const TERRAIN_FLAT_PNG = fileURLToPath(new URL("../fixtures/terrain/flat.png", import.meta.url));
const terrainTile = (site: TerrainSite, key: string): string =>
  fileURLToPath(new URL(`../fixtures/terrain/${site}/${key}.png`, import.meta.url));
const terrainSourcesBySite = new Map<TerrainSite, Record<string, string>>();
// [M5] The YouTube IFrame API stub and the astroasahi resolver page, whose meta refresh names the fixture id
// Fixture0001 (a valid id that is no real stream, so a test can tell the resolver from the fallback).
const YT_IFRAME_API_STUB = fileURLToPath(
  new URL("../fixtures/youtube/iframe_api.js", import.meta.url),
);
const ASTROASAHI_HTML = fileURLToPath(
  new URL("../fixtures/youtube/astroasahi.html", import.meta.url),
);
// [M5] The generated test-pattern clip and its ClipSidecar, served as recordings/ (which is never committed).
const CLIP_FIXTURES: Readonly<Record<string, { path: string; contentType: string }>> = {
  "subaru-2026-10-11-iss.json": {
    path: fileURLToPath(new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url)),
    contentType: "application/json",
  },
  "test-pattern.webm": {
    path: fileURLToPath(new URL("../fixtures/video/test-pattern.webm", import.meta.url)),
    contentType: "video/webm",
  },
};
/** The site's sources.json ("z/x/y" → header), read once. */
function terrainSources(site: TerrainSite): Record<string, string> {
  let sources = terrainSourcesBySite.get(site);
  if (sources === undefined) {
    const file = new URL(`../fixtures/terrain/${site}/sources.json`, import.meta.url);
    sources = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    terrainSourcesBySite.set(site, sources);
  }
  return sources;
}

export const test = base.extend<{ guard: Guard; routes: undefined }>({
  guard: [
    async ({ context, page }, use) => {
      const guard: Guard = { consoleErrors: [], pageErrors: [], blockedRequests: [] };
      // Register the catch-all FIRST: Playwright tries matching routes in reverse registration
      // order, so mocks added later (M1+) run before it.
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (new URL(url).origin === APP_ORIGIN) return route.fallback();
        guard.blockedRequests.push(url);
        return route.abort("blockedbyclient");
      });
      page.on("console", (message) => {
        if (message.type() === "error") guard.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => guard.pageErrors.push(error.message));
      await use(guard);
      expect(guard.blockedRequests, "requests to third parties").toEqual([]);
      expect(guard.pageErrors, "uncaught exceptions").toEqual([]);
      expect(guard.consoleErrors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
  // Depends on `guard`, so it is set up after the catch-all and its routes are tried first.
  // Every milestone adds its mocks here. Never fulfil with 404: Chromium logs it as a console error.
  routes: [
    async ({ context, guard }, use) => {
      await context.route("**/gibs.earthdata.nasa.gov/**", (route: Route) => {
        const request = route.request();
        const url = new URL(request.url());
        // [M7] The GOES HEAD probe first: it also carries Request=GetTile, and the tile branch would answer it without
        // layer-time-actual. fetch reads that header only when it is exposed (Gotcha 10).
        if (request.method() === "HEAD") {
          return route.fulfill({
            status: 200,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-expose-headers": "layer-time-actual",
              "layer-time-actual": url.searchParams.get("Time") ?? "",
            },
          });
        }
        // [M7] GOES-West DescribeDomains: the committed fixture, whatever the window in the URL.
        if (url.pathname.includes(GOES_DOMAINS_PATH)) {
          return route.fulfill({
            status: 200,
            path: GOES_DOMAIN_XML,
            contentType: "text/xml",
            headers: { "access-control-allow-origin": "*" },
          });
        }
        const kvpTile = url.searchParams.get("Request") === "GetTile";
        // Reference_Labels is REST, over both of its templates (DECISIONS, M1).
        if (!kvpTile && !GIBS_REST_LABELS.test(url.pathname)) {
          guard.blockedRequests.push(url.href);
          return route.abort("blockedbyclient");
        }
        const jpeg = kvpTile && url.searchParams.get("Format") === "image/jpeg";
        return route.fulfill({
          status: 200,
          path: jpeg ? GIBS_TILE_JPG : GIBS_TILE_PNG,
          contentType: jpeg ? "image/jpeg" : "image/png",
          headers: { "access-control-allow-origin": "*" },
        });
      });
      // [M4] Still-image cameras (CFHT Nānā ao, AllSkyKamera) get the 256 × 256 JPEG tile, without CORS headers like the
      // real CFHT server. [Redesign] No enabled camera is one any more; kept so no such request can leave the machine.
      await context.route(
        /^https:\/\/(www\.cfht\.hawaii\.edu|www\.allskykamera\.space)\//,
        (route) => route.fulfill({ status: 200, path: GIBS_TILE_JPG, contentType: "image/jpeg" }),
      );
      // Same origin (M3). context.route also covers the propagation worker's fetches.
      await context.route("**/data/gp/*.json", (route: Route) => {
        const url = new URL(route.request().url());
        const file = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
        if (url.origin !== APP_ORIGIN || !GP_FIXTURE_FILES.has(file)) {
          guard.blockedRequests.push(url.href);
          return route.abort("blockedbyclient");
        }
        return route.fulfill({
          status: 200,
          path: gpFixture(file),
          contentType: "application/json",
        });
      });
      // [M6] AWS Terrain Tiles, shared because every camera's horizon worker fetches them (and the hillshade's <img>
      // tiles): the walenstadt or maunakea fixture tile if committed, else flat.png (0 m), never a 404. [Redesign] The
      // maunakea set holds the Subaru and CFHT StarCams' whole horizons (scripts/fetch-terrain-fixture.ts), so every
      // e2e camera sees the real summit relief; flat.png is left for the hillshade's tiles away from the site. The
      // expose header lets the worker read x-amz-meta-x-imagery-sources from a fulfilled response.
      await context.route("**/s3.amazonaws.com/elevation-tiles-prod/**", (route: Route) => {
        const url = new URL(route.request().url());
        const match = TERRARIUM_PATH.exec(url.pathname);
        if (match === null) {
          guard.blockedRequests.push(url.href);
          return route.abort("blockedbyclient");
        }
        const key = `${match[1]}/${match[2]}/${match[3]}`;
        const site = TERRAIN_SITES.find((s) => existsSync(terrainTile(s, key)));
        return route.fulfill({
          status: 200,
          path: site === undefined ? TERRAIN_FLAT_PNG : terrainTile(site, key),
          contentType: "image/png",
          headers: {
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "x-amz-meta-x-imagery-sources",
            "x-amz-meta-x-imagery-sources":
              site === undefined ? "" : (terrainSources(site)[key] ?? ""),
          },
        });
      });
      // [M5] The IFrame API: the stub player for /iframe_api, anything else on www.youtube.com aborted and recorded.
      await context.route("**/www.youtube.com/**", (route: Route) => {
        const url = new URL(route.request().url());
        if (url.pathname !== "/iframe_api") {
          guard.blockedRequests.push(url.href);
          return route.abort("blockedbyclient");
        }
        return route.fulfill({
          status: 200,
          path: YT_IFRAME_API_STUB,
          contentType: "text/javascript",
        });
      });
      // [M5] The StarCam resolver pages (maunakea_east, maunakea_west, …): the fixture page for any path, with CORS.
      await context.route("**/astroasahi.github.io/**", (route: Route) =>
        route.fulfill({
          status: 200,
          path: ASTROASAHI_HTML,
          contentType: "text/html",
          headers: { "access-control-allow-origin": "*" },
        }),
      );
      // [M5] Same origin: the 2026-10-11 clip camera's sidecar is the test pattern's, which names test-pattern.webm.
      // route.fulfill ignores Range (200 with the whole file), so the app reads the clip into a Blob (DECISIONS H1).
      // Any other recordings/ path falls through to the server, which answers index.html (200, text/html).
      await context.route("**/recordings/**", (route: Route) => {
        const url = new URL(route.request().url());
        const name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
        const file = Object.hasOwn(CLIP_FIXTURES, name) ? CLIP_FIXTURES[name] : undefined;
        if (url.origin !== APP_ORIGIN || file === undefined) return route.fallback();
        return route.fulfill({ status: 200, path: file.path, contentType: file.contentType });
      });
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * [M7] Records every request to gibs.earthdata.nasa.gov (tiles, DescribeDomains and HEAD probes) and counts the ones
 * in flight. `quiet()` is M1's wait-for-quiet rule (gibs-time.spec.ts): at least one request, none pending, and
 * nothing changed for 500 ms.
 */
export function recordGibsRequests(page: Page): {
  requests: Request[];
  quiet: () => Promise<void>;
} {
  const requests: Request[] = [];
  let pending = 0;
  let lastChangeMs = Date.now();
  const isGibs = (request: Request): boolean =>
    new URL(request.url()).hostname === "gibs.earthdata.nasa.gov";
  page.on("request", (request) => {
    if (!isGibs(request)) return;
    requests.push(request);
    pending += 1;
    lastChangeMs = Date.now();
  });
  const done = (request: Request): void => {
    if (!isGibs(request)) return;
    pending -= 1;
    lastChangeMs = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return {
    requests,
    quiet: () =>
      expect
        .poll(() => requests.length > 0 && pending === 0 && Date.now() - lastChangeMs >= 500, {
          intervals: [100],
          timeout: 10_000,
        })
        .toBe(true),
  };
}

// ---- [Redesign] The cameras the site offers: the recorded ISS pass (the default) and the two live StarCams ----

/** The recorded clip's camera, served as the fixtures' test pattern: 7 s from 2026-10-11T08:00:00Z, no pass. */
export const CLIP_ID = "subaru-2026-10-11-iss";
export const CLIP_START_ISO = "2026-10-11T08:00:00Z";
const TEST_PATTERN_SIDECAR = JSON.parse(
  readFileSync(CLIP_FIXTURES["subaru-2026-10-11-iss.json"]?.path ?? "", "utf8"),
) as Record<string, unknown>;

/**
 * Serves the test pattern as the recorded clip starting at `startIso` instead of 08:00:00Z (a page route, tried before
 * the fixtures' context route), with any other sidecar fields in `patch`: the clip camera then shows that moment's
 * sky. Call before page.goto.
 */
export async function clipStartingAt(
  page: Page,
  startIso: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const body = JSON.stringify({
    ...TEST_PATTERN_SIDECAR,
    startUtcMs: Date.parse(startIso),
    ...patch,
  });
  await page.route(`**/recordings/${CLIP_ID}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

/** The header's camera switcher: a radio named by its short name, described by its full name and status. */
export const cameraRadio = (page: Page, shortName: string) =>
  page.getByRole("radio", { name: shortName, exact: true });

/** The control bar's clock: the local time in words, with the sim time as an ISO UTC dateTime. */
export const clockTime = (page: Page) => page.getByTestId("time-local");
/** Waits until the sim time (to the second, as the control bar shows it) is `iso`. */
export const expectSimTime = (page: Page, iso: string, timeout?: number) =>
  expect(clockTime(page)).toHaveAttribute(
    "datetime",
    iso,
    timeout === undefined ? {} : { timeout },
  );
/** The sim time in epoch ms, to the second. */
export const simTimeMs = async (page: Page): Promise<number> =>
  Date.parse((await clockTime(page).getAttribute("datetime")) ?? "");

/** Focus back on body: keys pressed in an input, a popover or a focused map are not the app's. */
export const focusBody = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** The recorded clip has loaded (the control bar shows its length) and its status reads `status`. */
export async function clipReady(page: Page, status = "paused"): Promise<void> {
  await expect(page.getByTestId("clip-position")).toHaveText(/^\d+:\d\d \/ \d+:\d\d$/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("video-status")).toHaveAttribute("data-status", status);
}

/** The floating card of the selected object (absent while nothing is selected). */
export const objectCard = (page: Page) => page.getByRole("region", { name: "Selected object" });

/** Opens the card's "More details" and returns its list. */
export async function moreDetails(page: Page) {
  const card = objectCard(page);
  const details = card.locator("details");
  if ((await details.getAttribute("open")) === null) await card.getByText("More details").click();
  return card.locator("details ul");
}

/** Opens a popover by its button (Layers, Credits, In view, Keyboard shortcuts) and returns its region. */
export async function openPopover(page: Page, button: string | RegExp, region: string) {
  const toggle = page.getByRole("button", { name: button }).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = page.getByRole("region", { name: region, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The Credits popover's list, open or closed: it stays in the DOM while hidden (Popover.tsx), so it is the same list
 * either way. Links inside it need includeHidden too while it is closed (creditLink).
 */
export const creditsList = (page: Page) =>
  page.getByRole("region", { name: "Credits", exact: true, includeHidden: true });
/** A credit's link, found whether or not the Credits popover is open. */
export const creditLink = (page: Page, name: string) =>
  creditsList(page).getByRole("link", { name, exact: true, includeHidden: true });

/** The [In view (N)] popover's region, opened. */
export const openInView = (page: Page) => openPopover(page, /^In view/, "In view");
/** The Layers popover's region, opened. */
export const openLayers = (page: Page) => openPopover(page, "Layers", "Layers");

/** "Camera alignment (advanced)": opened with C (focus moves into it) and returned. */
export async function openAlignment(page: Page) {
  const drawer = page.getByRole("region", { name: "Camera alignment (advanced)" });
  if (!(await drawer.isVisible())) {
    await focusBody(page);
    await page.keyboard.press("c");
  }
  await expect(drawer).toBeVisible();
  return drawer;
}
