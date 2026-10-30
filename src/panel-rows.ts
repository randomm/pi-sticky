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
 * about the box around it. The tail each first row carries is stamped by `metaStamp` (`panel-tail.ts`) — the
 * one string the row prints — and `widestMetaColumns` (`panel-frame-geometry.ts`) *measures* that very string
 * for the reserve the text column gives up, so a theme whose `dim` adds columns is paid for by the layout
 * that wrapped the row.
 */
import { foldBreaks, stripSequences } from "./escape.ts";
import { META_COLUMNS, META_SEPARATOR_COLUMNS, widestMetaColumns } from "./panel-frame-geometry.ts";
import { markerCell } from "./panel-frame.ts";
import { BORDER_ROWS } from "./panel-height.ts";
import { optionRowCount } from "./panel-options-wrap.ts";
import { pinTails } from "./panel-row-tail.ts";
import type { PanelRow } from "./panel-row.ts";
import { fullStamp } from "./panel-tail.ts";
import { wrapAtDrawnWidth } from "./panel-wrap.ts";
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
   * pin's *text* wrap has to be sized against a row rather than only against a text column (the reserve
   * `pinRow` cuts to is `tailReserve`, which *clamps at the inner width*, so a wrap that only ever saw
   * `textWidth` could not know how many columns the row keeps), and the pin's *options* rows are counted by
   * `panel-options-wrap.ts` at this very width plus the gutters.
   *
   * It cannot be recovered from the figures the caller handed over. `panelTextColumns` does take the tail's
   * reserve, the gutters and the separators off the frame to reach a text column, so adding them back would
   * answer the question for *that* caller — but the peek hands this function the inner width as its text column,
   * because it draws one row and asks for it at the width it draws at. Inverting the layout's subtraction on
   * that call reconstructs an `inner` nineteen columns wider than the frame, the wrap packs a row to it, and the
   * drawer re-cuts the row: the defect this parameter exists to prevent, arriving through the parameter's own
   * default.
   *
   * Both this and `metaColumns` are required and sit ahead of `now` for that reason and for Biome's: a required
   * parameter may not follow an optional one, and neither figure can be guessed, so neither may be defaulted.
   */
  inner: number,
  now: string = atOnce(),
): PanelRow[] {
  const marker = style.marker(pin.level, MARKER[pin.level]);
  const glyph = MARKER[pin.level];
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
    // and a pin the table gave no options row to is a pin whose options are silently never drawn.
    return [
      {
        text: ` ${markerCell(marker, glyph)} `,
        tail: fullStamp(pin, style.dim, now),
        markerLevel: pin.level,
      },
      ...optionRows(pin, frameWidth),
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
  // A `compact` pin is one row: the wrap is skipped and the text takes the single line it will be cut to.
  // It is collapsed here, in the table, rather than cut by the drawer: the window scrolls, the bar sits and
  // `d`/`Enter` index *this* row count, so a pin that wrapped into four rows and was trimmed afterwards
  // would leave three rows counted for a pin that shows one. `foldBreaks` folds what breaks the model put
  // in (the fold `toOneLine` wraps, read from its owner rather than through `render.ts`, which is one of this
  // module's callers), and the drawer's `fitLine` spends the ellipsis on the tail of it.
  //
  // Expansion on selection is deliberately *not* implemented: the row the bar reaches has to be a row the
  // table built before the bar moved, and growing the table under the bar for one frame is the disagreement
  // the rest of this module exists to avoid (research-summary U13). The flag is also the cost lever, not
  // decoration: a non-compact pin is re-wrapped at the frame's text column on every frame the panel redraws
  // — a moving bar included — so for a long pin this one branch is what bounds the draw.
  // The width the wrap packs a line into is `textWidth` less the cell every row of a *wrapping* pin pays in
  // front of its text — the marker on the first row and the same three blank columns again as the indent of each
  // row below it. `pinRow` (`panel-draw.ts`) measures a row's text with that cell inside the columns its reserve
  // leaves, so a line packed to the full `textWidth` came back over the row's limit and the drawer's re-cut spent
  // the row's last columns on an ellipsis: `…park fix` on the age's row, with `ix` carried down to the line below.
  //
  // Charged once, to the wrap rather than to the row, because the row count is the wrap's answer: a wrap that
  // gave up the cell and still produced one row retried at the full `textWidth` and kept it, so a pin whose text
  // fits the row it owns is never pushed into a second row by an indent it does not draw. Widening can only ever
  // drop a row, never add one, so that retry settles on the first pass.
  const wrapped =
    pin.compact === true
      ? [foldBreaks(plain)]
      : wrapAtDrawnWidth(plain, textWidth, metaColumns, inner);
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
    ...optionRows(pin, frameWidth),
  ];
}

/**
 * The options rows `pin` owns: as many as its labels need at a frame `frameWidth` across, none when it has no
 * options.
 *
 * The single place the count is decided, and it is decided by the *drawer's* own packing (`optionRowCount`,
 * `panel-options-wrap.ts`) rather than by a rule of its own: the row table and the drawer used to answer this
 * question twice, once while the window and the bar were counted and once while the row was filled, and the two
 * answers could differ by however many rows the labels needed. Read the way the wrap reads the same field —
 * `undefined` is the key being absent and the entries are strings, because both writers of a `Pin` validate the
 * list (`cleanField` in `pin-fields.ts`, `isPinState` in `state-guards.ts`): a table that reserves a row the
 * drawer has nothing to say about is a row the window counts for nothing.
 *
 * `frameWidth` is the *frame*, not the inner width: the wrap makes the gutter subtraction itself, so the reserve
 * the pins' text rows give up is never charged to a row that carries no tail.
 */
function optionRows(pin: ViewPin, frameWidth: number): PanelRow[] {
  return Array.from({ length: optionRowCount(pin.options, frameWidth) }, optionRow);
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
/**
 * Rows of every pin in `pins`, which must be the panel's *drawn* order (`panelSections`'s `flat`),
 * flattened: the rows a frame's window is cut from.
 *
 * Rows are grouped by pin, not identified by it, so a row of its own is not enough to say which pin it
 * belongs to — two pins can produce byte-identical rows, and a pin that wraps produces several that
 * differ only in their empty `meta`. The count each pin owns is therefore taken from the pin itself
 * rather than inferred by scanning the table.
 *
 * Callers hand this the order the panel draws, not the order the view was pinned in: the component reads
 * `panelSections` once and every surface of one frame — rows, bar, keys — walks that one array.
 *
 * `metaColumns` and `inner` are the frame's own figures, passed through to `panelPinRows` for the reason that
 * function names: the tail's reserve is the view's, not the pin's, and the wrap is sized against a row. They
 * are optional here only for a caller that has no frame to name — a test that counts rows, or a table asked for
 * outside a frame — and such a caller measures the reserve on the pins it passed and derives `inner` from the
 * subtraction `panelTextColumns` ran to get `textWidth`. A caller that *is* laying a frame out names both.
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
    // The two figures are derived together or not at all: an `inner` reconstructed from a reserve the function
    // did not use is a row wrapped against a frame the caller never named, which is the failure mode the
    // required parameter on `panelPinRows` exists to close. So a caller that gave neither gets both derived
    // from its own `textWidth`, and a caller that gave one gets exactly the pair it asked the frame to pay.
    const reserve = metaColumns ?? widestMetaColumns([pin], style.dim, now);
    // Derived from `textWidth` at the *reserve's floor*, not at a measured reserve: `panelTextColumns` cuts a
    // text column out of the frame at `widestMetaColumns`, which for a caller that named no reserve is not this
    // function's per-pin figure — a multi-pin caller handing over a `textWidth` the frame cut at the view's
    // widest id would have its options rows counted nineteen columns wide of the frame it is drawn in. At the
    // floor the derived frame is the smallest one whose text column could have been `textWidth`, which is the
    // conservative answer: it can only under-count the frame, never hand the labels columns the drawer never
    // had. A caller that *is* laying a frame out names both figures and gets no derivation at all.
    const betweenGutters =
      inner ?? textWidth + META_COLUMNS + META_SEPARATOR_COLUMNS + GUTTER_COLUMNS;
    rows.push(...panelPinRows(pin, textWidth, style, reserve, betweenGutters, now));
  }
  return rows;
}
