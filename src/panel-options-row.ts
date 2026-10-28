/**
 * The options row a pin with `options` draws beneath it, and the row budget that keeps it honest.
 *
 * A pin may carry up to `MAX_OPTIONS` (four) short labels — the actions the model offers the user, which the
 * user fills into the editor by number and submits themselves (U7: nothing here acts). The row spells them
 * `1 Passed on   2 Not yet`: a keycap glyph before each label, the label after it, and three spaces between
 * entries so a label that contains a space cannot read as two entries.
 *
 * Two rules the module is written around:
 *
 * - **The keycap is composed from the colours the panel already has**, not a new member of `PanelStyle`: the
 *   digit goes through `style.header` and the label through `style.dim`, which is what a keycap looks like
 *   beside the rest of the frame without asking every hand-built style in the tests to learn a fourth verb.
 * - **One row costs one row.** The row table decides how many rows a pin owns before it draws anything, and
 *   the scroll window, the selection bar and `d`/`Enter` all index that count — so an options row that
 *   wrapped to two rows at a narrow width would be a row the window scrolls past and the bar sits on top of.
 *   `pinOptionRows` therefore *reserves* the row in the table (the text is the pad character) and
 *   `drawOptionRow` fills it at the last moment with what fits: the last entry whose keycap and label both
 *   close inside the column, with nothing drawn past it rather than a cut label the user could not answer.
 *
 * The labels are untrusted: they arrive through `cleanField` (`pin-fields.ts`), which sanitizes, folds and
 * bounds each one before it is stored. The row is drawn through the frame's own escape policy all the same
 * (`fitLine`, `panel-lines.ts`), because the theme's colouring is applied on the way and a smuggled escape
 * must not buy free columns in a flush-right overlay.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import { foldBreaks } from "./escape.ts";
import { padPlain } from "./panel-frame.ts";
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
  const options = pin.options;
  if (options === undefined || options.length === 0 || textWidth <= 0) return "";
  const kept: string[] = [];
  let width = 0;
  for (const [index, label] of options.entries()) {
    const entry = entryCell(index + 1, foldBreaks(label), style);
    const gap = kept.length === 0 ? 0 : visibleWidth(SEPARATOR);
    if (width + gap + visibleWidth(entry) > textWidth) break;
    kept.push(entry);
    width += gap + visibleWidth(entry);
  }
  // Padded, not left short: the row is a row the window counted, and a short line inside the frame lets the
  // chat behind the panel show through its last columns.
  return padPlain(kept.join(SEPARATOR), textWidth);
}

/** One entry: `⌨` + the digit in the header colour, the label in the dim colour. */
function entryCell(number: number, label: string, style: PanelStyle): string {
  return `${style.header(`${KEYCAP}${number}`)} ${style.dim(label)}`;
}
