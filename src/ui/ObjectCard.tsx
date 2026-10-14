// src/ui/ObjectCard.tsx — the floating card for the selected object (redesign spec section 2): its friendly name, what
// it is, where to look and whether it can be seen, "Show on map" and "Follow" for satellites, a Close button, and the
// technical facts behind "More details". Renders nothing while nothing is selected. Live fields re-render only through
// useTick4Hz and read ephemeris and skyCache during render (React rule 5). Imports no OpenLayers module (README import
// rule 4). The look is the class "object-card" plus a kind class (kind-iss, kind-satellite, …) in the app's CSS.
import { registry } from "../map/registry";
import { ephemeris, heightKmOf, indexOfObjectId } from "../state/ephemeris";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectHorizonProfileDeg, selectHorizonStatus } from "../state/selectors";
import { skyCache } from "../state/skyCache";
import { store } from "../state/store";
import type { ObjectId } from "../state/types";
import { type CardText, cardText } from "./cardText";
import { inspectorIncomingText } from "./incomingText";
import { objectDetails, satelliteGroupsPending } from "./objectText";

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

export interface ObjectCardViewProps {
  readonly card: CardText;
  readonly follow: boolean;
  readonly onClose: () => void;
  readonly onShowOnMap: () => void;
  readonly onToggleFollow: () => void;
}

/** The card from its text (unit tests render this). */
export function ObjectCardView({
  card,
  follow,
  onClose,
  onShowOnMap,
  onToggleFollow,
}: ObjectCardViewProps) {
  return (
    <section
      aria-label="Selected object"
      data-testid="object-card"
      data-object-id={card.id}
      className={`object-card ${card.className}`}
    >
      <div className="object-card-head">
        <span aria-hidden="true" className={`kind-dot ${card.className}`} />
        <h2 className="object-card-name">{card.name}</h2>
        <button
          type="button"
          className="object-card-close"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {card.description === "" ? null : <p className="object-card-what">{card.description}</p>}
      {card.where === null ? null : <p className="object-card-where">{card.where}</p>}
      {card.visibility === null ? null : (
        <p className="object-card-visibility">{card.visibility}</p>
      )}
      {card.note === null ? null : <p className="object-card-note">{card.note}</p>}
      {card.onMap ? (
        <div className="object-card-actions">
          <button type="button" disabled={!card.hasPosition} onClick={onShowOnMap}>
            Show on map
          </button>
          <button type="button" aria-pressed={follow} onClick={onToggleFollow}>
            Follow
          </button>
        </div>
      ) : null}
      {card.details.length === 0 ? null : (
        <details className="object-card-details">
          <summary>More details</summary>
          <ul>
            {card.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function ObjectCard() {
  useTick4Hz(); // live fields (React rule 5)
  const selectedId = useAppState((s) => s.selection.selectedId);
  const follow = useAppState((s) => s.selection.follow);
  const gp = useAppState((s) => s.data.gp); // replaced only by setGroupData
  const actions = useActions();
  if (selectedId === null) return null;

  const state = store.getState();
  const simTimeMs = state.clock.simTimeMs;
  const index = indexOfObjectId(selectedId); // a docked id reads its host's row
  const card = cardText(
    selectedId,
    objectDetails(selectedId, {
      catalog: ephemeris.catalog,
      frame: ephemeris.frame,
      sky: skyCache,
    }),
    {
      simTimeMs,
      pending: satelliteGroupsPending(gp),
      horizonStatus: selectHorizonStatus(state),
      horizonProfileDeg: selectHorizonProfileDeg(state),
      heightKm: index === null ? null : heightKmOf(index),
      // [M8] In the latest incoming reply: counted as the chip counts it.
      incomingText: inspectorIncomingText(ephemeris.incoming, index, simTimeMs),
    },
  );
  return (
    <ObjectCardView
      card={card}
      follow={follow}
      onClose={() => actions.select(null)}
      onShowOnMap={() => showOnMap(selectedId)}
      onToggleFollow={() => actions.setFollow(!follow)}
    />
  );
}
