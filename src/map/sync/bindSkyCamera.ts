// src/map/sync/bindSkyCamera.ts — one camera model per active camera and calibration (M2 step 8.8).
// M4 widens `sky` to also pick "setPanZoom", M5 to also pick "setPassThrough".
import { shallow } from "zustand/vanilla/shallow";
import { createCameraModel } from "../../domain/camera";
import { selectActiveCamera, selectCalibration } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { SkyMapHandle } from "../sky/createSkyMap";

/** Calls sky.setCameraModel now and whenever the active camera or its calibration changes; never on ticks. */
export function bindSkyCamera(
  store: AppStore,
  sky: Pick<SkyMapHandle, "setCameraModel">,
): () => void {
  return store.subscribe(
    (s) => [selectActiveCamera(s), selectCalibration(s)] as const,
    ([camera, calibration]) => {
      if (camera === undefined || calibration === undefined) return;
      // Throws for anything but a zenith equidistant fisheye until M4: M2 enables only synthetic cameras.
      sky.setCameraModel(
        createCameraModel({
          lens: camera.lens,
          calibration,
          widthPx: camera.imageSize.widthPx,
          heightPx: camera.imageSize.heightPx,
        }),
      );
    },
    { equalityFn: shallow, fireImmediately: true },
  );
}
