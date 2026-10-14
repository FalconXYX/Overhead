// src/ui/inView.ts — what is drawn in the camera's view right now, with friendly names and plain positions (redesign
// spec section 2): satellites highest first, then the Sun, Moon and planets. InViewList renders it; the control bar's
// [In view (N)] button counts it. Reads ephemeris, skyCache and the store during the 4 Hz render (React rule 5).
import { BODY_IDS, BODY_STRIDE } from "../domain/astro";
import { type CameraModel, createCameraModel, projectAzAltDeg } from "../domain/camera";
import { bodyLabel } from "../map/sky/layers/bodies";
import { ephemeris, indexOfObjectId } from "../state/ephemeris";
import { useTick4Hz } from "../state/hooks";
import {
  selectActiveCamera,
  selectCalibration,
  selectHorizonProfileDeg,
  selectHorizonStatus,
  selectSkyLayerVisible,
} from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import type { AppState, Calibration, CameraConfig, ObjectId } from "../state/types";
import {
  friendlyBody,
  friendlySatellite,
  type KindClass,
  lowerFirst,
  whereToLook,
} from "./friendly";
import { behindTerrain } from "./objectText";

export interface InViewItem {
  readonly id: ObjectId;
  /** friendly.ts's name: "International Space Station", "Jupiter (planet)". */
  readonly name: string;
  /** "high in the south-east", "low in the west, in Earth's shadow", "halfway up in the north, behind the mountains". */
  readonly position: string;
  readonly className: KindClass;
  /** It is the selection (a docked selection marks its host's row, which is where it is drawn). */
  readonly selected: boolean;
}

export interface InView {
  /** Satellites drawn in the view, highest first; null before the first ready frame. */
  readonly satellites: readonly InViewItem[] | null;
  /** Starlink satellites drawn in the view, counted rather than listed (there can be hundreds). */
  readonly starlinkCount: number;
  /** The Sun, Moon and planets drawn in the view, in BODY_IDS order; null before the first sky pass. */
  readonly bodies: readonly InViewItem[] | null;
}

/** The parts of the catalogue and the frame this module reads (ephemeris.ts's SatCatalog and SatFrame). */
export interface InViewSources {
  readonly catalog: {
    readonly count: number;
    readonly noradIds: ArrayLike<number>;
    readonly names: readonly string[];
    readonly groupIndex: ArrayLike<number>;
    readonly dockedWith: ArrayLike<number>;
  };
  readonly frame: {
    readonly ready: boolean;
    readonly azAltDeg: ArrayLike<number>; // altitude apparent
    readonly flags: ArrayLike<number>; // bit 0 valid, 1 sunlit, 2 above horizon
  };
  /** skyCache.bodies: [az, alt, mag, phase] per BODY_IDS entry; NaN before the first pass. */
  readonly bodies: ArrayLike<number>;
  /** The active camera's model: only what projects inside its frame is in view. null: the whole sky above 0°. */
  readonly model: CameraModel | null;
  /** A ready terrain profile, else null. */
  readonly terrain: Float32Array | null;
  /** The selected satellite's row (its host's when docked): drawn, so listed, even with its layer off. */
  readonly selectedIndex: number | null;
  readonly selectedId: ObjectId | null;
  readonly satellitesOn: boolean;
  readonly starlinkOn: boolean;
  readonly planetsOn: boolean;
}

const FLAG_VALID = 1;
const FLAG_SUNLIT = 2;
const FLAG_ABOVE_HORIZON = 4;
const STARLINK_GROUP = 2; // GP_GROUPS index

const uv = new Float64Array(2);

/** Projects inside the camera frame [0, W] × [0, H]; with no model, anything above the horizon. */
function inFrame(model: CameraModel | null, azDeg: number, altDeg: number): boolean {
  if (model === null) return true;
  if (!projectAzAltDeg(model, azDeg, altDeg, uv, 0)) return false;
  const u = uv[0] ?? Number.NaN;
  const v = uv[1] ?? Number.NaN;
  return u >= 0 && u <= model.widthPx && v >= 0 && v <= model.heightPx;
}

/** The list from its inputs (unit tests call this). Allocates only the items. */
export function inViewItems(src: InViewSources): InView {
  const { catalog, frame } = src;
  let satellites: InViewItem[] | null = null;
  let starlinkCount = 0;
  if (frame.ready) {
    const rows: number[] = [];
    const n = Math.min(catalog.count, frame.flags.length);
    for (let i = 0; i < n; i++) {
      const flags = frame.flags[i] ?? 0;
      // Docked rows are never valid: their host is drawn and listed.
      if ((flags & FLAG_VALID) === 0 || (catalog.dockedWith[i] ?? -1) !== -1) continue;
      const az = frame.azAltDeg[2 * i] ?? Number.NaN;
      const alt = frame.azAltDeg[2 * i + 1] ?? Number.NaN;
      if (!(alt > 0)) continue;
      const starlink = (catalog.groupIndex[i] ?? 0) === STARLINK_GROUP;
      const selected = i === src.selectedIndex;
      if (!selected && !(starlink ? src.starlinkOn : src.satellitesOn)) continue;
      if (!inFrame(src.model, az, alt)) continue;
      if (starlink && !selected) starlinkCount++;
      else rows.push(i);
    }
    const altOf = (i: number): number => frame.azAltDeg[2 * i + 1] ?? 0;
    rows.sort((a, b) => altOf(b) - altOf(a) || a - b);
    satellites = rows.map((i): InViewItem => {
      const flags = frame.flags[i] ?? 0;
      const alt = altOf(i);
      const f = friendlySatellite(catalog.names[i] ?? "");
      // [M6] Above 0° but not above the terrain horizon (the frame's flag uses the terrain profile).
      const suffix =
        (flags & FLAG_ABOVE_HORIZON) === 0
          ? ", behind the mountains"
          : (flags & FLAG_SUNLIT) === 0
            ? ", in Earth's shadow"
            : "";
      return {
        id: `sat:${catalog.noradIds[i] ?? 0}`,
        name: f.name,
        position: `${lowerFirst(whereToLook(frame.azAltDeg[2 * i] ?? 0, alt))}${suffix}`,
        className: f.className,
        selected: i === src.selectedIndex,
      };
    });
  }

  let computed = false;
  const bodies: InViewItem[] = [];
  for (let i = 0; i < BODY_IDS.length; i++) {
    const id = BODY_IDS[i];
    const o = i * BODY_STRIDE;
    const az = src.bodies[o] ?? Number.NaN;
    const alt = src.bodies[o + 1] ?? Number.NaN;
    if (id === undefined || !Number.isFinite(az) || !Number.isFinite(alt)) continue;
    computed = true;
    if (alt < 0 || !(src.planetsOn || id === src.selectedId) || !inFrame(src.model, az, alt))
      continue;
    const f = friendlyBody(id, bodyLabel(id, src.bodies[o + 3] ?? Number.NaN));
    const behind = behindTerrain(src.terrain, az, alt) ? ", behind the mountains" : "";
    bodies.push({
      id,
      name: f.name,
      position: `${lowerFirst(whereToLook(az, alt))}${behind}`,
      className: f.className,
      selected: id === src.selectedId,
    });
  }
  return { satellites, starlinkCount, bodies: computed ? bodies : null };
}

/** The accessible name of an item: "International Space Station, high in the south-east". */
export const inViewItemLabel = (item: InViewItem): string => `${item.name}, ${item.position}`;

// One camera model per (camera, calibration) pair, as bindSkyCamera builds it.
let memo: {
  camera: CameraConfig;
  calibration: Calibration;
  model: CameraModel;
} | null = null;

/** The active camera's model, rebuilt only when the camera or its calibration changes; null before the registry. */
export function activeCameraModel(state: AppState): CameraModel | null {
  const camera = selectActiveCamera(state);
  const calibration = selectCalibration(state);
  if (camera === undefined || calibration === undefined) return null;
  if (memo !== null && memo.camera === camera && memo.calibration === calibration)
    return memo.model;
  const model = createCameraModel({
    lens: camera.lens,
    calibration,
    widthPx: camera.imageSize.widthPx,
    heightPx: camera.imageSize.heightPx,
  });
  memo = { camera, calibration, model };
  return model;
}

/** The list for this frame, from the app's ephemeris, skyCache and state. */
export function inViewNow(state: AppState = store.getState()): InView {
  const selectedId = state.selection.selectedId;
  return inViewItems({
    catalog: ephemeris.catalog,
    frame: ephemeris.frame,
    bodies: skyCache.bodies,
    model: activeCameraModel(state),
    terrain: selectHorizonStatus(state) === "ready" ? selectHorizonProfileDeg(state) : null,
    selectedIndex: selectedId === null ? null : indexOfObjectId(selectedId),
    selectedId,
    satellitesOn: selectSkyLayerVisible("satellites")(state),
    starlinkOn: selectSkyLayerVisible("starlink")(state),
    // [M4] The Sun, Moon and planets are also drawn while calibrating: they are calibration targets.
    planetsOn: selectSkyLayerVisible("planets")(state) || state.ui.panel === "calibration",
  });
}

/** How many entries the list shows (satellites and bodies; the Starlink count is not added); null before any data. */
export function inViewCount(state: AppState = store.getState()): number | null {
  const { satellites, bodies } = inViewNow(state);
  if (satellites === null && bodies === null) return null;
  return (satellites?.length ?? 0) + (bodies?.length ?? 0);
}

/** The list, re-rendered at 4 Hz. */
export function useInView(): InView {
  useTick4Hz();
  return inViewNow();
}

/** For "In view (N)": the number of listed entries, re-rendered at 4 Hz; null before any data. */
export function useInViewCount(): number | null {
  useTick4Hz();
  return inViewCount();
}
