// tests/helpers/store.ts — a store at a fixed time with the committed camera registry (M1). [Redesign] The app now
// enables only the recorded ISS pass and the two live StarCams and opens on the clip, but most unit tests need a camera
// that draws without a video: they keep the computed sky over Maunakea, whose cameras.json entry stays for them.
import { readFileSync } from "node:fs";
import { parseCameraRegistry } from "../../src/app/cameras";
import { initialState } from "../../src/state/initialState";
import { type AppStore, createAppStore } from "../../src/state/store";

const CAMERAS_URL = new URL("../../public/data/cameras.json", import.meta.url);

/** [Redesign] The tests' default camera: the computed sky over Maunakea (no video, never enabled in the app). */
export const TEST_CAMERA_ID = "synthetic-maunakea";

/** Every committed camera, enabled or not (for tests that switch to a later milestone's camera). */
export function committedCameras() {
  return parseCameraRegistry(JSON.parse(readFileSync(CAMERAS_URL, "utf8")));
}

/** createAppStore(initialState(Date.parse(iso), TEST_CAMERA_ID)) with setRegistry(every committed camera). */
export function storeAt(iso: string): AppStore {
  const store = createAppStore(initialState(Date.parse(iso), TEST_CAMERA_ID));
  store.getState().actions.setRegistry(committedCameras());
  return store;
}
