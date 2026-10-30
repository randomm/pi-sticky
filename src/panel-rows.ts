/**
 * The rows of the pins panel's content window, as a pure function: how many rows the window gets inside
 * a frame, and what one pin contributes to it.
 *
 * A pin is drawn as one or more rows — the first carries the id and the local time, the rest are
 * continuation lines under the text column — and the panel scrolls by *pin*, not by row, so this module
 * is the single authority on how many rows each pin owns. The count is stamped on each row as the table
 * is built rather than inferred from a finished table: a pin that wraps owns several rows whose `meta` is
 * empty and two pins can draw byte-identical rows, so neither question can be answered by scanning the
 * output.
 *
 * Which rows a *frame* holds — the sections in drawn order, the heading over each of them, the window's
 * start for a selection and the height that all of it comes to — is `panelLayoutSections`, and that is
 * `panel-frame-layout.ts`. This file is the row: what a pin's text turns into at a given width, and nothing
 * about the box around it. It is also the one place the row count is turned into rows, which is why the
 * expansion arrives here as the frame's argument (`ExpandedAt`, `panel-expand.ts`) and never as a cell this
 * module reads: the peek, the rail and every caller outside a frame have no bar to name. The *decision* about
 * which pin a frame expands — the mode, the key gate, the focus and the bar — is not this module's either;
 * `expandedPinOf` (`panel-expand.ts`) owns it and the frame hands its answer down. The tail each first row
 * carries is stamped by `metaStamp` (`panel-tail.ts`) — the one string the row prints — and
 * `widestMetaColumns` (`panel-frame-geometry.ts`) *measures* that very string for the reserve the text column
 * gives up, so a theme whose `dim` adds columns is paid for by the layout that wrapped the row.
 */
import { stripSequences } from "./escape.ts";
import type { ExpandedAt } from "./panel-expand.ts";
import { META_COLUMNS, META_SEPARATOR_COLUMNS, widestMetaColumns } from "./panel-frame-geometry.ts";
import { markerCell } from "./panel-frame.ts";
import { BORDER_ROWS } from "./panel-height.ts";
import { optionRowCount } from "./panel-options-wrap.ts";
import { pinTextRows } from "./panel-pin-rows.ts";
import { pinTails } from "./panel-row-tail.ts";
import type { PanelRow } from "./panel-row.ts";
import { fullStamp } from "./panel-tail.ts";
/**
 * The columns the two gutters own, re-exported so the callers that lay these rows out keep naming the module
 * whose rows they lay out. The tail's format is *not* re-exported: `panel-tail.ts` is its owner and the two
 * callers that need it name it there.
 */
export { GUTTER_COLUMNS } from "./panel-tail.ts";
import { GUTTER_COLUMNS } from "./panel-tail.ts";

import type { PanelStyle } from "./render.ts";
import type { PinLevel, ViewPin } from "./types.ts";

/**
 * The one level→glyph table of the panel: the character drawn in front of a pin, and the one drawn in
 * front of that level's section heading. The rail quotes the same three from its own copy in `render.ts`.
 *
 * Exported, because a heading that invented a fourth glyph would say one thing above its pins and another
 * on them: `panel-section-headings.ts` reads the mark off this table and colours it the way `panelPinRows`
 * colours a pin row's marker, so one kind has one glyph wherever it appears.
 */
export const MARKER: Record<PinLevel, string> = { warning: "!", action: "?", info: "•" };

/**
 * The instant an age is measured against when the caller has none: `new Date()` at the moment the rows are
 * built. The panel's own caller passes the extension's clock (`PanelComponent` reads `ageNow()`); an absent
 * one is a test or a direct caller drawing a frame, and for it "now" is the only honest answer.
 */
const atOnce = (): string => new Date().toISOString();

// The row's own shape, re-exported from `panel-row.ts` so a caller of the row table names this module for the
// rows it gets back. The interface lives there because the options packing (`panel-options-wrap.ts`) and the
// drawer (`panel-draw.ts`) both need the type and neither may import the other; see that file's header.
export type { PanelRow } from "./panel-row.ts";

/**
 * Rows the pin window gets inside a frame of `height`: the height less the frame's own border rows
 * (`BORDER_ROWS`, `panel-height.ts`). The hint is not subtracted because it is not a content row — it is
 * written into the bottom border — so a focused panel and an unfocused one show the same number of pins.
 */
export function panelContentRows(height: number): number {
  return Math.max(0, height - BORDER_ROWS);
}

/**
 * The frame's expansion signal, as the row table reads it: which pin the frame chose, and whether it chose
 * one at all. Re-exported from its own module (`panel-expand.ts`) so a caller of the row table names this
 * module for the argument it hands the rows, and the predicate that produced the value lives beside the type.
 */
export type { ExpandedAt } from "./panel-expand.ts";

/** Whether this pin is the one the frame expands: the pin the frame chose, and a frame that chose one. */
function expands(pin: ViewPin, at: ExpandedAt | undefined): boolean {
  return pin.compact === true && at !== undefined && at.focused && at.isSelected(pin);
}

/**
 * A pin's own rows: the first carries its id (and its age, when the pin owns one row and the pair fits), the
 * second carries the age in the slot the first row had to leave, and the rest are continuation lines under
 * the text column. A pin whose text is empty still owns one row, so selection always has something to
 * address, and rows are never empty strings: a selected row is highlighted as a bar across the panel, and an
 * empty line would colour nothing.
 *
 * The level marker is the one thing here the caller may colour, so it is drawn through `marker` rather than
 * embedded in the text column — which is what lets a selected warning still read as a warning under the bar.
 *
 * `now` is the instant the ages are measured against; the panel passes the extension's clock so a tick
 * re-ages every row, and leaves it out to mean this instant.
 *
 * `expanded` is the frame's expansion signal and is absent for every caller with no bar to name. A `compact`
 * pin whose text would wrap owns its full entry — the wrapped rows and the options rows — when the frame says
 * it is the pin under a bar that takes keys, and one cut row for every other pin and every other frame.
 */
export function panelPinRows(
  pin: ViewPin,
  textWidth: number,
  style: PanelStyle,
  /**
   * The reserve the tail is drawn into, as `widestMetaColumns` measured it for this frame.
   *
   * Passed rather than measured here because it is a property of the *view* — the widest tail among all the
   * pins — and because deciding whether `#<id> <age>` fits beside the id has to be decided against the very
   * figure the drawer pads to. A row that guessed it would put a pair on a line the builder then cut.
   */
  metaColumns: number,
  /**
   * The columns between the frame's gutters, which is the width `pinRow` (`panel-draw.ts`) closes a row to.
   *
   * Required, and named by every caller that lays these rows out, because two row counts depend on it: the
   * pin's *text* wrap is sized against a row (`tailReserve` clamps at the inner width, so a wrap that only saw
   * `textWidth` could not know how many columns the row keeps) and the *options* rows are counted by
   * `panel-options-wrap.ts` at this width plus the gutters. It cannot be recovered from the other figures:
   * `panelTextColumns` takes the reserve, the gutters and the separators off the frame to reach a text column,
   * and adding them back answers the question only for *that* caller — the peek hands over the inner width as
   * its text column, so inverting the subtraction there reconstructs an `inner` nineteen columns wider than the
   * frame and the drawer re-cuts the row. That is the defect this parameter exists to close, and the reason
   * neither it nor `metaColumns` may be defaulted or follow an optional parameter.
   */
  inner: number,
  now: string = atOnce(),
  expanded?: ExpandedAt,
): PanelRow[] {
  const marker = style.marker(pin.level, MARKER[pin.level]);
  const glyph = MARKER[pin.level];
  // The one question the flag answers, asked once: a pin's whole entry is built at once, so the wrap, the
  // tails and the options rows cannot be decided against three answers to one question.
  const grown = expands(pin, expanded);
  // The frame the options rows are counted against: `inner` plus the two gutters, i.e. the figure
  // `panelLayoutSections` was handed and the one `optionColumns` subtracts back off. Derived from `inner` rather
  // than passed as a third figure because the two are one fact — the options rows are packed between the
  // gutters, and the gutter count has one owner (`panel-tail.ts`).
  const frameWidth = inner + GUTTER_COLUMNS;
  if (textWidth <= 0) {
    // No text column is the degenerate frame: the row is the marker and nothing else, and there is no row
    // below it for the age to live on, so the one row carries the whole tail: id and age, whichever half the
    // layout would otherwise have split between two lines — stamped whole rather than through `pinTails`,
    // which decides which of its two rows gets which half and has no second row to give one to here.
    // Cut to the one column the marker owns before it is joined, the policy of `markerCell`
    // (`panel-frame.ts`): a theme whose `marker` wrapped the glyph would otherwise widen the only row this
    // frame has past the column the frame set aside for it, and this branch never reaches `fitLine`.
    // The options rows are reserved here too: the degenerate frame is a frame whose *pins* own one row each,
    // and a pin the table gave no options row to is a pin whose options are silently never drawn. Expansion
    // cannot buy rows a frame has no room for, so the pin under the bar is this frame's one row too.
    return [
      {
        text: ` ${markerCell(marker, glyph)} `,
        tail: fullStamp(pin, style.dim, now),
        markerLevel: pin.level,
      },
      ...optionRows(pin, frameWidth, style),
    ];
  }
  // A replied pin's text column is dimmed and opens with `↩ ` — the same mark and the same placement the
  // rail gives it (see `pinLine`), so the two surfaces never disagree about what an answered pin looks like.
  // The wrap happens *after* the mark is added, so a row cut to the width cannot lose it.
  //
  // The text is stripped *here*, at the boundary that puts a model's words into a drawn row: `stripSequences`
  // (`escape.ts`) is the unconditional pass, run before `style.dim` is asked for anything and independently of
  // the frame's SGR-tolerant `fitLine`, which is defence in depth and never the only escape check a pin's text
  // has. The sanitizer cleans what is stored (`sanitize.ts`), but the view is also built directly — by tests
  // and by any future caller — and a drawn surface that leans on somebody else's pass borrows a guarantee it
  // does not own.
  const body = pin.repliedAt === undefined ? pin.text : style.dim(`↩ ${pin.text}`);
  const plain = stripSequences(body);
  const wrapped = pinTextRows(plain, pin.compact === true, grown, textWidth, metaColumns, inner);
  // Which row carries the age is decided by how many rows the wrap produced, so the wrap runs first and the
  // tails are stamped against its answer: a pin that fits on one line is the case the id/age pair belongs
  // to. `count` below is that count, and the empty-text fallback is one row for the same reason.
  const count = wrapped.length > 0 ? wrapped.length : 1;
  const tails = pinTails(pin, count, metaColumns, now, style.dim);
  const rows = wrapped.map((line, index) => ({
    text: ` ${index === 0 ? markerCell(marker, glyph) : "   "} ${line}`,
    tail: index === 0 ? tails.first : index === 1 ? (tails.second ?? "") : "",
    ...(index === 0 ? { markerLevel: pin.level } : {}),
  }));
  // The options rows are part of the pin's entry: they belong to the pin, the window scrolls them with the pin
  // and the pin owns the bar's row. Reserved rather than drawn, so the labels may cost as many rows as they
  // need at the frame's inner width without the drawer and the table disagreeing about how many that is.
  return [
    // The fallback row is a pin whose text drew nothing, and it carries the level's glyph like any other
    // first row: whether that glyph becomes the selection marker is the *drawer's* question, asked once it
    // knows which row the bar landed on (`barMarker`, `panel-draw.ts`).
    ...(rows.length > 0
      ? rows
      : [{ text: ` ${markerCell(marker, glyph)} `, tail: tails.first, markerLevel: pin.level }]),
    ...optionRows(pin, frameWidth, style),
  ];
}

/**
 * Rows of every pin in `pins`, which must be the panel's *drawn* order (`panelSections`'s `flat`): the rows a
 * frame's window is cut from. Rows are grouped by pin, not identified by it — two pins can draw byte-identical
 * rows and a wrapping pin draws several that differ only in their empty `tail` — so the count each pin owns is
 * taken from the pin, never by scanning the table. Callers hand over the order the panel draws, not the order
 * the view was pinned in.
 *
 * `metaColumns` and `inner` are the frame's own figures, passed through for the reason `panelPinRows` names;
 * they are optional only for a caller with no frame to name (a row-counting test), which measures the reserve on
 * the pins it passed and derives `inner` from `panelTextColumns`' own subtraction. This table takes **no**
 * expansion signal: it is the caller that counts rows outside a frame, so every compact pin it builds owns its
 * one collapsed row whatever the bar of any frame would have done.
 */
export function panelAllRows(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
  metaColumns?: number,
  inner?: number,
  now: string = atOnce(),
): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const pin of pins) {
    // Derived together or not at all: an `inner` reconstructed from a reserve the function did not use is a
    // row wrapped against a frame the caller never named, which is the failure the required parameters of
    // `panelPinRows` exist to close.
    const reserve = metaColumns ?? widestMetaColumns([pin], style.dim, now);
    // Derived at the *reserve's floor* and not at a measured one: the floor is the smallest frame whose text
    // column could have been `textWidth`, so the options rows can only be under-counted, never counted against
    // columns the drawer never had. A caller that is laying a frame out names both figures and gets none of this.
    const betweenGutters =
      inner ?? textWidth + META_COLUMNS + META_SEPARATOR_COLUMNS + GUTTER_COLUMNS;
    rows.push(...panelPinRows(pin, textWidth, style, reserve, betweenGutters, now));
  }
  return rows;
}

/**
 * The options rows `pin` owns: as many as its labels need at a frame `frameWidth` across under `style`, none
 * when it has no options.
 *
 * The single place the count is decided, and decided by the *drawer's* own packing (`optionRowCount`,
 * `panel-options-wrap.ts`) rather than a rule of our own: the table and the drawer used to answer this twice and
 * could differ by however many rows the labels needed, or by columns a theme wrote that only one had measured.
 * Hence `style` is passed through — the count is taken on the cells that theme draws, so a row is reserved only
 * when the same style can fill it. `frameWidth` is the *frame*, not the inner width: the wrap makes the gutter
 * subtraction itself, so the reserve the text rows give up is never charged to a row that carries no tail.
 */
function optionRows(pin: ViewPin, frameWidth: number, style: PanelStyle): PanelRow[] {
  return Array.from({ length: optionRowCount(pin.options, frameWidth, style) }, optionRow);
}

/**
 * The row the frame draws a pin's options into, and the one `panelPinRows` reserves for them.
 *
 * Its text is a pad character: how many rows a pin owns is decided before anything is drawn (the window scrolls
 * and the bar sits on that count), so the entries are filled in at the frame's own width by the drawer
 * (`panel-lines.ts`), which takes them from the very packing that counted them. The rows own no tail — they name
 * no id, and the pin's first row carries it.
 *
 * The `kind` tag, not the pad character, is what says a row is one of these: `isOptionRow` reads the tag, so a
 * real pin row that happened to draw a single space could not be overwritten with keycaps.
 */
function optionRow(): PanelRow {
  return { text: OPTION_PAD, tail: "", kind: "options" };
}

/** The pad character an option row reserves its row with before the drawer fills it. */
const OPTION_PAD = " ";

/** Whether the row is the reserved one, and so the one the drawer still has to fill. */
export function isOptionRow(row: PanelRow): boolean {
  return row.kind === "options";
}
