// src/app/activateCamera.ts — what choosing a camera does (M5 step 12.2): the header's camera switcher, "Watch live",
// "Watch the recorded ISS pass" and VideoPanel's offers all call it. The initial camera (?cam=) is applied by main.tsx
// through it too, followed by the ?t= of a clip.
import type { AppStore } from "../state/store";
import { LIVE_CAMERA_ID, RECORDED_CLIP_ID } from "./cameras";
import { CLIP_RATES } from "./clip";

/**
 * setActiveCamera(id), then by kind: a youtube camera jumps to now and goes live (it follows the player, and has no
 * time controls); a local-video camera is replay only and paused, at 1× unless the rate is a clip rate (playbackRate
 * stops at 16, G16). main.tsx's clip loader then loads the clip, or brings a loaded clip back to its opening time.
 * Unknown ids do nothing.
 */
export function activateCamera(store: AppStore, id: string): void {
  const s = store.getState();
  const camera = s.camera.registry[id];
  if (camera === undefined) return;
  const { actions } = s;
  actions.setActiveCamera(id);
  if (camera.kind === "youtube") {
    actions.jumpToNow();
    actions.setMode("live");
  } else if (camera.kind === "local-video") {
    actions.setMode("replay");
    actions.pause();
    if (!CLIP_RATES.includes(store.getState().clock.rate)) actions.setRate(1);
  }
}

/** [Redesign] "Watch live": the live Subaru StarCam (LIVE_CAMERA_ID). Nothing when it is not in the registry. */
export function watchLive(store: AppStore): void {
  activateCamera(store, LIVE_CAMERA_ID);
}

/**
 * [Redesign] "Watch the recorded ISS pass" (RECORDED_CLIP_ID): paused at the clip's opening time, about 20 s before the
 * ISS enters (a clip loaded earlier comes back there when the clock is outside it). Nothing when not in the registry.
 */
export function watchRecordedPass(store: AppStore): void {
  activateCamera(store, RECORDED_CLIP_ID);
}
