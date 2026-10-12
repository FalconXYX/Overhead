// src/app/demo.ts — the ?demo=1 tour (M9 step 10): its steps as data, the computed-sky anchor time and the runner.
// Lazy-loaded: main.tsx imports it only for ?demo=1, and DemoCaptions (its region) is a lazy chunk too. The tour opens
// on the recorded 2026-10-11 ISS clip where the build serves it (O1, O2), else it runs the same steps on the computed
// sky from an ISS pass in the element sets' own 48 h (gotcha 14), and it ends on the live Subaru StarCam.
import { json2satrec } from "satellite.js";
import type { ObserverSite } from "../domain/geo";
import { findPasses, GP_GROUPS, ISS_NORAD_ID, type Pass, parseGpFile } from "../domain/orbits";
import { ephemeris } from "../state/ephemeris";
import type { AppStore } from "../state/store";
import type { AppState, ObjectId } from "../state/types";
import { activateCamera } from "./activateCamera";

export type DemoStepId =
  | "intro"
  | "clip"
  | "linked"
  | "sensor"
  | "ogc"
  | "imagery"
  | "architecture"
  | "terrain"
  | "live"
  | "end";

/**
 * [M9] What the "linked" step reads from the frame on screen: the ephemeris in the app, a fake in unit tests (Node has
 * no propagation worker). Not in the doc's declaration block; the steps' enter reads only the store and this.
 */
export interface DemoSky {
  /** The ISS's apparent altitude in the current frame, or null while it has no position. */
  issAltDeg(): number | null;
  /** The highest sunlit satellite drawn in the sky now (valid, not docked, apparent alt > 0, its layer on), or null. */
  highestSunlit(state: AppState): ObjectId | null;
}

export interface DemoContext {
  readonly store: AppStore;
  readonly anchorMs: number; // computed-sky fallback: ISS culmination − 180 s
  readonly clip: { readonly startUtcMs: number } | null; // the recorded clip, once loaded; null when this build lacks it
  readonly nowMs: number;
  readonly sky: DemoSky; // [M9] the "linked" step's selection
}

export interface DemoStep {
  readonly id: DemoStepId;
  readonly durationMs: number | null; // null: waits for the user
  caption(ctx: DemoContext): string;
  skip?(ctx: DemoContext): boolean; // true: the runner passes over this step
  enter(ctx: DemoContext): void; // store actions only
}

export const DEMO_PASS_WINDOW_MS = 172_800_000;
export const DEMO_LEAD_MS = 180_000;

/** Step 1 seeks the clip to media 60 s: 18.7 s before the ISS enters at the right edge (media 78.7 s). */
const DEMO_CLIP_SEEK_MS = 60_000;
/** The live step ends at once when the player is not playing this long after enter. */
const DEMO_LIVE_WAIT_MS = 15_000;
const CLIP_CAMERA_ID = "subaru-2026-10-11-iss";
const LIVE_CAMERA_ID = "subaru-starcam";
const SKY_CAMERA_ID = "synthetic-maunakea";
const TERRAIN_CAMERA_ID = "ask053-walenstadt";
const TERRAIN_FALLBACK_ID = "synthetic-walenstadt";
/** The computed-sky terrain step starts 3 h before the anchor: the Sun is at 31.4° at Walenstadt then. */
const TERRAIN_SEEK_BACK_MS = 10_800_000;
/** Without a pass: an hour before the snapshot (loadDemoAnchorMs) or before now (its failure). */
const FALLBACK_LEAD_MS = 3_600_000;
const PASS_STEP_MS = 10_000;
const PASS_MIN_ALT_DEG = 10;
const PASS_GOOD_ALT_DEG = 30;
const GIBS_GEOSTATIONARY_DAYS_MS = 90 * 86_400_000;
/** SatFrame.flags bits (ephemeris.ts): 0 valid, 1 sunlit. */
const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;

const hasCamera = (ctx: DemoContext, id: string): boolean =>
  Object.hasOwn(ctx.store.getState().camera.registry, id);

/** Through activateCamera (M5: the mode a video camera needs), and only when another camera is active. */
function showCamera(ctx: DemoContext, id: string): void {
  if (ctx.store.getState().camera.activeId !== id) activateCamera(ctx.store, id);
}

/** The text that names a path's caption: the clip text when the clip has loaded. */
const byPath =
  (clipText: string, skyText: string) =>
  (ctx: DemoContext): string =>
    ctx.clip === null ? skyText : clipText;
const same = (text: string) => (): string => text;

export const DEMO_STEPS: readonly DemoStep[] = [
  {
    id: "intro",
    durationMs: null,
    caption: same(
      "A guided tour of Overhead: satellites, the ISS, the Moon, planets and bright stars, computed and drawn over a sky camera, with the same moment on a ground map.",
    ),
    // M5 loads the sidecar and the clip and recentres on media 0, paused; where the clip is missing the load fails.
    enter(ctx) {
      if (hasCamera(ctx, CLIP_CAMERA_ID)) showCamera(ctx, CLIP_CAMERA_ID);
    },
  },
  {
    id: "clip",
    durationMs: 45_000,
    caption: byPath(
      "The Subaru-Asahi StarCam on Maunakea, recorded on 2026-10-11 at 15:09 UTC. The overlay is computed from public orbital elements and a star catalogue through this camera's lens model; nothing is placed by hand. The ISS enters from the right in about 20 seconds.",
      "The computed sky over Maunakea at the time of a bright ISS pass. Every label comes from public orbital data; nothing is placed by hand.",
    ),
    enter(ctx) {
      const { actions } = ctx.store.getState();
      if (ctx.clip !== null) {
        showCamera(ctx, CLIP_CAMERA_ID);
        actions.seek(ctx.clip.startUtcMs + DEMO_CLIP_SEEK_MS);
        actions.setRate(1);
      } else {
        showCamera(ctx, SKY_CAMERA_ID);
        actions.recenter(ctx.anchorMs);
        actions.setRate(10); // 10×, not 60×: the incoming chip pauses at 60× and 600× (M8)
      }
      actions.play();
      actions.setLayer("satellites", true);
      actions.setLayer("trails", true);
    },
  },
  {
    id: "linked",
    durationMs: 45_000,
    caption: same(
      "Select an object on the video or on the map, and the other view highlights it on the next frame. The video keeps a light overlay; the ground map carries the detail: the ground track, the camera's view at the satellite's height, and the next satellite to enter the frame.",
    ),
    enter(ctx) {
      const { actions } = ctx.store.getState();
      const issAltDeg = ctx.sky.issAltDeg();
      const id: ObjectId | null =
        issAltDeg !== null && issAltDeg > 0
          ? `sat:${ISS_NORAD_ID}`
          : ctx.sky.highestSunlit(ctx.store.getState());
      if (id !== null) actions.select(id);
      actions.setLayer("footprint", true);
      actions.setFootprintHeightKm(null);
    },
  },
  {
    id: "sensor",
    durationMs: 50_000,
    caption: byPath(
      "A lens is a map projection: rectilinear is gnomonic, a fisheye is azimuthal. On this clip, 73 stars fixed the pointing to 0.04°, and the camera's burned-in clock agrees with the ISS to 0.3 s.",
      "A lens is a map projection: rectilinear is gnomonic, a fisheye is azimuthal. Stars fix the pointing; a fast satellite fixes the clock.",
    ),
    enter(ctx) {
      const { actions } = ctx.store.getState();
      actions.pause();
      actions.openPanel("calibration");
    },
  },
  {
    id: "ogc",
    durationMs: 30_000,
    caption: same(
      "The camera pose as OGC GeoPose 1.0 Basic-YPR, validated against the official schema.",
    ),
    // The region shows the active camera's GeoPose and its validation (DemoCaptions).
    enter(ctx) {
      ctx.store.getState().actions.openPanel(null);
    },
  },
  {
    id: "imagery",
    durationMs: 40_000,
    caption: (ctx) =>
      `GOES-West infrared from NASA GIBS over WMTS. The Time dimension follows the clock in 10-minute steps.${goesWindowNote(
        ctx.store.getState().clock.simTimeMs,
        ctx.nowMs,
      )}`,
    enter(ctx) {
      const { actions } = ctx.store.getState();
      actions.setLayer("goesIr", true);
      actions.setRate(ctx.clip === null ? 600 : 1); // a clip offers only 1× and 10× (M5)
      actions.play();
    },
  },
  {
    id: "architecture",
    durationMs: 35_000,
    caption: byPath(
      "Starlink is on: about 11,100 satellites move on the ground map while the video keeps its light overlay. Two maps, one clock: orbits run in a Web Worker, and React re-renders four times a second.",
      "Two maps, one clock. Orbits run in a Web Worker; about 11,300 satellites move at 60 fps, and React re-renders four times a second.",
    ),
    enter(ctx) {
      const { actions } = ctx.store.getState();
      if (ctx.clip === null) {
        showCamera(ctx, SKY_CAMERA_ID);
        actions.recenter(ctx.anchorMs);
        actions.setRate(60);
      } else {
        actions.setRate(1); // the clip reaches media 225 s at the end of this step, before the dome at 228 s
      }
      actions.setLayer("starlink", true);
      actions.play();
    },
  },
  {
    id: "terrain",
    durationMs: 40_000,
    caption: same(
      "The skyline is computed from elevation tiles: the Churfirsten wall to the north rises about 33°. The hillshade is lit by the Sun at the clock time; at night it uses a fixed light.",
    ),
    enter(ctx) {
      const { actions } = ctx.store.getState();
      showCamera(ctx, hasCamera(ctx, TERRAIN_CAMERA_ID) ? TERRAIN_CAMERA_ID : TERRAIN_FALLBACK_ID);
      actions.setLayer("horizon", true);
      actions.setLayer("hillshade", true);
      // Step 6 played 35 s at 60× from the anchor: without this seek the Sun would be setting at Walenstadt.
      if (ctx.clip === null) actions.seek(ctx.anchorMs - TERRAIN_SEEK_BACK_MS);
      actions.setRate(10);
      actions.play();
    },
  },
  {
    id: "live",
    durationMs: 45_000,
    caption: same(
      "The live Subaru StarCam, with the same light overlay drawn on the YouTube player. The stream runs about 50 seconds behind real time; the Calibration panel's stream-delay control sets the offset.",
    ),
    skip: (ctx) => !hasCamera(ctx, LIVE_CAMERA_ID),
    // The runner ends this step early when the player is blocked, fails, or is not playing after 15 s.
    enter(ctx) {
      showCamera(ctx, LIVE_CAMERA_ID);
      ctx.store.getState().actions.setMode("live");
    },
  },
  {
    id: "end",
    durationMs: null,
    caption: same("End of the tour."),
    // DemoCaptions offers "Restart tour" (setDemoStep(0)) and "Exit tour" (stopDemo()).
    enter() {},
  },
];

/** The store's setDemoStep clamps to DEMO_STEP_COUNT − 1 (types.ts) without importing this lazy module. */
const END_STEP = DEMO_STEPS.length - 1;

/**
 * [M9] The recorded clip's start (rule 2): the registry's subaru-2026-10-11-iss is a local-video camera whose clip has
 * loaded (videoUrl and startUtcMs set); else null.
 */
export function demoClip(state: AppState): { readonly startUtcMs: number } | null {
  const entry = state.camera.registry[CLIP_CAMERA_ID];
  if (entry?.kind !== "local-video") return null;
  const { videoUrl, startUtcMs } = entry.source;
  return videoUrl === null || startUtcMs === null ? null : { startUtcMs };
}

/**
 * [M9] The intro's state: "clip" once the clip has loaded; "loading" while the clip camera is active and its clip has
 * neither loaded nor failed (video status idle, before M5's load starts, or loading); else "computed-sky".
 */
export function demoIntroState(state: AppState): "clip" | "loading" | "computed-sky" {
  if (demoClip(state) !== null) return "clip";
  const loading =
    state.camera.activeId === CLIP_CAMERA_ID &&
    (state.video.status === "idle" || state.video.status === "loading");
  return loading ? "loading" : "computed-sky";
}

/** [M9] "Step n of N" on a timed step that skip does not pass over (N: 8, or 7 without subaru-starcam); else null. */
export function demoStepNumber(
  ctx: DemoContext,
  step: number,
): { readonly n: number; readonly total: number } | null {
  let n = 0;
  let total = 0;
  for (const [i, s] of DEMO_STEPS.entries()) {
    if (s.durationMs === null || s.skip?.(ctx) === true) continue;
    total += 1;
    if (i <= step) n += 1;
  }
  const current = DEMO_STEPS[step];
  return current === undefined || current.durationMs === null || current.skip?.(ctx) === true
    ? null
    : { n, total };
}

/** Passes ≥ 30° first; among them prefer Sun ≤ 0° at culmination; then the highest; null when none ≥ 10°. */
export function chooseDemoPass(passes: readonly Pass[]): Pass | null {
  const highest = (list: readonly Pass[]): Pass | null =>
    list.reduce<Pass | null>(
      (best, p) => (best === null || p.maxAltDeg > best.maxAltDeg ? p : best),
      null,
    );
  const good = passes.filter((p) => p.maxAltDeg >= PASS_GOOD_ALT_DEG);
  if (good.length === 0) return highest(passes.filter((p) => p.maxAltDeg >= PASS_MIN_ALT_DEG));
  const dark = good.filter((p) => p.sunAltDegAtCulmination <= 0);
  return highest(dark.length > 0 ? dark : good);
}

async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/** meta.json's stations.fetchedAtMs, or an Error. */
function stationsFetchedAtMs(meta: unknown): number {
  const stations =
    typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>).stations : null;
  const fetchedAtMs =
    typeof stations === "object" && stations !== null
      ? (stations as Record<string, unknown>).fetchedAtMs
      : null;
  if (typeof fetchedAtMs !== "number" || !Number.isFinite(fetchedAtMs)) {
    throw new Error("meta.json has no stations.fetchedAtMs");
  }
  return fetchedAtMs;
}

/**
 * Fetches gp/stations.json and gp/meta.json under baseUrl (the app's base, import.meta.env.BASE_URL), runs findPasses
 * for 25544 over [fetchedAtMs − 48 h, fetchedAtMs] and returns the chosen culmination − 180 s, or fetchedAtMs − 1 h
 * without a pass. Never rejects: on a failed fetch or parse it warns and resolves to Date.now() − 1 h. fetchFn is for
 * unit tests (README section 8, unit tests rule 3).
 */
export async function loadDemoAnchorMs(
  baseUrl: string,
  site: ObserverSite,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  try {
    const [stations, meta] = await Promise.all([
      fetchJson(fetchFn, `${baseUrl}data/gp/stations.json`),
      fetchJson(fetchFn, `${baseUrl}data/gp/meta.json`),
    ]);
    const fetchedAtMs = stationsFetchedAtMs(meta);
    const omm = parseGpFile(stations).find((o) => Number(o.NORAD_CAT_ID) === ISS_NORAD_ID);
    if (omm === undefined) throw new Error("stations.json has no ISS");
    const passes = findPasses(
      json2satrec(omm),
      site,
      fetchedAtMs - DEMO_PASS_WINDOW_MS,
      fetchedAtMs,
      PASS_STEP_MS,
      PASS_MIN_ALT_DEG,
    );
    const pass = chooseDemoPass(passes);
    return pass === null ? fetchedAtMs - FALLBACK_LEAD_MS : pass.culminationMs - DEMO_LEAD_MS;
  } catch (error) {
    console.warn("The tour found no ISS pass in the element sets; it starts an hour ago", error);
    return Date.now() - FALLBACK_LEAD_MS;
  }
}

/** "" or the 90-day GIBS note for a sim time more than 90 days before nowMs. */
export function goesWindowNote(simTimeMs: number, nowMs: number): string {
  return nowMs - simTimeMs <= GIBS_GEOSTATIONARY_DAYS_MS
    ? ""
    : " GIBS keeps geostationary imagery for 90 days, so this date has none.";
}

/** The app's DemoSky: the ephemeris frame on screen (ephemeris.ts). */
const frameSky: DemoSky = {
  issAltDeg() {
    const { frame, catalog } = ephemeris;
    const index = catalog.indexByNorad.get(ISS_NORAD_ID);
    if (!frame.ready || index === undefined || ((frame.flags[index] ?? 0) & FLAG_VALID) === 0)
      return null;
    return frame.azAltDeg[2 * index + 1] ?? null;
  },
  highestSunlit(state) {
    const { frame, catalog } = ephemeris;
    if (!frame.ready) return null;
    let best: number | null = null;
    let bestAltDeg = 0;
    const count = Math.min(catalog.count, frame.flags.length);
    for (let i = 0; i < count; i++) {
      const flags = frame.flags[i] ?? 0;
      if ((flags & FLAG_VALID) === 0 || (flags & FLAG_SUNLIT) === 0) continue;
      if ((catalog.dockedWith[i] ?? -1) !== -1) continue;
      const group = GP_GROUPS[catalog.groupIndex[i] ?? 0];
      if (!(group === "starlink" ? state.layers.starlink : state.layers.satellites)) continue;
      const altDeg = frame.azAltDeg[2 * i + 1] ?? 0;
      if (altDeg > bestAltDeg) {
        best = i;
        bestAltDeg = altDeg;
      }
    }
    return best === null ? null : `sat:${catalog.noradIds[best] ?? 0}`;
  },
};

/** The anchor of the running tour, for contexts built outside the runner (DemoCaptions); NaN before one starts. */
let runnerAnchorMs = Number.NaN;

/** [M9] A fresh DemoContext (rule 5): the store, the anchor, the clip (rule 2) and Date.now(). */
export function demoContext(
  store: AppStore,
  anchorMs: number = runnerAnchorMs,
  sky: DemoSky = frameSky,
): DemoContext {
  return { store, anchorMs, clip: demoClip(store.getState()), nowMs: Date.now(), sky };
}

/** A one-shot timer that can hold its remaining time (setDemoPaused). */
function countdown(): {
  start(ms: number, fire: () => void, held: boolean): void;
  hold(): void;
  resume(): void;
  clear(): void;
} {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let fire: (() => void) | null = null;
  let remainingMs = 0;
  let startedAtMs = 0;
  const run = (): void => {
    if (fire === null || handle !== null) return;
    const f = fire;
    startedAtMs = Date.now();
    handle = setTimeout(
      () => {
        handle = null;
        fire = null;
        f();
      },
      Math.max(0, remainingMs),
    );
  };
  const clear = (): void => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
    fire = null;
  };
  return {
    start(ms, f, held) {
      clear();
      fire = f;
      remainingMs = ms;
      if (!held) run();
    },
    hold() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = null;
      remainingMs -= Date.now() - startedAtMs;
    },
    resume: run,
    clear,
  };
}

/**
 * Subscribes to ui.demo, runs skip, enter and the step timer; returns the stop function. On each step change: skip
 * passes over a step without enter (forward, or back after Previous); otherwise enter runs once and a timer of
 * durationMs moves to the next step. setDemoPaused(true) keeps the remaining time and false restarts it; a step
 * entered while paused holds its full duration until resume. The live step ends at once on embed-blocked or error, or
 * when the player is not playing 15 s after enter. stopDemo() clears the timers. sky is for unit tests.
 */
export function startDemoRunner(
  store: AppStore,
  anchorMs: number,
  sky: DemoSky = frameSky,
): () => void {
  runnerAnchorMs = anchorMs;
  const stepTimer = countdown();
  const liveTimer = countdown();
  /** The step whose skip or enter ran, while the tour is active. */
  let entered: number | null = null;

  const clearTimers = (): void => {
    stepTimer.clear();
    liveTimer.clear();
  };
  /** From `from` to `to`, unless the tour has moved on or stopped meanwhile. */
  const moveOn = (from: number, to: number): void => {
    const { ui, actions } = store.getState();
    if (ui.demo.active && ui.demo.step === from) actions.setDemoStep(to);
  };
  const onStep = (step: number, previous: number | null): void => {
    clearTimers();
    entered = step;
    const def = DEMO_STEPS[step];
    if (def === undefined) return;
    const ctx = demoContext(store, anchorMs, sky);
    if (def.skip?.(ctx) === true) {
      // A nested write: this listener runs again for the new step before the call returns.
      store
        .getState()
        .actions.setDemoStep(previous !== null && step < previous ? step - 1 : step + 1);
      return;
    }
    def.enter(ctx);
    const held = store.getState().ui.demo.paused;
    if (def.durationMs !== null)
      stepTimer.start(def.durationMs, () => moveOn(step, step + 1), held);
    if (def.id === "live") {
      liveTimer.start(
        DEMO_LIVE_WAIT_MS,
        () => {
          if (store.getState().video.status !== "playing") moveOn(step, END_STEP);
        },
        held,
      );
    }
  };

  const unsubscribeDemo = store.subscribe(
    (s) => s.ui.demo,
    (demo, prev) => {
      if (!demo.active) {
        clearTimers();
        entered = null;
        return;
      }
      if (!prev.active || demo.step !== prev.step || entered === null) {
        onStep(demo.step, prev.active ? prev.step : null);
        return;
      }
      if (demo.paused === prev.paused) return;
      if (demo.paused) {
        stepTimer.hold();
        liveTimer.hold();
      } else {
        stepTimer.resume();
        liveTimer.resume();
      }
    },
  );
  // M5 has already switched to replay when the player is blocked or fails (README "Sky over video" rule 9).
  const unsubscribeVideo = store.subscribe(
    (s) => s.video.status,
    (status) => {
      const { ui } = store.getState();
      if (!ui.demo.active || entered === null || ui.demo.step !== entered) return;
      if (DEMO_STEPS[entered]?.id !== "live") return;
      if (status === "embed-blocked" || status === "error") moveOn(entered, END_STEP);
    },
  );
  const { demo } = store.getState().ui;
  if (demo.active) onStep(demo.step, null);

  return () => {
    unsubscribeDemo();
    unsubscribeVideo();
    clearTimers();
    entered = null;
  };
}
