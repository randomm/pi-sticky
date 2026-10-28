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
 * wants the table and the lines together takes `framed` — the one pair a frame is ever drawn from.
 *
 * These helpers take **the view's own pins**, the way every panel test has always written them, and put the
 * frame through the same order the component puts it through: `drawnFrame` sections them first, the way
 * `PanelComponent` does through `PanelMemory`, and hands the builder and the layout the *same* drawn array.
 * That matters because the selection is a pin index into the drawn order: a helper that laid the table out
 * over the view and then drew it against a differently-ordered `content.pins` would highlight one pin's row
 * for a selection that names another, and every bar and window assertion in the suite would be reading a
 * frame no component draws.
 */
import type { PanelLayout } from "../src/panel-frame-layout.ts";
import { panelLayoutSections } from "../src/panel-frame-layout.ts";
import { buildPanelLines } from "../src/panel-lines.ts";
import type { PanelContent } from "../src/panel-lines.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle } from "../src/render.ts";
import { TERMINAL_ROWS } from "./panel-hostile.ts";

/** One frame's worth of drawing: the lines the builder returned and the table the height came from. */
export interface DrawnFrame {
  lines: string[];
  layout: PanelLayout;
}

/**
 * One frame drawn the way the component draws it: the view's pins put into sections, then one layout pass
 * over those very sections, then the builder handed the same drawn order the table was built from.
 *
 * The single place a test pairs the table with the drawer, and the reason a test never has to name a
 * section: it hands over pins and gets the frame the component would put on screen for them.
 */
function drawnFrame(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  terminalRows: number,
): DrawnFrame {
  const sections = panelSections(content.pins);
  const layout = panelLayoutSections(
    sections,
    width,
    terminalRows,
    content.selection,
    style,
    content.ageNow,
  );
  // The pins the frame draws are the flattened drawn order, so the builder's `selection` indexes the same
  // list the table's owners were numbered over — which is the whole promise the bar rests on.
  const drawn: PanelContent = { ...content, pins: sections.flat };
  return { lines: buildPanelLines(drawn, width, style, layout), layout };
}

/**
 * The frame drawn exactly as the component draws it: one sectioning, one `panelLayout` pass at `width`, and
 * the builder handed that very table — so no test sizes one frame and draws another, and none can wrap the
 * pins at a width the frame it asserts on was not drawn at.
 */
export function built(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): string[] {
  return drawnFrame(content, width, style, terminalRows).lines;
}

/** Both at once, for a test that asserts on the table *and* on the lines cut from it. */
export function framed(
  content: PanelContent,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): DrawnFrame {
  return drawnFrame(content, width, style, terminalRows);
}
