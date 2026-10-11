// src/map/sync/bindSite.ts — the site marker follows the active camera, and the view centres on it (M1). M4 adds the wedge.
import type Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import type View from "ol/View";
import { shallow } from "zustand/vanilla/shallow";
import { selectActiveCamera } from "../../state/selectors";
import type { AppStore } from "../../state/store";

export function bindSite(store: AppStore, feature: Feature<Point>, view: View): () => void {
  return store.subscribe(
    selectActiveCamera,
    (camera) => {
      if (camera === undefined) {
        feature.setGeometry(undefined);
        return;
      }
      const coordinate = fromLonLat([camera.site.lonDeg, camera.site.latDeg]);
      feature.setGeometry(new Point(coordinate));
      feature.set("name", camera.name);
      view.setCenter(coordinate);
    },
    { equalityFn: shallow, fireImmediately: true },
  );
}
