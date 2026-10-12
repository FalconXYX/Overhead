// Calibration panel fields (M4 step 14.2), image-time texts (14.3) and arrow-key nudges (15.2).
import { describe, expect, it } from "vitest";
import { burnedInCaptureTimeMs } from "../../src/app/stillImage";
import {
  type Calibration,
  createCameraModel,
  distortionValid,
  hfovDeg,
  horizonRadiusUnit,
  type LensModel,
} from "../../src/domain/camera";
import type { CameraConfig, StillImageCamera } from "../../src/state/types";
import {
  altMinDeg,
  calibrationFields,
  calibrationNudge,
  fieldPatch,
  fieldText,
  fieldValueText,
  focalForHfovInput,
  focalRangePx,
  HFOV_LABEL,
  hfovOf,
  hfovRangeDeg,
  impliedStampValue,
  K1_MAX,
  k1FloorFor,
  parseFieldInput,
  stampRuleText,
  zonedInputValue,
} from "../../src/ui/calibrationFields";
import { committedCameras, storeAt } from "../helpers/store";

const cameras = committedCameras();
const get = (id: string): CameraConfig => {
  const camera = cameras[id];
  if (camera === undefined) throw new Error(`${id} missing`);
  return camera;
};
const nanaao = get("cfht-nanaao") as StillImageCamera;
const synthetic = get("synthetic-maunakea");
const subaru = get("subaru-starcam");

const near = (actual: number, expected: number, tol: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

function isValid(lens: LensModel, w: number, h: number, c: Calibration): boolean {
  const model = createCameraModel({ lens, calibration: c, widthPx: w, heightPx: h });
  return distortionValid(c.k1, c.k2, model.rMaxUnit);
}

describe("k1FloorFor", () => {
  it("finds the StarCam bound −0.22909 (3840 × 2160, f 2742, centred) ± 1e-5", () => {
    const frame = { focalPx: 2742, cxPx: 1920, cyPx: 1080, k2: 0 };
    near(k1FloorFor("rectilinear", 3840, 2160, frame), -0.22909, 1e-5);
  });

  it.each([
    ["fisheye-equidistant", -0.12834],
    ["fisheye-equisolid", -0.15833],
    ["fisheye-stereographic", -0.07917],
    ["fisheye-orthographic", -0.31667],
  ] as const)("1232² at f = 616/horizonRadiusUnit: %s → %f ± 1e-5", (lens, bound) => {
    const frame = { focalPx: 616 / horizonRadiusUnit(lens), cxPx: 616, cyPx: 616, k2: 0 };
    const floor = k1FloorFor(lens, 1232, 1232, frame);
    near(floor, bound, 1e-5);
    // Valid just above the bound, invalid just below it (the lens test's 1e-6 margins).
    const c = { ...nanaao.defaults, ...frame };
    expect(isValid(lens, 1232, 1232, { ...c, k1: floor + 1e-6 })).toBe(true);
    expect(isValid(lens, 1232, 1232, { ...c, k1: floor - 1e-6 })).toBe(false);
  });

  it("follows f, cx and cy: a longer focal length allows a stronger negative k1", () => {
    const base = { focalPx: 2742, cxPx: 1920, cyPx: 1080, k2: 0 };
    const longer = k1FloorFor("rectilinear", 3840, 2160, { ...base, focalPx: 4000 });
    const offCentre = k1FloorFor("rectilinear", 3840, 2160, { ...base, cxPx: 1700 });
    const centred = k1FloorFor("rectilinear", 3840, 2160, base);
    expect(longer).toBeLessThan(centred);
    expect(offCentre).toBeGreaterThan(centred); // a farther corner: less room
  });

  it("is NaN when even k1 = 0.5 fails (k2 strongly negative)", () => {
    const frame = { focalPx: 373.1, cxPx: 619.6, cyPx: 609.8, k2: -5 };
    expect(k1FloorFor("fisheye-equidistant", 1232, 1232, frame)).toBeNaN();
  });
});

describe("calibrationFields", () => {
  const ctxFor = (c: Calibration, camera: CameraConfig = nanaao) => ({
    lens: camera.lens,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
    defaultFocalPx: camera.defaults.focalPx,
    zenithLocked: camera.lens !== "rectilinear" && c.altDeg === 90,
    k1Floor: k1FloorFor(camera.lens, camera.imageSize.widthPx, camera.imageSize.heightPx, c),
  });

  it("gives the seven fields of step 14.2 with their units, ranges and steps (Nānā ao)", () => {
    const fields = calibrationFields(ctxFor(nanaao.defaults));
    expect(fields.map((f) => [f.key, f.label, f.min, f.max, f.step, f.disabled])).toEqual([
      ["azDeg", "Azimuth (°)", 0, 360, 0.01, false],
      ["altDeg", "Altitude (°)", 0, 90, 0.01, false],
      ["rollDeg", "Roll (°)", -180, 180, 0.01, false],
      ["focalPx", "Focal length (px)", 186.6, 746.2, 0.1, false], // 0.5–2 × 373.1 on the 0.1 grid
      ["cxPx", "Principal point x (px)", 0, 1232, 0.1, false],
      ["cyPx", "Principal point y (px)", 0, 1232, 0.1, false],
      ["k1", "Radial distortion k1 (no unit)", expect.any(Number), K1_MAX, 0.0001, false],
    ]);
    expect(fields.filter((f) => f.wraps).map((f) => f.key)).toEqual(["azDeg", "rollDeg"]);
  });

  it("puts the k1 minimum on the 0.0001 grid at or just above the bisected floor", () => {
    const fields = calibrationFields(ctxFor(nanaao.defaults));
    const k1 = fields.find((f) => f.key === "k1");
    const floor = k1FloorFor("fisheye-equidistant", 1232, 1232, nanaao.defaults);
    expect(k1?.min).toBeGreaterThanOrEqual(floor);
    expect((k1?.min ?? 0) - 0.0001).toBeLessThan(floor);
    expect(Number.isInteger(Math.round((k1?.min ?? 0) * 1e4))).toBe(true);
    expect(
      isValid("fisheye-equidistant", 1232, 1232, { ...nanaao.defaults, k1: k1?.min ?? 0 }),
    ).toBe(true);
  });

  it("disables the azimuth on a zenith-locked fisheye only", () => {
    const locked = calibrationFields(ctxFor(synthetic.defaults, synthetic));
    expect(locked.find((f) => f.key === "azDeg")?.disabled).toBe(true);
    const tilted = calibrationFields(ctxFor({ ...synthetic.defaults, altDeg: 89.5 }, synthetic));
    expect(tilted.find((f) => f.key === "azDeg")?.disabled).toBe(false);
  });

  it("starts the altitude at −10° on a rectilinear camera, 0° on a fisheye", () => {
    const fields = calibrationFields(ctxFor(subaru.defaults, subaru));
    expect(fields.find((f) => f.key === "altDeg")?.min).toBe(-10);
    expect(altMinDeg("rectilinear")).toBe(-10);
    expect(altMinDeg("fisheye-orthographic")).toBe(0);
    expect(focalRangePx(2742)).toEqual([1371, 5484]);
  });

  it("fieldPatch sets exactly one field", () => {
    expect(fieldPatch("k1", 0.01)).toEqual({ k1: 0.01 });
    expect(fieldPatch("azDeg", 12)).toEqual({ azDeg: 12 });
  });
});

describe("field text", () => {
  it("aria-valuetext reads '227.30 degrees', '373.1 pixels' and a bare k1", () => {
    expect(fieldValueText(227.3, { decimals: 2, unitWords: "degrees" })).toBe("227.30 degrees");
    expect(fieldValueText(373.1, { decimals: 1, unitWords: "pixels" })).toBe("373.1 pixels");
    expect(fieldValueText(0.003, { decimals: 4, unitWords: "" })).toBe("0.0030");
  });

  it("never shows -0 and keeps an ASCII minus for number inputs", () => {
    expect(fieldText(-0.0001, 2)).toBe("0.00");
    expect(fieldText(-179.95, 2)).toBe("-179.95");
    expect(fieldText(227.35000000000002, 2)).toBe("227.35");
  });

  it("commits only complete, in-range values; wrapping fields take any finite value", () => {
    const focal = { min: 186.6, max: 746.2, wraps: false };
    expect(parseFieldInput("", focal)).toBeNull();
    expect(parseFieldInput("-", focal)).toBeNull();
    expect(parseFieldInput("37", focal)).toBeNull(); // on the way to 373.1
    expect(parseFieldInput("373.1", focal)).toBe(373.1);
    expect(parseFieldInput("746.2", focal)).toBe(746.2);
    expect(parseFieldInput("746.3", focal)).toBeNull();
    expect(parseFieldInput("abc", focal)).toBeNull();
    const az = { min: 0, max: 360, wraps: true };
    expect(parseFieldInput("365", az)).toBe(365);
    expect(parseFieldInput("-5", az)).toBe(-5);
    expect(parseFieldInput("Infinity", az)).toBeNull();
  });
});

describe("field across the width", () => {
  it("reads 189.2° for Nānā ao at f 373.1 and links back to the focal length", () => {
    expect(HFOV_LABEL).toBe("Field across the width (°)");
    const hfov = hfovOf("fisheye-equidistant", 1232, 373.1);
    near(hfov, 189.2, 0.01);
    const f = focalForHfovInput("fisheye-equidistant", 1232, hfov, 373.1);
    near(f ?? Number.NaN, 373.1, 1e-9);
  });

  it("offers the HFOVs of the focal range's ends and refuses a focal length outside it", () => {
    const [lo, hi] = hfovRangeDeg("rectilinear", 3840, 2742);
    near(lo, hfovDeg("rectilinear", 3840, 5484), 0.01);
    near(hi, hfovDeg("rectilinear", 3840, 1371), 0.01);
    near(focalForHfovInput("rectilinear", 3840, 70, 2742) ?? Number.NaN, 2742.044, 1e-3);
    expect(focalForHfovInput("rectilinear", 3840, 179, 2742)).toBeNull(); // f far below 1371
    expect(focalForHfovInput("rectilinear", 3840, 180, 2742)).toBeNull(); // no focal length at all
  });

  it("caps an all-sky lens's HFOV range at 360°", () => {
    expect(hfovRangeDeg("fisheye-equidistant", 1232, 373.1)).toEqual([94.6, 360]);
    expect(focalForHfovInput("fisheye-equidistant", 1232, 361, 373.1)).toBeNull();
  });
});

describe("calibrationNudge", () => {
  it("→ adds 0.05° of azimuth; Shift makes it 0.5°; ← subtracts", () => {
    const c = nanaao.defaults; // az 227.3, alt 88.26: tilted
    expect(calibrationNudge(nanaao.lens, c, "ArrowRight", false)).toEqual({ azDeg: 227.35 });
    expect(calibrationNudge(nanaao.lens, c, "ArrowLeft", true)).toEqual({ azDeg: 226.8 });
    expect(calibrationNudge(nanaao.lens, c, "ArrowUp", false)).toEqual({ altDeg: 88.31 });
    expect(calibrationNudge(nanaao.lens, c, "ArrowDown", true)).toEqual({ altDeg: 87.76 });
    expect(calibrationNudge(nanaao.lens, c, "a", false)).toBeNull();
    expect(calibrationNudge(nanaao.lens, c, "Escape", false)).toBeNull();
  });

  it("turns the roll on a zenith-locked fisheye; ↑ stays at 90; ↓ unlocks", () => {
    const c = synthetic.defaults; // az 0, alt 90, roll 180
    expect(calibrationNudge(synthetic.lens, c, "ArrowRight", false)).toEqual({ rollDeg: 180.05 });
    expect(calibrationNudge(synthetic.lens, c, "ArrowLeft", false)).toEqual({ rollDeg: 179.95 });
    expect(calibrationNudge(synthetic.lens, c, "ArrowUp", true)).toEqual({ altDeg: 90 });
    expect(calibrationNudge(synthetic.lens, c, "ArrowDown", true)).toEqual({ altDeg: 89.5 });
  });

  it("keeps the altitude in the panel's range", () => {
    const low = { ...subaru.defaults, altDeg: -9.8 };
    expect(calibrationNudge("rectilinear", low, "ArrowDown", true)).toEqual({ altDeg: -10 });
    const fisheyeLow = { ...nanaao.defaults, altDeg: 0.2 };
    expect(calibrationNudge(nanaao.lens, fisheyeLow, "ArrowDown", true)).toEqual({ altDeg: 0 });
  });

  it("through updateCalibration: roll 180 → −179.95 on synthetic-maunakea, then Shift+↓ unlocks at 89.50", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    const nudge = (key: string, shift: boolean): void => {
      const s = store.getState();
      const camera = s.camera.registry[s.camera.activeId];
      const c = s.camera.calibration[s.camera.activeId] ?? camera?.defaults;
      if (camera === undefined || c === undefined) throw new Error("no camera");
      const patch = calibrationNudge(camera.lens, c, key, shift);
      if (patch !== null) s.actions.updateCalibration(patch);
    };
    nudge("ArrowRight", false);
    let c = store.getState().camera.calibration["synthetic-maunakea"];
    near(c?.rollDeg ?? Number.NaN, -179.95, 1e-9);
    expect(c?.azDeg).toBe(0);
    expect(c?.altDeg).toBe(90);
    nudge("ArrowDown", true);
    c = store.getState().camera.calibration["synthetic-maunakea"];
    expect(c?.altDeg).toBe(89.5);
    expect(fieldText(c?.altDeg ?? Number.NaN, 2)).toBe("89.50");
  });
});

describe("image time texts", () => {
  it("explains the stamp rule per camera", () => {
    expect(stampRuleText(nanaao)).toBe(
      "Type the stamp in Pacific/Honolulu time. It is to the minute; the image time is the stamp + 30 s.",
    );
    const exposing = {
      ...nanaao,
      site: { ...nanaao.site, timeZone: "Europe/Vaduz" },
      source: { ...nanaao.source, exposureSec: 60 },
    };
    expect(stampRuleText(exposing)).toBe(
      "Type the stamp in Europe/Vaduz time. It marks the start of the exposure; the image time is the stamp + 30 s, mid-exposure.",
    );
  });

  it("prefills the stamp the frame time implies, so resubmitting it keeps the frame time", () => {
    // Nānā ao stamps to the minute: frame 21:58:30 HST (stamp 21:58 + 30 s) → "21:58:00".
    const entered = Date.parse("2026-10-11T07:58:30Z");
    expect(impliedStampValue(nanaao, entered)).toBe("2026-10-10T21:58:00");
    expect(burnedInCaptureTimeMs(nanaao, impliedStampValue(nanaao, entered))).toBe(entered);
    // An estimated frame time (load − 40 s) prefills the minute before it.
    expect(impliedStampValue(nanaao, Date.parse("2026-10-11T07:59:20Z"))).toBe(
      "2026-10-10T21:58:00",
    );
    // A camera that stamps the exposure start, to the second (ASK053: 60 s, Europe/Vaduz).
    const exposing = {
      ...nanaao,
      site: { ...nanaao.site, timeZone: "Europe/Vaduz" },
      source: { ...nanaao.source, exposureSec: 60 },
    };
    const frame = Date.parse("2026-10-11T10:08:31Z"); // stamp "11-10-2026 12:08:01" + 30 s
    expect(impliedStampValue(exposing, frame)).toBe("2026-10-11T12:08:01");
    expect(burnedInCaptureTimeMs(exposing, impliedStampValue(exposing, frame))).toBe(frame);
  });

  it("formats an instant as a datetime-local value in the site's zone", () => {
    const t = Date.parse("2026-10-11T08:00:00Z");
    expect(zonedInputValue(t, "Pacific/Honolulu")).toBe("2026-10-10T22:00:00");
    expect(zonedInputValue(t, "Europe/Vaduz")).toBe("2026-10-11T10:00:00");
  });
});
