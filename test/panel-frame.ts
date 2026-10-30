import { expandedPinOf } from "../src/panel-expand.ts";
import { panelLayoutSections } from "../src/panel-frame-layout.ts";
import { buildPanelLines } from "../src/panel-lines.ts";
import type { PanelContent } from "../src/panel-lines.ts";
/**
 * The one way a test draws a panel frame.
 *
 * `panelLayoutSections` owns the row table *and* the height, and `buildPanelLines` draws both — so a test
 * that wants a frame has to build the table and hand the builder the same width, terminal and selection it
 * was built against. Six files used to spell that pair themselves, and the two hand-rolled copies in
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
 * `PanelComponent` does through `PanelMemory`, and hands the builder, the layout and the frame's title the
 * *same* sections and the *same* drawn array. That matters twice over: the selection is a pin index into the
 * drawn order, and the counts in the title are read off the sections — a helper that laid the table out over
 * the view and then drew it against a differently-ordered `content.pins`, or a title that grouped them again,
 * would highlight one pin's row for a selection that names another and print counts no heading agrees with.
 */
import type { PanelLayout } from "../src/panel-row-owner.ts";
import type { PanelSection } from "../src/panel-sections.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { TERMINAL_ROWS } from "./panel-hostile.ts";

/** One frame's worth of drawing: the lines the builder returned and the table the height came from. */
export interface DrawnFrame {
  lines: string[];
  layout: PanelLayout;
}

/**
 * What a test writes to ask for a frame: the pins, the bar, the focus flag, the resting label and the age
 * the rows are stamped at. `sections` is deliberately absent — `drawnFrame` fills it in from the one
 * sectioning it also hands the layout, exactly as `PanelComponent` does from `PanelMemory`, so a test can
 * neither group the view for the title separately from the rows nor forget the field.
 */
export function content(
  pins: readonly ViewPin[],
  selection = 0,
  focused = false,
  replyHint = "",
  ageNow = LATER,
) {
  return { pins, selection, focused, replyHint, ageNow };
}

/**
 * What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints.
 *
 * `keys` is the host's second answer — whether the open frame may name the keys (`PanelHost.interactiveOpen`)
 * — and defaults to the answer a shown panel gives. A case that wants the `PI_STICKY_PANEL=open` divergence
 * (the frame stays the full one once the earned open has ended, so the gate answers `false`) sets it, and the
 * pin under the bar then draws collapsed whatever `focused` says.
 */
export type FrameRequest = ReturnType<typeof content> & { keys?: boolean };

/**
 * One frame drawn the way the component draws it: the view's pins put into sections, then one layout pass
 * over those very sections, then the builder handed the same drawn order the table was built from.
 *
 * The single place a test pairs the table with the drawer, and the reason a test never has to name a
 * section: it hands over pins and gets the frame the component would put on screen for them.
 */
function drawnFrame(
  content: FrameRequest,
  width: number,
  style: PanelStyle,
  terminalRows: number,
): DrawnFrame {
  const sections = panelSections(content.pins);
  // The frame's one expansion, computed by the predicate the component computes: a test draws a focused frame
  // whose bar names a `compact` pin and gets the entry the component would have grown, and a test that hands
  // `focused: false`, a bar past the end or `keys: false` gets the collapsed table. A helper that decided the
  // expansion for itself would be a second rule, and the one the tests were written against. The frame a test
  // asks for is always the open one — the peek is drawn by `panel-peek.ts` and takes no keys to expand under.
  const expanded = expandedPinOf(
    sections.flat,
    "open",
    content.keys ?? true,
    content.focused,
    content.selection,
  );
  const layout = panelLayoutSections(
    sections,
    width,
    terminalRows,
    content.selection,
    style,
    content.ageNow,
    // The pin the table grows, from the same predicate the component asks — `content.focused` never reaches
    // the layout itself, only the frame's decision about which pin to expand (see `test/panel-frame.ts`'s
    // header): a test that draws a focused frame gets the table the component would have laid out for it.
    expanded,
  );
  // The pins the frame draws are the flattened drawn order, and the sections its title prints are the ones
  // the table was built from — so the builder's `selection` indexes the same list the table's owners were
  // numbered over and its counts name the same rows, which is the whole promise the bar rests on.
  const drawn: PanelContent = { ...content, pins: sections.flat, sections: sections.order };
  return { lines: buildPanelLines(drawn, width, style, layout), layout };
}

/**
 * The frame drawn exactly as the component draws it: one sectioning, one `panelLayoutSections` pass at
 * `width`, and the builder handed that very table — so no test sizes one frame and draws another, and none
 * can wrap the pins at a width the frame it asserts on was not drawn at.
 */
export function built(
  content: FrameRequest,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): string[] {
  return drawnFrame(content, width, style, terminalRows).lines;
}

/** Both at once, for a test that asserts on the table *and* on the lines cut from it. */
export function framed(
  content: FrameRequest,
  width: number,
  style: PanelStyle,
  terminalRows = TERMINAL_ROWS,
): DrawnFrame {
  return drawnFrame(content, width, style, terminalRows);
}
