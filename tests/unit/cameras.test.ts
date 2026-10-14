import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ENABLED_CAMERA_IDS,
  enabledCameras,
  LIVE_CAMERA_ID,
  parseCameraRegistry,
  RECORDED_CLIP_ID,
} from "../../src/app/cameras";
import { DEFAULT_CAMERA_ID } from "../../src/state/initialState";
import { withM5CameraEntries } from "../helpers/m5Cameras";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
/** A fresh deep copy of the committed file, to break on purpose. */
const copy = (): Record<string, unknown>[] =>
  structuredClone(committed) as Record<string, unknown>[];

describe("committed cameras.json", () => {
  const all = parseCameraRegistry(committed);

  it("holds the seven known cameras in picker order", () => {
    expect(Object.keys(all)).toEqual([
      "synthetic-maunakea",
      "cfht-nanaao",
      "subaru-starcam",
      "cfht-starcam",
      "local-replay", // [M5] inserted after cfht-starcam (step 2)
      "subaru-2026-10-11-iss", // [M5]
      "synthetic-walenstadt",
    ]);
  });

  it("[Redesign] enables only the cameras with a video: the recorded ISS pass, then the two live StarCams", () => {
    expect(ENABLED_CAMERA_IDS).toEqual([RECORDED_CLIP_ID, LIVE_CAMERA_ID, "cfht-starcam"]);
    expect(RECORDED_CLIP_ID).toBe("subaru-2026-10-11-iss");
    expect(LIVE_CAMERA_ID).toBe("subaru-starcam");
    expect(DEFAULT_CAMERA_ID).toBe(RECORDED_CLIP_ID); // the site opens on the recorded pass
    const enabled = enabledCameras(all);
    // The switcher's order, not the file's.
    expect(Object.keys(enabled)).toEqual([
      "subaru-2026-10-11-iss",
      "subaru-starcam",
      "cfht-starcam",
    ]);
    expect(enabled["subaru-2026-10-11-iss"]?.kind).toBe("local-video");
    expect(enabled["subaru-starcam"]?.kind).toBe("youtube");
    expect(enabled["cfht-starcam"]?.kind).toBe("youtube");
    // The computed skies, picked files, the still image and ASK053 keep their entries for the tests, never enabled.
    for (const id of [
      "synthetic-maunakea",
      "synthetic-walenstadt",
      "local-replay",
      "cfht-nanaao",
      "ask053-walenstadt",
    ]) {
      expect(ENABLED_CAMERA_IDS, id).not.toContain(id);
      expect(enabled[id], id).toBeUndefined();
    }
    // An id the file lacks is skipped.
    const { "cfht-starcam": _gone, ...rest } = all;
    expect(Object.keys(enabledCameras(rest))).toEqual(["subaru-2026-10-11-iss", "subaru-starcam"]);
  });

  it("[Redesign] gives each enabled camera a plain shortName (the switcher) and siteName (the map's site label)", () => {
    const names = Object.values(enabledCameras(all)).map((c) => [c.id, c.shortName, c.siteName]);
    expect(names).toEqual([
      ["subaru-2026-10-11-iss", "ISS pass (recorded)", "Subaru Telescope camera"],
      ["subaru-starcam", "Subaru live", "Subaru Telescope camera"],
      ["cfht-starcam", "CFHT live", "CFHT camera"],
    ]);
    // Optional: the test-only entries keep their names alone.
    expect(all["synthetic-maunakea"]?.shortName).toBeUndefined();
    expect(all["synthetic-maunakea"]?.siteName).toBeUndefined();
  });

  it("[M6] keeps M1's synthetic-maunakea and synthetic-walenstadt entries for the tests", () => {
    const focalPx = all["synthetic-maunakea"]?.defaults.focalPx ?? Number.NaN;
    expect(Math.abs(focalPx - 1024 / Math.PI)).toBeLessThan(1e-9);
    expect(all["cfht-nanaao"]?.kind).toBe("still-image");
    expect(all["local-replay"]?.kind).toBe("local-video");
    expect(all["synthetic-walenstadt"]?.site).toEqual({
      latDeg: 47.1236,
      lonDeg: 9.3242,
      heightM: 467.6, // the Terrarium z14 ground (467.63 m): M1's provisional value is final
      mastM: 0,
      geoidSepM: 47.08,
      timeZone: "Europe/Zurich",
    });
  });

  it("carries the corrected Subaru StarCam facts", () => {
    const subaru = all["subaru-starcam"];
    expect(subaru?.site).toEqual({
      latDeg: 19.82552,
      lonDeg: -155.47587,
      heightM: 4148,
      mastM: 13,
      geoidSepM: 24.32,
      timeZone: "Pacific/Honolulu",
    });
    // [M5] Settled from the star fit on the 2026-10-11 clip (73 stars, rms 0.0415° per pair).
    expect(subaru?.defaults).toEqual({
      azDeg: 81.2322,
      altDeg: 19.6185,
      rollDeg: 0.7698,
      focalPx: 2525.93,
      cxPx: 1920,
      cyPx: 1080,
      k1: -0.00992,
      k2: 0,
      flipX: false,
      streamDelayMs: 50_000,
      rmsDeg: 0.0415,
      updatedAtMs: 0,
    });
    expect(subaru?.credit.text).toBe("NAOJ & Asahi Shimbun");
    expect(subaru?.termsNote).toBe("Non-commercial use only");
  });

  it("carries the CFHT StarCam's guessed defaults and both StarCams' terms note [M5]", () => {
    const cfht = all["cfht-starcam"];
    expect(cfht?.kind).toBe("youtube");
    expect(cfht?.source).toEqual({
      youtubeVideoId: "Q3UhCgsWDw8",
      resolverUrl: "https://astroasahi.github.io/maunakea_west/",
    });
    expect(cfht?.defaults).toMatchObject({
      azDeg: 270,
      altDeg: 20,
      focalPx: 2742,
      streamDelayMs: 50_000,
      rmsDeg: null,
    });
    expect(cfht?.termsNote).toBe("Non-commercial use only");
    // The M5 step 2 entries, as the tests' helper lists them: the committed file now matches them.
    const merged = parseCameraRegistry(withM5CameraEntries(committed));
    expect(merged["subaru-starcam"]).toEqual(all["subaru-starcam"]);
  });
});

describe("parseCameraRegistry", () => {
  it("[] throws the non-empty-array message", () => {
    expect(() => parseCameraRegistry([])).toThrow(
      new Error("cameras.json: expected a non-empty array"),
    );
    expect(() => parseCameraRegistry({})).toThrow("cameras.json: expected a non-empty array");
  });

  it("lists every problem in one Error", () => {
    const entries = copy();
    entries.push(structuredClone(entries[0]) as Record<string, unknown>); // duplicated id
    const nanaao = entries[1] as { site: { latDeg: number; timeZone: string } };
    nanaao.site.latDeg = 91;
    nanaao.site.timeZone = "Not/AZone";
    let message = "";
    try {
      parseCameraRegistry(entries);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      message = (error as Error).message;
    }
    expect(message).toMatch(/duplicate.*synthetic-maunakea/);
    expect(message).toMatch(/cfht-nanaao.*latDeg/);
    expect(message).toMatch(/cfht-nanaao.*timeZone.*Not\/AZone/);
  });

  it("checks kind-specific sources, lens, calibration, image and credit", () => {
    const entries = copy();
    const [synthetic, still, youtube] = entries as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    synthetic.source = { imageUrl: "https://example.invalid/x.png" };
    still.source = {
      imageUrl: "http://insecure.invalid/x.png",
      refreshSec: 30,
      corsEnabled: "no",
      captureLagMs: -1,
      exposureSec: -1,
    };
    youtube.source = { youtubeVideoId: "short", resolverUrl: 42 };
    youtube.lens = "pinhole";
    youtube.imageSize = { widthPx: 0, heightPx: 2160.5 };
    (youtube.defaults as Record<string, unknown>).k2 = "0";
    (youtube.credit as Record<string, unknown>).text = "";
    const problems = (() => {
      try {
        parseCameraRegistry(entries);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    for (const needle of [
      /synthetic-maunakea.*source/,
      /cfht-nanaao.*imageUrl/,
      /cfht-nanaao.*refreshSec/,
      /cfht-nanaao.*corsEnabled/,
      /cfht-nanaao.*captureLagMs/,
      /cfht-nanaao.*exposureSec/,
      /subaru-starcam.*youtubeVideoId/,
      /subaru-starcam.*resolverUrl/,
      /subaru-starcam.*lens/,
      /subaru-starcam.*imageSize/,
      /subaru-starcam.*defaults\.k2/,
      /subaru-starcam.*credit\.text/,
    ]) {
      expect(problems).toMatch(needle);
    }
  });

  it("requires the default camera and well-formed ids", () => {
    const entries = copy().filter((e) => e.id !== DEFAULT_CAMERA_ID);
    (entries[0] as Record<string, unknown>).id = "Bad Id";
    const message = (() => {
      try {
        parseCameraRegistry(entries);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toMatch(/the default camera subaru-2026-10-11-iss is missing/);
    expect(message).toMatch(/Bad Id/);
  });

  it("[Redesign] rejects an empty or non-string shortName or siteName", () => {
    const entries = copy();
    const first = entries[0] as Record<string, unknown>;
    first.shortName = "";
    first.siteName = 7;
    expect(() => parseCameraRegistry(entries)).toThrow(
      /shortName must be a non-empty string when present[\s\S]*siteName must be a non-empty string when present/,
    );
    delete first.shortName;
    first.siteName = "A camera";
    expect(parseCameraRegistry(entries)["synthetic-maunakea"]?.siteName).toBe("A camera");
  });

  it("accepts a local-video entry with null clip fields and rejects mistyped ones", () => {
    const entries = copy();
    const subaru = entries[2] as Record<string, unknown>;
    const clip = {
      ...structuredClone(subaru),
      id: "local-replay-copy", // local-replay itself is committed from M5
      kind: "local-video",
      source: { sidecarUrl: null, sourceCameraId: null, videoUrl: null, startUtcMs: null },
      // M5: a clip camera has no stream delay (the cloned YouTube entry has 50 s).
      defaults: { ...(subaru.defaults as Record<string, unknown>), streamDelayMs: 0 },
    };
    expect(() => parseCameraRegistry([...entries, clip])).not.toThrow();
    const bad = {
      ...clip,
      source: { sidecarUrl: 1, sourceCameraId: null, videoUrl: null, startUtcMs: "0" },
    };
    expect(() => parseCameraRegistry([...entries, bad])).toThrow(/sidecarUrl[\s\S]*startUtcMs/);
  });
});

describe("parseCameraRegistry: the M5 rules for youtube and local-video entries [M5]", () => {
  /** The committed file with M5 step 2's entries (settled Subaru defaults, local-replay, the 2026-10-11 clip). */
  const m5 = (): Record<string, unknown>[] => withM5CameraEntries(committed);
  const entry = (entries: Record<string, unknown>[], id: string): Record<string, unknown> => {
    const found = entries.find((e) => e.id === id);
    if (found === undefined) throw new Error(`no ${id}`);
    return found;
  };
  const problemsOf = (entries: unknown): string => {
    try {
      parseCameraRegistry(entries);
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };

  it("accepts the four M5 entries in picker order after cfht-starcam", () => {
    const all = parseCameraRegistry(m5());
    expect(Object.keys(all)).toEqual([
      "synthetic-maunakea",
      "cfht-nanaao",
      "subaru-starcam",
      "cfht-starcam",
      "local-replay",
      "subaru-2026-10-11-iss",
      "synthetic-walenstadt",
    ]);
    expect(all["subaru-starcam"]?.defaults).toMatchObject({
      azDeg: 81.2322,
      altDeg: 19.6185,
      rollDeg: 0.7698,
      focalPx: 2525.93,
      k1: -0.00992,
      streamDelayMs: 50_000,
    });
  });

  it("rejects each broken field with a message naming it", () => {
    const cases: [string, (entries: Record<string, unknown>[]) => void, RegExp][] = [
      [
        "a 12-character video id",
        (e) => {
          (entry(e, "subaru-starcam").source as Record<string, unknown>).youtubeVideoId =
            "Kj5DjRYkzD8X";
        },
        /subaru-starcam.*source\.youtubeVideoId/,
      ],
      [
        "an http: resolver",
        (e) => {
          (entry(e, "cfht-starcam").source as Record<string, unknown>).resolverUrl =
            "http://astroasahi.github.io/maunakea_west/";
        },
        /cfht-starcam.*source\.resolverUrl/,
      ],
      [
        "a resolver that is not a URL",
        (e) => {
          (entry(e, "cfht-starcam").source as Record<string, unknown>).resolverUrl =
            "maunakea_west";
        },
        /cfht-starcam.*source\.resolverUrl/,
      ],
      [
        "an absolute sidecarUrl",
        (e) => {
          (entry(e, "subaru-2026-10-11-iss").source as Record<string, unknown>).sidecarUrl =
            "/recordings/x.json";
        },
        /subaru-2026-10-11-iss.*source\.sidecarUrl/,
      ],
      [
        "a sidecarUrl with a scheme",
        (e) => {
          (entry(e, "subaru-2026-10-11-iss").source as Record<string, unknown>).sidecarUrl =
            "https://example.invalid/x.json";
        },
        /subaru-2026-10-11-iss.*source\.sidecarUrl/,
      ],
      [
        "a sidecarUrl that is not .json",
        (e) => {
          (entry(e, "subaru-2026-10-11-iss").source as Record<string, unknown>).sidecarUrl =
            "recordings/x.mp4";
        },
        /subaru-2026-10-11-iss.*source\.sidecarUrl/,
      ],
      [
        "a synthetic source camera",
        (e) => {
          (entry(e, "subaru-2026-10-11-iss").source as Record<string, unknown>).sourceCameraId =
            "synthetic-maunakea";
        },
        /subaru-2026-10-11-iss.*source\.sourceCameraId/,
      ],
      [
        "a source camera that is not in the file",
        (e) => {
          (entry(e, "subaru-2026-10-11-iss").source as Record<string, unknown>).sourceCameraId =
            "no-such-camera";
        },
        /subaru-2026-10-11-iss.*source\.sourceCameraId/,
      ],
      [
        "a non-null videoUrl",
        (e) => {
          (entry(e, "local-replay").source as Record<string, unknown>).videoUrl =
            "recordings/x.mp4";
        },
        /local-replay.*source\.videoUrl/,
      ],
      [
        "a startUtcMs in the file",
        (e) => {
          (entry(e, "local-replay").source as Record<string, unknown>).startUtcMs = "x";
        },
        /local-replay.*source\.startUtcMs/,
      ],
      [
        "a local-video delay of 1",
        (e) => {
          (entry(e, "local-replay").defaults as Record<string, unknown>).streamDelayMs = 1;
        },
        /local-replay.*defaults\.streamDelayMs/,
      ],
    ];
    for (const [what, breakIt, needle] of cases) {
      const entries = m5();
      breakIt(entries);
      const message = problemsOf(entries);
      expect(message, what).toMatch(needle);
      expect(message.split("; "), what).toHaveLength(1);
    }
  });

  it("accepts a null resolver, a clip of a still-image camera, and a nested relative sidecarUrl", () => {
    const entries = m5();
    (entry(entries, "cfht-starcam").source as Record<string, unknown>).resolverUrl = null;
    const clip = entry(entries, "subaru-2026-10-11-iss");
    (clip.source as Record<string, unknown>).sourceCameraId = "cfht-nanaao";
    (clip.source as Record<string, unknown>).sidecarUrl = "recordings/2026/nanaao.json";
    expect(problemsOf(entries)).toBe("");
  });
});
