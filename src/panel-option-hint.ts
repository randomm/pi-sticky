/**
 * What the focused panel's bottom border says when the pin under the bar has options.
 *
 * The plain hint (`HINT`, `panel-lines.ts`) names the keys every panel answers. A pin with options answers
 * more of them — `1` to `N` each fill the editor with that option's reply — and a key the user cannot see
 * is a key they will not press, so the border names the digit range too, with the real count.
 *
 * The text is composed here and handed to the drawer as a `PanelContent` field, exactly the way
 * `replyHint` (`panel-hint.ts`) composes the resting border's label: `buildPanelLines` takes no policy about
 * what the border says, and the frame's escape policy (`borderLine` → `fitLabel`) cuts the result with `…`
 * when the panel is too narrow to draw it whole.
 */
import { HINT } from "./panel-lines.ts";
import { MAX_OPTIONS } from "./pin-fields.ts";
import type { ViewPin } from "./types.ts";

/**
 * The focused border's label for a pin with `n` options: the keys of `HINT` with the digit range in front,
 * spelled with the real count. `""` for a count outside the range `pin-fields.ts` accepts — a pin stores no
 * such list, and a border that advertised keys no pin answers is the lie `panel-hint.ts` refuses too.
 */
export function optionHint(n: number): string {
  if (n < 1 || n > MAX_OPTIONS) return "";
  const keys = n === 1 ? "1" : `1\u2013${n}`;
  return `${keys} answer \u00b7 ${HINT}`;
}

/**
 * The label of the focused bottom border: `HINT`, or `optionHint` when the pin under the bar has options.
 *
 * The selected pin is the only one whose keys are live — `d` and Enter address it, and so do the digits —
 * so the border names the digits that answer it and no others.
 */
export function focusedHint(pins: readonly ViewPin[], selection: number, focused: boolean): string {
  if (!focused) return HINT;
  const options = pins[selection]?.options;
  return options === undefined ? HINT : optionHint(options.length);
}
