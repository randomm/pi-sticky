/**
 * The one writer of the panel's *screen*, given the four things it needs from the session.
 *
 * The rule it enforces: **the screen and the record are moved by one call, and the redraw follows**. A
 * caller cannot move the screen without asking the two surfaces about it, which is what makes "the user hid
 * the panel and something redrew the rail over it" unrepresentable.
 *
 * Two non-obvious constraints:
 * - The cell is written *before* the redraw: both surfaces read the cell as their first question, so a
 *   redraw that ran first would draw the state the user just left and never be asked again.
 * - The redraw happens even when the *append* throws. pi's `appendEntry` reaches into the session the
 *   command context belongs to, and a context replaced since the verb was read throws there; without the
 *   finally the cell would have moved and left both surfaces drawing the state they just left, with nothing
 *   else scheduled to ask them again.
 */
import type { PanelModeState } from "./panel-mode.ts";

export function settlePanel(
  panel: PanelModeState,
  shown: boolean,
  record: boolean,
  append: (shown: boolean) => void,
  redraw: () => void,
): void {
  // The cell first and the surfaces after: the two surfaces read the cell as their first question, so a
  // redraw that ran before the settle would draw the state the user just left and never be asked again.
  panel.settle(shown);
  // The record goes on the session and nowhere else, and only for the user's verbs: an auto-show calls the
  // cell's `autoOpen` directly, so a transient open cannot be recorded by construction.
  try {
    if (record) append(shown);
  } finally {
    redraw();
  }
}
