// tests/unit/demo.test.ts — the ?demo=1 tour (M9 step 10; section 5): the anchor pass on the committed snapshot, the
// pass choice, the GIBS note, and the runner on both paths with fake timers.
import { readFileSync } from "node:fs";
import { json2satrec } from "satellite.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enabledCameras } from "../../src/app/cameras";
import {
  chooseDemoPass,
  DEMO_LEAD_MS,
  DEMO_PASS_WINDOW_MS,
  DEMO_STEPS,
  type DemoSky,
  demoClip,
  demoContext,
  demoIntroState,
  demoStepNumber,
  goesWindowNote,
  loadDemoAnchorMs,
  startDemoRunner,
} from "../../src/app/demo";
import type { ObserverSite } from "../../src/domain/geo";
import { findPasses, ISS_NORAD_ID, type Pass, parseGpFile } from "../../src/domain/orbits";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";
import { type CameraConfig, DEMO_STEP_COUNT, type ObjectId } from "../../src/state/types";
import { committedCameras } from "../helpers/store";

const GP_DIR = new URL("../fixtures/gp/", import.meta.url);
const readGp = (file: string): string => readFileSync(new URL(file, GP_DIR), "utf8");
const CLIP_ID = "subaru-2026-10-11-iss";
const CLIP_START_MS = 1791731310183; // 2026-10-11T15:08:30.183Z, media 0
const ANCHOR_MS = Date.parse("2026-10-10T15:53:58Z");
const DAY_MS = 86_400_000;

const enabled = enabledCameras(committedCameras());
const maunakea = enabled[DEFAULT_CAMERA_ID];
if (maunakea === undefined) throw new Error("no synthetic-maunakea");
const SITE: ObserverSite = maunakea.site;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** fetch over tests/fixtures/gp/ for <base>data/gp/<file>; anything else is a 404. */
function fixtureFetch(base: string, requested: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const file = url.startsWith(`${base}data/gp/`) ? url.slice(`${base}data/gp/`.length) : "";
    if (file !== "stations.json" && file !== "meta.json") return new Response("", { status: 404 });
    return new Response(readGp(file), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const pass = (maxAltDeg: number, sunAltDegAtCulmination: number, culminationMs = 0): Pass => ({
  riseMs: culminationMs - 300_000,
  culminationMs,
  setMs: culminationMs + 300_000,
  maxAltDeg,
  sunlitAtCulmination: true,
  sunAltDegAtCulmination,
});

describe("the anchor pass on the committed snapshot (fetched 2026-10-11T03:50:21Z)", () => {
  it("chooseDemoPass picks culmination 2026-10-10T15:56:58Z at 67.24°, Sun −5.1°", () => {
    const meta = JSON.parse(readGp("meta.json")) as { stations: { fetchedAtMs: number } };
    const fetchedAtMs = meta.stations.fetchedAtMs;
    const omm = parseGpFile(JSON.parse(readGp("stations.json"))).find(
      (o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID,
    );
    if (omm === undefined) throw new Error("no ISS in the fixture");
    const passes = findPasses(
      json2satrec(omm),
      SITE,
      fetchedAtMs - DEMO_PASS_WINDOW_MS,
      fetchedAtMs,
      10_000,
      10,
    );
    expect(passes).toHaveLength(5); // five passes ≥ 10° in the window (M9 step 10)
    const chosen = chooseDemoPass(passes);
    expect(chosen).not.toBeNull();
    if (chosen === null) return;
    expect(Math.abs(chosen.culminationMs - Date.parse("2026-10-10T15:56:58Z"))).toBeLessThanOrEqual(
      2_000,
    );
    expect(Math.abs(chosen.maxAltDeg - 67.24)).toBeLessThanOrEqual(0.03);
    expect(chosen.sunlitAtCulmination).toBe(true);
    expect(Math.abs(chosen.sunAltDegAtCulmination - -5.1)).toBeLessThanOrEqual(0.2);
  });

  it("loadDemoAnchorMs fetches both files under the base and gives culmination − 180 s", async () => {
    const base = "https://example.test/Overhead/";
    const requested: string[] = [];
    const anchorMs = await loadDemoAnchorMs(base, SITE, fixtureFetch(base, requested));
    expect(requested.sort()).toEqual([`${base}data/gp/meta.json`, `${base}data/gp/stations.json`]);
    expect(Math.abs(anchorMs - ANCHOR_MS)).toBeLessThanOrEqual(2_000);
    expect(DEMO_LEAD_MS).toBe(180_000);
  });

  it("without a pass ≥ 10° the anchor is fetchedAtMs − 1 h", async () => {
    const base = "/Overhead/";
    const meta = JSON.parse(readGp("meta.json")) as { stations: { fetchedAtMs: number } };
    // The ISS's 51.6° orbit never rises 10° over the North Pole.
    const pole: ObserverSite = { latDeg: 89.9, lonDeg: 0, heightM: 0 };
    const anchorMs = await loadDemoAnchorMs(base, pole, fixtureFetch(base, []));
    expect(anchorMs).toBe(meta.stations.fetchedAtMs - 3_600_000);
  });

  it("never rejects: a failed fetch or a broken meta.json warns and gives Date.now() − 1 h", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const before = Date.now();
    const anchorMs = await loadDemoAnchorMs("/Overhead/", SITE, failing);
    expect(anchorMs).toBeGreaterThanOrEqual(before - 3_600_000);
    expect(anchorMs).toBeLessThanOrEqual(Date.now() - 3_600_000);
    const badMeta = (async (input: RequestInfo | URL) =>
      new Response(String(input).endsWith("meta.json") ? "{}" : readGp("stations.json"), {
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const anchor2 = await loadDemoAnchorMs("/Overhead/", SITE, badMeta);
    expect(Math.abs(anchor2 - (Date.now() - 3_600_000))).toBeLessThan(1_000);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("chooseDemoPass and goesWindowNote", () => {
  it("a pass ≥ 30° with the Sun ≤ 0° beats a higher daytime pass", () => {
    const night = pass(45, -5.1, 1);
    expect(chooseDemoPass([pass(80, 20, 2), night, pass(35, -20, 3)])).toBe(night);
    expect(chooseDemoPass([pass(80, 20, 2), pass(31, 0, 4)])?.culminationMs).toBe(4); // 0° counts
  });

  it("the highest wins when no pass ≥ 30° has the Sun down", () => {
    expect(chooseDemoPass([pass(40, 10, 1), pass(70, 5, 2), pass(29, -30, 3)])?.culminationMs).toBe(
      2,
    );
  });

  it("no pass ≥ 30°: the highest pass ≥ 10°; nothing ≥ 10°, or no pass: null", () => {
    expect(
      chooseDemoPass([pass(12, -10, 1), pass(25, 30, 2), pass(9, -40, 3)])?.culminationMs,
    ).toBe(2);
    expect(chooseDemoPass([pass(9.99, -10, 1)])).toBeNull();
    expect(chooseDemoPass([])).toBeNull();
  });

  it("goesWindowNote is empty at 89 days and the note at 91", () => {
    const now = Date.parse("2027-01-09T00:00:00Z");
    expect(goesWindowNote(now - 89 * DAY_MS, now)).toBe("");
    expect(goesWindowNote(now - 90 * DAY_MS, now)).toBe("");
    expect(goesWindowNote(now - 91 * DAY_MS, now)).toBe(
      " GIBS keeps geostationary imagery for 90 days, so this date has none.",
    );
  });
});

// ---- The runner ----

/** The enabled registry; with the clip loaded (videoUrl "blob:test") or not, with or without subaru-starcam. */
function registry(clipLoaded: boolean, live = true): Record<string, CameraConfig> {
  const out: Record<string, CameraConfig> = {};
  for (const [id, camera] of Object.entries(enabled)) {
    if (id === "subaru-starcam" && !live) continue;
    if (id === CLIP_ID && camera.kind === "local-video" && clipLoaded) {
      out[id] = {
        ...camera,
        source: { ...camera.source, videoUrl: "blob:test", startUtcMs: CLIP_START_MS },
      };
    } else {
      out[id] = camera;
    }
  }
  return out;
}

const issUp: DemoSky = { issAltDeg: () => 28.9, highestSunlit: () => null };

function tourStore(clipLoaded: boolean, live = true): AppStore {
  vi.useFakeTimers({ now: Date.parse("2026-10-11T15:20:00Z") });
  const store = createAppStore(initialState(CLIP_START_MS, DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(registry(clipLoaded, live));
  return store;
}

/** The fields the step table sets. */
function snapshot(store: AppStore) {
  const s = store.getState();
  return {
    step: s.ui.demo.step,
    camera: s.camera.activeId,
    mode: s.clock.mode,
    rate: s.clock.rate,
    playing: s.clock.playing,
    selectedId: s.selection.selectedId,
    panel: s.ui.panel,
  };
}

/** Advances exactly durationMs: one ms before it the step is unchanged. */
function runStep(store: AppStore, durationMs: number): void {
  const before = store.getState().ui.demo.step;
  vi.advanceTimersByTime(durationMs - 1);
  expect(store.getState().ui.demo.step).toBe(before);
  vi.advanceTimersByTime(1);
  expect(store.getState().ui.demo.step).toBe(before + 1);
}

const DURATIONS = DEMO_STEPS.map((s) => s.durationMs);

describe("DEMO_STEPS", () => {
  it("ten steps, as many as the store's setDemoStep allows; timed steps total 330 s", () => {
    expect(DEMO_STEPS.map((s) => s.id)).toEqual([
      "intro",
      "clip",
      "linked",
      "sensor",
      "ogc",
      "imagery",
      "architecture",
      "terrain",
      "live",
      "end",
    ]);
    expect(DEMO_STEPS).toHaveLength(DEMO_STEP_COUNT);
    expect(DURATIONS).toEqual([
      null,
      45_000,
      45_000,
      50_000,
      30_000,
      40_000,
      35_000,
      40_000,
      45_000,
      null,
    ]);
    // Steps 1–7 (the live step depends on the stream): 285 s, plus 45 s live is 330 s.
    expect(DURATIONS.reduce<number>((sum, d) => sum + (d ?? 0), 0)).toBe(330_000);
  });

  it("captions pick the clip text once the clip has loaded", () => {
    const clipCtx = demoContext(tourStore(true), ANCHOR_MS, issUp);
    const skyCtx = demoContext(tourStore(false), ANCHOR_MS, issUp);
    expect(clipCtx.clip).toEqual({ startUtcMs: CLIP_START_MS });
    expect(skyCtx.clip).toBeNull();
    const clipStep = DEMO_STEPS[1];
    expect(clipStep?.caption(clipCtx)).toMatch(
      /^The Subaru-Asahi StarCam on Maunakea, recorded on 2026-10-11/,
    );
    expect(clipStep?.caption(skyCtx)).toBe(
      "The computed sky over Maunakea at the time of a bright ISS pass. Every label comes from public orbital data; nothing is placed by hand.",
    );
    expect(DEMO_STEPS[9]?.caption(clipCtx)).toBe("End of the tour.");
    expect(DEMO_STEPS[5]?.caption(skyCtx)).toBe(
      "GOES-West infrared from NASA GIBS over WMTS. The Time dimension follows the clock in 10-minute steps.",
    );
  });

  it("the imagery caption adds the GIBS note for a sim time more than 90 days back", () => {
    const store = tourStore(false);
    store.getState().actions.recenter(Date.now() - 91 * DAY_MS);
    expect(DEMO_STEPS[5]?.caption(demoContext(store, ANCHOR_MS, issUp))).toMatch(
      / GIBS keeps geostationary imagery for 90 days, so this date has none\.$/,
    );
  });

  it("Step n of N counts timed steps that are not skipped: 8, or 7 without subaru-starcam", () => {
    const withLive = demoContext(tourStore(true), ANCHOR_MS, issUp);
    const noLive = demoContext(tourStore(true, false), ANCHOR_MS, issUp);
    expect(demoStepNumber(withLive, 0)).toBeNull();
    expect(demoStepNumber(withLive, 1)).toEqual({ n: 1, total: 8 });
    expect(demoStepNumber(withLive, 8)).toEqual({ n: 8, total: 8 });
    expect(demoStepNumber(withLive, 9)).toBeNull();
    expect(demoStepNumber(noLive, 7)).toEqual({ n: 7, total: 7 });
    expect(demoStepNumber(noLive, 8)).toBeNull();
  });

  it("demoClip and demoIntroState follow the clip camera's load", () => {
    const store = tourStore(false);
    const { actions } = store.getState();
    expect(demoIntroState(store.getState())).toBe("computed-sky");
    actions.setActiveCamera(CLIP_ID); // video status idle: M5's load has not started yet
    expect(demoIntroState(store.getState())).toBe("loading");
    actions.setVideoStatus("loading");
    expect(demoIntroState(store.getState())).toBe("loading");
    actions.setVideoStatus("error"); // "This clip is not part of this build."
    expect(demoIntroState(store.getState())).toBe("computed-sky");
    actions.setRegistry(registry(true));
    actions.setVideoStatus("paused");
    expect(demoClip(store.getState())).toEqual({ startUtcMs: CLIP_START_MS });
    expect(demoIntroState(store.getState())).toBe("clip");
  });
});

describe("startDemoRunner, clip path", () => {
  it("runs every step as the table says, each after exactly its duration, and never touches layers.video", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    const video = store.getState().layers.video;
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    expect(snapshot(store)).toMatchObject({
      step: 0,
      camera: CLIP_ID,
      mode: "replay",
      playing: false,
    });
    vi.advanceTimersByTime(3_600_000); // step 0 waits for the user
    expect(store.getState().ui.demo.step).toBe(0);

    actions.setDemoStep(1); // "Start the tour"
    expect(snapshot(store)).toEqual({
      step: 1,
      camera: CLIP_ID,
      mode: "replay",
      rate: 1,
      playing: true,
      selectedId: null,
      panel: null,
    });
    expect(store.getState().clock.simTimeMs).toBe(1791731370183); // media 60 s
    expect(store.getState().layers).toMatchObject({ satellites: true, trails: true });

    runStep(store, 45_000);
    expect(snapshot(store)).toMatchObject({ step: 2, selectedId: "sat:25544", playing: true });
    expect(store.getState().layers).toMatchObject({ footprint: true, footprintHeightKm: null });

    runStep(store, 45_000);
    expect(snapshot(store)).toMatchObject({ step: 3, playing: false, panel: "calibration" });

    runStep(store, 50_000);
    expect(snapshot(store)).toMatchObject({ step: 4, playing: false, panel: null });

    runStep(store, 30_000);
    expect(snapshot(store)).toMatchObject({ step: 5, rate: 1, playing: true, camera: CLIP_ID });
    expect(store.getState().layers.goesIr).toBe(true);

    runStep(store, 40_000);
    expect(snapshot(store)).toMatchObject({ step: 6, rate: 1, playing: true, camera: CLIP_ID });
    expect(store.getState().layers.starlink).toBe(true);

    const beforeTerrainMs = store.getState().clock.simTimeMs;
    runStep(store, 35_000);
    expect(snapshot(store)).toMatchObject({
      step: 7,
      camera: "synthetic-walenstadt",
      rate: 10,
      playing: true,
    });
    expect(store.getState().layers).toMatchObject({ horizon: true, hillshade: true });
    expect(store.getState().clock.simTimeMs).toBe(beforeTerrainMs); // no seek on the clip path

    runStep(store, 40_000);
    expect(snapshot(store)).toMatchObject({ step: 8, camera: "subaru-starcam", mode: "live" });
    actions.setVideoStatus("playing");
    vi.advanceTimersByTime(15_000); // playing: the live step runs its full 45 s
    expect(store.getState().ui.demo.step).toBe(8);
    vi.advanceTimersByTime(29_999);
    expect(store.getState().ui.demo.step).toBe(8);
    vi.advanceTimersByTime(1);
    expect(store.getState().ui.demo.step).toBe(9);

    vi.advanceTimersByTime(3_600_000); // the end waits for the user
    expect(store.getState().ui.demo).toEqual({ active: true, step: 9, paused: false });
    expect(store.getState().layers.video).toBe(video);
  });

  it("pause at 10 s keeps the remaining 35 s of step 1", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(1);
    vi.advanceTimersByTime(10_000);
    actions.setDemoPaused(true);
    vi.advanceTimersByTime(600_000);
    expect(store.getState().ui.demo.step).toBe(1);
    actions.setDemoPaused(false);
    runStep(store, 35_000);
  });

  it("Next while paused enters step 2 and holds its full duration until resume", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(1);
    vi.advanceTimersByTime(5_000);
    actions.setDemoPaused(true);
    actions.setDemoStep(2); // "Next"
    expect(store.getState().selection.selectedId).toBe("sat:25544"); // entered
    expect(store.getState().ui.demo.paused).toBe(true);
    vi.advanceTimersByTime(600_000);
    expect(store.getState().ui.demo.step).toBe(2);
    actions.setDemoPaused(false);
    runStep(store, 45_000);
  });

  it("stopDemo clears the timer, and the stop function unsubscribes", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    const stop = startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(1);
    expect(vi.getTimerCount()).toBe(1);
    actions.stopDemo();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(store.getState().ui.demo).toEqual({ active: false, step: 0, paused: false });

    stop();
    actions.startDemo();
    actions.setDemoStep(1);
    expect(vi.getTimerCount()).toBe(0); // no runner any more
    expect(store.getState().clock.rate).toBe(1); // and no enter
  });
});

describe("startDemoRunner, computed-sky path", () => {
  it("anchors steps 1 and 6 on anchorMs and seeks 3 h back for the terrain step", () => {
    const store = tourStore(false);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    expect(store.getState().camera.activeId).toBe(CLIP_ID); // the intro tries the clip; its load fails in the app

    actions.setDemoStep(1);
    expect(snapshot(store)).toEqual({
      step: 1,
      camera: "synthetic-maunakea",
      mode: "replay",
      rate: 10,
      playing: true,
      selectedId: null,
      panel: null,
    });
    expect(store.getState().clock.simTimeMs).toBe(ANCHOR_MS);
    expect(store.getState().clock.rangeCenterMs).toBe(ANCHOR_MS);

    runStep(store, 45_000);
    expect(snapshot(store)).toMatchObject({ step: 2, selectedId: "sat:25544" });
    runStep(store, 45_000);
    expect(snapshot(store)).toMatchObject({ step: 3, playing: false, panel: "calibration" });
    runStep(store, 50_000);
    runStep(store, 30_000);
    expect(snapshot(store)).toMatchObject({ step: 5, rate: 600, playing: true });
    actions.tick(ANCHOR_MS + 1_234_567); // the clock moved on meanwhile
    runStep(store, 40_000);
    expect(snapshot(store)).toMatchObject({
      step: 6,
      camera: "synthetic-maunakea",
      rate: 60,
      playing: true,
    });
    expect(store.getState().clock.simTimeMs).toBe(ANCHOR_MS);
    expect(store.getState().layers.starlink).toBe(true);
    runStep(store, 35_000);
    expect(snapshot(store)).toMatchObject({
      step: 7,
      camera: "synthetic-walenstadt",
      rate: 10,
      playing: true,
    });
    expect(store.getState().clock.simTimeMs).toBe(ANCHOR_MS - 10_800_000);
  });

  it("the linked step falls back to the highest drawn sunlit satellite, else leaves the selection", () => {
    const fallback: DemoSky = { issAltDeg: () => -3, highestSunlit: () => "sat:40069" as ObjectId };
    const store = tourStore(false);
    startDemoRunner(store, ANCHOR_MS, fallback);
    store.getState().actions.startDemo();
    store.getState().actions.setDemoStep(2);
    expect(store.getState().selection.selectedId).toBe("sat:40069");

    const nothing: DemoSky = { issAltDeg: () => null, highestSunlit: () => null };
    const store2 = tourStore(false);
    store2.getState().actions.select("moon");
    startDemoRunner(store2, ANCHOR_MS, nothing);
    store2.getState().actions.startDemo();
    store2.getState().actions.setDemoStep(2);
    expect(store2.getState().selection.selectedId).toBe("moon");
  });
});

describe("the live step", () => {
  it("without subaru-starcam the runner passes from step 7 to step 9 without enter, and back with Previous", () => {
    const store = tourStore(false, false);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(7);
    expect(store.getState().camera.activeId).toBe("synthetic-walenstadt");
    vi.advanceTimersByTime(39_999);
    expect(store.getState().ui.demo.step).toBe(7);
    vi.advanceTimersByTime(1); // 7 → 8, which skip passes over, straight on to 9
    expect(store.getState().ui.demo.step).toBe(9);
    expect(store.getState().clock.mode).toBe("replay"); // the live step's setMode("live") never ran
    actions.setDemoStep(8); // "Previous" from the end
    expect(store.getState().ui.demo.step).toBe(7);
    expect(vi.getTimerCount()).toBe(1); // step 7's timer, entered again
  });

  it("embed-blocked moves to step 9 at once", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(8);
    expect(snapshot(store)).toMatchObject({ step: 8, camera: "subaru-starcam", mode: "live" });
    actions.setVideoStatus("loading");
    expect(store.getState().ui.demo.step).toBe(8);
    actions.setVideoStatus("embed-blocked", 150);
    expect(store.getState().ui.demo.step).toBe(9);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an error moves to step 9 at once too", () => {
    const store = tourStore(false);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(8);
    actions.setVideoStatus("error");
    expect(store.getState().ui.demo.step).toBe(9);
  });

  it("with the status left idle the runner moves on after 15,000 ms", () => {
    const store = tourStore(true);
    const { actions } = store.getState();
    startDemoRunner(store, ANCHOR_MS, issUp);
    actions.startDemo();
    actions.setDemoStep(8);
    expect(store.getState().video.status).toBe("idle");
    vi.advanceTimersByTime(14_999);
    expect(store.getState().ui.demo.step).toBe(8);
    vi.advanceTimersByTime(1);
    expect(store.getState().ui.demo.step).toBe(9);
  });
});
