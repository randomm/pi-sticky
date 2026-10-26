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

import { buildPanelLines, panelLayout } from "../src/panel-lines.ts";
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
function drawn(count: number, width: number, terminalRows: number | undefined): string[] {
  const pins = Array.from({ length: count }, (_unused, i) => one(i + 1, `Pin ${i + 1}`));
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
      // The ceiling is the terminal's half (or the fallback's, for a terminal that cannot be asked),
      // floored at the two border rows a closed frame is made of.
      const rows = typeof terminalRows === "number" ? terminalRows : 24;
      expect(counted).toBe(Math.max(2, Math.min(Math.floor(rows / 2), 200)));
    }
  }
});

test("one pin and three hundred pins draw the same number of lines at the same terminal", () => {
  // The regression the removed parameter allowed: a frame counted from 300 wrapped rows and drawn with
  // one, or the other way round. At one terminal height the frame's height is the terminal's, whatever
  // the list does, so the two frames are the same size and the window is what scrolls.
  for (const terminalRows of [12, 24, 40]) {
    const few = drawn(1, 40, terminalRows);
    const many = drawn(300, 40, terminalRows);
    expect(few[0]).toBe(many[0]);
    expect(few.length).toBe(many.length);
    expect(few.length - 1).toBe(terminalRows / 2);
  }
});
