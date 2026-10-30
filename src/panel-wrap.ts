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
 * figure — what a *continuation* row pays: the tail's reserve, and the marker cell twice over, once as the first
 * row's marker and once again as the indent every row below it hangs behind — and a text that came back on one
 * row is retried at the wide figure, where the cell is that row's own marker and nothing is paid twice.
 * Widening can drop a row but can never add one, so that second pass settles on its first answer. Starting wide
 * cannot make that argument: the rows a wide pass produced are the rows the table would hold, which are
 * precisely the rows the drawer re-cuts.
 *
 * Packing one cell short of that figure — at `room - cell`, as this module once did — leaves the shortfall on the
 * second row, the only row that pays both the reserve and the indent. That is the shape the report described,
 * and the sweep's lenient limit is what kept it green: with one pin in the view the row's own stamp *is* the
 * frame's widest, so `min(own, frame)` and the honest figure were the same number and the check could not fail.
 *
 * `inner` is a parameter rather than something recovered from `textWidth`, because the two are not derivable from
 * each other: `panelTextColumns` cuts `textWidth` out of the frame by taking the tail's reserve, the gutters and
 * the separators off the frame's width, but a caller that hands over the *inner* width as its text column (the
 * peek, which draws one row and asks the row table for the width it draws at) would have an `inner` reconstructed
 * nineteen columns wider than the frame. A wrap sized on that figure produces rows the drawer re-cuts, which is
 * the defect this module exists to prevent, wearing the shape of its own fix.
 *
 * A figure too narrow to hold a row of anything is answered with the text whole rather than a wrap: at a pack
 * width below one column `wrapTextWithAnsi`'s token fallback spells the text one grapheme per row, so a pin that
 * could have been cut on the drawer's side instead owns a row per character — and a *wide* grapheme (a CJK
 * ideograph, a family emoji) cannot be packed into a one-column figure at all, so it comes back on its own row
 * two columns wide. `panelPinRows` answers the degenerate text column with the marker cell alone; this is the
 * same fallback reached from the other side of the arithmetic, and it is the reason the two figures are bounded
 * before they reach the packer.
 *
 * The wide grapheme is a second, narrower case of the same refusal and is answered in place rather than by the
 * fallback: pi-tui's token fallback breaks a token it cannot fit only when the token measures *over* the width it
 * was handed, so a single two-column grapheme at a one-column figure is not over it in the way the fallback
 * notices — it is handed back whole, on its own row, and the drawer's re-cut spends an ellipsis on it. `whole`
 * below asks the packer's own question (`visibleWidth`, the same measure `pinRow` cuts on) of every row it
 * returns and re-packs the answer, so the only rows this module hands back are rows the drawer draws for free.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { META_SEPARATOR_COLUMNS } from "./panel-frame-geometry.ts";
import { MARKER_CELL_COLUMNS } from "./panel-frame.ts";
import { tailReserve } from "./panel-tail.ts";

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
 * A width the wrap may be handed: a finite integer of at least zero columns, whatever came in.
 *
 * `isPanelFrameSize` (`panel-geometry.ts`) refuses a fractional or non-positive width before the builder draws
 * anything, and that is the only gate the extension's own frames pass through — but `wrapAtDrawnWidth` is also
 * reached directly by tests and by any future caller, and both figures it packs with reach `wrapTextWithAnsi`:
 * a `NaN` compares false against every width, so the packer is handed a figure it never cuts to and returns the
 * text whole, and a fractional one is cut against a number `visibleWidth` — which answers whole columns — then
 * re-measures as over. Coercing here means the two figures the wrap and the drawer compare are the same integer.
 */
const bounded = (width: number): number =>
  Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;

/**
 * `rows` with any row still measuring over `width` broken at the grapheme the drawer would cut.
 *
 * The packer's fallback is a *token* rule, not a width rule: `wrapTextWithAnsi` breaks a token character by
 * character only while the token measures over the width it was handed, and pi-tui treats a Han/Hiragana/
 * Katakana/Hangul glyph as its own token. So a two-column ideograph offered a one-column figure is a token of
 * two columns handed a width of one — over it by the packer's own sum, then handed back whole by
 * `breakLongWord`'s grapheme loop, which cannot fit one grapheme in the columns it has and emits the whole
 * token as a line. The same shape arrives from an astral emoji, whose surrogate pair pi-tui segments as a
 * single grapheme of two columns. Either way the row reaches `pinRow` wider than the columns it was packed at
 * and the drawer's `fitPlain` re-cuts it, spending `…` on a pin the wrap could have broken itself.
 *
 * Measured with `visibleWidth` — the measure `pinRow` cuts on, not the packer's token sum — because the promise
 * this keeps is drawn columns, and a row `visibleWidth` agrees fits is a row `fitPlain` returns untouched.
 * `truncateToWidth` is called with no ellipsis: the break is the wrap's, not a cut, and the columns the row was
 * packed at belong to the text, not to a `…` the pin never wrote.
 */
function whole(rows: readonly string[], width: number): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (visibleWidth(row) <= width) {
      out.push(row);
      continue;
    }
    // A grapheme that alone exceeds `width` is kept rather than dropped: the row is then one wide glyph, which is
    // the row the drawer cuts, and a wrap that swallowed the character would lose it from the pin outright.
    let rest = row;
    while (visibleWidth(rest) > width) {
      const head = truncateToWidth(rest, width, "");
      if (head === "") {
        out.push(rest);
        rest = "";
        break;
      }
      out.push(head);
      rest = rest.slice(head.length);
    }
    if (rest !== "") out.push(rest);
  }
  return out;
}

/**
 * `plain` wrapped at the width the pin's rows are drawn at, for a frame `metaColumns` wide and `inner` across.
 *
 * `textWidth` is the frame's roomiest text column and stays the ceiling: this function may ask for less of it,
 * never more, so a caller that already cut the column down (a peek, a degenerate frame) keeps the width it asked
 * for rather than having the frame's width handed back to it.
 *
 * `inner` is the columns between the frame's gutters — the width `pinRow` closes a row to — and it is required
 * because the reserve the wrap gives up is `tailReserve`, which *clamps at the inner width*. Nothing outside the
 * frame can be added back to a text column to recover it.
 */
export function wrapAtDrawnWidth(
  plain: string,
  textWidth: number,
  metaColumns: number,
  inner: number,
): string[] {
  const room = textRoom(bounded(metaColumns), bounded(inner));
  const ceiling = bounded(textWidth);
  // Narrow first, and charged the indent **twice** — which is what a *continuation* row actually pays, and the
  // row whose fit decides the wrap. `pinRow` measures a row's whole text inside the columns its reserve leaves,
  // and the row table writes the marker cell twice over for a pin that wraps: once as the first row's marker,
  // once again as the three blanks every row below it hangs behind. The first row pays the reserve and one cell;
  // the second pays the reserve and the indent, and the second is the tighter of the two. Packing at
  // `room - cell` — what this line used to do — was one cell short, and the shortfall landed on exactly the row
  // the report named: the age's row, re-cut by the drawer, its last characters carried down to the line below.
  const narrow = Math.min(ceiling, room - 2 * MARKER_CELL_COLUMNS);
  // A figure too narrow to hold a row of anything is answered with the text whole rather than a wrap: `room` is
  // floored at one column by `tailReserve`'s own clamp, so below this bound the pack width has gone negative and
  // `wrapTextWithAnsi`'s token fallback would spell the text one grapheme per row — a row count no window
  // scrolls and no tail fits. The text whole is the row the drawer can cut, and the same fallback
  // `panelPinRows` gives for a frame with no text column at all.
  if (narrow < 1) return [plain];
  const wrapping = whole(wrapTextWithAnsi(plain, narrow), narrow);
  // One row and there is no indent to pay — the cell is that row's own marker and the text runs beneath it — so the
  // pin that fits the row it owns is never pushed into a second row by columns it never spent. The retry is
  // capped at the ceiling too: `room` is a figure of the *frame*, and a caller that handed the wrap a narrower
  // text column than that (the peek, the degenerate frame) keeps the width it asked for.
  return wrapping.length > 1
    ? wrapping
    : whole(wrapTextWithAnsi(plain, Math.min(ceiling, room)), Math.min(ceiling, room));
}
