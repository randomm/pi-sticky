import { panelLayoutSections } from "./panel-frame-layout.ts";
/**
 * The open panel's rows: one layout pass at the width pi-tui just handed over, and the builder handed that
 * very table.
 *
 * The row table is what both the frame's height and the drawn window come from, so a pin is wrapped once per
 * frame and a resize sizes the box at the width it is *drawn* at rather than the last cached one.
 * `panelLayoutSections` owns the height — section headings included — and is handed the very sections whose
 * `flat` the content prints, so the rows the frame draws and the counts its title prints were grouped from
 * one view and cannot disagree.
 *
 * The `focused` the content carries is already the drawn focus — the component's flag and the key gate ANDed
 * by `keysLive` (`panel-frame-draw.ts`) — so this file never asks whether the panel takes keys: the bar, the
 * border colour and the bottom border's legend all answer that one already-decided fact. The row table's one
 * expansion answers a second, narrower fact the frame hands it — `frame.expanded`, the pin the bar is on when
 * that pin is `compact` — because a frame can be focused and still expand nothing.
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
  /**
   * The **selection** coordinate of the one `compact` pin whose entry this frame's row table expands, or
   * `undefined` to expand nothing — `expandedPinOf` (`panel-frame-draw.ts`) answers it once per frame and the
   * frame hands it here, so the layout grows the pin the bar, `d` and `Enter` index and nothing else.
   *
   * Kept beside `content` rather than inside it: the drawer never reads it — only the table this file builds
   * does — and the frame is the object that ties the two halves together.
   */
  expanded: number | undefined;
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
    // The very flag the drawer draws its bar from (`content.focused`, already `keysLive`'s answer): an
    // expanded entry is never drawn without its bar, because the bar and the entry answer one question the
    // frame settled before either of them was built.
    frame.content.focused,
    // …and the pin the table grows, from the same frame: `undefined` is the caller that expands nothing.
    frame.expanded,
  );
  return buildPanelLines(frame.content, frame.width, frame.style, layout);
}
