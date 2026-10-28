/**
 * The pure line builder: what the panel draws at a given size, with no session, theme instance or
 * overlay. Four promises are asserted on: every line is exactly `width` columns (the panel is flush
 * right, so a short line would let the chat show through), the frame closes at every size the builder
 * draws at with the header in its top rule and the hint in its bottom one, the header and the hint never
 * scroll away, and the selected pin is the one highlighted.
 *
 * Three siblings cover what would otherwise crowd this file: `panel-lines-hostile.test.ts` draws the same
 * frame with hostile pins and a theme that smuggles escape sequences in, `panel-rows.test.ts` covers the
 * row table the window is cut from, `panel-lines-height.test.ts` pins that the builder draws exactly the
 * height the layout counted, and `panel-frame-theme.test.ts` pins which theme token the frame asks for.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { META_COLUMNS, META_SEPARATOR_COLUMNS } from "../src/panel-frame-geometry.ts";
import { PANEL_MIN_FRAME_COLUMNS, PANEL_MIN_FRAME_ROWS } from "../src/panel-geometry.ts";
import { HINT, buildPanelLines } from "../src/panel-lines.ts";
import { GUTTER_COLUMNS, panelContentRows, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW_AGE } from "./fixtures-age.ts";
import { LATER, NOW, localTime, pin } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

/** Identity colours, so a drawn line can be compared to what was asked for. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  // What a real theme does to a border glyph: colour it, which costs no columns. A style that put
  // *visible* bytes around one would be asking for a frame wider than the overlay, which the builder
  // refuses outright — `panel-frame-theme.test.ts` draws that case.
  borderFocused: (s) => s,
};
const plainStyle: RenderPanelStyle = style;

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

/** What the builder draws: the ordered pins, the selected pin index, and whether the panel has focus. */
type PanelContent = ReturnType<typeof content>;

/** The frame's own width: the gutters and their spaces, which the builder takes off every drawn row. */
const FRAME_COLUMNS = 4;

/** The rule the border is filled with, spelled the way the builder spells it. */
const RULE = "─";

/** The two columns the corners own. */
const CORNER_WIDTH = 2;

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

/** A frame the given width, with one pin, in whichever focus state the caller asked for. */
function frameOf(width: number, focused = false): string[] {
  return built(content([one(1, "Decide X")], 0, focused), width, style);
}

/**
 * The frame drawn exactly as the component draws it — `built`, from `panel-frame.ts`, which is the one
 * place a test pairs `panelLayout`'s table with the builder that draws it. A test that wants more rows
 * than the default terminal allows asks for a taller terminal, which is the only other thing that sizes
 * a frame.
 */

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
  expect(built(content([]), 40, style)).toEqual([]);
});

test("a focused panel puts the hint in the bottom border and costs the pins no row", () => {
  expect(panelContentRows(10)).toBe(8);
  // The *same* content drawn both ways: the bar is what differs, and it is what the two frames are
  // compared on once the highlight is taken off.
  const pins = [one(1, "Decide X")];
  const rows = (focused: boolean) => built(content(pins, -1, focused), HINT_WIDTH, style);
  const focused = rows(true);
  const unfocused = rows(false);
  // The hint is a border row, not a content row: everything the unfocused frame draws appears in the
  // focused one, and the only extra line is the bottom border carrying the hint.
  expect(focused.length).toBe(unfocused.length);
  expect(drawn(focused)).toEqual(drawn(unfocused).concat(focused.at(-1) as string));
  expect(focused).toHaveLength(3);
  expect(focused.at(-1)).toContain(HINT);
  expect(focused.at(-1)?.startsWith("╰")).toBe(true);
  expect(focused.at(-1)?.endsWith("╯")).toBe(true);
  expectUniformWidth(focused, HINT_WIDTH);
});

test("an unfocused panel draws no keys hint, and its bottom border is all rule", () => {
  // The promise that survives the resting frame gaining a label: the *focused* hint — the keys the panel
  // cannot answer from here — never appears while unfocused. What the bottom border carries instead, and
  // what it carries when there is no focus key to name, are `panel-reply-hint.test.ts`.
  const lines = built(content([one(1, "x")]), 40, style);
  expect(lines.some((line) => line.includes(HINT))).toBe(false);
  expect(lines.at(-1)).toBe(`╰${"─".repeat(38)}╯`);
});

test("the frame closes at every size the builder draws at, with the header in the top rule", () => {
  for (const width of [30, 33, 60, 100]) {
    for (const focused of [false, true]) {
      const lines = frameOf(width, focused);
      const last = lines.length - 1;
      expectUniformWidth(lines, width);
      // The rule is what fills the border beside the header: padding there would leave a gap the chat
      // shows through, so a border always reads as corners, label, rule, corners.
      expect(lines[0]?.startsWith("╭ 📌 Pinned for you (1) ")).toBe(true);
      expect(lines[0]?.endsWith(`${RULE}╮`)).toBe(true);
      expect(lines[last]?.startsWith("╰")).toBe(true);
      // The rule is what closes a border, and no border ever ends in a blank: unfocused the bottom border
      // is nothing but rule, and focused it ends in the hint — which the rule follows when any of the
      // border is left for it, and which reaches the corner itself when the hint was cut to its room.
      expect(lines[last]?.endsWith(focused ? "╯" : `${RULE}╯`)).toBe(true);
      expect(lines[0]?.includes(RULE)).toBe(true);
      expect(lines[0]).toContain("📌 Pinned for you (1)");
      for (const row of lines.slice(1, last)) {
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
  const lines = built(content([one(1, "Decide X", { createdAt: NOW })]), width, style);
  // Byte-exact: the text column, the `#id HH:MM` tail beside it, and the row's spare columns after them.
  // Built from the pieces `pinRow` assembles rather than pasted — the text padded to the room the tail's
  // reserve left (`panelTextColumns` over the frame), the tail padded to exactly that reserve — so the time
  // comes from `localTime` and the reserve from the geometry, and neither can rot with the machine's clock.
  const tail = ` #1 ${NOW_AGE}`.padEnd(META_COLUMNS + META_SEPARATOR_COLUMNS);
  const text = " • Decide X".padEnd(width - GUTTER_COLUMNS - tail.length);
  expect(lines[1]).toBe(`│ ${text}${tail} │`);
  expect(lines[0]?.startsWith("╭ 📌 Pinned for you (1) ")).toBe(true);
  // The frame is as tall as its content, so the row after the pin is the bottom border: a panel with one
  // pin pads itself to nothing, which is what keeps the prompt visible beside it.
  expect(lines[2]).toBe(`╰${RULE.repeat(width - CORNER_WIDTH)}╯`);
});

test("the header names the count and the pin row names the id and the local time", () => {
  const lines = built(content([one(1, "Decide X", { createdAt: NOW })]), 40, style);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("#1");
  expect(lines[1]).toContain(NOW_AGE);
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
  const lines = built(content(pins), 40, marks);
  expect(inside(lines[1] as string)).toContain("!");
  expect(inside(lines[2] as string)).toContain("?");
  expect(inside(lines[3] as string)).toContain("•");
});

test("CJK and emoji text is measured, not counted: each row still fills the width inside the frame", () => {
  const pins = [one(1, "决定してください 🎯 続ける"), one(2, "日本語のテキスト")];
  for (const width of [33, 40, 60]) {
    const lines = built(content(pins, 0, true), width, style);
    const last = lines.length - 1;
    expectUniformWidth(lines, width);
    // The wrapped rows sit between the gutters: nothing of the pin reaches a border column.
    for (const row of lines.slice(1, last)) {
      expect(row.startsWith("│ ")).toBe(true);
      expect(row.endsWith(" │")).toBe(true);
    }
  }
});

test("a 33-column panel — what 33% of a 100-column terminal resolves to — still fits its rows", () => {
  const lines = built(content([one(1, "A pin with a good deal of text in it")]), 33, style);
  expectUniformWidth(lines, 33);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
});

test("a word wider than the frame is cut, not drawn past the gutter, and its id still reads", () => {
  // The word is 30 columns and the text column this width allows is 12, so the word cannot be drawn
  // whole: the wrap cuts it and the tail keeps the room the layout reserved for it. What the old
  // arithmetic produced at this width was `#1 …` — the *id* lost to the cut — so the promise this
  // width pins is that the `#id` survives the cut instead.
  const lines = built(content([one(1, "supercalifragilisticexpialidocious")]), 30, style);
  expectUniformWidth(lines, 30);
  // The word wraps to three rows, and the age lives on the second of them: the id is what the first row must
  // keep, and the two halves of the tail are never asked to share a line the text is being cut on.
  const rows = lines.slice(1, -1).map((line) => inside(line).trimEnd());
  expect(rows[0]).toContain("#1");
  expect(rows[1]).toContain(NOW_AGE);
  // ...and the row is still cut: the text column gave up width rather than pushing a character past the
  // gutter the frame owns.
  expect(rows[0]).not.toContain("supercalifragilisticexpialidocious");
});

test("a text that carries a newline becomes two rows under the text column", () => {
  const rows = panelPinRows(one(1, "first\nsecond"), 20, plainStyle, LATER);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.text).toContain("first");
  expect(rows[1]?.text).toContain("second");
  expect(rows[1]?.text.startsWith("   ")).toBe(true);
  // The second row is where the age lives: the row table gives the id's row a text column and the age's row
  // a tail, so the age of a two-row pin is drawn under its text rather than beside its id.
  expect(rows[1]?.tail).toBe(` ${NOW_AGE}`);
});

test("a replied pin is marked in its row", () => {
  const lines = built(content([one(1, "Decide X", { repliedAt: NOW })]), 40, style);
  expect(lines[1]).toContain("↩");
});

test("a non-positive width draws nothing", () => {
  expect(built(content([one(1, "x")]), 0, style)).toEqual([]);
});

test("a terminal with no room for both borders draws nothing, because one border would have nowhere to be", () => {
  // The height comes out of the layout, which counts the rows it has against the ceiling the terminal's
  // half gives it, so a frame below `PANEL_MIN_FRAME_ROWS` can only be the terminal's doing: a five-row
  // terminal halves to two rows and the builder refuses to draw the open box that comes out of it,
  // whatever row table it was handed beside the height.
  const pins = [one(1, "x")];
  for (const terminalRows of [1, 2, 4, 5]) {
    expect(built(content(pins, 0, false), 40, style, terminalRows)).toEqual([]);
  }
  // ...and the same holds for a height a caller hands the geometry check directly, because a row table
  // cannot rescue a size the frame cannot close at.
  for (const height of [1, 2]) {
    expect(
      buildPanelLines(content(pins, 0, false), 40, style, { owned: [], start: -1, height }),
    ).toEqual([]);
  }
});

test("the frame's floor is the overlay's own minWidth, and three rows", () => {
  // One number for both surfaces: the overlay's `minWidth` and the builder's floor cannot disagree about
  // what a closable frame is, and a frame the builder would refuse is one the overlay never reports.
  expect(PANEL_MIN_FRAME_COLUMNS).toBe(30);
  expect(PANEL_MIN_FRAME_ROWS).toBe(3);
  expect(frameOf(PANEL_MIN_FRAME_COLUMNS)).toHaveLength(3);
  expect(frameOf(PANEL_MIN_FRAME_COLUMNS - 1)).toEqual([]);
});
