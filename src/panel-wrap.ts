/**
 * Wrapping a pin's text at the width its own rows are *cut* at.
 *
 * `pinRow` (`panel-draw.ts`) owns the only figure that matters here: it cuts a tail-bearing row's text to the
 * inner width between the gutters less `tailReserve` of the view's widest tail, and it measures that text with
 * the three columns of the marker cell *inside* the figure it just cut. So the wrap cannot be sized off the
 * frame's text column alone — a line packed to that width came back over the row's limit, and the drawer's re-cut
 * spent the row's last columns on an ellipsis: `…park fix` on the age's row, with the `ix` it ate carried down to
 * the line below. This module is the one place that answers the drawer's question back to it.
 *
 * The circularity is the interesting part, and it is cut rather than solved: the shape decides which columns a
 * row gives up (two rows and the age owns one, so every row hangs behind the indent; one row and the pair shares
 * the row with the text), but only the wrap says how many rows a text needs. So the wrap runs at the *narrow*
 * figure every row of a wrapping pin pays, and a text that came back on one row is retried at the wide figure —
 * widening can drop a row but can never add one, so that second pass settles on its first answer. Starting wide
 * cannot make that argument: the rows a wide pass produced are the rows the table would hold, which are precisely
 * the rows the drawer re-cuts.
 */

import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { META_SEPARATOR_COLUMNS } from "./panel-frame-geometry.ts";
import { tailReserve } from "./panel-tail.ts";

/**
 * The columns a pin row spends in front of its text: the space, the marker's own column and the space after it —
 * ` ${markerCell(...)}` in `panelPinRows` (`panel-rows.ts`), and the same three again as the indent of every row
 * below the first.
 */
const MARKER_CELL_COLUMNS = 3;

/**
 * The columns `pinRow` leaves the text of a row that owns a tail, before its own prefix is charged.
 *
 * `tailReserve` is called rather than restated here on purpose: it is the figure `pinRow` cuts to *and* pads the
 * tail out to, and it holds the clamp that keeps a row at the frame's floor a row of something. A wrap that
 * spelled the subtraction itself would be a second owner of that floor, and the two would drift.
 */
function textRoom(metaColumns: number, inner: number): number {
  return Math.max(1, inner - tailReserve(metaColumns, inner, META_SEPARATOR_COLUMNS));
}

/**
 * `plain` wrapped at the width the pin's rows are drawn at, for a frame `metaColumns` wide and `inner` across.
 *
 * `textWidth` is the frame's roomiest text column and stays the ceiling: this function may ask for less of it,
 * never more, so a caller that already cut the column down (a peek, a degenerate frame) keeps the width it asked
 * for rather than having the frame's width handed back to it.
 */
export function wrapAtDrawnWidth(
  plain: string,
  textWidth: number,
  metaColumns: number,
  inner: number,
): string[] {
  const room = textRoom(metaColumns, inner);
  // Narrow first, and charged the indent: the width *every* row of a wrapping pin pays, so no row this returns can
  // come back over the limit the drawer measures it against.
  const wrapping = wrapTextWithAnsi(plain, Math.min(textWidth, room - MARKER_CELL_COLUMNS));
  // One row and there is no indent to pay — the cell is that row's own marker and the text runs beneath it — so the
  // pin that fits the row it owns is never pushed into a second row by columns it never spent.
  return wrapping.length > 1 ? wrapping : wrapTextWithAnsi(plain, Math.min(textWidth, room));
}
