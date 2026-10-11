// src/main.tsx — boot: URL state, keyboard, the clock loop, render, then cameras.json and the GIBS snapshot (M1 step 16),
// the star catalogue (M2 step 7), and the satellite ephemeris and test hooks (M3 steps 11 and 16).
import "ol/ol.css"; // OpenLayers' own control styles: without it the hidden rotate button shows
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { enabledCameras, parseCameraRegistry } from "./app/cameras";
import { installKeyboard } from "./app/keyboard";
import { createTestHooks, installTestHooks } from "./app/testHooks";
import { parseUrlState, startUrlSync } from "./app/url";
import { loadGibsCapabilities } from "./map/ground/layers/gibs";
import { registry } from "./map/registry";
import { startClockLoop } from "./state/clockLoop";
import { indexOfObjectId, startEphemeris, updateEphemerisFrame } from "./state/ephemeris";
import { DEFAULT_CAMERA_ID } from "./state/initialState";
import { loadStars, skyCache } from "./state/skyCache";
import { store } from "./state/store";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("index.html has no #root element");

const { actions } = store.getState();

// 1. URL state, before the first render. ?t= opens paused replay there; without it the app starts live.
const url = parseUrlState(window.location.search);
const urlParams = new URLSearchParams(window.location.search);
if (url.tMs !== null) {
  actions.recenter(url.tMs);
} else {
  if (urlParams.has("t")) {
    console.warn(
      "Ignoring ?t=: it must be an ISO 8601 UTC time ending in Z, e.g. 2026-10-10T03:30:00Z",
    );
  }
  actions.setMode("live");
}
// ?sel= may name a satellite whose group has not loaded yet: the Inspector says so until it has.
if (url.sel !== null) {
  actions.select(url.sel);
} else if (urlParams.has("sel")) {
  console.warn(
    "Ignoring ?sel=: it must be an object id such as sat:25544, planet:Jupiter, star:424, moon or sun",
  );
}

// 2. Module scope, never inside an effect: StrictMode runs effects twice in development.
installKeyboard(store);
// The worker client waits for the first site (cameras.json) itself, and registers updateEphemerisFrame here, before
// every map's frame updater (each also calls it first; it computes once per frame).
startEphemeris(store);
// Playwright's headless Chromium sets navigator.webdriver; real visitors never get window.__overhead.
if (navigator.webdriver) {
  const { hooks } = createTestHooks({
    store,
    updateSatFrame: updateEphemerisFrame,
    indexOfObjectId,
    sky: skyCache,
    maps: registry,
  });
  installTestHooks(hooks);
}
startClockLoop(store);

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** WebKit throws SecurityError after 100 replaceState calls in 10 s: startUrlSync debounces, this catches. */
function writeUrl(search: string): void {
  try {
    window.history.replaceState(null, "", search + window.location.hash);
  } catch (error) {
    console.warn("Could not update the address bar", error);
  }
}

// 3. Cameras.
async function loadCameras(): Promise<void> {
  actions.setLoadStatus("cameras", "loading");
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/cameras.json`);
    if (!res.ok) throw new Error(`cameras.json: HTTP ${res.status}`);
    const all = parseCameraRegistry(await res.json());
    const enabled = enabledCameras(all);
    actions.setRegistry(enabled);
    if (url.cam !== null && Object.hasOwn(enabled, url.cam)) {
      actions.setActiveCamera(url.cam);
    } else {
      if (url.cam !== null) {
        console.warn(
          Object.hasOwn(all, url.cam)
            ? `Camera ${url.cam} is not enabled yet; showing ${DEFAULT_CAMERA_ID}`
            : `Unknown camera ${url.cam}; showing ${DEFAULT_CAMERA_ID}`,
        );
      }
      actions.setActiveCamera(DEFAULT_CAMERA_ID);
    }
    actions.setLoadStatus("cameras", "ready");
    startUrlSync(store, writeUrl);
  } catch (error) {
    console.error("Camera list failed to load", error);
    actions.setLoadStatus("cameras", "error");
  }
}

// 4. In parallel: the trimmed GIBS capabilities snapshot.
async function loadGibs(): Promise<void> {
  actions.setLoadStatus("gibs", "loading");
  try {
    await loadGibsCapabilities(`${import.meta.env.BASE_URL}data/gibs-capabilities.xml`);
    actions.setLoadStatus("gibs", "ready");
  } catch (error) {
    console.error("NASA imagery unavailable", error);
    actions.setLoadStatus("gibs", "error");
  }
}

void loadCameras();
void loadGibs();
// 5. In parallel: the star catalogue. loadStars sets data.stars and logs its own failure; no retry.
void loadStars(store);
