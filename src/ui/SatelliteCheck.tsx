// src/ui/SatelliteCheck.tsx — the Calibration panel's "Satellite check" for image cameras (M5 step 13): with a
// satellite selected and the frame paused, each click on its dot in the picture is measured against the satellite's
// apparent position by angle on the sky (through the camera model's inverse); satelliteCheckSummary judges the
// samples, excusing the stretches where the clip's sidecar says the satellite is hidden; the export is a track that
// scripts/check-clip-pass.ts reads. Samples live in component state. Layout and look are visual design.
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  clipHiddenMs,
  getClipLoadState,
  type SatelliteCheckExport,
  type SatelliteCheckRow,
  satelliteCheckFileName,
  subscribeClipLoads,
} from "../app/clip";
import { downloadJsonFile } from "../app/persist";
import {
  type Calibration,
  type CameraModel,
  createCameraModel,
  projectAzAltDeg,
  type SatelliteCheckSummary,
  satelliteCheckSummary,
  unprojectPixel,
} from "../domain/camera";
import { angularSeparationDeg } from "../domain/geo";
import { isoUtcSeconds } from "../domain/time";
import { setSatelliteCheckClicks } from "../map/sky/calibrationClick";
import { ephemeris, indexOfObjectId } from "../state/ephemeris";
import { useAppState } from "../state/hooks";
import { store } from "../state/store";
import type { LocalVideoCamera, StillImageCamera } from "../state/types";

/** The check's limit: the M5 acceptance's 1°. */
export const SATELLITE_CHECK_LIMIT_DEG = 1.0;
const FLAG_VALID = 1;

/**
 * One click at image pixel (uPx, vPx) against a satellite at (satAzDeg, satAltDeg), apparent: residualDeg is the angle
 * between the click's unprojected az/alt and the satellite's, residualPx the distance to the projected marker (null
 * when the model culls it). null when the click does not unproject.
 */
export function satelliteCheckRow(
  model: CameraModel,
  satAzDeg: number,
  satAltDeg: number,
  timeMs: number,
  uPx: number,
  vPx: number,
): SatelliteCheckRow | null {
  const out = new Float64Array(4);
  if (!unprojectPixel(model, uPx, vPx, out, 0)) return null;
  const [clickAz = Number.NaN, clickAlt = Number.NaN] = out;
  const residualDeg = angularSeparationDeg(clickAz, clickAlt, satAzDeg, satAltDeg);
  const marked = projectAzAltDeg(model, satAzDeg, satAltDeg, out, 2);
  const residualPx = marked ? Math.hypot((out[2] ?? 0) - uPx, (out[3] ?? 0) - vPx) : null;
  return { timeMs, uPx, vPx, residualDeg, residualPx };
}

/** "12 samples, largest gap 2.0 s, max 0.85°, median 0.58°: pass". */
export function satelliteCheckSummaryText(summary: SatelliteCheckSummary): string {
  const { count, maxGapMs, maxDeg, medianDeg, pass } = summary;
  const parts = [
    `${count} ${count === 1 ? "sample" : "samples"}`,
    maxGapMs === null ? "no gap yet" : `largest gap ${(maxGapMs / 1000).toFixed(1)} s`,
    maxDeg === null ? "max none" : `max ${maxDeg.toFixed(2)}°`,
    medianDeg === null ? "median none" : `median ${medianDeg.toFixed(2)}°`,
  ];
  return `${parts.join(", ")}: ${pass ? "pass" : "fail"}`;
}

/** The selected satellite's NORAD id, or null. */
const selectedNorad = (selectedId: string | null): number | null =>
  selectedId?.startsWith("sat:") === true ? Number(selectedId.slice(4)) : null;

/**
 * The toggle works only on a paused frame (a still image's frozen frame, or a clip that is not playing) with a
 * satellite selected (M5 step 13.1).
 */
export function satelliteCheckEnabled(
  kind: "still-image" | "local-video",
  frameTimeMs: number | null,
  playing: boolean,
  selectedId: string | null,
): boolean {
  const paused = frameTimeMs !== null && (kind === "still-image" || !playing);
  return paused && selectedNorad(selectedId) !== null;
}

interface Samples {
  readonly noradId: number | null;
  readonly camera: StillImageCamera | LocalVideoCamera;
  readonly rows: readonly SatelliteCheckRow[];
}

export interface SatelliteCheckProps {
  readonly camera: StillImageCamera | LocalVideoCamera;
  readonly calibration: Calibration;
  readonly frameTimeMs: number | null;
  /** The Calibration panel's one polite live region: each click's result and the export go there. */
  readonly announce: (text: string) => void;
}

export function SatelliteCheck({
  camera,
  calibration,
  frameTimeMs,
  announce,
}: SatelliteCheckProps) {
  const id = useId();
  const selectedId = useAppState((s) => s.selection.selectedId);
  const playing = useAppState((s) => s.clock.playing);
  const clipState = useSyncExternalStore(
    subscribeClipLoads,
    () => getClipLoadState(camera.id),
    () => getClipLoadState(camera.id),
  );
  const [target, setTarget] = useState<"pairs" | "satellite">("pairs");
  const noradId = selectedNorad(selectedId);
  // Samples belong to one satellite on one frame source: a camera change or a new clip (a new registry entry) and a
  // new selection start afresh.
  const [samples, setSamples] = useState<Samples>({ noradId, camera, rows: [] });
  if (samples.noradId !== noradId || samples.camera !== camera) {
    setSamples({ noradId, camera, rows: [] });
  }
  const rows = samples.noradId === noradId && samples.camera === camera ? samples.rows : [];

  const enabled = satelliteCheckEnabled(camera.kind, frameTimeMs, playing, selectedId);
  const checking = enabled && target === "satellite";

  useEffect(() => {
    if (!checking) return;
    return setSatelliteCheckClicks((uPx, vPx) => {
      const s = store.getState();
      const active = s.camera.registry[s.camera.activeId];
      const current = s.camera.calibration[s.camera.activeId] ?? active?.defaults;
      const sel = s.selection.selectedId;
      const index = sel === null ? null : indexOfObjectId(sel);
      const { frame } = ephemeris;
      if (
        active === undefined ||
        current === undefined ||
        index === null ||
        !frame.ready ||
        ((frame.flags[index] ?? 0) & FLAG_VALID) === 0
      ) {
        announce("The selected satellite has no position in this frame; nothing was recorded.");
        return;
      }
      const model = createCameraModel({
        lens: active.lens,
        calibration: current,
        widthPx: active.imageSize.widthPx,
        heightPx: active.imageSize.heightPx,
      });
      const row = satelliteCheckRow(
        model,
        frame.azAltDeg[2 * index] ?? Number.NaN,
        frame.azAltDeg[2 * index + 1] ?? Number.NaN,
        s.clock.simTimeMs,
        uPx,
        vPx,
      );
      if (row === null) {
        announce(
          `The click at (${Math.round(uPx)}, ${Math.round(vPx)}) is not on the sky of this calibration; nothing was recorded.`,
        );
        return;
      }
      setSamples((prev) => ({ ...prev, rows: [...prev.rows, row] }));
      announce(`Recorded: ${row.residualDeg.toFixed(2)}° from the satellite's position.`);
    });
  }, [checking, announce]);

  const sidecar = camera.kind === "local-video" ? (clipState?.clip?.sidecar ?? null) : null;
  const hiddenMs = sidecar !== null && noradId !== null ? clipHiddenMs(sidecar, noradId) : [];
  const summary = satelliteCheckSummary(rows, SATELLITE_CHECK_LIMIT_DEG, hiddenMs);

  const exportCheck = (): void => {
    if (noradId === null) return;
    const nowMs = Date.now();
    const index = indexOfObjectId(`sat:${noradId}`);
    const epochMs = index === null ? Number.NaN : (ephemeris.catalog.epochMs[index] ?? Number.NaN);
    const clip = camera.kind === "local-video" ? (clipState?.clip ?? null) : null;
    const value: SatelliteCheckExport = {
      format: "overhead.satcheck",
      version: 1,
      cameraId: camera.id,
      clip: clip?.fileName ?? null,
      sidecar: clip?.sidecarJson ?? null,
      widthPx: camera.imageSize.widthPx,
      heightPx: camera.imageSize.heightPx,
      calibration,
      noradId,
      satelliteName:
        (index === null ? undefined : ephemeris.catalog.names[index]) ?? `NORAD ${noradId}`,
      elementEpochUtc: Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null,
      samples: rows,
      summary: {
        count: summary.count,
        maxGapMs: summary.maxGapMs,
        maxDeg: summary.maxDeg,
        medianDeg: summary.medianDeg,
        pass: summary.pass,
      },
      exportedAtUtc: new Date(nowMs).toISOString(),
    };
    downloadJsonFile(satelliteCheckFileName(camera.id, nowMs), value);
    announce(`Exported ${rows.length} samples.`);
  };

  return (
    <>
      <h3 id={`${id}-heading`}>Satellite check</h3>
      <fieldset disabled={!enabled} aria-describedby={`${id}-rule`}>
        <legend>Clicks add</legend>
        <label>
          <input
            type="radio"
            name={`${id}-target`}
            checked={target === "pairs"}
            onChange={() => setTarget("pairs")}
          />
          star pairs
        </label>{" "}
        <label>
          <input
            type="radio"
            name={`${id}-target`}
            checked={target === "satellite"}
            onChange={() => setTarget("satellite")}
          />
          satellite check
        </label>
      </fieldset>
      <p id={`${id}-rule`}>
        {enabled
          ? "Click the satellite's dot in the picture. Move on a second at a time with the arrow keys on the “Position in the recording” slider under the video: elsewhere the arrow keys nudge the pointing while this panel is open."
          : "Pause on a frame and select a satellite (click its marker, choose it under “In view”, or open the page with &sel=sat:25544) to check it against the picture."}
      </p>
      {rows.length === 0 ? null : (
        <table aria-labelledby={`${id}-heading`}>
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Residual, degrees</th>
              <th scope="col">Residual, pixels</th>
              <th scope="col">Remove</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.timeMs}:${row.uPx}:${row.vPx}`}>
                <td>{isoUtcSeconds(row.timeMs)}</td>
                <td>{row.residualDeg.toFixed(2)}</td>
                <td>{row.residualPx === null ? "off the frame" : row.residualPx.toFixed(1)}</td>
                <td>
                  <button
                    type="button"
                    aria-label={`Remove sample ${i + 1}`}
                    onClick={() =>
                      setSamples((prev) => ({
                        ...prev,
                        rows: prev.rows.filter((r) => r !== row),
                      }))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p data-testid="satellite-check-summary">{satelliteCheckSummaryText(summary)}</p>
      {hiddenMs.length === 0 ? null : (
        <p>{`${hiddenMs.length} stretches where the sidecar says the satellite is hidden are not counted as gaps.`}</p>
      )}
      <p>
        <button type="button" disabled={rows.length === 0} onClick={exportCheck}>
          Export check
        </button>
      </p>
    </>
  );
}
