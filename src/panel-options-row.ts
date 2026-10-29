/**
 * The options row a pin with `options` draws beneath it, and the row budget that keeps it honest.
 *
 * A pin may carry up to `MAX_OPTIONS` (`pin-fields.ts`) short labels — the actions the model offers the user,
 * which the user fills into the editor by number and submits themselves (U7: nothing here acts). The row
 * spells them `1 Passed on   2 Not yet`: the digit the user types, the label after it, and three spaces
 * between entries so a label that contains a space cannot read as two entries. The digit *is* the keycap —
 * the `⌨` glyph that used to stand in front of it rendered as a box in common terminal fonts and the spec
 * never asked for it, and the column it spent now belongs to the labels.
 *
 * Two rules the module is written around:
 *
 * - **The digit is composed from the colours the panel already has**, not a new member of `PanelStyle`: it
 *   goes through `style.header` and the label through `style.dim`, which is what a keycap looks like beside
 *   the rest of the frame without asking every hand-built style in the tests to learn a fourth verb. Those
 *   bytes are part of the row when it is measured, and the row is measured on what the terminal will actually
 *   occupy: the *label* is stripped by `stripSequences` (`escape.ts`) here, at the boundary that draws a
 *   model's word, before `style.dim` is asked for it, and the *theme's* bytes around it survive as colour
 *   (`stripNonSgr`, applied by `fitLine` on the way out). An escape pi-tui counts as *printable* (an
 *   unterminated OSC, a lone introducer) charges `visibleWidth` columns it will not draw, so measuring on an
 *   unstripped label would keep such an entry into a row the frame then cut from the text underneath — and
 *   drawing it would put a sequence the user never asked for on a flush-right overlay.
 * - **One row costs one row.** The row table decides how many rows a pin owns before it draws anything, and
 *   the scroll window, the selection bar and `d`/`Enter` all index that count — so an options row that
 *   wrapped to two rows at a narrow width would be a row the window scrolls past and the bar sits on top of.
 *   `optionRows` (`panel-rows.ts`) therefore *reserves* the row in the table (the text is the pad character)
 *   and `drawOptionRow` fills it at the last moment with what fits: the last entry whose digit and label both
 *   close inside the column, with nothing drawn past it rather than a cut label the user could not answer.
 *   The column it measures against is the frame's **full inner width**, not the text column the pins' rows
 *   wrap at — the row carries no tail, so it pays for no id/age reserve (`panel-lines.ts` hands it over).
 *
 * The labels are untrusted, and they are dealt with twice: `cleanField` (`pin-fields.ts`) sanitizes, folds
 * and bounds each one and refuses the pin outright when an entry will not store, and `isPinState`
 * (`state-guards.ts`) refuses a snapshot whose list is anything else — so the entries this row measures and
 * draws are strings, and **the digit it prints names the position in the list**: entry *N* is
 * `pin.options[N-1]`, the answer the user types. On top of that, this drawer strips each label it draws: the
 * view is also built directly by tests and by any future caller, and a drawn surface that leans on a
 * sanitizing pass elsewhere borrows a guarantee it does not own.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import { foldBreaks, stripSequences } from "./escape.ts";
import { fitLine } from "./panel-draw.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/** The gap between two entries on the row, chosen so a label with a space inside cannot read as two. */
const SEPARATOR = "   ";

/**
 * The option row of `pin` as a drawn line: the entries that fit `textWidth`, and no others.
 *
 * Entries are taken in order and dropped from the end, so the user reads the first options the model named
 * rather than the last — the order the model gave them is the order it meant. An entry is kept only while its
 * digit and its label both measure inside the column, so a row never spends a column on a label that was cut
 * mid-word; with no room at all the row is blank, which the drawer pads to the frame's width.
 *
 * The colours are applied to the parts that survive, so a theme's bytes never reach a dropped entry. The row
 * is closed by the frame's own policy: `fitLine` (`panel-draw.ts`) is the one closure every drawn line of
 * both frames passes through, and this row is a drawn line. It was measured in the loop above, so the branch
 * that pass takes is the pad, and the one reset it puts on the end of a coloured line (`selectionReset`,
 * `panel-frame.ts`) closes every colour the entries opened.
 */
export function drawOptionRow(pin: ViewPin, textWidth: number, style: PanelStyle): string {
  // Read on the type, exactly as the row table does (`optionRows`, `panel-rows.ts`): the two readers of this
  // one field must agree about what a list is, or the table reserves a row this drawer answers blank and the
  // digit on a kept entry stops naming the option the user would type. `pin.options` is `string[] | undefined`
  // because both writers of a `Pin` validate the list — `cleanField` (`pin-fields.ts`) refuses a pin whose
  // options are not 2–4 non-empty strings and `isPinState` (`state-guards.ts`) refuses a snapshot that claims
  // otherwise, which is also the whole path a session file takes (`session-entries.ts` re-cleans every entry
  // and hands the copy back only once the guard has vouched for it). So the entries below are strings, their
  // index is their answer, and a non-list is a broken invariant rather than an input this row trades on.
  const options = pin.options;
  if (options === undefined || options.length === 0 || textWidth <= 0) return "";
  const kept: string[] = [];
  let width = 0;
  for (const [index, label] of options.entries()) {
    // Measured on the form the terminal will actually occupy — every escape the *label* carries stripped,
    // the digit and the theme's colour included. `visibleWidth` charges an escape pi-tui does not recognise
    // as printable (an unterminated OSC, a lone introducer) columns it never draws, so budgeting on the raw
    // entry would keep such an entry into a row the frame then had to cut from the text underneath: the one
    // way an option label could take the frame's last columns with bytes the user does not see, or push the
    // row over the width the overlay was given.
    const entry = entryCell(index + 1, foldBreaks(label), style);
    const columns = visibleWidth(entry);
    const gap = kept.length === 0 ? 0 : visibleWidth(SEPARATOR);
    if (width + gap + columns > textWidth) break;
    kept.push(entry);
    width += gap + columns;
  }
  return fitLine(kept.join(SEPARATOR), textWidth);
}

/**
 * One entry: the digit in the header colour, the label in the dim colour.
 *
 * The label is stripped *before* the theme is asked for it: a model's word goes through the unconditional
 * pass (`stripSequences`, `escape.ts`) at the boundary that draws it, and only then through `style.dim`, so
 * no escape a label carried reaches the screen whatever the theme did around it.
 */
function entryCell(number: number, label: string, style: PanelStyle): string {
  return `${style.header(String(number))} ${style.dim(stripSequences(label))}`;
}
