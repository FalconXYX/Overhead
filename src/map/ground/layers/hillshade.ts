// src/map/ground/layers/hillshade.ts — a WebGL relief over Terrarium tiles, lit by the Sun at the clock time (M6 step
// 11). ImageTile, not XYZ: XYZ fails strict tsc as a WebGLTile source (TS2740, M6 gotcha 3). Slopes use the pushed
// texel ground size (bindHillshadeTexel), never ['resolution'] (gotcha 10). The grey cosI mapping is the verified
// one; the final colour, alpha or layer opacity is visual design, settled from screenshots, and must keep the
// true-colour imagery visible under the relief.
import WebGLTileLayer from "ol/layer/WebGLTile";
import ImageTile from "ol/source/ImageTile";
import { TERRARIUM_MAX_ZOOM, TERRARIUM_URL } from "../../../domain/terrain";

/** The night lighting and the style's initial Sun: north-west, 45° up (the cartographic default). */
export const NIGHT_SUN_AZ_DEG = 315;
export const NIGHT_SUN_ALT_DEG = 45;

const DEG = Math.PI / 180;
/** Terrarium metres of the texel at offset (dx, dy). Band values arrive as 0..1. +dy is one texel south. */
const elevation = (dx: number, dy: number) => [
  "-",
  [
    "*",
    255,
    ["+", ["*", 256, ["band", 1, dx, dy]], ["band", 2, dx, dy], ["/", ["band", 3, dx, dy], 256]],
  ],
  32768,
];
const run = ["*", 2, ["var", "texelGroundM"]]; // central difference spans two texels
const dzdx = ["/", ["-", elevation(1, 0), elevation(-1, 0)], run]; // rise per ground metre east
const dzdy = ["/", ["-", elevation(0, 1), elevation(0, -1)], run]; // rise per ground metre south
const sunAz = ["*", DEG, ["var", "sunAzDeg"]]; // astronomy-engine azimuth: N = 0, E = 90
const sunAlt = ["*", DEG, ["var", "sunAltDeg"]];
/** cos(angle between the surface normal and the Sun). No atan and no '^': both misbehave on SwiftShader (gotcha 11). */
export const COS_INCIDENCE = [
  "/",
  [
    "+",
    ["sin", sunAlt],
    ["*", ["cos", sunAlt], ["-", ["*", dzdy, ["cos", sunAz]], ["*", dzdx, ["sin", sunAz]]]],
  ],
  ["sqrt", ["+", 1, ["*", dzdx, dzdx], ["*", dzdy, dzdy]]],
];

/** Hidden until layers.hillshade turns on (bindLayerVisible). */
export function createHillshadeLayer(): { layer: WebGLTileLayer; source: ImageTile } {
  const source = new ImageTile({
    url: TERRARIUM_URL,
    maxZoom: TERRARIUM_MAX_ZOOM, // z16 returns 404
    crossOrigin: "anonymous",
    interpolate: false, // NEAREST: band offsets land on whole texels
  });
  const layer = new WebGLTileLayer({
    source,
    visible: false,
    // Placeholder until screenshots: half opacity keeps the true colour visible under the opaque grey relief.
    opacity: 0.5,
    style: {
      // Every ['var', name] must be declared here, or the first render throws "Missing 'name' in style variables".
      variables: { sunAzDeg: NIGHT_SUN_AZ_DEG, sunAltDeg: NIGHT_SUN_ALT_DEG, texelGroundM: 1 },
      // Grey relief for verification. The final cosI → colour/opacity mapping is settled from screenshots.
      color: ["color", ["*", 255, ["clamp", COS_INCIDENCE, 0, 1]], 1],
    },
  });
  return { layer, source };
}
