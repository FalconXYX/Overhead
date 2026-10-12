// src/ui/HoverCard.tsx — details of the hovered object (M3 step 15.2), in the Inspector's formats. SkyView portals it
// into the sky map's hover overlay element (createPortal), so this file imports no OpenLayers module. role="tooltip",
// not a live region: it changes at 4 Hz (README Accessibility rule 4). Look is visual design, settled from screenshots.
import { ephemeris } from "../state/ephemeris";
import { useAppState, useTick4Hz } from "../state/hooks";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import {
  altText,
  azText,
  bodyMagnitudeText,
  isStale,
  litText,
  missingSatelliteText,
  type ObjectDetails,
  objectDetails,
  rangeText,
  satelliteGroupsPending,
  starMagnitudeText,
} from "./objectText";

/** Name first, then e.g. "NORAD 25544", "az 123.8°", "alt 28.9°", "795 km", "Sunlit", "Stale elements". */
function cardLines(d: ObjectDetails, simTimeMs: number, pending: boolean): string[] {
  switch (d.kind) {
    case "missing-satellite":
      return [
        `NORAD ${d.noradId}`,
        pending ? "Loading orbital elements…" : missingSatelliteText(d.noradId),
      ];
    case "satellite": {
      const lines = [d.name, `NORAD ${d.noradId}`];
      if (d.live === null) {
        lines.push(d.note ?? "");
      } else {
        lines.push(
          azText(d.live.azDeg),
          altText(d.live.altDeg),
          rangeText(d.live.rangeKm),
          litText(d.live.sunlit),
        );
      }
      if (isStale(d.epochMs, simTimeMs)) lines.push("Stale elements");
      return lines;
    }
    case "star": {
      const lines = [d.label];
      if (d.live === null) lines.push(d.note ?? "");
      else lines.push(azText(d.live.azDeg), altText(d.live.altDeg));
      if (d.vmag !== null) lines.push(starMagnitudeText(d.vmag));
      return lines;
    }
    case "body":
      return d.live === null
        ? [d.label, d.note ?? ""]
        : [d.label, azText(d.live.azDeg), altText(d.live.altDeg), bodyMagnitudeText(d.live.mag)];
  }
}

/** Renders nothing while nothing is hovered. */
export function HoverCard() {
  useTick4Hz(); // live fields (React rule 5)
  const hoverId = useAppState((s) => s.selection.hoverId);
  const gp = useAppState((s) => s.data.gp); // replaced only by setGroupData
  if (hoverId === null) return null;
  const details = objectDetails(hoverId, {
    catalog: ephemeris.catalog,
    frame: ephemeris.frame,
    sky: skyCache,
  });
  const [name, ...rest] = cardLines(
    details,
    store.getState().clock.simTimeMs,
    satelliteGroupsPending(gp),
  );
  return (
    <div role="tooltip">
      <strong>{name}</strong>
      {rest.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
