// src/app/credits.ts — data-source credits (README Credits). Grows with every source.
import type { Credit, LayersState } from "../state/types";

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

/**
 * GIBS_CREDIT when gibsReady and any GIBS layer is on; OSM_NE_CREDIT when gibsReady and coastlines is on.
 * M3 adds satellites and starlink, M7 goesIr. Returns a new array: call it during render, never in useAppState.
 */
export function dataCredits(
  layers: Pick<LayersState, "trueColor" | "coastlines">,
  gibsReady: boolean,
): Credit[] {
  const credits: Credit[] = [];
  if (gibsReady && (layers.trueColor || layers.coastlines)) credits.push(GIBS_CREDIT);
  if (gibsReady && layers.coastlines) credits.push(OSM_NE_CREDIT);
  return credits;
}

/** [M2] BSC5_CREDIT and IAU_WGSN_CREDIT while stars are on, else []. A new array: call it during render. */
export function starCredits(starsOn: boolean): Credit[] {
  return starsOn ? [BSC5_CREDIT, IAU_WGSN_CREDIT] : [];
}
