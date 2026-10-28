/**
 * The one writer of the panel's *screen*, given the four things it needs from the session.
 *
 * `setShown` in `extension.ts` was the whole of it, and it grew two facts that are not the extension's:
 * which entry makes the choice survive a reload, and that a visibility change has to redraw both surfaces
 * at once. Neither can be tested without an extension, and both are the mechanism behind a documented
 * behaviour ("`/pins hide` sticks across a reload"). So the writer is here, in terms of the five things it
 * needs, and `extension.ts` supplies them — the cell, the entry to append, the redraw to make — without
 * holding the rule.
 *
 * The rule it enforces: **the screen and the record are moved by one call, and the redraw follows**. A
 * caller cannot move the screen without asking the two surfaces about it, which is what makes "the user hid
 * the panel and something redrew the rail over it" — the failure U8 exists to prevent — unrepresentable.
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
  // The record is the user's own statement, so it goes on the session and nowhere else — and only for their
  // verbs. An auto-show never reaches this function at all (it calls the cell's `autoOpen` directly), so
  // there is no flag here to get wrong: a transient open cannot be recorded by construction.
  if (record) append(shown);
  redraw();
}
