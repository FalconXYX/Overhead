// src/app/credits.ts — data-source credits (README Credits). Grows with every source.
import type { Credit, LayersState, LoadStatus } from "../state/types";

/** NASA GIBS, while GIBS is ready and any GIBS layer is on. Text as on the GIBS docs page. */
export const GIBS_CREDIT: Credit = {
  text: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
  href: "https://nasa-gibs.github.io/gibs-api-docs/",
  licence: null,
  licenceHref: null,
};

/** Coastlines and Reference_Labels (the Reference_Labels layer-metadata subtitle). OSM's ODbL requires credit and a licence link. */
export const OSM_NE_CREDIT: Credit = {
  text: "© OpenStreetMap contributors, Natural Earth",
  href: "https://www.openstreetmap.org/copyright",
  licence: "ODbL-1.0",
  licenceHref: "https://opendatacommons.org/licenses/odbl/",
};

/** The layer-metadata subtitle of TRUE_COLOR_LAYER (src/map/ground/layers/gibs.ts): change both together. */
export const TRUE_COLOR_INSTRUMENT = "NOAA-20 / VIIRS";

/** [M7] The GIBS layer-metadata subtitle of GOES_LAYER (src/map/ground/layers/goes.ts): change both together. */
export const GOES_SUBTITLE = "GOES-West/ABI";

/** The star catalogue behind stars.json (scripts/build-stars.ts reads CDS V/50). No licence is published. */
export const BSC5_CREDIT: Credit = {
  text: "Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), via CDS VizieR",
  href: "https://doi.org/10.26093/cds/vizier",
  licence: null,
  licenceHref: null,
};

/** The proper names in stars.json, from the IAU Working Group on Star Names' IAU-CSN list. */
export const IAU_WGSN_CREDIT: Credit = {
  text: "Star names: IAU WGSN",
  href: "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt",
  licence: "CC BY",
  licenceHref: null,
};

/** [M3] The OMM element sets behind every satellite (public/data/gp, fetched by scripts/fetch-gp.ts). */
export const CELESTRAK_CREDIT: Credit = {
  text: "Orbital elements: CelesTrak",
  href: "https://celestrak.org",
  licence: null,
  licenceHref: null,
};

/**
 * [M4] The cfht-nanaao camera's credit and terms note, exactly as in public/data/cameras.json (change both together).
 * Credits shows them through the active camera, like every camera credit; these names pin the text in tests.
 */
export const NANAAO_CREDIT: Credit = {
  text: "Nānā ao all-sky image © CFHT",
  href: "https://www.cfht.hawaii.edu/en/gallery/nanaao.php",
  licence: "GFDL-1.3-or-later",
  licenceHref: "https://www.gnu.org/licenses/fdl-1.3.html",
};
export const NANAAO_TERMS_NOTE = "GNU Free Documentation License 1.3 or later";

/** [M6] AWS Terrain Tiles (Tilezen Joerd): the horizon worker's and the hillshade's elevation data. */
export const TERRAIN_CREDIT: Credit = {
  text: "Terrain: AWS Terrain Tiles (Tilezen Joerd), data sources and attribution",
  href: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
  licence: null,
  licenceHref: null,
};

/**
 * [M6] The 11 lines of the joerd attribution document's "Required attribution" block, verbatim (fetched 2026-10-11;
 * line breaks joined, trailing ";" dropped). Always the full block, never a subset: hillshade tiles load through
 * <img>, whose x-amz-meta-x-imagery-sources header is not readable. The Mapzen line does not apply to the AWS bucket.
 */
export const TERRAIN_SOURCE_STATEMENTS: readonly string[] = [
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

/** [M6] Terrain data is in use, so its credit shows: the hillshade is on, or the active horizon is loading or ready. */
export function terrainInUse(hillshadeOn: boolean, horizonStatus: LoadStatus): boolean {
  return hillshadeOn || horizonStatus === "loading" || horizonStatus === "ready";
}

/**
 * GIBS_CREDIT when gibsReady and any GIBS layer is on; OSM_NE_CREDIT when gibsReady and coastlines is on;
 * CELESTRAK_CREDIT while satellites or starlink is on, whatever gibsReady is. The GIBS layers are trueColor,
 * coastlines and goesIr (M7). Returns a new array: call it during render, never in useAppState.
 */
export function dataCredits(
  layers: Pick<LayersState, "trueColor" | "coastlines" | "goesIr" | "satellites" | "starlink">,
  gibsReady: boolean,
): Credit[] {
  const credits: Credit[] = [];
  if (gibsReady && (layers.trueColor || layers.coastlines || layers.goesIr))
    credits.push(GIBS_CREDIT);
  if (gibsReady && layers.coastlines) credits.push(OSM_NE_CREDIT);
  // Not behind gibsReady: satellites draw on the sky view and the ground map without imagery.
  if (layers.satellites || layers.starlink) credits.push(CELESTRAK_CREDIT);
  return credits;
}

/** [M2] BSC5_CREDIT and IAU_WGSN_CREDIT while stars are on, else []. A new array: call it during render. */
export function starCredits(starsOn: boolean): Credit[] {
  return starsOn ? [BSC5_CREDIT, IAU_WGSN_CREDIT] : [];
}
