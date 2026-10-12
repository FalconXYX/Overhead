// tests/unit/recordClip.test.ts — M5 section 5: scripts/record-clip.ts's pure parts. The trimmed real DVR playlist
// (tests/fixtures/hls/dvr-playlist.m3u8, segments 887655–887658 with every URL replaced), inline playlists, the
// subaru-starcam entry, and a fake fetch for the downloads. No yt-dlp, no ffmpeg, no network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildClipSidecar,
  downloadSegments,
  type HlsSegment,
  parseFfmpegProbe,
  parseMediaPlaylist,
  parseRecordClipArgs,
  passInMedia,
  segmentLog,
  selectSegments,
} from "../../scripts/record-clip";
import { parseCameraRegistry } from "../../src/app/cameras";
import { parseClipSidecar } from "../../src/app/clip";
import type { CameraConfig, YoutubeCamera } from "../../src/state/types";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const FIXTURE = readFileSync(new URL("../fixtures/hls/dvr-playlist.m3u8", import.meta.url), "utf8");
const registry: Record<string, CameraConfig> = parseCameraRegistry(
  withM5CameraEntries(
    JSON.parse(readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8")),
  ),
);
const SUBARU = registry["subaru-starcam"] as YoutubeCamera;
const at = (iso: string): number => Date.parse(iso);
const HEAD = at("2026-10-11T15:08:30.039Z");

/** A playlist with the real head and `body` after it. */
const playlist = (
  body: string,
  head = "#EXT-X-PROGRAM-DATE-TIME:2026-10-11T15:08:30.039+00:00",
): string =>
  `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:887655\n#EXT-X-DISCONTINUITY-SEQUENCE:132\n${head}\n${body}`;
const seg = (sq: number): string => `#EXTINF:5.0,\nhttps://example.invalid/sq/${sq}/seg.ts\n`;

describe("parseMediaPlaylist", () => {
  it("the fixture: 4 segments of 5.0 s from sq 887655 at 15:08:30.039Z; DISCONTINUITY-SEQUENCE does not throw", () => {
    const parsed = parseMediaPlaylist(FIXTURE);
    expect(parsed.mediaSequence).toBe(887655);
    expect(parsed.segments.map((s) => s.sq)).toEqual([887655, 887656, 887657, 887658]);
    expect(parsed.segments.map((s) => s.programDateTimeMs - HEAD)).toEqual([
      0, 5_000, 10_000, 15_000,
    ]);
    expect(parsed.segments.every((s) => s.durationS === 5)).toBe(true);
    expect(parsed.segments[0]?.url).toBe("https://example.invalid/sq/887655/seg.ts");
  });

  it("ignores the ad-marker pair in its real form: 2 segments, 5 s apart", () => {
    const text = playlist(
      `${seg(887655)}#EXT-X-DATERANGE:ID="ad-1",CLASS="CUEPOINT-AD",START-DATE="2026-10-11T15:08:35.039+00:00",DURATION=0.0\n` +
        `#EXT-X-CUEPOINT:DURATION=0,TYPE=AD\n${seg(887656)}`,
    );
    const parsed = parseMediaPlaylist(text);
    expect(parsed.segments.map((s) => s.sq)).toEqual([887655, 887656]);
    expect(
      (parsed.segments[1]?.programDateTimeMs ?? 0) - (parsed.segments[0]?.programDateTimeMs ?? 0),
    ).toBe(5_000);
  });

  it("throws without a head PROGRAM-DATE-TIME, after an #EXT-X-DISCONTINUITY and on a /sq/ that does not match", () => {
    expect(() => parseMediaPlaylist(playlist(seg(887655), "#EXT-X-INDEPENDENT-SEGMENTS"))).toThrow(
      /PROGRAM-DATE-TIME/,
    );
    expect(() =>
      parseMediaPlaylist(playlist(`${seg(887655)}#EXT-X-DISCONTINUITY\n${seg(887656)}`)),
    ).toThrow("Segment 887656 follows an #EXT-X-DISCONTINUITY");
    expect(() => parseMediaPlaylist(playlist(seg(887660)))).toThrow(
      "Segment 0 names /sq/887660/, not 887655 (MEDIA-SEQUENCE + index)",
    );
  });

  it("never quotes a URL in an error", () => {
    const secret = "https://rr1---sn.googlevideo.com/videoplayback/ip/203.0.113.7/sq/887999/seg.ts";
    try {
      parseMediaPlaylist(playlist(`#EXTINF:5.0,\n${secret}\n`));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("googlevideo");
      expect((error as Error).message).not.toContain("203.0.113.7");
    }
  });
});

describe("selectSegments", () => {
  const parsed = parseMediaPlaylist(FIXTURE);

  it("[15:08:31Z, 15:08:41Z) → 887655–887657", () => {
    const sqs = selectSegments(parsed, at("2026-10-11T15:08:31Z"), at("2026-10-11T15:08:41Z")).map(
      (s) => s.sq,
    );
    expect(sqs).toEqual([887655, 887656, 887657]);
  });

  it("the whole playlist, and a window ending on a segment boundary takes no extra segment", () => {
    expect(selectSegments(parsed, HEAD, HEAD + 20_000)).toHaveLength(4);
    expect(selectSegments(parsed, HEAD, HEAD + 10_000).map((s) => s.sq)).toEqual([887655, 887656]);
  });

  it("throws unless the window lies inside the playlist", () => {
    expect(() =>
      selectSegments(parsed, at("2026-10-11T15:08:20Z"), at("2026-10-11T15:08:41Z")),
    ).toThrow(/outside the playlist/);
    expect(() => selectSegments(parsed, HEAD, HEAD + 20_001)).toThrow(/outside the playlist/);
    expect(() => selectSegments(parsed, HEAD + 5_000, HEAD + 5_000)).toThrow("The window is empty");
  });
});

describe("parseRecordClipArgs", () => {
  const base = [
    ...["--cam", "subaru-starcam", "--from", "2026-10-11T15:08:30.039Z"],
    ...["--to", "2026-10-11T15:16:30.039Z", "--name", "subaru-2026-10-11-iss"],
  ];

  it("defaults: yt-dlp through uvx, ffmpeg on the PATH, no satellite", () => {
    expect(parseRecordClipArgs(base)).toEqual({
      cameraId: "subaru-starcam",
      fromMs: 1_791_731_310_039,
      toMs: 1_791_731_790_039,
      name: "subaru-2026-10-11-iss",
      noradId: null,
      ytDlp: ["uvx", "yt-dlp"],
      ffmpeg: "ffmpeg",
    });
  });

  it("reads --norad, --yt-dlp (split on spaces) and --ffmpeg", () => {
    const options = parseRecordClipArgs([
      ...base,
      ...[
        "--norad",
        "25544",
        "--yt-dlp",
        "uvx --from yt-dlp==2026.08.19 yt-dlp",
        "--ffmpeg",
        "/opt/ffmpeg",
      ],
    ]);
    expect(options.noradId).toBe(25544);
    expect(options.ytDlp).toEqual(["uvx", "--from", "yt-dlp==2026.08.19", "yt-dlp"]);
    expect(options.ffmpeg).toBe("/opt/ffmpeg");
  });

  it("throws on --to before --from, a 3,601 s window, a bad --name, a time without Z or a missing flag", () => {
    const withFlag = (flag: string, value: string): string[] => {
      const argv = [...base];
      argv[argv.indexOf(flag) + 1] = value;
      return argv;
    };
    const bad = [
      withFlag("--to", "2026-10-11T15:08:00Z"),
      withFlag("--to", "2026-10-11T16:08:31.039Z"), // 3,601 s
      withFlag("--name", "Bad_Name"),
      withFlag("--from", "2026-10-11T15:08:30"),
      base.slice(0, -2),
      [...base, "--norad", "x"],
    ];
    for (const argv of bad) expect(() => parseRecordClipArgs(argv)).toThrow(/^usage: /);
    expect(() => parseRecordClipArgs(withFlag("--to", "2026-10-11T16:08:30.039Z"))).not.toThrow(); // 3,600 s
  });
});

describe("buildClipSidecar", () => {
  const segments = selectSegments(parseMediaPlaylist(FIXTURE), HEAD, HEAD + 15_000);
  const sidecar = buildClipSidecar({
    camera: SUBARU,
    videoId: "Kj5DjRYkzD8",
    segments,
    probe: { width: 1920, height: 1080, fps: 30, durationS: 15 },
    videoFile: "test-clip.mp4",
    pass: null,
  });

  it("is timed by the first segment's PROGRAM-DATE-TIME, with the stream's credit", () => {
    expect(sidecar).toEqual({
      cameraId: "subaru-starcam",
      videoFile: "test-clip.mp4",
      startUtcMs: 1_791_731_310_039,
      startUncertaintyS: 0.2,
      timingSource: {
        method: "hls-program-date-time",
        detail: "first segment sq 887655, PROGRAM-DATE-TIME 2026-10-11T15:08:30.039Z",
      },
      durationS: 15,
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
    });
  });

  it("passes parseClipSidecar, with and without a pass", () => {
    expect(parseClipSidecar(sidecar, registry, at("2026-10-11T16:00:00Z"))).toEqual({
      ok: true,
      sidecar,
    });
    const pass = passInMedia(25544, { enterMs: HEAD + 4_000, exitMs: HEAD + 99_000 }, HEAD, 15);
    expect(pass).toEqual({ noradId: 25544, inFrameFromMediaS: 4, inFrameToMediaS: 15 });
    const withPass = buildClipSidecar({
      camera: SUBARU,
      videoId: "Kj5DjRYkzD8",
      segments,
      probe: { width: 1920, height: 1080, fps: 30, durationS: 15 },
      videoFile: "test-clip.mp4",
      pass,
    });
    expect(parseClipSidecar(withPass, registry, at("2026-10-11T16:00:00Z")).ok).toBe(true);
  });

  it("needs a segment", () => {
    expect(() =>
      buildClipSidecar({
        camera: SUBARU,
        videoId: "Kj5DjRYkzD8",
        segments: [],
        probe: { width: 1920, height: 1080, fps: 30, durationS: 0 },
        videoFile: "x.mp4",
        pass: null,
      }),
    ).toThrow();
  });
});

describe("parseFfmpegProbe", () => {
  it("reads ffmpeg 7.1's report of the 2026-10-11 clip", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'recordings/subaru-2026-10-11-iss.mp4':",
      "  Duration: 00:08:00.00, start: 0.000000, bitrate: 2477 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 2476 kb/s, 30 fps, 30 tbr, 90k tbn (default)",
      "At least one output file must be specified",
    ].join("\n");
    expect(parseFfmpegProbe(stderr)).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
      durationS: 480,
    });
    expect(() => parseFfmpegProbe("no input")).toThrow("ffmpeg -i did not report a video");
  });
});

describe("downloadSegments and segmentLog", () => {
  const segments: HlsSegment[] = parseMediaPlaylist(FIXTURE).segments.slice();

  it("keeps segment order, retries up to 3 times, and logs no URL", async () => {
    const attempts = new Map<string, number>();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, url.includes("887655") ? 5 : 0));
      inFlight -= 1;
      if (url.includes("887656") && n < 3) return new Response("", { status: 503 });
      const sq = Number(/\/sq\/(\d+)\//.exec(url)?.[1]);
      return new Response(new Uint8Array([sq % 256, 1, 2].slice(0, 1 + (sq % 3))));
    }) as typeof fetch;
    const bytes = await downloadSegments(segments, fetchFn, 2);
    expect(bytes.map((b) => b[0])).toEqual(segments.map((s) => s.sq % 256));
    expect(attempts.get("https://example.invalid/sq/887656/seg.ts")).toBe(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    const log = segmentLog(segments, bytes);
    expect(log[0]).toEqual({
      sq: 887655,
      programDateTime: "2026-10-11T15:08:30.039Z",
      durationS: 5,
      bytes: 1 + (887655 % 3),
    });
    expect(JSON.stringify(log)).not.toContain("example.invalid");
  });

  it("fails after 3 tries with the sq and the status only", async () => {
    const fetchFn = (async () => new Response("", { status: 403 })) as typeof fetch;
    await expect(downloadSegments(segments.slice(0, 1), fetchFn)).rejects.toThrow(
      "Segment 887655 failed 3 times (HTTP 403)",
    );
  });
});
