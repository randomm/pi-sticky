/**
 * That the builder draws *exactly* the height the layout counted — one height, one owner.
 *
 * `buildPanelLines` used to take a `height` of its own alongside the row table, so a caller could size
 * one frame and draw another: the box and the rows it was built from could disagree by any number of
 * rows. The height is now `panelLayout`'s alone and the builder draws it, which leaves one promise to
 * pin — the length of the output *is* `layout.height` — and it is pinned across the sweep that used to
 * be able to break it: a tall terminal and a short one, one pin and three hundred.
 *
 * What a *frame* looks like (its borders, its rule, the header in the top one) is `panel-lines.test.ts`;
 * the window that scrolls through the rows is `panel-window.test.ts`; the numbers behind the ceiling are
 * `panel-height.test.ts`.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { BORDER_ROWS, panelMaxRows } from "../src/panel-height.ts";
import { buildPanelLines } from "../src/panel-lines.ts";
import type { PanelLayout } from "../src/panel-rows.ts";
import { panelLayout } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
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

function drawn(count: number, width: number, terminalRows: number | undefined): string[] {
  const pins = pinsOf(count);
  const layout = panelLayout(pins, width, terminalRows, 0, style);
  const lines = buildPanelLines({ pins, selection: 0, focused: true }, width, style, layout);
  return [String(layout.height), ...lines];
}

test("the builder draws exactly the height the layout counted, at every terminal and pin count", () => {
  // Never more than the layout counted (how 300 pins are kept inside a 40-row terminal) and never fewer
  // (how a single pin still fills the frame rather than leaving the chat showing beside it).
  for (const terminalRows of [3, 5, 6, 7, 8, 12, 24, 40, 200, 400, undefined]) {
    for (const count of [1, 2, 3, 5, 12, 60, 300]) {
      const [height, ...lines] = drawn(count, 40, terminalRows) as [string, ...string[]];
      const counted = Number(height);
      // A terminal with no room for both borders is refused outright: the layout says two rows and the
      // builder answers an open box with nothing at all.
      const closable = counted >= 3;
      expect(lines.length).toBe(closable ? counted : 0);
      expectUniformWidth(lines, 40);
      if (typeof terminalRows === "number") {
        expect(lines.length).toBeLessThanOrEqual(terminalRows);
      }
      // The frame is as tall as its content and never past the terminal's half: the rows the pins own,
      // over the two borders, cut to the ceiling (or the fallback's, for a terminal that cannot be asked).
      const rows = typeof terminalRows === "number" ? terminalRows : 24;
      expect(counted).toBe(
        Math.max(BORDER_ROWS, Math.min(count + BORDER_ROWS, Math.floor(rows / 2))),
      );
    }
  }
});

test("one pin is three rows where three hundred are the ceiling", () => {
  // The regression the removed parameter allowed, in both directions: a frame counted from 300 wrapped
  // rows and drawn with one, or the other way round. Now the frame follows the content until the ceiling
  // catches it — so one pin is a border, a pin and a border, and a long list is exactly half the terminal
  // with the window scrolling the rest.
  expect(drawn(1, 40, 40).length - 1).toBe(3);
  for (const terminalRows of [12, 24, 40]) {
    const many = drawn(300, 40, terminalRows);
    expect(many.length - 1).toBe(terminalRows / 2);
    // Every one of them drawn, whatever the count: the promise the sweep above makes per case, stated for
    // the two frames the old `height` parameter could disagree about.
    expect(many.length - 1).toBe(Number(many[0]));
    expect(drawn(2, 40, terminalRows).length - 1).toBe(4);
  }
});

/** The layout a test draws directly, when it wants to name a height the layout would have counted. */
function layoutOf(count: number, selection: number, terminalRows: number): PanelLayout {
  const pins = Array.from({ length: count }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
  return panelLayout(pins, 40, terminalRows, selection, style);
}

test("a panel is only as tall as its pins and never past half the terminal", () => {
  // The operator requirement: a one-line pin in a 40-row terminal is exactly three rows (border, pin,
  // border) — no blank rows of padding — and 50 of them are cut to the ceiling, which is what the window
  // scrolls. Five pins are their own five rows over the two borders.
  expect(drawn(1, 40, 40).length - 1).toBe(3);
  expect(drawn(5, 40, 40).length - 1).toBe(7);
  expect(drawn(50, 40, 40).length - 1).toBe(20);
  // The window keeps the *selected* pin on screen at the ceiling rather than dropping rows off the bottom.
  const scrolled = buildPanelLines(
    { pins: pinsOf(50), selection: 49, focused: true },
    40,
    style,
    layoutOf(50, 49, 40),
  );
  expect(scrolled).toHaveLength(20);
  expect(scrolled[0]).toContain("📌 Pinned for you (50)");
  expect(scrolled.at(-1)).toContain("Enter reply");
  expect(scrolled.some((line) => line.includes("Pin 50 "))).toBe(true);
  expect(scrolled.some((line) => line.includes("Pin 1 "))).toBe(false);
  // A terminal whose half cannot hold both borders is no frame at all: `panelMaxRows` says two rows, the
  // frame's floor says three, and the builder answers an open box with nothing.
  expect(panelMaxRows(5)).toBe(2);
  expect(drawn(1, 40, 5)).toEqual([String(BORDER_ROWS)]);
  expect(
    buildPanelLines(
      { pins: [one(1, "x")], selection: 0, focused: false },
      40,
      style,
      layoutOf(1, 0, 5),
    ),
  ).toEqual([]);
});
