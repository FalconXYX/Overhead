// src/domain/terrain/terrarium.ts — AWS Terrain Tiles (Tilezen Joerd) in Terrarium encoding (M6 step 1).
// Public on S3 with Access-Control-Allow-Origin: *. Fetch with a plain GET only: a HEAD or a request with
// custom headers gets no CORS answer (M6 gotcha 2).

export const TERRARIUM_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png" as const;
/** z16 returns 404. */
export const TERRARIUM_MAX_ZOOM = 15;
export const TILE_SIZE_PX = 256;

const TILE_PIXELS = TILE_SIZE_PX * TILE_SIZE_PX;

/** R × 256 + G + B / 256 − 32768 (channels 0–255). (128, 0, 0) → 0 m. Oceans hold seabed depth. */
export function decodeTerrariumM(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** RGBA bytes of one 256×256 tile → Float32Array(65536) of metres, row-major from the north-west corner. */
export function decodeTerrariumTile(rgba: Uint8ClampedArray, out: Float32Array): void {
  if (rgba.length < TILE_PIXELS * 4 || out.length < TILE_PIXELS) {
    throw new RangeError(
      `decodeTerrariumTile: need ${TILE_PIXELS * 4} RGBA bytes and ${TILE_PIXELS} outputs, got ${rgba.length} and ${out.length}`,
    );
  }
  for (let i = 0, o = 0; i < TILE_PIXELS; i++, o += 4) {
    // Alpha (o + 3) is ignored.
    out[i] = (rgba[o] ?? 0) * 256 + (rgba[o + 1] ?? 0) + (rgba[o + 2] ?? 0) / 256 - 32768;
  }
}
