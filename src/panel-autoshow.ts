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
 * what the user is being shown", and that is the only claim any reader of the counter needs. It used to
 * be spelled twice, as `flagIsStale` and as the first half of `autoShowOnRedraw`, which read as two
 * rules and were one.
 *
 * The append-timing window, stated once here because both readers depend on it: U8's auto-show moves the
 * live flag without appending anything — the user did not ask for the panel to *stay* open. But
 * `turn_end` rebuilds the flag from the session, and pi appends the tool result only after `execute`
 * returns, so the rebuild that follows an auto-show can read a branch still holding the hide the
 * auto-show just undid and put the panel back out of sight before the user has seen the pin. A commit
 * that arrived since the last rebuild is that branch: not yet written, and therefore not yet a fact the
 * session can be read for.
 */

/** Did this commit add pins, which is what makes it a change the user has not seen? */
export function pinsArrived(pinCountBefore: number, pinCountAfter: number): boolean {
  return pinCountAfter > pinCountBefore;
}

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
