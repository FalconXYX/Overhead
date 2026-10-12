// src/domain/orbits/omm.ts — CelesTrak OMM files: validation, dedupe across groups, docking, element age (M3 step 3).
import { json2satrec, type OMMJsonObject, propagate, type SatRec } from "satellite.js";
import { wrap180, wrap360 } from "../geo";
import { parseOmmEpochMs } from "../time";

export type GpGroup = "stations" | "visual" | "starlink"; // [M0]
/** Index i of this array is bit i of a GroupMask. */
export const GP_GROUPS = ["stations", "visual", "starlink"] as const;
export type GroupMask = number;
export const ISS_NORAD_ID = 25544; // [M3]
export const STALE_ELEMENTS_DAYS = 7;

/** public/data/gp/meta.json, written by scripts/fetch-gp.ts. count = records in the file, before dedupe and docking. */
export type GpMeta = Record<GpGroup, { fetchedAtMs: number; count: number; sha256: string }>;

export interface CatalogEntry {
  readonly noradId: number; // up to 6 digits; never assume 5
  readonly name: string;
  readonly group: GpGroup;
  readonly epochMs: number;
  /**
   * NORAD id of the host (lowest id of the cluster) when this object is docked: near-identical elements and
   * within 1 km at the later epoch and 45 min later (M3 step 3). Docked objects are not drawn.
   */
  readonly dockedWith: number | null;
  readonly omm: OMMJsonObject;
}

const DAY_MS = 86_400_000;

// ---- validation

/** A decimal number, as Space-Track writes them ("0.0001307", ".00066723", "-1.2E-4"). */
const NUMERIC_STRING_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DIGITS_RE = /^\d+$/;
const REQUIRED_STRINGS = ["OBJECT_NAME", "OBJECT_ID", "EPOCH"] as const;
const REQUIRED_NUMBERS = [
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
  "ELEMENT_SET_NO",
] as const;
/** Optional fields OMMJsonObject types as strings. */
const OPTIONAL_STRINGS = [
  "COMMENT",
  "CLASSIFICATION",
  "REF_FRAME_EPOCH",
  "CREATION_DATE",
  "ORIGINATOR",
] as const;
/** Optional header fields OMMJsonObject restricts to one value. CelesTrak omits them. */
const FIXED_HEADERS = {
  CENTER_NAME: "EARTH",
  REF_FRAME: "TEME",
  TIME_SYSTEM: "UTC",
  MEAN_ELEMENT_THEORY: "SGP4",
} as const;

/** A finite number, or a string that is one. */
function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && NUMERIC_STRING_RE.test(v) && Number.isFinite(Number(v));
}

/** NORAD_CAT_ID as a positive integer (number or digit string, any length), else NaN. */
function noradIdOf(v: unknown): number {
  const n =
    typeof v === "number" ? v : typeof v === "string" && DIGITS_RE.test(v) ? Number(v) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : Number.NaN;
}

/** Why v is not a usable OMMJsonObject, or null when it is. */
function ommProblem(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "not an object";
  // Every value is `unknown` here: the checks below are what make the record an OMMJsonObject.
  const r = v as Readonly<Record<string, unknown>>;
  for (const key of REQUIRED_STRINGS)
    if (typeof r[key] !== "string") return `${key} is not a string`;
  if (!Number.isFinite(parseOmmEpochMs(String(r.EPOCH))))
    return `EPOCH ${JSON.stringify(String(r.EPOCH).slice(0, 40))} is not a time`;
  if (Number.isNaN(noradIdOf(r.NORAD_CAT_ID))) return "NORAD_CAT_ID is not a positive integer";
  for (const key of REQUIRED_NUMBERS)
    if (!isNumeric(r[key])) return `${key} is not a finite number`;
  const ephemerisType = r.EPHEMERIS_TYPE;
  if (ephemerisType !== undefined && ephemerisType !== 0 && ephemerisType !== "0")
    return "EPHEMERIS_TYPE is not 0 (SGP4)";
  const classification = r.CLASSIFICATION_TYPE;
  if (classification !== undefined && classification !== "U" && classification !== "C")
    return 'CLASSIFICATION_TYPE is not "U" or "C"';
  const version = r.CCSDS_OMM_VERS;
  if (version !== undefined && !(typeof version === "string" && version.startsWith("3.")))
    return "CCSDS_OMM_VERS is not 3.x";
  for (const [key, value] of Object.entries(FIXED_HEADERS))
    if (r[key] !== undefined && r[key] !== value) return `${key} is not ${value}`;
  for (const key of OPTIONAL_STRINGS)
    if (r[key] !== undefined && typeof r[key] !== "string") return `${key} is not a string`;
  const rev = r.REV_AT_EPOCH;
  if (rev !== undefined && typeof rev !== "number" && typeof rev !== "string")
    return "REV_AT_EPOCH is not a number or a string";
  return null;
}

/** OMMJsonObject type guard (gotcha 4: no hand-written OMM interface). */
function isOmm(v: unknown): v is OMMJsonObject {
  return ommProblem(v) === null;
}

/** Throws on a non-array or on records that are not usable OMM (M3 step 3). [] is valid. */
export function parseGpFile(json: unknown): OMMJsonObject[] {
  if (!Array.isArray(json)) {
    const got = json === null ? "null" : typeof json;
    throw new Error(`GP file is not a JSON array (got ${got})`);
  }
  const records: readonly unknown[] = json;
  const out: OMMJsonObject[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!isOmm(record)) {
      const id =
        typeof record === "object" && record !== null && "NORAD_CAT_ID" in record
          ? noradIdOf(record.NORAD_CAT_ID)
          : Number.NaN;
      const which = Number.isNaN(id) ? `record ${i}` : `record ${i} (NORAD ${id})`;
      throw new Error(`GP file ${which} is not a usable OMM: ${ommProblem(record) ?? "invalid"}`);
    }
    out.push(record);
  }
  return out;
}

// ---- dedupe and docking

/** Docking candidates: mean argument of latitude within this window at the group's newest epoch. */
const DOCK_WINDOW_U_DEG = 0.05;
const DOCK_MAX_DN_REV_DAY = 0.001;
const DOCK_MAX_DI_DEG = 0.05;
const DOCK_MAX_DRAAN_DEG = 0.05;
const DOCK_MAX_KM = 1;
const DOCK_RECHECK_MS = 45 * 60_000;

interface Kept {
  readonly omm: OMMJsonObject;
  readonly noradId: number;
  readonly epochMs: number;
}

/**
 * Appends one group: drops NORAD ids already in seenNoradIds (across groups and within this one), marks docked
 * objects. Mutates seenNoradIds. One entry per kept record, in file order.
 */
export function appendGroup(
  seenNoradIds: Set<number>,
  group: GpGroup,
  omms: readonly OMMJsonObject[],
): CatalogEntry[] {
  const kept: Kept[] = [];
  for (const omm of omms) {
    const noradId = Number(omm.NORAD_CAT_ID);
    if (seenNoradIds.has(noradId)) continue;
    seenNoradIds.add(noradId);
    kept.push({ omm, noradId, epochMs: parseOmmEpochMs(omm.EPOCH) });
  }
  const hosts = dockingHosts(kept);
  return kept.map(
    (k, i): CatalogEntry => ({
      noradId: k.noradId,
      name: k.omm.OBJECT_NAME,
      group,
      epochMs: k.epochMs,
      dockedWith: hosts[i] ?? null,
      omm: k.omm,
    }),
  );
}

/**
 * Host NORAD id per record (null when not docked). A pair is docked when its elements are near-identical
 * (|Δn| ≤ 0.001 rev/day, |Δi| ≤ 0.05°, |ΔΩ| ≤ 0.05°, Δu ≤ 0.05°) and the two objects are within 1 km at the later
 * epoch and again 45 min later. Candidates come from a sweep over u sorted mod 360 (no O(n²) loop); confirmed
 * pairs are joined with union-find; the host of a cluster is its lowest NORAD id.
 */
function dockingHosts(kept: readonly Kept[]): (number | null)[] {
  const count = kept.length;
  const hosts: (number | null)[] = new Array(count).fill(null);
  if (count < 2) return hosts;

  let tRefMs = Number.NEGATIVE_INFINITY;
  for (const k of kept) tRefMs = Math.max(tRefMs, k.epochMs);
  const motion = new Float64Array(count); // rev/day
  const incl = new Float64Array(count);
  const raan = new Float64Array(count);
  const u = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const k = kept[i];
    if (k === undefined) continue;
    const o = k.omm;
    motion[i] = Number(o.MEAN_MOTION);
    incl[i] = Number(o.INCLINATION);
    raan[i] = Number(o.RA_OF_ASC_NODE);
    const ageDays = (tRefMs - k.epochMs) / DAY_MS;
    u[i] = wrap360(
      Number(o.ARG_OF_PERICENTER) + Number(o.MEAN_ANOMALY) + 360 * (motion[i] ?? 0) * ageDays,
    );
  }
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (u[a] ?? 0) - (u[b] ?? 0),
  );

  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    while (i !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const satrecs: (SatRec | undefined)[] = new Array(count);
  const satrecAt = (i: number): SatRec | null => {
    const k = kept[i];
    if (k === undefined) return null;
    satrecs[i] ??= json2satrec(k.omm);
    return satrecs[i] ?? null;
  };

  for (let a = 0; a < count; a++) {
    const i = order[a] ?? 0;
    for (let step = 1; step < count; step++) {
      const j = order[(a + step) % count] ?? 0;
      const du = (u[j] ?? 0) - (u[i] ?? 0) + (a + step >= count ? 360 : 0); // wraps past 360°
      if (du > DOCK_WINDOW_U_DEG) break;
      if (
        Math.abs((motion[i] ?? 0) - (motion[j] ?? 0)) > DOCK_MAX_DN_REV_DAY ||
        Math.abs((incl[i] ?? 0) - (incl[j] ?? 0)) > DOCK_MAX_DI_DEG ||
        Math.abs(wrap180((raan[i] ?? 0) - (raan[j] ?? 0))) > DOCK_MAX_DRAAN_DEG
      )
        continue;
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue;
      const tLaterMs = Math.max(kept[i]?.epochMs ?? 0, kept[j]?.epochMs ?? 0);
      if (
        withinKm(satrecAt(i), satrecAt(j), tLaterMs) &&
        withinKm(satrecAt(i), satrecAt(j), tLaterMs + DOCK_RECHECK_MS)
      )
        parent[ri] = rj;
    }
  }

  const hostOfRoot = new Map<number, number>();
  const size = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    const id = kept[i]?.noradId ?? 0;
    hostOfRoot.set(root, Math.min(hostOfRoot.get(root) ?? id, id));
    size.set(root, (size.get(root) ?? 0) + 1);
  }
  for (let i = 0; i < count; i++) {
    const root = find(i);
    const host = hostOfRoot.get(root) ?? null;
    if ((size.get(root) ?? 1) > 1 && host !== kept[i]?.noradId) hosts[i] = host;
  }
  return hosts;
}

/** Both propagate at timeMs and lie within DOCK_MAX_KM of each other. */
function withinKm(a: SatRec | null, b: SatRec | null, timeMs: number): boolean {
  if (a === null || b === null) return false;
  const date = new Date(timeMs);
  const pa = propagate(a, date);
  const pb = propagate(b, date);
  if (pa === null || pb === null) return false;
  const dx = pa.position.x - pb.position.x;
  const dy = pa.position.y - pb.position.y;
  const dz = pa.position.z - pb.position.z;
  return dx * dx + dy * dy + dz * dz <= DOCK_MAX_KM * DOCK_MAX_KM;
}

/** (timeMs − epochMs) / 1 day. Stale means |age| > STALE_ELEMENTS_DAYS, relative to sim time. */
export function elementAgeDays(epochMs: number, timeMs: number): number {
  return (timeMs - epochMs) / DAY_MS;
}
