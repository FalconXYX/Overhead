// src/ui/cardText.ts — what the object card and the hover card say about one object (redesign spec sections 2 and 3):
// the friendly name, one line on what it is, where to look, whether it can be seen, and the technical "More details".
// Pure: the components gather the live inputs (ephemeris, skyCache, the store) and pass them in.
import type { LoadStatus, ObjectId } from "../state/types";
import {
  friendlyBody,
  friendlySatellite,
  friendlyStar,
  type KindClass,
  whereToLook,
  withThe,
} from "./friendly";
import {
  behindTerrain,
  bodyMagnitudeText,
  directionText,
  dockedText,
  elementAgeText,
  GROUP_LABELS,
  heightText,
  missingSatelliteText,
  type ObjectDetails,
  rangeText,
  satelliteVisibilityText,
  speedText,
  starMagnitudeText,
  terrainLines,
} from "./objectText";

export interface CardText {
  readonly id: ObjectId;
  /** "International Space Station", "Spent rocket stage (SL-3)", "Jupiter (planet)". */
  readonly name: string;
  /** One line on what it is; "" when there is nothing to say yet. */
  readonly description: string;
  readonly className: KindClass;
  /** "High in the south-east"; null without a position. */
  readonly where: string | null;
  /** "Lit by the Sun, visible to the eye", "Behind the mountains"; null when where already says it all. */
  readonly visibility: string | null;
  /** Why there is no position, or what a docked vehicle's position means. */
  readonly note: string | null;
  /** A satellite: the card offers "Show on map" and "Follow". */
  readonly onMap: boolean;
  /** It has a position in this frame ("Show on map" has somewhere to go). */
  readonly hasPosition: boolean;
  /** The "More details" lines: NORAD id, height, range, speed, direction, element age and so on. */
  readonly details: readonly string[];
}

/** Live inputs the details need beyond objectDetails. */
export interface CardContext {
  readonly simTimeMs: number;
  /** satelliteGroupsPending: a missing satellite may still arrive. */
  readonly pending: boolean;
  readonly horizonStatus: LoadStatus;
  readonly horizonProfileDeg: Float32Array | null;
  /** heightKmOf the object's row (its host's when docked); null without a position. */
  readonly heightKm: number | null;
  /** inspectorIncomingText for the object, or null. */
  readonly incomingText: string | null;
}

/** The terrain profile behind-the-mountains checks may use: only a ready one. */
const readyProfile = (ctx: CardContext): Float32Array | null =>
  ctx.horizonStatus === "ready" ? ctx.horizonProfileDeg : null;

/** Where to look and whether it can be seen, for a star or a body (they are always lit). */
function skyObjectLines(
  live: { readonly azDeg: number; readonly altDeg: number } | null,
  ctx: CardContext,
): { where: string | null; visibility: string | null } {
  if (live === null) return { where: null, visibility: null };
  const behind = live.altDeg >= 0 && behindTerrain(readyProfile(ctx), live.azDeg, live.altDeg);
  return {
    where: whereToLook(live.azDeg, live.altDeg),
    visibility: behind ? "Behind the mountains" : null,
  };
}

/** Everything the card shows for one object, from objectDetails and the live context. */
export function cardText(id: ObjectId, d: ObjectDetails, ctx: CardContext): CardText {
  const terrain = (live: { readonly azDeg: number; readonly altDeg: number } | null): string[] =>
    live === null
      ? []
      : terrainLines(ctx.horizonStatus, ctx.horizonProfileDeg, live.azDeg, live.altDeg);
  switch (d.kind) {
    case "missing-satellite":
      return {
        id,
        name: ctx.pending ? "Loading satellites…" : "Satellite not found",
        description: ctx.pending ? "" : missingSatelliteText(),
        className: "kind-satellite",
        where: null,
        visibility: null,
        note: null,
        onMap: false,
        hasPosition: false,
        details: [`NORAD id: ${d.noradId}`],
      };
    case "satellite": {
      const f = friendlySatellite(d.name);
      const host = d.dockedTo === null ? null : friendlySatellite(d.dockedTo.name);
      const { live } = d;
      const details = [`Catalogue name: ${d.name}`, `NORAD id: ${d.noradId}`];
      if (d.dockedTo !== null) {
        details.push(`Docked to ${d.dockedTo.name} (NORAD ${d.dockedTo.noradId})`);
      }
      if (live !== null) {
        if (ctx.heightKm !== null) details.push(heightText(ctx.heightKm), speedText(ctx.heightKm));
        details.push(
          `Distance from the camera: ${rangeText(live.rangeKm)}`,
          `${directionText(live.azDeg, live.altDeg)} (apparent)`,
          ...terrain(live),
        );
      }
      if (ctx.incomingText !== null) details.push(ctx.incomingText);
      details.push(
        elementAgeText(d.epochMs, ctx.simTimeMs),
        `CelesTrak list: ${GROUP_LABELS[d.group]}`,
      );
      if (d.docked.length > 0) details.push(dockedText(d.docked));
      return {
        id,
        name: f.name,
        description: f.description,
        // Drawn at its host's position, so in its host's colour.
        className: host?.className ?? f.className,
        where: live === null ? null : whereToLook(live.azDeg, live.altDeg),
        visibility:
          live === null || live.altDeg < 0 ? null : satelliteVisibilityText(live, d.group),
        note:
          host !== null
            ? `Docked to ${withThe(host)}, so it is shown at the same place.`
            : live === null
              ? d.note
              : null,
        onMap: true,
        hasPosition: live !== null,
        details,
      };
    }
    case "star": {
      const f = friendlyStar(d.label);
      const details = [`Catalogue: HR ${d.hr} (Yale Bright Star Catalogue)`];
      if (d.vmag !== null) details.push(starMagnitudeText(d.vmag));
      if (d.live !== null) {
        details.push(directionText(d.live.azDeg, d.live.altDeg), ...terrain(d.live));
      }
      return {
        id,
        name: f.name,
        description: f.description,
        className: f.className,
        ...skyObjectLines(d.live, ctx),
        note: d.live === null ? d.note : null,
        onMap: false,
        hasPosition: d.live !== null,
        details,
      };
    }
    case "body": {
      const f = friendlyBody(d.id, d.label);
      const details =
        d.live === null
          ? []
          : [
              directionText(d.live.azDeg, d.live.altDeg),
              bodyMagnitudeText(d.live.mag),
              ...terrain(d.live),
            ];
      return {
        id,
        name: f.name,
        description: f.description,
        className: f.className,
        ...skyObjectLines(d.live, ctx),
        note: d.live === null ? d.note : null,
        onMap: false,
        hasPosition: d.live !== null,
        details,
      };
    }
  }
}

/** The hover card's lines after the name: where to look, then visibility or the note ("Working out where it is…"). */
export function hoverLines(card: CardText): string[] {
  const lines: string[] = [];
  if (card.where !== null) lines.push(card.where);
  if (card.visibility !== null) lines.push(card.visibility);
  else if (card.note !== null) lines.push(card.note);
  if (lines.length === 0 && card.description !== "") lines.push(card.description);
  return lines;
}
