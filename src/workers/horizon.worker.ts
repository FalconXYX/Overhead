// src/workers/horizon.worker.ts — the terrain horizon per camera (M6 step 6, README section 5 "Horizon"): fetches
// the Terrarium tiles of the site's plan with plain GETs, decodes them with createImageBitmap and a willReadFrequently
// OffscreenCanvas 2D context, marches 360 rays and transfers the profile. The fetch, plan and march live in
// horizonCompute.ts, which runs in Vitest; this file adds only the browser decode, postMessage and the queue.
import { computeHorizon, createTerrariumTileLoader, type RgbaDecoder } from "./horizonCompute";
import type { HorizonIn, HorizonOut } from "./protocol";

const TILE_PX = 256;

// The options form of postMessage: the same call in a worker, and it type-checks under the DOM lib too.
const post = (msg: HorizonOut, transfer: Transferable[] = []): void =>
  postMessage(msg, { transfer });

/** One shared context, created on the first tile. */
let ctx: OffscreenCanvasRenderingContext2D | null = null;

/**
 * PNG → RGBA without colour management or premultiplication, which corrupt packed elevations (DECISIONS, Terrain).
 * No await between drawImage and getImageData, so the 6 lanes can share one context. getImageData lives on the
 * context, not on OffscreenCanvas (M6 gotcha 5).
 */
const decodeRgba: RgbaDecoder = async (blob) => {
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    ctx ??= new OffscreenCanvas(TILE_PX, TILE_PX).getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("OffscreenCanvas 2D context unavailable");
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
  } finally {
    bmp.close();
  }
};

// Plain GET with the URL only: no custom headers and never HEAD, which S3's CORS rejects (M6 gotcha 2).
const loadTile = createTerrariumTileLoader((url) => fetch(url), decodeRgba);

async function compute({ requestId, cameraId, latDeg, lonDeg, mastM }: HorizonIn): Promise<void> {
  try {
    const result = await computeHorizon({ latDeg, lonDeg, mastM }, loadTile, (done, total) =>
      post({ type: "progress", requestId, cameraId, tilesDone: done, tilesTotal: total }),
    );
    post({ type: "done", requestId, cameraId, ...result }, [result.profileDeg.buffer]);
  } catch (err) {
    // Any failed tile fails the whole profile: consumers keep the geometric horizon.
    post({
      type: "error",
      requestId,
      cameraId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

let queue: Promise<void> = Promise.resolve();
addEventListener("message", (e: MessageEvent<HorizonIn>) => {
  const msg = e.data;
  if (msg.type !== "compute") return;
  queue = queue.then(() => compute(msg)); // one compute at a time, in arrival order
});
