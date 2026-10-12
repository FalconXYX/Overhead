// src/app/persist.ts (M4 step 8 and step 14.6): localStorage through a Map-backed Storage and throwing stubs,
// calibration files, and the GeoPose export and import payloads.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserStorage,
  buildCalibrationFile,
  buildGeoPoseExport,
  CALIBRATION_STORAGE_KEY,
  type CalibrationFileV1,
  calibrationFileName,
  downloadJsonFile,
  GEOPOSE_CONVENTION,
  GEOPOSE_HEIGHT_DATUM,
  geoPoseFileName,
  loadCalibrations,
  parseCalibrationFile,
  parseGeoPoseImport,
  restoreCalibrations,
  type StorageLike,
  startCalibrationPersistence,
} from "../../src/app/persist";
import { type Calibration, toGeoPose, validateGeoPose } from "../../src/domain/camera";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import type { CameraConfig } from "../../src/state/types";
import { committedCameras } from "../helpers/store";

const NOW = Date.parse("2026-10-11T08:00:00Z");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The Storage stub of the section 5 row. */
class MapStorage implements StorageLike {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.map.set(key, String(value));
  }
}

const throwingGet: StorageLike = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {},
};
const throwingSet: StorageLike = {
  getItem: () => null,
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

const registry = (): Record<string, CameraConfig> => committedCameras();

function camera(id: string): CameraConfig {
  const c = registry()[id];
  if (c === undefined) throw new Error(`no camera ${id}`);
  return c;
}

function newStore(activeId = "cfht-nanaao"): AppStore {
  const store = createAppStore(initialState(NOW, DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(registry());
  store.getState().actions.setActiveCamera(activeId);
  return store;
}

function stored(record: unknown): MapStorage {
  const storage = new MapStorage();
  storage.map.set(CALIBRATION_STORAGE_KEY, JSON.stringify(record));
  return storage;
}

describe("loadCalibrations", () => {
  const nanaao = camera("cfht-nanaao").defaults;
  const synth = camera("synthetic-maunakea").defaults;

  it("keeps valid entries of registry cameras, with exactly the 12 fields", () => {
    const record = {
      "cfht-nanaao": { ...nanaao, azDeg: 227.35, updatedAtMs: 7, extra: "dropped" },
      "synthetic-maunakea": { ...synth, rollDeg: -179.95 },
    };
    const loaded = loadCalibrations(stored(record), registry());
    expect(Object.keys(loaded)).toEqual(["cfht-nanaao", "synthetic-maunakea"]);
    expect(loaded["cfht-nanaao"]).toEqual({ ...nanaao, azDeg: 227.35, updatedAtMs: 7 });
    expect(loaded["synthetic-maunakea"]?.rollDeg).toBe(-179.95);
  });

  it("drops unknown ids, wrong types and invalid distortion", () => {
    const record = {
      "no-such-camera": nanaao,
      "cfht-nanaao": { ...nanaao, k1: -0.5 }, // fails distortionValid on the 1232² frame
      "synthetic-maunakea": { ...synth, flipX: "yes" },
      "synthetic-walenstadt": { ...synth, rmsDeg: "0.1" },
      "subaru-starcam": { ...camera("subaru-starcam").defaults, focalPx: null },
      "cfht-starcam": { ...camera("cfht-starcam").defaults, k2: undefined },
    };
    expect(loadCalibrations(stored(record), registry())).toEqual({});
    const missingField: Record<string, unknown> = { ...nanaao };
    delete missingField.streamDelayMs;
    expect(loadCalibrations(stored({ "cfht-nanaao": missingField }), registry())).toEqual({});
    expect(
      loadCalibrations(stored({ "cfht-nanaao": { ...nanaao, focalPx: 0 } }), registry()),
    ).toEqual({});
  });

  it("malformed or missing values and throwing stubs give defaults and no exception", () => {
    const corrupt = new MapStorage();
    corrupt.map.set(CALIBRATION_STORAGE_KEY, "{not json");
    expect(loadCalibrations(corrupt, registry())).toEqual({});
    expect(loadCalibrations(stored([nanaao]), registry())).toEqual({});
    expect(loadCalibrations(stored(null), registry())).toEqual({});
    expect(loadCalibrations(stored({ "cfht-nanaao": 5 }), registry())).toEqual({});
    expect(loadCalibrations(new MapStorage(), registry())).toEqual({});
    expect(loadCalibrations(throwingGet, registry())).toEqual({});
    expect(loadCalibrations(null, registry())).toEqual({});
  });

  it("only cameras in the given registry: the store holds the enabled ones", () => {
    const loaded = loadCalibrations(stored({ "cfht-nanaao": nanaao }), {
      "synthetic-maunakea": camera("synthetic-maunakea"),
    });
    expect(loaded).toEqual({});
  });
});

describe("restoreCalibrations and startCalibrationPersistence", () => {
  it("restores stored entries through importCalibration (normalized)", () => {
    const store = newStore();
    const synth = camera("synthetic-maunakea").defaults;
    const storage = stored({
      "synthetic-maunakea": { ...synth, azDeg: 37 }, // a locked fisheye: folded into roll
      "cfht-nanaao": camera("cfht-nanaao").defaults,
    });
    expect(restoreCalibrations(store, storage)).toBe(2);
    const c = store.getState().camera.calibration;
    expect(c["synthetic-maunakea"]?.azDeg).toBe(0);
    expect(c["synthetic-maunakea"]?.rollDeg).toBeCloseTo(143, 9);
    const { rollDeg, ...rest } = camera("cfht-nanaao").defaults;
    expect(c["cfht-nanaao"]).toMatchObject(rest);
    expect(c["cfht-nanaao"]?.rollDeg).toBeCloseTo(rollDeg, 12); // wrap180 rounding (G17)
    expect(restoreCalibrations(store, throwingGet)).toBe(0);
  });

  it("writes the whole record on every calibration change, never on subscribe or other changes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const store = newStore();
    const storage = new MapStorage();
    const stop = startCalibrationPersistence(store, storage);
    expect(storage.writes).toBe(0);
    const { actions } = store.getState();
    actions.tick(NOW + 16);
    actions.setCameraStatus("cfht-nanaao", "live");
    expect(storage.writes).toBe(0);
    actions.updateCalibration({ azDeg: 227.35 });
    expect(storage.writes).toBe(1);
    const written = JSON.parse(storage.getItem(CALIBRATION_STORAGE_KEY) ?? "null") as Record<
      string,
      Calibration
    >;
    expect(written).toEqual(store.getState().camera.calibration);
    expect(written["cfht-nanaao"]?.azDeg).toBeCloseTo(227.35, 12);
    actions.updateCalibration({ k1: -0.5 }); // refused: no change, no write
    expect(storage.writes).toBe(1);
    actions.resetCalibration();
    expect(storage.writes).toBe(2);
    expect(storage.getItem(CALIBRATION_STORAGE_KEY)).toBe("{}");
    // A reload: the stored value round-trips.
    actions.updateCalibration({ azDeg: 227.35 });
    const reloaded = newStore();
    restoreCalibrations(reloaded, storage);
    expect(reloaded.getState().camera.calibration).toEqual(store.getState().camera.calibration);
    stop();
    actions.updateCalibration({ azDeg: 1 });
    expect(storage.writes).toBe(3);
  });

  it("a throwing setItem or no storage at all is ignored", () => {
    const store = newStore();
    const stopA = startCalibrationPersistence(store, throwingSet);
    const stopB = startCalibrationPersistence(store, null);
    expect(() => store.getState().actions.updateCalibration({ rollDeg: 40 })).not.toThrow();
    expect(store.getState().camera.calibration["cfht-nanaao"]?.rollDeg).toBe(40);
    stopA();
    stopB();
  });

  it("browserStorage is null without a window, and when reading localStorage throws", () => {
    expect(browserStorage()).toBeNull();
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(browserStorage()).toBeNull();
    const storage = new MapStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(browserStorage()).toBe(storage);
  });
});

describe("calibration files", () => {
  function exported(): CalibrationFileV1 {
    const store = newStore();
    const { actions } = store.getState();
    actions.setFrameTimeMs(NOW - 40_000);
    actions.addImagePoint(612.4, 433);
    actions.completePair("star:424");
    actions.addImagePoint(700.5, 500.25);
    actions.completePair("planet:Saturn");
    actions.setPairRole(1, "holdout");
    const file = buildCalibrationFile(store.getState(), NOW);
    if (file === null) throw new Error("expected a file");
    return file;
  }

  it("buildCalibrationFile: the active camera, its current calibration, frame time and pairs", () => {
    const file = exported();
    expect(file).toEqual({
      format: "overhead.calibration",
      version: 1,
      exportedAtMs: NOW,
      cameraId: "cfht-nanaao",
      lens: "fisheye-equidistant",
      imageSize: { widthPx: 1232, heightPx: 1232 },
      frameTimeMs: NOW - 40_000,
      calibration: camera("cfht-nanaao").defaults,
      pairs: [
        { imagePx: [612.4, 433], targetId: "star:424", role: "fit" },
        { imagePx: [700.5, 500.25], targetId: "planet:Saturn", role: "holdout" },
      ],
    });
    const empty = createAppStore(initialState(NOW, DEFAULT_CAMERA_ID));
    expect(buildCalibrationFile(empty.getState(), NOW)).toBeNull();
  });

  it("export → JSON → parse round-trips, from text or from the parsed value", () => {
    const file = exported();
    const text = JSON.stringify(file, null, 2);
    expect(parseCalibrationFile(text, registry())).toEqual({ ok: true, file });
    expect(parseCalibrationFile(JSON.parse(text), registry())).toEqual({ ok: true, file });
  });

  it("a file with another lens or size is rejected with a message naming it", () => {
    const file = exported();
    const lens = parseCalibrationFile({ ...file, lens: "rectilinear" }, registry());
    expect(lens).toEqual({
      ok: false,
      errors: [
        'lens "rectilinear" does not match CFHT Nānā ao all-sky (visible), whose lens is "fisheye-equidistant"',
      ],
    });
    const size = parseCalibrationFile(
      { ...file, imageSize: { widthPx: 256, heightPx: 256 } },
      registry(),
    );
    expect(size).toEqual({
      ok: false,
      errors: [
        "imageSize 256 × 256 px does not match CFHT Nānā ao all-sky (visible), which is 1232 × 1232 px",
      ],
    });
  });

  it("lists every problem: format, version, camera, types, distortion and pairs", () => {
    const file = exported();
    const result = parseCalibrationFile(
      {
        ...file,
        format: "other",
        version: 2,
        exportedAtMs: "now",
        frameTimeMs: Number.NaN,
        calibration: { ...file.calibration, azDeg: "1", flipX: 1, rmsDeg: undefined },
        pairs: [
          { imagePx: [1], targetId: "star:0", role: "fit" },
          { imagePx: [1, 2], targetId: "planet:Pluto", role: "other" },
          5,
        ],
      },
      registry(),
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'format must be "overhead.calibration"',
        "version must be 1",
        "exportedAtMs must be a finite number",
        "frameTimeMs must be a number or null",
        "calibration.azDeg must be a finite number",
        "calibration.flipX must be a boolean",
        "calibration.rmsDeg must be a number or null",
        "pairs[0].imagePx must be [u, v] in finite pixels",
        'pairs[0].targetId must be "star:<HR 1–9110>" or "planet:<name>"',
        'pairs[1].targetId must be "star:<HR 1–9110>" or "planet:<name>"',
        'pairs[1].role must be "fit" or "holdout"',
        "pairs[2] must be an object",
      ],
    });
  });

  it("rejects an unknown camera, an invalid distortion, non-JSON and non-objects", () => {
    const file = exported();
    expect(parseCalibrationFile({ ...file, cameraId: "nope" }, registry())).toEqual({
      ok: false,
      errors: ['cameraId "nope" is not a camera in this app'],
    });
    const bad = parseCalibrationFile(
      { ...file, calibration: { ...file.calibration, k1: -0.5 } },
      registry(),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(1);
    expect(parseCalibrationFile("{", registry())).toEqual({
      ok: false,
      errors: ["The file is not valid JSON."],
    });
    expect(parseCalibrationFile([file], registry())).toEqual({
      ok: false,
      errors: ["The file is not a JSON object."],
    });
    expect(parseCalibrationFile({ ...file, pairs: undefined }, registry())).toEqual({
      ok: false,
      errors: ["pairs must be an array"],
    });
  });

  it("file names", () => {
    expect(calibrationFileName("cfht-nanaao", Date.parse("2026-10-11T08:05:09.700Z"))).toBe(
      "overhead-calibration-cfht-nanaao-20261011T080509Z.json",
    );
    expect(geoPoseFileName("cfht-nanaao")).toBe("geopose-cfht-nanaao.json");
  });

  it("downloadJsonFile: a Blob, an object URL, a clicked <a download>, then the URL is revoked", async () => {
    vi.useFakeTimers();
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append } });
    let blob: Blob | null = null;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blob = b as Blob;
      return "blob:overhead/1";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    downloadJsonFile("geopose-cfht-nanaao.json", { a: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(anchor).toMatchObject({ href: "blob:overhead/1", download: "geopose-cfht-nanaao.json" });
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:overhead/1");
    expect(blob).not.toBeNull();
    const saved = blob as unknown as Blob;
    expect(saved.type).toBe("application/json");
    expect(JSON.parse(await saved.text())).toEqual({ a: 1 });
  });
});

describe("GeoPose export and import", () => {
  it("cfht-nanaao defaults: yaw −137.3, pitch −88.26, roll 44.8 at (19.8253, −155.4689, 4228.23); valid", async () => {
    const nanaao = camera("cfht-nanaao");
    const result = await buildGeoPoseExport(nanaao, nanaao.defaults);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pose } = result;
    expect(pose.position.lat).toBe(19.8253);
    expect(pose.position.lon).toBe(-155.4689);
    expect(pose.position.h).toBeCloseTo(4228.23, 9);
    expect(pose.angles.yaw).toBeCloseTo(-137.3, 9);
    expect(pose.angles.pitch).toBeCloseTo(-88.26, 9);
    expect(pose.angles.roll).toBeCloseTo(44.8, 9);
    const expected = toGeoPose(19.8253, -155.4689, 4204 + 24.23, nanaao.defaults, false);
    expect(pose.angles).toEqual(expected.angles);
    expect(pose["x-overhead"]).toEqual({
      cameraId: "cfht-nanaao",
      lens: "fisheye-equidistant",
      convention: GEOPOSE_CONVENTION,
      heightDatum: GEOPOSE_HEIGHT_DATUM,
    });
    // What the download holds validates on its own (the schema allows the extra member).
    expect((await validateGeoPose(JSON.parse(JSON.stringify(pose)))).ok).toBe(true);
  });

  it("a zenith-locked camera with a stale azDeg 37 exports yaw 90 (G8)", async () => {
    const synth = camera("synthetic-maunakea");
    const result = await buildGeoPoseExport(synth, { ...synth.defaults, azDeg: 37 });
    expect(result.ok && result.pose.angles).toEqual({ yaw: 90, pitch: -90, roll: 180 - 360 });
  });

  it("a site outside the schema's ranges fails validation and nothing is built", async () => {
    const nanaao = camera("cfht-nanaao");
    const broken = { ...nanaao, site: { ...nanaao.site, latDeg: 999 } };
    expect(await buildGeoPoseExport(broken, nanaao.defaults)).toEqual({
      ok: false,
      errors: ["/position/lat must be in [-90, 90]"],
    });
  });

  it("import round-trips the pointing of an export, with no warning at the site", async () => {
    const nanaao = camera("cfht-nanaao");
    const result = await buildGeoPoseExport(nanaao, nanaao.defaults);
    if (!result.ok) throw new Error("export failed");
    const back = await parseGeoPoseImport(JSON.stringify(result.pose), nanaao);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.warnings).toEqual([]);
    expect(back.pointing.azDeg).toBeCloseTo(227.3, 9);
    expect(back.pointing.altDeg).toBeCloseTo(88.26, 9);
    expect(back.pointing.rollDeg).toBeCloseTo(44.8, 9);
  });

  it("import warns beyond 0.01° or 100 m from the site, and still gives the angles", async () => {
    const nanaao = camera("cfht-nanaao");
    const pose = {
      position: { lat: 19.85, lon: -155.4689, h: 4100 },
      angles: { yaw: 90, pitch: -90, roll: 10 },
    };
    const result = await parseGeoPoseImport(pose, nanaao);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/^The pose's position is 0\.0247° in latitude/);
    expect(result.warnings[1]).toMatch(/^The pose's height is 128 m from/);
    expect(result.pointing).toEqual({ azDeg: 0, altDeg: 90, rollDeg: 10 });
  });

  it("import shows the schema errors and applies nothing", async () => {
    const nanaao = camera("cfht-nanaao");
    expect(
      await parseGeoPoseImport({ location: {}, angles: { yaw: 0, pitch: 0, roll: 0 } }, nanaao),
    ).toEqual({ ok: false, errors: ["/ must have required property 'position'"] });
    expect(await parseGeoPoseImport("not json", nanaao)).toEqual({
      ok: false,
      errors: ["The file is not valid JSON."],
    });
  });
});
