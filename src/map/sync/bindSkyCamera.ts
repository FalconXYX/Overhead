// src/map/sync/bindSkyCamera.ts — one camera model per active camera and calibration (M2 step 8.8), and pan and zoom
// for image cameras (M4 step 11.1), and pass-through over a YouTube player (M5 step 8.7).
import { shallow } from "zustand/vanilla/shallow";
import { createCameraModel } from "../../domain/camera";
import { selectActiveCamera, selectCalibration } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import { cameraPansAndZooms, type SkyMapHandle } from "../sky/createSkyMap";

/**
 * Calls sky.setCameraModel, sky.setPanZoom and [M5] sky.setPassThrough now and whenever the active camera or its
 * calibration changes; never on ticks. YouTube cameras keep M2's fixed, full-frame view with no interactions.
 */
export function bindSkyCamera(
  store: AppStore,
  sky: Pick<SkyMapHandle, "setCameraModel" | "setPanZoom" | "setPassThrough">,
): () => void {
  return store.subscribe(
    (s) => [selectActiveCamera(s), selectCalibration(s)] as const,
    ([camera, calibration]) => {
      if (camera === undefined || calibration === undefined) return;
      sky.setCameraModel(
        createCameraModel({
          lens: camera.lens,
          calibration,
          widthPx: camera.imageSize.widthPx,
          heightPx: camera.imageSize.heightPx,
        }),
      );
      sky.setPanZoom(cameraPansAndZooms(camera.kind));
      sky.setPassThrough(camera.kind === "youtube");
    },
    { equalityFn: shallow, fireImmediately: true },
  );
}
