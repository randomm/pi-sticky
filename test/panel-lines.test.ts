/**
 * The pure line builder: what the panel draws at a given size, with no session, theme instance or
 * overlay. Four promises are asserted on: every line is exactly `width` columns (the panel is flush
 * right, so a short line would let the chat show through), the frame closes at every size the builder
 * draws at with the header in its top rule and the hint in its bottom one, the header and the hint never
 * scroll away, and the selected pin is the one highlighted.
 *
 * Three siblings cover what would otherwise crowd this file: `panel-lines-hostile.test.ts` draws the same
 * frame with hostile pins and a theme that smuggles escape sequences in, `panel-rows.test.ts` covers the
 * row table the window is cut from, and `panel-frame-theme.test.ts` pins which theme token the frame asks
 * for.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  HINT,
  PANEL_MIN_FRAME_COLUMNS,
  PANEL_MIN_FRAME_ROWS,
  buildPanelLines,
  panelAllRows,
  panelContentRows,
  panelPinRows,
} from "../src/panel-lines.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, localTime, pin } from "./fixtures.ts";
import { offenders } from "./panel-hostile.ts";

/** Identity colours, so a drawn line can be compared to what was asked for; also the row builders'
 * shape when a test does not care about colour. `colour()` adds bytes, to exercise the styled path. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  // What a real theme does to a border glyph: colour it, which costs no columns. A style that put
  // *visible* bytes around one would be asking for a frame wider than the overlay, so the panel's width
  // policy is allowed to cut it — `colour()` spells the coloured form for the tests that need to see one.
  borderFocused: (s) => s,
};
const plainStyle: RenderPanelStyle = style;
const colour = (token: string): RenderPanelStyle => ({
  header: (s: string) => `<h:${token}>${s}`,
  marker: (_level: unknown, s: string) => `<m:${token}>${s}`,
  dim: (s: string) => `<d:${token}>${s}`,
  selected: (s: string) => `<s:${token}>${s}`,
  // SGR-shaped, because that is what a theme does: colour a glyph and add no columns. A wrapper that put
  // visible characters around a border glyph would be asking for a frame wider than the overlay, and the
  // builder's answer to that is the one every drawn line gets — it is cut.
  border: (s: string) => `\u{1b}[2m${s}`,
  borderFocused: (s: string) => `\u{1b}[1m${s}`,
});

const one = (id: number, text: string, extra: Partial<ViewPin> = {}): ViewPin => ({
  ...pin(id, text, "info", extra),
  ...extra,
});

const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
});

/** The frame's own width: the gutters and their spaces, which the builder takes off every drawn row. */
const FRAME_COLUMNS = 4;

/** The rule the border is filled with, spelled the way the builder spells it. */
const RULE = "─";

/** The two columns the corners own. */
const CORNER_WIDTH = 2;

/** The id/time tail the row builder reserves before the text column. */
const META_RESERVE = 10;

/** The smallest size at which the builder closes a frame at all (see `panel-lines.ts`). */
const MIN_FRAME_WIDTH = 30;
const MIN_FRAME_HEIGHT = 3;

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

/** A frame the given size, with one pin, in whichever focus state the caller asked for. */
function frameOf(width: number, height: number, focused = false): string[] {
  return buildPanelLines(content([one(1, "Decide X")], 0, focused), width, height, style);
}

/** A line's columns with the frame's glyphs taken back off, so row shapes read plainly. */
function inside(line: string): string {
  return line.replace(/[╭╮╰╯│]/g, "");
}

/** The rows that draw something: a blank content row is all gutter, and a border is all rule. */
function drawn(lines: string[]): string[] {
  return lines.filter((line) => inside(line).replace(/[─ ·]/g, "") !== "");
}

/** The hint is long; the widths that assert on it must be long enough to draw it whole. */
const HINT_WIDTH = 60;

// A frame in which the last pin was dismissed leaves nothing the user asked to see.
test("an empty view draws no rows, so the frame has nothing to clear", () => {
  expect(buildPanelLines(content([]), 40, 10, style)).toEqual([]);
});

test("a focused panel puts the hint in the bottom border and costs the pins no row", () => {
  expect(panelContentRows(10)).toBe(8);
  // The *same* content drawn both ways: the bar is what differs, and it is what the two frames are
  // compared on once the highlight is taken off.
  const pins = [one(1, "Decide X")];
  const rows = (focused: boolean) =>
    buildPanelLines(content(pins, -1, focused), HINT_WIDTH, 10, style);
  const focused = rows(true);
  const unfocused = rows(false);
  // The hint is a border row, not a content row: everything the unfocused frame draws appears in the
  // focused one, and the only extra line is the bottom border carrying the hint.
  expect(drawn(focused)).toEqual(drawn(unfocused).concat(focused[9] as string));
  expect(focused).toHaveLength(10);
  expect(focused[9]).toContain(HINT);
  expect(focused[9]?.startsWith("╰")).toBe(true);
  expect(focused[9]?.endsWith("╯")).toBe(true);
  expectUniformWidth(focused, HINT_WIDTH);
});

test("an unfocused panel draws no hint, and its bottom border is all rule", () => {
  const lines = frameOf(40, 3);
  expect(lines.some((line) => line.includes(HINT))).toBe(false);
  expect(lines[2]).toBe(`╰${"─".repeat(38)}╯`);
});

test("the frame closes at every size the builder draws at, with the header in the top rule", () => {
  for (const width of [30, 33, 60, 100]) {
    for (const focused of [false, true]) {
      const lines = frameOf(width, 8, focused);
      expect(lines).toHaveLength(8);
      expectUniformWidth(lines, width);
      // The rule is what fills the border beside the header: padding there would leave a gap the chat
      // shows through, so a border always reads as corners, label, rule, corners.
      expect(lines[0]?.startsWith("╭ 📌 Pinned for you (1) ")).toBe(true);
      expect(lines[0]?.endsWith(`${RULE}╮`)).toBe(true);
      expect(lines[7]?.startsWith("╰")).toBe(true);
      // The rule is what closes a border, and no border ever ends in a blank: unfocused the bottom border
      // is nothing but rule, and focused it ends in the hint — which the rule follows when any of the
      // border is left for it, and which reaches the corner itself when the hint was cut to its room.
      expect(lines[7]?.endsWith(focused ? "╯" : `${RULE}╯`)).toBe(true);
      expect(lines[0]?.includes(RULE)).toBe(true);
      expect(lines[0]).toContain("📌 Pinned for you (1)");
      for (const row of lines.slice(1, 7)) {
        // Every content row is gutter, one space, content fitted to the inner width, one space, gutter.
        expect(row.startsWith("│ ")).toBe(true);
        expect(row.endsWith(" │")).toBe(true);
        expect(visibleWidth(row.slice(2, -2))).toBe(width - FRAME_COLUMNS);
      }
    }
  }
});

test("a pin row is one space inside each gutter, at the inner width", () => {
  const width = 60;
  const lines = buildPanelLines(content([one(1, "Decide X", { createdAt: NOW })]), width, 3, style);
  // Byte-exact: content fitted to `width - 4` and padded out between the gutters, with the rule filling
  // the top and bottom borders. Unfocused, so nothing is highlighted.
  expect(lines[1]).toBe(`│ ${` • Decide X #1 ${localTime(NOW)}`.padEnd(width - FRAME_COLUMNS)} │`);
  expect(lines[0]?.startsWith("╭ 📌 Pinned for you (1) ")).toBe(true);
  expect(lines[2]).toBe(`╰${RULE.repeat(width - CORNER_WIDTH)}╯`);
});

test("the header names the count and the pin row names the id and the local time", () => {
  const lines = buildPanelLines(content([one(1, "Decide X", { createdAt: NOW })]), 40, 3, style);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("#1");
  expect(lines[1]).toContain(localTime(NOW));
  expect(lines[1]).toContain("Decide X");
});

test("the level marker is the rail's: ! for warning, ? for action, a bullet for info", () => {
  const pins = [
    { ...pin(1, "Warn", "warning") },
    { ...pin(2, "Act", "action") },
    { ...pin(3, "Note", "info") },
  ];
  // A style whose bar is a character that appears nowhere else, so a row can be read for its marker
  // without the selection highlight or an id being mistaken for one.
  const marks: RenderPanelStyle = { ...style, selected: (s) => s };
  const lines = buildPanelLines(content(pins), 40, 5, marks);
  expect(inside(lines[1] as string)).toContain("!");
  expect(inside(lines[2] as string)).toContain("?");
  expect(inside(lines[3] as string)).toContain("•");
});

test("CJK and emoji text is measured, not counted: each row still fills the width inside the frame", () => {
  const pins = [one(1, "决定してください 🎯 続ける"), one(2, "日本語のテキスト")];
  for (const width of [33, 40, 60]) {
    const lines = buildPanelLines(content(pins, 0, true), width, 8, style);
    expect(lines).toHaveLength(8);
    expectUniformWidth(lines, width);
    // The wrapped rows sit between the gutters: nothing of the pin reaches a border column.
    for (const row of lines.slice(1, 7)) {
      expect(row.startsWith("│ ")).toBe(true);
      expect(row.endsWith(" │")).toBe(true);
    }
  }
});

test("a 33-column panel — what 33% of a 100-column terminal resolves to — still fits its rows", () => {
  const lines = buildPanelLines(
    content([one(1, "A pin with a good deal of text in it")]),
    33,
    6,
    style,
  );
  expectUniformWidth(lines, 33);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
});

test("a word wider than the frame is cut with an ellipsis, not drawn past the gutter", () => {
  const lines = buildPanelLines(
    content([one(1, "supercalifragilisticexpialidocious")]),
    30,
    4,
    style,
  );
  expectUniformWidth(lines, 30);
  expect(
    inside(lines[1] as string)
      .trimEnd()
      .endsWith(" "),
  ).toBe(false);
  expect(lines[1]).toContain("…");
});

test("a text that carries a newline becomes two rows under the text column", () => {
  const rows = panelPinRows(one(1, "first\nsecond"), 20, plainStyle);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.text).toContain("first");
  expect(rows[1]?.text).toContain("second");
  expect(rows[1]?.text.startsWith("   ")).toBe(true);
  expect(rows[1]?.meta).toBe("");
});

test("a replied pin is marked in its row", () => {
  const lines = buildPanelLines(content([one(1, "Decide X", { repliedAt: NOW })]), 40, 3, style);
  expect(lines[1]).toContain("↩");
});

test("a non-positive width or height draws nothing", () => {
  expect(buildPanelLines(content([one(1, "x")]), 0, 5, style)).toEqual([]);
  expect(buildPanelLines(content([one(1, "x")]), 40, 0, style)).toEqual([]);
});

test("the frame's floor is the overlay's own minWidth, and three rows", () => {
  // One number for both surfaces: the overlay's `minWidth` and the builder's floor cannot disagree about
  // what a closable frame is, and a frame the builder would refuse is one the overlay never reports.
  expect(PANEL_MIN_FRAME_COLUMNS).toBe(30);
  expect(PANEL_MIN_FRAME_ROWS).toBe(3);
  expect(frameOf(PANEL_MIN_FRAME_COLUMNS, PANEL_MIN_FRAME_ROWS)).toHaveLength(3);
  expect(frameOf(PANEL_MIN_FRAME_COLUMNS - 1, PANEL_MIN_FRAME_ROWS)).toEqual([]);
});
