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
 * `truncateToWidth` with `ELLIPSIS` is therefore asked to cut the label, and the cut is refused unless the
 * themed cell still measures inside the row — an entry that cannot keep its keycap is dropped rather than drawn
 * keyless, and the row it occupied is dropped with it when nothing else was left on it.
 *
 * **The theme's bytes are part of the measurement, and the count is taken through them.** Every width below is
 * read off `style.header`/`style.dim` — the strings the row actually draws — and never off the bare label, and
 * the count is handed the same `PanelStyle` as the rows are. A theme whose verbs wrap a cell in *visible* bytes
 * rather than SGR (a box around the keycap, padding inside the colour) charges `visibleWidth` columns that the
 * unthemed measurement never billed, and then the cut refuses the entry: the row it had been reserved is left
 * drawn blank, a counted row whose digits the user cannot press. One form for both figures means a row is only
 * ever counted when it can be filled, and the count cannot be taken through one theme and the rows through
 * another.
 *
 * **Every row closes at exactly the width it is packed at.** The panel is a flush-right overlay, so a short row
 * lets the chat behind it show through. The closure is `fitPlain` (`panel-draw.ts`), the one every drawn line
 * of both frames passes through, run once for the whole row: a theme whose `header`/`dim` opened a colour gets
 * the single reset the row needs rather than one per entry, and the pad lands outside the theme's bytes. The
 * rows this module hands `fitPlain` are already measured to `inner` *with* the theme's bytes in them, so the
 * branch that pass takes is the pad — never the cut, which is what used to spend a label's characters.
 *
 * **The width is the frame's full inner width**, `frameWidth - GUTTER_COLUMNS` — the figure `buildPanelLines`
 * (`panel-lines.ts`) draws between the gutters and `panelLayoutSections` hands to the row table. The row carries
 * no id/age tail, so it pays for no tail reserve and the labels get the whole inner column; the pins' own text
 * rows wrap at the *text* column instead (`panel-wrap.ts`), which is narrower by exactly that reserve.
 *
 * The labels are untrusted: a model wrote them. `cleanField` (`pin-fields.ts`) sanitized, folded and bounded
 * each one on the way in and `isPinState` (`state-guards.ts`) refuses a snapshot whose list is anything else,
 * but a drawn surface that leaned on somebody else's pass would borrow a guarantee it does not own — the view is
 * also built directly by tests and by any future caller — so `entryOf` strips each label again at the boundary
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
 * How many rows `options` cost at a frame `frameWidth` across — the row table's question.
 *
 * The same packing `drawOptionRows` fills, and through the very same `style`: a frame cannot count rows the
 * drawer leaves blank or draw rows the window does not own, and a count taken on the bare label while the rows
 * are drawn themed is the drift that produced a counted row of pure padding. Zero for a pin with no options,
 * which is the row table's signal to reserve nothing.
 */
export function optionRowCount(
  options: readonly string[] | undefined,
  frameWidth: number,
  style: PanelStyle,
): number {
  return pack(options, optionColumns(frameWidth), style).length;
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
  return pack(options, inner, style).map((row) => fitPlain(row, inner));
}

/**
 * One entry of a row, measured through the theme as the row will draw it.
 *
 * The label is folded and stripped *here*, at the boundary that draws a model's word, and every measurement
 * below is taken on that form: `visibleWidth` charges an escape pi-tui does not recognise as printable (an
 * unterminated OSC, a lone introducer) columns it will never draw, so budgeting on the raw entry would keep an
 * entry into a row the frame then cut from the columns underneath it.
 *
 * Every figure is the *themed* cell's — the strings `style.header` and `style.dim` returned, not the strings
 * they were handed. A theme is free to write visible bytes rather than colour, and the packer, the cut and the
 * drawer all have to be charging the same columns the terminal will. `columns` is what the packer budgets and
 * `drawn` is what the row joins, so the two can no longer be measurements of two different strings.
 */
interface Entry {
  /** The number the user types for this entry, which is its position in the pin's list. */
  readonly number: number;
  /** The label after the digit, folded and stripped, as `style.dim` is asked to colour it. */
  readonly label: string;
  /** The entry as the theme draws it — the exact bytes that reach the row, and what `columns` measures. */
  readonly drawn: string;
  /** Columns that cell draws: digit, gap and label, whatever the theme coloured around them. */
  readonly columns: number;
}

/**
 * `options` cut into rows at `inner`, each row already composed through `style` at that width, or `[]` when
 * there is nothing to name.
 *
 * The single packing of the panel: `optionRowCount` takes this array's length and `drawOptionRows` pads its
 * entries, so reserved and drawn are one answer and cannot drift — a row counted here is a row that measured
 * inside `inner` *with the theme's bytes in it*, which is the only form the drawer will put on screen. Not
 * memoised — the row table and the drawer are one call apart on a frame the component already memorises whole
 * (`panel-frame-cache.ts`), so a cache here would be a second lifetime for a value whose lifetime somebody
 * else owns.
 */
function pack(options: readonly string[] | undefined, inner: number, style: PanelStyle): string[] {
  if (options === undefined || options.length === 0 || inner <= 0) return [];
  const entries = options.map((label, position) => entryOf(label, position, style));
  const rows: string[] = [];
  let current: Entry[] = [];
  let used = 0;
  for (const entry of entries) {
    // A row that already holds nothing takes the entry whatever it costs — that is the entry wider than the
    // frame, and dropping it outright would leave options no row names and no key answers. `fittedCell` is what
    // keeps such a row inside the columns it was given, by cutting the label rather than losing the entry.
    if (current.length > 0 && used + SEPARATOR_COLUMNS + entry.columns > inner) {
      pushRow(rows, current, inner, style);
      current = [];
      used = 0;
    }
    used += (current.length === 0 ? 0 : SEPARATOR_COLUMNS) + entry.columns;
    current.push(entry);
  }
  if (current.length > 0) pushRow(rows, current, inner, style);
  return rows;
}

/**
 * The composed row of `entries`, appended to `rows` only when it drew something.
 *
 * The refusal lives here rather than in the caller: a row whose every entry lost the cut below is a row of
 * nothing, and appending it would be exactly the counted-but-blank row this module exists to prevent — the
 * window would scroll past it and the bar could sit on it. The packer always hands at least one entry, so an
 * empty result means every entry of the row was refused by `fittedCell`.
 */
function pushRow(
  rows: string[],
  entries: readonly Entry[],
  inner: number,
  style: PanelStyle,
): void {
  const line = fittedRow(entries, inner, style);
  if (line !== "") rows.push(line);
}

/**
 * One entry composed: the label folded and stripped, then the cell the theme draws for it, measured once.
 *
 * The measurement is of `drawn`, so the figure the packer budgets is the figure the row joins — the asymmetry
 * this closes is the one where the packer charged the bare `1 <label>` and the cut checked the themed
 * `H[1] D[<label>]`, and every column the theme wrote was a column nobody had billed.
 *
 * The label is measured on the form it is kept in: `cleanField` (`pin-fields.ts`) and `foldBreaks` leave a
 * leading or trailing space only where the sanitizer left one, and `visibleWidth(entry.label)` is asked of the
 * same string the cell was composed from, so the two can never disagree about what is chrome and what is text.
 */
function entryOf(label: string, position: number, style: PanelStyle): Entry {
  const number = position + 1;
  const text = foldBreaks(stripSequences(label));
  const drawn = cell(text, number, style);
  return { number, label: text, drawn, columns: visibleWidth(drawn) };
}

/**
 * One row's entries, composed at the width they were packed against, or `""` when the theme's bytes left no
 * entry of the row room to draw.
 *
 * An entry the packer could not seat beside its neighbours is cut on its label's tail (`truncateToWidth` +
 * `ELLIPSIS`) and the cut re-measured *as the cell the theme draws*: if the ellipsis ate the keycap the entry is
 * dropped rather than drawn keyless, which is the same refusal the old one-row drawer made when it dropped whole
 * entries from the end. The empty string is the caller's signal to drop the row — a counted row of nothing is
 * the one outcome this module must never hand the window.
 */
function fittedRow(entries: readonly Entry[], inner: number, style: PanelStyle): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const cellOf = entry.columns <= inner ? entry.drawn : fittedCell(entry, inner, style);
    if (cellOf !== null) parts.push(cellOf);
  }
  return parts.join(SEPARATOR);
}

/**
 * The cell of an entry too wide for the row at all: its digit kept, its label cut, or `null` when no cut of
 * that label keeps the keycap inside `inner`.
 *
 * The budget is the row less the columns the entry's own cell draws around its label — the keycap, its gap and
 * whatever the theme wrote around them — and the ellipsis costs a column of its own. `truncateToWidth` measures
 * the *label* it was handed, so the result is re-measured as the whole themed cell: the only figure the row's
 * columns are decided on.
 */
function fittedCell(entry: Entry, inner: number, style: PanelStyle): string | null {
  // What the label may keep is the row less everything the cell draws *around* it — the keycap, its gap and
  // whatever the theme wrote — minus the ellipsis's own column.
  const chrome = entry.columns - visibleWidth(entry.label);
  const room = inner - chrome - visibleWidth(ELLIPSIS);
  if (room < 1) return null;
  const cut = cell(truncateToWidth(entry.label, room, ELLIPSIS), entry.number, style);
  return visibleWidth(cut) <= inner ? cut : null;
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
