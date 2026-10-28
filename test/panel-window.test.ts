/**
 * The selection bar and the scroll window: which row the bar sits on, and which pins the window shows.
 *
 * Two rules the frame depends on. The bar marks the row the keys moved to *and only while the panel
 * holds focus* — an unfocused panel highlighting its top row would claim the bar sits where the user is
 * not. And the window moves through the table of pin rows as a window, never past the end of it: the
 * header is the top border and the hint the bottom one, so neither can be scrolled away, and a pin that
 * wraps is scrolled as one entry rather than opening mid-text.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { META_COLUMNS, META_SEPARATOR_COLUMNS } from "../src/panel-frame-geometry.ts";
import { HINT } from "../src/panel-lines.ts";
import { GUTTER_COLUMNS, panelAllRows, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};
const plainStyle: RenderPanelStyle = { ...style, selected: (s) => s };

const one = (id: number, text: string, extra: Partial<ViewPin> = {}): ViewPin => ({
  ...pin(id, text, "info", extra),
  ...extra,
});

const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
  // Required by `PanelContent`; these cases are about the rows, not the resting label.
  replyHint: "",
  ageNow: LATER,
});

/** What `panelLayout` reserves for the id/time tail before the text column — the product's number, not a copy. */
const META_RESERVE = META_COLUMNS + META_SEPARATOR_COLUMNS;

/** The hint is long; the widths that assert on it must be long enough to draw it whole. */
const HINT_WIDTH = 60;

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

/** A line's columns with the frame's glyphs taken back off, so row shapes read plainly. */
function inside(line: string): string {
  return line.replace(/[╭╮╰╯│]/g, "");
}

/** A frame drawn at the height the caller asked for, with the row table `panelLayout` built for it. */
type PanelContent = ReturnType<typeof content>;

// `built` is `panel-frame.ts`'s: one `panelLayout` pass at `width` and the builder handed that table, so
// no test sizes one frame and draws another. A test that wants a short *window* asks for a short terminal,
// which is the only thing that sizes a frame now.

test("the selected pin's row is drawn with the selected style, and only that row", () => {
  const pins = [one(1, "First"), one(2, "Second")];
  const lines = built(content(pins, 1, true), 40, style, 10);
  // The bar goes over the inner columns only: the gutters of the selected row are drawn by the frame,
  // not by the bar, so the row opens with the gutter and only then the highlight.
  expect(lines.some((line) => line.includes("[ • Second") && inside(line).startsWith(" ["))).toBe(
    true,
  );
  // Exactly one row carries the bar. `]` cannot be the marker for that count: pi-tui wraps the ellipsis of
  // every line it cuts in a reset whose bytes contain `]0m`, and at this width the frame's other row and both
  // border labels are cut — so three lines close a bracket the panel never drew. The bar's *head* bracket is
  // what identifies its row: `selected` is asked of the focused frame alone and puts it at the head of the
  // inner columns, where no border label or cut can reach it.
  expect(lines.filter((line) => inside(line).startsWith(" ["))).toHaveLength(1);
});

test("an unfocused panel highlights nothing", () => {
  const pins = [one(1, "First"), one(2, "Second")];
  const lines = built(content(pins, 1, false), 40, style, 10);
  expect(lines.some((line) => line.includes("[") && line.includes("]"))).toBe(false);
});

test("a negative selection draws no bar", () => {
  const lines = built(content([one(1, "First")], -1, true), 40, style, 10);
  expect(lines.some((line) => line.includes("[") && line.includes("]"))).toBe(false);
});

test("scrolling follows the selected pin and never moves the header or the hint", () => {
  const pins = Array.from({ length: 6 }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
  // Eight terminal rows is a six-row window: the two borders are not content rows, so the header and the
  // hint stay where they are and only the pins between them move.
  const lines = built(content(pins, 5, true), HINT_WIDTH, style, 8);
  // The header is the top border and the hint the bottom one, so a scrolled window can move neither.
  expect(lines[0]).toContain("📌 Pinned for you (6)");
  expect(lines.at(-1)).toContain(HINT);
  expect(lines.some((line) => line.includes("Pin 6"))).toBe(true);
  // Pin 1 has scrolled out of the window, which is what an offset is for.
  expect(lines.some((line) => line.includes("Pin 1 "))).toBe(false);
  expectUniformWidth(lines, HINT_WIDTH);
});

test("the window starts at the selected pin's first row, so a wrapped pin scrolls as one entry", () => {
  // The long pin is the *selected* one: a window only scrolls for a selection it can address, so the
  // entry it must scroll as a whole is the one the bar is on.
  const pins = [one(1, "first"), one(2, "b".repeat(80))];
  // The gutters own four columns and the id/time tail ten, so a 44-column frame lays pins out at 30.
  const width = 44;
  const inner = width - GUTTER_COLUMNS;
  const all = panelAllRows(pins, inner - META_RESERVE, plainStyle);
  const wrapped = panelPinRows(pins[1] as ViewPin, inner - META_RESERVE, plainStyle).length;
  const lines = built(content(pins, 1, false), width, style, 6);
  // The second pin owns `wrapped` rows, so a four-row window cannot show the whole of it — and what it
  // does show is the *start* of that pin, not a continuation row dropped in mid-entry.
  expect(wrapped).toBeGreaterThan(2);
  expect(all.length).toBe(1 + wrapped);
  const window = lines.slice(1, 5);
  expect(window.some((line) => line.includes("b".repeat(20)))).toBe(true);
  // No row of the window is an earlier pin's, and none is a mid-entry tail (those are indented three,
  // under the text column, with no marker and no id).
  expect(window.some((line) => line.includes("first"))).toBe(false);
  expect(window[0]?.includes("•")).toBe(true);
  expectUniformWidth(lines, width);
});

test("the window never scrolls past the last pin, and a bar past the end draws no bar", () => {
  const six = Array.from({ length: 6 }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
  const width = 44;
  // A four-row window over six pins: content rows are the height less the two borders, so a ten-row
  // terminal draws four pins. The window stops at the end of the table whatever the selection, so the
  // last pin is always on screen and the blank rows a shorter list would leave never appear past the end
  // of a longer one. A negative selection has no bar and starts at the top, which is the row that always
  // exists.
  for (const selection of [3, 5, 99]) {
    const lines = built(content(six, selection, true), width, style, 10);
    expect(lines.some((line) => line.includes("Pin 6"))).toBe(true);
    expect(lines.some((line) => inside(line).trim() === "")).toBe(false);
    expectUniformWidth(lines, width);
  }
  // From the top the window shows the first four pins and, with a bar drawn, the last pin has scrolled
  // away — which is the window following the selection, not the frame dropping rows.
  const first = built(content(six, 0, true), width, style, 10);
  expect(first.some((line) => line.includes("Pin 1"))).toBe(true);
  expect(first.some((line) => line.includes("Pin 6"))).toBe(false);
  const top = built(content(six, -1, true), width, style, 10);
  expect(top.some((line) => line.includes("Pin 1"))).toBe(true);
  // A bar on a pin that is not there highlights nothing at all.
  const past = built(content(six, 99, true), width, style, 10);
  expect(past.filter((line) => line.includes("]")).length).toBe(0);
});
