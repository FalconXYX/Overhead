// src/ui/objectText.ts — what the Inspector, the hover card and the Layers panel say about satellites, stars and
// bodies (M3 step 15). Pure functions over ephemeris.ts and skyCache.ts data, kept out of the component files so each
// stays a React Fast Refresh boundary (components-only exports, as gibsStatus.ts).
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../domain/astro";
import { wrap360 } from "../domain/geo";
import {
  elementAgeDays,
  GP_GROUPS,
  type GpGroup,
  STALE_ELEMENTS_DAYS,
  SUN_CUTOFF_DEG,
} from "../domain/orbits";
import { formatUtcHhMm, isoDateUtc } from "../domain/time";
import { type BodyId, bodyLabel } from "../map/sky/layers/bodies";
import type { GroupData, ObjectId } from "../state/types";

// ---- Field formats (the hover card and the Inspector share them) ----

/** toFixed with a true minus sign and no "-0.0". */
function signedFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  if (/^-0\.?0*$/.test(text)) return text.slice(1);
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

/** "az 123.8°": to 0.1°, in [0, 360) after rounding (359.96 reads "az 0.0°"). */
export function azText(azDeg: number): string {
  return `az ${wrap360(Math.round(azDeg * 10) / 10).toFixed(1)}°`;
}

/** "alt 28.9°": apparent, to 0.1°, signed. */
export function altText(altDeg: number): string {
  return `alt ${signedFixed(altDeg, 1)}°`;
}

/** "795 km": whole km (Math.round), grouped. */
export function rangeText(rangeKm: number): string {
  return `${Math.round(rangeKm).toLocaleString("en-US")} km`;
}

export function litText(sunlit: boolean): string {
  return sunlit ? "Sunlit" : "In Earth's shadow";
}

export const GROUP_LABELS: Readonly<Record<GpGroup, string>> = {
  stations: "Space stations",
  visual: "Brightest (CelesTrak visual)",
  starlink: "Starlink",
};

/** |sim time − epoch| > STALE_ELEMENTS_DAYS: flagged, still drawn. */
export function isStale(epochMs: number, timeMs: number): boolean {
  return Math.abs(elementAgeDays(epochMs, timeMs)) > STALE_ELEMENTS_DAYS;
}

/** "Elements 1.3 days old", or "Stale elements: 19.9 days old"; "… ahead of this time" when the sim time is earlier. */
export function elementAgeText(epochMs: number, timeMs: number): string {
  const age = elementAgeDays(epochMs, timeMs);
  const days = Math.abs(age).toFixed(1);
  const when = age < 0 && days !== "0.0" ? `${days} days ahead of this time` : `${days} days old`;
  return isStale(epochMs, timeMs) ? `Stale elements: ${when}` : `Elements ${when}`;
}

/** The lighting and horizon facts of one frame that decide visibility. */
export interface VisibilityFacts {
  readonly sunlit: boolean;
  readonly aboveHorizon: boolean; // apparent alt > 0 (the geometric horizon until M6)
  readonly visible: boolean; // the frame's visible flag (isVisible)
  readonly sunAltDeg: number; // geometric
}

/** "Visible to the eye", or the first failing reason in the order shadow, Sun, horizon. */
export function visibilityText(facts: VisibilityFacts, group: GpGroup): string {
  if (facts.visible) return "Visible to the eye";
  if (!facts.sunlit) return "Not visible: in Earth's shadow";
  if (!(facts.sunAltDeg <= SUN_CUTOFF_DEG[group])) return "Not visible: Sun too high";
  if (!facts.aboveHorizon) return "Not visible: below the horizon";
  return "Not visible to the eye";
}

export function dockedText(names: readonly string[]): string {
  return `Docked: ${names.join(", ")}`;
}

/**
 * True while a group that could hold a satellite is still to come: stations or visual not loaded yet, or Starlink
 * loading. A sat: id missing from the catalog then means "not loaded yet", not "not in the loaded groups".
 */
export function satelliteGroupsPending(gp: Readonly<Record<GpGroup, GroupData>>): boolean {
  const pending = (g: GroupData): boolean => g.status === "idle" || g.status === "loading";
  return pending(gp.stations) || pending(gp.visual) || gp.starlink.status === "loading";
}

export function missingSatelliteText(noradId: number): string {
  return `Satellite ${noradId} is not in the loaded groups. Turn on Starlink if it is a Starlink satellite.`;
}

/**
 * One Layers toggle's groups (stations + visual, or starlink): "Failed to load", "Loading…", or "165 objects, elements
 * fetched 2026-10-11 03:50 UTC" (the sum, and the oldest stamp); null while every group is idle.
 */
export function groupStatusText(groups: readonly GroupData[]): string | null {
  if (groups.every((g) => g.status === "idle")) return null;
  if (groups.some((g) => g.status === "error")) return "Failed to load";
  if (groups.some((g) => g.status !== "ready")) return "Loading…";
  let count = 0;
  let fetchedAtMs: number | null = null;
  for (const g of groups) {
    count += g.count;
    if (g.fetchedAtMs !== null && (fetchedAtMs === null || g.fetchedAtMs < fetchedAtMs)) {
      fetchedAtMs = g.fetchedAtMs;
    }
  }
  const objects = `${count.toLocaleString("en-US")} ${count === 1 ? "object" : "objects"}`;
  return fetchedAtMs === null
    ? objects
    : `${objects}, elements fetched ${isoDateUtc(fetchedAtMs)} ${formatUtcHhMm(fetchedAtMs)} UTC`;
}

// ---- Object details ----

/** The parts of ephemeris.ts's SatCatalog this module reads. */
export interface CatalogView {
  readonly count: number;
  readonly noradIds: ArrayLike<number>;
  readonly names: readonly string[];
  readonly groupIndex: ArrayLike<number>; // index into GP_GROUPS
  readonly epochMs: ArrayLike<number>;
  readonly dockedWith: ArrayLike<number>; // host NORAD id, or −1
  readonly indexByNorad: ReadonlyMap<number, number>;
}

/** The parts of ephemeris.ts's SatFrame this module reads. */
export interface SatFrameView {
  readonly timeMs: number;
  readonly ready: boolean;
  readonly sunAltDeg: number;
  readonly azAltDeg: ArrayLike<number>; // altitude apparent
  readonly rangeKm: ArrayLike<number>;
  readonly flags: ArrayLike<number>; // bit 0 valid, 1 sunlit, 2 above horizon, 3 visible
}

/** The parts of skyCache this module reads. */
export interface SkyView {
  readonly rows: readonly StarRow[];
  readonly starCount: number;
  readonly starAzAltDeg: ArrayLike<number>;
  readonly bodies: ArrayLike<number>;
}

export interface DetailSources {
  readonly catalog: CatalogView;
  readonly frame: SatFrameView;
  readonly sky: SkyView;
}

const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
const FLAG_ABOVE_HORIZON = 4;
const FLAG_VISIBLE = 8;

export interface SatelliteLive extends VisibilityFacts {
  readonly azDeg: number;
  readonly altDeg: number; // apparent
  readonly rangeKm: number;
}

export interface SatelliteDetails {
  readonly kind: "satellite";
  readonly noradId: number;
  readonly name: string;
  readonly group: GpGroup;
  readonly epochMs: number;
  /** The host when this object is docked: it is drawn, and positioned, as its host. */
  readonly dockedTo: { readonly noradId: number; readonly name: string } | null;
  /** Names of the vehicles docked to this object, in catalog order. */
  readonly docked: readonly string[];
  readonly live: SatelliteLive | null;
  /** Why live is null. */
  readonly note: string | null;
}

export interface MissingSatelliteDetails {
  readonly kind: "missing-satellite";
  readonly noradId: number;
}

export interface StarDetails {
  readonly kind: "star";
  readonly hr: number;
  readonly label: string; // name, else "HR n"
  readonly vmag: number | null; // null until the catalogue has the row
  readonly live: { readonly azDeg: number; readonly altDeg: number } | null;
  readonly note: string | null;
}

export interface BodyDetails {
  readonly kind: "body";
  readonly id: BodyId;
  readonly label: string;
  readonly live: { readonly azDeg: number; readonly altDeg: number; readonly mag: number } | null;
  readonly note: string | null;
}

export type ObjectDetails = SatelliteDetails | MissingSatelliteDetails | StarDetails | BodyDetails;

const COMPUTING = "Computing position…";

function satelliteDetails(noradId: number, { catalog, frame }: DetailSources): ObjectDetails {
  const own = catalog.indexByNorad.get(noradId);
  if (own === undefined) return { kind: "missing-satellite", noradId };
  const hostId = catalog.dockedWith[own] ?? -1;
  const host = hostId >= 0 ? catalog.indexByNorad.get(hostId) : undefined;
  const at = host ?? own; // docked rows are never valid: the host's row carries the position
  const docked: string[] = [];
  if (hostId < 0) {
    for (let i = 0; i < catalog.count; i++) {
      if (catalog.dockedWith[i] === noradId) docked.push(catalog.names[i] ?? "");
    }
  }
  const flags = frame.flags[at] ?? 0;
  let live: SatelliteLive | null = null;
  let note: string | null = null;
  if (!frame.ready) {
    note = COMPUTING;
  } else if ((flags & FLAG_VALID) === 0) {
    note = "No position at this time"; // decayed or bad elements, or its group is not propagated
  } else {
    live = {
      azDeg: frame.azAltDeg[2 * at] ?? Number.NaN,
      altDeg: frame.azAltDeg[2 * at + 1] ?? Number.NaN,
      rangeKm: frame.rangeKm[at] ?? Number.NaN,
      sunlit: (flags & FLAG_SUNLIT) !== 0,
      aboveHorizon: (flags & FLAG_ABOVE_HORIZON) !== 0,
      visible: (flags & FLAG_VISIBLE) !== 0,
      sunAltDeg: frame.sunAltDeg,
    };
  }
  return {
    kind: "satellite",
    noradId,
    name: catalog.names[own] ?? `NORAD ${noradId}`,
    group: GP_GROUPS[catalog.groupIndex[own] ?? 0] ?? "stations",
    epochMs: catalog.epochMs[own] ?? Number.NaN,
    dockedTo:
      host === undefined
        ? null
        : { noradId: hostId, name: catalog.names[host] ?? `NORAD ${hostId}` },
    docked,
    live,
    note,
  };
}

/** HR number → row index, per catalogue array (the rows are sorted by vmag, not HR). */
const rowIndexCache = new WeakMap<readonly StarRow[], Map<number, number>>();

function rowIndexOfHr(rows: readonly StarRow[], hr: number): number | undefined {
  let byHr = rowIndexCache.get(rows);
  if (byHr === undefined) {
    byHr = new Map(rows.map((row, i) => [row[3], i]));
    rowIndexCache.set(rows, byHr);
  }
  return byHr.get(hr);
}

function starDetails(hr: number, { sky }: DetailSources): StarDetails {
  const fallback = { kind: "star", hr, label: `HR ${hr}`, vmag: null, live: null } as const;
  if (sky.rows.length === 0) return { ...fallback, note: "Loading star catalogue…" };
  const i = rowIndexOfHr(sky.rows, hr);
  const row = i === undefined ? undefined : sky.rows[i];
  if (i === undefined || row === undefined)
    return { ...fallback, note: "Not in the star catalogue" };
  const label = row[4] === "" ? `HR ${hr}` : row[4];
  const base = { kind: "star", hr, label, vmag: row[2] } as const;
  // Only the magnitude prefix is rotated each pass.
  if (i >= sky.starCount) {
    return { ...base, live: null, note: "Fainter than the star magnitude limit" };
  }
  const azDeg = sky.starAzAltDeg[2 * i] ?? Number.NaN;
  const altDeg = sky.starAzAltDeg[2 * i + 1] ?? Number.NaN;
  return Number.isFinite(azDeg) && Number.isFinite(altDeg)
    ? { ...base, live: { azDeg, altDeg }, note: null }
    : { ...base, live: null, note: COMPUTING };
}

function bodyDetails(id: BodyId, { sky }: DetailSources): BodyDetails {
  const o = BODY_IDS.indexOf(id) * BODY_STRIDE;
  const azDeg = sky.bodies[o] ?? Number.NaN;
  const altDeg = sky.bodies[o + 1] ?? Number.NaN;
  const mag = sky.bodies[o + 2] ?? Number.NaN;
  const label = bodyLabel(id, sky.bodies[o + 3] ?? Number.NaN);
  // skyCache.bodies is NaN until the first sky pass.
  return Number.isFinite(azDeg) && Number.isFinite(altDeg)
    ? { kind: "body", id, label, live: { azDeg, altDeg, mag }, note: null }
    : { kind: "body", id, label, live: null, note: COMPUTING };
}

const isBodyId = (id: string): id is BodyId => (BODY_IDS as readonly string[]).includes(id);

/** Everything the Inspector and the hover card show about one object, from this frame's data. */
export function objectDetails(id: ObjectId, sources: DetailSources): ObjectDetails {
  if (id.startsWith("sat:")) return satelliteDetails(Number(id.slice(4)), sources);
  if (id.startsWith("star:")) return starDetails(Number(id.slice(5)), sources);
  if (isBodyId(id)) return bodyDetails(id, sources);
  // ObjectId has no other members: parseObjectId never lets one in.
  throw new Error(`Unknown object id ${id}`);
}

/** "V magnitude 2.02": the catalogue's V magnitude, as stars.json holds it. */
export function starMagnitudeText(vmag: number): string {
  return `V magnitude ${signedFixed(vmag, 2)}`;
}

/** "Magnitude −2.5": astronomy-engine's visual magnitude for the Sun, Moon and planets. */
export function bodyMagnitudeText(mag: number): string {
  return `Magnitude ${signedFixed(mag, 1)}`;
}
