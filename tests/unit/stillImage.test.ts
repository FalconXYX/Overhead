// Still-image camera rules (M4 steps 7, 10, 13 and 16): capture time, status, size notice, arc grid.
import { describe, expect, it } from "vitest";
import {
  burnedInCaptureTimeMs,
  burnedInOffsetMs,
  CAMERA_STATUS_TEXT,
  ESTIMATED_FRAME_TIME_TEXT,
  estimatedFrameTimeMs,
  exposureArcGrid,
  imageCapturedText,
  imageSizeNotice,
  MINUTE_STAMP_OFFSET_MS,
  stillImageErrorStatus,
  stillImageErrorStatusAt,
} from "../../src/app/stillImage";
import type { StillImageCamera } from "../../src/state/types";
import { committedCameras } from "../helpers/store";

const at = (iso: string): number => Date.parse(iso);

function nanaao(): StillImageCamera {
  const camera = committedCameras()["cfht-nanaao"];
  if (camera?.kind !== "still-image") throw new Error("cfht-nanaao must be a still-image camera");
  return camera;
}

/** ASK053 as M4 step 7 describes it (M6 adds the real entry): Europe/Vaduz clock, 60 s exposures. */
function ask053Like(): StillImageCamera {
  const base = nanaao();
  return {
    ...base,
    id: "ask053-like",
    site: { ...base.site, timeZone: "Europe/Vaduz" },
    source: { ...base.source, corsEnabled: true, refreshSec: 120, exposureSec: 60 },
  };
}

describe("capture time", () => {
  it("estimated: load time − captureLagMs (Nānā ao 40 s)", () => {
    const camera = nanaao();
    expect(camera.source.captureLagMs).toBe(40_000);
    const loaded = at("2026-10-11T08:00:00Z");
    expect(estimatedFrameTimeMs(loaded, camera.source.captureLagMs)).toBe(
      at("2026-10-11T07:59:20Z"),
    );
    expect(ESTIMATED_FRAME_TIME_TEXT).toBe("estimated (± 30 s)");
  });

  it("Nānā ao: the HST stamp to the minute + 30 s", () => {
    const camera = nanaao();
    expect(burnedInOffsetMs(camera.source)).toBe(MINUTE_STAMP_OFFSET_MS);
    // An archived frame stamped 2025-07-15 20:47 HST
    expect(burnedInCaptureTimeMs(camera, "2025-07-15T20:47")).toBe(at("2025-07-16T06:47:30Z"));
    // datetime-local with step 1 may carry the seconds field
    expect(burnedInCaptureTimeMs(camera, "2025-07-15T20:47:00")).toBe(at("2025-07-16T06:47:30Z"));
  });

  it("ASK053: the Europe/Vaduz stamp is the exposure start; + exposureSec × 500 ms", () => {
    const camera = ask053Like();
    expect(burnedInOffsetMs(camera.source)).toBe(30_000);
    expect(burnedInOffsetMs({ exposureSec: 120 })).toBe(60_000);
    expect(burnedInOffsetMs({ exposureSec: 2 })).toBe(1_000);
    // Fetched 2026-10-11T10:09:27Z: "11-10-2026 12:08:01" (10:08:01Z), entered in ISO order
    expect(burnedInCaptureTimeMs(camera, "2026-10-11T12:08:01")).toBe(at("2026-10-11T10:08:31Z"));
  });

  it("null for a malformed stamp, an impossible date or a wall time skipped by DST", () => {
    const camera = ask053Like();
    expect(burnedInCaptureTimeMs(camera, "11-10-2026 12:08:01")).toBeNull();
    expect(burnedInCaptureTimeMs(camera, "2026-02-30T00:00")).toBeNull();
    expect(burnedInCaptureTimeMs(camera, "2026-03-29T02:30")).toBeNull();
    expect(burnedInCaptureTimeMs(camera, "")).toBeNull();
  });

  it('"Image captured HH:MM:SS UTC", truncated to the second', () => {
    expect(imageCapturedText(at("2026-10-11T08:00:12.900Z"))).toBe("Image captured 08:00:12 UTC");
  });
});

describe("status after a failed load (404 means the hatch is closed)", () => {
  it("daytime only while the Sun is above 0°", () => {
    expect(stillImageErrorStatus(0.01)).toBe("daytime");
    expect(stillImageErrorStatus(45)).toBe("daytime");
    expect(stillImageErrorStatus(0)).toBe("offline");
    expect(stillImageErrorStatus(-12)).toBe("offline");
    expect(stillImageErrorStatus(Number.NaN)).toBe("offline");
  });

  it("at Maunakea: 2026-10-11T08:00Z (22:00 HST) offline, 22:00Z (noon HST) daytime", () => {
    const { site } = nanaao();
    expect(stillImageErrorStatusAt(site, at("2026-10-11T08:00:00Z"))).toBe("offline");
    expect(stillImageErrorStatusAt(site, at("2026-10-11T22:00:00Z"))).toBe("daytime");
  });

  it("picker words: text for every status, never colour alone", () => {
    expect(CAMERA_STATUS_TEXT).toEqual({
      live: "Live",
      offline: "Offline",
      daytime: "Daytime",
      unknown: "Not checked",
    });
  });
});

describe("imageSizeNotice", () => {
  const size = { widthPx: 1232, heightPx: 1232 };
  it("names both sizes when the loaded image differs", () => {
    expect(imageSizeNotice(256, 256, size)).toBe(
      "Image is 256 × 256 px; the calibration assumes 1232 × 1232 px",
    );
    expect(imageSizeNotice(1240, 1227, size)).toBe(
      "Image is 1240 × 1227 px; the calibration assumes 1232 × 1232 px",
    );
  });

  it("null when the sizes match or the size is unknown", () => {
    expect(imageSizeNotice(1232, 1232, size)).toBeNull();
    expect(imageSizeNotice(0, 0, size)).toBeNull();
    expect(imageSizeNotice(Number.NaN, 1232, size)).toBeNull();
  });
});

describe("exposureArcGrid (step 16)", () => {
  const frame = at("2026-10-11T10:08:31Z");
  it("60 s: 13 steps of 5 s centred on the frame time", () => {
    const grid = exposureArcGrid(frame, 60);
    expect(grid).toEqual({ startMs: frame - 30_000, stepMs: 5_000, steps: 13 });
    if (grid === null) return;
    expect(grid.startMs + (grid.steps - 1) * grid.stepMs).toBe(frame + 30_000);
  });

  it("only for exposures longer than 1 s, with finite inputs", () => {
    expect(exposureArcGrid(frame, 0)).toBeNull(); // Nānā ao: dots
    expect(exposureArcGrid(frame, 1)).toBeNull();
    expect(exposureArcGrid(frame, 1.5)).toEqual({ startMs: frame - 750, stepMs: 5_000, steps: 1 });
    expect(exposureArcGrid(frame, 12)).toEqual({ startMs: frame - 6_000, stepMs: 5_000, steps: 3 });
    expect(exposureArcGrid(Number.NaN, 60)).toBeNull();
    expect(exposureArcGrid(frame, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
