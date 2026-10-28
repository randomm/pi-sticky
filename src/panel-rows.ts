/**
 * The rows of the pins panel's content window, as a pure function: how many rows the window gets inside
 * a frame, what each pin contributes to it, and where the window starts for a selection.
 *
 * A pin is drawn as one or more rows — the first carries the id and the local time, the rest are
 * continuation lines under the text column — and the panel scrolls by *pin*, not by row, so this module
 * is the single authority on how many rows each pin owns. The count is stamped on each row as the table
 * is built rather than inferred from a finished table: a pin that wraps owns several rows whose `meta` is
 * empty and two pins can draw byte-identical rows, so neither question can be answered by scanning the
 * output.
 *
 * The drawing of these rows — the gutters, the bar, the borders around them — is `panel-lines.ts`, and
 * `panelLayout` is the one place a frame's rows are built: the table it returns is what the builder draws
 * *and* what the frame's height is counted from, so a pin is wrapped once per frame. The tail each first row
 * carries is stamped by `metaStamp` (`panel-tail.ts`) — the one string the row prints — and
 * `widestMetaColumns` (`panel-frame-geometry.ts`) *measures* that very string for the reserve the text
 * column gives up, so a theme whose `dim` adds columns is paid for by the layout that wrapped the row.
 */
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { panelTextColumns, widestMetaColumns } from "./panel-frame-geometry.ts";
import { BORDER_ROWS, panelFrameRows } from "./panel-height.ts";
import { pinTails } from "./panel-row-tail.ts";
import { fullStamp } from "./panel-tail.ts";
/**
 * The columns the two gutters own, re-exported so the callers that lay these rows out keep naming the module
 * whose rows they lay out. The tail's format is *not* re-exported: `panel-tail.ts` is its owner and the two
 * callers that need it name it there.
 */
export { GUTTER_COLUMNS } from "./panel-tail.ts";

import { META_COLUMNS } from "./panel-frame-geometry.ts";
import { GUTTER_COLUMNS } from "./panel-tail.ts";

import type { PanelStyle } from "./render.ts";
import type { PinLevel, ViewPin } from "./types.ts";

/** The character drawn in front of a pin; the rail quotes the same three. */
const MARKER: Record<PinLevel, string> = { warning: "!", action: "?", info: "•" };

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
 * Rows of every pin, in order, flattened: the window the scroll offset moves.
 *
 * Rows are grouped by pin, not identified by it, so a row of its own is not enough to say which pin it
 * belongs to — two pins can produce byte-identical rows, and a pin that wraps produces several that
 * differ only in their empty `meta`. The count each pin owns is therefore taken from the pin itself
 * rather than inferred by scanning the table.
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

/** One drawn row together with the *pin* that owns it, as the scroll window needs it. */
interface PanelOwned {
  row: PanelRow;
  pin: number;
}

/**
 * A pin's rows, in order, each tagged with the pin that owns it — the owner stamped on the row as it is
 * built, which is the only way the question stays answerable.
 */
function panelRowOwners(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
  now: string,
  metaColumns: number,
): PanelOwned[] {
  const owned: PanelOwned[] = [];
  for (const [index, pin] of pins.entries()) {
    for (const row of panelPinRows(pin, textWidth, style, now, metaColumns))
      owned.push({ row, pin: index });
  }
  return owned;
}

/**
 * First row of the pin at `index`, or -1 when there is no such pin, from the owner stamped on each row
 * of the table: the window starts at the first row the builder attributed to that pin, so a pin that owns
 * several rows is scrolled as a whole rather than opening mid-entry.
 */
function panelRowStartOf(all: readonly PanelOwned[], index: number): number {
  return index < 0 ? -1 : all.findIndex((entry) => entry.pin === index);
}

/**
 * The window's start for a selection, given every row of every pin in order and the start of the
 * selected pin: never past the end of the table, so the last pin is always on screen.
 *
 * `buildPanelLines` goes through this with the table and the start `panelLayout` built, so drawing a
 * window of the pins costs one wrap of each pin rather than three.
 */
export function panelWindowOffset(
  contentRows: number,
  selection: number,
  all: readonly PanelRow[],
  start: number,
): number {
  const total = all.length;
  if (contentRows <= 0 || total <= contentRows || selection < 0) return 0;
  if (start < 0) return total - contentRows;
  return Math.min(start, total - contentRows);
}

/**
 * One frame's rows: the table, the row the selection starts at, and the rows the frame needs.
 *
 * Returned by `panelLayout`, the one place the pins are wrapped for a frame, so the builder draws the
 * very rows the height was counted from.
 */
export interface PanelLayout {
  owned: PanelOwned[];
  start: number;
  height: number;
}

/**
 * The row table of one frame, wrapped *once* per pin at the text column `panelTextColumns` computes for
 * `frameWidth` — the table `buildPanelLines` draws and the height is counted from, which is what makes a
 * frame as tall as its rows and keeps a resize from sizing the box at a width it is not drawn at. The
 * builder pads each row out to the inner width when it draws it.
 *
 * The text column is what gives up width, never the id/age tail: the wrap is sized so a first row still
 * has a column of text to draw *and* room for its tail beside it, because a row whose text column is
 * zero collapses to a blank line `pinRow` draws without its tail — which is how a `#id` used to disappear
 * on a narrow panel. See `panel-frame-geometry.ts` for the arithmetic and `test/panel-id-never-cut.test.ts`
 * for the sweep that pins it.
 *
 * `now` is the instant every age in the table is measured against; the component passes the extension's
 * clock so a minute's passage re-ages the frame.
 *
 * This is the *only* owner of a frame's height: `height` is the row count the frame draws, counted from
 * `owned` and the terminal the caller was given (`tui.terminal.rows`, or `undefined` when none can be
 * asked, which `panelMaxRows` answers with its fallback). `buildPanelLines` draws the `height` it is
 * handed and builds no table of its own, so a caller cannot ask for one frame and draw another.
 *
 * The height is `owned.length` — the wrapped rows the table actually holds — over the frame's own border
 * rows, cut to the ceiling (`panelFrameRows`), so a one-pin panel is three rows and the prompt stays
 * visible beside it while a list of a thousand pins stops at half the terminal and scrolls.
 */
export function panelLayout(
  pins: readonly ViewPin[],
  frameWidth: number,
  terminalRows: number | undefined,
  selection: number,
  style: PanelStyle,
  now: string = atOnce(),
): PanelLayout {
  // The reserve is measured once, before the wrap, and handed to the rows: the same figure decides how many
  // text columns the pins get and whether a pin's `#<id> <age>` fits beside its id. Measuring it twice, or
  // letting the rows measure their own, is how a frame came to charge the text for one tail and draw another.
  const metaColumns = widestMetaColumns(pins, style.dim, now);
  const owned = panelRowOwners(
    pins,
    panelTextColumns(frameWidth, metaColumns),
    style,
    now,
    metaColumns,
  );
  // As tall as the rows it draws, never past the terminal's half: `panelFrameRows` puts the two border
  // rows over `owned` and cuts the result to the ceiling, which is the only reason a frame is ever
  // shorter than its content (and the reason the window scrolls for it).
  return {
    owned,
    start: panelRowStartOf(owned, selection),
    height: panelFrameRows(owned.length, terminalRows),
  };
}
