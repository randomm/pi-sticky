/**
 * The options row a pin with `options` draws beneath it, and the row budget that keeps it honest.
 *
 * A pin may carry up to `MAX_OPTIONS` (`pin-fields.ts`) short labels — the actions the model offers the user,
 * which the user fills into the editor by number and submits themselves (U7: nothing here acts). The row
 * spells them `1 Passed on   2 Not yet`: a keycap glyph before each label, the label after it, and three
 * spaces between entries so a label that contains a space cannot read as two entries.
 * Two rules the module is written around:
 *
 * - **The keycap is composed from the colours the panel already has**, not a new member of `PanelStyle`: the
 *   digit goes through `style.header` and the label through `style.dim`, which is what a keycap looks like
 *   beside the rest of the frame without asking every hand-built style in the tests to learn a fourth verb.
 *   Those bytes are part of the row when it is measured, and gone when it is drawn: the entry goes through
 *   `stripSequences` (`escape.ts`) first, so the budget is what the terminal will actually occupy — an escape
 *   pi-tui counts as *printable* (an unterminated OSC, a lone introducer) charges `visibleWidth` columns it
 *   will not draw, and measuring on the raw form would keep such an entry into a row the frame then cut from
 *   the text underneath — and no sequence a label smuggled reaches the screen.
 * - **One row costs one row.** The row table decides how many rows a pin owns before it draws anything, and
 *   the scroll window, the selection bar and `d`/`Enter` all index that count — so an options row that
 *   wrapped to two rows at a narrow width would be a row the window scrolls past and the bar sits on top of.
 *   `optionRows` (`panel-rows.ts`) therefore *reserves* the row in the table (the text is the pad character)
 *   and `drawOptionRow` fills it at the last moment with what fits: the last entry whose keycap and label both
 *   close inside the column, with nothing drawn past it rather than a cut label the user could not answer.
 *   The column it measures against is the frame's **full inner width**, not the text column the pins' rows
 *   wrap at — the row carries no tail, so it pays for no id/age reserve (`panel-lines.ts` hands it over).
 *
 * The labels are untrusted: they arrive through `cleanField` (`pin-fields.ts`), which sanitizes, folds and
 * bounds each one before it is stored, and the row is measured and drawn on what the frame's escape policy
 * leaves — so no sequence a label carried is drawn or paid for, whatever the theme did to it around that.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import { foldBreaks, stripSequences } from "./escape.ts";
import { fitLine } from "./panel-draw.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/** The glyph before an option's label — one column, the key the user types. */
const KEYCAP = "⌨";

/** The gap between two entries on the row, chosen so a label with a space inside cannot read as two. */
const SEPARATOR = "   ";

/**
 * The option row of `pin` as a drawn line: the entries that fit `textWidth`, and no others.
 *
 * Entries are taken in order and dropped from the end, so the user reads the first options the model named
 * rather than the last — the order the model gave them is the order it meant. An entry is kept only while its
 * keycap, its digit and its label all measure inside the column, so a row never spends a column on a label
 * that was cut mid-word; with no room at all the row is blank, which the drawer pads to the frame's width.
 *
 * The colours are applied to the parts that survive, so a theme's bytes never reach a dropped entry.
 */
export function drawOptionRow(pin: ViewPin, textWidth: number, style: PanelStyle): string {
  // Read defensively rather than on the type: the row is drawn from a view that may be built directly, and a
  // list that is not an array of strings is one the drawer cannot name — the honest answer is no row, not a
  // throw that takes the frame down with it.
  const options = Array.isArray(pin.options) ? pin.options : [];
  if (options.length === 0 || textWidth <= 0) return "";
  const kept: string[] = [];
  let width = 0;
  for (const [index, label] of options.entries()) {
    if (typeof label !== "string") continue;
    // Measured on the form the terminal will actually occupy — every escape the entry carries stripped, the
    // keycap and digit included. `visibleWidth` charges an escape pi-tui does not recognise as printable (an
    // unterminated OSC, a lone introducer) columns it never draws, so budgeting on the raw entry would keep
    // such an entry into a row the frame then had to cut from the text underneath: the one way an option
    // label could take the frame's last columns with bytes the user does not see, or push the row over the
    // width the overlay was given.
    const entry = stripSequences(entryCell(index + 1, foldBreaks(label), style));
    const columns = visibleWidth(entry);
    const gap = kept.length === 0 ? 0 : visibleWidth(SEPARATOR);
    if (width + gap + columns > textWidth) break;
    kept.push(entry);
    width += gap + columns;
  }
  // Closed by the frame's own policy, applied on the way out as well as budgeted with on the way in:
  // `fitLine` (`panel-draw.ts`) is the one closure every drawn line of both frames passes through, and this
  // row is a drawn line. It cannot cut what the loop above measured in, so the branch it takes is the pad —
  // which leaves the row at the width the frame offered, with every escape gone (a theme's SGR included, the
  // same price `glyph`/`markerCell` in `panel-frame.ts` pay for the same guarantee), and no short line for
  // the chat behind the panel to show through. Handing the row over padded-but-unstripped instead would leave
  // the strip to `pinRow` (`panel-draw.ts`) over the *whole* row, gutters included, where a cut would spend a
  // gutter's column on an ellipsis.
  return fitLine(kept.join(SEPARATOR), textWidth);
}

/** One entry: `⌨` + the digit in the header colour, the label in the dim colour. */
function entryCell(number: number, label: string, style: PanelStyle): string {
  return `${style.header(`${KEYCAP}${number}`)} ${style.dim(label)}`;
}
