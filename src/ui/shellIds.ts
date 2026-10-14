// src/ui/shellIds.ts — [Redesign] element ids the shell's parts point at across components. Kept out of the
// component files so each stays a Fast Refresh boundary.

/** The "Camera alignment (advanced)" drawer: the Layers panel's footer button controls it (aria-controls). */
export const CALIBRATION_DRAWER_ID = "camera-alignment";

/** App's stage column (the video, its notes and the control bar): the control bar's Fullscreen takes it fullscreen. */
export const STAGE_COLUMN_ID = "stage-column";
