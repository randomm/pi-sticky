/**
 * The one way these sweeps draw a *short* frame: a real focused component, or the helper's pair, at a
 * terminal too short for the table it holds.
 *
 * `test/panel-frame.ts` is the one way a test draws a frame; this file adds only the second coordinate the
 * window tests need — how tall the terminal is — and the component path for the cases that must see the frame
 * the *component* drew, because `d` and `Enter` live on the component and index the pin list the component
 * memorised. The two window-heading sweeps (the offset and the keys) were separate copies of the same
 * six lines, which is the kind of duplication that drifts: one file's terminal would change and the other's
 * would not, and the two would be asserting about different frames while still passing.
 */
import type { TUI } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";
import { framed } from "./panel-frame.ts";

/**
 * The terminal these sweeps draw against. `panelMaxRows` halves it and `panelFrameRows` puts the two border
 * rows over the table, so eighteen rows leave a seven-row window over `mixedView`'s ten-row table: three rows
 * of the table are always scrolled away, which is the only case in which a heading can be lost.
 */
export const SHORT_TERMINAL = 18;

/** The frame's content rows — the two borders taken off, so row 0 is the first row inside the frame. */
export function contentRows(lines: string[]): string[] {
  return lines.slice(1, -1);
}

/** The bar's row of a set of content rows: the one carrying the highlight, or -1 when none does. */
export function barRowOf(rows: string[]): number {
  return rows.findIndex((row) => row.includes("["));
}

/** A focused component over `view` with the bar on `selection`, drawn by the component itself. */
export function componentAt(
  view: ViewPin[],
  selection: number,
  width: number,
  style: PanelStyle,
  terminalRows: number = SHORT_TERMINAL,
) {
  const h = host(view);
  h.stub.style = () => style;
  // Named rather than spread onto the host's stub, which has no `terminal` at all: the component reads a
  // missing one as "no terminal to ask" and sizes the frame from `panelMaxRows`'s fallback instead.
  const tui = { ...h.tui, terminal: { columns: 80, rows: terminalRows } } as TUI;
  const c = new PanelComponent(h.stub, tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(selection);
  const lines = c.render(width);
  return { h, c, lines, rows: contentRows(lines), drawn: panelSections(view).flat };
}

/** The helper's pair — layout and lines — for `selection` over `view` at the short terminal. */
export function windowAt(
  view: ViewPin[],
  selection: number,
  width: number,
  style: PanelStyle,
  terminalRows: number = SHORT_TERMINAL,
) {
  const { lines, layout } = framed(
    { pins: view, selection, focused: true, replyHint: "", ageNow: LATER },
    width,
    style,
    terminalRows,
  );
  return { lines, layout, rows: contentRows(lines) };
}
