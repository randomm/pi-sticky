/**
 * What a panel frame costs in columns, and the size below which the id column stops fitting.
 *
 * Before a pin sees a column the frame owns six: a gutter and its space on each side (`GUTTER_COLUMNS` in
 * `panel-rows.ts`) and the two corners. The id/time tail owns eleven more — `#999 12:00` — and `pinRow`
 * puts a space between the text and the tail. Those numbers used to be read at the two call sites that
 * needed them: the row table was sized at `frameWidth - 4 - 10` while the builder cut each finished row at
 * `width - 4`, and on a pin wide enough for its text to be cut the *tail* went first, so the id read
 * `#100 …`. Two callers of one geometry agreeing on one subtraction is what this file exists for.
 *
 * The floor is here too, because the guarantee the text column is sized under — *a first row always has
 * room for its id and time* — is a statement about the narrowest frame the builder will close, and a
 * number that can move in two files cannot be checked against anything. The overlay's `minWidth` and the
 * builder's floor are `PANEL_MIN_FRAME_COLUMNS`, and `test/panel-id-never-cut.test.ts` sweeps every width
 * from that floor to 80 and every id to 999.
 */
import { PANEL_MIN_FRAME_COLUMNS } from "./panel-geometry.ts";

/**
 * The widest id/time tail a row carries. `panelPinRows` stamps `` `#${pin.id} ${formatLocalTime(...)}` ``
 * — the hash, three digits (the largest id the pin budget reaches), a space, `HH:MM` — and `pinRow` puts
 * one space in front of it. Reserved as a whole rather than as the id alone: `12:0` left at the end of a
 * cut row is the same defect one character to the right of the one this reserve exists to prevent.
 *
 * `test/panel-id-never-cut.test.ts` recomputes this from `visibleWidth` of the same string and pins the
 * frame floor against it, so the number cannot move out from under the promise without that failing.
 */
export const META_COLUMNS = 11;

/** The columns a frame takes off every width it is built at: the two gutters with their spaces, and the two corners. */
export const FRAME_COLUMNS = 6;

/** The columns between a pin's text and its tail: what `pinRow` puts before the meta. */
export const META_SEPARATOR_COLUMNS = 1;

/**
 * The narrowest frame in which a first row fits its widest id whole: the frame, the tail, the separator,
 * and one column of text — because a row with no text column is not a row at all (see `panelTextColumns`).
 *
 * `PANEL_MIN_FRAME_COLUMNS` is this number; the test that says so is the one that reads the sweep at the
 * floor, and moving either without the other is caught there rather than on the user's screen.
 */
export const MIN_COLUMNS_FOR_META = FRAME_COLUMNS + META_COLUMNS + META_SEPARATOR_COLUMNS + 1;

/**
 * Columns a pin's text gets in a frame of `width`: what is left once the frame and the id/time tail are
 * paid for.
 *
 * Never less than one column. A row whose text column is zero comes back from the wrap empty, and
 * `panelPinRows` then draws its fallback row — whose tail `pinRow` puts at column zero and `fitLine` cuts
 * away — which is how a `#id` used to disappear. One column of text always draws, cut with `…`, with the
 * meta whole beside it, so what a cut costs is always the text: the operator's rule for the id column.
 * Below `MIN_COLUMNS_FOR_META` the floor guarantees nothing, which is why the builder refuses to draw
 * there at all.
 */
export function panelTextColumns(width: number): number {
  return Math.max(1, width - FRAME_COLUMNS - META_COLUMNS - META_SEPARATOR_COLUMNS);
}
