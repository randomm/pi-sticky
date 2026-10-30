/**
 * The options of a pin, cut into the rows the frame gives them — the *one* answer to "how many rows?".
 *
 * The panel draws a pin's options below the pin, and two halves of the frame have to agree about how much room
 * that takes. The row table (`optionRows`, `panel-rows.ts`) reserves the rows before anything is measured,
 * because the scroll window, the selection bar and `d`/`Enter` all index a row count that exists before the
 * text does; the drawer (`drawOptionRow`, `panel-options-row.ts`) fills those rows at the last moment, when the
 * frame's inner width is finally known. While each half spelled its own packing, a row the table counted and
 * the drawer left blank — or one the drawer filled past the rows the table owned — was a row the window scrolled
 * past and the bar sat on. So both call this one function at the same width and there is no second packing left
 * to disagree.
 *
 * **Entries pack whole.** An entry is `1 Passed on`: the digit the user types, and the label beside it, joined
 * by three columns so a label containing a space cannot read as two entries. A row never opens with a
 * half-label, because a truncated label reads as a *different option* and the digit beside it would then send
 * the user's answer to something they never saw. An entry that will not close beside its neighbours goes to the
 * next row.
 *
 * **An entry wider than a row gets a row of its own, and gives up its label's tail, never its digit.** At the
 * narrowest frame the overlay may be handed (`PANEL_MIN_FRAME_COLUMNS`, 33 columns at the overlay's 33% of a
 * 100-column terminal) a `MAX_FIELD_GRAPHEMES` label of 24 graphemes plus its digit does not fit beside
 * anything, and four such entries are four rows. Dropping the digit would break the one promise the row makes:
 * the digit *is* the key the user presses, so a row that drew `…t three` would name an option no key answers.
 * `truncateToWidth` with `ELLIPSIS` is therefore asked to cut the label and the result re-measured against the
 * digit's own columns — a cut that ate the key is refused, and the entry draws nothing rather than something
 * unanswerable.
 *
 * **Every row closes at exactly the width it is packed at.** The panel is a flush-right overlay, so a short row
 * lets the chat behind it show through. The closure is `fitPlain` (`panel-draw.ts`), the one every drawn line
 * of both frames passes through, run once for the whole row: a theme whose `header`/`dim` opened a colour gets
 * the single reset the row needs rather than one per entry, and the pad lands outside the theme's bytes.
 *
 * **The width is the frame's full inner width**, `frameWidth - GUTTER_COLUMNS` — the figure `buildPanelLines`
 * (`panel-lines.ts`) draws between the gutters and `panelLayoutSections` hands to the row table. The row carries
 * no id/age tail, so it pays for no tail reserve and the labels get the whole inner column; the pins' own text
 * rows wrap at the *text* column instead (`panel-wrap.ts`), which is narrower by exactly that reserve.
 *
 * The labels are untrusted: a model wrote them. `cleanField` (`pin-fields.ts`) sanitized, folded and bounded
 * each one on the way in and `isPinState` (`state-guards.ts`) refuses a snapshot whose list is anything else,
 * but a drawn surface that leaned on somebody else's pass would borrow a guarantee it does not own — the view is
 * also built directly by tests and by any future caller — so `entryCell` strips each label again at the boundary
 * that draws it, and folds it: a break inside a label would otherwise buy the pin a row the table never counted.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { foldBreaks, stripSequences } from "./escape.ts";
import { fitPlain } from "./panel-draw.ts";
import { ELLIPSIS } from "./panel-frame.ts";
import { GUTTER_COLUMNS } from "./panel-tail.ts";

import type { PanelStyle } from "./render.ts";

/** The gap between two entries on a row, chosen so a label with a space inside cannot read as two. */
const SEPARATOR = "   ";

/** What that gap costs, measured once rather than per entry. */
const SEPARATOR_COLUMNS = visibleWidth(SEPARATOR);

/**
 * The width a pin's options are packed at, for a frame `frameWidth` across: the columns between the gutters.
 *
 * One spelling read by the row table and the drawer alike, because both must pack at the figure the *builder*
 * draws at — the corners sit outside the row, the two gutters and their spaces are the four columns inside it.
 */
export const optionColumns = (frameWidth: number): number => frameWidth - GUTTER_COLUMNS;

/**
 * How many rows `options` costs at a frame `frameWidth` across — the row table's question.
 *
 * The same packing `drawOptionRows` fills, so a frame cannot count rows the drawer leaves blank or draw rows the
 * window does not own. Zero for a pin with no options, which is the row table's signal to reserve nothing.
 */
export function optionRowCount(options: readonly string[] | undefined, frameWidth: number): number {
  return pack(options, optionColumns(frameWidth)).length;
}

/**
 * The rows `options` are drawn on at an inner width of `inner`, each closed to exactly `inner` columns.
 *
 * `inner` is `optionColumns` of the frame, handed over rather than derived so the caller names the frame it is
 * drawing in. The entries keep the digits they were given: entry *N* of the list is drawn as `N` on whichever
 * row it landed, because that digit is the key the user presses. No options, no rows.
 */
export function drawOptionRows(
  options: readonly string[] | undefined,
  inner: number,
  style: PanelStyle,
): string[] {
  return pack(options, inner).map((row) => fitPlain(row.line(style), inner));
}

/**
 * One entry: its label as it will be drawn, the digit that names it, and the columns each half costs.
 *
 * The label is folded and stripped *here*, at the boundary that draws a model's word, and every measurement
 * below is taken on that form: `visibleWidth` charges an escape pi-tui does not recognise as printable (an
 * unterminated OSC, a lone introducer) columns it will never draw, so budgeting on the raw entry would keep an
 * entry into a row the frame then cut from the columns underneath it.
 *
 * `digit` is the columns the keycap alone owns — measured through the theme, because a `header` that wrote
 * *visible* bytes around the digit spends the row's columns too, and a rule that says the cut may not eat the
 * digit has to know how wide it is.
 */
interface Entry {
  /** The number the user types for this entry, which is its position in the pin's list. */
  readonly number: number;
  /** The label after the digit, folded and stripped, as `style.dim` is asked to colour it. */
  readonly label: string;
  /** Columns the whole entry draws, digit, gap and label, whatever the theme coloured. */
  readonly columns: number;
  /** Columns the digit and its gap own: the least a row may spend on the entry, and the part a cut keeps. */
  readonly digit: number;
}

/** One row's entries, composed at the width they were packed against. */
interface OptionRow {
  readonly entries: readonly Entry[];
  /**
   * The row as it will be drawn: every entry styled, joined by the separator, and cut to `inner` with its
   * digits intact. `fitPlain`'s job is only the pad and the trailing reset, so the row's *columns* are decided
   * here — where the entries and their digits are in scope to be protected.
   */
  readonly line: (style: PanelStyle) => string;
}

/**
 * `options` cut into rows at `inner`, or `[]` when there is nothing to name.
 *
 * The single packing of the panel: `optionRowCount` takes this array's length and `drawOptionRows` renders it,
 * so reserved and drawn are one answer and cannot drift. Not memoised — the row table and the drawer are one
 * call apart on a frame the component already memorises whole (`panel-frame-cache.ts`), so a cache here would be
 * a second lifetime for a value whose lifetime somebody else owns.
 */
function pack(options: readonly string[] | undefined, inner: number): OptionRow[] {
  if (options === undefined || options.length === 0 || inner <= 0) return [];
  const entries = options.map(entryOf);
  const rows: OptionRow[] = [];
  let current: Entry[] = [];
  let used = 0;
  for (const entry of entries) {
    // A row that already holds nothing takes the entry whatever it costs — that is the entry wider than the
    // frame, and dropping it would leave options no row names and no key answers. `fitted` is what keeps such a
    // row inside the columns it was given.
    const joins = current.length > 0;
    if (joins && used + SEPARATOR_COLUMNS + entry.columns > inner) {
      rows.push(rowOf(current, inner));
      current = [];
      used = 0;
    }
    used += (current.length === 0 ? 0 : SEPARATOR_COLUMNS) + entry.columns;
    current.push(entry);
  }
  if (current.length > 0) rows.push(rowOf(current, inner));
  return rows;
}

/** One packed row: its entries, and the composed line they draw. */
function rowOf(entries: readonly Entry[], inner: number): OptionRow {
  return { entries, line: (style) => fitted(entries, style, inner) };
}

/**
 * One entry composed: the label folded and stripped, then measured with and without its digit.
 *
 * Both figures come from the same `label` — `columns` of the composed entry, `digit` of the digit and its gap
 * alone — because the cut rule compares the two: what is left when the label gives up its tail is the digit,
 * and that is the figure a row must keep to stay answerable.
 */
function entryOf(label: string, position: number): Entry {
  const number = position + 1;
  const text = foldBreaks(stripSequences(label));
  const key = String(number);
  return {
    number,
    label: text,
    columns: visibleWidth(`${key} ${text}`),
    digit: visibleWidth(key),
  };
}

/**
 * The entries of one row, joined, styled and cut to `inner` with every digit intact.
 *
 * Each entry is composed from its own two theme verbs — `header` for the digit, `dim` for the label — so the
 * bytes the row draws are the bytes the theme was asked for, and the whole row is measured once more before it
 * leaves. An entry that will not fit is cut on its label's tail (`truncateToWidth` + `ELLIPSIS`), and the cut
 * re-measured against `digit`: if the ellipsis ate the keycap the entry is *dropped* rather than drawn keyless,
 * which is the same refusal the old one-row drawer made when it dropped whole entries from the end.
 */
function fitted(entries: readonly Entry[], style: PanelStyle, inner: number): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.columns <= inner) {
      parts.push(cell(entry.label, entry.number, style));
      continue;
    }
    // Too wide for the row at all: keep the keycap, cut the label. The budget is the row less the keycap and its
    // gap, and the ellipsis costs a column of its own, so the label gets what remains.
    const room = inner - entry.digit - SEPARATOR_COLUMNS - visibleWidth(ELLIPSIS);
    if (room < 1) continue;
    const cut = truncateToWidth(entry.label, room, ELLIPSIS);
    // `truncateToWidth` measures the label it was handed, but the row is measured with the theme's bytes in it:
    // re-ask the theme and check the *whole* cell, so a coloured entry cannot slip past the row's columns the
    // way an unrecognised escape slips past `visibleWidth`.
    const candidate = cell(cut, entry.number, style);
    if (visibleWidth(candidate) <= inner) parts.push(candidate);
  }
  return parts.join(SEPARATOR);
}

/**
 * One entry as the theme draws it: the digit through `header`, the label through `dim`.
 *
 * The label reaches `style.dim` already folded and stripped (`entryOf`), so no escape a model wrote gets past
 * the boundary that draws it whatever the theme did around it; the theme's own bytes are what the row measures.
 */
function cell(label: string, number: number, style: PanelStyle): string {
  return `${style.header(String(number))} ${style.dim(label)}`;
}
