/**
 * The one way a test draws a panel frame.
 *
 * `panelLayout` owns the row table *and* the height, and `buildPanelLines` draws both — so a test that
 * wants a frame has to build the table and hand the builder the same width, terminal and selection it was
 * built against. Six files used to spell that pair themselves, and the two hand-rolled copies in
 * `panel-lines-height.test.ts` (`layoutOf` and `drawn`) were where a layout change silently disagreed
 * with what the component actually does: same function, four arguments, one of them a terminal rows the
 * caller remembered to pass.
 *
 * `built` is the pair in one call, with the terminal named rather than assumed. A test that wants a short
 * *window* asks for a short terminal — that is the only thing that sizes a frame now — and a test that
 * wants to assert on the table itself asks for the layout with `framed`'s sibling call below.
 */
import { buildPanelLines } from "../src/panel-lines.ts";
import type { PanelContent } from "../src/panel-lines.ts";
import type { PanelLayout } from "../src/panel-rows.ts";
import { panelLayout } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import { TERMINAL_ROWS } from "./panel-hostile.ts";

/** One frame's worth of drawing: the lines the builder returned and the table the height came from. */
export interface DrawnFrame {
  lines: string[];
  layout: PanelLayout;
}

/** The row table and the frame's height, as the component builds them for a width and a terminal. */
export function frameLayout(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): PanelLayout {
  return panelLayout(content.pins, width, terminalRows, content.selection, style, content.ageNow);
}

/**
 * The frame drawn exactly as the component draws it: one `panelLayout` pass at `width`, and the builder
 * handed that very table — so no test sizes one frame and draws another, and none can wrap the pins at a
 * width the frame it asserts on was not drawn at.
 */
export function built(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): string[] {
  const layout = frameLayout(content, width, style, terminalRows);
  return buildPanelLines(content, width, style, layout);
}

/** Both at once, for a test that asserts on the table *and* on the lines cut from it. */
export function framed(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): DrawnFrame {
  const layout = frameLayout(content, width, style, terminalRows);
  return { lines: buildPanelLines(content, width, style, layout), layout };
}
