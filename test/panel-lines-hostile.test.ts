/**
 * What the panel draws when the bytes it is handed are not trusted: the theme's own escape sequences and
 * a pin's hostile text, both drawn through the frame.
 *
 * The frame made this a distinct question. A border glyph is the builder's own character coloured by the
 * theme, and a border label is the header or the hint the theme styles — both are drawn at the far right
 * of a flush-right panel, where `visibleWidth` counts an OSC title or an OSC 8 hyperlink as *zero*
 * columns. A drawing that trusted a styled string's measurement would pad such a sequence across the
 * chat behind it, so every drawn line, border included, is stripped before it is padded. These tests are
 * that promise, and the promise that a hostile pin cannot reach a border column.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { buildPanelLines } from "../src/panel-lines.ts";
import { panelLayout } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";
import { BEL, ESC, HOSTILE, ST, TERMINAL_ROWS, offenders } from "./panel-hostile.ts";

const plain: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const one = (id: number, text: string, extra: Partial<ViewPin> = {}): ViewPin => ({
  ...pin(id, text, "info", extra),
  ...extra,
});

const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
});

/** A frame drawn at the height the caller asked for, with the row table `panelLayout` built for it. */
type PanelContent = ReturnType<typeof content>;

/**
 * The frame drawn exactly as the component draws it: `panelLayout` owns the row table *and* the height,
 * which is the rows the pins own over the two borders (cut to `TERMINAL_ROWS`' half), and the builder is
 * handed both — no caller can size one frame and draw another.
 */
function built(c: PanelContent, width: number, s: RenderPanelStyle): string[] {
  return buildPanelLines(c, width, s, panelLayout(c.pins, width, TERMINAL_ROWS, c.selection, s));
}

/** The smallest size at which the builder closes a frame at all (see `panel-lines.ts`). */
const MIN_FRAME_WIDTH = 30;

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

test("a themed panel draws through all six colours", () => {
  // One draw per focus state: a frame is coloured by `border` or by `borderFocused` and never by both at
  // once, so the unfocused gutter and the focused corners are asked for from the frames that use them.
  const painted: RenderPanelStyle = {
    header: (s: string) => `<h:t>${s}`,
    marker: (_level: unknown, s: string) => `<m:t>${s}`,
    dim: (s: string) => `<d:t>${s}`,
    selected: (s: string) => `<s:t>${s}`,
    // SGR-shaped, because that is what a theme does: colour a glyph. A wrapper that put visible
    // characters around one would ask for a frame wider than the overlay, and the builder's answer to
    // that is the one every drawn line gets — it is cut.
    border: (s: string) => `\u{1b}[2m${s}`,
    borderFocused: (s: string) => `\u{1b}[1m${s}`,
  };
  const focused = built(content([one(1, "Decide X")], 0, true), 40, painted);
  const resting = built(content([one(1, "Decide X")], 0, false), 40, painted);
  expect(focused[0]).toContain("<h:t>");
  expect(focused[1]).toContain("<m:t>");
  expect(focused[1]).toContain("<s:t>");
  // The dim is the id/time tail of the pin row, which is the row that carries the marker: the frame pads
  // out to the terminal's half now, so the pin is found by what it draws rather than by a row number a
  // blank row of padding could shift.
  expect(focused.find((line) => line.includes("<m:t>"))).toContain("<d:t>");
  // The frame is drawn through the style's `border`/`borderFocused` members, which is what lets the theme
  // own the frame's colour: the recording-theme test in `panel-lines.test.ts` is what pins which token is
  // asked for, and the uniform-width sweeps what proves the bytes a theme adds cost no columns. The
  // escape bytes themselves are refused on every drawn line — border glyphs included.
  expect(focused.join("\n")).toContain("╰");
  expect(focused.join("\n")).toContain("╭");
  expect(resting.join("\n")).toContain("│");
});

test("a coloured header over a narrow frame is cut without losing the theme's own bytes", () => {
  // `truncateToWidth` wraps its ellipsis in its own resets; those are the cut's bytes and go, while
  // the theme's prefix stays — the line was styled on purpose.
  const painted: RenderPanelStyle = {
    ...plain,
    header: (s: string) => `<h:k>${s}`,
  };
  const lines = built(content([one(1, "x")]), MIN_FRAME_WIDTH, painted);
  expectUniformWidth(lines, MIN_FRAME_WIDTH);
  expect(lines[0]?.includes("<h:k>")).toBe(true);
});

test("a theme that emits a hyperlink paints no escape bytes onto the panel, at any width", () => {
  const hostileStyle: RenderPanelStyle = {
    header: (text) => `${ESC}]8;;https://evil${ST}${text}${ESC}]8;;${ST}`,
    marker: (_level, text) => text,
    dim: (text) => `${ESC}]52;c;AAAA${BEL}${text}`,
    selected: (text) => text,
    // A border that smuggles a title sequence is the case the frame added: the glyphs are the builder's
    // own, but the bytes around them are the theme's, and the frame strips them rather than drawing them.
    border: (text) => `${ESC}]0;pwn${BEL}${text}`,
    borderFocused: (text) => `${ESC}]0;pwn${BEL}${text}`,
  };
  for (const focused of [false, true]) {
    for (const width of [40, 60]) {
      const lines = built(content([one(1, "Decide X")], 0, focused), width, hostileStyle);
      // One pin is a three-row frame — border, pin, border — and every row of it is swept.
      expect(lines.length).toBe(3);
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});

test("hostile text drawn at a width that forces a cut carries no escape, control or surrogate", () => {
  // The sanitizer is what removes these from a pin; the point here is that wrapping, cutting and
  // padding do not put any back, at a width narrow enough that every line is cut — the two border rows
  // included, since a pin's bytes must never reach a border column.
  for (const focused of [false, true]) {
    for (const width of [MIN_FRAME_WIDTH, 33, 60, 120]) {
      const lines = built(
        content([one(1, cleanPinText(HOSTILE), { level: "warning" })], 0, focused),
        width,
        plain,
      );
      // Three rows: the two borders and the cut row between them.
      expect(lines.length).toBe(3);
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});

test("every drawn line measures exactly the width from the frame's floor to 120 columns", () => {
  // The sweep the acceptance criteria name: nothing below the floor draws, and everything at or above it
  // closes, focused and unfocused, whatever the pin text.
  for (const focused of [false, true]) {
    for (let width = MIN_FRAME_WIDTH; width <= 120; width++) {
      const lines = built(
        content([one(1, cleanPinText(HOSTILE)), one(2, "日本語 🎯 tail")], 1, focused),
        width,
        plain,
      );
      expect(lines.length).toBeGreaterThan(2);
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});
