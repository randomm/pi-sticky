/**
 * Ending the transient the panel's open states are transient by.
 *
 * Two of the panel's three states are on screen because *something showed them*: an auto-show earned by an
 * `action`/`warning` pin, or the focus key, which moves the cell through the same write so the keys have a
 * frame to answer from. Per U12 that open is not the frame of one draw — it persists across a redraw, a
 * rebuild, a further pin and a steer — and it *is* ended by the user's next submitted message, which is the
 * interaction that says the pin was read.
 *
 * This module is the one writer which ends an earned open from outside the panel, and it reaches the cell
 * through `deps.redraw`'s owner rather than holding one. Where a component is on screen it does the whole
 * ending itself — its `unfocus` moves the cell and redraws both surfaces through the owner's `onUnfocus` —
 * and only the component-less case reaches for the cell and the redraw directly. Two rules it owns:
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
import type { PanelModeState } from "./panel-mode.ts";

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
  // The cell moves and the surfaces follow, in the one order every writer keeps: the overlay and the rail
  // both read the cell as their first question, so a redraw which ran first would draw the open the message
  // has just ended and never be asked again. `endEarnedOpen` answers for a peek or a hidden panel itself —
  // they are resting states, and a user who chose to show the panel keeps it whichever way the conversation
  // goes — so this handler does not ask the same question twice.
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
 * The `StickyDeps` member of the panel's transient, over the three cells the extension owns.
 *
 * Lives here rather than inline in `extension.ts` because the ordering below *is* the rule — the cell is
 * written before either surface is asked, and the component's focus is released with the open it belonged to.
 */
export function earnedOpenCells(cells: EarnedOpenCells): Pick<StickyDeps, "endEarnedOpen"> {
  return {
    endEarnedOpen() {
      // Only a panel open because a pin asked has a transient to end, and `demote` is what puts it back —
      // to the resting frame for the model's auto-show, to the user's own choice for the open their focus
      // key earned (`panel-mode.ts`). A peek or a hidden panel has nothing to end and is left exactly as it was.
      if (cells.panel.mode() !== "open") return;
      const component = cells.component();
      if (component) {
        // The component moves the cell and redraws both surfaces itself: `unfocus` releases its handle and
        // reports the ending through the owner's `onUnfocus`, which moves the cell and settles the rail (see
        // `panel.ts`). Reaching for the cell and `redraw` on top of that would ask the same question twice,
        // so the interaction's own teardown is the whole of this branch.
        component.unfocus();
        return;
      }
      // No component: the overlay is gone (or never finished building), so its teardown cannot announce the
      // ending and nobody but this writer moves the cell or asks the surfaces to draw. This is the case the
      // two calls below belong to — a panel the cell still believes is open with no component to close it.
      cells.panel.endEarnedOpen();
      cells.redraw();
    },
  };
}
