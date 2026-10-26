/**
 * The lines of the right-hand pins panel, as a pure function. Nothing here knows about a session,
 * a theme instance or an overlay: it is handed the ordered pins, the width and height pi-tui gave
 * the overlay, which pin is selected and whether the panel holds focus, and it returns at most
 * `height` lines, each of exactly `width` visible columns (operator decision *Margin*: the panel is
 * flush right, so a short line has to be padded or the content behind it shows through).
 *
 * Three shapes come out of it, in this order: the header `📌 Pinned for you (n)`, the window of
 * pin rows, and — only while the panel holds focus — the hint line. The content budget is
 * `height - 1 - (focused ? 1 : 0)`; the scroll offset only ever moves that window, so neither the
 * header nor the hint can be scrolled away (panel ticket, Height).
 *
 * Each pin's text is wrapped with pi-tui's `wrapTextWithAnsi` and every produced line goes through
 * the pad-and-cut below, because `wrapTextWithAnsi` breaks on words and a single word wider than
 * the panel comes back whole.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { stripSequences } from "./escape.ts";
import { isPanelSize } from "./panel-geometry.ts";
import { formatLocalTime } from "./time.ts";

import type { PanelStyle } from "./render.ts";
import type { PinLevel, ViewPin } from "./types.ts";

/** The character drawn in front of a pin; the rail quotes the same three. */
const MARKER: Record<PinLevel, string> = { warning: "!", action: "?", info: "•" };

/** Line 1 of the panel. The rail's header carries ` · /pins`; here `/pins` is on the keyboard. */
const HEADER = "📌 Pinned for you";

/** The keys the panel answers, spelled for the focused hint line. */
export const HINT = "↑↓/jk move · Enter reply · d dismiss · Esc back";

/** How wide the ` #id HH:MM` tail is allowed to be before the text loses room to a whole column. */
const META_RESERVE = 10;

/** pi-tui's cut ellipsis, spelled from its own code point. */
const ELLIPSIS = String.fromCodePoint(0x2026);

/** One drawn row of the panel: the pin's text column and its id/time tail. */
export interface PanelRow {
  text: string;
  meta: string;
}

/** What the builder draws. `pins` is already in ranked order — the panel never re-sorts. */
export interface PanelContent {
  pins: readonly ViewPin[];
  /** Selected *pin* index, not row index: a pin that wraps owns several rows. */
  selection: number;
  focused: boolean;
}

/** Rows the pin window gets at this size: the height less the header, less the hint when focused. */
export function panelContentRows(height: number, focused: boolean): number {
  return Math.max(0, height - 1 - (focused ? 1 : 0));
}

/**
 * Offset of the row the selected pin starts on: the smallest offset that puts it on screen,
 * clamped so the window never scrolls past the last pin. Taking the *pin* index rather than a row
 * index is what makes the scroll follow the bar the keys move.
 *
 * The wrapper over `panelWindowOffset` that a caller outside the builder uses: it derives the row table
 * itself, which costs a full wrap of every pin's text. `buildPanelLines` does not go through here — it
 * already has the table and passes it in, because wrapping the same pins three times per frame to draw a
 * window of them is the cost this avoids.
 */
export function panelScrollOffset(
  contentRows: number,
  selection: number,
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
): number {
  return panelWindowOffset(
    contentRows,
    selection,
    panelAllRows(pins, textWidth, style),
    panelRowStartOf(pins, textWidth, style, selection),
  );
}

/**
 * The same offset, from the rows the caller has already built and the start of the selected pin: the
 * window's start for a selection, given every row of every pin in order.
 *
 * `buildPanelLines` goes through this rather than through `panelScrollOffset` because it has the table
 * already: the wrapper above re-derives it, and doing that twice more per frame — once here, once inside
 * the row-start lookup — is what used to wrap the full text of every pin three times to draw a window of
 * them.
 */
function panelWindowOffset(
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
  const text = pin.repliedAt === undefined ? pin.text : `${pin.text} ↩`;
  const wrapped = wrapTextWithAnsi(text, textWidth);
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
 * rather than inferred by scanning the table, which is what lets `panelRowStartOf` walk the groups.
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

/**
 * First row of the pin at `index`, or -1 when there is no such pin.
 *
 * Derived from the same per-pin row builder the table is made of, so the two cannot disagree about how
 * many rows a pin owns — the question the scroll window turns on.
 */
function panelRowStartOf(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
  index: number,
): number {
  if (index < 0 || index >= pins.length) return -1;
  let start = 0;
  for (let i = 0; i < index; i++) {
    const pin = pins[i];
    if (!pin) return -1;
    start += panelPinRows(pin, textWidth, style).length;
  }
  return start;
}

/**
 * One drawn line, whatever its source — an untrusted pin row, or a header/hint whose bytes come from the
 * *theme*. Every drawn line goes through this one escape policy, with no styled branch: an over-wide
 * line is the case the rail's own `cut` documents — `truncateToWidth` measures an escape whose terminator
 * it does not recognise as printable columns — so when its result still measures too wide the line is cut
 * again from the escape-stripped text, the only string here whose width both sides agree on. Stripped
 * whether or not the cut fired, so a row that fits is still free of escape bytes; re-measured after
 * that, because stripping can leave a line that no longer fills the panel and a short row would let the
 * chat behind it show through.
 *
 * The styled branch used to exist, and was a hole rather than a convenience: a styled line that measured
 * within the width was padded and returned verbatim, and `visibleWidth` counts an OSC 8 hyperlink, an
 * OSC 2/52 window-title or an APC sequence as *zero* columns — so a theme whose `header`/`dim` emitted
 * one measured as free and was flushed right over the chat, its padding extending a smuggled hyperlink
 * across columns the user believes are blank. Nothing in a panel row is a hyperlink and AGENTS.md says a
 * pin never draws one, so refusing every escape byte on every drawn line costs nothing real; what the
 * theme loses is only sequences pi-tui would have counted as zero-width anyway, since `stripSequences`
 * keeps what it does not recognise as an escape to remove and SGR colouring survives intact.
 */
function fitLine(line: string, width: number): string {
  const spare = width - visibleWidth(line);
  if (spare >= 0) return padPlain(stripSequences(line), width);
  const cut = stripSequences(truncateToWidth(line, width, ELLIPSIS));
  if (visibleWidth(cut) <= width) return padPlain(cut, width);
  const plain = stripSequences(truncateToWidth(stripSequences(line), width, ELLIPSIS));
  return padPlain(plain, width);
}

/** Pad an already-safe line out to the width. */
function padPlain(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

/** The text column and its dim `#id HH:MM` tail; the bar goes over the whole row. */
function pinRow(row: PanelRow, width: number, style: PanelStyle, selected: boolean): string {
  const tail = row.meta === "" ? "" : ` ${row.meta}`;
  const body = tail === "" ? row.text : `${row.text}${style.dim(tail)}`;
  return fitLine(selected ? style.selected(body) : body, width);
}

/**
 * The panel's lines at a size: the header, the scrolled window of pin rows, and the hint while
 * focused. A negative selection draws no highlight. An empty view draws no rows at all — the overlay is
 * opened for the pins, and with none the frame has nothing to clear.
 */
export function buildPanelLines(
  content: PanelContent,
  width: number,
  height: number,
  style: PanelStyle,
): string[] {
  // A fractional size is one the panel cannot honour: the whole point of this function is that every
  // line measures exactly `width` columns, and padding to 30.5 leaves the chat showing through.
  if (!isPanelSize(width, height)) return [];
  // Nothing pinned is no rows at all, not a titled box asserting it is empty: the overlay is opened
  // for the pins, and a frame in which the last one was dismissed should show the prompt around it
  // rather than a header that repeats the absence. The check lives here, with the pins in front of it,
  // rather than in the component: this is the function that knows what an empty *view* is.
  if (content.pins.length === 0) return [];
  const lines: string[] = [fitLine(style.header(`${HEADER} (${content.pins.length})`), width)];
  const budget = panelContentRows(height, content.focused);
  if (budget === 0) {
    if (content.focused && lines.length < height) lines.push(fitLine(style.dim(HINT), width));
    while (lines.length < height) lines.push(fitLine("", width));
    return lines.slice(0, height);
  }

  const textWidth = Math.max(1, width - META_RESERVE);
  // The layout of every pin is wrapped *once* here and handed to the offset along with the selected
  // pin's own start, so a frame pays for one pass over the pins rather than three.
  const all = panelAllRows(content.pins, textWidth, style);
  const start = panelRowStartOf(content.pins, textWidth, style, content.selection);
  const offset = panelWindowOffset(budget, content.selection, all, start);
  for (let i = 0; i < budget && lines.length < height; i++) {
    const row = all[offset + i];
    if (!row) {
      lines.push(fitLine("", width));
      continue;
    }
    lines.push(pinRow(row, width, style, content.focused && i === content.selection - offset));
  }

  if (content.focused && lines.length < height) lines.push(fitLine(style.dim(HINT), width));
  while (lines.length < height) lines.push(fitLine("", width));
  return lines.slice(0, height);
}
