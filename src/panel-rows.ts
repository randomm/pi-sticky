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
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { widestMetaColumns } from "./panel-frame-geometry.ts";
import { BORDER_ROWS } from "./panel-height.ts";
import { pinTails } from "./panel-row-tail.ts";
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

/** One drawn row of the panel: the pin's text column, and the tail it carries whole. */
export interface PanelRow {
  /** The pin's text column, marker included on the first row of a pin. */
  text: string;
  /**
   * The row's tail, already stamped: the id (plus the age, for a one-row pin whose pair fit) on the first
   * row, the age alone on the second, and nothing at all on a third.
   *
   * A whole string rather than one the drawer completes: `widestMetaColumns` measures these and `pinRow`
   * (`panel-lines.ts`) draws these, so the columns the text gives up are the columns the tail occupies. The
   * empty string is the builder's signal for a row that owns no tail — the continuation lines of a pin whose
   * age already had a row of its own.
   */
  tail: string;
}

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
  now: string = atOnce(),
  /**
   * The reserve the tail is drawn into, as `widestMetaColumns` measured it for this frame.
   *
   * Passed rather than measured here because it is a property of the *view* — the widest tail among all the
   * pins — and because deciding whether `#<id> <age>` fits beside the id has to be decided against the very
   * figure the drawer pads to. A row that guessed it would put a pair on a line the builder then cut.
   */
  metaColumns: number = widestMetaColumns([pin], style.dim, now),
): PanelRow[] {
  const marker = style.marker(pin.level, MARKER[pin.level]);
  if (textWidth <= 0) {
    // No text column is the degenerate frame: the row is the marker and nothing else, and there is no row
    // below it for the age to live on, so the one row carries the whole tail: id and age, whichever half the
    // layout would otherwise have split between two lines — stamped whole rather than through `pinTails`,
    // which decides which of its two rows gets which half and has no second row to give one to here.
    return [{ text: ` ${marker} `, tail: fullStamp(pin, style.dim, now) }];
  }
  // A replied pin's text column is dimmed and opens with `↩ ` — the same mark and the same placement the
  // rail gives it (see `pinLine`), so the two surfaces never disagree about what an answered pin looks like.
  // The wrap happens *after* the mark is added, so a row cut to the width cannot lose it.
  const body = pin.repliedAt === undefined ? pin.text : style.dim(`↩ ${pin.text}`);
  const wrapped = wrapTextWithAnsi(body, textWidth);
  // Which row carries the age is decided by how many rows the wrap produced, so the wrap runs first and the
  // tails are stamped against its answer: a pin that fits on one line is the case the id/age pair belongs
  // to. `count` below is that count, and the empty-text fallback is one row for the same reason.
  const count = wrapped.length > 0 ? wrapped.length : 1;
  const tails = pinTails(pin, count, metaColumns, now, style.dim);
  const rows = wrapped.map((line, index) => ({
    text: index === 0 ? ` ${marker} ${line}` : `   ${line}`,
    tail: index === 0 ? tails.first : index === 1 ? (tails.second ?? "") : "",
  }));
  return rows.length > 0 ? rows : [{ text: ` ${marker} `, tail: tails.first }];
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
 */
export function panelAllRows(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
  now: string = atOnce(),
  metaColumns?: number,
): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const pin of pins) rows.push(...panelPinRows(pin, textWidth, style, now, metaColumns));
  return rows;
}

/**
 * The window's start for a selection, given every row of the table in order and the start of the
 * selected pin: never past the end of the table, so the last pin is always on screen.
 *
 * A row that belongs to no pin is a section heading, and a heading is read for its position rather than its
 * text — which rows are headings is stamped by the builder of the table, `panelOwnedRows`
 * (`panel-frame-layout.ts`). One such row directly above the selected pin is the heading over it, and the
 * window opens **one row earlier** so the user reads the level of the pin the bar is on rather than inferring
 * it — but only while that heading and every row of the selected pin still fit in the window: a heading whose
 * section has a two-row pin under it would push the rest of that pin out and trade the label for the text.
 * When they do not fit, or when the row above is another pin's, the window opens on the pin's first row as
 * before. A single-section table has no heading rows at all, so its window is byte-for-byte the one it drew
 * before sections existed.
 *
 * Focus plays no part: the same selection at the same terminal draws the same rows whether or not the panel
 * holds the keyboard, and only the bar differs.
 *
 * `buildPanelLines` goes through this with the table and the start `panelLayoutSections` built, so drawing a
 * window of the pins costs one wrap of each pin rather than three.
 */
export function panelWindowOffset(
  contentRows: number,
  selection: number,
  all: readonly PanelRow[],
  start: number,
  /** The pin each row of `all` belongs to, or `null` for a heading — `PanelOwned.pin` of the same table. */
  owners: readonly (number | null)[],
): number {
  const total = all.length;
  if (contentRows <= 0 || total <= contentRows || selection < 0) return 0;
  if (start < 0) return total - contentRows;
  const capped = Math.min(start, total - contentRows);
  const rowsOfSelected = countRowsOf(owners, selection);
  if (rowsOfSelected > 0 && start - 1 >= 0 && owners[start - 1] === null) {
    if (contentRows - rowsOfSelected >= 1) return Math.min(start - 1, total - contentRows);
  }
  return capped;
}

/** Rows of the table the pin at `index` owns; zero when the table tags no row with it. */
function countRowsOf(owners: readonly (number | null)[], index: number): number {
  let count = 0;
  for (const owner of owners) if (owner === index) count++;
  return count;
}
