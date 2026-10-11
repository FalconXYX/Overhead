import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENABLED_CAMERA_IDS, enabledCameras, parseCameraRegistry } from "../../src/app/cameras";

const committed: unknown = JSON.parse(
  readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
);
/** A fresh deep copy of the committed file, to break on purpose. */
const copy = (): Record<string, unknown>[] =>
  structuredClone(committed) as Record<string, unknown>[];

describe("committed cameras.json", () => {
  const all = parseCameraRegistry(committed);

  it("holds the five known cameras in picker order", () => {
    expect(Object.keys(all)).toEqual([
      "synthetic-maunakea",
      "cfht-nanaao",
      "subaru-starcam",
      "cfht-starcam",
      "synthetic-walenstadt",
    ]);
  });

  it("enables only synthetic-maunakea", () => {
    expect(ENABLED_CAMERA_IDS).toEqual(["synthetic-maunakea"]);
    const enabled = enabledCameras(all);
    expect(Object.keys(enabled)).toEqual(["synthetic-maunakea"]);
    const focalPx = enabled["synthetic-maunakea"]?.defaults.focalPx ?? Number.NaN;
    expect(Math.abs(focalPx - 1024 / Math.PI)).toBeLessThan(1e-9);
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
    expect(subaru?.defaults).toMatchObject({
      azDeg: 81.2,
      altDeg: 19.6,
      focalPx: 2742,
      streamDelayMs: 50_000,
    });
    expect(subaru?.credit.text).toBe("NAOJ & Asahi Shimbun");
    expect(subaru?.termsNote).toBe("YouTube embed; non-commercial use with credit");
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
    const entries = copy().slice(1);
    (entries[0] as Record<string, unknown>).id = "Bad Id";
    const message = (() => {
      try {
        parseCameraRegistry(entries);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toMatch(/synthetic-maunakea/);
    expect(message).toMatch(/Bad Id/);
  });

  it("accepts a local-video entry with null clip fields and rejects mistyped ones", () => {
    const entries = copy();
    const subaru = entries[2] as Record<string, unknown>;
    const clip = {
      ...structuredClone(subaru),
      id: "local-replay",
      kind: "local-video",
      source: { sidecarUrl: null, sourceCameraId: null, videoUrl: null, startUtcMs: null },
    };
    expect(() => parseCameraRegistry([...entries, clip])).not.toThrow();
    const bad = {
      ...clip,
      source: { sidecarUrl: 1, sourceCameraId: null, videoUrl: null, startUtcMs: "0" },
    };
    expect(() => parseCameraRegistry([...entries, bad])).toThrow(/sidecarUrl[\s\S]*startUtcMs/);
  });
});
