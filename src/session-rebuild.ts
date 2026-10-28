/**
 * The one rebuild of the live state, and the two questions the session cannot answer for itself.
 *
 * `reconstruct` re-reads the branch into pins; what is left over is the panel's, because the session file
 * records only the *user's* verbs — an auto-show appends nothing — and pi appends a tool result only after
 * `execute` returns. Both facts are the same shape: there is a window in which what the user is being shown
 * is ahead of what the branch can be read for, and a rebuild that trusted the branch during it would hide a
 * panel out from under a pin the user is still reading.
 *
 * `surfacesDrawn()` and `recorded()` are read at call time rather than passed in for the same reason the
 * entries are: the answer belongs to the instant the rebuild runs, and a rebuild that decided against a
 * value the caller read a moment earlier is the same stale read in a different place.
 */
import type { HostContext } from "./context.ts";
import { initialShown } from "./panel-deps.ts";
import type { PanelModeState } from "./panel-mode.ts";
import type { PinState, PinView, ViewPin } from "./types.ts";

/** What a rebuild re-reads: the state and the view built from it. */
export interface Rebuilt {
  state: PinState;
  view: PinView;
}

/** The cells a rebuild reads and writes, all held by the extension instance. */
export interface RebuildCells {
  /** Re-read the branch's entries into a state and view (the caller's `reconstruct`, which it owns). */
  reconstruct(ctx: HostContext): Rebuilt;
  /** The panel's mode cell: the record the rebuild may correct, and the screen it may not. */
  panel: PanelModeState;
  /** Whether either surface is on screen right now — the reason an entry is not an argument. */
  surfacesDrawn(): boolean;
  /**
   * Whether a commit exists that the branch does not hold — the reason the entries are not the last word.
   * Read, not consumed: several rebuilds run inside one append window and each must get the same answer.
   */
  unseen(): boolean;
  /**
   * The pins the outstanding commit published — what the branch has to hold for the commit to be trusted.
   * Empty with no commit outstanding, which is the ordinary case and the one which trusts the branch.
   */
  published(): readonly ViewPin[];
  /**
   * End the outstanding commit: this rebuild read its published pins off the branch, so pi has written the
   * result. `session-commits.ts` owns the cell; this is the only writer, and the only one which has looked.
   */
  landed(): void;
  /**
   * Whether an auto-show sits on the screen the entries do not account for — the second reason they are not
   * the last word, outliving the commit itself: the branch may be read for the pins while the panel is still
   * up because one of them was shown to the user, and the verb the entries hold is the hide that undid.
   */
  autoShowPending(): boolean;
  /** Report that this rebuild was handed the branch, which is what settles that claim. */
  sighted(): void;
  /** Commit the rebuilt state and view as the live ones. */
  publish(rebuilt: Rebuilt): void;
}

/**
 * Re-read the session and settle the panel from it, clearing the counter of commits the session cannot see.
 *
 * The terminal's width is deliberately *not* touched here: `session_tree` runs on a branch change, which is
 * not a resize, and pi-tui will not state another width until the window actually changes. A rebuild that
 * discarded it would leave the panel with no measurement to answer `visible()` with and the pins on neither
 * surface. Only `session_shutdown` clears it.
 */
/**
 * Whether the branch holds the pins the outstanding commit published — the only evidence the extension is
 * ever given that pi has written the tool result, since the append lands after the boundary which ends the
 * turn has been dispatched. Every id the commit touched has to be there under the uid it was published with:
 * a branch still showing the pre-commit pins, or one missing a pin, has not landed the commit, and the
 * commit stays owed. An empty `published` is the case with nothing to wait for, and lands at once.
 */
function holdsCommit(rebuilt: Rebuilt, published: readonly ViewPin[]): boolean {
  if (published.length === 0) return true;
  const onBranch = new Map(rebuilt.state.pins.map((pin) => [pin.id, pin]));
  return published.every((pin) => onBranch.get(pin.id)?.uid === pin.uid);
}

export function rebuildSession(ctx: HostContext | undefined, cells: RebuildCells): void {
  if (!ctx) return;
  // A commit pi has not appended yet says nothing about the pins: the auto-show that recorded it has already
  // moved the screen, and re-reading a hide it just undid would put the panel back out of sight. Both the
  // answer and what it is an answer about are taken *before* the branch is read, and the verdict is recorded
  // the moment the reading is done, so no caller can be given one answer while the ledger remembers another.
  const stale = cells.unseen();
  const published = cells.published();
  const rebuilt = cells.reconstruct(ctx);
  cells.publish(rebuilt);
  // The verdict and the answer this rebuild was given are one event: the commit's pins are on the branch, so
  // the commit is spent and the *next* rebuild is the first which may be handed the branch at all.
  if (stale && holdsCommit(rebuilt, published)) cells.landed();
  // The entry answers only the question the session can answer: what the *user* chose. A panel that is on
  // screen is not an argument about that choice, so it is settled from the entry with `recorded: false` —
  // without that, one auto-open after a `/pins hide` would make every later rebuild re-show a panel the user
  // had closed. With nothing drawn and the user's verb last in the record, the entries decide outright.
  //
  // The auto-show's own claim is the second gate, and it outranks the entries without outranking the user:
  // a panel which came out of hiding for a pin the branch has only this moment been read for stays where the
  // auto-show put it. A verb the user wrote themselves outranks an auto-show every time — that is what makes
  // the claim a transience rather than a latch.
  if (!stale && (cells.surfacesDrawn() || cells.panel.recorded())) {
    if (!cells.autoShowPending() || cells.panel.recorded()) {
      cells.panel.settle(initialShown(ctx), !cells.surfacesDrawn());
    }
    cells.sighted();
  }
}
