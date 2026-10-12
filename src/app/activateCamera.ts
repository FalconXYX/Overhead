// src/app/activateCamera.ts — what choosing a camera does (M5 step 12.2): the CameraPicker and VideoPanel's replay
// offers both call it. The initial camera (?cam=) is applied by main.tsx instead, so a page loaded with ?t= stays in
// replay on its first activation.
import type { AppStore } from "../state/store";

/**
 * setActiveCamera(id), then by kind: a youtube camera jumps to now and goes live (it follows the player); a
 * local-video camera is replay only and paused, at 1× if the rate was 60× or 600× (playbackRate stops at 16, G16).
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
    const { rate } = store.getState().clock;
    if (rate === 60 || rate === 600) actions.setRate(1);
  }
}
