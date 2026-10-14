// src/map/sync/bindSite.ts — the site marker follows the active camera, and the view centres on it (M1). M4 adds the
// wedge: the azimuth range the frame covers, redrawn when the camera or its calibration changes (M4 step 12.2).
import type Feature from "ol/Feature";
import Point from "ol/geom/Point";
import type Polygon from "ol/geom/Polygon";
import { fromLonLat } from "ol/proj";
import type View from "ol/View";
import { shallow } from "zustand/vanilla/shallow";
import { createCameraModel, frameAzimuthCoverage } from "../../domain/camera";
import { selectActiveCamera, selectCalibration } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { Calibration, CameraConfig } from "../../state/types";
import { SITE_WEDGE_RADIUS_M, siteWedgeGeometry } from "../ground/layers/site";

/** [M4] Boundary samples per frame edge for the wedge (verification/architecture.md claim 17). */
export const WEDGE_SAMPLES_PER_EDGE = 16;

/** [M4] The wedge of a camera at a calibration: frameAzimuthCoverage(model, 16) around the site. */
export function cameraWedgeGeometry(camera: CameraConfig, calibration: Calibration): Polygon {
  const model = createCameraModel({
    lens: camera.lens,
    calibration,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
  });
  return siteWedgeGeometry(
    camera.site.lonDeg,
    camera.site.latDeg,
    frameAzimuthCoverage(model, WEDGE_SAMPLES_PER_EDGE),
    SITE_WEDGE_RADIUS_M,
  );
}

/**
 * On a camera change: the marker at the site, labelled with the camera's siteName ([Redesign] "Subaru Telescope
 * camera"; else its name), and the view centred there; no camera clears the marker. On a camera or calibration change:
 * the wedge (when given), cleared without a camera. A calibration change leaves the marker and the view alone. Never
 * on clock ticks.
 */
export function bindSite(
  store: AppStore,
  feature: Feature<Point>,
  view: View,
  wedge?: Feature<Polygon>,
): () => void {
  let placed: CameraConfig | undefined | null = null; // null: nothing placed yet
  return store.subscribe(
    (s) => [selectActiveCamera(s), selectCalibration(s)] as const,
    ([camera, calibration]) => {
      if (camera !== placed) {
        placed = camera;
        if (camera === undefined) {
          feature.setGeometry(undefined);
        } else {
          const coordinate = fromLonLat([camera.site.lonDeg, camera.site.latDeg]);
          feature.setGeometry(new Point(coordinate));
          feature.set("name", camera.siteName ?? camera.name); // [Redesign] the plain site label
          view.setCenter(coordinate);
        }
      }
      wedge?.setGeometry(
        camera === undefined || calibration === undefined
          ? undefined
          : cameraWedgeGeometry(camera, calibration),
      );
    },
    { equalityFn: shallow, fireImmediately: true },
  );
}
