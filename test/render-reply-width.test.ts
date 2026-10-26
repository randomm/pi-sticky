/**
 * The width and escape safety of a **replied** row, on both surfaces.
 *
 * The replied mark is added outside the sanitizer: `pinLine` (rail) and `panelPinRows` (panel) put
 * `↩ ` in front of text that came from a model and dim the whole text column. The existing width files
 * cover an unreplied row; this one covers the row the reply flow draws, at the widths where the mark
 * matters most — narrow enough that everything is cut — because the mark is one grapheme of content a
 * cut can reach before the pin's text does.
 *
 * Two invariants, asserted for every width from 1 to 40 on the rail and from the frame's floor up on
 * the panel: a row drawn with `plainStyle` carries no escape byte and no break, and every row measures
 * within the width the caller gave it. The panel's version is stronger — each line has to measure
 * *exactly* the width, because the overlay is flush right and a short row lets the chat behind it show
 * through — and it draws nothing at all below the width a frame cannot close at.
 */
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { PANEL_MIN_FRAME_COLUMNS, buildPanelLines, panelPinRows } from "../src/panel-lines.ts";
import { plainStyle, renderRailLines } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, NOW_TIME, pin } from "./fixtures.ts";
import { HOSTILE, offenders } from "./panel-hostile.ts";

const replied = (id: number, text: string): ViewPin => ({
  ...pin(id, text, "info", { createdAt: NOW }),
  repliedAt: LATER,
});

/** The rail at a width, with the clock pinned so a row is a string a test can compare. */
const rail = (pins: readonly ViewPin[], width: number): string[] =>
  renderRailLines({ pins, removed: [] }, width, {
    maxLines: 8,
    style: plainStyle,
    formatTime: () => NOW_TIME,
  });

/** Identity colours, including the selection bar, for the panel's builder. */
const plainPanel: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** Every line exactly `width` columns, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

describe("a replied rail row", () => {
  test("stays within the width and free of escapes at every width from 1 to 40", () => {
    for (let width = 1; width <= 40; width++) {
      const lines = rail([replied(1, "Decide X")], width);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        expect(line).not.toInclude("\u{1b}");
        expect(line).not.toInclude("\n");
      }
    }
  });

  test("keeps the mark at the front of the text column when the row is cut", () => {
    // Wide enough for the id and the time, too narrow for the text: whatever is left of the row has to
    // be the beginning of the text column, so the user still sees which pins they have answered.
    const [, line] = rail([replied(1, "a very long decision indeed")], 22);
    expect(line ?? "").toInclude("↩ ");
    expect(line ?? "").not.toMatch(/↩\s*$/);
    expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(22);
  });

  test("carries no escape byte when the pin text is hostile and the row is replied", () => {
    // The mark is added after the sanitizer, so a hostile text is cut *with* the mark in front of it:
    // this is the case where the injected reset plus ellipsis could otherwise survive into a
    // transcript line.
    const ESC = String.fromCharCode(0x1b);
    const hostile = [
      `${ESC}[2J`,
      `${ESC}]52;c;AAAA\u{07}pwn`,
      `a${ESC}]8;;https://evil${ESC}\\label`,
      `x${ESC}`,
      `y${ESC}[0m\u{2026}${ESC}[0m`,
      cleanPinText(HOSTILE),
    ];
    for (const text of hostile) {
      for (let width = 1; width <= 40; width++) {
        for (const line of rail([replied(1, text)], width)) {
          expect(line).not.toInclude(ESC);
          expect(line).not.toInclude("\n");
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("a replied row whose text draws nothing still fits and stays plain", () => {
    // Combining marks alone sanitize to a non-empty string of zero display width, so the mark is the
    // only printable content in the row and the cut has to hold anyway.
    const marks = String.fromCodePoint(0x0301, 0x0301);
    for (const width of [1, 2, 3, 10, 20, 40]) {
      for (const line of rail([replied(1, marks)], width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        expect(line).not.toInclude("\u{1b}");
      }
    }
  });

  test("a wide replied row dims the mark and the text as one column", () => {
    // A style that names what it colours: the text column is asked for as a single unit, so the mark and
    // the text cannot be dimmed apart — and the id and the time are dimmed separately, as before.
    const painted: string[] = [];
    const lines = renderRailLines({ pins: [replied(1, "Decide X")], removed: [] }, 60, {
      maxLines: 8,
      style: {
        header: (s) => s,
        marker: (_level, s) => s,
        dim: (s) => {
          painted.push(s);
          return `<d:${s}>`;
        },
      },
    });
    expect(lines[1]).toInclude("<d:↩ Decide X>");
    // The mark is never dimmed on its own: one call carries the whole text column.
    expect(painted.some((s) => s === "↩ ")).toBe(false);
  });
});

describe("a replied panel row", () => {
  test("fills the width exactly and carries no escapes at every width the frame closes at", () => {
    // The builder draws nothing below the frame's own floor — an open box is the failure it exists to
    // make impossible — so the sweep starts where a frame closes rather than at one column.
    for (let width = PANEL_MIN_FRAME_COLUMNS; width <= 40; width++) {
      const lines = buildPanelLines(
        { pins: [replied(1, "Decide X")], selection: 0, focused: false },
        width,
        5,
        plainPanel,
      );
      expect(lines).toHaveLength(5);
      expectUniformWidth(lines, width);
      for (const line of lines) {
        expect(offenders(line)).toEqual([]);
      }
    }
  });

  test("a selected replied row keeps the bar, the mark and the width", () => {
    for (let width = PANEL_MIN_FRAME_COLUMNS; width <= 40; width++) {
      const lines = buildPanelLines(
        { pins: [replied(1, "Decide X")], selection: 0, focused: true },
        width,
        5,
        plainPanel,
      );
      expectUniformWidth(lines, width);
      const row = lines[1] ?? "";
      expect(row).toInclude("[");
      expect(row).toInclude("↩");
      expect(offenders(row)).toEqual([]);
    }
  });

  test("hostile text in a replied pin is drawn as text at the widths that force a cut", () => {
    for (const focused of [false, true]) {
      for (const width of [12, 20, 33]) {
        const lines = buildPanelLines(
          {
            pins: [{ ...replied(1, cleanPinText(HOSTILE)), level: "warning" }],
            selection: 0,
            focused,
          },
          width,
          6,
          plainPanel,
        );
        expectUniformWidth(lines, width);
        for (const line of lines) expect(offenders(line)).toEqual([]);
      }
    }
  });

  test("the mark opens every row of a replied pin that wraps, and no row is empty", () => {
    // A wrap that reaches the mark: `↩ ` is part of the wrapped text, so the first row carries it and
    // the continuation lines stay under the text column. An empty row would draw a bar over nothing.
    const rows = panelPinRows(
      replied(1, "a decision that has to wrap somewhere in here"),
      20,
      plainPanel,
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.text).toInclude("↩ a decision");
    for (const row of rows) {
      expect(row.text.trim()).not.toBe("");
      expect(offenders(row.text)).toEqual([]);
    }
  });

  test("a replied pin with no text still owns a row that carries the mark", () => {
    const rows = panelPinRows(replied(1, ""), 20, plainPanel);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toInclude("↩");
  });
});
