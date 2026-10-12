import { describe, expect, it } from "vitest";
import { handleKeyDown, KEY_MAP, type KeyLike, MAP_SELECTOR } from "../../src/app/keyboard";
import { DEFAULT_CAMERA_ID, initialState } from "../../src/state/initialState";
import { selectCalibration } from "../../src/state/selectors";
import { type AppStore, createAppStore } from "../../src/state/store";
import { committedCameras, storeAt } from "../helpers/store";

const T = Date.parse("2026-10-10T03:30:00Z");

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  defaultPrevented: false,
  target: { tagName: "BODY", isContentEditable: false },
  ...extra,
});

describe("handleKeyDown", () => {
  it("arrows step the clock by 1 s, with Shift by 1 min", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    expect(handleKeyDown(store, key("ArrowRight"))).toBe(true);
    expect(store.getState().clock.simTimeMs).toBe(T + 1_000);
    expect(handleKeyDown(store, key("ArrowLeft", { shiftKey: true }))).toBe(true);
    expect(store.getState().clock.simTimeMs).toBe(T + 1_000 - 60_000);
  });

  it("780 Shift+ArrowRight stop at +12 h", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    for (let i = 0; i < 780; i += 1) handleKeyDown(store, key("ArrowRight", { shiftKey: true }));
    expect(store.getState().clock.simTimeMs - T).toBe(43_200_000);
  });

  it("does nothing in inputs, on prevented events and with Alt/Ctrl/Meta", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    const before = store.getState();
    const ignored: KeyLike[] = [
      key("ArrowRight", { target: { tagName: "INPUT", isContentEditable: false } }),
      key("ArrowRight", { target: { tagName: "TEXTAREA", isContentEditable: false } }),
      key("ArrowRight", { target: { tagName: "SELECT", isContentEditable: false } }),
      key(" ", { target: { tagName: "DIV", isContentEditable: true } }),
      key("ArrowRight", { defaultPrevented: true }),
      key("]", { metaKey: true }),
      key("ArrowRight", { ctrlKey: true }),
      key("l", { altKey: true }),
    ];
    for (const e of ignored) expect(handleKeyDown(store, e)).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it("does nothing on a focused map or inside one (OpenLayers lets Shift+arrows through)", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    const before = store.getState();
    const mapTarget = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector: string) => (selector === MAP_SELECTOR ? mapTarget : null),
    };
    expect(MAP_SELECTOR).toBe('[role="application"]');
    for (const e of [
      key("ArrowRight", { shiftKey: true, target: mapTarget }),
      key("ArrowLeft", { target: mapTarget }),
      key(" ", { target: mapTarget }),
      key("]", { target: mapTarget }),
      key("l", { target: mapTarget }),
    ]) {
      expect(handleKeyDown(store, e), e.key).toBe(false);
    }
    expect(store.getState()).toBe(before);
    // An element outside every map still gets the keys.
    const outside = { tagName: "DIV", isContentEditable: false, closest: () => null };
    expect(handleKeyDown(store, key("ArrowRight", { target: outside }))).toBe(true);
    expect(store.getState().clock.simTimeMs).toBe(T + 1_000);
  });

  it("[ at 1× and ] at 600× change nothing, so Live stays live", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    store.getState().actions.setMode("live");
    const live = store.getState();
    expect(handleKeyDown(store, key("["))).toBe(true);
    expect(store.getState()).toBe(live);
    store.getState().actions.setRate(600);
    const at600 = store.getState();
    expect(handleKeyDown(store, key("]"))).toBe(true);
    expect(store.getState()).toBe(at600);
  });

  it("[ and ] walk the rates 1, 10, 60, 600, clamped at the ends", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    expect(store.getState().clock.rate).toBe(1);
    expect(handleKeyDown(store, key("]"))).toBe(true);
    expect(store.getState().clock.rate).toBe(10);
    for (let i = 0; i < 5; i += 1) handleKeyDown(store, key("]"));
    expect(store.getState().clock.rate).toBe(600);
    expect(handleKeyDown(store, key("["))).toBe(true);
    expect(store.getState().clock.rate).toBe(60);
    for (let i = 0; i < 5; i += 1) handleKeyDown(store, key("["));
    expect(store.getState().clock.rate).toBe(1);
  });

  it("Space toggles play, except on a focused button", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    expect(handleKeyDown(store, key(" ", { target: { tagName: "BUTTON" } }))).toBe(false);
    expect(store.getState().clock.playing).toBe(false);
    expect(handleKeyDown(store, key(" "))).toBe(true);
    expect(store.getState().clock.playing).toBe(true);
    expect(handleKeyDown(store, key(" ", { target: null }))).toBe(true);
    expect(store.getState().clock.playing).toBe(false);
  });

  it("l then Shift+L opens and closes Layers", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    expect(handleKeyDown(store, key("l"))).toBe(true);
    expect(store.getState().ui.panel).toBe("layers");
    expect(handleKeyDown(store, key("L", { shiftKey: true }))).toBe(true);
    expect(store.getState().ui.panel).toBeNull();
  });

  it("ignores other keys", () => {
    const store = storeAt("2026-10-10T03:30:00Z");
    expect(handleKeyDown(store, key("x"))).toBe(false);
    expect(handleKeyDown(store, key("ArrowUp"))).toBe(false);
  });
});

describe("Esc (M3)", () => {
  it("clears the selection and turns follow off", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.select("sat:25544");
    actions.setFollow(true);
    actions.hover("moon");
    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    expect(store.getState().selection).toEqual({
      selectedId: null,
      hoverId: "moon",
      follow: false,
    });
  });

  it("with nothing selected is handled and changes nothing", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const before = store.getState();
    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    expect(store.getState()).toBe(before);
  });

  it("is ignored like every key in inputs, on prevented events and with Alt/Ctrl/Meta", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    store.getState().actions.select("sat:25544");
    const before = store.getState();
    for (const e of [
      key("Escape", { target: { tagName: "INPUT", isContentEditable: false } }),
      key("Escape", { target: { tagName: "SELECT", isContentEditable: false } }),
      key("Escape", { target: { tagName: "DIV", isContentEditable: true } }),
      key("Escape", { defaultPrevented: true }),
      key("Escape", { metaKey: true }),
      key("Escape", { altKey: true }),
    ]) {
      expect(handleKeyDown(store, e)).toBe(false);
    }
    expect(store.getState()).toBe(before);
  });

  it("works on a focused button and on a focused map, where a click selects and focuses", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.select("sat:25544");
    expect(handleKeyDown(store, key("Escape", { target: { tagName: "BUTTON" } }))).toBe(true);
    expect(store.getState().selection.selectedId).toBeNull();
    // OpenLayers' keyboard interactions never use Escape, so the map rule (M1) does not hold it back.
    const mapTarget = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector: string) => (selector === MAP_SELECTOR ? mapTarget : null),
    };
    actions.select("sat:25544");
    expect(handleKeyDown(store, key("Escape", { target: mapTarget }))).toBe(true);
    expect(store.getState().selection.selectedId).toBeNull();
    // Every other key on the map stays the map's.
    expect(handleKeyDown(store, key("ArrowRight", { target: mapTarget }))).toBe(false);
  });
});

// ---- M4: C, the calibration nudges and Esc on a pending point (M4 step 15; README Keyboard) ----

/** A store on `cameraId` (every committed camera in the registry), the Calibration panel open unless `open` is false. */
function calibrationStore(cameraId: string, open = true): AppStore {
  const store = createAppStore(initialState(Date.parse("2026-10-11T08:00:00Z"), DEFAULT_CAMERA_ID));
  const { actions } = store.getState();
  actions.setRegistry(committedCameras());
  actions.setActiveCamera(cameraId);
  if (open) actions.togglePanel("calibration");
  return store;
}

const calibrationOf = (store: AppStore) => {
  const c = selectCalibration(store.getState());
  if (c === undefined) throw new Error("no calibration");
  return c;
};

describe("C (M4)", () => {
  it("c and Shift+C open and close the Calibration panel", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    expect(handleKeyDown(store, key("c"))).toBe(true);
    expect(store.getState().ui.panel).toBe("calibration");
    expect(handleKeyDown(store, key("C", { shiftKey: true }))).toBe(true);
    expect(store.getState().ui.panel).toBeNull();
  });

  it("replaces the Layers panel, as the panel buttons do", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    handleKeyDown(store, key("l"));
    expect(handleKeyDown(store, key("c"))).toBe(true);
    expect(store.getState().ui.panel).toBe("calibration");
  });

  it("is ignored in inputs, on a focused map, on prevented events and as Cmd/Ctrl+C (copy)", () => {
    const store = storeAt("2026-10-11T08:00:00Z");
    const before = store.getState();
    const mapTarget = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector: string) => (selector === MAP_SELECTOR ? mapTarget : null),
    };
    for (const e of [
      key("c", { target: { tagName: "INPUT", isContentEditable: false } }),
      key("c", { target: { tagName: "DIV", isContentEditable: true } }),
      key("c", { target: mapTarget }),
      key("c", { defaultPrevented: true }),
      key("c", { metaKey: true }),
      key("c", { ctrlKey: true }),
      key("c", { altKey: true }),
    ]) {
      expect(handleKeyDown(store, e)).toBe(false);
    }
    expect(store.getState()).toBe(before);
  });
});

describe("arrows while the Calibration panel is open (M4)", () => {
  it("nudge the tilted Nānā ao pointing by 0.05°, with Shift 0.5°, and never step the clock", () => {
    const store = calibrationStore("cfht-nanaao");
    const clock = store.getState().clock;
    expect(handleKeyDown(store, key("ArrowRight"))).toBe(true);
    expect(calibrationOf(store).azDeg).toBe(227.35);
    expect(handleKeyDown(store, key("ArrowLeft", { shiftKey: true }))).toBe(true);
    expect(calibrationOf(store).azDeg).toBe(226.85);
    expect(handleKeyDown(store, key("ArrowUp"))).toBe(true);
    expect(calibrationOf(store).altDeg).toBe(88.31);
    expect(handleKeyDown(store, key("ArrowDown", { shiftKey: true }))).toBe(true);
    expect(calibrationOf(store).altDeg).toBe(87.81);
    expect(calibrationOf(store).rollDeg).toBeCloseTo(44.8, 9); // wrap180 on every write (G17)
    // Time stepping is off while the panel is open.
    expect(store.getState().clock).toBe(clock);
  });

  it("write through updateCalibration, which stamps updatedAtMs", () => {
    const store = calibrationStore("cfht-nanaao");
    const now = Date.now();
    handleKeyDown(store, key("ArrowRight"));
    const stored = store.getState().camera.calibration["cfht-nanaao"];
    expect(stored?.azDeg).toBe(227.35);
    expect(stored?.updatedAtMs).toBeGreaterThanOrEqual(now);
  });

  it("turn the roll of a zenith-locked fisheye; ↑ stays locked; Shift+↓ unlocks, then ← → move the azimuth", () => {
    const store = calibrationStore("synthetic-maunakea");
    expect(handleKeyDown(store, key("ArrowRight"))).toBe(true);
    let c = calibrationOf(store);
    expect(c.rollDeg).toBeCloseTo(-179.95, 9); // 180.05 wraps
    expect(c.azDeg).toBe(0);
    expect(c.altDeg).toBe(90);
    // ↑ at 90 is handled (no page scroll) but changes nothing, so nothing is written.
    const locked = store.getState();
    expect(handleKeyDown(store, key("ArrowUp", { shiftKey: true }))).toBe(true);
    expect(store.getState()).toBe(locked);
    expect(handleKeyDown(store, key("ArrowDown", { shiftKey: true }))).toBe(true);
    c = calibrationOf(store);
    expect(c.altDeg).toBe(89.5);
    expect(handleKeyDown(store, key("ArrowRight"))).toBe(true);
    c = calibrationOf(store);
    expect(c.azDeg).toBe(0.05);
    expect(c.rollDeg).toBeCloseTo(-179.95, 9);
  });

  it("leave inputs, a focused map and prevented events alone", () => {
    const store = calibrationStore("cfht-nanaao");
    const before = store.getState();
    const mapTarget = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector: string) => (selector === MAP_SELECTOR ? mapTarget : null),
    };
    for (const e of [
      key("ArrowRight", { target: { tagName: "INPUT", isContentEditable: false } }), // a range input moves itself
      key("ArrowUp", { target: { tagName: "SELECT", isContentEditable: false } }), // a pair's role
      key("ArrowLeft", { target: mapTarget }), // KeyboardPan on the focused sky map
      key("ArrowLeft", { shiftKey: true, target: mapTarget }),
      key("ArrowDown", { defaultPrevented: true }),
      key("ArrowRight", { altKey: true }),
    ]) {
      expect(handleKeyDown(store, e)).toBe(false);
    }
    expect(store.getState()).toBe(before);
  });

  it("nudge from a focused button in the panel", () => {
    const store = calibrationStore("cfht-nanaao");
    expect(handleKeyDown(store, key("ArrowUp", { target: { tagName: "BUTTON" } }))).toBe(true);
    expect(calibrationOf(store).altDeg).toBe(88.31);
  });

  it("step the clock again once the panel is closed, or while Layers is open", () => {
    const store = calibrationStore("cfht-nanaao", false);
    const t0 = store.getState().clock.simTimeMs;
    expect(handleKeyDown(store, key("ArrowRight"))).toBe(true);
    expect(store.getState().clock.simTimeMs).toBe(t0 + 1_000);
    expect(handleKeyDown(store, key("ArrowUp"))).toBe(false);
    store.getState().actions.togglePanel("layers");
    expect(handleKeyDown(store, key("ArrowLeft"))).toBe(true);
    expect(store.getState().clock.simTimeMs).toBe(t0);
    expect(store.getState().camera.calibration).toEqual({});
  });

  it("do nothing before the camera list has loaded", () => {
    const store = createAppStore(initialState(T, DEFAULT_CAMERA_ID));
    store.getState().actions.togglePanel("calibration");
    const before = store.getState();
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(handleKeyDown(store, key(k)), k).toBe(false);
    }
    expect(store.getState()).toBe(before);
  });
});

describe("Esc with a pending calibration point (M4)", () => {
  it("cancels the point first and keeps the selection; the next Esc clears the selection", () => {
    const store = calibrationStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.select("planet:Saturn");
    actions.addImagePoint(612.4, 433);
    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    expect(store.getState().calibrationUi.pendingPx).toBeNull();
    expect(store.getState().selection.selectedId).toBe("planet:Saturn");
    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    expect(store.getState().selection.selectedId).toBeNull();
  });

  it("keeps the pairs when it cancels the point, and works on the focused sky map", () => {
    const store = calibrationStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.addImagePoint(600, 600);
    actions.completePair("star:424");
    actions.addImagePoint(700, 500);
    const mapTarget = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector: string) => (selector === MAP_SELECTOR ? mapTarget : null),
    };
    expect(handleKeyDown(store, key("Escape", { target: mapTarget }))).toBe(true);
    const ui = store.getState().calibrationUi;
    expect(ui.pendingPx).toBeNull();
    expect(ui.pairs.map((p) => p.targetId)).toEqual(["star:424"]);
  });
});

describe("Esc with the tour (M9)", () => {
  it("first match only: the tour, then the pending point, then the selection, one effect per press", () => {
    const store = calibrationStore("cfht-nanaao");
    const { actions } = store.getState();
    actions.select("planet:Saturn");
    actions.addImagePoint(612.4, 433);
    actions.startDemo();
    actions.setDemoStep(3);

    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    let s = store.getState();
    expect(s.ui.demo).toEqual({ active: false, step: 0, paused: false });
    expect(s.calibrationUi.pendingPx).toEqual([612.4, 433]);
    expect(s.selection.selectedId).toBe("planet:Saturn");

    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    s = store.getState();
    expect(s.calibrationUi.pendingPx).toBeNull();
    expect(s.selection.selectedId).toBe("planet:Saturn");

    expect(handleKeyDown(store, key("Escape"))).toBe(true);
    expect(store.getState().selection.selectedId).toBeNull();
  });

  it("ends the tour from a focused button and from a focused map, and not from an input", () => {
    const store = storeAt("2026-10-11T15:09:50Z");
    const { actions } = store.getState();
    actions.startDemo();
    expect(
      handleKeyDown(
        store,
        key("Escape", { target: { tagName: "INPUT", isContentEditable: false } }),
      ),
    ).toBe(false);
    expect(store.getState().ui.demo.active).toBe(true);
    expect(handleKeyDown(store, key("Escape", { target: { tagName: "BUTTON" } }))).toBe(true);
    expect(store.getState().ui.demo.active).toBe(false);
    actions.startDemo();
    const mapTarget = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector: string) => (selector === MAP_SELECTOR ? mapTarget : null),
    };
    expect(handleKeyDown(store, key("Escape", { target: mapTarget }))).toBe(true);
    expect(store.getState().ui.demo.active).toBe(false);
  });
});

describe("KEY_MAP (M9)", () => {
  it("lists every key of README Keyboard once, in order, with an effect", () => {
    expect(KEY_MAP.map((row) => row.keys)).toEqual([
      "Space",
      "← / →",
      "[ / ]",
      "L",
      "C",
      "← → ↑ ↓ with the Calibration panel open",
      "Esc",
      "Arrows, + and − on a focused map",
    ]);
    for (const row of KEY_MAP) expect(row.effect.length, row.keys).toBeGreaterThan(0);
  });

  it("every key the handler takes on body is listed", () => {
    const listed = KEY_MAP.map((row) => row.keys).join(" ");
    const handled: string[] = [];
    const names: Record<string, string> = {
      " ": "Space",
      ArrowLeft: "←",
      ArrowRight: "→",
      ArrowUp: "↑",
      ArrowDown: "↓",
      Escape: "Esc",
    };
    const candidates = [..." []+-=abcdefghijklmnopqrstuvwxyz", ...Object.keys(names)];
    for (const k of new Set(candidates)) {
      for (const panel of [null, "calibration"] as const) {
        const store = storeAt("2026-10-11T15:09:50Z");
        store.getState().actions.openPanel(panel);
        if (handleKeyDown(store, key(k))) handled.push(k);
      }
    }
    expect(handled.length).toBeGreaterThan(0);
    for (const k of new Set(handled)) {
      const label = names[k] ?? k.toUpperCase();
      expect(listed.includes(label), `${JSON.stringify(k)} as ${label}`).toBe(true);
    }
  });
});
