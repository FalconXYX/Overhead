// tests/unit/incomingChip.test.ts — the incoming chip and its text (M8 step 9.2–9.3): entries, "and K more", the
// accessible names, aria-pressed, the live region's rule (a new first entry only, gotcha 13), the paused and empty
// states, and the Inspector's line. Rendered with renderToStaticMarkup (no DOM in unit tests).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../../src/state/store";
import type { ObjectId } from "../../src/state/types";
import { IncomingChip, IncomingChipView } from "../../src/ui/IncomingChip";
import {
  INCOMING_PAUSED_TEXT,
  type IncomingRow,
  incomingAnnouncement,
  incomingButtonName,
  incomingButtonText,
  incomingRows,
  incomingSeconds,
  inspectorIncomingText,
  NO_ANNOUNCEMENT,
  nextAnnouncement,
} from "../../src/ui/incomingText";

const T = Date.parse("2026-10-11T15:05:07Z");
const CATALOG = {
  noradIds: Int32Array.from([25544, 19046, 10114, 49044, 7]),
  names: ["ISS (ZARYA)", "SL-3 R/B", "SL-3 R/B", "ISS (NAUKA)", ""],
};
const REPLY = {
  timeMs: T,
  entries: [
    { index: 0, etaSec: 35 },
    { index: 1, etaSec: 55 },
  ],
};

/** The section's own inline style: "clip:rect" there means visually hidden. */
const sectionStyle = (html: string): string =>
  /<section aria-label="Incoming satellites" data-testid="incoming-chip" style="([^"]*)"/.exec(
    html,
  )?.[1] ?? "";

const row = (noradId: number, name: string, seconds: number, index = 0): IncomingRow => ({
  index,
  noradId,
  name,
  seconds,
});

describe("incomingSeconds", () => {
  it("is etaSec while paused and counts down between replies, never below 0", () => {
    expect(incomingSeconds(35, T, T)).toBe(35);
    expect(incomingSeconds(35, T + 400, T)).toBe(35); // ⌈34.6⌉
    expect(incomingSeconds(35, T + 1_000, T)).toBe(34);
    expect(incomingSeconds(35, T + 9_500, T)).toBe(26); // 10× moves up to 10 s between replies
    expect(incomingSeconds(5, T + 7_000, T)).toBe(0);
    expect(incomingSeconds(35, T - 2_000, T)).toBe(37); // a reply ahead of the clock (a step back) counts up
  });
});

describe("incomingRows and the entry text", () => {
  it("names each entry from the catalogue, in the reply's order", () => {
    const rows = incomingRows(REPLY, CATALOG, T + 1_000);
    expect(rows).toEqual([row(25544, "ISS (ZARYA)", 34, 0), row(19046, "SL-3 R/B", 54, 1)]);
    expect(incomingRows(null, CATALOG, T)).toEqual([]);
    expect(incomingRows({ timeMs: T, entries: [{ index: 4, etaSec: 5 }] }, CATALOG, T)).toEqual([
      row(7, "NORAD 7", 5, 4),
    ]);
  });

  it("has a visible text and a longer accessible name", () => {
    const iss = row(25544, "ISS (ZARYA)", 35);
    expect(incomingButtonText(iss)).toBe("ISS (ZARYA) · 35 s");
    expect(incomingButtonName(iss)).toBe(
      "ISS (ZARYA), NORAD 25544, enters the view within 35 seconds",
    );
    expect(incomingAnnouncement(iss)).toBe("ISS (ZARYA) will enter the view within 35 seconds.");
  });
});

describe("nextAnnouncement (gotcha 13)", () => {
  it("changes only for a new first NORAD id, never for the countdown or an empty list", () => {
    const first = nextAnnouncement(NO_ANNOUNCEMENT, row(25544, "ISS (ZARYA)", 35));
    expect(first).toEqual({
      noradId: 25544,
      text: "ISS (ZARYA) will enter the view within 35 seconds.",
    });
    expect(nextAnnouncement(first, row(25544, "ISS (ZARYA)", 34))).toBe(first);
    expect(nextAnnouncement(first, undefined)).toBe(first);
    expect(nextAnnouncement(first, row(10114, "SL-3 R/B", 50)).text).toBe(
      "SL-3 R/B will enter the view within 50 seconds.",
    );
    expect(nextAnnouncement(NO_ANNOUNCEMENT, undefined)).toBe(NO_ANNOUNCEMENT);
  });
});

describe("inspectorIncomingText", () => {
  it("reads the selected index's entry, counted like the chip", () => {
    expect(inspectorIncomingText(REPLY, 1, T)).toBe("Enters the view within 55 s");
    expect(inspectorIncomingText(REPLY, 1, T + 2_500)).toBe("Enters the view within 53 s");
    expect(inspectorIncomingText(REPLY, 3, T)).toBeNull();
    expect(inspectorIncomingText(REPLY, null, T)).toBeNull();
    expect(inspectorIncomingText(null, 0, T)).toBeNull();
  });
});

describe("IncomingChipView", () => {
  const render = (props: Partial<Parameters<typeof IncomingChipView>[0]> = {}): string =>
    renderToStaticMarkup(
      createElement(IncomingChipView, {
        rows: [],
        paused: false,
        selectedId: null,
        announcement: "",
        onSelect: () => {},
        ...props,
      }),
    );
  /** [aria-label, aria-pressed, visible text] of every button. */
  const buttons = (html: string) =>
    [
      ...html.matchAll(
        /<button type="button" aria-label="([^"]*)" aria-pressed="([^"]*)">([^<]*)</g,
      ),
    ].map((m) => [m[1], m[2], m[3]]);

  it("shows up to 3 entries as buttons, then 'and K more'; aria-pressed marks the selection", () => {
    const rows = [
      row(25544, "ISS (ZARYA)", 35),
      row(19046, "SL-3 R/B", 55),
      row(10114, "SL-3 R/B", 55),
      row(48274, "CSS (TIANHE)", 60),
    ];
    const html = render({ rows, selectedId: "sat:19046", announcement: "x" });
    expect(html).toContain('aria-label="Incoming satellites" data-testid="incoming-chip"');
    expect(buttons(html)).toEqual([
      [
        "ISS (ZARYA), NORAD 25544, enters the view within 35 seconds",
        "false",
        "ISS (ZARYA) · 35 s",
      ],
      ["SL-3 R/B, NORAD 19046, enters the view within 55 seconds", "true", "SL-3 R/B · 55 s"],
      ["SL-3 R/B, NORAD 10114, enters the view within 55 seconds", "false", "SL-3 R/B · 55 s"],
    ]);
    expect(html).toContain("<p>and 1 more</p>");
    expect(html).not.toContain(INCOMING_PAUSED_TEXT);
    expect(sectionStyle(html)).not.toContain("clip:rect");
  });

  it("is empty and visually hidden with no entries, keeping its live region mounted", () => {
    const html = render({ announcement: "ISS (ZARYA) will enter the view within 35 seconds." });
    expect(buttons(html)).toEqual([]);
    expect(sectionStyle(html)).toContain("clip:rect");
    expect(html).toContain(
      '<p aria-live="polite" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">ISS (ZARYA) will enter the view within 35 seconds.</p>',
    );
    expect(render()).toContain('aria-live="polite"');
  });

  it("shows the pause note at 60× and 600×, without entries", () => {
    const html = render({ paused: true });
    expect(html).toContain(`<p>${INCOMING_PAUSED_TEXT}</p>`);
    expect(sectionStyle(html)).not.toContain("clip:rect");
    expect(buttons(html)).toEqual([]);
  });

  it("activation selects the satellite", () => {
    const selected: ObjectId[] = [];
    const element = IncomingChipView({
      rows: [row(25544, "ISS (ZARYA)", 35)],
      paused: false,
      selectedId: null,
      announcement: "",
      onSelect: (id) => selected.push(id),
    });
    // The first list item's button: section → ul → li → button.
    const section = element as { props: { children: unknown[] } };
    const list = section.props.children[1] as { props: { children: unknown[] } };
    const item = list.props.children[0] as {
      props: { children: { props: { onClick: () => void } } };
    };
    item.props.children.props.onClick();
    expect(selected).toEqual(["sat:25544"]);
  });
});

describe("IncomingChip with the app store", () => {
  beforeEach(() => {
    vi.spyOn(store, "getInitialState").mockImplementation(() => store.getState());
    const { actions } = store.getState();
    actions.recenter(T);
    actions.setRate(1);
    actions.setLayer("satellites", true);
    actions.setLayer("starlink", false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const render = (): string => renderToStaticMarkup(createElement(IncomingChip));

  it("is empty without a reply, and reads the pause note while playing at 60× or 600×", () => {
    expect(sectionStyle(render())).toContain("clip:rect");
    expect(render()).not.toContain(INCOMING_PAUSED_TEXT);
    const { actions } = store.getState();
    for (const rate of [60, 600] as const) {
      actions.setRate(rate);
      actions.play();
      expect(render()).toContain(INCOMING_PAUSED_TEXT);
    }
    actions.pause();
    expect(render()).not.toContain(INCOMING_PAUSED_TEXT);
  });

  it("stays empty, without the pause note, when both satellite layers are off", () => {
    const { actions } = store.getState();
    actions.setRate(60);
    actions.play();
    actions.setLayer("satellites", false);
    const html = render();
    expect(html).not.toContain(INCOMING_PAUSED_TEXT);
    expect(sectionStyle(html)).toContain("clip:rect");
    actions.pause();
  });
});
