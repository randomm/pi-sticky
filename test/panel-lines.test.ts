/**
 * The pure line builder: what the panel draws at a given size, without a session, a theme instance
 * or an overlay. Four things are asserted on and each is a promise the drawn surface has to keep —
 * every line is exactly `width` columns (the panel is flush right, so a short line would let the
 * chat show through), the header and the hint never scroll away, the selected pin is the one
 * highlighted, and hostile text is drawn as text.
 *
 * The hostile offenders are the same bytes as `test/state-untrusted.test.ts`'s sweep — OSC 52, an
 * OSC 8 pair, a CSI erase, pi-tui's APC marker, a Kitty prefix, an 8-bit DCS, U+202E and a lone
 * surrogate — but drawn *through the builder* rather than through `reconstruct`: the sanitizer is
 * what removes them from a pin, and this file is what proves the panel does not reintroduce them
 * with its own wrapping, padding and theming.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  HINT,
  buildPanelLines,
  panelAllRows,
  panelContentRows,
  panelPinRows,
  panelRowStart,
  panelScrollOffset,
} from "../src/panel-lines.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, localTime, pin, view } from "./fixtures.ts";
import { HOSTILE, offenders } from "./panel-hostile.ts";

/** The hint is long; the widths that assert on it must be long enough to draw it whole. */
const HINT_WIDTH = 48;

/** Identity colours, so a drawn line can be compared to what was asked for. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
};

/** Identity colours, the shape the row builders take when a test does not care about colour. */
const plainStyle: RenderPanelStyle = { ...style };

/** Colours that add bytes, so the styled path is exercised too. */
const colour = (token: string) => ({
  header: (s: string) => `<h:${token}>${s}`,
  marker: (_level: unknown, s: string) => `<m:${token}>${s}`,
  dim: (s: string) => `<d:${token}>${s}`,
  selected: (s: string) => `<s:${token}>${s}`,
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

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

// The overlay is opened for the pins, and a frame in which the last one was dismissed leaves nothing
// the user asked to see: an empty panel is a frame of the prompt around it, not a titled box asserting
// that it has nothing in it. `panel-lines` still pads whatever it draws to the width it is given, so
// "nothing to draw" has to be decided where the pins are known — which is the component, not this.
test("an empty view draws no rows, so the frame has nothing to clear", () => {
  expect(buildPanelLines(content([]), 40, 10, style)).toEqual([]);
});

test("a focused panel adds the hint line and the budget loses a row to it", () => {
  expect(panelContentRows(10, false)).toBe(9);
  expect(panelContentRows(10, true)).toBe(8);
  const lines = buildPanelLines(content([one(1, "Decide X")], 0, true), HINT_WIDTH, 10, style);
  expect(lines).toHaveLength(10);
  expect(lines[9]).toContain(HINT);
  expectUniformWidth(lines, HINT_WIDTH);
});

test("an unfocused panel draws no hint at all", () => {
  const lines = buildPanelLines(content([one(1, "Decide X")], 0, false), 40, 10, style);
  expect(lines.some((line) => line.includes(HINT))).toBe(false);
});

test("the header names the count and the pin row names the id and the local time", () => {
  const lines = buildPanelLines(content([one(1, "Decide X", { createdAt: NOW })]), 40, 6, style);
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
  const lines = buildPanelLines(content(pins), 40, 6, style);
  expect(lines[1]).toContain("!");
  expect(lines[2]).toContain("?");
  expect(lines[3]).toContain("•");
});

test("CJK and emoji text is measured, not counted: each row still fills the width", () => {
  const pins = [one(1, "决定してください 🎯 続ける"), one(2, "日本語のテキスト")];
  for (const width of [33, 40, 60]) {
    const lines = buildPanelLines(content(pins, 0, true), width, 8, style);
    expect(lines).toHaveLength(8);
    expectUniformWidth(lines, width);
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

test("a word wider than the panel is cut with an ellipsis, not drawn past the edge", () => {
  const lines = buildPanelLines(
    content([one(1, "supercalifragilisticexpialidocious")]),
    20,
    5,
    style,
  );
  expectUniformWidth(lines, 20);
  expect(lines[1]?.endsWith(" ")).toBe(false);
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
  const lines = buildPanelLines(content([one(1, "Decide X", { repliedAt: NOW })]), 40, 5, style);
  expect(lines[1]).toContain("↩");
});

test("the selected pin's row is drawn with the selected style, and only that row", () => {
  const pins = [one(1, "First"), one(2, "Second")];
  const lines = buildPanelLines(content(pins, 1, true), 40, 6, style);
  expect(lines.some((line) => line.startsWith("[") && line.includes("Second"))).toBe(true);
  expect(lines.filter((line) => line.includes("["))).toHaveLength(1);
});

test("an unfocused panel highlights nothing", () => {
  const pins = [one(1, "First"), one(2, "Second")];
  const lines = buildPanelLines(content(pins, 1, false), 40, 6, style);
  expect(lines.some((line) => line.includes("["))).toBe(false);
});

test("a negative selection draws no bar", () => {
  const lines = buildPanelLines(content([one(1, "First")], -1, true), 40, 6, style);
  expect(lines.some((line) => line.includes("["))).toBe(false);
});

test("scrolling follows the selected pin and never moves the header or the hint", () => {
  const pins = Array.from({ length: 6 }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
  const lines = buildPanelLines(content(pins, 5, true), HINT_WIDTH, 4, style);
  expect(lines[0]).toContain("📌 Pinned for you (6)");
  expect(lines[3]).toContain(HINT);
  expect(lines.some((line) => line.includes("Pin 6"))).toBe(true);
  // Pin 1 has scrolled out of the window, which is what an offset is for.
  expect(lines.some((line) => line.includes("Pin 1 "))).toBe(false);
  expectUniformWidth(lines, HINT_WIDTH);
});

test("the offset is the selected pin's first row, so a wrapped pin scrolls the whole entry", () => {
  const pins = [one(1, "a".repeat(80)), one(2, "second")];
  const textWidth = 23;
  const first = panelPinRows(pins[0] as ViewPin, textWidth, plainStyle).length;
  expect(panelRowStart(pins, textWidth, plainStyle, 1)).toBe(first);
  expect(panelScrollOffset(2, 1, pins, textWidth, plainStyle)).toBe(
    Math.min(first, panelAllRows(pins, textWidth, plainStyle).length - 2),
  );
});

test("the offset never scrolls past the last pin", () => {
  const pins = Array.from({ length: 6 }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
  const total = panelAllRows(pins, 30, plainStyle).length;
  expect(panelScrollOffset(3, 5, pins, 30, plainStyle)).toBe(total - 3);
  expect(panelScrollOffset(3, 99, pins, 30, plainStyle)).toBe(total - 3);
  expect(panelScrollOffset(3, -1, pins, 30, plainStyle)).toBe(0);
  expect(panelScrollOffset(0, 0, pins, 30, plainStyle)).toBe(0);
});

test("a height that leaves no row for pins still draws the header, and the hint when focused", () => {
  expect(buildPanelLines(content([one(1, "x")]), 20, 1, style)).toHaveLength(1);
  const two = buildPanelLines(content([one(1, "x")], 0, true), HINT_WIDTH, 2, style);
  expect(two).toHaveLength(2);
  expect(two[1]).toContain(HINT);
  expectUniformWidth(two, HINT_WIDTH);
});

test("a non-positive width or height draws nothing", () => {
  expect(buildPanelLines(content([one(1, "x")]), 0, 5, style)).toEqual([]);
  expect(buildPanelLines(content([one(1, "x")]), 40, 0, style)).toEqual([]);
});

test("a themed panel draws through all four colours", () => {
  const painted = colour("t");
  const lines = buildPanelLines(content([one(1, "Decide X")], 0, true), 40, 5, painted);
  expect(lines[0]).toContain("<h:t>");
  expect(lines[1]).toContain("<m:t>");
  expect(lines[1]).toContain("<s:t>");
  expect(lines[4]).toContain("<d:t>");
});

test("a coloured header over a narrow panel is cut without losing the theme's own bytes", () => {
  // `truncateToWidth` wraps its ellipsis in its own resets; those are the cut's bytes and go, while
  // the theme's prefix stays — the line was styled on purpose.
  const lines = buildPanelLines(content([one(1, "x")]), 12, 4, colour("k"));
  expectUniformWidth(lines, 12);
  expect(lines[0]?.startsWith("<h:k>")).toBe(true);
});

test("hostile text drawn at a width that forces a cut carries no escape, control or surrogate", () => {
  // The sanitizer is what removes these from a pin; the point here is that wrapping, cutting and
  // padding do not put any back, at a width narrow enough that every line is cut.
  for (const focused of [false, true]) {
    for (const width of [12, 20, 33]) {
      const lines = buildPanelLines(
        content([one(1, cleanPinText(HOSTILE), { level: "warning" })], 0, focused),
        width,
        6,
        style,
      );
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});

test("an empty pin text still owns a row, so the bar has something to sit on", () => {
  const rows = panelPinRows(one(1, ""), 20, plainStyle);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text).not.toBe("");
  expect(rows[0]?.meta).toContain("#1");
});

test("a zero text width falls back to one row rather than none", () => {
  expect(panelPinRows(one(1, "text"), 0, plainStyle)).toHaveLength(1);
});

test("rows are built for every pin in order and no pin is skipped", () => {
  const pins = [one(1, "a"), one(2, "bb"), one(3, "ccc")];
  expect(panelAllRows(pins, 30, plainStyle).map((row) => row.meta)).toEqual([
    `#1 ${localTime(NOW)}`,
    `#2 ${localTime(NOW)}`,
    `#3 ${localTime(NOW)}`,
  ]);
});

test("panelRowStart reports -1 for a pin that does not exist", () => {
  expect(panelRowStart([one(1, "a")], 20, plainStyle, 3)).toBe(-1);
  expect(panelRowStart([one(1, "a")], 20, plainStyle, -1)).toBe(-1);
});

test("the view a test builds with fixtures.ts draws like any other", () => {
  const lines = buildPanelLines(
    content(view([pin(1, "Decide X", "action")]).pins, 0, true),
    40,
    5,
    style,
  );
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("?");
  expect(lines[1]).toContain("Decide X");
});
