// tests/e2e/fixtures.ts — every spec imports `test` and `expect` from here.
import { fileURLToPath } from "node:url";
import { test as base, expect, type Route } from "@playwright/test";

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
        const url = new URL(route.request().url());
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
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };
