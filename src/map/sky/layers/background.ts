// src/map/sky/layers/background.ts — the sky view's background image (M4 step 10) and video frames (M5 step 11).
// The layer is an `ImageLayer<ImageSource>` (SkyMapHandle.backgroundLayer): M5 puts an ImageCanvas source on it,
// which `ImageLayer<ImageStatic>` rejects (TS2739).
// A new ImageStatic per refresh is the only way to reload it: it has no setUrl, and source.refresh() makes no request
// (gotcha G10). The renderer keeps drawing the previous image until the new one has decoded.
// Never read the image's pixels: Nānā ao sends no CORS headers, so its image taints the canvas (G11).
import type { ImageLike } from "ol/DataTile";
import type ImageLayer from "ol/layer/Image";
import type Projection from "ol/proj/Projection";
import type ImageSource from "ol/source/Image";
import ImageCanvasSource from "ol/source/ImageCanvas";
import ImageStatic, { type Options as ImageStaticOptions } from "ol/source/ImageStatic";
import { STILL_IMAGE_MIN_REFRESH_SEC } from "../../../state/types";

export interface StillRefreshOptions {
  readonly imageUrl: string;
  readonly refreshSec: number; // >= STILL_IMAGE_MIN_REFRESH_SEC (60); a smaller value is raised to it
  readonly corsEnabled: boolean;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly onLoad: (loadedAtMs: number, naturalWidthPx: number, naturalHeightPx: number) => void;
  readonly onError: () => void; // 404 and network errors alike; the previous image stays on screen
}

/** The wait between the end of one load and the next request: refreshSec, never below 60 s (non-finite: 60 s). */
export function stillRefreshDelayMs(refreshSec: number): number {
  const sec = Number.isFinite(refreshSec) ? refreshSec : STILL_IMAGE_MIN_REFRESH_SEC;
  return Math.max(sec, STILL_IMAGE_MIN_REFRESH_SEC) * 1000;
}

/** imageUrl with a `t=<nowMs>` cache-buster: "?t=" or, when it already has a query, "&t="; kept before any "#". */
export function cacheBustedUrl(imageUrl: string, nowMs: number): string {
  const hash = imageUrl.indexOf("#");
  const base = hash === -1 ? imageUrl : imageUrl.slice(0, hash);
  const fragment = hash === -1 ? "" : imageUrl.slice(hash);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}t=${nowMs}${fragment}`;
}

/**
 * The ImageStatic options of one refresh, in the active camera's pixel projection, extent [0, 0, W, H].
 * crossOrigin is "anonymous" only with corsEnabled. null makes a no-cors request (no Origin header): a CORS request to
 * a server without CORS headers, such as Nānā ao's, fails and logs three console errors (G11).
 */
export function stillImageSourceOptions(
  o: Pick<StillRefreshOptions, "imageUrl" | "corsEnabled" | "widthPx" | "heightPx">,
  projection: Projection,
  nowMs: number,
): ImageStaticOptions {
  return {
    url: cacheBustedUrl(o.imageUrl, nowMs),
    projection,
    imageExtent: [0, 0, o.widthPx, o.heightPx],
    crossOrigin: o.corsEnabled ? "anonymous" : null,
  };
}

/** Natural size of a decoded image: an ImageBitmap in Chromium (no naturalWidth, G10), else the element; 0 × 0 if none. */
function naturalSizePx(el: ImageLike | null): readonly [number, number] {
  if (el === null) return [0, 0];
  if (typeof HTMLImageElement !== "undefined" && el instanceof HTMLImageElement) {
    return [el.naturalWidth, el.naturalHeight];
  }
  if (typeof HTMLVideoElement !== "undefined" && el instanceof HTMLVideoElement) {
    return [el.videoWidth, el.videoHeight];
  }
  return [el.width, el.height];
}

/**
 * Swaps in a new ImageStatic now and then every refreshSec. The next request is scheduled only after the previous load
 * ends (loaded or failed), so a slow server never gets overlapping requests. Returns stop(): when a request is still
 * in flight it puts the shown source back, or that image would replace the frozen frame after the loop stopped,
 * with no onLoad, so frameTimeMs and the pairs would belong to the previous image.
 */
export function startStillImageRefresh(
  layer: ImageLayer<ImageSource>,
  projection: Projection,
  o: StillRefreshOptions,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let shown = layer.getSource(); // the source whose image is on screen
  let pending: ImageStatic | null = null; // the source still loading
  const scheduleNext = (): void => {
    if (!stopped) timer = setTimeout(load, stillRefreshDelayMs(o.refreshSec));
  };
  function load(): void {
    timer = null;
    const source = new ImageStatic(stillImageSourceOptions(o, projection, Date.now()));
    source.once("imageloadend", (e) => {
      if (stopped) return;
      shown = source;
      pending = null;
      const [w, h] = naturalSizePx(e.image.getImage());
      o.onLoad(Date.now(), w, h); // may stop this loop
      scheduleNext();
    });
    source.once("imageloaderror", () => {
      if (stopped) return;
      pending = null;
      o.onError();
      scheduleNext();
    });
    pending = source;
    layer.setSource(source); // the renderer keeps drawing the previous image until this one has loaded
  }
  load();
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending !== null) layer.setSource(shown); // a load in flight would change the frozen image without onLoad
    pending = null;
  };
}

// ---- [M5] local-video background (M5 step 11) ----

/**
 * [M5] local-video background: draws the frame on screen into the camera's pixel extent [0, 0, W, H]. ImageCanvas
 * redraws only after changed() (gotcha G18), so bindBackground calls it on every frame callback and every `seeked`.
 */
export function createVideoSource(
  video: HTMLVideoElement,
  widthPx: number,
  heightPx: number,
  projection: Projection,
): ImageCanvasSource {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable");
  return new ImageCanvasSource({
    projection,
    ratio: 1, // the default 1.5 builds a canvas 1.5 × the viewport on every frame
    canvasFunction(extent, resolution, pixelRatio, size) {
      const [minX = 0, , , maxY = 0] = extent; // Extent is number[]: each element is number | undefined
      const [w = 0, h = 0] = size; // canvas pixels (already × pixelRatio)
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const s = pixelRatio / resolution; // canvas pixels per image pixel
        ctx.drawImage(video, -minX * s, (maxY - heightPx) * s, widthPx * s, heightPx * s);
      }
      return canvas;
    },
  });
}

/** [M5] Calls onFrame(mediaTimeSec) for every presented frame until the returned stop() runs. */
export function onVideoFrames(
  video: HTMLVideoElement,
  onFrame: (mediaTimeSec: number) => void,
): () => void {
  let handle = 0;
  let stopped = false;
  const step = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata): void => {
    if (stopped) return;
    onFrame(metadata.mediaTime);
    handle = video.requestVideoFrameCallback(step); // one callback per frame: re-register every time
  };
  handle = video.requestVideoFrameCallback(step);
  return () => {
    stopped = true;
    video.cancelVideoFrameCallback(handle);
  };
}
