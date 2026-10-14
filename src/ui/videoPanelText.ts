// src/ui/videoPanelText.ts — the YouTube status line of VideoPanel (M5 step 7), as text, and [Redesign] the live delay
// for the control bar. Kept out of the component file so VideoPanel stays a React Fast Refresh boundary (as
// objectText.ts, M3). [Redesign] Plain words: no error codes or video ids on screen, and no replay line (a live
// camera is always live). Wording may change; meaning may not.
import { youtubeStallMs } from "../domain/time";
import { getMediaClock } from "../state/clockLoop";
import type { VideoState } from "../state/types";

/** Everything the status line depends on. It changes on these, never at 4 Hz. */
export interface YoutubeStatusInput {
  /** App is resolving the video id (step 12.3); the player is not mounted yet. */
  readonly resolving: boolean;
  /** Set when the id came from the camera's last known id instead of its resolver. */
  readonly fallbackReason: string | null;
  /** App restarted the player with a new id found by the re-resolve (step 5.8). */
  readonly restarted: boolean;
  readonly status: VideoState["status"];
  /** The camera's status is "offline": after ENDED, the re-resolve found no new id. */
  readonly cameraOffline: boolean;
  /** Delay plus stall in whole seconds, computed when the status or the delay changes; null unless playing. */
  readonly behindSec: number | null;
  readonly daytime: boolean;
}

/** [Redesign] "about 50 s behind real time": the control bar's live line, and the playing status line's. */
export function liveDelayText(behindSec: number): string {
  return `about ${behindSec} s behind real time`;
}

/** "Live…" or the other line for the player's status. */
function statusLine(i: YoutubeStatusInput): string {
  switch (i.status) {
    case "idle":
    case "loading":
      return "Loading the live video. It starts once it is on screen.";
    case "paused":
      return "Paused. Press play on the video; the labels wait for it.";
    case "playing":
      return `Live, ${liveDelayText(i.behindSec ?? 0)}. The labels follow the video.`;
    case "buffering":
      return "Buffering…";
    case "ended":
      return i.cameraOffline
        ? "The live stream has ended, and no new one was found."
        : "The live stream ended. Looking for a new one…";
    case "embed-blocked":
      return "This live stream cannot be played on this site.";
    case "error":
      return "The live video could not start.";
  }
}

/** The lines of the status element, in order. */
export function youtubeStatusLines(i: YoutubeStatusInput): string[] {
  if (i.resolving) return ["Finding the live stream…"];
  const lines: string[] = [];
  if (i.fallbackReason !== null) lines.push("Showing the last known stream.");
  if (i.restarted) lines.push("The stream restarted.");
  lines.push(statusLine(i));
  if (i.daytime) lines.push("It is daytime at the camera, so the sky is bright.");
  return lines;
}

/** The rebuffer prompt (step 7): shown with Dismiss after a buffering of at least 1 s. */
export function rebufferText(seconds: number): string {
  return `The video stalled for ${seconds} s, so the labels may be slightly off.`;
}

/** "Watch on YouTube" for an embed-blocked stream. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * [Redesign] "Behind real time now", in whole seconds: the stream delay plus the stall since the player's anchor
 * (step 1.3). For "about N s behind real time" (liveDelayText) in VideoPanel and the control bar: compute it when
 * video.status or selectStreamDelayMs changes, never at 4 Hz (getCurrentTime() jitters, and a rounding flip would
 * make a live region speak).
 */
export function behindRealTimeSec(delayMs: number, nowMs: number = Date.now()): number {
  const clock = getMediaClock();
  const anchor = clock?.kind === "youtube" ? clock.anchor() : null;
  const mediaSec = clock?.kind === "youtube" ? clock.mediaSec() : null;
  const stallMs =
    anchor === null || mediaSec === null
      ? 0
      : youtubeStallMs(anchor.wallMs, anchor.mediaSec, nowMs, mediaSec);
  return Math.round((delayMs + stallMs) / 1000);
}
