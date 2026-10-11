import { describe, expect, it } from "vitest";
import { handleKeyDown, type KeyLike, MAP_SELECTOR } from "../../src/app/keyboard";
import { storeAt } from "../helpers/store";

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
