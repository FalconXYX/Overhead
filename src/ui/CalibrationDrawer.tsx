// src/ui/CalibrationDrawer.tsx — [Redesign] "Camera alignment (advanced)" (redesign spec section 2): the Calibration
// panel's content in a drawer over the map side. Open while ui.panel is "calibration": the Layers panel's footer
// button or the C key. Not a modal: the rest of the page stays usable, so the video can be watched while aligning.
import { useEffect, useId, useRef } from "react";
import { useActions, useAppState } from "../state/hooks";
import { store } from "../state/store";
import { CalibrationPanel } from "./CalibrationPanel";
import { CALIBRATION_DRAWER_ID } from "./shellIds";

export function CalibrationDrawer() {
  const actions = useActions();
  const open = useAppState((s) => s.ui.panel === "calibration");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the drawer when it opens, so the keyboard path reaches its fields at once.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <section
      id={CALIBRATION_DRAWER_ID}
      aria-labelledby={titleId}
      className="drawer"
      hidden={!open}
      onKeyDown={(e) => {
        // Esc closes the drawer, unless a calibration point is pending: keyboard.ts cancels that first.
        if (e.key !== "Escape" || store.getState().calibrationUi.pendingPx !== null) return;
        e.preventDefault();
        actions.openPanel(null);
      }}
    >
      <header className="drawer-head">
        <h2 id={titleId}>Camera alignment (advanced)</h2>
        <button
          ref={closeRef}
          type="button"
          className="btn-icon btn-quiet"
          aria-label="Close camera alignment"
          onClick={() => actions.openPanel(null)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <p className="drawer-intro">
        Fine-tunes how the drawn sky lines up with the video. Most people never need this.
      </p>
      <div className="drawer-body">
        <CalibrationPanel />
      </div>
    </section>
  );
}
