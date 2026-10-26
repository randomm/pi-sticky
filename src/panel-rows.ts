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
 * The drawing of these rows — the gutters, the bar, the borders around them — is `panel-frame.ts`.
 */
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export { PANEL_MIN_FRAME_COLUMNS, PANEL_MIN_FRAME_ROWS } from "./panel-geometry.ts";

import { formatLocalTime } from "./time.ts";

import type { PanelStyle } from "./render.ts";
import type { PinLevel, ViewPin } from "./types.ts";

/** The character drawn in front of a pin; the rail quotes the same three. */
const MARKER: Record<PinLevel, string> = { warning: "!", action: "?", info: "•" };

/** How wide the ` #id HH:MM` tail is allowed to be before the text loses room to a whole column. */
export const META_RESERVE = 10;

/** One drawn row of the panel: the pin's text column and its id/time tail. */
export interface PanelRow {
  text: string;
  meta: string;
}

/**
 * Rows the pin window gets inside a frame of `height`: the height less the two border rows. The hint
 * is not subtracted because it is not a content row — it is written into the bottom border — so a
 * focused panel and an unfocused one show the same number of pins.
 */
export function panelContentRows(height: number): number {
  return Math.max(0, height - 2);
}

/**
 * A pin's own rows: the first carries the id and the local time, the rest are continuation lines
 * under the text column. A pin whose text is empty still owns one row, so selection always has
 * something to address, and rows are never empty strings: a selected row is highlighted as a bar
 * across the panel, and an empty line would colour nothing.
 *
 * The level marker is the one thing here the caller may colour, so it is drawn through `marker`
 * rather than embedded in the text column — which is what lets a selected warning still read as a
 * warning under the bar.
 */
export function panelPinRows(pin: ViewPin, textWidth: number, style: PanelStyle): PanelRow[] {
  const meta = `#${pin.id} ${formatLocalTime(pin.createdAt)}`;
  const marker = style.marker(pin.level, MARKER[pin.level]);
  if (textWidth <= 0) return [{ text: ` ${marker} `, meta }];
  // A replied pin's text column is dimmed and opens with `↩ ` — the same mark and the same placement the
  // rail gives it (see `pinLine`), so the two surfaces never disagree about what an answered pin looks
  // like. The wrap happens *after* the mark is added, so a row cut to the width cannot lose it.
  const body = pin.repliedAt === undefined ? pin.text : style.dim(`↩ ${pin.text}`);
  const wrapped = wrapTextWithAnsi(body, textWidth);
  const rows = wrapped.map((line, index) => ({
    text: index === 0 ? ` ${marker} ${line}` : `   ${line}`,
    meta: index === 0 ? meta : "",
  }));
  return rows.length > 0 ? rows : [{ text: ` ${marker} `, meta }];
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
): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const pin of pins) rows.push(...panelPinRows(pin, textWidth, style));
  return rows;
}

/** One drawn row together with the *pin* that owns it, as the scroll window needs it. */
export interface PanelOwned {
  row: PanelRow;
  pin: number;
}

/**
 * A pin's rows, in order, each tagged with the pin that owns it — the owner stamped on the row as it is
 * built, which is the only way the question stays answerable.
 */
export function panelRowOwners(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
): PanelOwned[] {
  const owned: PanelOwned[] = [];
  for (const [index, pin] of pins.entries()) {
    for (const row of panelPinRows(pin, textWidth, style)) owned.push({ row, pin: index });
  }
  return owned;
}

/**
 * First row of the pin at `index`, or -1 when there is no such pin, from the owner stamped on each row
 * of the table: the window starts at the first row the builder attributed to that pin, so a pin that owns
 * several rows is scrolled as a whole rather than opening mid-entry.
 */
export function panelRowStartOf(all: readonly PanelOwned[], index: number): number {
  return index < 0 ? -1 : all.findIndex((entry) => entry.pin === index);
}

/**
 * The window's start for a selection, given every row of every pin in order and the start of the
 * selected pin: never past the end of the table, so the last pin is always on screen.
 *
 * `buildPanelLines` goes through this with the table and the start it built itself, so drawing a window
 * of the pins costs one wrap of each pin rather than three.
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
