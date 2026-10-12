// src/ui/Inspector.tsx — the selected object: what it is, where it is, and its actions (M3 step 15.1). Live fields
// re-render only through useTick4Hz and read ephemeris and skyCache during render (React rule 5). Imports no
// OpenLayers module (README import rule 4). Layout and look are visual design, settled from screenshots.
import type { ReactNode } from "react";
import { registry } from "../map/registry";
import { ephemeris, indexOfObjectId } from "../state/ephemeris";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectHorizonProfileDeg, selectHorizonStatus } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import type { ObjectId } from "../state/types";
import { inspectorIncomingText } from "./incomingText";
import {
  altText,
  azText,
  bodyMagnitudeText,
  dockedText,
  elementAgeText,
  GROUP_LABELS,
  litText,
  missingSatelliteText,
  type ObjectDetails,
  objectDetails,
  rangeText,
  satelliteGroupsPending,
  starMagnitudeText,
  terrainLines,
  visibilityText,
} from "./objectText";

const EMPTY_TEXT =
  "Nothing selected. Click an object in either view, or use the list of satellites above the horizon.";
const SHOW_ON_MAP_MS = 500;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Centres the ground map on the satellite's position in this frame: animated over 500 ms, or at once with reduced
 * motion. The view is not wrapped, so it goes to the world copy nearest its centre.
 */
function showOnMap(id: ObjectId): void {
  const view = registry.get("ground")?.getView();
  const i = indexOfObjectId(id);
  const { frame } = ephemeris;
  if (view === undefined || i === null || !frame.ready || ((frame.flags[i] ?? 0) & 1) === 0) return;
  let x = frame.mercator[2 * i] ?? Number.NaN;
  const y = frame.mercator[2 * i + 1] ?? Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const extent = view.getProjection().getExtent();
  const worldWidth = (extent[2] ?? 0) - (extent[0] ?? 0);
  const centerX = view.getCenter()?.[0];
  if (worldWidth > 0 && centerX !== undefined) {
    x += worldWidth * Math.round((centerX - x) / worldWidth);
  }
  if (window.matchMedia(REDUCED_MOTION).matches) view.setCenter([x, y]);
  else view.animate({ center: [x, y], duration: SHOW_ON_MAP_MS });
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
}

/** The text of one object's details, in reading order after its name. */
function detailLines(d: Exclude<ObjectDetails, { kind: "missing-satellite" }>): string[] {
  const state = store.getState();
  const simTimeMs = state.clock.simTimeMs;
  // [M6] The terrain horizon at the object's azimuth, and "Behind terrain"; read during the 4 Hz render.
  const terrain = (live: { azDeg: number; altDeg: number } | null): string[] =>
    live === null
      ? []
      : terrainLines(
          selectHorizonStatus(state),
          selectHorizonProfileDeg(state),
          live.azDeg,
          live.altDeg,
        );
  switch (d.kind) {
    case "satellite": {
      const lines = [`NORAD ${d.noradId}`, GROUP_LABELS[d.group]];
      if (d.dockedTo !== null) {
        lines.push(
          `Docked to ${d.dockedTo.name} (NORAD ${d.dockedTo.noradId}), shown at its position`,
        );
      }
      if (d.live === null) {
        lines.push(d.note ?? "");
      } else {
        lines.push(
          `${azText(d.live.azDeg)}, ${altText(d.live.altDeg)} (apparent)`,
          `Range ${rangeText(d.live.rangeKm)}`,
          litText(d.live.sunlit),
          visibilityText(d.live, d.group),
          ...terrain(d.live),
        );
      }
      // [M8] In the latest incoming reply: N counted as the chip counts it (a docked id reads its host's entry).
      const incoming = inspectorIncomingText(
        ephemeris.incoming,
        indexOfObjectId(`sat:${d.noradId}`),
        simTimeMs,
      );
      if (incoming !== null) lines.push(incoming);
      lines.push(elementAgeText(d.epochMs, simTimeMs));
      if (d.docked.length > 0) lines.push(dockedText(d.docked));
      return lines;
    }
    case "star": {
      const lines = d.label === `HR ${d.hr}` ? ["Star"] : [`Star, HR ${d.hr}`];
      if (d.vmag !== null) lines.push(starMagnitudeText(d.vmag));
      lines.push(
        d.live === null ? (d.note ?? "") : `${azText(d.live.azDeg)}, ${altText(d.live.altDeg)}`,
        ...terrain(d.live),
      );
      return lines;
    }
    case "body":
      return d.live === null
        ? [d.note ?? ""]
        : [
            `${azText(d.live.azDeg)}, ${altText(d.live.altDeg)}`,
            bodyMagnitudeText(d.live.mag),
            ...terrain(d.live),
          ];
  }
}

export function Inspector() {
  useTick4Hz(); // live fields (React rule 5)
  const selectedId = useAppState((s) => s.selection.selectedId);
  const follow = useAppState((s) => s.selection.follow);
  const gp = useAppState((s) => s.data.gp); // replaced only by setGroupData
  const actions = useActions();

  const clear = (
    <button type="button" onClick={() => actions.select(null)}>
      Clear selection
    </button>
  );

  let body: ReactNode;
  if (selectedId === null) {
    body = <p>{EMPTY_TEXT}</p>;
  } else {
    const d = objectDetails(selectedId, {
      catalog: ephemeris.catalog,
      frame: ephemeris.frame,
      sky: skyCache,
    });
    if (d.kind === "missing-satellite") {
      body = (
        <>
          <h3>{`NORAD ${d.noradId}`}</h3>
          <p>
            {satelliteGroupsPending(gp)
              ? "Loading orbital elements…"
              : missingSatelliteText(d.noradId)}
          </p>
          <p>{clear}</p>
        </>
      );
    } else {
      body = (
        <>
          <h3>{d.kind === "satellite" ? d.name : d.label}</h3>
          <Lines lines={detailLines(d)} />
          <p>
            {d.kind === "satellite" ? (
              <>
                <button
                  type="button"
                  disabled={d.live === null}
                  onClick={() => showOnMap(selectedId)}
                >
                  Show on map
                </button>{" "}
                <button
                  type="button"
                  aria-pressed={follow}
                  onClick={() => actions.setFollow(!follow)}
                >
                  Follow
                </button>{" "}
              </>
            ) : null}
            {clear}
          </p>
        </>
      );
    }
  }

  return (
    <section aria-label="Inspector" className="inspector">
      <h2 className="pane-title">Inspector</h2>
      {body}
    </section>
  );
}
