// src/ui/HoverCard.tsx — the hovered object in plain words (M3 step 15.2; redesign spec section 3): its friendly name,
// where to look and whether it can be seen, as the object card says them (cardText.ts). SkyView portals it into the sky
// map's hover overlay element (createPortal), so this file imports no OpenLayers module. role="tooltip", not a live
// region: it changes at 4 Hz (README Accessibility rule 4). The look is the class "hover-card" plus a kind class.
import { ephemeris } from "../state/ephemeris";
import { useAppState, useTick4Hz } from "../state/hooks";
import { selectHorizonProfileDeg, selectHorizonStatus } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import { cardText, hoverLines } from "./cardText";
import { objectDetails, satelliteGroupsPending } from "./objectText";

/** Renders nothing while nothing is hovered. */
export function HoverCard() {
  useTick4Hz(); // live fields (React rule 5)
  const hoverId = useAppState((s) => s.selection.hoverId);
  const gp = useAppState((s) => s.data.gp); // replaced only by setGroupData
  if (hoverId === null) return null;
  const state = store.getState();
  const card = cardText(
    hoverId,
    objectDetails(hoverId, { catalog: ephemeris.catalog, frame: ephemeris.frame, sky: skyCache }),
    {
      simTimeMs: state.clock.simTimeMs,
      pending: satelliteGroupsPending(gp),
      horizonStatus: selectHorizonStatus(state),
      horizonProfileDeg: selectHorizonProfileDeg(state),
      heightKm: null, // the tooltip shows no details
      incomingText: null,
    },
  );
  return (
    <div role="tooltip" className={`hover-card ${card.className}`}>
      <strong>{card.name}</strong>
      {hoverLines(card).map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
