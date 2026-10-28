/**
 * The two counters the panel keeps about commits the session cannot be read for.
 *
 * pi appends a tool result only after `execute()` returns, so there is a window in which the live state is
 * ahead of the branch. Two cells cover it, and both are here rather than inline in `extension.ts` because
 * the rules are the part worth reading and the cells are not: *which* commit counts as unseen, and *which
 * draw* gets to spend it.
 *
 * - **unseen** — a commit exists that the branch does not hold. `rebuildSession` reads it as a yes/no
 *   ("may the branch be trusted for what the user is being shown?"), so it is one bit rather than a count:
 *   a third pin arriving while the user still reads the first must not make that answer stronger.
 * - **fromTool** — whether the draw now running is the tool's own. Only that draw may ask the auto-show
 *   question, because only it follows a `commit`; every other draw (a command's listing, the minute's tick,
 *   the rail's reconsideration, a resize) is re-drawing a view the counters say nothing about, and spending
 *   there would both cost the user an auto-show they never got and tell the next `turn_end` rebuild that the
 *   branch may be trusted while the commit it refers to is still unappended.
 */
import { autoShowForCommits } from "./panel-autoshow.ts";
import type { PanelModeState } from "./panel-mode.ts";
import type { PinView } from "./types.ts";

/** The counters of one extension instance, read and written only through the members below. */
export interface CommitLedger {
  /**
   * A commit has been published that the branch does not hold yet, and the draw that follows it is the
   * tool's own. Called by the deps' `commit` — the only thing that publishes pins pi has not appended.
   *
   * The one writer, and the reason `autoShow` needs no flag: "may this draw spend a commit?" is answered by
   * whether a `note()` is still waiting for its draw, which is the same fact from the other side.
   */
  note(): void;
  /**
   * Whether the branch may be trusted for what the user is being shown: `false` while a commit is unappended.
   *
   * The rebuild's question, asked before it re-reads the branch — see `session-rebuild.ts`.
   */
  unseen(): boolean;
  /**
   * Answer the auto-show question for a commit, and spend it — but only from the draw that earned the right.
   *
   * `tool` is the caller's verdict on what this draw is: the deps' `redraw` passes what `note()` last said,
   * so the draw that follows a commit asks and every other draw does not. The auto-show is settled *into the
   * cell* before anything is drawn, which is the ordering rule `panel-autoshow.ts` states: asking the rail
   * and the overlay about the visibility the user left and only then changing it leaves the rail on screen
   * over a panel that has become visible, with nothing left to redraw it.
   */
  autoShow(panel: PanelModeState, view: PinView): void;
  /** Forget both — a session boundary, or a shutdown. */
  clear(): void;
}

/** The counters of one instance: no commit recorded, and no draw marked as the tool's. */
export function createCommitLedger(): CommitLedger {
  /** A commit the branch does not hold yet, or none. */
  let unseen = false;
  /** Whether the draw in progress follows a commit, set by `note()` and read once by the draw. */
  let fromTool = false;
  return {
    note() {
      unseen = true;
      fromTool = true;
    },
    // Read, not consumed: the rebuild asks this while the commit is still unappended, and several rebuilds
    // can run inside one window (a `turn_end` per boundary, a branch change), each of which has to get the
    // same answer until the tool's own draw settles it.
    unseen: () => unseen,
    autoShow(panel, view) {
      // One commit answered for, however it answered: the user has now been shown, or deliberately not
      // shown, what it held. `autoShowForCommits` is what says yes, and what opens the panel when it does.
      //
      // Spent *only* when it was the tool's draw, and spent then even when the pins did not earn an open: an
      // answer of "no, these levels do not ask" is still an answer. The commit itself is *not* spent here —
      // see `unseen` for why the rebuild keeps getting "no" until a session boundary settles it.
      if (!fromTool) return;
      fromTool = false;
      autoShowForCommits(panel, view.pins, unseen ? 1 : 0);
    },
    clear() {
      unseen = false;
      fromTool = false;
    },
  };
}
