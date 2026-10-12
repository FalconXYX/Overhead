// scripts/fetch-gp.ts — download CelesTrak's GP groups as OMM JSON into public/data/gp/ (M3 step 8).
// Run by .github/workflows/fetch-gp.yml every 6 h:
//   GP_CONTACT_URL=<repository URL> npx tsx scripts/fetch-gp.ts [--out <dir>]   (default public/data/gp)
// CelesTrak's usage policy shapes every rule here: a group whose meta.json stamp is under 2 h old is
// skipped; FORMAT=json is always sent (the default became CSV on 2026-05-09); the run stops at the first
// non-200, including 403 "GP data has not updated since your last successful download" and a 301, because
// 50 errors in 2 h firewall the IP; it never retries and never loops. Unit tests inject fetchImpl.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GP_GROUPS, type GpGroup, type GpMeta, parseGpFile } from "../src/domain/orbits";

/** A group is fetched again only when its stamp is at least this old. */
export const MIN_REFETCH_MS = 2 * 60 * 60 * 1000;
export const CELESTRAK_GP_URL = "https://celestrak.org/NORAD/elements/gp.php";
export const FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_OUT_DIR = "public/data/gp";
/** At most this much of an error body goes into the error message. */
const ERROR_BODY_CHARS = 500;

/** The part of `fetch` this script uses; tests pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type GpMetaEntry = GpMeta[GpGroup];

/** meta.json as stored: a group appears once it has been fetched successfully. */
export type StoredGpMeta = Partial<GpMeta>;

export interface FetchGpOptions {
  outDir: string;
  nowMs: number;
  userAgent: string;
  /** Replaces CELESTRAK_GP_URL (a local test server). */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
}

export interface FetchGpResult {
  /** Requests made (one per group at most). */
  requests: number;
  /** Groups answered with 200 and usable OMM JSON, in order. */
  fetched: GpGroup[];
  /** Groups whose file was (re)written because its sha256 changed or it was missing. */
  written: GpGroup[];
  /** Groups skipped because their stamp was under 2 h old. */
  skipped: GpGroup[];
  /** The reason the run stopped, or null when every group was fetched or skipped. */
  error: string | null;
  /** meta.json after the run (unchanged when nothing was fetched). */
  meta: StoredGpMeta;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isGroup = (key: string): key is GpGroup => (GP_GROUPS as readonly string[]).includes(key);

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Validates meta.json's parsed content. Throws on anything this script would not have written. */
export function parseGpMeta(json: unknown): StoredGpMeta {
  if (!isRecord(json)) throw new Error("meta.json: expected an object of groups");
  const meta: StoredGpMeta = {};
  for (const [key, value] of Object.entries(json)) {
    if (!isGroup(key)) throw new Error(`meta.json: unknown group "${key}"`);
    if (!isRecord(value)) throw new Error(`meta.json: ${key} is not an object`);
    const { fetchedAtMs, count, sha256 } = value;
    if (typeof fetchedAtMs !== "number" || !Number.isFinite(fetchedAtMs)) {
      throw new Error(`meta.json: ${key}.fetchedAtMs is not a finite number`);
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`meta.json: ${key}.count is not a non-negative integer`);
    }
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
      throw new Error(`meta.json: ${key}.sha256 is not 64 lowercase hex digits`);
    }
    meta[key] = { fetchedAtMs, count, sha256 };
  }
  return meta;
}

/**
 * True when the group has no stamp or its stamp is at least 2 h old. A stamp up to 2 h in the future
 * (clock skew between runners) also counts as fresh; one further ahead cannot be right and is ignored.
 */
export function shouldFetch(meta: StoredGpMeta | null, group: GpGroup, nowMs: number): boolean {
  const stamp = meta?.[group]?.fetchedAtMs;
  if (stamp === undefined) return true;
  return Math.abs(nowMs - stamp) >= MIN_REFETCH_MS;
}

/** `<base>?GROUP=<group>&FORMAT=json`. */
export function gpUrl(group: GpGroup, baseUrl: string = CELESTRAK_GP_URL): string {
  const url = new URL(baseUrl);
  url.searchParams.set("GROUP", group);
  url.searchParams.set("FORMAT", "json");
  return url.href;
}

/**
 * `overhead-fetch-gp/1.0 (+<contactUrl>)`. CelesTrak asks for a contact; the repository URL is it.
 * Throws unless contactUrl is a plain http(s) URL: no credentials, no "@" (never a personal e-mail
 * address), no whitespace or parentheses that would break the User-Agent comment.
 */
export function userAgentFor(contactUrl: string): string {
  let url: URL;
  try {
    url = new URL(contactUrl);
  } catch {
    throw new Error(`GP_CONTACT_URL is not a URL: "${contactUrl}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`GP_CONTACT_URL must be an http(s) URL: "${contactUrl}"`);
  }
  if (/[@\s()]/.test(contactUrl) || url.username !== "" || url.password !== "") {
    throw new Error(
      `GP_CONTACT_URL must be the repository URL, without "@", spaces or parentheses: "${contactUrl}"`,
    );
  }
  return `overhead-fetch-gp/1.0 (+${contactUrl})`;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

/** Write through a temporary file and rename, so a crash never leaves a half-written file. */
async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** meta.json with groups in GP_GROUPS order, 2-space indented, newline-terminated (the snapshot's format). */
function formatMeta(meta: StoredGpMeta): string {
  const ordered: Partial<Record<GpGroup, GpMetaEntry>> = {};
  for (const group of GP_GROUPS) {
    const entry = meta[group];
    if (entry !== undefined) ordered[group] = entry;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function describeFailure(err: unknown): string {
  if (isRecord(err) && err.name === "TimeoutError") {
    return `timed out after ${FETCH_TIMEOUT_MS / 1000} s`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Why a 200 body is unusable, or its record count when it is a non-empty OMM array. */
function checkBody(text: string): { problem: string } | { count: number } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problem: "not JSON" };
  }
  try {
    const records = parseGpFile(json);
    if (records.length === 0) return { problem: "an empty array" };
    return { count: records.length };
  } catch (err) {
    return { problem: `not usable OMM JSON (${describeFailure(err)})` };
  }
}

/**
 * One pass over GP_GROUPS, sequentially. Reads <outDir>/meta.json first (missing = first run; corrupt
 * throws before any request). Skips fresh groups, stops at the first failure, rewrites a group file only
 * when its sha256 changed, always refreshes the stamp of a fetched group, and writes meta.json when at
 * least one group was fetched, so groups fetched before a stop are kept.
 */
export async function fetchGp(o: FetchGpOptions): Promise<FetchGpResult> {
  const doFetch: FetchLike = o.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const log = o.log ?? (() => {});
  const metaPath = join(o.outDir, "meta.json");

  const metaBytes = await readIfExists(metaPath);
  let stored: StoredGpMeta | null = null;
  if (metaBytes !== null) {
    let json: unknown;
    try {
      json = JSON.parse(metaBytes.toString("utf8"));
    } catch (err) {
      throw new Error(`${metaPath}: corrupt meta.json (${describeFailure(err)})`);
    }
    stored = parseGpMeta(json);
  }

  const meta: StoredGpMeta = { ...stored };
  const result: FetchGpResult = {
    requests: 0,
    fetched: [],
    written: [],
    skipped: [],
    error: null,
    meta,
  };

  for (const group of GP_GROUPS) {
    if (!shouldFetch(stored, group, o.nowMs)) {
      const ageMin = Math.round((o.nowMs - (stored?.[group]?.fetchedAtMs ?? o.nowMs)) / 60_000);
      log(`${group}: skipped (fetched ${ageMin} min ago, under 2 h)`);
      result.skipped.push(group);
      continue;
    }

    const url = gpUrl(group, o.baseUrl);
    log(`${group}: GET ${url}`);
    result.requests++;
    let res: Response;
    let bytes: Buffer;
    try {
      res = await doFetch(url, {
        method: "GET",
        headers: { "User-Agent": o.userAgent, Accept: "application/json" },
        redirect: "manual", // a 301 is an error to CelesTrak too: stop, do not follow
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      result.error = `${group}: ${describeFailure(err)}`;
      break;
    }
    const text = bytes.toString("utf8");
    if (res.status !== 200) {
      // Stop on any non-200, including 403 "not updated since your last download". Never retry.
      result.error = `${group}: HTTP ${res.status} ${text.slice(0, ERROR_BODY_CHARS)}`.trimEnd();
      break;
    }
    const check = checkBody(text);
    if ("problem" in check) {
      result.error =
        `${group}: HTTP 200 but ${check.problem}: ${text.slice(0, ERROR_BODY_CHARS)}`.trimEnd();
      break;
    }

    const sha256 = sha256Hex(bytes);
    const filePath = join(o.outDir, `${group}.json`);
    const current = await readIfExists(filePath);
    if (current === null || sha256Hex(current) !== sha256) {
      await mkdir(o.outDir, { recursive: true });
      await writeAtomic(filePath, bytes);
      result.written.push(group);
      log(`${group}: ${check.count} records, written (sha256 ${sha256.slice(0, 12)}…)`);
    } else {
      log(`${group}: ${check.count} records, unchanged`);
    }
    meta[group] = { fetchedAtMs: o.nowMs, count: check.count, sha256 };
    result.fetched.push(group);
  }

  if (result.fetched.length > 0) {
    await mkdir(o.outDir, { recursive: true });
    await writeAtomic(metaPath, formatMeta(meta));
  }
  return result;
}

export interface CliDeps {
  fetchImpl?: FetchLike;
  now?: () => number;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

const USAGE = "Usage: GP_CONTACT_URL=<repository URL> npx tsx scripts/fetch-gp.ts [--out <dir>]";

/**
 * The CLI: 0 when every group was fetched or skipped; 1 after a stop (printing `Stopped: <error>`) or a
 * corrupt meta.json; 2 for bad arguments or a missing or invalid GP_CONTACT_URL, before any request.
 */
export async function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const logError = deps.logError ?? ((line: string) => console.error(line));

  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg !== "--out") {
      logError(`Unexpected argument ${JSON.stringify(arg)}.\n${USAGE}`);
      return 2;
    }
    if (value === undefined || value === "" || value.startsWith("--")) {
      logError(`--out needs a directory.\n${USAGE}`);
      return 2;
    }
    outDir = value;
    i++;
  }

  const contact = env.GP_CONTACT_URL;
  if (contact === undefined || contact === "") {
    logError(`GP_CONTACT_URL is not set (the repository URL, sent in the User-Agent).\n${USAGE}`);
    return 2;
  }
  let userAgent: string;
  try {
    userAgent = userAgentFor(contact);
  } catch (err) {
    logError(describeFailure(err));
    return 2;
  }

  try {
    const result = await fetchGp({
      outDir,
      nowMs: (deps.now ?? Date.now)(),
      userAgent,
      fetchImpl: deps.fetchImpl,
      log,
    });
    if (result.error !== null) {
      logError(`Stopped: ${result.error}`);
      return 1;
    }
    log(
      `Done: ${result.fetched.length} fetched (${result.written.length} changed), ${result.skipped.length} skipped`,
    );
    return 0;
  } catch (err) {
    logError(describeFailure(err));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runCli(process.argv.slice(2), process.env);
}
