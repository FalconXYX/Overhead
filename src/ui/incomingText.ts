// src/ui/incomingText.ts — the text of the incoming chip, the object card's incoming line and the footprint controls
// (M8 step 9), shared by IncomingChip, ObjectCard and LayerToggles. A component file that also exports functions is
// not a Fast Refresh boundary (as objectText.ts, M3). [Redesign] Friendly names ("ISS appears in 35 s"); the NORAD id
// stays out of the text.
import { friendlySatellite } from "./friendly";

/** The parts of an `incoming` reply the text reads (ephemeris.incoming). */
export interface IncomingReplyView {
  readonly timeMs: number;
  readonly entries: readonly { readonly index: number; readonly etaSec: number }[];
}
/** The parts of the satellite catalogue the text reads (ephemeris.catalog). */
export interface IncomingCatalogView {
  readonly noradIds: ArrayLike<number>;
  readonly names: readonly string[];
}

/** One chip entry: who, and "in N s". */
export interface IncomingRow {
  readonly index: number;
  readonly noradId: number;
  /** friendly.ts's name: "International Space Station". */
  readonly name: string;
  /** friendly.ts's short name: "ISS". */
  readonly shortName: string;
  readonly seconds: number;
}

/** Entries shown as buttons; the rest are counted. */
export const INCOMING_SHOWN = 3;
export const INCOMING_PAUSED_TEXT = "Alerts pause while the clock runs fast.";

/**
 * N = ⌈max(0, etaSec − (simTimeMs − replyTimeMs)/1000)⌉: equal to etaSec while paused, counting down between the 1 Hz
 * replies while playing. etaSec is an upper bound (5 s sampling), so the text says "within".
 */
export function incomingSeconds(etaSec: number, simTimeMs: number, replyTimeMs: number): number {
  return Math.ceil(Math.max(0, etaSec - (simTimeMs - replyTimeMs) / 1000));
}

/** Every entry of the reply, in its order (etaSec, then index), with friendly names and the NORAD id. */
export function incomingRows(
  reply: IncomingReplyView | null,
  catalog: IncomingCatalogView,
  simTimeMs: number,
): IncomingRow[] {
  if (reply === null) return [];
  return reply.entries.map((e) => {
    const friendly = friendlySatellite(catalog.names[e.index] ?? "");
    return {
      index: e.index,
      noradId: catalog.noradIds[e.index] ?? 0,
      name: friendly.name,
      shortName: friendly.shortName,
      seconds: incomingSeconds(e.etaSec, simTimeMs, reply.timeMs),
    };
  });
}

/** Visible text of an entry: "ISS appears in 35 s". */
export function incomingButtonText(row: IncomingRow): string {
  return `${row.shortName} appears in ${row.seconds} s`;
}

/** Accessible name of an entry: the visible words, with seconds spelt out: "ISS appears in 35 seconds". */
export function incomingButtonName(row: IncomingRow): string {
  return `${row.shortName} appears in ${row.seconds} seconds`;
}

/** After the first INCOMING_SHOWN entries: "and K more". */
export function incomingMoreText(more: number): string {
  return `and ${more} more`;
}

/** The live region's text for a new first entry (gotcha 13: never the countdown). */
export function incomingAnnouncement(row: IncomingRow): string {
  return `${row.name} will appear in the camera view in about ${row.seconds} seconds.`;
}

/** The object card's line for a selected satellite in the latest reply, or null when it is not incoming. */
export function inspectorIncomingText(
  reply: IncomingReplyView | null,
  index: number | null,
  simTimeMs: number,
): string | null {
  if (reply === null || index === null) return null;
  const entry = reply.entries.find((e) => e.index === index);
  return entry === undefined
    ? null
    : `Comes into the camera view in ${incomingSeconds(entry.etaSec, simTimeMs, reply.timeMs)} s`;
}

// ---- the footprint controls (LayerToggles)

export const FOOTPRINT_TOGGLE_LABEL = "Camera view at orbit height";
export const FOOTPRINT_HEIGHT_LABEL = "Orbit height for the camera view";
export const FOOTPRINT_NOTE = "Exact only for satellites at this height";
export const FOOTPRINT_NOTHING_TEXT =
  "Nothing to draw at this height: the camera sees no sky above the horizon, or the view would cover a pole.";

/** "Selected satellite (422 km)", or "Selected satellite (none: 420 km)" when no satellite height is known. */
export function selectedHeightOptionText(heightKm: number | null, fallbackKm: number): string {
  return heightKm === null
    ? `Selected satellite (none: ${fallbackKm} km)`
    : `Selected satellite (${Math.round(heightKm)} km)`;
}

/** What the chip's live region says, and for which first entry. */
export interface IncomingAnnouncement {
  readonly noradId: number | null;
  readonly text: string;
}
export const NO_ANNOUNCEMENT: IncomingAnnouncement = { noradId: null, text: "" };

/**
 * The live region's next state: a new text only when the first entry's NORAD id is a new id; otherwise `prev` itself
 * (the countdown and an empty list never change it, gotcha 13).
 */
export function nextAnnouncement(
  prev: IncomingAnnouncement,
  first: IncomingRow | undefined,
): IncomingAnnouncement {
  if (first === undefined || first.noradId === prev.noradId) return prev;
  return { noradId: first.noradId, text: incomingAnnouncement(first) };
}
