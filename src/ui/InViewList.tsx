// src/ui/InViewList.tsx — the keyboard path to everything drawn in the camera's view (redesign spec section 2): two
// lists of buttons, satellites (highest first) and then the Sun, Moon and planets, each with its friendly name and a
// plain position; a button selects its object. The control bar shows it in the [In view (N)] popover. Keyed by object
// id so focus survives the 4 Hz re-render. Colour comes from the kind classes (kind-iss, kind-satellite, …).
import { useId } from "react";
import { useActions, useAppState } from "../state/hooks";
import type { LoadStatus, ObjectId } from "../state/types";
import { type InView, type InViewItem, inViewItemLabel, useInView } from "./inView";

/** "Loading satellites…" or "Couldn't load the satellites" for the stations and visual groups; else null. */
function satelliteStatusText(stations: LoadStatus, visual: LoadStatus): string | null {
  if (stations === "error" || visual === "error") return "Couldn't load the satellites";
  if (stations !== "ready" || visual !== "ready") return "Loading satellites…";
  return null;
}

function Items({
  items,
  labelledBy,
  onSelect,
}: {
  readonly items: readonly InViewItem[];
  readonly labelledBy: string;
  readonly onSelect: (id: ObjectId) => void;
}) {
  return (
    <ul aria-labelledby={labelledBy} className="in-view-items">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={`in-view-item ${item.className}`}
            aria-label={inViewItemLabel(item)}
            aria-pressed={item.selected}
            data-object-id={item.id}
            onClick={() => onSelect(item.id)}
          >
            <span aria-hidden="true" className={`kind-dot ${item.className}`} />
            <span className="in-view-name">{item.name}</span>
            <span className="in-view-position">{item.position}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface InViewListViewProps {
  readonly view: InView;
  /** Shown instead of the empty-list text while the stations and visual groups load or fail. */
  readonly satelliteStatus: string | null;
  readonly onSelect: (id: ObjectId) => void;
}

/** The lists from their inputs (unit tests render this). */
export function InViewListView({ view, satelliteStatus, onSelect }: InViewListViewProps) {
  const satellitesId = useId();
  const bodiesId = useId();
  const { satellites, starlinkCount, bodies } = view;
  return (
    <div className="in-view-list" data-testid="in-view-list">
      <h3 id={satellitesId}>Satellites</h3>
      <Items items={satellites ?? []} labelledBy={satellitesId} onSelect={onSelect} />
      {starlinkCount > 0 ? (
        <p className="in-view-more">
          and {starlinkCount.toLocaleString("en-US")} Starlink{" "}
          {starlinkCount === 1 ? "satellite" : "satellites"}
        </p>
      ) : null}
      {satelliteStatus !== null ? (
        <p className="in-view-empty">{satelliteStatus}</p>
      ) : satellites !== null && satellites.length === 0 && starlinkCount === 0 ? (
        <p className="in-view-empty">No satellites in view right now</p>
      ) : null}
      <h3 id={bodiesId}>Planets, Moon and Sun</h3>
      <Items items={bodies ?? []} labelledBy={bodiesId} onSelect={onSelect} />
      {bodies !== null && bodies.length === 0 ? (
        <p className="in-view-empty">No planets, Moon or Sun in view right now</p>
      ) : null}
    </div>
  );
}

export function InViewList() {
  useAppState((s) => s.selection.selectedId); // a new selection re-renders aria-pressed at once
  const view = useInView(); // 4 Hz; reads the selection from the store
  const stations = useAppState((s) => s.data.gp.stations.status);
  const visual = useAppState((s) => s.data.gp.visual.status);
  const actions = useActions();
  return (
    <InViewListView
      view={view}
      satelliteStatus={satelliteStatusText(stations, visual)}
      onSelect={actions.select}
    />
  );
}
