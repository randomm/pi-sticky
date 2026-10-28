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
import type { PinState, PinView } from "./types.ts";

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
   *
   * Read, not consumed: several rebuilds can run inside one append window and each must get the same answer
   * until the tool's own draw settles it. `session-commits.ts` owns the cell and the rule.
   */
  unseen(): boolean;
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
export function rebuildSession(ctx: HostContext | undefined, cells: RebuildCells): void {
  if (!ctx) return;
  // A commit pi has not appended yet says nothing about the pins: the auto-show that recorded it has already
  // moved the screen, and re-reading a hide it just undid would put the panel back out of sight.
  const stale = cells.unseen();
  const rebuilt = cells.reconstruct(ctx);
  cells.publish(rebuilt);
  // The entry answers only the question the session can answer: what the *user* chose. A panel that is on
  // screen is not an argument about that choice, so it is settled from the entry with `recorded: false` —
  // without that, one auto-open after a `/pins hide` would make every later rebuild re-show a panel the user
  // had closed. With nothing drawn and the user's verb last in the record, the entries decide outright.
  if (!stale && (cells.surfacesDrawn() || cells.panel.recorded())) {
    cells.panel.settle(initialShown(ctx), !cells.surfacesDrawn());
  }
}
