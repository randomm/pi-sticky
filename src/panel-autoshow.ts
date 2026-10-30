/**
 * Whether a pin the user has not yet seen has to un-hide the panel.
 *
 * U8 (docs/research-summary.md): a pin that arrives while the panel is hidden would otherwise stay
 * invisible until the user thought to open it, which defeats the point of pinning. So the first pin
 * committed after a rebuild shows the panel — and shows it *without* recording an entry, because the
 * user did not ask for the panel to stay open and their recorded choice must survive the auto-show.
 * `session-commits.ts` keeps the counter that tells the two apart: a redraw of a view the session
 * already had must not fight a panel the user just closed.
 *
 * The append-timing window, stated once here because both readers of that counter depend on it: U8's
 * auto-show moves the live flag without appending anything — the user did not ask for the panel to *stay*
 * open. But `turn_end` rebuilds the flag from the session, and pi appends the tool result only after
 * `execute` returns, so the rebuild that follows an auto-show can read a branch still holding the hide the
 * auto-show just undid and put the panel back out of sight before the user has seen the pin. A commit that
 * arrived since the last rebuild is that branch: not yet written, and therefore not yet a fact the session
 * can be read for.
 *
 * U11 (docs/research-summary.md) narrowed the rule below to the two levels that ask the user to act; the
 * window above is unchanged by that narrowing, and is the reason the commit's fact is kept at all.
 */

import { demandsAttention } from "./panel-mode.ts";
import type { PanelModeState } from "./panel-mode.ts";
import type { ViewPin } from "./types.ts";

/**
 * The one question the panel asks of a commit: does it demand the user's attention, and so owe them an
 * open panel?
 *
 * U8 said *any* new pin shows a hidden panel. U11 narrowed that to the levels whose whole purpose is a
 * decision or a blocker — `action` and `warning` — because a chatty model was deciding when the user's
 * transcript got covered, and the rail already draws an `info` pin whether or not the panel is open. What
 * survives of U8 is the half that mattered: a pin the user must act on must not arrive silently.
 *
 * `affected` is the ids that commit touched, straight from the reducer (`deps.commit` carries them). The
 * view is only where their levels are read, and it is a parameter because the ids mean nothing without it:
 * an `update` keeps the id it was given, so the pin to look at is named, never ranked out of the list.
 * Missing ids — an id the view no longer holds — are skipped; an empty list is a commit that touched
 * nothing, which opens nothing.
 *
 * The order is the part a caller can get wrong, and why the rule is here rather than in the caller: the
 * commit must be *settled into the cell* before anything is drawn. Asking the rail and the overlay about the
 * visibility the user left, and only then changing it, leaves the rail on screen over a panel that has
 * become visible, with nothing left to redraw it.
 */
export function autoShowForCommits(
  panel: PanelModeState,
  pins: readonly ViewPin[],
  affected: readonly number[],
): boolean {
  // A commit that touched nothing has shown the user nothing, and an auto-show spent there is an auto-show
  // the user never got.
  if (affected.length === 0) return false;
  const touched = new Set(affected);
  if (!demandsAttention(pins.filter((pin) => touched.has(pin.id)))) return false;
  // `autoOpen` and not the cell's `settle`: an auto-show is not a statement about whether the panel should
  // *stay* shown, so it records nothing and the user's recorded choice survives it. `"autoshow"` is the
  // provenance that ending reads: the open goes back to the resting frame, not to the hide it overrode.
  panel.autoOpen("autoshow");
  return true;
}
