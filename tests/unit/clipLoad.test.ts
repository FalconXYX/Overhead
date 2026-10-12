// tests/unit/clipLoad.test.ts — M5 step 10.4–10.10: loading a clip from its sidecar URL (with DECISIONS H1's Range
// probe) and from picked files, the probe checks, "Copy pointing", "Save sidecar", the clip rates, the hidden
// stretches of step 13 and the ?t= rule. A fake fetch, a fake probe and fake object URLs: no DOM, no network.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCameraRegistry } from "../../src/app/cameras";
import {
  CLIP_RATES,
  CLIP_TEXT,
  type ClipLoadOptions,
  type ClipSidecar,
  cannotPlayText,
  checkVideoProbe,
  claimUrlTime,
  clipHiddenMs,
  copyClipPointing,
  formatClipDuration,
  getClipLoadState,
  loadClip,
  loadClipFromSidecarUrl,
  offeredRates,
  parseClipSidecar,
  sidecarFileName,
  sidecarToSave,
  subscribeClipLoads,
  type VideoProbe,
} from "../../src/app/clip";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig, LocalVideoCamera } from "../../src/state/types";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
const registry: Readonly<Record<string, CameraConfig>> = parseCameraRegistry(
  withM5CameraEntries(committed),
);
const E2E_TEXT = readFileSync(
  new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url),
  "utf8",
);
const E2E: Record<string, unknown> = JSON.parse(E2E_TEXT);
const T = Date.parse("2026-10-11T16:00:00Z");
const START = 1_791_705_600_000; // the e2e sidecar's startUtcMs, 2026-10-11T08:00:00Z
const BASE = "http://localhost:4173/Overhead/";
const CLIP_ID = "subaru-2026-10-11-iss";
const SIDECAR_URL = `${BASE}recordings/subaru-2026-10-11-iss.json`;
const VIDEO_URL = `${BASE}recordings/test-pattern.webm`;
const PROBE: VideoProbe = { durationS: 7, widthPx: 320, heightPx: 180 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T);
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(activeId = CLIP_ID): AppStore {
  const store = createAppStore(initialState(T, DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry({ ...registry });
  store.getState().actions.setActiveCamera(activeId);
  return store;
}

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}
type Answer = Response | (() => Response) | Error;

/** A fetch answering by URL; records every call. */
function fakeFetch(answers: Record<string, Answer>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const answer = answers[url];
    if (answer === undefined) throw new TypeError(`unexpected fetch ${url}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, type = "application/json"): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": type } });
const html = (): Response =>
  new Response("<!doctype html><title>Overhead</title>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
const partial = (): Response =>
  new Response("\x1aE", { status: 206, headers: { "content-type": "video/webm" } });
const whole = (): Response =>
  new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), {
    status: 200,
    headers: { "content-type": "video/webm" },
  });

/** Options with a fixed base, a fake probe and counted object URLs; keepTime false unless given. */
function options(extra: Partial<ClipLoadOptions> = {}) {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const opts: ClipLoadOptions = {
    baseHref: BASE,
    keepTime: false,
    nowMs: T,
    probe: async () => PROBE,
    createObjectUrl: (blob) => {
      created.push(blob);
      return `blob:${BASE}${created.length}`;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    ...extra,
  };
  return { opts, created, revoked };
}

const clipEntry = (store: AppStore, id = CLIP_ID): LocalVideoCamera =>
  store.getState().camera.registry[id] as LocalVideoCamera;

/** importCalibration normalises (roll through wrap180): compare every field to 1e-9. */
function expectCalibration(actual: unknown, expected: Record<string, unknown>): void {
  expect(actual).toBeDefined();
  const a = actual as Record<string, unknown>;
  expect(Object.keys(a).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "number") expect(a[key]).toBeCloseTo(value, 9);
    else expect(a[key]).toEqual(value);
  }
}

describe("loadClipFromSidecarUrl", () => {
  it("loads the e2e sidecar: the clip camera is filled in, then calibration, recentre, live and paused", async () => {
    const store = setup();
    store.getState().actions.setRate(60);
    const { fn, calls } = fakeFetch({ [SIDECAR_URL]: json(E2E), [VIDEO_URL]: partial() });
    const statuses: string[] = [];
    store.subscribe(
      (s) => s.video.status,
      (status) => statuses.push(status),
    );
    const { opts } = options();
    const result = await loadClipFromSidecarUrl(store, CLIP_ID, fn, opts);

    expect(calls.map((c) => c.url)).toEqual([SIDECAR_URL, VIDEO_URL]);
    expect(calls[0]?.init?.cache).toBe("no-cache");
    expect(new Headers(calls[1]?.init?.headers).get("range")).toBe("bytes=0-1");
    const camera = clipEntry(store);
    expect(camera.source).toEqual({
      sidecarUrl: "recordings/subaru-2026-10-11-iss.json",
      sourceCameraId: "subaru-starcam",
      videoUrl: VIDEO_URL, // 206: streamed from its URL
      startUtcMs: START,
    });
    expect(camera.credit.text).toBe("Test pattern generated for the Overhead e2e tests");
    const s = store.getState();
    expectCalibration(s.camera.calibration[CLIP_ID], {
      ...registry["subaru-starcam"]?.defaults,
      streamDelayMs: 0,
    });
    expect(s.clock).toMatchObject({
      rate: 1,
      mode: "replay",
      playing: false,
      simTimeMs: START,
      rangeCenterMs: START,
    });
    expect(s.camera.status[CLIP_ID]).toBe("live");
    expect(statuses).toEqual(["loading", "paused"]);
    expect(result?.failure).toBeNull();
    expect(result?.clip?.fileName).toBe("test-pattern.webm");
    expect(result?.clip?.notes).toEqual(["The clip is 320 × 180; it is drawn at 3840 × 2160."]);
    expect(result?.clip?.sidecarJson).toEqual(E2E);
    expect(getClipLoadState(CLIP_ID)).toBe(result);
  });

  it("reads a clip served without ranges (200 video/…) into a Blob and plays the object URL (H1)", async () => {
    const store = setup();
    const { fn } = fakeFetch({ [SIDECAR_URL]: json(E2E), [VIDEO_URL]: whole() });
    const { opts, created } = options();
    await loadClipFromSidecarUrl(store, CLIP_ID, fn, opts);
    expect(created).toHaveLength(1);
    expect(created[0]?.size).toBe(4);
    expect(created[0]?.type).toBe("video/webm");
    expect(clipEntry(store).source.videoUrl).toBe(`blob:${BASE}1`);
  });

  it("is 'not part of this build' for an index.html fallback, a 404, a network error or a non-video clip URL", async () => {
    const cases: Record<string, Answer>[] = [
      { [SIDECAR_URL]: html() },
      {
        [SIDECAR_URL]: new Response("{}", {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      },
      { [SIDECAR_URL]: new TypeError("Failed to fetch") },
      {
        [SIDECAR_URL]: new Response("not json", {
          headers: { "content-type": "application/json" },
        }),
      },
      { [SIDECAR_URL]: json(E2E), [VIDEO_URL]: html() },
      { [SIDECAR_URL]: json(E2E), [VIDEO_URL]: new TypeError("Failed to fetch") },
    ];
    for (const answers of cases) {
      const store = setup();
      const { fn } = fakeFetch(answers);
      const result = await loadClipFromSidecarUrl(store, CLIP_ID, fn, options().opts);
      expect(result?.failure).toEqual({ message: CLIP_TEXT.notInBuild, problems: [] });
      expect(result?.clip).toBeNull();
      const s = store.getState();
      expect(s.video.status).toBe("error");
      expect(s.camera.status[CLIP_ID]).toBe("offline");
      expect(clipEntry(store).source.videoUrl).toBeNull();
      expect(s.clock.simTimeMs).toBe(T);
    }
  });

  it("lists the sidecar's problems and changes nothing else", async () => {
    const store = setup();
    const broken = { ...E2E, videoFile: "a/test-pattern.webm" };
    const { fn, calls } = fakeFetch({ [SIDECAR_URL]: json(broken) });
    const result = await loadClipFromSidecarUrl(store, CLIP_ID, fn, options().opts);
    expect(result?.failure).toEqual({
      message: "The sidecar has problems:",
      problems: ["videoFile must be a file name with no / or \\"],
    });
    expect(calls).toHaveLength(1);
    expect(store.getState().video.status).toBe("error");
    expect(store.getState().camera.status[CLIP_ID]).toBeUndefined();
    expect(clipEntry(store)).toBe(registry[CLIP_ID]);
  });

  it("refuses a sidecar of another camera than the clip camera's source", async () => {
    const store = setup();
    const { fn } = fakeFetch({ [SIDECAR_URL]: json({ ...E2E, cameraId: "cfht-starcam" }) });
    const result = await loadClipFromSidecarUrl(store, CLIP_ID, fn, options().opts);
    expect(result?.failure?.message).toBe(
      "The sidecar's cameraId (cfht-starcam) does not match this clip camera.",
    );
  });

  it("a MediaError, a wrong aspect and an endless duration block loading; Blob URLs are revoked", async () => {
    const probes: (VideoProbe | "media-error")[] = [
      "media-error",
      { durationS: 7, widthPx: 320, heightPx: 200 },
      { durationS: Number.POSITIVE_INFINITY, widthPx: 320, heightPx: 180 },
    ];
    const messages: (string | undefined)[] = [];
    for (const probe of probes) {
      const store = setup();
      const { fn } = fakeFetch({ [SIDECAR_URL]: json(E2E), [VIDEO_URL]: whole() });
      const { opts, revoked } = options({ probe: async () => probe });
      const result = await loadClipFromSidecarUrl(store, CLIP_ID, fn, opts);
      messages.push(result?.failure?.message);
      expect(revoked).toEqual([`blob:${BASE}1`]);
      expect(clipEntry(store).source.videoUrl).toBeNull();
      expect(store.getState().video.status).toBe("error");
    }
    expect(messages).toEqual([
      cannotPlayText("test-pattern.webm"),
      "The clip is 320 × 200; its width:height differs from the camera's 3840 × 2160 by more than 0.5 %.",
      "The clip's duration (Infinity s) is not a finite length of at most 43200 s.",
    ]);
  });

  it("keeps a calibration already stored for the clip camera, and the URL time when asked", async () => {
    const store = setup();
    const { actions } = store.getState();
    const mine = {
      ...(registry["subaru-starcam"]?.defaults ?? ({} as never)),
      azDeg: 82,
      streamDelayMs: 0,
    };
    actions.importCalibration(CLIP_ID, mine);
    const stored = store.getState().camera.calibration[CLIP_ID];
    actions.recenter(START + 3_000);
    const { fn } = fakeFetch({ [SIDECAR_URL]: json(E2E), [VIDEO_URL]: partial() });
    await loadClipFromSidecarUrl(store, CLIP_ID, fn, options({ keepTime: true }).opts);
    const s = store.getState();
    expect(s.camera.calibration[CLIP_ID]).toBe(stored);
    expect(s.clock.simTimeMs).toBe(START + 3_000);
  });

  it("imports the sidecar's own calibration (the 2026-10-11 star fit) for a fresh clip camera", async () => {
    const store = setup();
    const calibration = {
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
    };
    const { fn } = fakeFetch({
      [SIDECAR_URL]: json({ ...E2E, calibration }),
      [VIDEO_URL]: partial(),
    });
    await loadClipFromSidecarUrl(store, CLIP_ID, fn, options().opts);
    expectCalibration(store.getState().camera.calibration[CLIP_ID], calibration);
    expect(clipEntry(store).defaults).toEqual(calibration);
  });

  it("drops the result when aborted or when another camera became active meanwhile", async () => {
    for (const leave of ["abort", "switch"] as const) {
      const store = setup();
      const controller = new AbortController();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { fn } = fakeFetch({ [SIDECAR_URL]: json(E2E), [VIDEO_URL]: partial() });
      const { opts } = options({
        signal: controller.signal,
        probe: async () => {
          await gate;
          return PROBE;
        },
      });
      const pending = loadClipFromSidecarUrl(store, CLIP_ID, fn, opts);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (leave === "abort") controller.abort();
      else store.getState().actions.setActiveCamera(DEFAULT_CAMERA_ID);
      release();
      expect(await pending).toBeNull();
      expect(clipEntry(store).source.videoUrl).toBeNull();
      expect(store.getState().clock.simTimeMs).toBe(T);
    }
  });

  it("does nothing for a camera without a sidecarUrl", async () => {
    const store = setup("local-replay");
    const { fn, calls } = fakeFetch({});
    expect(await loadClipFromSidecarUrl(store, "local-replay", fn, options().opts)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("notifies subscribers on every state change", async () => {
    const store = setup();
    let notified = 0;
    const unsubscribe = subscribeClipLoads(() => {
      notified += 1;
    });
    const { fn } = fakeFetch({ [SIDECAR_URL]: json(E2E), [VIDEO_URL]: partial() });
    await loadClipFromSidecarUrl(store, CLIP_ID, fn, options().opts);
    unsubscribe();
    expect(notified).toBe(2); // loading, then loaded
  });
});

describe("loadClip (local-replay, picked files)", () => {
  const webm = (name = "test-pattern.webm"): File =>
    new File([new Uint8Array([0x1a, 0x45])], name, { type: "video/webm" });
  const sidecarFile = (body: unknown = E2E, name = "test-pattern.sidecar.json"): File =>
    new File([typeof body === "string" ? body : JSON.stringify(body)], name, {
      type: "application/json",
    });

  it("loads a clip and its sidecar picked together, from an object URL", async () => {
    const store = setup("local-replay");
    const { opts, created } = options();
    const result = await loadClip([webm(), sidecarFile()], store, opts);
    expect(result?.failure).toBeNull();
    expect(created).toHaveLength(1);
    const camera = clipEntry(store, "local-replay");
    expect(camera.source).toEqual({
      sidecarUrl: null,
      sourceCameraId: "subaru-starcam",
      videoUrl: `blob:${BASE}1`,
      startUtcMs: START,
    });
    expect(camera.name).toBe("Local clip (replay)");
    expect(camera.credit.licence).toBe("CC0-1.0");
    const s = store.getState();
    expect(s.clock.simTimeMs).toBe(START);
    expect(s.video.status).toBe("paused");
    expect(result?.clip?.fileName).toBe("test-pattern.webm");
  });

  it("needs exactly one video and one .json", async () => {
    for (const files of [
      [webm()],
      [sidecarFile()],
      [webm(), webm("b.webm")],
      [webm(), sidecarFile(), sidecarFile()],
    ]) {
      const store = setup("local-replay");
      const result = await loadClip(files, store, options().opts);
      expect(result?.failure).toEqual({ message: CLIP_TEXT.pickBoth, problems: [] });
      expect(store.getState().video.status).toBe("error");
      expect(clipEntry(store, "local-replay").source.videoUrl).toBeNull();
    }
  });

  it("lists the sidecar's problems (e2e test 19), and a .json that is not JSON", async () => {
    const store = setup("local-replay");
    const bad = await loadClip(
      [webm(), sidecarFile({ ...E2E, videoFile: "a/test-pattern.webm" })],
      store,
      options().opts,
    );
    expect(bad?.failure?.problems).toEqual(["videoFile must be a file name with no / or \\"]);
    const notJson = await loadClip([webm(), sidecarFile("{oops")], store, options().opts);
    expect(notJson?.failure).toEqual({
      message: CLIP_TEXT.problems,
      problems: [CLIP_TEXT.notJson],
    });
    expect(store.getState().clock.simTimeMs).toBe(T);
  });

  it("notes a sidecar that names another file, and plays the picked one", async () => {
    const store = setup("local-replay");
    const result = await loadClip([webm("pattern.webm"), sidecarFile()], store, options().opts);
    expect(result?.clip?.notes).toEqual([
      "The sidecar names test-pattern.webm; playing pattern.webm.",
      "The clip is 320 × 180; it is drawn at 3840 × 2160.",
    ]);
  });

  it("a second clip revokes the first object URL, imports its own calibration, and a failed pick keeps the clip", async () => {
    const store = setup("local-replay");
    const first = options();
    await loadClip([webm(), sidecarFile()], store, first.opts);
    const firstCalibration = store.getState().camera.calibration["local-replay"];
    expect(firstCalibration?.focalPx).toBe(registry["subaru-starcam"]?.defaults.focalPx);

    const second = options({
      createObjectUrl: () => "blob:second",
      revokeObjectUrl: first.opts.revokeObjectUrl,
    });
    const calibration = { ...(firstCalibration ?? ({} as never)), azDeg: 80, updatedAtMs: 5 };
    await loadClip([webm(), sidecarFile({ ...E2E, calibration })], store, second.opts);
    expect(first.revoked).toEqual([`blob:${BASE}1`]);
    expect(store.getState().camera.calibration["local-replay"]?.azDeg).toBe(80);

    const failed = await loadClip([webm()], store, second.opts);
    expect(failed?.failure?.message).toBe(CLIP_TEXT.pickBoth);
    expect(failed?.clip?.fileName).toBe("test-pattern.webm"); // still on screen
    expect(store.getState().video.status).toBe("paused");
    expect(clipEntry(store, "local-replay").source.videoUrl).toBe("blob:second");
  });
});

describe("copyClipPointing", () => {
  it("gives the clip's calibration to its source camera, which keeps its own stream delay", async () => {
    const store = setup();
    const { actions } = store.getState();
    actions.setActiveCamera("subaru-starcam");
    actions.setStreamDelayMs(22_000);
    actions.setActiveCamera(CLIP_ID);
    const clipCalibration = {
      ...(registry["subaru-starcam"]?.defaults ?? ({} as never)),
      azDeg: 81.5,
      rollDeg: 0.5,
      streamDelayMs: 0,
      updatedAtMs: 7,
    };
    actions.importCalibration(CLIP_ID, clipCalibration);
    expect(copyClipPointing(store, CLIP_ID)).toBe(true);
    expectCalibration(store.getState().camera.calibration["subaru-starcam"], {
      ...clipCalibration,
      streamDelayMs: 22_000,
    });
  });

  it("uses the source camera's default delay, and is false without a source camera", () => {
    const store = setup();
    expect(copyClipPointing(store, CLIP_ID)).toBe(true);
    expect(store.getState().camera.calibration["subaru-starcam"]?.streamDelayMs).toBe(50_000);
    expect(copyClipPointing(store, "local-replay")).toBe(false); // no clip loaded: no source
    expect(copyClipPointing(store, "subaru-starcam")).toBe(false);
  });
});

describe("pure helpers", () => {
  const CONTRACT = parseClipSidecar(
    JSON.parse(
      readFileSync(new URL("../fixtures/video/test-pattern.sidecar.json", import.meta.url), "utf8"),
    ),
    registry,
    T,
  );
  const e2e = (CONTRACT.ok ? CONTRACT.sidecar : null) as ClipSidecar;
  const S = 1_791_731_310_183;
  const issClip: ClipSidecar = {
    ...e2e,
    startUtcMs: S,
    durationS: 480,
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
  };

  it("clipHiddenMs: the dome stretches of the 2026-10-11 clip (media 228–238, 241.5–256, 258.4–260.8 s)", () => {
    const hidden = clipHiddenMs(issClip, 25544);
    expect(hidden).toHaveLength(3);
    const media = hidden.map(([a, b]) => [(a - S) / 1000, (b - S) / 1000]);
    expect(media[0]).toEqual([228, 238]);
    expect(media[1]).toEqual([241.5, 256]);
    expect(media[2]?.[0]).toBeCloseTo(258.4, 9);
    expect(media[2]?.[1]).toBeCloseTo(260.8, 9);
    expect(clipHiddenMs(issClip, 48274)).toEqual([]);
    expect(clipHiddenMs(e2e, 25544)).toEqual([]);
  });

  it("sidecarToSave keeps every key and replaces the calibration, with no stream delay; sidecarFileName", () => {
    const disk = { format: "overhead.clip", version: 1, ...E2E, recordedWith: { ffmpeg: "7.1" } };
    const calibration = {
      ...(registry["subaru-starcam"]?.defaults ?? ({} as never)),
      streamDelayMs: 50_000,
    };
    const saved = sidecarToSave(disk, calibration);
    expect(Object.keys(saved)).toEqual([...Object.keys(disk), "calibration"]);
    expect(saved.recordedWith).toEqual({ ffmpeg: "7.1" });
    expect(saved.calibration).toEqual({ ...calibration, streamDelayMs: 0 });
    const withCalibration = sidecarToSave(
      { ...disk, calibration: { old: true }, pass: 1 },
      calibration,
    );
    expect(Object.keys(withCalibration).slice(-2)).toEqual(["calibration", "pass"]); // replaced in place
    expect(parseClipSidecar(saved, registry, T).ok).toBe(true);
    expect(sidecarFileName("subaru-2026-10-11-iss.mp4")).toBe("subaru-2026-10-11-iss.json");
    expect(sidecarFileName("test-pattern.webm")).toBe("test-pattern.json");
    expect(sidecarFileName("clip")).toBe("clip.json");
  });

  it("formatClipDuration: m:ss.s", () => {
    expect(formatClipDuration(480)).toBe("8:00.0");
    expect(formatClipDuration(7)).toBe("0:07.0");
    expect(formatClipDuration(59.96)).toBe("1:00.0");
    expect(formatClipDuration(150.833333)).toBe("2:30.8");
    expect(formatClipDuration(Number.NaN)).toBe("unknown");
  });

  it("checkVideoProbe: the 2026-10-11 clip is 1920 × 1080 on a 3840 × 2160 camera, a note only", () => {
    const subaru = registry["subaru-starcam"] as CameraConfig;
    const real = { ...e2e, durationS: 480, width: 1920, height: 1080, fps: 30 };
    expect(
      checkVideoProbe({ durationS: 480, widthPx: 1920, heightPx: 1080 }, real, subaru),
    ).toEqual({
      error: null,
      notes: ["The clip is 1920 × 1080; it is drawn at 3840 × 2160."],
    });
    // One frame (1/30 s) of slack on the duration; the sidecar's own size.
    expect(
      checkVideoProbe({ durationS: 480.03, widthPx: 1920, heightPx: 1080 }, real, subaru).notes,
    ).toHaveLength(1);
    expect(
      checkVideoProbe({ durationS: 480.04, widthPx: 3840, heightPx: 2160 }, real, subaru).notes,
    ).toEqual([
      "The video lasts 480.04 s; the sidecar says 480 s.",
      "The video is 3840 × 2160; the sidecar says 1920 × 1080.",
    ]);
    expect(
      checkVideoProbe({ durationS: 43_201, widthPx: 1920, heightPx: 1080 }, real, subaru).error,
    ).toMatch(/duration/);
    expect(checkVideoProbe({ durationS: 480, widthPx: 0, heightPx: 0 }, real, subaru).error).toBe(
      "The browser reports no video size for the clip.",
    );
  });

  it("cannotPlayText names a remux command that never overwrites its input", () => {
    expect(cannotPlayText("clip.ts")).toBe(
      "This browser cannot play the file. Remux it to MP4: ffmpeg -i clip.ts -map 0:v -c copy -movflags +faststart clip.mp4",
    );
    expect(cannotPlayText("clip.mp4")).toMatch(/ clip-remux\.mp4$/);
  });

  it("offeredRates: 1× and 10× with a clip, else all four", () => {
    expect(offeredRates("local-video")).toBe(CLIP_RATES);
    expect(CLIP_RATES).toEqual([1, 10]);
    expect(offeredRates("youtube")).toEqual([1, 10, 60, 600]);
    expect(offeredRates(undefined)).toEqual([1, 10, 60, 600]);
  });

  it("claimUrlTime: only the first claim, and only for the ?cam= camera of a page with a valid ?t=", () => {
    expect(claimUrlTime(CLIP_ID, `?cam=${CLIP_ID}&t=2026-10-11T08:00:03Z`)).toBe(true);
    expect(claimUrlTime(CLIP_ID, `?cam=${CLIP_ID}&t=2026-10-11T08:00:03Z`)).toBe(false);
  });
});
