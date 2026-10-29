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
import { GUTTER_COLUMNS, panelAllRows, panelContentRows, panelPinRows } from "../src/panel-rows.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import { infoView, levelPin } from "./panel-sections-fixture.ts";
/** The selection marker, spelled from its code point: a literal of it in source is rewritten on the way in. */
const SELECTED = String.fromCodePoint(0x203a);

/** What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints. */
function content(
  pins: readonly ViewPin[],
  selection = 0,
  focused = false,
  replyHint = "",
  ageNow = LATER,
) {
  return { pins, selection, focused, replyHint, ageNow };
}

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

/** What `panelLayoutSections` reserves for the id/time tail before the text column — the product's number, not a copy. */
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

// `built` is `panel-frame.ts`'s: one `panelLayoutSections` pass at `width` and the builder handed that table, so
// no test sizes one frame and draws another. A test that wants a short *window* asks for a short terminal,
// which is the only thing that sizes a frame now.

test("the selected pin's row is drawn with the selected style, and only that row", () => {
  const pins = [one(1, "First"), one(2, "Second")];
  const lines = built(content(pins, 1, true), 40, style, 10);
  // The bar goes over the inner columns only: the gutters of the selected row are drawn by the frame,
  // not by the bar, so the row opens with the gutter and only then the highlight.
  // The pins draw newest id first, so selection 1 is the *older* pin, `First`: the bar is asserted on the
  // drawn order, because that is the order the selection indexes — which is the coordinate the whole bar
  // rests on since sections put rows that own no pin in the same table. The marker's column of that row is
  // the selection marker rather than the level's glyph (`› First`, not `• First`): the bar replaces the
  // glyph, it does not add to it (#70 decision 2).
  const BAR = `[${String.fromCodePoint(0x203a)} First`;
  expect(lines.some((line) => line.includes(BAR) && inside(line).startsWith(" ["))).toBe(true);
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
  expect(lines[0]).toContain("📌 Pinned · 6");
  expect(lines.at(-1)).toContain(HINT);
  // Six pins draw newest id first, so the last selection is the *oldest* pin, `Pin 1`, and the window the
  // keys scrolled to opens on it: what has scrolled away is the newest.
  expect(lines.some((line) => line.includes("Pin 1"))).toBe(true);
  expect(lines.some((line) => line.includes("Pin 6"))).toBe(false);
  expectUniformWidth(lines, HINT_WIDTH);
});

test("the window starts at the selected pin's first row, so a wrapped pin scrolls as one entry", () => {
  // The long pin is the *selected* one: a window only scrolls for a selection it can address, so the
  // entry it must scroll as a whole is the one the bar is on.
  const pins = [one(1, "first"), one(2, "b".repeat(80))];
  // The gutters own four columns and the id/time tail ten, so a 44-column frame lays pins out at 30.
  const width = 44;
  const inner = width - GUTTER_COLUMNS;
  const drawn = panelSections(pins).flat;
  const all = panelAllRows(drawn, inner - META_RESERVE, plainStyle);
  const wrapped = panelPinRows(drawn[0] as ViewPin, inner - META_RESERVE, plainStyle).length;
  const lines = built(content(pins, 0, false), width, style, 6);
  // The second pin owns `wrapped` rows, so a four-row window cannot show the whole of it — and what it
  // does show is the *start* of that pin, not a continuation row dropped in mid-entry.
  expect(wrapped).toBeGreaterThan(2);
  expect(all.length).toBe(1 + wrapped);
  const window = lines.slice(1, 5);
  expect(window.some((line) => line.includes("b".repeat(20)))).toBe(true);
  // The bar is on the selected pin's first row, which is the window's first row: the entry is scrolled as a
  // whole, so the window opens at the top of it rather than in the middle., and none is a mid-entry tail (those are indented three,
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
    expect(lines.some((line) => line.includes("Pin 1"))).toBe(true);
    expect(lines.some((line) => inside(line).trim() === "")).toBe(false);
    expectUniformWidth(lines, width);
  }
  // From the top the window shows the first four pins and, with a bar drawn, the last pin has scrolled
  // away — which is the window following the selection, not the frame dropping rows.
  const first = built(content(six, 0, true), width, style, 10);
  expect(first.some((line) => line.includes("Pin 6"))).toBe(true);
  expect(first.some((line) => line.includes("Pin 1"))).toBe(false);
  const top = built(content(six, -1, true), width, style, 10);
  expect(top.some((line) => line.includes("Pin 6"))).toBe(true);
  // A bar on a pin that is not there highlights nothing at all.
  const past = built(content(six, 99, true), width, style, 10);
  expect(past.filter((line) => line.includes("]")).length).toBe(0);
});

/** The repro of the reported bug: one warning above twelve facts, at a terminal too short for the table. */
function shortWarningFrame(focused: boolean): { lines: string[]; rows: string[] } {
  const pins = [levelPin(1, "warn", "warning"), ...infoView(12)];
  const lines = built({ ...content(pins, 0, focused), ageNow: LATER }, 60, style, 14);
  return { lines, rows: lines.slice(1, -1) };
}

test("the window opens on the heading over the selected pin, not one row below it", () => {
  // 1 warning + 12 facts at a 14-row terminal: the frame halves to 7 rows, so 5 of the 15-row table are
  // drawn. The warning is the table's second row (its heading is the first) and the old offset scrolled
  // straight past that heading, leaving the bar on a row with nothing above it to say it was a warning.
  const pins = [levelPin(1, "warn", "warning"), ...infoView(12)];
  const { layout } = framed({ ...content(pins, 0, true), ageNow: LATER }, 60, style, 14);
  expect(layout.owned).toHaveLength(15);
  expect(layout.height).toBe(7);
  expect(panelContentRows(layout.height)).toBe(5);
  expect(layout.start).toBe(1);

  for (const focused of [true, false]) {
    const { lines, rows } = shortWarningFrame(focused);
    // The heading directly above the pin, focused or not: focus moves the bar, never the window.
    expect(rows[0]).toContain("Warnings");
    // The pin's row carries its level's glyph while the panel is unfocused, and the selection marker in that
    // same column once it holds focus (#70 decision 2) — one column exchanged, so the row still reads `warn`.
    expect(rows[1]).toContain(focused ? `${SELECTED} warn` : "! warn");
    expect(rows[1]).toContain("#1");
    // The bar, when there is one, is still on the pin's row and not on the heading above it.
    const bar = rows.filter((row) => row.includes("["));
    expect(bar).toHaveLength(focused ? 1 : 0);
    if (focused) expect(bar[0]).toBe(rows[1]);
    expectUniformWidth(lines, 60);
  }
});

test("a single-section view at the same short terminal scrolls exactly as it always did", () => {
  // No headings in the table at all, so the heading-aware opening has nothing to move for: the window of a
  // one-section view opens on the selected pin's first row, which is what every scroll test here has always
  // asserted. Twelve facts at 60 columns draw one row each, so a 14-row terminal shows five of them and the
  // selection moves the window by the pin's own row, one row at a time.
  const pins = infoView(12);
  for (const [selection, firstShown] of [
    [0, "note 12"],
    [3, "note 9"],
    [7, "note 5"],
  ] as const) {
    const rows = built(content(pins, selection, true), 60, style, 14).slice(1, -1);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain(firstShown);
    for (const row of rows) expect(row).not.toMatch(/Warnings|Needs you|FYI/);
  }
});

test("a heading is left out when it and the selected pin cannot both fit the window", () => {
  // The warning owns four rows of a three-row window, so a heading above it would cost the pin its last row:
  // the window opens on the pin, exactly as it did before the heading knew about the window. Two facts sit
  // under it so the table is longer than the frame whatever the offset, and the second section is what makes
  // the warning's heading a row at all.
  const pins = [levelPin(1, "a".repeat(40), "warning"), levelPin(2, "far below", "info")];
  const { layout } = framed({ ...content(pins, 0, true), ageNow: LATER }, 30, style, 8);
  const rowsOfSelected = layout.owned.filter((entry) => entry.pin === 0).length;
  const budget = panelContentRows(layout.height);
  expect(rowsOfSelected).toBe(4);
  expect(budget).toBe(2);
  const rows = built({ ...content(pins, 0, true), ageNow: LATER }, 30, style, 8).slice(1, -1);
  expect(rows).toHaveLength(budget);
  expect(rows[0]).toContain("a".repeat(10));
  expect(rows[0]).not.toContain("Warnings");
  // The bar is on that first row — the pin's own — and not on the heading that was left out.
  expect(rows.filter((row) => row.includes("["))[0]).toBe(rows[0]);
});
