// tests/unit/fetchGp.test.ts — scripts/fetch-gp.ts (M3 step 8) against a fake fetch and a temp directory.
// Nothing here reaches CelesTrak: every call passes fetchImpl, and setup.ts blocks the real fetch anyway.
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CELESTRAK_GP_URL,
  FETCH_TIMEOUT_MS,
  type FetchLike,
  fetchGp,
  gpUrl,
  MIN_REFETCH_MS,
  parseGpMeta,
  runCli,
  shouldFetch,
  userAgentFor,
} from "../../scripts/fetch-gp";
import type { GpGroup, GpMeta } from "../../src/domain/orbits";

const FIXTURE_DIR = new URL("../fixtures/gp/", import.meta.url);
const fixtureBytes = async (name: string): Promise<Buffer> => readFile(new URL(name, FIXTURE_DIR));
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** 2026-10-11T03:50:21Z, the snapshot's stamp. */
const SNAPSHOT_MS = 1_791_690_621_000;
const HOUR_MS = 3_600_000;
const UA = "overhead-fetch-gp/1.0 (+https://github.com/FalconXYX/Overhead)";
const REPO_URL = "https://github.com/FalconXYX/Overhead";
const STATIONS_SHA = "648b069c3cc87606f670886699e5b8159d1518d3e505579783016d2831c07fb6";
const VISUAL_SHA = "1649b851ccc5f0adcd8431f3b642ef5d91abd480cb8cc6cc727e6f44a96796e9";
const STARLINK_SHA = "9b411b5ca47fe267dd75571a8d646f6d58c04f1bc0264bad4d36ec6ca4556928";

interface Call {
  url: string;
  init: RequestInit;
}

type Answer = Response | Error | (() => Response);

/** A fake fetch answering per GROUP= parameter; records every call. A group without an answer is a test bug. */
function fakeFetch(answers: Partial<Record<GpGroup, Answer>>): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const group = new URL(url).searchParams.get("GROUP") as GpGroup | null;
    const answer = group === null ? undefined : answers[group];
    if (answer === undefined) throw new Error(`unexpected request ${url}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  };
  return { fetchImpl, calls };
}

const ok = (body: Uint8Array | string): Response =>
  new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200 });
const status = (code: number, body: string | null = `HTTP ${code} body`): Response =>
  new Response(body, { status: code });

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fetch-gp-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const readMeta = async (outDir = dir): Promise<Partial<GpMeta>> =>
  JSON.parse(await readFile(join(outDir, "meta.json"), "utf8")) as Partial<GpMeta>;
const mtimeMs = async (path: string): Promise<number> => (await stat(path)).mtimeMs;
const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("MIN_REFETCH_MS and shouldFetch", () => {
  const meta: Partial<GpMeta> = {
    stations: { fetchedAtMs: SNAPSHOT_MS, count: 22, sha256: STATIONS_SHA },
  };

  it("is 2 h", () => {
    expect(MIN_REFETCH_MS).toBe(7_200_000);
  });

  it("skips at 2 h − 1 min and fetches at 2 h", () => {
    expect(shouldFetch(meta, "stations", SNAPSHOT_MS + MIN_REFETCH_MS - 60_000)).toBe(false);
    expect(shouldFetch(meta, "stations", SNAPSHOT_MS + MIN_REFETCH_MS)).toBe(true);
  });

  it("fetches a group with no stamp, and everything on a first run", () => {
    expect(shouldFetch(meta, "visual", SNAPSHOT_MS)).toBe(true);
    expect(shouldFetch(null, "stations", SNAPSHOT_MS)).toBe(true);
  });

  it("skips a stamp up to 2 h in the future (clock skew) but not a stamp further ahead", () => {
    expect(shouldFetch(meta, "stations", SNAPSHOT_MS - HOUR_MS)).toBe(false);
    expect(shouldFetch(meta, "stations", SNAPSHOT_MS - MIN_REFETCH_MS)).toBe(true);
  });
});

describe("gpUrl", () => {
  it("always asks CelesTrak for FORMAT=json by group", () => {
    expect(CELESTRAK_GP_URL).toBe("https://celestrak.org/NORAD/elements/gp.php");
    expect(gpUrl("stations")).toBe(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json",
    );
    expect(gpUrl("starlink")).toBe(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json",
    );
  });

  it("takes another base URL for tests", () => {
    expect(gpUrl("visual", "http://127.0.0.1:8123/gp.php")).toBe(
      "http://127.0.0.1:8123/gp.php?GROUP=visual&FORMAT=json",
    );
  });
});

describe("userAgentFor", () => {
  it("names the tool and the repository", () => {
    expect(userAgentFor(REPO_URL)).toBe(UA);
  });

  it("rejects anything that is not a plain http(s) URL, including e-mail addresses", () => {
    for (const bad of [
      "",
      "github.com/FalconXYX/Overhead",
      "mailto:someone@example.com",
      "https://someone@example.com/repo",
      "https://example.com/someone@example.com",
      "https://github.com/FalconXYX/Overhead?contact=someone@example.com",
      "https://github.com/FalconXYX/Overhead (someone@example.com)",
      "ftp://example.com/repo",
      "https://github.com/a)b",
    ]) {
      expect(() => userAgentFor(bad), bad).toThrow();
    }
  });
});

describe("parseGpMeta", () => {
  it("accepts the committed snapshot meta and a partial meta", async () => {
    const text = (await fixtureBytes("meta.json")).toString("utf8");
    const meta = parseGpMeta(JSON.parse(text));
    expect(meta.stations).toEqual({ fetchedAtMs: SNAPSHOT_MS, count: 22, sha256: STATIONS_SHA });
    expect(meta.visual?.count).toBe(156);
    expect(meta.starlink?.count).toBe(11102);
    expect(parseGpMeta({})).toEqual({});
  });

  it("rejects a non-object, an unknown group and malformed entries", () => {
    const good = { fetchedAtMs: SNAPSHOT_MS, count: 22, sha256: STATIONS_SHA };
    for (const bad of [
      null,
      [],
      "meta",
      { gnss: good },
      { stations: null },
      { stations: { ...good, fetchedAtMs: "1791690621000" } },
      { stations: { ...good, fetchedAtMs: Number.NaN } },
      { stations: { ...good, count: -1 } },
      { stations: { ...good, count: 1.5 } },
      { stations: { ...good, sha256: "abc" } },
      { stations: { ...good, sha256: STATIONS_SHA.toUpperCase() } },
    ]) {
      expect(() => parseGpMeta(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("fetchGp", () => {
  it("stations 200 + visual 403: exactly 2 requests, then stops with only stations in meta", async () => {
    const stations = await fixtureBytes("stations.json");
    const { fetchImpl, calls } = fakeFetch({
      stations: ok(stations),
      visual: status(403, "GP data has not updated since your last successful download"),
    });
    const lines: string[] = [];
    const result = await fetchGp({
      outDir: dir,
      nowMs: SNAPSHOT_MS,
      userAgent: UA,
      fetchImpl,
      log: (line) => lines.push(line),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json",
    );
    expect(calls[1]?.url).toBe(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json",
    );
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      expect(headers.get("User-Agent")).toBe(UA);
      expect(headers.get("Accept")).toBe("application/json");
      expect(call.init.redirect).toBe("manual");
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.init.method ?? "GET").toBe("GET");
    }

    expect(result.error).toMatch(/^visual: HTTP 403 /);
    expect(result.error).toContain("GP data has not updated");
    expect(result.requests).toBe(2);
    expect(result.fetched).toEqual(["stations"]);
    expect(result.written).toEqual(["stations"]);
    expect(result.skipped).toEqual([]);

    expect(await readMeta()).toEqual({
      stations: { fetchedAtMs: SNAPSHOT_MS, count: 22, sha256: STATIONS_SHA },
    });
    expect(result.meta).toEqual(await readMeta());
    expect((await readdir(dir)).sort()).toEqual(["meta.json", "stations.json"]);
    expect(sha256(await readFile(join(dir, "stations.json")))).toBe(STATIONS_SHA);
    expect(lines.some((line) => line.startsWith("stations:"))).toBe(true);
  });

  it("a run 1 h later, with visual answering 403 again, makes 1 request (stations skipped)", async () => {
    const stations = await fixtureBytes("stations.json");
    const first = fakeFetch({ stations: ok(stations), visual: status(403) });
    await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl: first.fetchImpl });
    const metaBefore = await readFile(join(dir, "meta.json"), "utf8");

    const second = fakeFetch({ visual: status(403) });
    const result = await fetchGp({
      outDir: dir,
      nowMs: SNAPSHOT_MS + HOUR_MS,
      userAgent: UA,
      fetchImpl: second.fetchImpl,
    });

    expect(second.calls.map((c) => c.url)).toEqual([
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json",
    ]);
    expect(result.skipped).toEqual(["stations"]);
    expect(result.fetched).toEqual([]);
    expect(result.error).toMatch(/^visual: HTTP 403/);
    // Nothing succeeded, so meta.json keeps the first run's stamp.
    expect(await readFile(join(dir, "meta.json"), "utf8")).toBe(metaBefore);
  });

  it("a 200 with CelesTrak's 'No GP data found' text stops after 1 request and writes nothing", async () => {
    const { fetchImpl, calls } = fakeFetch({ stations: ok("No GP data found") });
    const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(result.error).toMatch(/^stations: HTTP 200 /);
    expect(result.error).toContain("No GP data found");
    expect(result.fetched).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("a 200 with [], an HTML page or a non-OMM array stops the run", async () => {
    for (const body of [
      "[]",
      "<!DOCTYPE html><html><body>Maintenance</body></html>",
      '[{"OBJECT_NAME":"ISS (ZARYA)"}]',
      '{"OBJECT_NAME":"ISS (ZARYA)"}',
    ]) {
      const { fetchImpl, calls } = fakeFetch({ stations: ok(body) });
      const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
      expect(calls, body).toHaveLength(1);
      expect(result.error, body).toMatch(/^stations: HTTP 200 /);
      expect(await readdir(dir), body).toEqual([]);
    }
  });

  it("stops on every non-200 status, including 301 (redirects are never followed) and 304", async () => {
    for (const code of [201, 204, 301, 302, 304, 400, 403, 404, 429, 500, 503]) {
      const nullBody = code === 204 || code === 304;
      const { fetchImpl, calls } = fakeFetch({
        stations: status(code, nullBody ? null : "moved"),
      });
      const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
      expect(calls, String(code)).toHaveLength(1);
      expect(result.error, String(code)).toMatch(new RegExp(`^stations: HTTP ${code}\\b`));
      expect(await readdir(dir), String(code)).toEqual([]);
    }
  });

  it("keeps the groups fetched before a stop: stations + visual 200, starlink 500", async () => {
    const [stations, visual] = await Promise.all([
      fixtureBytes("stations.json"),
      fixtureBytes("visual.json"),
    ]);
    const { fetchImpl, calls } = fakeFetch({
      stations: ok(stations),
      visual: ok(visual),
      starlink: status(500, "x".repeat(2000)),
    });
    const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
    expect(calls).toHaveLength(3);
    expect(result.fetched).toEqual(["stations", "visual"]);
    // The error quotes at most 500 characters of the body.
    expect(result.error).toBe(`starlink: HTTP 500 ${"x".repeat(500)}`);
    expect(Object.keys(await readMeta())).toEqual(["stations", "visual"]);
    expect((await readMeta()).visual).toEqual({
      fetchedAtMs: SNAPSHOT_MS,
      count: 156,
      sha256: VISUAL_SHA,
    });
  });

  it("a network error or the 60 s timeout stops the run without a retry", async () => {
    expect(FETCH_TIMEOUT_MS).toBe(60_000);
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    for (const failure of [timeout, new TypeError("fetch failed")]) {
      const { fetchImpl, calls } = fakeFetch({ stations: failure });
      const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
      expect(calls).toHaveLength(1);
      expect(result.error).toMatch(/^stations: /);
      expect(await readdir(dir)).toEqual([]);
    }
    const { fetchImpl } = fakeFetch({ stations: timeout });
    const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
    expect(result.error).toBe("stations: timed out after 60 s");
  });

  it("a full first run reproduces the snapshot byte for byte, meta.json included", async () => {
    const [stations, visual, starlink] = await Promise.all([
      fixtureBytes("stations.json"),
      fixtureBytes("visual.json"),
      fixtureBytes("starlink.json"),
    ]);
    const out = join(dir, "nested", "gp"); // created on demand
    const { fetchImpl, calls } = fakeFetch({
      stations: ok(stations),
      visual: ok(visual),
      starlink: ok(starlink),
    });
    const result = await fetchGp({ outDir: out, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl });
    expect(result.error).toBeNull();
    expect(calls.map((c) => new URL(c.url).searchParams.get("GROUP"))).toEqual([
      "stations",
      "visual",
      "starlink",
    ]);
    expect(result.written).toEqual(["stations", "visual", "starlink"]);
    for (const name of ["stations.json", "visual.json", "starlink.json", "meta.json"]) {
      expect((await readFile(join(out, name))).equals(await fixtureBytes(name)), name).toBe(true);
    }
    expect((await readMeta(out)).starlink?.sha256).toBe(STARLINK_SHA);
    expect((await readdir(out)).sort()).toEqual([
      "meta.json",
      "starlink.json",
      "stations.json",
      "visual.json",
    ]);
  });

  it("an unchanged body is not rewritten, a changed one is, and every stamp is refreshed", async () => {
    const [stations, visual, starlink] = await Promise.all([
      fixtureBytes("stations.json"),
      fixtureBytes("visual.json"),
      fixtureBytes("starlink.json"),
    ]);
    // Seed the directory as the snapshot, with old mtimes.
    for (const name of ["stations.json", "visual.json", "starlink.json", "meta.json"]) {
      await writeFile(join(dir, name), await fixtureBytes(name));
      await utimes(join(dir, name), new Date(SNAPSHOT_MS), new Date(SNAPSHOT_MS));
    }
    const stationsMtime = await mtimeMs(join(dir, "stations.json"));
    const starlinkMtime = await mtimeMs(join(dir, "starlink.json"));

    // Visual changes: drop its first record.
    const visualRecords = JSON.parse(visual.toString("utf8")) as unknown[];
    const newVisual = Buffer.from(JSON.stringify(visualRecords.slice(1)), "utf8");
    const now = SNAPSHOT_MS + 6 * HOUR_MS;
    const { fetchImpl } = fakeFetch({
      stations: ok(stations),
      visual: ok(newVisual),
      starlink: ok(starlink),
    });
    const result = await fetchGp({ outDir: dir, nowMs: now, userAgent: UA, fetchImpl });

    expect(result.error).toBeNull();
    expect(result.fetched).toEqual(["stations", "visual", "starlink"]);
    expect(result.written).toEqual(["visual"]);
    expect(await mtimeMs(join(dir, "stations.json"))).toBe(stationsMtime);
    expect(await mtimeMs(join(dir, "starlink.json"))).toBe(starlinkMtime);
    expect((await readFile(join(dir, "visual.json"))).equals(newVisual)).toBe(true);
    expect(await readMeta()).toEqual({
      stations: { fetchedAtMs: now, count: 22, sha256: STATIONS_SHA },
      visual: { fetchedAtMs: now, count: 155, sha256: sha256(newVisual) },
      starlink: { fetchedAtMs: now, count: 11102, sha256: STARLINK_SHA },
    });
  });

  it("rewrites a group file whose bytes on disk no longer match, even if the body hash equals meta", async () => {
    const stations = await fixtureBytes("stations.json");
    await writeFile(join(dir, "stations.json"), "[]");
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify({ stations: { fetchedAtMs: SNAPSHOT_MS, count: 22, sha256: STATIONS_SHA } }),
    );
    const { fetchImpl } = fakeFetch({ stations: ok(stations), visual: status(403) });
    const result = await fetchGp({
      outDir: dir,
      nowMs: SNAPSHOT_MS + MIN_REFETCH_MS,
      userAgent: UA,
      fetchImpl,
    });
    expect(result.written).toEqual(["stations"]);
    expect(sha256(await readFile(join(dir, "stations.json")))).toBe(STATIONS_SHA);
  });

  it("makes no request and leaves meta.json alone when every stamp is under 2 h old", async () => {
    await writeFile(join(dir, "meta.json"), await fixtureBytes("meta.json"));
    await utimes(join(dir, "meta.json"), new Date(SNAPSHOT_MS), new Date(SNAPSHOT_MS));
    const before = await mtimeMs(join(dir, "meta.json"));
    const { fetchImpl, calls } = fakeFetch({});
    const result = await fetchGp({
      outDir: dir,
      nowMs: SNAPSHOT_MS + MIN_REFETCH_MS - 1,
      userAgent: UA,
      fetchImpl,
    });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({
      requests: 0,
      error: null,
      skipped: ["stations", "visual", "starlink"],
      fetched: [],
      written: [],
    });
    expect(await mtimeMs(join(dir, "meta.json"))).toBe(before);
  });

  it("corrupt or malformed meta.json throws before any request", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    for (const text of ["{not json", "[]", '{"stations":{"fetchedAtMs":"soon"}}']) {
      await writeFile(join(dir, "meta.json"), text);
      await expect(
        fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA, fetchImpl }),
        text,
      ).rejects.toThrow(/meta\.json/);
    }
    expect(calls).toHaveLength(0);
  });

  it("uses the real fetch only when no fetchImpl is given (blocked in unit tests)", async () => {
    const result = await fetchGp({ outDir: dir, nowMs: SNAPSHOT_MS, userAgent: UA });
    expect(result.requests).toBe(1);
    expect(result.error).toContain("fetch is blocked in unit tests");
    expect(await exists(join(dir, "meta.json"))).toBe(false);
  });
});

describe("runCli", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, log: (s: string) => out.push(s), logError: (s: string) => err.push(s) };
  };

  it("exits 2 before any request without GP_CONTACT_URL", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const { err, log, logError } = io();
    const code = await runCli(["--out", dir], {}, { fetchImpl, log, logError });
    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(err.join("\n")).toContain("GP_CONTACT_URL");
  });

  it("exits 2 before any request for a bad GP_CONTACT_URL or bad arguments", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const { log, logError } = io();
    const env = { GP_CONTACT_URL: REPO_URL };
    expect(
      await runCli(
        ["--out", dir],
        { GP_CONTACT_URL: "me@example.com" },
        { fetchImpl, log, logError },
      ),
    ).toBe(2);
    expect(await runCli(["--out"], env, { fetchImpl, log, logError })).toBe(2);
    expect(await runCli(["--out", dir, "--retry"], env, { fetchImpl, log, logError })).toBe(2);
    expect(await runCli([dir], env, { fetchImpl, log, logError })).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("sends the repository User-Agent and exits 1 after a stop, printing 'Stopped: <error>'", async () => {
    const stations = await fixtureBytes("stations.json");
    const { fetchImpl, calls } = fakeFetch({
      stations: ok(stations),
      visual: status(301, "moved"),
    });
    const { err, log, logError } = io();
    const code = await runCli(
      ["--out", dir],
      { GP_CONTACT_URL: REPO_URL },
      { fetchImpl, log, logError, now: () => SNAPSHOT_MS },
    );
    expect(code).toBe(1);
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0]?.init.headers).get("User-Agent")).toBe(UA);
    expect(err).toContain("Stopped: visual: HTTP 301 moved");
    expect((await readMeta()).stations?.fetchedAtMs).toBe(SNAPSHOT_MS);
  });

  it("exits 0 when every group is fresh, and 1 with a message for a corrupt meta.json", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const { err, log, logError } = io();
    await writeFile(join(dir, "meta.json"), await fixtureBytes("meta.json"));
    const env = { GP_CONTACT_URL: REPO_URL };
    expect(
      await runCli(["--out", dir], env, { fetchImpl, log, logError, now: () => SNAPSHOT_MS }),
    ).toBe(0);
    await writeFile(join(dir, "meta.json"), "{");
    expect(
      await runCli(["--out", dir], env, { fetchImpl, log, logError, now: () => SNAPSHOT_MS }),
    ).toBe(1);
    expect(err.join("\n")).toContain("meta.json");
    expect(calls).toHaveLength(0);
  });
});
