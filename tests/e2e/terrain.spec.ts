// tests/e2e/terrain.spec.ts — M6: the terrain horizon on synthetic-walenstadt (the Layers status, the Inspector's
// "Behind terrain" flag for Capella under the Churfirsten and not for Polaris above it) and the Sun-lit hillshade
// (its <img> tile requests, the terrain credits, the night badge). The shared routes fixture serves the committed
// Terrarium tiles, else flat.png; no third-party request leaves the browser.
import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";

const DAY = "./?cam=synthetic-walenstadt&t=2026-10-11T15:20:00Z";
const NIGHT = "./?cam=synthetic-walenstadt&t=2026-10-11T22:00:00Z";
const NIGHT_BADGE = "Night: fixed lighting (315°, 45°)";
const TERRAIN_CREDIT = "Terrain: AWS Terrain Tiles (Tilezen Joerd), data sources and attribution";
const TERRAIN_CREDIT_HREF = "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
/** TERRAIN_SOURCE_STATEMENTS (src/app/credits.ts), verbatim. */
const STATEMENTS = [
  "ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736",
  "Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017",
  "Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich",
  "Canada terrain data contains information licensed under the Open Government Licence – Canada",
  "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers",
  "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration",
  "Mexico terrain data source: INEGI, Continental relief, 2016",
  "New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved)",
  "Norway terrain data © Kartverket",
  "United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved",
  "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.",
];

const isTerrarium = (request: Request): boolean =>
  request.url().includes("/elevation-tiles-prod/terrarium/");

/** Terrarium requests by resource type: the hillshade's tiles are "image", the horizon worker's "fetch". */
function recordTerrarium(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (isTerrarium(request)) requests.push(request);
  });
  return requests;
}

const inspector = (page: Page) => page.getByRole("region", { name: "Inspector" });
const layers = (page: Page) => page.getByRole("region", { name: "Layers" });

/**
 * L opens the Layers panel; the "Terrain horizon" toggle is described by its status, which reads "Terrain ready" once
 * the worker's profile is stored.
 */
async function openLayersWhenTerrainReady(page: Page): Promise<void> {
  await page.keyboard.press("l");
  await expect(
    layers(page).getByRole("checkbox", { name: "Terrain horizon" }),
  ).toHaveAccessibleDescription("Terrain ready");
}

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

/**
 * M1's ground view starts at zoom 6; four zoom-ins reach zoom 10, so the relief comes from the walenstadt z10 fixture
 * tiles instead of flat.png. Each click waits out the 250 ms zoom animation, which a next click would cancel.
 */
async function zoomGroundTo10(page: Page, requests: readonly Request[]): Promise<void> {
  const zoomIn = page.locator('[data-map="ground"] .ol-zoom-in');
  for (let i = 0; i < 4; i++) {
    await zoomIn.click();
    await page.waitForTimeout(400);
  }
  await expect
    .poll(() => requests.filter((r) => r.url().includes("/terrarium/10/")).length)
    .toBeGreaterThan(0);
  await page.waitForTimeout(1_000); // the fulfilled tiles decode and draw
  await twoFrames(page);
}

/** Turns the hillshade on from the open Layers panel. */
async function turnOnHillshade(page: Page): Promise<void> {
  await layers(page).getByRole("checkbox", { name: "Hillshade" }).check();
}

test("Capella sits behind the Churfirsten: the Inspector says so", async ({ page }) => {
  await page.goto(`${DAY}&sel=star:1708`);
  await openLayersWhenTerrainReady(page);
  // Capella: az 359.92°, apparent alt 3.37°, under a terrain horizon of 32.7° there.
  await expect(inspector(page)).toContainText("Capella");
  await expect(inspector(page)).toContainText("Terrain horizon here: +32.7°");
  await expect(inspector(page).getByText("Behind terrain", { exact: true })).toBeVisible();
  await twoFrames(page);
  await page
    .locator('[data-map="sky"]')
    .screenshot({ path: test.info().outputPath("walenstadt-skyline.png") });
});

test("Polaris stands above the Churfirsten: no Behind terrain", async ({ page }) => {
  await page.goto(`${DAY}&sel=star:424`);
  await openLayersWhenTerrainReady(page);
  // Polaris: az 0.49°, alt 46.62°.
  await expect(inspector(page)).toContainText("Polaris");
  await expect(inspector(page)).toContainText("Terrain horizon here: +32.");
  await expect(inspector(page)).not.toContainText("Behind terrain");
});

test("hillshade: image tiles, every terrain credit, and the night badge only at night", async ({
  page,
}) => {
  const requests = recordTerrarium(page);
  await page.goto(DAY);
  await openLayersWhenTerrainReady(page);
  await turnOnHillshade(page);
  // The ground map's tiles load through <img>; the horizon worker's are "fetch".
  await expect
    .poll(() => requests.filter((r) => r.resourceType() === "image").length)
    .toBeGreaterThan(0);

  const credits = page.getByRole("region", { name: "Credits" });
  await expect(credits.getByRole("link", { name: TERRAIN_CREDIT })).toHaveAttribute(
    "href",
    TERRAIN_CREDIT_HREF,
  );
  for (const statement of STATEMENTS) {
    await expect(credits.getByText(statement, { exact: true })).toBeVisible();
  }
  // 15:20Z: the Sun is at 12.69° over Walenstadt, so the relief is Sun-lit.
  await zoomGroundTo10(page, requests);
  await expect(page.getByText(NIGHT_BADGE)).toHaveCount(0);
  await page
    .locator('[data-map="ground"]')
    .screenshot({ path: test.info().outputPath("hillshade-day.png") });

  // 22:00Z: the Sun is at −47.19°; the relief switches to fixed lighting and says so.
  requests.length = 0; // zoomGroundTo10 waits for this page's own z10 tiles
  await page.goto(NIGHT);
  await openLayersWhenTerrainReady(page);
  await turnOnHillshade(page);
  await expect(page.getByText(NIGHT_BADGE, { exact: true })).toBeVisible();
  await zoomGroundTo10(page, requests);
  await page
    .locator('[data-map="ground"]')
    .screenshot({ path: test.info().outputPath("hillshade-night.png") });
});
