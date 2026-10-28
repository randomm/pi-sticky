/**
 * Ending the transient the panel's open states are transient by (`src/panel-transience.ts`).
 *
 * Two of the panel's three states are on screen because *something showed them*: an auto-show earned by an
 * `action`/`warning` pin, or the focus key, which moves the cell through the same write so the keys have a
 * frame to answer from. Operator resolution 2 of pins v2-4 says that open is not the frame of one draw — it
 * persists across a redraw, a rebuild, a further pin and a steer — and it *is* ended by the user's next
 * submitted message, which is the interaction that says the pin was read.
 *
 * This module owns the second half: it is the one writer which ends an earned open from outside the panel,
 * and it reaches the cell through `deps.redraw`'s owner rather than holding one. Both are rules worth having
 * in one place, because both are easy to get wrong in a way no single-surface test sees:
 *
 * - **Which submission.** Only what the user *sent*, from the editor or over RPC. A steer (`streaming
 *   behavior` set, dispatched while the agent is mid-run) is the user steering the model, not answering a
 *   pin they may not have read yet, and an extension-originated input is nobody's interaction at all.
 * - **Which panel.** Only one that is open because a pin asked. A panel the user *chose* to show (`/pins
 *   show`, `ctrl+alt+t`) is theirs, and a message would have no business closing it; the same goes for a
 *   peek, which is a resting state and not a transient.
 *
 * A submitted message which ends nothing therefore reaches neither the cell nor the surfaces — no redraw, no
 * rail reconsideration — because a plain turn of the conversation must not be able to move a panel the user
 * is looking at.
 */
import type { InputEvent, InputSource } from "@earendil-works/pi-coding-agent";

import type { StickyDeps } from "./deps.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelMode, PanelModeState } from "./panel-mode.ts";

/** Which submissions are the user's own: typed at the editor, or sent over RPC. Not a steer, not an extension. */
const USER_SOURCES: readonly InputSource[] = ["interactive", "rpc"];

/**
 * End the panel's earned open when this submission is the user's own next message.
 *
 * Called from the reply handler — the one `pi.on("input")` the extension has — and it returns before the
 * reply's own work either way, so a submission this module answers for is never a submission that half-ran:
 * the panel comes down whether or not the text carried a `Re #<id>:` marker.
 */
export function endEarnedOpenOnSubmission(deps: StickyDeps, event: InputEvent): void {
  if (!USER_SOURCES.includes(event.source)) return;
  if (!deps.panelEarnedOpen()) return;
  // The cell moves and the surfaces follow, in the one order every writer keeps: the overlay and the rail
  // both read the cell as their first question, so a redraw which ran first would draw the open the message
  // has just ended and never be asked again. `endEarnedOpen` is the extension's, which is where the cell,
  // the component's focus and the rail handoff are all reachable.
  deps.endEarnedOpen();
}

/** What `earnedOpenCells` is given: the three things only the extension holds, each read at call time. */
export interface EarnedOpenCells {
  /** The panel's mode cell — the same one the overlay's frame and the rail's handoff read. */
  panel: PanelModeState;
  /** The open panel's component, or `undefined` when no panel is open. */
  component(): PanelComponent | undefined;
  /** Ask both surfaces to draw: the extension's own `redrawAll`, with its own live context. */
  redraw(): void;
}

/**
 * The two `StickyDeps` members of the panel's transient, over the three cells the extension owns.
 *
 * Lives here rather than inline in `extension.ts` because the ordering below *is* the rule — the cell is
 * written before either surface is asked, and the component's focus is released with the open it belonged to
 * — and the file that states when an open ends is the file that should state how. `extension.ts` supplies the
 * cells and spreads the result into its deps, exactly as it forwards the commit ledger's own members.
 */
export function earnedOpenCells(
  cells: EarnedOpenCells,
): Pick<StickyDeps, "panelEarnedOpen" | "endEarnedOpen"> {
  const earned = (): PanelMode => cells.panel.mode();
  return {
    panelEarnedOpen: () => earned() === "open",
    endEarnedOpen() {
      // Nothing earned, nothing to end: a peek and a hidden panel are resting states, and a user who chose
      // to show the panel keeps it whichever way the conversation goes.
      if (earned() !== "open") return;
      // Focus before the cell: `unfocus` is the component's own teardown of the interaction, and it reports
      // the ending to the cell's `afterUnfocus` through the owner's wiring. Asking for it here rather than
      // calling `afterUnfocus` directly is what keeps the two halves of leaving a panel — the component's
      // handle and the cell's mode — from parting when a panel happens to be open.
      cells.component()?.unfocus();
      cells.panel.afterUnfocus();
      cells.redraw();
    },
  };
}
