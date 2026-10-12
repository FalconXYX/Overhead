// src/map/sky/layers/hitTargets.ts — DOM hit targets over a YouTube player (M5 step 8.3; README "Sky over video" rule
// 6). The map target has pointer-events: none there, so every click and hover reaches the player, except on these
// buttons: one reusable ol/Overlay <button> per drawn, pickable object (stopEvent: false, so OpenLayers gives each
// overlay container pointer-events: auto). Overlays are created as needed, reused and parked; none is created per
// frame. The targets are invisible: their look is visual design, settled from screenshots.
import type OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import type { CameraModel } from "../../../domain/camera";
import type { AppStore } from "../../../state/store";
import type { ObjectId } from "../../../state/types";

/** Smallest hit target edge, CSS px (README section 7, Accessibility rule 6). */
export const HIT_TARGET_MIN_PX = 24;

/** DOM hit targets over a YouTube player: one reusable ol/Overlay <button> per drawn, pickable object. */
export interface HitTargets {
  /** setPassThrough calls it: on creates and moves targets each frame; off parks every target. */
  setEnabled(on: boolean): void;
  /** Called by SkyMapHandle.setCameraModel; targets are placed with this model. */
  setCameraModel(model: CameraModel): void;
  /** Frame updater, registered after the sky layers' updaters so it reads this frame's positions. */
  update(simTimeMs: number): void;
}

/** Called once per drawn, pickable object: its id, its name (the button's aria-label) and its sky-map coordinate. */
export type HitTargetVisit = (id: ObjectId, name: string, x: number, y: number) => void;
/**
 * The sky map's drawn objects this frame, from the same projected positions and visibility predicates the layers and
 * pick use: the satellites layer's objects (never Starlink), the Sun, Moon and planets, the stars, and the selected
 * object last, so its target wins overlaps.
 */
export type DrawnObjects = (visit: HitTargetVisit) => void;

/** One target's DOM side. The app uses a <button> in an ol/Overlay; unit tests pass fakes. */
export interface HitTargetView {
  setLabel(name: string): void;
  /** Places the target's centre on a sky-map coordinate. */
  place(x: number, y: number): void;
  park(): void;
}
export interface HitTargetHandlers {
  enter(): void;
  leave(): void;
  click(): void;
}
export type MakeHitTarget = (handlers: HitTargetHandlers) => HitTargetView;

const BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  display: "block",
  width: `${HIT_TARGET_MIN_PX}px`,
  height: `${HIT_TARGET_MIN_PX}px`,
  margin: "0",
  padding: "0",
  border: "0",
  background: "transparent",
  cursor: "pointer",
};

/** The app's targets: a <button type="button"> (tabIndex −1: keyboard users select from the text alternative). */
function overlayTarget(map: OlMap): MakeHitTarget {
  return (handlers) => {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.dataset.hitTarget = "";
    Object.assign(button.style, BUTTON_STYLE);
    button.addEventListener("pointerenter", handlers.enter);
    button.addEventListener("pointerleave", handlers.leave);
    button.addEventListener("click", handlers.click);
    const overlay = new Overlay({
      element: button,
      stopEvent: false,
      positioning: "center-center",
    });
    map.addOverlay(overlay); // map.dispose() removes it (README Map lifecycle rule 2)
    return {
      setLabel: (name) => button.setAttribute("aria-label", name),
      place: (x, y) => overlay.setPosition([x, y]),
      park: () => overlay.setPosition(undefined),
    };
  };
}

interface Slot {
  readonly view: HitTargetView;
  id: ObjectId | null; // null: parked
  name: string;
  x: number;
  y: number;
  enteredId: ObjectId | null; // the id the pointer entered on, which a later leave clears
}

/**
 * `drawn` enumerates the objects (createSkyMap passes its own); `makeTarget` builds each target's DOM side. Off until
 * setEnabled(true). A target only for objects inside the frame [0, W] × [0, H]: the letterbox bars hold the player's
 * controls bar.
 */
export function createHitTargets(
  map: OlMap,
  store: AppStore,
  drawn: DrawnObjects = () => {},
  makeTarget: MakeHitTarget = overlayTarget(map),
): HitTargets {
  const slots: Slot[] = [];
  let enabled = false;
  let model: CameraModel | null = null;
  let used = 0;

  function newSlot(): Slot {
    const handlers: HitTargetHandlers = {
      enter: () => {
        slot.enteredId = slot.id;
        if (slot.id !== null) store.getState().actions.hover(slot.id);
      },
      leave: () => {
        const id = slot.enteredId;
        slot.enteredId = null;
        const { selection, actions } = store.getState();
        if (id !== null && selection.hoverId === id) actions.hover(null);
      },
      click: () => {
        if (slot.id !== null) store.getState().actions.select(slot.id);
      },
    };
    const slot: Slot = {
      view: makeTarget(handlers),
      id: null,
      name: "",
      x: Number.NaN,
      y: Number.NaN,
      enteredId: null,
    };
    return slot;
  }

  function park(slot: Slot): void {
    if (slot.id === null) return;
    slot.id = null;
    slot.x = Number.NaN;
    slot.y = Number.NaN;
    slot.view.park();
  }

  const visit: HitTargetVisit = (id, name, x, y) => {
    const m = model;
    if (m === null || !(x >= 0 && x <= m.widthPx && y >= 0 && y <= m.heightPx)) return;
    let slot = slots[used];
    if (slot === undefined) {
      slot = newSlot();
      slots.push(slot);
    }
    used += 1;
    slot.id = id;
    if (slot.name !== name) {
      slot.name = name;
      slot.view.setLabel(name);
    }
    if (slot.x !== x || slot.y !== y) {
      slot.x = x;
      slot.y = y;
      slot.view.place(x, y);
    }
  };

  function update(_simTimeMs: number): void {
    if (!enabled) return;
    used = 0;
    drawn(visit);
    for (let k = used; k < slots.length; k++) {
      const slot = slots[k];
      if (slot !== undefined) park(slot);
    }
  }

  return {
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) update(store.getState().clock.simTimeMs);
      else for (const slot of slots) park(slot);
    },
    setCameraModel(next) {
      model = next;
    },
    update,
  };
}
