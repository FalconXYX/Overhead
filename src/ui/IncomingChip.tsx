// src/ui/IncomingChip.tsx — satellites that enter the camera frame within 60 s (M8 step 9.2), in plain words: "ISS
// appears in 35 s" (redesign spec section 2). A page element mounted by the shell at all times, outside the sky stage
// (O1: it never covers the player's controls). Two entries can share a name (gotcha 14): each button carries its
// object id in data-object-id, and the list is keyed by NORAD id. Re-renders only through useTick4Hz and reads
// ephemeris.incoming, the catalogue and store.getState() during render (React rule 5). Nothing animates.
import { type CSSProperties, useState } from "react";
import { ephemeris } from "../state/ephemeris";
import { useActions, useAppState, useTick4Hz } from "../state/hooks";
import { selectClipWaiting, selectIncomingActive, selectIncomingMask } from "../state/selectors";
import { store } from "../state/store";
import type { ObjectId } from "../state/types";
import {
  INCOMING_PAUSED_TEXT,
  INCOMING_SHOWN,
  type IncomingAnnouncement,
  type IncomingRow,
  incomingButtonName,
  incomingButtonText,
  incomingMoreText,
  incomingRows,
  NO_ANNOUNCEMENT,
  nextAnnouncement,
} from "./incomingText";

/** Off screen but read by screen readers: the chip with nothing to show. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
// [M9] The chip's look is the class "incoming" in src/app/layout.css (visual design, step 12).

export interface IncomingChipViewProps {
  readonly rows: readonly IncomingRow[];
  /** Alerts pause while playing at 60× or 600× (with a satellite layer on). */
  readonly paused: boolean;
  readonly selectedId: ObjectId | null;
  readonly announcement: string;
  readonly onSelect: (id: ObjectId) => void;
}

/** The chip from its inputs (unit tests render this). */
export function IncomingChipView({
  rows,
  paused,
  selectedId,
  announcement,
  onSelect,
}: IncomingChipViewProps) {
  const shown = rows.slice(0, INCOMING_SHOWN);
  const more = rows.length - shown.length;
  const empty = !paused && rows.length === 0;
  return (
    <section
      aria-label="Incoming satellites"
      data-testid="incoming-chip"
      style={empty ? VISUALLY_HIDDEN : undefined}
      className="incoming"
    >
      {paused ? <p>{INCOMING_PAUSED_TEXT}</p> : null}
      {shown.length > 0 ? (
        <ul>
          {shown.map((row) => {
            const id: ObjectId = `sat:${row.noradId}`;
            return (
              <li key={row.noradId}>
                <button
                  type="button"
                  aria-label={incomingButtonName(row)}
                  aria-pressed={selectedId === id}
                  data-object-id={id}
                  onClick={() => onSelect(id)}
                >
                  {incomingButtonText(row)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {more > 0 ? <p>{incomingMoreText(more)}</p> : null}
      {/* Mounted even when empty; its text changes only for a new first entry (gotcha 13). */}
      <p aria-live="polite" style={VISUALLY_HIDDEN}>
        {announcement}
      </p>
    </section>
  );
}

export function IncomingChip() {
  useTick4Hz(); // the countdown (React rule 5)
  const selectedId = useAppState((s) => s.selection.selectedId);
  const actions = useActions();
  const state = store.getState();
  // Both satellite layers off: empty, like no entries. Playing at 60× or 600×: the pause note. Both are read here
  // too, not only by the incoming client, so the chip changes in the same render as the toggle or the rate.
  const mask = selectIncomingMask(state);
  const paused = mask !== 0 && !selectIncomingActive(state);
  // [Redesign] Before the recorded clip has loaded, the clock still reads the page's opening time: nothing the camera
  // will show, so nothing to list or announce.
  const rows =
    mask === 0 || paused || selectClipWaiting(state)
      ? []
      : incomingRows(ephemeris.incoming, ephemeris.catalog, state.clock.simTimeMs);
  // The live region changes only for a new first NORAD id: state adjusted during render (React's pattern for
  // information from earlier renders), so the new text commits with the new entry.
  const [announcement, setAnnouncement] = useState<IncomingAnnouncement>(NO_ANNOUNCEMENT);
  const next = nextAnnouncement(announcement, rows[0]);
  if (next !== announcement) setAnnouncement(next);
  return (
    <IncomingChipView
      rows={rows}
      paused={paused}
      selectedId={selectedId}
      announcement={announcement.text}
      onSelect={actions.select}
    />
  );
}
