// src/ui/CalibrationPanel.tsx — the Calibration panel (M4 step 14): header and "Compare lens models", pointing and
// lens fields, image time, star pairs, fit, files, and one aria-live region. togglePanel("calibration") from its
// button or the C key; the arrow-key nudges live in keyboard.ts (calibrationNudge). Behaviour, states, keyboard and
// accessibility per M4; layout and look are visual design, settled from screenshots. Imports no OpenLayers module.
import {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildCalibrationFile,
  buildGeoPoseExport,
  calibrationFileName,
  downloadJsonFile,
  geoPoseFileName,
  parseCalibrationFile,
  parseGeoPoseImport,
} from "../app/persist";
import {
  burnedInCaptureTimeMs,
  ESTIMATED_FRAME_TIME_TEXT,
  imageSizeNotice,
} from "../app/stillImage";
import type { StarRow } from "../domain/astro";
import { type Calibration, createCameraModel, type LensModel } from "../domain/camera";
import { formatZonedDateTime, isoUtcSeconds } from "../domain/time";
import { skyViewCentreImagePx } from "../map/sky/viewCentre";
import { backgroundImageSize } from "../map/sync/bindBackground";
import { useActions, useAppState } from "../state/hooks";
import { selectActiveCamera, selectCalibration } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import type {
  Actions,
  CalibrationUiState,
  CameraConfig,
  LoadStatus,
  PlanetId,
  StarId,
  StarPair,
} from "../state/types";
import { CopyClipPointing } from "./ClipControls";
import {
  calibrationFields,
  type FieldSpec,
  fieldPatch,
  fieldText,
  fieldValueText,
  focalForHfovInput,
  HFOV_LABEL,
  hfovOf,
  hfovRangeDeg,
  impliedStampValue,
  isFisheyeLens,
  k1FloorFor,
  parseFieldInput,
  stampRuleText,
} from "./calibrationFields";
import {
  acceptanceChecklist,
  type CatalogTarget,
  catalogTargetsAt,
  compareLensModels,
  countFitPairs,
  FIT_MIN_PAIRS,
  FREE_FIT_MIN_PAIRS,
  fitResultText,
  type LensComparisonRow,
  nearestTargets,
  type PanelFitInput,
  type PanelFitOutcome,
  pairOrder,
  pendingPointText,
  projectTargets,
  runPanelFit,
  targetFallbackName,
  targetsById,
} from "./calibrationPairs";
import { SatelliteCheck } from "./SatelliteCheck";
import { StreamDelaySection } from "./StreamDelaySection";

const LENS_TEXT: Readonly<Record<LensModel, string>> = {
  rectilinear: "Rectilinear",
  "fisheye-equidistant": "Equidistant fisheye",
  "fisheye-equisolid": "Equisolid fisheye",
  "fisheye-stereographic": "Stereographic fisheye",
  "fisheye-orthographic": "Orthographic fisheye",
};

const NO_ROWS: readonly StarRow[] = [];

/** "1.23" for a residual, "—" when there is none (no fit yet, or not measurable). */
const residualText = (value: number | null | undefined, digits: number): string =>
  value === null || value === undefined || Number.isNaN(value) ? "—" : value.toFixed(digits);

/**
 * The text of the file chosen in a file input, or null when it could not be read. Clears the input, so the same file
 * can be chosen again.
 */
async function readChosenFile(input: HTMLInputElement): Promise<string | null> {
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return null;
  try {
    return await file.text();
  } catch {
    return null;
  }
}

// ---- Fields ----

interface NumberInputProps {
  readonly spec: Pick<FieldSpec, "min" | "max" | "step" | "wraps" | "decimals">;
  readonly value: number;
  readonly labelledBy: string;
  readonly disabled: boolean;
  readonly describedBy: string | undefined;
  readonly onCommit: (value: number) => void;
}

/**
 * A number input that keeps the typed text while focused and commits each complete, in-range value; on blur it shows
 * the stored (normalized) value again. A controlled input bound straight to the store would rewrite "-" or "37" on
 * the way to "373.1".
 */
function NumberInput({
  spec,
  value,
  labelledBy,
  disabled,
  describedBy,
  onCommit,
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      disabled={disabled}
      value={draft ?? fieldText(value, spec.decimals)}
      onChange={(e) => {
        const text = e.currentTarget.value;
        setDraft(text);
        const parsed = parseFieldInput(text, spec);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

interface FieldRowProps {
  readonly spec: FieldSpec;
  readonly value: number;
  readonly note: string | null; // a description, e.g. why the azimuth is disabled
  readonly onCommit: (value: number) => void;
}

/** A labelled native range input plus a numeric input for one field, both named by the label with its unit. */
function FieldRow({ spec, value, note, onCommit }: FieldRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const noteId = note === null ? undefined : `${id}-note`;
  return (
    <p>
      <label id={labelId} htmlFor={`${id}-range`}>
        {spec.label}
      </label>{" "}
      <input
        id={`${id}-range`}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        disabled={spec.disabled}
        aria-valuetext={fieldValueText(value, spec)}
        aria-describedby={noteId}
        onChange={(e) => onCommit(Number(e.currentTarget.value))}
      />{" "}
      <NumberInput
        spec={spec}
        value={value}
        labelledBy={labelId}
        disabled={spec.disabled}
        describedBy={noteId}
        onCommit={onCommit}
      />
      {note === null ? null : (
        <>
          {" "}
          <span id={noteId}>{note}</span>
        </>
      )}
    </p>
  );
}

// ---- The panel ----

export interface CalibrationPanelViewProps {
  readonly open: boolean;
  readonly camera: CameraConfig;
  readonly calibration: Calibration;
  readonly ui: CalibrationUiState;
  readonly frameTimeMs: number | null;
  readonly rows: readonly StarRow[]; // stars.json once loaded, else empty (planets only)
  readonly stars: LoadStatus;
  readonly imageSizeNotice: string | null; // "Image is W × H px; the calibration assumes W′ × H′ px"
  readonly actions: Actions;
}

/** Sections that keep keyboard focus when the control that had it disappears (M4 step 14.7). */
type FocusHome = "pairs" | "files";

interface FitReport {
  readonly outcome: PanelFitOutcome;
  readonly degByPair: ReadonlyMap<StarPair, number>; // the store's pair objects right after applyFit
}

/**
 * The panel's body for one camera (the container keys it by camera id, so a camera change starts afresh). Everything
 * it shows comes from props; its handlers read the store with store.getState() where they need fresh state.
 */
export function CalibrationPanelView(props: CalibrationPanelViewProps) {
  const { open, camera, calibration, ui, frameTimeMs, rows, stars, imageSizeNotice, actions } =
    props;
  const { lens } = camera;
  const { widthPx, heightPx } = camera.imageSize;
  const fisheye = isFisheyeLens(lens);
  const zenithLocked = fisheye && calibration.altDeg === 90;
  const id = useId();

  const [announcement, setAnnouncement] = useState("");
  const [fitK1, setFitK1] = useState(true);
  const [fitTilt, setFitTilt] = useState(true);
  const [fitReport, setFitReport] = useState<FitReport | null>(null);
  const [comparison, setComparison] = useState<LensComparisonRow[] | null>(null);
  const [sortByResidual, setSortByResidual] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [enteredFrameTimeMs, setEnteredFrameTimeMs] = useState<number | null>(null);
  const [stampDraft, setStampDraft] = useState<string | null>(null);
  const [fileProblems, setFileProblems] = useState<readonly string[]>([]);
  const [geoPoseStatus, setGeoPoseStatus] = useState<string | null>(null);

  // ---- Focus stays in the panel after each action (M4 step 14.7) ----
  const pairsHomeRef = useRef<HTMLHeadingElement>(null);
  const filesHomeRef = useRef<HTMLHeadingElement>(null);
  const focusHome = useRef<FocusHome | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const keepFocus = (home: FocusHome): void => {
    focusHome.current = home;
    setFocusRequest((n) => n + 1);
  };
  useEffect(() => {
    const home = focusHome.current;
    if (focusRequest === 0 || home === null) return;
    focusHome.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return; // still in place
    const refs: Record<FocusHome, RefObject<HTMLHeadingElement | null>> = {
      pairs: pairsHomeRef,
      files: filesHomeRef,
    };
    refs[home].current?.focus();
  }, [focusRequest]);

  // ---- Fields (step 14.2) ----
  const { focalPx, cxPx, cyPx, k2 } = calibration;
  const k1Floor = useMemo(
    () => k1FloorFor(lens, widthPx, heightPx, { focalPx, cxPx, cyPx, k2 }),
    [lens, widthPx, heightPx, focalPx, cxPx, cyPx, k2],
  );
  const fields = calibrationFields({
    lens,
    widthPx,
    heightPx,
    defaultFocalPx: camera.defaults.focalPx,
    zenithLocked,
    k1Floor,
  });
  const [hfovMin, hfovMax] = hfovRangeDeg(lens, widthPx, camera.defaults.focalPx);
  const hfovSpec = { min: hfovMin, max: hfovMax, step: 0.01, decimals: 2, wraps: false } as const;
  const azNote = zenithLocked
    ? "Disabled while the camera points at the zenith: roll turns the image."
    : null;

  // ---- Star pairs (step 14.4) ----
  const pairsAvailable =
    frameTimeMs !== null && camera.kind !== "synthetic" && camera.kind !== "youtube";
  const model = useMemo(
    () => createCameraModel({ lens, calibration, widthPx, heightPx }),
    [lens, calibration, widthPx, heightPx],
  );
  const { site } = camera;
  const targets = useMemo(
    () =>
      open && pairsAvailable && frameTimeMs !== null
        ? catalogTargetsAt(rows, site, frameTimeMs)
        : ([] as CatalogTarget[]),
    [open, pairsAvailable, rows, site, frameTimeMs],
  );
  const byId = useMemo(() => targetsById(targets), [targets]);
  const projected = useMemo(() => projectTargets(model, targets), [model, targets]);
  const { pairs, pendingPx } = ui;
  const nearest = pendingPx === null ? [] : nearestTargets(projected, pendingPx[0], pendingPx[1]);
  const nameOf = (targetId: StarId | PlanetId): string =>
    byId.get(targetId)?.name ?? targetFallbackName(targetId);
  const fitPairCount = countFitPairs(pairs);

  // Announce a point set from the map, and what became of it (step 14.7).
  const lastPending = useRef(pendingPx);
  useEffect(() => {
    const was = lastPending.current;
    lastPending.current = pendingPx;
    if (pendingPx !== null) {
      setAnnouncement(pendingPointText(pendingPx));
    } else if (was !== null) {
      const made = pairs.find((p) => p.imagePx === was); // completePair stores the pending tuple itself
      const name =
        made === undefined
          ? ""
          : (byId.get(made.targetId)?.name ?? targetFallbackName(made.targetId));
      setAnnouncement(
        made === undefined
          ? "Point cleared."
          : `Pair added: ${name} (${made.role}). ${countFitPairs(pairs)} fit pairs.`,
      );
    }
  }, [pendingPx, pairs, byId]);

  const addPointAtViewCentre = (): void => {
    const centre = skyViewCentreImagePx(heightPx);
    if (
      centre === null ||
      !(centre[0] >= 0 && centre[0] <= widthPx && centre[1] >= 0 && centre[1] <= heightPx)
    ) {
      setAnnouncement(
        "The view centre is not on the image. Pan the sky view onto the image first.",
      );
      return;
    }
    actions.addImagePoint(centre[0], centre[1]);
  };

  // ---- Fit (step 14.5) ----
  const fitInput = (): PanelFitInput => ({
    lens,
    widthPx,
    heightPx,
    start: calibration,
    pairs,
    targets: byId,
    fitK1,
    fitTilt,
  });
  const runFit = (): void => {
    const outcome = runPanelFit(fitInput());
    let degByPair: ReadonlyMap<StarPair, number> = new Map();
    if (outcome.ok) {
      actions.applyFit(outcome.calibration, outcome.residualPx, outcome.rejected, outcome.fit);
      const after = store.getState().calibrationUi;
      if (after.fit !== outcome.fit) {
        // applyFit refused the calibration (distortionValid): nothing changed.
        setFitReport(null);
        setAnnouncement(
          "Fit failed: the fitted calibration was refused (its distortion folds the image).",
        );
        return;
      }
      degByPair = new Map(after.pairs.map((p, i) => [p, outcome.residualDeg[i] ?? Number.NaN])); // new pair objects
    }
    setFitReport({ outcome, degByPair });
    setAnnouncement(fitResultText(outcome));
  };
  const runComparison = (): void => {
    const rowsOut = compareLensModels(fitInput());
    setComparison(rowsOut);
    setAnnouncement(`Compared ${rowsOut.length} lens models. The registry is unchanged.`);
  };
  // A new image or camera clears the pairs and the stored fit summary; the last outcome goes with them.
  // "With fewer than 8 fit pairs the fit holds k1 (and a locked camera's tilt) and says so."
  const held = [...(fitK1 ? ["k1"] : []), ...(zenithLocked && fitTilt ? ["the tilt"] : [])];
  const heldNote =
    fitPairCount >= FIT_MIN_PAIRS && fitPairCount < FREE_FIT_MIN_PAIRS && held.length > 0
      ? `Fewer than ${FREE_FIT_MIN_PAIRS} fit pairs: the fit holds ${held.join(" and ")}.`
      : null;
  const lastOutcome =
    fitReport === null || pairs.length === 0 || (fitReport.outcome.ok && ui.fit === null)
      ? null
      : fitReport.outcome;

  // ---- Image time (step 14.3) ----
  const still = camera.kind === "still-image" ? camera : null;
  const estimated = frameTimeMs !== null && frameTimeMs !== enteredFrameTimeMs;
  const stampValue =
    stampDraft ??
    (frameTimeMs === null || still === null ? "" : impliedStampValue(still, frameTimeMs));
  const submitStamp = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (still === null) return;
    const timeMs = burnedInCaptureTimeMs(still, stampValue);
    if (timeMs === null) {
      setAnnouncement(
        `"${stampValue}" is not a time on the clock in ${site.timeZone} (an impossible date, or skipped by a daylight-saving change).`,
      );
      return;
    }
    actions.setFrameTimeMs(timeMs);
    setEnteredFrameTimeMs(timeMs);
    setStampDraft(null);
    setAnnouncement(`Image time set to ${isoUtcSeconds(timeMs)}.`);
  };

  // ---- Files (step 14.6) ----
  const exportJson = (): void => {
    const file = buildCalibrationFile(store.getState(), Date.now());
    if (file === null) return;
    const name = calibrationFileName(file.cameraId, file.exportedAtMs);
    downloadJsonFile(name, file);
    setFileProblems([]);
    setAnnouncement(`Calibration exported as ${name}.`);
  };
  const importJson = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.currentTarget;
    if (input.files?.[0] === undefined) return; // the file dialog was cancelled
    const text = await readChosenFile(input);
    if (text === null) {
      setAnnouncement("The file could not be read.");
      return;
    }
    const parsed = parseCalibrationFile(text, store.getState().camera.registry);
    if (!parsed.ok) {
      setFileProblems(parsed.errors);
      setAnnouncement(`Import failed: ${parsed.errors.join("; ")}.`);
      return;
    }
    const before = store.getState().camera.calibration;
    actions.importCalibration(parsed.file.cameraId, parsed.file.calibration);
    const applied = store.getState().camera.calibration !== before;
    const target = store.getState().camera.registry[parsed.file.cameraId]?.name ?? "the camera";
    setFileProblems([]);
    setAnnouncement(
      applied
        ? `Calibration imported for ${target}.`
        : `The calibration was not applied to ${target}.`,
    );
  };
  // [M9] Async: the first export loads ajv (M9 step 7).
  const exportGeoPose = async (): Promise<void> => {
    const built = await buildGeoPoseExport(camera, calibration);
    if (!built.ok) {
      setFileProblems(built.errors);
      setGeoPoseStatus("GeoPose not valid against the OGC schema: nothing saved.");
      setAnnouncement(`GeoPose export failed: ${built.errors.join("; ")}.`);
      return;
    }
    const name = geoPoseFileName(camera.id);
    downloadJsonFile(name, built.pose);
    setFileProblems([]);
    setGeoPoseStatus(`GeoPose valid against the OGC Basic-YPR schema; saved as ${name}.`);
    setAnnouncement(`GeoPose exported as ${name}.`);
  };
  const importGeoPose = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.currentTarget;
    if (input.files?.[0] === undefined) return; // the file dialog was cancelled
    const text = await readChosenFile(input);
    if (text === null) {
      setAnnouncement("The file could not be read.");
      return;
    }
    const parsed = await parseGeoPoseImport(text, camera);
    if (!parsed.ok) {
      setFileProblems(parsed.errors);
      setAnnouncement(`GeoPose import failed: ${parsed.errors.join("; ")}.`);
      return;
    }
    actions.updateCalibration(parsed.pointing);
    setFileProblems(parsed.warnings);
    const { azDeg, altDeg, rollDeg } = parsed.pointing;
    setAnnouncement(
      `GeoPose applied: azimuth ${azDeg.toFixed(2)}°, altitude ${altDeg.toFixed(2)}°, roll ${rollDeg.toFixed(2)}°.${parsed.warnings.length === 0 ? "" : ` ${parsed.warnings.join(" ")}`}`,
    );
  };

  return (
    <div>
      {/* ---- Header (step 14.1) ---- */}
      <p>
        Camera: {camera.name}. Lens: {LENS_TEXT[lens]}.
      </p>
      {imageSizeNotice === null ? null : <p>{imageSizeNotice}</p>}
      {fisheye && pairsAvailable ? (
        <>
          <p>
            <button type="button" disabled={fitPairCount < FIT_MIN_PAIRS} onClick={runComparison}>
              Compare lens models
            </button>
          </p>
          {comparison === null || pairs.length === 0 ? null : (
            <table>
              <caption>Lens models fitted to the same pairs</caption>
              <thead>
                <tr>
                  <th scope="col">Lens</th>
                  <th scope="col">RMS (°)</th>
                  <th scope="col">k1</th>
                  <th scope="col">Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ lens: l, outcome }) => (
                  <tr key={l}>
                    <th scope="row">
                      {LENS_TEXT[l]}
                      {l === lens ? " (this camera)" : ""}
                    </th>
                    {outcome.ok ? (
                      <>
                        <td>{outcome.fit.rmsDeg.toFixed(3)}</td>
                        <td>{outcome.calibration.k1.toFixed(4)}</td>
                        <td>{outcome.report.pass ? "Pass" : "Fail"}</td>
                      </>
                    ) : (
                      <td colSpan={3}>{outcome.message}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}

      {/* ---- [M5] Stream delay (M5 step 9), for YouTube cameras ---- */}
      {open && camera.kind === "youtube" ? (
        <StreamDelaySection camera={camera} actions={actions} announce={setAnnouncement} />
      ) : null}

      {/* ---- Pointing and lens (step 14.2) ---- */}
      <h3>Pointing and lens</h3>
      {fields.map((spec) => (
        <FieldRow
          key={spec.key}
          spec={spec}
          value={calibration[spec.key]}
          note={spec.key === "azDeg" ? azNote : null}
          onCommit={(value) => actions.updateCalibration(fieldPatch(spec.key, value))}
        />
      ))}
      <p>
        <label htmlFor={`${id}-hfov`}>{HFOV_LABEL}</label>{" "}
        <HfovInput
          id={`${id}-hfov`}
          spec={hfovSpec}
          value={hfovOf(lens, widthPx, calibration.focalPx)}
          onCommit={(hfov) => {
            const f = focalForHfovInput(lens, widthPx, hfov, camera.defaults.focalPx);
            if (f !== null) actions.updateCalibration({ focalPx: f });
          }}
        />
      </p>
      <p>
        Radial distortion k2 (no unit, set only by an import): <output>{fieldText(k2, 4)}</output>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={calibration.flipX}
            onChange={(e) => actions.updateCalibration({ flipX: e.currentTarget.checked })}
          />
          Mirrored image (flip x)
        </label>
      </p>

      {/* ---- Image time (step 14.3) ---- */}
      {still === null ? null : (
        <>
          <h3>Image time</h3>
          {frameTimeMs === null ? (
            <p>No image yet.</p>
          ) : (
            <>
              <p>
                UTC <time dateTime={isoUtcSeconds(frameTimeMs)}>{isoUtcSeconds(frameTimeMs)}</time>
                {estimated ? `, ${ESTIMATED_FRAME_TIME_TEXT}` : ""}
              </p>
              <p>
                {site.timeZone} {formatZonedDateTime(frameTimeMs, site.timeZone)}
                {estimated ? `, ${ESTIMATED_FRAME_TIME_TEXT}` : ""}
              </p>
              <p>Image frozen while calibrating.</p>
            </>
          )}
          <form onSubmit={submitStamp}>
            <label htmlFor={`${id}-stamp`}>Enter burned-in time</label>{" "}
            <input
              id={`${id}-stamp`}
              type="datetime-local"
              step={1}
              value={stampValue}
              aria-describedby={`${id}-stamp-rule`}
              onChange={(e) => setStampDraft(e.currentTarget.value)}
            />{" "}
            <button type="submit" disabled={stampValue === ""}>
              Set image time
            </button>
            <span id={`${id}-stamp-rule`}> {stampRuleText(still)}</span>
          </form>
        </>
      )}

      {/* ---- [M5] Satellite check (step 13): image cameras only; its toggle takes the map clicks ---- */}
      {camera.kind === "still-image" || camera.kind === "local-video" ? (
        <SatelliteCheck
          camera={camera}
          calibration={calibration}
          frameTimeMs={frameTimeMs}
          announce={setAnnouncement}
        />
      ) : null}

      {/* ---- Star pairs (step 14.4) ---- */}
      <h3 ref={pairsHomeRef} tabIndex={-1}>
        Star pairs
      </h3>
      {!pairsAvailable ? (
        <p>
          {camera.kind === "youtube"
            ? // [M5] Clicks on the video belong to the player.
              "Star pairs need a still image or a clip. Align by eye against the video, or calibrate a recorded clip of this camera and copy its pointing here."
            : "Star pairs need a camera image on screen."}
        </p>
      ) : (
        <>
          {stars === "ready" ? null : (
            <p>
              {stars === "error"
                ? "The star catalogue failed to load: planets only."
                : "Loading the star catalogue: planets only for now."}
            </p>
          )}
          <p>
            <button type="button" onClick={addPointAtViewCentre}>
              Add point at view centre
            </button>
          </p>
          {pendingPx === null ? null : (
            <>
              <p>
                Point at u {pendingPx[0].toFixed(1)}, v {pendingPx[1].toFixed(1)}. Nearest catalogue
                objects:
              </p>
              {nearest.length === 0 ? (
                <p>No catalogue object is in the frame with the current calibration.</p>
              ) : (
                <ul aria-label="Nearest catalogue objects">
                  {nearest.map((n) => (
                    <li key={n.target.id}>
                      <button
                        type="button"
                        onClick={() => {
                          actions.completePair(n.target.id);
                          keepFocus("pairs");
                        }}
                      >
                        {`${n.target.name}, ${n.distancePx.toFixed(1)} px away`}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p>
                <button
                  type="button"
                  onClick={() => {
                    actions.cancelImagePoint();
                    keepFocus("pairs");
                  }}
                >
                  Cancel point
                </button>
              </p>
            </>
          )}
          {pairs.length === 0 ? (
            <p>No pairs yet.</p>
          ) : (
            <table>
              <caption>
                {`${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"}, ${fitPairCount} for the fit`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col">Role</th>
                  <th scope="col">Residual (px)</th>
                  <th scope="col">Residual (°)</th>
                  <th scope="col">Rejected</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {pairOrder(pairs, sortByResidual).map((index) => {
                  const pair = pairs[index];
                  if (pair === undefined) return null;
                  const name = nameOf(pair.targetId);
                  return (
                    <tr key={pair.targetId}>
                      <th scope="row">{name}</th>
                      <td>
                        <select
                          aria-label={`Role of ${name}`}
                          value={pair.role}
                          onChange={(e) =>
                            actions.setPairRole(
                              index,
                              e.currentTarget.value === "holdout" ? "holdout" : "fit",
                            )
                          }
                        >
                          <option value="fit">Fit</option>
                          <option value="holdout">Holdout</option>
                        </select>
                      </td>
                      <td>{residualText(pair.residualPx, 2)}</td>
                      <td>{residualText(fitReport?.degByPair.get(pair), 3)}</td>
                      <td>{pair.rejected ? "Rejected" : "No"}</td>
                      <td>
                        <button
                          type="button"
                          aria-label={`Remove ${name}`}
                          onClick={() => {
                            actions.removePair(index);
                            keepFocus("pairs");
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p>
            <button
              type="button"
              aria-pressed={sortByResidual}
              disabled={pairs.length === 0}
              onClick={() => setSortByResidual((on) => !on)}
            >
              Sort by residual
            </button>{" "}
            <button
              type="button"
              disabled={pairs.length === 0 && pendingPx === null}
              onClick={() => {
                actions.clearPairs();
                setFitReport(null);
                keepFocus("pairs");
              }}
            >
              Clear pairs
            </button>
          </p>

          {/* ---- Fit (step 14.5) ---- */}
          <h3>Fit</h3>
          <p>
            <label>
              <input
                type="checkbox"
                checked={fitK1}
                onChange={(e) => setFitK1(e.currentTarget.checked)}
              />
              Fit k1
            </label>
            {zenithLocked ? (
              <>
                {" "}
                <label>
                  <input
                    type="checkbox"
                    checked={fitTilt}
                    onChange={(e) => setFitTilt(e.currentTarget.checked)}
                  />
                  Fit tilt
                </label>
              </>
            ) : null}
          </p>
          {heldNote === null ? null : <p>{heldNote}</p>}
          <p>
            <button
              type="button"
              disabled={fitPairCount < FIT_MIN_PAIRS}
              aria-describedby={`${id}-fit-needs`}
              onClick={runFit}
            >
              Fit
            </button>{" "}
            <span id={`${id}-fit-needs`}>
              {fitPairCount < FIT_MIN_PAIRS
                ? `Needs at least ${FIT_MIN_PAIRS} fit pairs (${fitPairCount} now).`
                : null}
            </span>
          </p>
          {ui.fit === null ? null : (
            <dl>
              <dt>RMS</dt>
              <dd>{`${ui.fit.rmsPx.toFixed(2)} px, ${ui.fit.rmsDeg.toFixed(3)}°`}</dd>
              <dt>Largest fit error</dt>
              <dd>{`${residualText(ui.fit.maxFitDeg, 3)}°`}</dd>
              <dt>Largest holdout error</dt>
              <dd>
                {ui.fit.maxHoldoutDeg === null
                  ? "No holdouts"
                  : `${residualText(ui.fit.maxHoldoutDeg, 3)}°`}
              </dd>
            </dl>
          )}
          {lastOutcome === null ? null : lastOutcome.ok ? (
            <ul aria-label="Acceptance checklist">
              {acceptanceChecklist(lens, lastOutcome.report).map((line) => (
                <li key={line.text}>{`${line.pass ? "Pass" : "Fail"}: ${line.text}`}</li>
              ))}
            </ul>
          ) : (
            <p>{lastOutcome.message}</p>
          )}
        </>
      )}

      {/* ---- Files (step 14.6) ---- */}
      <h3 ref={filesHomeRef} tabIndex={-1}>
        Files
      </h3>
      <p>
        {confirmingReset ? (
          <>
            {`Reset ${camera.name} to its default calibration? `}
            <button
              type="button"
              onClick={() => {
                actions.resetCalibration();
                setConfirmingReset(false);
                setAnnouncement("Calibration reset to the defaults.");
                keepFocus("files");
              }}
            >
              Confirm reset
            </button>{" "}
            <button
              type="button"
              onClick={() => {
                setConfirmingReset(false);
                keepFocus("files");
              }}
            >
              Keep calibration
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmingReset(true);
              keepFocus("files");
            }}
          >
            Reset
          </button>
        )}
      </p>
      {/* [M5] A clip's calibration goes to its source camera (step 10.7). */}
      <CopyClipPointing camera={camera} announce={setAnnouncement} />
      <p>
        <button type="button" onClick={exportJson}>
          Export JSON
        </button>{" "}
        <label>
          Import JSON <input type="file" accept=".json,application/json" onChange={importJson} />
        </label>
      </p>
      <p>
        <button type="button" onClick={exportGeoPose}>
          Export GeoPose
        </button>{" "}
        <label>
          Import GeoPose{" "}
          <input type="file" accept=".json,application/json" onChange={importGeoPose} />
        </label>
      </p>
      {geoPoseStatus === null ? null : <p>{geoPoseStatus}</p>}
      {fileProblems.length === 0 ? null : (
        <ul aria-label="File problems">
          {fileProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <p aria-live="polite">{announcement}</p>
    </div>
  );
}

/** The HFOV number input: keeps the typed text while focused, commits each value with a focal length in range. */
function HfovInput({
  id,
  spec,
  value,
  onCommit,
}: {
  readonly id: string;
  readonly spec: Pick<FieldSpec, "min" | "max" | "step" | "wraps" | "decimals">;
  readonly value: number;
  readonly onCommit: (hfovDeg: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={draft ?? fieldText(value, spec.decimals)}
      onChange={(e) => {
        const text = e.currentTarget.value;
        setDraft(text);
        const parsed = parseFieldInput(text, spec);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function CalibrationPanel() {
  const actions = useActions();
  const open = useAppState((s) => s.ui.panel === "calibration");
  const camera = useAppState(selectActiveCamera);
  const calibration = useAppState(selectCalibration);
  const ui = useAppState((s) => s.calibrationUi);
  const frameTimeMs = useAppState((s) => s.camera.frameTimeMs);
  const stars = useAppState((s) => s.data.stars);
  const panelId = useId();
  const kind = camera?.kind;

  // Opening the panel on a still-image camera switches to live, so the overlay is at frameTimeMs (M4 step 14).
  useEffect(() => {
    if (!open || kind !== "still-image") return;
    const { clock, actions: a } = store.getState();
    if (clock.mode !== "live") a.setMode("live");
  }, [open, kind]);

  return (
    <div className="calibration">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => actions.togglePanel("calibration")}
      >
        Calibration
      </button>
      <section id={panelId} className="panel" aria-label="Calibration" hidden={!open}>
        {camera === undefined || calibration === undefined ? (
          <p>Loading cameras.</p>
        ) : (
          <CalibrationPanelView
            key={camera.id}
            open={open}
            camera={camera}
            calibration={calibration}
            ui={ui}
            frameTimeMs={frameTimeMs}
            rows={stars === "ready" ? skyCache.rows : NO_ROWS}
            stars={stars}
            imageSizeNotice={
              backgroundImageSize.cameraId === camera.id
                ? imageSizeNotice(
                    backgroundImageSize.widthPx,
                    backgroundImageSize.heightPx,
                    camera.imageSize,
                  )
                : null
            }
            actions={actions}
          />
        )}
      </section>
    </div>
  );
}
