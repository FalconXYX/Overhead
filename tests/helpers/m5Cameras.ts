// tests/helpers/m5Cameras.ts — the final state of the four camera entries M5 step 2 settles or inserts, exactly as
// the milestone file lists them. Until public/data/cameras.json carries them, tests merge them into the committed
// file with withM5CameraEntries; once it does, the merge changes nothing.
import type { CameraConfig } from "../../src/state/types";

const SUBARU_SITE = {
  latDeg: 19.82552,
  lonDeg: -155.47587,
  heightM: 4148,
  mastM: 13,
  geoidSepM: 24.32,
  timeZone: "Pacific/Honolulu",
};
/** The 2026-10-11 star fit (73 stars, rms 0.0415° per pair), in 3840 × 2160 pixels. */
const SUBARU_FIT = {
  azDeg: 81.2322,
  altDeg: 19.6185,
  rollDeg: 0.7698,
  focalPx: 2525.93,
  cxPx: 1920,
  cyPx: 1080,
  k1: -0.00992,
  k2: 0,
  flipX: false,
  rmsDeg: 0.0415,
  updatedAtMs: 0,
};

export const M5_CAMERA_ENTRIES = [
  {
    id: "subaru-starcam",
    name: "Subaru-Asahi StarCam (east, live)",
    kind: "youtube",
    source: {
      youtubeVideoId: "Kj5DjRYkzD8",
      resolverUrl: "https://astroasahi.github.io/maunakea_east/",
    },
    site: SUBARU_SITE,
    imageSize: { widthPx: 3840, heightPx: 2160 },
    lens: "rectilinear",
    defaults: { ...SUBARU_FIT, streamDelayMs: 50000 },
    credit: {
      text: "NAOJ & Asahi Shimbun",
      href: "https://www.youtube.com/channel/UCiN7OwV8g8dMm_E0xphBVig",
      licence: null,
      licenceHref: null,
    },
    termsNote: "Non-commercial use only",
  },
  {
    id: "cfht-starcam",
    name: "CFHT-Asahi StarCam (west, live)",
    kind: "youtube",
    source: {
      youtubeVideoId: "Q3UhCgsWDw8",
      resolverUrl: "https://astroasahi.github.io/maunakea_west/",
    },
    site: {
      latDeg: 19.8253,
      lonDeg: -155.4689,
      heightM: 4204,
      mastM: 33, // [M6] DEM ground 4,170.9 m + 33 m = heightM (M6 step 8)
      geoidSepM: 24.23,
      timeZone: "Pacific/Honolulu",
    },
    imageSize: { widthPx: 3840, heightPx: 2160 },
    lens: "rectilinear",
    defaults: {
      azDeg: 270,
      altDeg: 20,
      rollDeg: 0,
      focalPx: 2742,
      cxPx: 1920,
      cyPx: 1080,
      k1: 0,
      k2: 0,
      flipX: false,
      streamDelayMs: 50000,
      rmsDeg: null,
      updatedAtMs: 0,
    },
    credit: {
      text: "CFHT & Asahi Shimbun in collaboration with Subaru Telescope, NAOJ",
      href: "https://www.cfht.hawaii.edu/en/gallery/starcam.php",
      licence: null,
      licenceHref: null,
    },
    termsNote: "Non-commercial use only",
  },
  {
    id: "local-replay",
    name: "Local clip (replay)",
    kind: "local-video",
    source: { sidecarUrl: null, sourceCameraId: null, videoUrl: null, startUtcMs: null },
    site: SUBARU_SITE,
    imageSize: { widthPx: 3840, heightPx: 2160 },
    lens: "rectilinear",
    defaults: { ...SUBARU_FIT, streamDelayMs: 0 },
    credit: {
      text: "Local clip: credit comes from its sidecar",
      href: null,
      licence: null,
      licenceHref: null,
    },
    termsNote: "Played from this device only; never uploaded",
  },
  {
    id: "subaru-2026-10-11-iss",
    name: "Subaru StarCam: ISS pass, 2026-10-11 (recorded)",
    kind: "local-video",
    source: {
      sidecarUrl: "recordings/subaru-2026-10-11-iss.json",
      sourceCameraId: "subaru-starcam",
      videoUrl: null,
      startUtcMs: null,
    },
    site: SUBARU_SITE,
    imageSize: { widthPx: 3840, heightPx: 2160 },
    lens: "rectilinear",
    defaults: { ...SUBARU_FIT, streamDelayMs: 0 },
    credit: {
      text: "NAOJ & Asahi Shimbun",
      href: "https://www.youtube.com/watch?v=Kj5DjRYkzD8",
      licence: null,
      licenceHref: null,
    },
    termsNote: "Non-commercial use only",
  },
] as const satisfies readonly CameraConfig[];

/**
 * A deep copy of a cameras.json array with the M5 entries applied: an entry with the same id is replaced in place,
 * and a missing one is inserted after cfht-starcam (or after the previously inserted M5 entry), in M5 order.
 */
export function withM5CameraEntries(json: unknown): Record<string, unknown>[] {
  if (!Array.isArray(json)) throw new Error("cameras.json: expected an array");
  const out = structuredClone(json) as Record<string, unknown>[];
  let insertAt = out.findIndex((e) => e.id === "cfht-starcam") + 1;
  for (const entry of M5_CAMERA_ENTRIES) {
    const copy = structuredClone(entry) as unknown as Record<string, unknown>;
    const at = out.findIndex((e) => e.id === entry.id);
    if (at >= 0) {
      out[at] = copy;
      insertAt = Math.max(insertAt, at + 1);
    } else {
      out.splice(insertAt, 0, copy);
      insertAt += 1;
    }
  }
  return out;
}
