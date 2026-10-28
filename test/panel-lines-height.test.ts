/**
 * That the builder draws *exactly* the height the layout counted — one height, one owner.
 *
 * `buildPanelLines` used to take a `height` of its own alongside the row table, so a caller could size
 * one frame and draw another: the box and the rows it was built from could disagree by any number of
 * rows. The height is now `panelLayoutSections`'s alone and the builder draws it, which leaves one promise to
 * pin — the length of the output *is* `layout.height` — and it is pinned across the sweep that used to
 * be able to break it: a tall terminal and a short one, one pin and three hundred.
 *
 * What a *frame* looks like (its borders, its rule, the header in the top one) is `panel-lines.test.ts`;
 * the window that scrolls through the rows is `panel-window.test.ts`; the numbers behind the ceiling are
 * `panel-height.test.ts`.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { panelLayoutSections } from "../src/panel-frame-layout.ts";
import { BORDER_ROWS, panelMaxRows } from "../src/panel-height.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import type { DrawnFrame } from "./panel-frame.ts";
import { built, content, framed } from "./panel-frame.ts";
import { TERMINAL_ROWS } from "./panel-hostile.ts";

/** Identity colours, so a drawn row is compared to what was asked for and not to a theme's bytes. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const one = (id: number, text: string): ViewPin => ({
  id,
  uid: `uid-${id}`,
  text,
  level: "info",
  source: "agent",
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
});

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

/** The frame the component would draw for these pins at this width and terminal height. */
function pinsOf(count: number): ViewPin[] {
  return Array.from({ length: count }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
}

/** The wrapped row table and the frame height, at the width/terminal these tests draw at. */
function frameRows(count: number, terminalRows: number | undefined) {
  // Sectioned here the way `framed` sections them below: the table this answers with is the table the frame
  // was drawn from, so the row count compared against `layout.height` is one pass's own answer.
  return panelLayoutSections(panelSections(pinsOf(count)), 40, terminalRows, 0, style, LATER);
}

/** The frame and the height it was counted at, from one `panel-frame.ts` pass at one width/terminal. */
function drawn(count: number, width: number, terminalRows: number | undefined): DrawnFrame {
  // One call, one width, one terminal: `framed` is the component's own pair — the table
  // `panelLayoutSections` built and the lines cut from *that* table — so the height asserted on is the one
  // the drawing came from and not a second pass that could disagree with it. A terminal that cannot be asked
  // is the shared default, not a `0`, which would be a terminal with no rows at all.
  return framed(content(pinsOf(count), 0, true), width, style, terminalRows ?? TERMINAL_ROWS);
}

test("the builder draws exactly the height the layout counted, at every terminal and pin count", () => {
  // Never more than the layout counted (how 300 pins are kept inside a 40-row terminal) and never fewer
  // (how a single pin still fills the frame rather than leaving the chat showing beside it).
  for (const terminalRows of [3, 5, 6, 7, 8, 12, 24, 40, 200, 400, undefined]) {
    for (const count of [1, 2, 3, 5, 12, 60, 300]) {
      const { lines, layout } = drawn(count, 40, terminalRows);
      // One height, one owner: `framed` returns the lines and the table from a *single*
      // `panelLayoutSections` pass, so the number the builder drew to is the number that same pass counted
      // — which is the promise this file exists for: a frame counted from one table and drawn from another
      // cannot get through here.
      const counted = layout.height;
      // A terminal with no room for both borders is refused outright: the layout says two rows and the
      // builder answers an open box with nothing at all.
      const closable = counted >= 3;
      expect(lines.length).toBe(closable ? counted : 0);
      expectUniformWidth(lines, 40);
      if (typeof terminalRows === "number") {
        expect(lines.length).toBeLessThanOrEqual(terminalRows);
      }
      // ...and the height is the frame's own promise: as tall as the rows of that table, never past the
      // terminal's half, never under the two borders it needs to be a closed box. The rows are the
      // *wrapped table's*, not the pin count — the id/time tail owns its columns now, so a pin whose text
      // will not fit the narrowed text column owns a second row, which is what makes 12 pins 14 rows at
      // this width and 60 pins 62.
      const table = frameRows(count, terminalRows ?? TERMINAL_ROWS).owned.length;
      expect(counted).toBe(
        Math.max(
          BORDER_ROWS,
          Math.min(table + BORDER_ROWS, panelMaxRows(terminalRows ?? TERMINAL_ROWS)),
        ),
      );
      if (typeof terminalRows === "number") expect(counted).toBeLessThanOrEqual(terminalRows);
    }
  }
});

test("one pin is three rows where three hundred are the ceiling", () => {
  // The regression the removed parameter allowed, in both directions: a frame counted from 300 wrapped
  // rows and drawn with one, or the other way round. Now the frame follows the content until the ceiling
  // catches it — so one pin is a border, a pin and a border, and a long list is exactly half the terminal
  // with the window scrolling the rest.
  expect(drawn(1, 40, 40).lines).toHaveLength(3);
  for (const terminalRows of [12, 24, 40]) {
    const many = drawn(300, 40, terminalRows);
    expect(many.lines).toHaveLength(terminalRows / 2);
    // Every one of them drawn, whatever the count: the promise the sweep above makes per case, stated for
    // the two frames the old `height` parameter could disagree about.
    expect(many.lines).toHaveLength(many.layout.height);
    expect(drawn(2, 40, terminalRows).lines).toHaveLength(4);
  }
});

test("a panel is only as tall as its pins and never past half the terminal", () => {
  // The operator requirement: a one-line pin in a 40-row terminal is exactly three rows (border, pin,
  // border) — no blank rows of padding — and 50 of them are cut to the ceiling, which is what the window
  // scrolls. Five pins are their own five rows over the two borders.
  expect(drawn(1, 40, 40).lines).toHaveLength(3);
  expect(drawn(5, 40, 40).lines).toHaveLength(7);
  expect(drawn(50, 40, 40).lines).toHaveLength(20);
  // The window keeps the *selected* pin on screen at the ceiling rather than dropping rows off the bottom.
  const scrolled = built(
    { pins: pinsOf(50), selection: 49, focused: true, replyHint: "", ageNow: LATER },
    40,
    style,
    40,
  );
  expect(scrolled).toHaveLength(20);
  expect(scrolled[0]).toContain("📌 Pinned · 50");
  expect(scrolled.at(-1)).toContain("Enter reply");
  // Fifty info pins draw newest id first, so the last selection — 49 — is the *oldest* pin, `Pin 1`, and the
  // window the keys scrolled to opens on it. What has scrolled out of the frame is the newest.
  expect(scrolled.some((line) => line.includes("Pin 1 "))).toBe(true);
  expect(scrolled.some((line) => line.includes("Pin 50 "))).toBe(false);
  // A terminal whose half cannot hold both borders is no frame at all: `panelMaxRows` says two rows, the
  // frame's floor says three, and the builder answers an open box with nothing.
  expect(panelMaxRows(5)).toBe(2);
  expect(drawn(1, 40, 5).layout.height).toBe(BORDER_ROWS);
  expect(drawn(1, 40, 5).lines).toEqual([]);
  expect(
    built(
      { pins: [one(1, "x")], selection: 0, focused: false, replyHint: "", ageNow: LATER },
      40,
      style,
      5,
    ),
  ).toEqual([]);
});
