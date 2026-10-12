// src/ui/gibsStatus.ts — the GIBS load state as text, shared by GroundView and the Layers panel (M1 step 13).
// Kept out of the component files so each stays a React Fast Refresh boundary (components-only exports).
import type { LoadStatus } from "../state/types";

/** The GIBS load state as text; the map and the Layers panel show the same words. null once ready. */
export function gibsStatusText(gibs: LoadStatus): string | null {
  if (gibs === "ready") return null;
  return gibs === "error" ? "NASA imagery unavailable" : "Loading NASA imagery…";
}
