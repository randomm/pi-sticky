/**
 * Whether a pin the user has not yet seen has to un-hide the panel.
 *
 * U8 (docs/research-summary.md): a pin that arrives while the panel is hidden would otherwise stay
 * invisible until the user thought to open it, which defeats the point of pinning. So the first pin
 * committed after a rebuild shows the panel — and shows it *without* recording an entry, because the
 * user did not ask for the panel to stay open and their recorded choice must survive the auto-show.
 * `sinceRebuild` is the counter that tells the two apart: a redraw of a view the session already had
 * must not fight a panel the user just closed.
 *
 * One counter, one question about it: `sinceRebuild > 0` means "the session cannot yet be read for
 * what the user is being shown", and that is the only claim any reader of the counter needs. The other
 * half of the rule — whether a commit is one the user has not seen — is the one comparison in
 * `extension.ts`'s `commit`, written where the two states it compares are in the reader's hands.
 *
 * The append-timing window, stated once here because both readers depend on it: U8's auto-show moves the
 * live flag without appending anything — the user did not ask for the panel to *stay* open. But
 * `turn_end` rebuilds the flag from the session, and pi appends the tool result only after `execute`
 * returns, so the rebuild that follows an auto-show can read a branch still holding the hide the
 * auto-show just undid and put the panel back out of sight before the user has seen the pin. A commit
 * that arrived since the last rebuild is that branch: not yet written, and therefore not yet a fact the
 * session can be read for.
 */

import { demandsAttention, newestPins } from "./panel-mode.ts";
import type { PanelModeState } from "./panel-mode.ts";
import type { ViewPin } from "./types.ts";

/**
 * Does the session still not know what the user is being shown — because a commit arrived since the
 * last rebuild, and pi has not appended it yet?
 *
 * The auto-show reads this to decide whether to un-hide a hidden panel; `rebuild` reads the same
 * answer to decide whether the flag the session reports may be trusted.
 */
export function hasUnseenPins(sinceRebuild: number): boolean {
  return sinceRebuild > 0;
}

/**
 * The counter, and the one question the panel asks of it: does a commit the user has not been shown demand
 * their attention, and so owe them an open panel?
 *
 * U8 said *any* new pin shows a hidden panel. U11 narrowed that to the levels whose whole purpose is a
 * decision or a blocker — `action` and `warning` — because a chatty model was deciding when the user's
 * transcript got covered, and the rail already draws an `info` pin whether or not the panel is open. What
 * survives of U8 is the half that mattered: a pin the user must act on must not arrive silently.
 *
 * The order is the part a caller can get wrong, and why the rule is here rather than in the caller: the
 * commit must be *settled into the cell* before anything is drawn. Asking the rail and the overlay about the
 * visibility the user left, and only then changing it, leaves the rail on screen over a panel that has
 * become visible, with nothing left to redraw it.
 */
export function autoShowForCommits(
  panel: PanelModeState,
  pins: readonly ViewPin[],
  sinceRebuild: number,
): boolean {
  // The return is the caller's answer to "may I clear the counter". Only a commit this function actually
  // *answered* is spent: a draw that reached no decision — no unseen commit, or one whose pins do not ask
  // for attention — has not shown the user anything, and clearing the counter there would spend the
  // auto-show before the user ever had it.
  if (!hasUnseenPins(sinceRebuild)) return false;
  if (!demandsAttention(newestPins(pins, sinceRebuild))) return false;
  // `autoOpen` and not the cell's `settle`: an auto-show is not a statement about whether the panel should
  // *stay* shown, so it records nothing and the user's recorded choice survives it.
  panel.autoOpen();
  return true;
}
