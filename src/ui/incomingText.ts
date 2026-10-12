// src/ui/incomingText.ts — the text of the incoming chip, the Inspector's incoming line and the footprint controls
// (M8 step 9), shared by IncomingChip, Inspector and LayerToggles. A component file that also exports functions is
// not a Fast Refresh boundary (as objectText.ts, M3).

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

/** One chip entry: who, and "within N s". */
export interface IncomingRow {
  readonly index: number;
  readonly noradId: number;
  readonly name: string;
  readonly seconds: number;
}

/** Entries shown as buttons; the rest are counted. */
export const INCOMING_SHOWN = 3;
export const INCOMING_PAUSED_TEXT = "Incoming alerts pause at 60× and 600×.";

/**
 * N = ⌈max(0, etaSec − (simTimeMs − replyTimeMs)/1000)⌉: equal to etaSec while paused, counting down between the 1 Hz
 * replies while playing. etaSec is an upper bound (5 s sampling), so the text says "within".
 */
export function incomingSeconds(etaSec: number, simTimeMs: number, replyTimeMs: number): number {
  return Math.ceil(Math.max(0, etaSec - (simTimeMs - replyTimeMs) / 1000));
}

/** Every entry of the reply, in its order (etaSec, then index), with the catalogue's name and NORAD id. */
export function incomingRows(
  reply: IncomingReplyView | null,
  catalog: IncomingCatalogView,
  simTimeMs: number,
): IncomingRow[] {
  if (reply === null) return [];
  return reply.entries.map((e) => {
    const noradId = catalog.noradIds[e.index] ?? 0;
    const name = catalog.names[e.index] || `NORAD ${noradId}`;
    return {
      index: e.index,
      noradId,
      name,
      seconds: incomingSeconds(e.etaSec, simTimeMs, reply.timeMs),
    };
  });
}

/** Visible text of an entry: "ISS (ZARYA) · 35 s". */
export function incomingButtonText(row: IncomingRow): string {
  return `${row.name} · ${row.seconds} s`;
}

/** Accessible name of an entry: "ISS (ZARYA), NORAD 25544, enters the view within 35 seconds". */
export function incomingButtonName(row: IncomingRow): string {
  return `${row.name}, NORAD ${row.noradId}, enters the view within ${row.seconds} seconds`;
}

/** After the first INCOMING_SHOWN entries: "and K more". */
export function incomingMoreText(more: number): string {
  return `and ${more} more`;
}

/** The live region's text for a new first entry (gotcha 13: never the countdown). */
export function incomingAnnouncement(row: IncomingRow): string {
  return `${row.name} will enter the view within ${row.seconds} seconds.`;
}

/** The Inspector's line for a selected satellite in the latest reply, or null when it is not incoming. */
export function inspectorIncomingText(
  reply: IncomingReplyView | null,
  index: number | null,
  simTimeMs: number,
): string | null {
  if (reply === null || index === null) return null;
  const entry = reply.entries.find((e) => e.index === index);
  return entry === undefined
    ? null
    : `Enters the view within ${incomingSeconds(entry.etaSec, simTimeMs, reply.timeMs)} s`;
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
