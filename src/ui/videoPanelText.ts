// src/ui/videoPanelText.ts — the YouTube status line of VideoPanel (M5 step 7), as text. Kept out of the component
// file so VideoPanel stays a React Fast Refresh boundary (as objectText.ts, M3). Wording may change; meaning may not.
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
  readonly errorCode: number | null;
  /** The camera's status is "offline": after ENDED, the re-resolve found no new id. */
  readonly cameraOffline: boolean;
  /** Delay plus stall in whole seconds, computed when the status or the delay changes; null unless playing. */
  readonly behindSec: number | null;
  readonly daytime: boolean;
  readonly replay: boolean;
}

/** "Live…" or the other line for the player's status. */
function statusLine(i: YoutubeStatusInput): string {
  switch (i.status) {
    case "idle":
    case "loading":
      return "Loading the player. It starts when more than half of it is visible.";
    case "paused":
      return "Paused. Press play on the video; the sky waits for it.";
    case "playing":
      return `Live. The sky follows the video, about ${i.behindSec ?? 0} s behind real time.`;
    case "buffering":
      return "Buffering. The sky waits for the video.";
    case "ended":
      return i.cameraOffline
        ? "The stream ended, and no new video id was found."
        : "The stream ended. Looking for its new id…";
    case "embed-blocked":
      return `This stream cannot be played here (YouTube error ${i.errorCode ?? "unknown"}).`;
    case "error":
      return i.errorCode === null
        ? "The YouTube player could not start."
        : `The player reported error ${i.errorCode}.`;
  }
}

/** The lines of the status element, in order. */
export function youtubeStatusLines(i: YoutubeStatusInput): string[] {
  if (i.resolving) return ["Finding the current stream…"];
  const lines: string[] = [];
  if (i.fallbackReason !== null) lines.push(`Using the last known video id (${i.fallbackReason}).`);
  if (i.restarted) lines.push("The stream restarted with a new id. Check the delay.");
  lines.push(statusLine(i));
  if (i.daytime) lines.push("Daytime at the camera.");
  // No time in this line: it would change at 4 Hz while replay plays.
  if (i.replay) lines.push("Replay: the sky does not follow the video. Press Live to follow it.");
  return lines;
}

/** The rebuffer prompt (step 7): shown with Dismiss after a buffering of at least 1 s. */
export function rebufferText(seconds: number): string {
  return `The video rebuffered for ${seconds} s. Check the delay on the next satellite.`;
}

/** "Watch on YouTube" for an embed-blocked stream. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
