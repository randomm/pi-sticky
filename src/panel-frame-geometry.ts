/**
 * What a panel frame costs in columns, and the size below which the id column stops fitting.
 *
 * Before a pin sees a column the frame owns six: the two gutters and their spaces and the two corners —
 * `FRAME_COLUMNS`, the sum of `GUTTER_COLUMNS` (`panel-tail.ts`) and `CORNER_COLUMNS` (`panel-frame.ts`). The
 * tail owns eleven more at the widest id the panel reserves room for, and `pinRow` puts a space between the
 * text and the tail. Those numbers used to be read at the two call
 * sites that needed them: the row table was sized at `frameWidth - 4 - 10` while the builder cut each
 * finished row at `width - 4`, and on a pin wide enough for its text to be cut the *tail* went first, so
 * the id read `#100 …`. Two callers of one geometry agreeing on one subtraction is what this file exists
 * for.
 *
 * A heading row is laid out by `headingColumns` beside this: it shares the text column's *start*, so its
 * word lines up with the pin text under it, and pays for no tail of its own — it names a section, not a pin,
 * so there is no id to keep off the cut.
 *
 * The tail's reserve is *not* a constant. Pin ids are never capped at 999 — `nextId` keeps counting and
 * `MAX_PIN_ID` (`bounds.ts`) is `Number.MAX_SAFE_INTEGER`, 20 digits long — so a flat eleven-column
 * reserve is a guarantee that quietly fails at `#1000`. `widestMetaColumns` measures the tails the view
 * actually carries — the *drawn* tails, the theme's `dim` included, because the row spends what it prints —
 * `metaStamp` (`panel-tail.ts`) remains the one owner of the tail as it is drawn, and `META_COLUMNS` is
 * what is left of the old constant: the floor the reserve never goes below.
 *
 * The floor is here too, because the guarantee the text column is sized under — *a first row always has
 * room for its id and time* — is a statement about the narrowest frame the builder will close.
 * `MIN_COLUMNS_FOR_META` is that arithmetic, and the builder's floor is pinned to it
 * (`PANEL_MIN_FRAME_COLUMNS`, `panel-geometry.ts`) by `test/panel-id-wide.test.ts`, which asserts the floor
 * sits at or *above* it — never below, which is the case where the `#id` would draw in a frame too narrow for
 * it — and sweeps every width from that floor to 80 with a theme whose `dim` adds columns, so the bound is
 * stated in the columns the row really spends. Every id to 999 in `test/panel-id-never-cut.test.ts`, and
 * every id past it in `test/panel-id-wide.test.ts`.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import { CORNER_COLUMNS } from "./panel-frame.ts";
import { PANEL_MIN_FRAME_COLUMNS } from "./panel-geometry.ts";
import { GUTTER_COLUMNS, fullStamp, widestStampColumns } from "./panel-tail.ts";
import type { MetaDimmer } from "./panel-tail.ts";
import type { ViewPin } from "./types.ts";

/**
 * A pin-shaped stand-in for the tail's reserved floor: the id half of the widest id the panel reserves room
 * for. The age half is `RESERVED_NOW`'s job, not this one's — see the pair below.
 *
 * (A pin of id 999, not the number 999: spelling the tail here would be a second copy of the format
 * `panel-row-tail.ts` owns.)
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

/**
 * The instant that makes `RESERVED_PIN`'s age the four-column `999d` the floor is sized on: exactly 999 days
 * after the pin's own stamp.
 *
 * The age is a *difference*, so it is the pair that spells `#999 999d` — the pin's `createdAt` and the instant
 * it is aged against, 999 days apart. Read the two the wrong way and the floor stops measuring the tail the
 * panel means to reserve: both halves on the same side of the difference and the answer is `--` (two columns
 * instead of four), or a gap a thousand years wide and the answer is the formatter's largest day count, which
 * charges every frame for columns no row ever draws. `formatPinAge` (`time.ts`) caps nothing, so the distance
 * has to be named rather than assumed from a year.
 */
/** 999 days: the widest age the panel reserves a tail for, as the difference `RESERVED_NOW` is measured by. */
const RESERVED_AGE_MS = 999 * 24 * 60 * 60 * 1000;

/**
 * The instant to measure the floor at, spelled as an offset rather than through `Date`.
 *
 * `toISOString()` throws `RangeError: Invalid Date` on an unparseable stamp, so it would abort the module
 * before the check below ever ran: the failure would be loud, but not this one, and not with the message that
 * names the pair to fix. Measuring the age as a millisecond difference keeps the arithmetic the header states
 * (999 days, as a difference) and leaves the module to answer for itself.
 */
const RESERVED_NOW_MS = Date.parse(RESERVED_PIN.createdAt) + RESERVED_AGE_MS;

// Loud here rather than wrong further down: if either stamp stops parsing, `RESERVED_NOW` is `NaN`, the
// reserved tail stamps as `--`, and the floor silently drops to the width of two characters — every frame then
// charges the text for columns the tail does not take, and the `#id` is what the row cuts. A module that throws
// while loading says so; a module whose floor is quietly small says nothing until a user's panel loses an id.
// `RESERVED_PIN.createdAt` is a literal, so this can only fire through an edit.
if (Number.isNaN(RESERVED_NOW_MS)) {
  throw new Error(
    "panel-frame-geometry: the reserved tail's stamps do not parse, so META_COLUMNS measures nothing",
  );
}

const RESERVED_NOW = new Date(RESERVED_NOW_MS).toISOString();

/**
 * The columns `pinRow` puts before the tail, beside the tail itself rather than inside it.
 */
export const META_SEPARATOR_COLUMNS = 1;

/**
 * The tail the panel reserves room for out of the box, stamped by the one module that stamps tails.
 *
 * Read lazily rather than as a module constant: it is measured through the same stamping the rows use, and a
 * constant here would run that arithmetic while this module is still evaluating — the failure
 * `panel-tail.ts`'s header records for the pair of modules this one sits between.
 */
const reservedTail = (): string => fullStamp(RESERVED_PIN, (text) => text, RESERVED_NOW);

/**
 * The tail the floor is measured on, spelled for the test that checks the floor still measures it.
 *
 * Exported because the promise it pins — `META_COLUMNS` is the width of the *actual* reserved tail, not of a
 * literal someone estimated — cannot be checked from outside without either copying the format (the failure
 * this whole area exists to prevent) or reading the constant back against itself (which proves nothing). One
 * exported spelling, read by the arithmetic and by the assertion over the arithmetic — which asserts the
 * *spelling* (`" #999 999d"`) and then the arithmetic against a literal, so neither half can move alone.
 */
export const RESERVED_TAIL = reservedTail();

/**
 * The columns the frame takes off every width it is built at: the two gutters with their spaces and the two
 * corners. The sum of the two owners — `GUTTER_COLUMNS` is `panel-tail.ts`'s, `CORNER_COLUMNS` is
 * `panel-frame.ts`'s — so neither half can be edited on its own and leave this arithmetic behind.
 */
export const FRAME_COLUMNS = GUTTER_COLUMNS + CORNER_COLUMNS;

/**
 * The floor of the id/age tail's reserve, in columns: the width of the whole tail `RESERVED_PIN` draws at
 * `RESERVED_NOW` (`#999 999d`) plus the separator — the tail the panel reserves room for out of the box,
 * chosen because that
 * is the widest id a session of the whole pin budget (`MAX_PINS`, `bounds.ts`) ever mints before its ids start
 * counting up, and the widest age the formatter answers beside it.
 *
 * A floor, not the reserve. `widestMetaColumns` measures the tails a view really carries and never returns
 * less than this, because ids are not capped at three digits: `nextId` counts up to `MAX_PIN_ID`, so the
 * reserve is sized per frame from the ids on screen and this is only the floor under it — what a view of
 * one-digit ids costs the frame, and the least the builder will ever leave the tail.
 */
export const META_COLUMNS = visibleWidth(RESERVED_TAIL) + META_SEPARATOR_COLUMNS;

/**
 * The narrowest frame in which a first row fits its widest reserved id whole: the frame, the tail, the
 * separator, and one column of text — because a row with no text column is not a row at all (see
 * `panelTextColumns`).
 *
 * `PANEL_MIN_FRAME_COLUMNS` (the overlay's own `minWidth`) is pinned to this number by
 * `test/panel-id-wide.test.ts`: the builder's floor must sit at or above the width the reserved tail needs
 * beside a column of text (`>=`, which is what that test asserts — a floor *above* the arithmetic only asks
 * for a wider frame than the tail needs), so a frame the overlay may hand over is always one the `#id` fits
 * in. Moving either number without the other is caught there rather than on the user's screen.
 */
export const MIN_COLUMNS_FOR_META = FRAME_COLUMNS + META_COLUMNS + META_SEPARATOR_COLUMNS + 1;

/**
 * The columns the widest *drawn* id/age tail in `pins` owns. `dim` is the theme's `dim`, the same member
 * `pinRow` (`panel-draw.ts`) passes to the tail when it prints it, so the reserve is measured on the string
 * the row actually occupies rather than on the undimmed one — a theme whose `dim` wraps its argument in
 * visible bytes makes the tail wider than the tail alone, and measuring the undimmed string handed those
 * columns to the text and cut the id. The stamping itself is `panel-row-tail.ts`'s; this only asks for the
 * width, floored at `META_COLUMNS`.
 *
 * `now` is the instant the frame is aged against, and it is the same one the row table stamps its tails at:
 * the reserve is measured on the string the row prints, so a frame that aged its rows and measured them at
 * two different instants would charge the text for a tail it did not draw. Required rather than optional for
 * that reason: an absent one used to fall through to the empty string, which stamps every tail as `--` and
 * measured a tail no row draws — the same class of bug as the flat reserve this file replaced. A caller with
 * no clock of its own passes the instant it is drawing at, exactly as the rows' own default does.
 *
 * The reserve is measured across the whole view rather than per pin, so the layout cannot wrap a row at a
 * width the builder then has to cut to fit a wider id beside it.
 */
export function widestMetaColumns(
  pins: readonly ViewPin[],
  dim: MetaDimmer,
  /** The instant the frame is aged against; the same one the rows of that frame stamp their tails at. */
  now: string,
): number {
  return widestStampColumns(
    pins,
    // The whole tail, which is what the reserve has to cover whatever row each half lands on: a frame that
    // measured only the id would charge the text for columns the age then took off the end of the row.
    (pin) => fullStamp(pin, dim, now),
    META_COLUMNS,
  );
}

/**
 * Columns a pin's text gets in a frame of `width` whose widest id/time tail is `metaColumns` — what is
 * left once the frame and that tail are paid for.
 *
 * `metaColumns` comes from `widestMetaColumns` for the frame's own pins; passing it explicitly (rather
 * than taking it from `width`) is what keeps a wide id from being cut: the wrap is sized so a first row
 * still has a column of text to draw *and* room for its tail beside it, because a row whose text
 * column is zero collapses to a blank line `pinRow` draws without its tail — which is how a `#id` used to
 * disappear on a narrow panel. One column of text always draws, cut with `…`, with the meta whole beside
 * it. Below `MIN_COLUMNS_FOR_META` the floor guarantees nothing, which is why the builder refuses to draw
 * there at all.
 */
export function panelTextColumns(width: number, metaColumns: number): number {
  return Math.max(1, width - FRAME_COLUMNS - metaColumns - META_SEPARATOR_COLUMNS);
}

/**
 * Columns a section heading's text gets in a frame of `width`.
 *
 * A heading pays for the frame and for the same tail reserve its section's pins pay for, and nothing else:
 * the width is `panelTextColumns` with the tail given back at zero, which is the inner width the frame leaves
 * and the reason `headingColumns` sits beside `panelTextColumns` instead of spelling the subtraction at the
 * call site. Charging the heading the *view's* widest id instead would indent the word `Warnings` by twenty
 * columns for a pin id of `#1` followed by nineteen digits, and the heading would no longer line up with the
 * text of the pins under it — the alignment is the whole reason a heading is drawn in the text column.
 *
 * Same floor as a pin row: a frame the builder closes always leaves the heading at least one column.
 */
export function headingColumns(width: number): number {
  return panelTextColumns(width, 0);
}
