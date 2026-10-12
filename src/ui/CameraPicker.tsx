// src/ui/CameraPicker.tsx — every enabled camera in cameras.json order with its kind and status, as a native radio
// group, so the arrow keys and Space work (M4 step 13). Choosing one calls [M5] activateCamera (setActiveCamera, and the
// mode a video camera needs, step 12.2); url.ts writes ?cam=.
// Layout and look are visual design, settled from screenshots.
import { useId } from "react";
import { useShallow } from "zustand/react/shallow";
import { activateCamera } from "../app/activateCamera";
import { CAMERA_STATUS_TEXT } from "../app/stillImage";
import { useAppState } from "../state/hooks";
import { selectCameraStatus } from "../state/selectors";
import { store } from "../state/store";
import type { AppState, CameraConfig, CameraKind, CameraStatus, LoadStatus } from "../state/types";

const KIND_TEXT: Readonly<Record<CameraKind, string>> = {
  synthetic: "Computed sky",
  "still-image": "Still image",
  youtube: "Live video",
  "local-video": "Recorded clip",
};

/** A shape per status beside its words, so a status never rides on colour alone (README Accessibility rule 3). */
const STATUS_SHAPE: Readonly<Record<CameraStatus, string>> = {
  live: "●",
  offline: "✕",
  daytime: "☀",
  unknown: "?",
};

export interface CameraPickerEntry {
  readonly camera: CameraConfig;
  readonly status: CameraStatus; // selectCameraStatus: synthetic cameras are always "live"
}

export interface CameraPickerViewProps {
  readonly entries: readonly CameraPickerEntry[];
  readonly activeId: string;
  readonly cameras: LoadStatus; // data.cameras: the registry's load state
  readonly onChoose: (id: string) => void;
}

/** The radio group itself, from props (unit-tested with renderToStaticMarkup). */
export function CameraPickerView({ entries, activeId, cameras, onChoose }: CameraPickerViewProps) {
  const idPrefix = useId();
  const loadText =
    cameras === "error"
      ? "The camera list failed to load"
      : entries.length === 0
        ? "Loading cameras"
        : null;
  return (
    <fieldset>
      <legend>Camera</legend>
      <div role="status">{loadText}</div>
      {entries.map(({ camera, status }, i) => {
        const detailsId = `${idPrefix}-${i}`;
        return (
          <p key={camera.id} className="camera-option">
            <label>
              <input
                type="radio"
                name={`${idPrefix}-camera`}
                value={camera.id}
                checked={camera.id === activeId}
                aria-describedby={detailsId}
                onChange={() => onChoose(camera.id)}
              />
              {camera.name}
            </label>{" "}
            <span id={detailsId} className="camera-meta">
              {KIND_TEXT[camera.kind]}, <span aria-hidden="true">{STATUS_SHAPE[status]}</span>{" "}
              {CAMERA_STATUS_TEXT[status]}
            </span>
          </p>
        );
      })}
    </fieldset>
  );
}

/** Status of every registry camera, in registry order: a new array, so compared with useShallow (React rule 3). */
const selectStatuses = (s: AppState): CameraStatus[] =>
  Object.keys(s.camera.registry).map((id) => selectCameraStatus(id)(s));

export function CameraPicker() {
  const registry = useAppState((s) => s.camera.registry);
  const activeId = useAppState((s) => s.camera.activeId);
  const cameras = useAppState((s) => s.data.cameras);
  const statuses = useAppState(useShallow(selectStatuses));
  const entries = Object.values(registry).map((camera, i) => ({
    camera,
    status: statuses[i] ?? "unknown",
  }));
  return (
    <CameraPickerView
      entries={entries}
      activeId={activeId}
      cameras={cameras}
      onChoose={(id) => activateCamera(store, id)}
    />
  );
}
