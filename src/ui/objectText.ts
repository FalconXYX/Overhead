// src/ui/objectText.ts — what the object card, the hover card and the Layers panel say about satellites, stars and
// bodies (M3 step 15). Pure functions over ephemeris.ts and skyCache.ts data, kept out of the component files so each
// stays a React Fast Refresh boundary (components-only exports, as gibsStatus.ts). [Redesign] Plain language first
// (friendly.ts); az/alt, NORAD ids, magnitudes and element ages appear only in "More details".
import { BODY_IDS, BODY_STRIDE, type StarRow } from "../domain/astro";
import { wrap360 } from "../domain/geo";
import {
  elementAgeDays,
  GP_GROUPS,
  type GpGroup,
  STALE_ELEMENTS_DAYS,
  SUN_CUTOFF_DEG,
} from "../domain/orbits";
import { horizonAltAtAzDeg } from "../domain/terrain";
import { formatUtcHhMm, isoDateUtc } from "../domain/time";
import { type BodyId, bodyLabel } from "../map/sky/layers/bodies";
import type { GroupData, LoadStatus, ObjectId } from "../state/types";
import { friendlyName, visibilityText } from "./friendly";

// ---- Field formats for "More details" (degrees and km) ----

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
  return sunlit ? "Lit by the Sun" : "In Earth's shadow";
}

/** The CelesTrak list a satellite came from, for "More details". */
export const GROUP_LABELS: Readonly<Record<GpGroup, string>> = {
  stations: "Space stations",
  visual: "Brightest satellites",
  starlink: "Starlink",
};

const EARTH_MU_KM3_S2 = 398_600.4418;
const EARTH_MEAN_RADIUS_KM = 6_371;

/**
 * About how fast it moves, from its height alone: the circular-orbit speed √(μ / (R + h)). Close for the near-circular
 * low orbits of nearly everything drawn; "about" in the text covers the rest. E.g. 418 km → 7.66 km/s.
 */
export function orbitalSpeedKmS(heightKm: number): number {
  return Math.sqrt(EARTH_MU_KM3_S2 / (EARTH_MEAN_RADIUS_KM + heightKm));
}

/** "Height above Earth: 418 km". */
export function heightText(heightKm: number): string {
  return `Height above Earth: ${Math.round(heightKm).toLocaleString("en-US")} km`;
}

/** "Speed: about 27,600 km/h (7.7 km/s)", to the nearest 100 km/h. */
export function speedText(heightKm: number): string {
  const kmS = orbitalSpeedKmS(heightKm);
  const kmH = Math.round((kmS * 3600) / 100) * 100;
  return `Speed: about ${kmH.toLocaleString("en-US")} km/h (${kmS.toFixed(1)} km/s)`;
}

/** |sim time − epoch| > STALE_ELEMENTS_DAYS: flagged, still drawn. */
export function isStale(epochMs: number, timeMs: number): boolean {
  return Math.abs(elementAgeDays(epochMs, timeMs)) > STALE_ELEMENTS_DAYS;
}

/**
 * "Orbit data (elements) 1.3 days old", or "Old orbit data (elements), 19.9 days old: the position may be off"; "… ahead
 * of this time" when the sim time is earlier.
 */
export function elementAgeText(epochMs: number, timeMs: number): string {
  const age = elementAgeDays(epochMs, timeMs);
  const days = Math.abs(age).toFixed(1);
  const when = age < 0 && days !== "0.0" ? `${days} days ahead of this time` : `${days} days old`;
  return isStale(epochMs, timeMs)
    ? `Old orbit data (elements), ${when}: the position may be off`
    : `Orbit data (elements) ${when}`;
}

/** The lighting and horizon facts of one frame that decide visibility. */
export interface VisibilityFacts {
  readonly sunlit: boolean;
  /** [M6] Apparent alt above the terrain horizon at its azimuth (0°, the geometric horizon, until a profile is ready). */
  readonly aboveHorizon: boolean;
  readonly visible: boolean; // the frame's visible flag (isVisible)
  readonly sunAltDeg: number; // geometric
  readonly altDeg: number; // apparent
}

/**
 * [Redesign] friendly.ts's visibility line for a satellite in this frame. [M6] Not above the horizon while above 0°
 * means at or below the terrain horizon: behind the mountains. The Sun above the group's cut-off: too bright.
 */
export function satelliteVisibilityText(facts: VisibilityFacts, group: GpGroup): string {
  return visibilityText(
    facts.sunlit,
    !facts.aboveHorizon && facts.altDeg > 0,
    facts.altDeg,
    !(facts.sunAltDeg <= SUN_CUTOFF_DEG[group]),
  );
}

/** [M6] At or below the terrain horizon at its azimuth: "behind the mountains" on the card and in the list. */
export function behindTerrain(
  profileDeg: Float32Array | null,
  azDeg: number,
  altDeg: number,
): boolean {
  return profileDeg !== null && altDeg <= horizonAltAtAzDeg(profileDeg, azDeg);
}

/**
 * [M6] The card's terrain lines ("More details") for an object at (azDeg, altDeg), both apparent: ready gives
 * "Mountain skyline here: +32.7°" (signed, one decimal, at the object's azimuth) and "Behind the mountains" when the
 * object is at or below it; loading and error give one status line; idle gives none. Text, never colour alone.
 */
export function terrainLines(
  status: LoadStatus,
  profileDeg: Float32Array | null,
  azDeg: number,
  altDeg: number,
): string[] {
  if (status === "loading") return ["Mountain skyline: loading"];
  if (status === "error") return ["Mountain skyline: unavailable (a flat horizon is used)"];
  if (status !== "ready" || profileDeg === null) return [];
  const text = signedFixed(horizonAltAtAzDeg(profileDeg, azDeg), 1);
  const lines = [`Mountain skyline here: ${text.startsWith("−") ? text : `+${text}`}°`];
  if (behindTerrain(profileDeg, azDeg, altDeg)) lines.push("Behind the mountains");
  return lines;
}

/** "Progress cargo ship" → "Progress cargo ships"; "Spent rocket stage (SL-3)" → "Spent rocket stages (SL-3)". */
function plural(name: string): string {
  const at = name.indexOf(" (");
  return at < 0 ? `${name}s` : `${name.slice(0, at)}s${name.slice(at)}`;
}

/**
 * The vehicles docked to an object, by friendly name in catalog order, repeats counted: "Docked to it: Poisk module,
 * 2 Progress cargo ships and Dragon capsule".
 */
export function dockedText(catalogNames: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of catalogNames) {
    const f = friendlyName(name);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const parts = [...counts].map(([name, n]) => (n === 1 ? name : `${n} ${plural(name)}`));
  const last = parts.pop() ?? "";
  return `Docked to it: ${parts.length === 0 ? last : `${parts.join(", ")} and ${last}`}`;
}

/**
 * True while a group that could hold a satellite is still to come: stations or visual not loaded yet, or Starlink
 * loading. A sat: id missing from the catalog then means "not loaded yet", not "not in the loaded groups".
 */
export function satelliteGroupsPending(gp: Readonly<Record<GpGroup, GroupData>>): boolean {
  const pending = (g: GroupData): boolean => g.status === "idle" || g.status === "loading";
  return pending(gp.stations) || pending(gp.visual) || gp.starlink.status === "loading";
}

/** A selected satellite that no loaded list holds (a shared link to a Starlink, say). */
export function missingSatelliteText(): string {
  return "This satellite isn't in the loaded data. If it is a Starlink satellite, turn on Starlink in Layers.";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The groups' total and their oldest fetch stamp. */
function groupTotals(groups: readonly GroupData[]): { count: number; fetchedAtMs: number | null } {
  let count = 0;
  let fetchedAtMs: number | null = null;
  for (const g of groups) {
    count += g.count;
    if (g.fetchedAtMs !== null && (fetchedAtMs === null || g.fetchedAtMs < fetchedAtMs)) {
      fetchedAtMs = g.fetchedAtMs;
    }
  }
  return { count, fetchedAtMs };
}

/**
 * One Layers toggle's groups (stations + visual, or starlink): "Failed to load", "Loading…", or "165 objects, data from
 * 11 Oct 2026" (the sum, and the oldest fetch date, UTC); null while every group is idle.
 */
export function groupStatusText(groups: readonly GroupData[]): string | null {
  if (groups.every((g) => g.status === "idle")) return null;
  if (groups.some((g) => g.status === "error")) return "Failed to load";
  if (groups.some((g) => g.status !== "ready")) return "Loading…";
  const { count, fetchedAtMs } = groupTotals(groups);
  const objects = `${count.toLocaleString("en-US")} ${count === 1 ? "object" : "objects"}`;
  if (fetchedAtMs === null) return objects;
  const d = new Date(fetchedAtMs);
  return `${objects}, data from ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A tooltip for groupStatusText once ready: "Orbit data (CelesTrak elements) fetched 2026-10-11 03:50 UTC"; else null. */
export function groupFetchedTitle(groups: readonly GroupData[]): string | null {
  if (!groups.every((g) => g.status === "ready")) return null;
  const { fetchedAtMs } = groupTotals(groups);
  return fetchedAtMs === null
    ? null
    : `Orbit data (CelesTrak elements) fetched ${isoDateUtc(fetchedAtMs)} ${formatUtcHhMm(fetchedAtMs)} UTC`;
}

/**
 * [M6] The "Horizon line" toggle's status: nothing while idle, "Loading the mountains…", "Mountains loaded", or
 * "Mountains unavailable: flat horizon".
 */
export function horizonStatusText(status: LoadStatus): string | null {
  switch (status) {
    case "idle":
      return null;
    case "loading":
      return "Loading the mountains…";
    case "ready":
      return "Mountains loaded";
    case "error":
      return "Mountains unavailable: flat horizon";
  }
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

const COMPUTING = "Working out where it is…";

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
    note = "Its position is unknown at this time"; // decayed or bad elements, or its group is not propagated
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
  if (sky.rows.length === 0) return { ...fallback, note: "Loading the stars…" };
  const i = rowIndexOfHr(sky.rows, hr);
  const row = i === undefined ? undefined : sky.rows[i];
  if (i === undefined || row === undefined) return { ...fallback, note: "Not in the star list" };
  const label = row[4] === "" ? `HR ${hr}` : row[4];
  const base = { kind: "star", hr, label, vmag: row[2] } as const;
  // Only the magnitude prefix is rotated each pass.
  if (i >= sky.starCount) {
    return { ...base, live: null, note: "Too faint to be drawn" };
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

/** Everything the object card and the hover card show about one object, from this frame's data. */
export function objectDetails(id: ObjectId, sources: DetailSources): ObjectDetails {
  if (id.startsWith("sat:")) return satelliteDetails(Number(id.slice(4)), sources);
  if (id.startsWith("star:")) return starDetails(Number(id.slice(5)), sources);
  if (isBodyId(id)) return bodyDetails(id, sources);
  // ObjectId has no other members: parseObjectId never lets one in.
  throw new Error(`Unknown object id ${id}`);
}

/** "Brightness: V magnitude 2.02 (lower is brighter)": the catalogue's V magnitude, as stars.json holds it. */
export function starMagnitudeText(vmag: number): string {
  return `Brightness: V magnitude ${signedFixed(vmag, 2)} (lower is brighter)`;
}

/** "Brightness: magnitude −2.5 (lower is brighter)": astronomy-engine's visual magnitude for the Sun, Moon, planets. */
export function bodyMagnitudeText(mag: number): string {
  return `Brightness: magnitude ${signedFixed(mag, 1)} (lower is brighter)`;
}

/** "Direction: az 123.8°, alt 28.9°": apparent, for "More details". */
export function directionText(azDeg: number, altDeg: number): string {
  return `Direction: ${azText(azDeg)}, ${altText(altDeg)}`;
}
