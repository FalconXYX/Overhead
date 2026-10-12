// src/map/ground/layers/goes.ts — the GOES-West Band 13 overlay (M7 step 4): its constants, the DescribeDomains and
// HEAD-probe URLs, and the layer. The URL builders mirror what OpenLayers writes for the KVP source.
import TileLayer from "ol/layer/Tile";
import WMTS from "ol/source/WMTS";
import {
  floorToStepMs,
  GOES_RETENTION_MS,
  GOES_STEP_MS,
  isoUtcSeconds,
} from "../../../domain/time";
import { type GibsCapabilities, gibsWmtsOptions } from "./gibs";

export const GOES_LAYER = "GOES-West_ABI_Band13_Clean_Infrared";
export const LEVEL6 = "GoogleMapsCompatible_Level6";
/** The brief's 60 %; the final value is settled from screenshots. */
export const GOES_OPACITY = 0.6;
const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

/** DescribeDomains over the retention window. The end is now floored to the minute, so each poll gets a fresh answer. */
export function goesDomainUrl(nowMs: number): string {
  const start = isoUtcSeconds(floorToStepMs(nowMs - GOES_RETENTION_MS, GOES_STEP_MS));
  const end = isoUtcSeconds(floorToStepMs(nowMs, 60_000));
  return `${GIBS_BASE}/1.0.0/${GOES_LAYER}/default/${LEVEL6}/all/${start}--${end}.xml`;
}

/** KVP GetTile URL of tile 0/0/0 at one step, with the parameters OpenLayers writes: the HEAD probe. */
export function goesProbeUrl(stepMs: number): string {
  const time = encodeURIComponent(isoUtcSeconds(stepMs));
  return `${GIBS_BASE}/wmts.cgi?layer=${GOES_LAYER}&style=default&tilematrixset=${LEVEL6}&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=0&TileCol=0&TileRow=0&Time=${time}`;
}

/** Text of the <Domain> element ("" when empty), or null when there is none. Regex: no DOMParser in Node. */
export function domainTextFromXml(xml: string): string | null {
  return /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1] ?? null;
}

/**
 * Hidden until bindGoesLayer shows it; its Time is set by bindGoesTime before then. The source starts on the
 * snapshot's capabilities Default, which leaves the 90-day window a few months after the snapshot (Gotcha 2).
 * dropLimits: GIBS's limits stop at z5 and OpenLayers keeps only the first range per level (Gotcha 1).
 */
export function createGoesLayer(caps: GibsCapabilities): { layer: TileLayer<WMTS>; source: WMTS } {
  const source = new WMTS(gibsWmtsOptions(caps, GOES_LAYER, LEVEL6, true));
  const layer = new TileLayer({ source, opacity: GOES_OPACITY, visible: false });
  return { layer, source };
}
