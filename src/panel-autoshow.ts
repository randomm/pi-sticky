/**
 * Whether a pin the user has not yet seen has to un-hide the panel.
 *
 * U8 (docs/research-summary.md): a pin that arrives while the panel is hidden would otherwise stay
 * invisible until the user thought to open it, which defeats the point of pinning. So the first pin
 * committed after a rebuild shows the panel — and shows it *without* recording an entry, because the
 * user did not ask for the panel to stay open and their recorded choice must survive the auto-show.
 * `sinceRebuild` is the counter that tells the two apart: a redraw of a view the session already had
 * must not fight a panel the user just closed.
 */

/** Did this commit add pins, which is what makes it a change the user has not seen? */
export function pinsArrived(pinCountBefore: number, pinCountAfter: number): boolean {
  return pinCountAfter > pinCountBefore;
}

/** Should this redraw un-hide a hidden panel? New pins since the last rebuild, and nothing shown. */
export function autoShowOnRedraw(sinceRebuild: number, shown: boolean): boolean {
  return sinceRebuild > 0 && !shown;
}

/**
 * Whether the flag a rebuild is about to read can be trusted, or whether it is a stale answer about a
 * pin that has not been written yet.
 *
 * U8's auto-show moves the live flag without appending anything — the user did not ask for the panel
 * to *stay* open, and their recorded choice must survive. But `turn_end` rebuilds the flag from the
 * session, and pi appends the tool result only after `execute` returns, so the rebuild that follows an
 * auto-show can read a branch still holding the hide the auto-show just undid and put the panel back
 * out of sight before the user has seen the pin. A commit that arrived since the last rebuild is that
 * branch: not yet written, and therefore not yet a fact the session can be read for.
 */
export function flagIsStale(sinceRebuild: number): boolean {
  return sinceRebuild > 0;
}
