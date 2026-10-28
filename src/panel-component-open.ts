import { panelLayoutSections } from "./panel-frame-layout.ts";
/**
 * The open panel's rows: one layout pass at the width pi-tui just handed over, and the builder handed that
 * very table.
 *
 * Extracted from `PanelComponent` because the component is the *cache* — it decides whether a frame has to
 * be built at all — and this is the part that builds one when it does. Two responsibilities, two files, and
 * one interface between them: the content the frame prints and the row table it is cut from.
 *
 * The row table is what both the frame's height and the drawn window come from, so a pin is wrapped once per
 * frame and a resize sizes the box at the width it is *drawn* at rather than the last cached one.
 * `panelLayoutSections` owns the height — section headings included — and is handed the very sections whose
 * `flat` the content prints, so the rows the frame draws and the counts its title prints were grouped from
 * one view and cannot disagree.
 */
import { buildPanelLines } from "./panel-lines.ts";
import type { PanelContent } from "./panel-lines.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { PanelStyle } from "./render.ts";

/** What one open frame is built from: the content it prints and the row table it is cut from. */
export interface OpenFrame {
  /** The pins, bar, focus, resting label, section order and age instant the rows print. */
  content: PanelContent;
  /** The one sectioning the content's `pins` were flattened out of. */
  sections: PanelSections;
  /** The width pi-tui asked for a frame at. */
  width: number;
  /** The colours the frame was resolved to on its first draw. */
  style: PanelStyle;
  /** The instant every age in this frame is stamped at — the same string the cache key's bucket came from. */
  ageNow: string;
}

/**
 * Lay the rows out and draw them.
 *
 * `terminalRows` is the height pi-tui's TUI stated when the component was constructed, and is `undefined`
 * for a component built without a TUI (a test's, or a host that never handed one over): the layout then
 * sizes the window from the pin list alone rather than guessing at a terminal it was never told about.
 */
export function buildOpenLines(terminalRows: number | undefined, frame: OpenFrame): string[] {
  const layout = panelLayoutSections(
    frame.sections,
    frame.width,
    terminalRows,
    frame.content.selection,
    frame.style,
    frame.ageNow,
  );
  return buildPanelLines(frame.content, frame.width, frame.style, layout);
}
