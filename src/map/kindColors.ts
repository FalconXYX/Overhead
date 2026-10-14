// src/map/kindColors.ts — [Redesign] the object colours (redesign spec section 4), the same on the video overlay, the
// ground map, the legend and the card (theme.css --k-*): ISS orange, satellites cyan, Starlink violet, planets and the
// Moon gold, stars white, the selection an orange ring. Shapes still differ (a sunlit satellite a filled circle, one
// in Earth's shadow a dark square with a coloured edge), and every mark has a dark rim so it reads on a bright sky.

/** A sunlit mark's fill, or a shadowed mark's edge. */
export const KIND_COLOR = {
  iss: "#ff8a3d",
  satellite: "#4fd1ff",
  starlink: "#b58cff",
  planet: "#ffd166",
  star: "#ffffff",
} as const;

/** A shadowed mark's fill: the kind's colour, darkened. */
export const KIND_SHADOW_FILL = {
  iss: "#5a2a0e",
  satellite: "#123a5c",
  starlink: "#33245e",
} as const;

export type SatelliteKind = keyof typeof KIND_SHADOW_FILL;

/** The selection ring and the selected satellite's path ahead. */
export const SELECTION_COLOR = "#ff8a3d";
/** Light text on the video and the map (theme.css --c-text). */
export const LABEL_LIGHT = "#f5f7ff";
/** The dark rim, casing and label halo: the theme's deepest blue. */
export const INK = "#0d1433";
export const HALO = "rgba(13, 20, 51, 0.9)";

/** The ISS's NORAD catalogue number. */
const ISS_NORAD = 25544;
/** GP_GROUPS index of Starlink. */
const STARLINK_GROUP = 2;

/** A satellite's colour kind from its catalogue row: the ISS, a Starlink, or any other satellite. */
export function satelliteKind(
  noradId: number | undefined,
  groupIndex: number | undefined,
): SatelliteKind {
  if (noradId === ISS_NORAD) return "iss";
  return groupIndex === STARLINK_GROUP ? "starlink" : "satellite";
}
