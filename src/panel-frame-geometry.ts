/**
 * What a panel frame costs in columns, and the size below which the id column stops fitting.
 *
 * Before a pin sees a column the frame owns six: the two gutters and their spaces and the two corners —
 * `FRAME_COLUMNS`, the sum of `GUTTER_COLUMNS` (`panel-rows.ts`) and `CORNER_COLUMNS` (`panel-frame.ts`). The
 * tail owns eleven more at the widest id the panel reserves room for, and `pinRow` puts a space between the
 * text and the tail. Those numbers used to be read at the two call
 * sites that needed them: the row table was sized at `frameWidth - 4 - 10` while the builder cut each
 * finished row at `width - 4`, and on a pin wide enough for its text to be cut the *tail* went first, so
 * the id read `#100 …`. Two callers of one geometry agreeing on one subtraction is what this file exists
 * for.
 *
 * The tail's reserve is *not* a constant. Pin ids are never capped at 999 — `nextId` keeps counting and
 * `MAX_PIN_ID` (`bounds.ts`) is `Number.MAX_SAFE_INTEGER`, 20 digits long — so a flat eleven-column
 * reserve is a guarantee that quietly fails at `#1000`. `widestMetaColumns` measures the tails the view
 * actually carries, `panelPinRows` remains the one owner of the tail's *format*, and `META_COLUMNS` is
 * what is left of the old constant: the floor the reserve never goes below.
 *
 * The floor is here too, because the guarantee the text column is sized under — *a first row always has
 * room for its id and time* — is a statement about the narrowest frame the builder will close.
 * `MIN_COLUMNS_FOR_META` is that arithmetic, and the builder's floor is pinned to it
 * (`PANEL_MIN_FRAME_COLUMNS`, `panel-geometry.ts`) by `test/panel-id-wide.test.ts`, which also sweeps every
 * width from that floor to 80: every id to 999 in `test/panel-id-never-cut.test.ts`, and every id past it in
 * `test/panel-id-wide.test.ts`.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import { CORNER_COLUMNS } from "./panel-frame.ts";
import { PANEL_MIN_FRAME_COLUMNS } from "./panel-geometry.ts";
import { GUTTER_COLUMNS, pinMeta } from "./panel-rows.ts";
import { formatLocalTime } from "./time.ts";
import type { ViewPin } from "./types.ts";

/**
 * A pin-shaped stand-in for the tail's reserved floor: `pinMeta` over the widest id the panel reserves room
 * for, at an epoch timestamp. `formatLocalTime` is what stamps every real tail and `HH:MM` is five columns
 * whatever the zone, so the width is the product's and only the id varies — which is what the reserve exists
 * for. (A pin of id 999, not the number 999: measuring this file's own spelling of the tail would be a second
 * copy of the format `pinMeta` owns.)
 */
const RESERVED_PIN: ViewPin = {
  id: 999,
  uid: "reserved-tail",
  text: "",
  level: "info",
  source: "agent",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

/** The columns `pinRow` puts before the tail, beside the tail itself rather than inside it. */
export const META_SEPARATOR_COLUMNS = 1;

/**
 * The columns the frame takes off every width it is built at: the two gutters with their spaces and the two
 * corners. The sum of the two owners — `GUTTER_COLUMNS` is `panel-rows.ts`'s, `CORNER_COLUMNS` is
 * `panel-frame.ts`'s — so neither half can be edited on its own and leave this arithmetic behind.
 */
export const FRAME_COLUMNS = GUTTER_COLUMNS + CORNER_COLUMNS;

/**
 * The floor of the id/time tail's reserve, in columns: the width of `pinMeta(RESERVED_PIN)` (`#999 12:00`) plus the
 * separator — the tail the panel reserves room for out of the box, chosen because that is the widest id a
 * session of the whole pin budget (`MAX_PINS`, `bounds.ts`) ever mints before its ids start counting up.
 *
 * A floor, not the reserve. `widestMetaColumns` measures the tails a view really carries and never returns
 * less than this, because ids are not capped at three digits: `nextId` counts up to `MAX_PIN_ID`, so the
 * reserve is sized per frame from the ids on screen and this is only the floor under it — what a view of
 * one-digit ids costs the frame, and the least the builder will ever leave the tail.
 */
export const META_COLUMNS = visibleWidth(pinMeta(RESERVED_PIN)) + META_SEPARATOR_COLUMNS;

/**
 * The narrowest frame in which a first row fits its widest reserved id whole: the frame, the tail, the
 * separator, and one column of text — because a row with no text column is not a row at all (see
 * `panelTextColumns`).
 *
 * `PANEL_MIN_FRAME_COLUMNS` (the overlay's own `minWidth`) is pinned to this number by
 * `test/panel-id-wide.test.ts`: the builder's floor must sit at or above the width the reserved tail needs
 * beside a column of text, so a frame the overlay may hand over is always one the `#id` fits in. Moving
 * either number without the other is caught there rather than on the user's screen.
 */
export const MIN_COLUMNS_FOR_META = FRAME_COLUMNS + META_COLUMNS + META_SEPARATOR_COLUMNS + 1;

/**
 * The columns the widest id/time tail in `pins` owns: `visibleWidth` of the very string `pinMeta` stamps, so
 * the tail's format stays in that one owner (`panel-rows.ts`) and this only measures it.
 *
 * Never less than `META_COLUMNS`: the reserve is what the text column gives up, and a view of small ids must
 * cost the frame what it cost before ids could outgrow three digits. A frame whose ids are wider than that
 * pays for them out of the text column, which is the operator's rule — *the text yields, never the id* — and
 * the reserve is measured across the whole view rather than per pin, so the layout cannot wrap a row at a
 * width the builder then has to cut to fit a wider id beside it.
 */
export function widestMetaColumns(pins: readonly ViewPin[]): number {
  let widest = META_COLUMNS;
  for (const pin of pins) {
    const width = visibleWidth(pinMeta(pin));
    if (width > widest) widest = width;
  }
  return widest;
}

/**
 * Columns a pin's text gets in a frame of `width` whose widest id/time tail is `metaColumns` — what is
 * left once the frame and that tail are paid for.
 *
 * `metaColumns` comes from `widestMetaColumns` for the frame's own pins; passing it explicitly (rather
 * than taking it from `width`) is what keeps a wide id from being cut: the wrap is sized so a first row
 * still has a column of text to draw *and* room for `#<id> HH:MM` beside it, because a row whose text
 * column is zero collapses to a blank line `pinRow` draws without its tail — which is how a `#id` used to
 * disappear on a narrow panel. One column of text always draws, cut with `…`, with the meta whole beside
 * it. Below `MIN_COLUMNS_FOR_META` the floor guarantees nothing, which is why the builder refuses to draw
 * there at all.
 */
export function panelTextColumns(width: number, metaColumns: number): number {
  return Math.max(1, width - FRAME_COLUMNS - metaColumns - META_SEPARATOR_COLUMNS);
}
