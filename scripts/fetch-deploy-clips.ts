// scripts/fetch-deploy-clips.ts — [M9] run by `npm run build:pages` in deploy.yml only, never in CI (M9 steps 14c, 14f).
// Copies each deploy clip file from its release asset into dist/recordings/, and each clip's element sets from the
// repository into dist/recordings/<clip>.gp/, checking size and sha256. Recordings never enter git (O2): the deploy
// copy is a release asset of the public repository, downloaded without credentials (H1).
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Ceiling for one deploy copy: 25 MiB, a sixth of the 148.6 MB master per full play (M9 step 14, "Size"). */
export const DEPLOY_CLIP_MAX_BYTES = 26_214_400;

export interface DeployClipFile {
  readonly name: string; // written to dist/recordings/<name>, the path cameras.json's sidecarUrl names
  readonly url: string; // public, no credentials; redirects are followed
  readonly bytes: number;
  readonly sha256: string; // lowercase hex
}

const RELEASE = "https://github.com/FalconXYX/Overhead/releases/download/clips-2026-10-11";

/**
 * The files of the release clips-2026-10-11, measured on the copies in recordings/web/ that M9 step 14a made on
 * 2026-10-11 (ffmpeg 7.1 static arm64). Take bytes and sha256 from the files actually uploaded (M9 gotcha 22), and
 * recompute the sidecar's whenever the sidecar changes.
 */
export const DEPLOY_CLIP_FILES: readonly DeployClipFile[] = [
  {
    name: "subaru-2026-10-11-iss.mp4",
    url: `${RELEASE}/subaru-2026-10-11-iss.mp4`,
    bytes: 23_515_809,
    sha256: "5c0ac96b3e9bbb749a8b70fa3ccea911670046bbcdaa55e05ab147134c6d100c",
  },
  {
    name: "subaru-2026-10-11-iss.json",
    url: `${RELEASE}/subaru-2026-10-11-iss.json`,
    bytes: 6_846,
    sha256: "9c0cc7bf4be47012781fd54590eda1f646275a6c5f9305b62320cceca61d3eeb",
  },
];

/** Each clip's element sets (M9 step 14f): a committed GP directory, copied to dist/recordings/<clip>.gp/. */
export const DEPLOY_CLIP_GP: readonly { readonly clip: string; readonly fromDir: string }[] = [
  { clip: "subaru-2026-10-11-iss", fromDir: "tests/fixtures/gp" },
];

const GP_GROUPS = ["stations", "visual", "starlink"] as const;

const sha256Hex = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** The release asset is not there (HTTP 404): the release has not been published yet. */
export class MissingReleaseAssetError extends Error {}

/**
 * Throws, naming the file, on any failure, and writes nothing. A 404 throws MissingReleaseAssetError, which main
 * treats as "this clip is not part of this build"; any other failure (a size or sha256 mismatch) fails the deploy.
 */
export async function fetchDeployClip(
  file: DeployClipFile,
  outDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (file.bytes > DEPLOY_CLIP_MAX_BYTES) {
    throw new Error(`${file.name}: ${file.bytes} bytes is over the 25 MiB deploy-copy ceiling`);
  }
  const res = await fetchFn(file.url, { redirect: "follow" });
  if (res.status !== 200) {
    await res.body?.cancel();
    const message = `${file.name}: HTTP ${res.status} from ${file.url}`;
    throw res.status === 404 ? new MissingReleaseAssetError(message) : new Error(message);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength !== file.bytes) {
    throw new Error(`${file.name}: got ${data.byteLength} bytes, expected ${file.bytes}`);
  }
  const sha256 = sha256Hex(data);
  if (sha256 !== file.sha256) {
    throw new Error(`${file.name}: sha256 ${sha256}, expected ${file.sha256}`);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/${file.name}`, data);
  console.log(`${file.name}: ${data.byteLength} bytes, sha256 ok`);
}

/**
 * Copies stations, visual, starlink and meta.json; each group file must match meta.json's sha256 for it. Every file
 * is checked before the first one is written, so a mismatch throws (naming the file) and writes nothing.
 */
export async function copyClipGp(fromDir: string, toDir: string): Promise<void> {
  const metaText = await readFile(`${fromDir}/meta.json`, "utf8");
  const meta: Partial<Record<string, { sha256?: unknown }>> = JSON.parse(metaText);
  const files: { readonly group: string; readonly data: Uint8Array }[] = [];
  for (const group of GP_GROUPS) {
    const data = await readFile(`${fromDir}/${group}.json`);
    const sha256 = sha256Hex(data);
    const expected = meta[group]?.sha256;
    if (sha256 !== expected) {
      throw new Error(
        `${fromDir}/${group}.json: sha256 ${sha256}, meta.json says ${String(expected)}`,
      );
    }
    files.push({ group, data });
  }
  await mkdir(toDir, { recursive: true });
  for (const { group, data } of files) await writeFile(`${toDir}/${group}.json`, data);
  await writeFile(`${toDir}/meta.json`, metaText);
  console.log(`${toDir}: ${GP_GROUPS.join(", ")} and meta.json, sha256 ok`);
}

/**
 * Fetches every deploy clip file, then copies the element sets. A release that is not published yet (any 404) leaves
 * the recordings out of this build with a warning, so the site still deploys and offers the live cameras; the app
 * already says "not part of this build" for a sidecar it cannot load. Returns whether the clips were included.
 */
export async function fetchDeployClips(
  outDir: string,
  fetchFn: typeof fetch = fetch,
  warn: (message: string) => void = (m) => console.log(`::warning::${m}`),
): Promise<boolean> {
  const fetched: DeployClipFile[] = [];
  for (const file of DEPLOY_CLIP_FILES) {
    try {
      await fetchDeployClip(file, outDir, fetchFn);
      fetched.push(file);
    } catch (error) {
      if (!(error instanceof MissingReleaseAssetError)) throw error;
      warn(`${error.message}: the release is not published, so this build has no recorded clip`);
      // A sidecar without its video (or the reverse) is worse than neither.
      for (const done of fetched) await rm(`${outDir}/${done.name}`, { force: true });
      return false;
    }
  }
  for (const { clip, fromDir } of DEPLOY_CLIP_GP) await copyClipGp(fromDir, `${outDir}/${clip}.gp`);
  return true;
}

async function main(): Promise<void> {
  await fetchDeployClips("dist/recordings");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
