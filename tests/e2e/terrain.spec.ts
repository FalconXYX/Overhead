// tests/e2e/terrain.spec.ts — M6: the terrain horizon and the Sun-lit hillshade. [Redesign] On Maunakea, from the
// Subaru StarCam's site (the recorded clip, served as starting at the chosen times, paused under reduced motion): Sirius
// rising behind the summit cones in the east-south-east (the object card says "Behind the mountains"), then above them;
// the hillshade's <img> tile requests, the terrain credits and the night badge. The shared
// routes fixture serves the committed Terrarium tiles, which hold the StarCams' whole horizons; no third-party request
// leaves the browser.
import type { Page, Request } from "@playwright/test";
import type {} from "../../src/app/testHooks"; // window.__overhead
import {
  clipReady,
  clipStartingAt,
  creditLink,
  expect,
  moreDetails,
  objectCard,
  openLayers,
  openPopover,
  test,
} from "./fixtures";

/** Sirius (HR 2491) rising at az 108.4°, alt 1.9°, under a skyline of +3.7° there. */
const SIRIUS_BEHIND = "2026-10-11T10:20:00Z";
/** 20 minutes later: az 110.2°, alt 6.1°, over a skyline of +3.9°. */
const SIRIUS_ABOVE = "2026-10-11T10:40:00Z";
/** 12:00 HST: the Sun high over Maunakea. */
const DAY = "2026-10-11T22:00:00Z";
/** 22:00 HST. */
const NIGHT = "2026-10-11T08:00:00Z";
const NIGHT_BADGE = "Night: the terrain shading uses a fixed light";
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

test.use({ reducedMotion: "reduce" });

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

/** The clip from `startIso`, loaded and paused; the horizon worker has started (its credit is listed). */
async function openClipAt(page: Page, startIso: string, query = ""): Promise<void> {
  await clipStartingAt(page, startIso);
  await page.goto(`./${query}`);
  await clipReady(page, "paused");
  await expect(creditLink(page, TERRAIN_CREDIT)).toHaveCount(1);
}

/** The card's "More details" once the terrain profile is in: it then names the skyline's height there. */
async function detailsWithSkyline(page: Page) {
  const details = await moreDetails(page);
  await expect(details).toContainText("Mountain skyline here:", { timeout: 20_000 });
  return details;
}

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

/**
 * M1's ground view starts at zoom 6; four zoom-ins reach zoom 10, so the relief comes from the committed z10 tiles.
 * Each click animates the view for 250 ms, and a click during it would cancel it short of a whole step: wait until the
 * view rests at the next zoom (the read-only view hook). Then wait for the z10 tiles' responses and two frames.
 */
async function zoomGroundTo10(page: Page, requests: readonly Request[]): Promise<void> {
  const zoomIn = page.locator('[data-map="ground"] .ol-zoom-in');
  const groundView = () =>
    page.evaluate(() => {
      const v = window.__overhead?.view("ground") ?? null;
      return v === null || v.zoom === null
        ? null
        : { zoom: Math.round(v.zoom * 1000) / 1000, animating: v.animating };
    });
  const start = (await groundView())?.zoom ?? Number.NaN;
  expect(start).toBe(6);
  for (let zoom = start + 1; zoom <= 10; zoom++) {
    await zoomIn.click();
    await expect.poll(groundView).toEqual({ zoom, animating: false });
  }
  const z10 = () => requests.filter((r) => r.url().includes("/terrarium/10/"));
  await expect.poll(() => z10().length).toBeGreaterThan(0);
  await Promise.all(z10().map((r) => r.response()));
  await twoFrames(page);
}

test("Sirius rising behind the summit cones: the card says so, in plain words", async ({
  page,
}) => {
  await openClipAt(page, SIRIUS_BEHIND, "?sel=star:2491");
  const card = objectCard(page);
  await expect(card).toContainText("Sirius (star)");
  await expect(card).toContainText("Low in the east");
  const details = await detailsWithSkyline(page);
  await expect(card.getByText("Behind the mountains", { exact: true }).first()).toBeVisible();
  await expect(details).toContainText("Direction: az 108.4°, alt 1.9°");
  await expect(details).toContainText(/Mountain skyline here: \+3\.[5-9]°/);
  await twoFrames(page);
  await page
    .locator('[data-map="sky"]')
    .screenshot({ path: test.info().outputPath("subaru-skyline.png") });
});

test("Sirius above the summit cones twenty minutes later", async ({ page }) => {
  await openClipAt(page, SIRIUS_ABOVE, "?sel=star:2491");
  const card = objectCard(page);
  await expect(card).toContainText("Sirius (star)");
  const details = await detailsWithSkyline(page);
  await expect(details).toContainText("Direction: az 110.2°, alt 6.1°");
  await expect(details).toContainText(/Mountain skyline here: \+3\.\d°/);
  await expect(card).not.toContainText("Behind the mountains");
});

test("hillshade: image tiles, every terrain credit, and the night badge only at night", async ({
  page,
}) => {
  const requests = recordTerrarium(page);
  await openClipAt(page, DAY);
  const layers = await openLayers(page);
  await layers.getByRole("checkbox", { name: "Terrain shading" }).check();
  await page.keyboard.press("Escape");
  // The ground map's tiles load through <img>; the horizon worker's are "fetch".
  await expect
    .poll(() => requests.filter((r) => r.resourceType() === "image").length)
    .toBeGreaterThan(0);

  const credits = await openPopover(page, "Credits", "Credits");
  await expect(credits.getByRole("link", { name: TERRAIN_CREDIT })).toHaveAttribute(
    "href",
    TERRAIN_CREDIT_HREF,
  );
  for (const statement of STATEMENTS) {
    await expect(credits.getByText(statement, { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  // 12:00 HST: the relief is Sun-lit.
  await zoomGroundTo10(page, requests);
  await expect(page.getByText(NIGHT_BADGE)).toHaveCount(0);
  await page
    .locator('[data-map="ground"]')
    .screenshot({ path: test.info().outputPath("hillshade-day.png") });

  // 22:00 HST: the Sun is far below; the relief switches to fixed lighting and says so.
  requests.length = 0; // zoomGroundTo10 waits for this page's own z10 tiles
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openClipAt(page, NIGHT);
  const night = await openLayers(page);
  await night.getByRole("checkbox", { name: "Terrain shading" }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByText(NIGHT_BADGE, { exact: true })).toBeVisible();
  await zoomGroundTo10(page, requests);
  await page
    .locator('[data-map="ground"]')
    .screenshot({ path: test.info().outputPath("hillshade-night.png") });
});
