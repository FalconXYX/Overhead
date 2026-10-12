// tests/helpers/store.ts — a store at a fixed time with the committed, enabled camera registry (M1).
import { readFileSync } from "node:fs";
import { enabledCameras, parseCameraRegistry } from "../../src/app/cameras";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";

const CAMERAS_URL = new URL("../../public/data/cameras.json", import.meta.url);

/** Every committed camera, enabled or not (for tests that switch to a later milestone's camera). */
export function committedCameras() {
  return parseCameraRegistry(JSON.parse(readFileSync(CAMERAS_URL, "utf8")));
}

/** createAppStore(initialState(Date.parse(iso), DEFAULT_CAMERA_ID)) with setRegistry(enabled cameras). */
export function storeAt(iso: string): AppStore {
  const store = createAppStore(initialState(Date.parse(iso), DEFAULT_CAMERA_ID));
  store.getState().actions.setRegistry(enabledCameras(committedCameras()));
  return store;
}
