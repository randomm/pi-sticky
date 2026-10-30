/**
 * The options rows a pin with `options` draws beneath it, filled into the rows the row table reserved — and the
 * one function the frame asks to fill them.
 *
 * A pin may carry up to `MAX_OPTIONS` (`pin-fields.ts`) short labels — the actions the model offers the user,
 * which the user fills into the editor by number and submits themselves (U7: nothing here acts). A row spells
 * its entries `1 Passed on   2 Not yet`: the digit the user types, the label after it, and three spaces between
 * entries so a label that contains a space cannot read as two entries. The digit *is* the keycap — the `⌨` glyph
 * that used to stand in front of it rendered as a box in common terminal fonts and the spec never asked for it,
 * and the column it spent now belongs to the labels.
 *
 * Two rules the module is written around:
 *
 * - **The digit is composed from the colours the panel already has**, not a new member of `PanelStyle`: it goes
 *   through `style.header` and the label through `style.dim`, which is what a keycap looks like beside the rest
 *   of the frame without asking every hand-built style in the tests to learn a fourth verb. Those bytes are part
 *   of the row when it is measured, and the row is measured on what the terminal will actually occupy: the
 *   *label* is stripped by `stripSequences` (`escape.ts`) at the boundary that draws a model's word, before
 *   `style.dim` is asked for it, and the *theme's* bytes around it survive as colour (`stripNonSgr`, applied by
 *   `fitLine` on the way out). An escape pi-tui counts as *printable* (an unterminated OSC, a lone introducer)
 *   charges `visibleWidth` columns it will not draw, so measuring on an unstripped label would keep such an
 *   entry into a row the frame then cut from the text underneath — and drawing it would put a sequence the user
 *   never asked for on a flush-right overlay.
 * - **The rows are the row table's, not this module's.** How many rows a pin's options own is decided by the
 *   shared packing in `panel-options-wrap.ts` — the same function `optionRows` (`panel-rows.ts`) counts from —
 *   because the scroll window, the selection bar and `d`/`Enter` all index the count the table stamped. This
 *   module's job is to *fill* those rows, at the last moment and at the frame's own width, and it asks the same
 *   packing for their content. Reserved and drawn are therefore the same answer to the same question, which is
 *   what the old split (reserve one row, fill what fits) could not guarantee.
 *
 * The column the labels are packed against is the frame's **full inner width**, not the text column the pins'
 * rows wrap at: the options row carries no id/age tail, so it pays for no tail reserve (`panel-lines.ts` hands
 * this over). `panel-options-wrap.ts` owns that arithmetic and the whole-entry packing; this file only borrows
 * the row's closure, which is the frame's own (`fitLine`, `panel-draw.ts`).
 *
 * The labels are untrusted, and they are dealt with twice: `cleanField` (`pin-fields.ts`) sanitizes, folds and
 * bounds each one and refuses the pin outright when an entry will not store, and `isPinState` (`state-guards.ts`)
 * refuses a snapshot whose list is anything else — so the entries this row draws are strings, and **the digit it
 * prints names the position in the list**: entry *N* is `pin.options[N-1]`, the answer the user types. The wrap
 * strips each label it draws as well, because the view is also built directly by tests and by any future caller
 * and a drawn surface that leaned on a sanitizing pass elsewhere would borrow a guarantee it does not own.
 */
import { fitPlain } from "./panel-draw.ts";
import { drawOptionRows } from "./panel-options-wrap.ts";

import type { PanelRow } from "./panel-row.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/** The pad `optionRows` (`panel-rows.ts`) reserves a row with, and the row this module answers when it has no line. */
const OPTION_PAD = " ";

/**
 * The option rows of `pin`, as drawn lines: as many as its labels need at `inner`, each closing at exactly
 * `inner`.
 *
 * `inner` is the frame's **inner** width — the figure `buildPanelLines` (`panel-lines.ts`) draws between
 * the gutters, and the one `panelLayoutSections` handed the row table when it counted these rows. The two are
 * the same figure named by the same caller, which is the whole reason the count and the content can never
 * disagree. `index` is which of the pin's own option rows is wanted: the table numbered them when it reserved
 * them, and the drawer passes that number back — `buildPanelLines` counts the reserved rows above this one that
 * belong to the same pin, which is the only numbering the table left it.
 *
 * The colours are applied to the parts that survive the packing, so a theme's bytes never reach an entry that
 * was given up. Each row is closed by the frame's own policy: `fitPlain` (`panel-draw.ts`) is the closure every
 * drawn line of both frames passes through, and these are drawn lines. It was measured inside the wrap, so the
 * branch that pass takes is the pad, and the one reset it puts on the end of a coloured line
 * (`selectionReset`, `panel-frame.ts`) closes every colour the entries opened.
 */
export function fillOptionRow(
  pin: ViewPin,
  inner: number,
  style: PanelStyle,
  index: number,
): PanelRow {
  // The row the table reserved is one of the rows the very same packing just produced, so the index the window
  // scrolled to has a line here — unless the pin's options changed between the layout and the draw, which is the
  // pad the frame closes rather than a row of half-filled keycaps.
  const filled = optionLine(pin, inner, style, index);
  return { text: filled === null ? OPTION_PAD : filled, tail: "" };
}

/**
 * The `index`-th of `pin`'s option rows, closed to `inner`, or `null` when the pin owns no such row.
 *
 * The same read of `pin.options` `fillOptionRow` makes, in the shape `buildPanelLines` asks the *row table* for
 * when it wonders how many rows a pin's options cost: the frame cannot hold a reserved row this function has no
 * line for, and it cannot draw a line the table never counted, so the two questions have to be asked of one
 * packing. `null` rather than the pad is what lets the caller tell "no such row" from "a row of nothing".
 */
export function optionLine(
  pin: ViewPin,
  inner: number,
  style: PanelStyle,
  index: number,
): string | null {
  const filled = drawOptionRows(pin.options, inner, style)[index];
  return filled === undefined ? null : fitPlain(filled, inner);
}
