// tests/unit/fetchDeployClips.test.ts — [M9] scripts/fetch-deploy-clips.ts (M9 steps 14c, 14f) against a fake fetch and
// a temp directory. Nothing here reaches GitHub: every call passes fetchFn, and setup.ts blocks the real fetch anyway.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyClipGp,
  DEPLOY_CLIP_FILES,
  DEPLOY_CLIP_GP,
  DEPLOY_CLIP_MAX_BYTES,
  type DeployClipFile,
  fetchDeployClip,
  fetchDeployClips,
  MissingReleaseAssetError,
} from "../../scripts/fetch-deploy-clips";
import { sidecarFileName } from "../../src/app/clip";
import { committedCameras } from "../helpers/store";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const GP_FIXTURE_DIR = "tests/fixtures/gp";
const GP_FILES = ["meta.json", "starlink.json", "stations.json", "visual.json"];

/** A small stand-in for a release asset. */
const BODY = new TextEncoder().encode("not really an mp4, but bytes with a known hash\n");
const FILE: DeployClipFile = {
  name: "clip.mp4",
  url: "https://github.com/FalconXYX/Overhead/releases/download/test/clip.mp4",
  bytes: BODY.byteLength,
  sha256: sha256(BODY),
};

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A fetch that answers every request with `status` and `body`, recording the calls. */
function fakeFetch(
  status: number,
  body: Uint8Array<ArrayBuffer> = BODY,
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(status === 200 ? body : "Not Found", { status });
  };
  return { fn, calls };
}

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "overhead-deploy-clips-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("fetchDeployClip", () => {
  it("writes <outDir>/<name> from a 200 with the right bytes, following redirects", async () => {
    const out = join(tmp, "recordings");
    const { fn, calls } = fakeFetch(200);
    await fetchDeployClip(FILE, out, fn);
    expect(calls).toEqual([{ url: FILE.url, init: { redirect: "follow" } }]);
    expect(new Uint8Array(await readFile(join(out, "clip.mp4")))).toEqual(BODY);
  });

  it("sends no credentials", async () => {
    const { fn, calls } = fakeFetch(200);
    await fetchDeployClip(FILE, tmp, fn);
    expect(calls[0]?.init?.headers).toBeUndefined();
    expect(calls[0]?.init?.credentials).toBeUndefined();
  });

  const failures: [string, DeployClipFile, number, RegExp][] = [
    [
      "a wrong sha256",
      { ...FILE, sha256: "0".repeat(64) },
      200,
      /^clip\.mp4: sha256 [0-9a-f]{64}, expected 0{64}$/,
    ],
    [
      "a wrong length",
      { ...FILE, bytes: FILE.bytes + 1 },
      200,
      /^clip\.mp4: got \d+ bytes, expected \d+$/,
    ],
    ["a non-200 status", FILE, 404, /^clip\.mp4: HTTP 404 from https:\/\/github\.com\//],
    ["a partial answer", FILE, 206, /^clip\.mp4: HTTP 206 from /],
  ];
  for (const [what, file, status, message] of failures) {
    it(`throws, naming the file, on ${what}, and writes nothing`, async () => {
      const out = join(tmp, "recordings");
      await expect(fetchDeployClip(file, out, fakeFetch(status).fn)).rejects.toThrow(message);
      expect(existsSync(out)).toBe(false);
    });
  }

  it("refuses a file over DEPLOY_CLIP_MAX_BYTES before it downloads anything", async () => {
    const out = join(tmp, "recordings");
    const { fn, calls } = fakeFetch(200);
    await expect(
      fetchDeployClip({ ...FILE, bytes: DEPLOY_CLIP_MAX_BYTES + 1 }, out, fn),
    ).rejects.toThrow(/^clip\.mp4: 26214401 bytes is over the 25 MiB deploy-copy ceiling$/);
    expect(calls).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });
});

describe("DEPLOY_CLIP_FILES and DEPLOY_CLIP_GP", () => {
  const cameras = Object.values(committedCameras());
  /** The sidecar file names cameras.json names (local-video cameras with a sidecarUrl). */
  const sidecarNames = new Set(
    cameras.flatMap((c) =>
      c.kind === "local-video" && c.source.sidecarUrl !== null
        ? [c.source.sidecarUrl.slice(c.source.sidecarUrl.lastIndexOf("/") + 1)]
        : [],
    ),
  );
  const deployedSidecars = DEPLOY_CLIP_FILES.filter((f) => f.name.endsWith(".json"));

  it("holds the 2026-10-11 clip and its sidecar", () => {
    expect(DEPLOY_CLIP_FILES.map((f) => f.name)).toEqual([
      "subaru-2026-10-11-iss.mp4",
      "subaru-2026-10-11-iss.json",
    ]);
  });

  it("keeps every file under the ceiling, with a lowercase hex sha256 and a public release URL", () => {
    expect(DEPLOY_CLIP_MAX_BYTES).toBe(26_214_400);
    for (const file of DEPLOY_CLIP_FILES) {
      expect(file.bytes, file.name).toBeGreaterThan(0);
      expect(file.bytes, file.name).toBeLessThanOrEqual(26_214_400);
      expect(file.sha256, file.name).toMatch(/^[0-9a-f]{64}$/);
      expect(file.url, file.name).toBe(
        `https://github.com/FalconXYX/Overhead/releases/download/clips-2026-10-11/${file.name}`,
      );
    }
  });

  it("names only cameras.json sidecars and the videos next to them", () => {
    expect(deployedSidecars.length).toBeGreaterThan(0);
    for (const file of DEPLOY_CLIP_FILES) {
      expect(file.name, file.name).not.toMatch(/[/\\]/);
      if (file.name.endsWith(".json")) {
        expect(sidecarNames, file.name).toContain(file.name);
      } else {
        // A video is its sidecar's videoFile: "<clip>.mp4" next to "<clip>.json" (M5 step 10.8).
        expect(
          deployedSidecars.map((f) => f.name),
          file.name,
        ).toContain(sidecarFileName(file.name));
      }
    }
  });

  it("gives every deployed sidecar its element sets, from a committed GP directory", () => {
    const gpClips = DEPLOY_CLIP_GP.map((g) => g.clip);
    for (const sidecar of deployedSidecars) {
      expect(gpClips, sidecar.name).toContain(sidecar.name.replace(/\.json$/, ""));
    }
    for (const { clip, fromDir } of DEPLOY_CLIP_GP) {
      expect(existsSync(join(fromDir, "meta.json")), clip).toBe(true);
    }
  });
});

describe("fetchDeployClips", () => {
  it("deploys without the recordings when the release is not published (404), with a warning", async () => {
    const warnings: string[] = [];
    const { fn } = fakeFetch(404);
    const out = join(tmp, "recordings");
    await expect(fetchDeployClips(out, fn, (m) => warnings.push(m))).resolves.toBe(false);
    expect(existsSync(out) ? await readdir(out) : []).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/HTTP 404 .*the release is not published/);
  });

  it("still fails the deploy on a size mismatch: integrity failures are never skipped", async () => {
    const fn: typeof fetch = async () => new Response("x", { status: 200 });
    const out = join(tmp, "recordings");
    const result = fetchDeployClips(out, fn, () => {});
    await expect(result).rejects.toThrow(/expected/);
    await expect(result).rejects.not.toBeInstanceOf(MissingReleaseAssetError);
  });

  it("still fails the deploy on anything but a 404", async () => {
    const { fn } = fakeFetch(500);
    await expect(fetchDeployClips(join(tmp, "recordings"), fn, () => {})).rejects.toThrow(
      /HTTP 500/,
    );
  });
});

describe("copyClipGp", () => {
  it("writes the four GP files byte-identical", async () => {
    const out = join(tmp, "subaru-2026-10-11-iss.gp");
    await copyClipGp(GP_FIXTURE_DIR, out);
    expect((await readdir(out)).sort()).toEqual(GP_FILES);
    for (const name of GP_FILES) {
      const copied = await readFile(join(out, name));
      const original = await readFile(join(GP_FIXTURE_DIR, name));
      expect(copied.equals(original), name).toBe(true);
    }
  });

  it("throws, naming the file, when a group file does not match meta.json, and writes nothing", async () => {
    const from = join(tmp, "gp");
    await cp(GP_FIXTURE_DIR, from, { recursive: true });
    const visual = join(from, "visual.json");
    await writeFile(visual, `${await readFile(visual, "utf8")} `);
    const out = join(tmp, "out.gp");
    await expect(copyClipGp(from, out)).rejects.toThrow(
      new RegExp(
        `^${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/visual\\.json: sha256 [0-9a-f]{64}, meta\\.json says [0-9a-f]{64}$`,
      ),
    );
    expect(existsSync(out)).toBe(false);
  });
});
