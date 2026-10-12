// tests/unit/clip.test.ts — M5 section 5: ClipSidecar validation (step 10.1), clipVideoUrl and clipCamera; [M9]
// clipGpBaseUrl (M9 step 14f).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import {
  type ClipSidecar,
  clipCamera,
  clipGpBaseUrl,
  clipVideoUrl,
  parseClipSidecar,
} from "../../src/app/clip";
import type { CameraConfig, LocalVideoCamera } from "../../src/state/types";
import { M5_CAMERA_ENTRIES, withM5CameraEntries } from "../helpers/m5Cameras";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
/** The committed registry with M5 step 2's four entries in place (settled Subaru defaults, the two clip cameras). */
const registry: Readonly<Record<string, CameraConfig>> = parseCameraRegistry(
  withM5CameraEntries(committed),
);
const NOW = Date.parse("2026-10-11T16:00:00Z");

const e2eSidecar: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url), "utf8"),
);

/** The README's contract fields of recordings/subaru-2026-10-11-iss.json. */
const CONTRACT_2026_10_11 = {
  cameraId: "subaru-starcam",
  videoFile: "subaru-2026-10-11-iss.mp4",
  startUtcMs: 1791731310183,
  startUncertaintyS: 0.3,
  timingSource: {
    method: "burned-in-clock",
    detail:
      "Camera-PC clock burned in at lower right (HST = UTC-10). Frame 0 reads 05:08:30; the seconds digit increments at media frames 25 + 30k",
  },
  durationS: 480,
  width: 1920,
  height: 1080,
  fps: 30,
  sourceVideoId: "Kj5DjRYkzD8",
  credit: {
    text: "NAOJ & Asahi Shimbun",
    href: "https://www.youtube.com/watch?v=Kj5DjRYkzD8",
    licence: null,
    licenceHref: null,
  },
  calibration: {
    azDeg: 81.2322,
    altDeg: 19.6185,
    rollDeg: 0.7698,
    focalPx: 2525.93,
    cxPx: 1920,
    cyPx: 1080,
    k1: -0.00992,
    k2: 0,
    flipX: false,
    streamDelayMs: 0,
    rmsDeg: 0.0415,
    updatedAtMs: 1791733561911,
  },
  pass: {
    noradId: 25544,
    inFrameFromMediaS: 78.7,
    inFrameToMediaS: 290.43,
    visibleMediaS: [
      [78.7, 228],
      [238, 241.5],
      [256, 258.4],
      [260.8, 290.43],
    ],
  },
} as const satisfies ClipSidecar;

/**
 * The file on disk, read on 2026-10-11: the contract fields plus its provenance keys at every level (long strings
 * shortened). parseClipSidecar must accept it and drop the extra keys.
 */
const ON_DISK_2026_10_11 = {
  format: "overhead.clip",
  version: 1,
  startUtc: "2026-10-11T15:08:30.183Z",
  startSource: "burned-in-clock",
  cameraId: "subaru-starcam",
  site: null,
  lens: null,
  imageSize: null,
  calibration: CONTRACT_2026_10_11.calibration,
  credit: CONTRACT_2026_10_11.credit,
  termsNote:
    "Recorded from the Subaru StarCam YouTube live stream (DVR window) with yt-dlp and ffmpeg",
  videoFile: "subaru-2026-10-11-iss.mp4",
  startUtcIso: "2026-10-11T15:08:30.183Z",
  startUtcMs: 1791731310183,
  startUncertaintyS: 0.3,
  timingSource: {
    ...CONTRACT_2026_10_11.timingSource,
    clockReadingUncertaintyS: 0.017,
    hlsProgramDateTimeUtc: "2026-10-11T15:08:30.039Z",
    hlsMinusClockS: -0.144,
    issCrossCheck: {
      method: "Star-calibrated camera model applied to the per-frame ISS centroid track",
      offsetsS: {
        fixture: {
          ephemeris:
            "tests/fixtures/gp/stations.json, epoch 2026-10-09T22:48:38.797Z (40.3 h before)",
          offsetS: 0.879,
          residualRmsPxAtOffset: 0.95,
          residualRmsPxAtZero: 8.57,
          perSegmentOffsetsS: [0.894, 0.813, 0.946, 0.836],
        },
      },
    },
    note: "Adopted value: the burned-in clock.",
  },
  durationS: 480,
  frameCount: 14400,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "H.264 High (avc1.640028), yuv420p bt709, no audio, no B-frames, 5 s GOP",
  sourceVideoId: "Kj5DjRYkzD8",
  recordedWith: {
    recordedAtUtc: "2026-10-11T15:22:47Z",
    ytDlp: "yt-dlp 2026.08.19 (uvx)",
    ffmpeg: "ffmpeg 7.1 static arm64",
    commands: ["cat segs/887655.ts ... segs/887750.ts > subaru-2026-10-11-iss-dvr.ts"],
  },
  pass: {
    ...CONTRACT_2026_10_11.pass,
    inFrameFromUtc: "2026-10-11T15:09:48.883Z",
    inFrameToUtc: "2026-10-11T15:13:20.613Z",
    detail: "Enters at the right edge (az 124.0, alt 28.8) at media 78.7 s",
    maxAltDeg: 28.85,
    maxAltUtc: "2026-10-11T15:09:45.683Z",
  },
};

const BROKEN = {
  cameraId: "synthetic-maunakea",
  videoFile: "a/b.mp4",
  startUtcMs: "x",
  timingSource: { method: "guess" },
  durationS: 0,
  width: 1920,
  height: 1000,
  fps: 0,
  sourceVideoId: "abc",
  credit: {},
  calibration: 3,
  pass: { noradId: 0 },
};

const MESSAGES = {
  object: "sidecar must be a JSON object",
  cameraId: "cameraId must name a youtube or still-image camera in cameras.json",
  videoFile: "videoFile must be a file name with no / or \\",
  startFinite: "startUtcMs must be a finite number",
  startRange: "startUtcMs is out of range",
  uncertainty: "startUncertaintyS must be a finite number ≥ 0",
  timing: "timingSource needs a known method and a detail string",
  duration: "durationS must be > 0 and ≤ 43200",
  size: "width and height must be positive integers",
  aspect: "width:height differs from the camera's W:H by more than 0.5 %",
  fps: "fps must be a finite number > 0",
  sourceVideoId: "sourceVideoId must be null or an 11-character YouTube id",
  credit: "credit needs non-empty text, and href, licence and licenceHref as strings or null",
  calibration: "calibration must be a full Calibration for the camera's lens",
  pass: "pass needs a positive integer noradId and in-frame media times within the clip",
} as const;

/** The errors for a copy of the e2e sidecar with some fields replaced (undefined deletes the key). */
function errorsFor(patch: Record<string, unknown>, nowMs = NOW): string[] {
  const json: Record<string, unknown> = { ...(e2eSidecar as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete json[key];
    else json[key] = value;
  }
  const result = parseClipSidecar(json, registry, nowMs);
  return result.ok ? [] : result.errors;
}

describe("the M5 registry used here", () => {
  it("holds the four M5 entries in picker order after cfht-starcam", () => {
    const ids = Object.keys(registry);
    const at = ids.indexOf("cfht-starcam");
    expect(ids.slice(at - 1, at + 3)).toEqual([
      "subaru-starcam",
      "cfht-starcam",
      "local-replay",
      "subaru-2026-10-11-iss",
    ]);
    expect(registry["subaru-starcam"]?.defaults.focalPx).toBe(2525.93);
    expect(M5_CAMERA_ENTRIES).toHaveLength(4);
  });
});

describe("parseClipSidecar", () => {
  it("accepts the 2026-10-11 sidecar as it is on disk and returns only the contract fields", () => {
    const result = parseClipSidecar(ON_DISK_2026_10_11, registry, NOW);
    expect(result).toEqual({ ok: true, sidecar: CONTRACT_2026_10_11 });
  });

  it("accepts the e2e sidecar fixture", () => {
    const result = parseClipSidecar(e2eSidecar, registry, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sidecar).toEqual(e2eSidecar);
    expect(result.sidecar.startUtcMs).toBe(Date.parse("2026-10-11T08:00:00.000Z"));
    expect("calibration" in result.sidecar).toBe(false);
    expect("pass" in result.sidecar).toBe(false);
  });

  it("lists exactly the 11 problems of the broken object, in field order", () => {
    expect(parseClipSidecar(BROKEN, registry, NOW)).toEqual({
      ok: false,
      errors: [
        MESSAGES.cameraId,
        MESSAGES.videoFile,
        MESSAGES.startFinite,
        MESSAGES.uncertainty,
        MESSAGES.timing,
        MESSAGES.duration,
        MESSAGES.fps,
        MESSAGES.sourceVideoId,
        MESSAGES.credit,
        MESSAGES.calibration,
        MESSAGES.pass,
      ],
    });
    // One backslash at the end of the videoFile message.
    expect(MESSAGES.videoFile.endsWith("/ or \\")).toBe(true);
    expect(MESSAGES.videoFile.length).toBe(
      "videoFile must be a file name with no / or ".length + 1,
    );
  });

  it("checks width:height against the camera only when the camera is valid", () => {
    expect(errorsFor({ height: 200 })).toEqual([MESSAGES.aspect]);
    expect(errorsFor({ width: 1920, height: 1080 })).toEqual([]);
    expect(errorsFor({ width: 1920, height: 1081 })).toEqual([]); // 0.09 % off
    expect(errorsFor({ width: 1920, height: 1090 })).toEqual([MESSAGES.aspect]); // 0.92 % off
    expect(errorsFor({ cameraId: "nope", height: 200 })).toEqual([MESSAGES.cameraId]);
    expect(errorsFor({ width: 320.5 })).toEqual([MESSAGES.size]);
    expect(errorsFor({ height: 0 })).toEqual([MESSAGES.size]);
    expect(errorsFor({ height: undefined })).toEqual([MESSAGES.size]);
  });

  it("bounds startUtcMs to [2000-01-01, now + 1 day]", () => {
    const now = Date.parse("2026-10-11T10:00:00Z");
    expect(errorsFor({ startUtcMs: Date.parse("2026-10-13T00:00:00Z") }, now)).toEqual([
      MESSAGES.startRange,
    ]);
    expect(errorsFor({ startUtcMs: now + 86_400_000 }, now)).toEqual([]);
    expect(errorsFor({ startUtcMs: now + 86_400_001 }, now)).toEqual([MESSAGES.startRange]);
    expect(errorsFor({ startUtcMs: Date.parse("2000-01-01T00:00:00Z") })).toEqual([]);
    expect(errorsFor({ startUtcMs: Date.parse("1999-12-31T23:59:59.999Z") })).toEqual([
      MESSAGES.startRange,
    ]);
    expect(errorsFor({ startUtcMs: Number.NaN })).toEqual([MESSAGES.startFinite]);
    expect(errorsFor({ startUtcMs: "1791705600000" })).toEqual([MESSAGES.startFinite]);
  });

  it("needs a youtube or still-image camera that is the registry's own key", () => {
    expect(errorsFor({ cameraId: "local-replay" })).toEqual([MESSAGES.cameraId]);
    expect(errorsFor({ cameraId: "synthetic-maunakea" })).toEqual([MESSAGES.cameraId]);
    expect(errorsFor({ cameraId: "cfht-starcam" })).toEqual([]);
    // A still-image camera may be the source too; Nānā ao is square, so a 16:9 clip does not fit it.
    expect(errorsFor({ cameraId: "cfht-nanaao", width: 1232, height: 1232 })).toEqual([]);
    expect(errorsFor({ cameraId: "cfht-nanaao" })).toEqual([MESSAGES.aspect]);
    for (const key of ["constructor", "toString", "__proto__", "", 42, null]) {
      expect(errorsFor({ cameraId: key })).toEqual([MESSAGES.cameraId]);
    }
  });

  it("rejects anything that is not a plain object with exactly one message", () => {
    for (const json of ["x", [], null, 3, true, undefined]) {
      expect(parseClipSidecar(json, registry, NOW)).toEqual({
        ok: false,
        errors: [MESSAGES.object],
      });
    }
  });

  it("checks each remaining field on its own", () => {
    expect(errorsFor({ videoFile: "" })).toEqual([MESSAGES.videoFile]);
    expect(errorsFor({ videoFile: "a\\b.webm" })).toEqual([MESSAGES.videoFile]);
    expect(errorsFor({ videoFile: ".." })).toEqual([MESSAGES.videoFile]);
    expect(errorsFor({ videoFile: 7 })).toEqual([MESSAGES.videoFile]);
    expect(errorsFor({ startUncertaintyS: -0.1 })).toEqual([MESSAGES.uncertainty]);
    expect(errorsFor({ startUncertaintyS: Number.POSITIVE_INFINITY })).toEqual([
      MESSAGES.uncertainty,
    ]);
    expect(errorsFor({ timingSource: { method: "satellite", detail: 3 } })).toEqual([
      MESSAGES.timing,
    ]);
    expect(errorsFor({ timingSource: "manual" })).toEqual([MESSAGES.timing]);
    for (const method of ["hls-program-date-time", "burned-in-clock", "satellite", "manual"]) {
      expect(errorsFor({ timingSource: { method, detail: "", extra: 1 } })).toEqual([]);
    }
    expect(errorsFor({ durationS: 43_200 })).toEqual([]);
    expect(errorsFor({ durationS: 43_200.001 })).toEqual([MESSAGES.duration]);
    expect(errorsFor({ durationS: -7 })).toEqual([MESSAGES.duration]);
    expect(errorsFor({ fps: Number.POSITIVE_INFINITY })).toEqual([MESSAGES.fps]);
    expect(errorsFor({ fps: 29.97 })).toEqual([]);
    expect(errorsFor({ sourceVideoId: "Kj5DjRYkzD8" })).toEqual([]);
    expect(errorsFor({ sourceVideoId: "Kj5DjRYkzD8X" })).toEqual([MESSAGES.sourceVideoId]);
    expect(errorsFor({ sourceVideoId: undefined })).toEqual([MESSAGES.sourceVideoId]);
    expect(errorsFor({ credit: { text: "x", href: null, licence: null } })).toEqual([
      MESSAGES.credit,
    ]);
    expect(
      errorsFor({ credit: { text: "", href: null, licence: null, licenceHref: null } }),
    ).toEqual([MESSAGES.credit]);
  });

  it("needs a calibration with all 12 typed fields that passes distortionValid for the lens", () => {
    const good = CONTRACT_2026_10_11.calibration;
    expect(errorsFor({ calibration: good })).toEqual([]);
    const { rmsDeg: _drop, ...missing } = good;
    expect(errorsFor({ calibration: missing })).toEqual([MESSAGES.calibration]);
    expect(errorsFor({ calibration: { ...good, rmsDeg: null } })).toEqual([]);
    expect(errorsFor({ calibration: { ...good, flipX: 0 } })).toEqual([MESSAGES.calibration]);
    expect(errorsFor({ calibration: { ...good, focalPx: Number.NaN } })).toEqual([
      MESSAGES.calibration,
    ]);
    // A negative focal length would put every corner at radius 0 and pass distortionValid on its own.
    expect(errorsFor({ calibration: { ...good, focalPx: -2525.93 } })).toEqual([
      MESSAGES.calibration,
    ]);
    expect(errorsFor({ calibration: { ...good, focalPx: 0 } })).toEqual([MESSAGES.calibration]);
    // g′ = 1 + 3 k1 r² at the corner radius 0.879 (f 2525.93): k1 −0.5 folds the frame.
    expect(errorsFor({ calibration: { ...good, k1: -0.5 } })).toEqual([MESSAGES.calibration]);
    // A bad calibration is reported even when the camera is unknown; a good one cannot be checked then.
    expect(errorsFor({ cameraId: "nope", calibration: good })).toEqual([MESSAGES.cameraId]);
    expect(errorsFor({ cameraId: "nope", calibration: missing })).toEqual([
      MESSAGES.cameraId,
      MESSAGES.calibration,
    ]);
  });

  it("needs a pass inside the clip, with ordered visible stretches when given", () => {
    const pass = { noradId: 25544, inFrameFromMediaS: 1, inFrameToMediaS: 6.5 };
    expect(errorsFor({ pass })).toEqual([]);
    expect(errorsFor({ pass: { ...pass, inFrameFromMediaS: 0, inFrameToMediaS: 7 } })).toEqual([]);
    expect(errorsFor({ pass: { ...pass, inFrameToMediaS: 7.01 } })).toEqual([MESSAGES.pass]);
    expect(errorsFor({ pass: { ...pass, inFrameFromMediaS: -1 } })).toEqual([MESSAGES.pass]);
    expect(errorsFor({ pass: { ...pass, inFrameFromMediaS: 6.6 } })).toEqual([MESSAGES.pass]);
    expect(errorsFor({ pass: { ...pass, noradId: 25544.5 } })).toEqual([MESSAGES.pass]);
    expect(
      errorsFor({
        pass: {
          ...pass,
          visibleMediaS: [
            [1, 2],
            [3, 6.5],
          ],
        },
      }),
    ).toEqual([]);
    expect(errorsFor({ pass: { ...pass, visibleMediaS: [] } })).toEqual([]);
    for (const visibleMediaS of [
      [[2, 1]],
      [
        [1, 3],
        [2, 4],
      ],
      [[1, 8]],
      [[1]],
      "1-2",
      [[1, "2"]],
    ]) {
      expect(errorsFor({ pass: { ...pass, visibleMediaS } })).toEqual([MESSAGES.pass]);
    }
    // With a broken duration only the duration is reported, not the pass against it.
    expect(errorsFor({ durationS: 0, pass })).toEqual([MESSAGES.duration]);
  });
});

describe("clipVideoUrl", () => {
  const sidecar = CONTRACT_2026_10_11;

  it("resolves videoFile next to the sidecar", () => {
    expect(
      clipVideoUrl("http://localhost:4173/Overhead/recordings/subaru-2026-10-11-iss.json", sidecar),
    ).toBe("http://localhost:4173/Overhead/recordings/subaru-2026-10-11-iss.mp4");
  });

  it("keeps any file name a file in that folder", () => {
    const base = "https://parthjain.ca/Overhead/recordings/x.json?v=1#top";
    const at = (videoFile: string): string => clipVideoUrl(base, { ...sidecar, videoFile });
    expect(at("a b.mp4")).toBe("https://parthjain.ca/Overhead/recordings/a%20b.mp4");
    expect(at("clip#1?.mp4")).toBe("https://parthjain.ca/Overhead/recordings/clip%231%3F.mp4");
    expect(at("http:evil.example")).toBe(
      "https://parthjain.ca/Overhead/recordings/http%3Aevil.example",
    );
  });
});

// [M9] Step 14f: the clip's own element sets sit next to its sidecar.
describe("clipGpBaseUrl", () => {
  it("turns the sidecar URL into its <clip>.gp/ directory", () => {
    expect(
      clipGpBaseUrl("https://parthjain.ca/Overhead/recordings/subaru-2026-10-11-iss.json"),
    ).toBe("https://parthjain.ca/Overhead/recordings/subaru-2026-10-11-iss.gp/");
  });

  it("drops a query and a hash on the sidecar URL", () => {
    expect(
      clipGpBaseUrl("https://parthjain.ca/Overhead/recordings/subaru-2026-10-11-iss.json?v=1#x"),
    ).toBe("https://parthjain.ca/Overhead/recordings/subaru-2026-10-11-iss.gp/");
  });
});

describe("clipCamera", () => {
  const entry = registry["subaru-2026-10-11-iss"] as LocalVideoCamera;
  const replay = registry["local-replay"] as LocalVideoCamera;
  const subaru = registry["subaru-starcam"];
  const videoUrl = "http://localhost:4173/Overhead/recordings/subaru-2026-10-11-iss.mp4";

  it("runs the clip as its source camera, with the entry's name and the sidecar's credit and calibration", () => {
    const before = structuredClone(entry);
    const camera = clipCamera(entry, CONTRACT_2026_10_11, videoUrl, registry);
    expect(camera).toEqual({
      id: "subaru-2026-10-11-iss",
      name: "Subaru StarCam: ISS pass, 2026-10-11 (recorded)",
      kind: "local-video",
      source: {
        sidecarUrl: "recordings/subaru-2026-10-11-iss.json",
        sourceCameraId: "subaru-starcam",
        videoUrl,
        startUtcMs: 1791731310183,
      },
      site: subaru?.site,
      imageSize: subaru?.imageSize,
      lens: subaru?.lens,
      defaults: { ...CONTRACT_2026_10_11.calibration, streamDelayMs: 0 },
      credit: CONTRACT_2026_10_11.credit,
      termsNote: subaru?.termsNote,
    });
    expect(camera?.defaults.focalPx).toBe(2525.93);
    expect(camera?.credit.text).toBe("NAOJ & Asahi Shimbun");
    expect(entry).toEqual(before); // the registry entry is not touched
  });

  it("is null for a sidecar of another camera than the entry's source, or an unknown camera", () => {
    const cfhtEntry: LocalVideoCamera = {
      ...entry,
      source: { ...entry.source, sourceCameraId: "cfht-starcam" },
    };
    expect(clipCamera(cfhtEntry, CONTRACT_2026_10_11, videoUrl, registry)).toBeNull();
    expect(
      clipCamera(entry, { ...CONTRACT_2026_10_11, cameraId: "nope" }, videoUrl, registry),
    ).toBeNull();
    expect(
      clipCamera(replay, { ...CONTRACT_2026_10_11, cameraId: "constructor" }, videoUrl, registry),
    ).toBeNull();
  });

  it("starts from the source camera's defaults with no delay when the sidecar has no calibration", () => {
    const sidecar = parseClipSidecar(e2eSidecar, registry, NOW);
    if (!sidecar.ok) throw new Error(sidecar.errors.join("; "));
    const camera = clipCamera(replay, sidecar.sidecar, "blob:http://localhost/1", registry);
    expect(camera?.defaults).toEqual({ ...subaru?.defaults, streamDelayMs: 0 });
    expect(subaru?.defaults.streamDelayMs).toBe(50_000); // the YouTube camera keeps its own
    expect(camera?.source).toEqual({
      sidecarUrl: null,
      sourceCameraId: "subaru-starcam",
      videoUrl: "blob:http://localhost/1",
      startUtcMs: 1791705600000,
    });
    expect(camera?.name).toBe("Local clip (replay)");
    expect(camera?.credit.licence).toBe("CC0-1.0");
  });
});
