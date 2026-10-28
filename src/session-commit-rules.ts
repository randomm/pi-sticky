/**
 * The argument for the shape of `session-commits.ts`: that file is the contract of the counters, this one is
 * why the lifecycle is this shape. Both alternatives below pass a unit test of a single bit and are wrong in
 * ways only a lifecycle test sees.
 */

/**
 * The latch: a bit which only `clear()` writes.
 *
 * Set by `note()` and forgotten only at a session boundary, it keeps answering "the branch may not be
 * trusted" for the rest of the session: one pin early on and every later rebuild refuses to settle the screen
 * from the user's own recorded verb.
 *
 * The rule, then: the branch either holds the pins the commit published or it does not, and the rebuild which
 * finds them there is the one which ends the commit. No counting, no window, no timer.
 */

/**
 * The boundary count: spend the bit at the first boundary of the commit's turn.
 *
 * `turn_end` is dispatched by the host's boundary hook (`_dispatchTurnEndBoundary`) *before* the turn's drafts
 * are committed (`_commitBoundaryDrafts`), so the boundary which ends a commit's turn is exactly the one at
 * which the branch does *not* hold the commit yet. Spend there and the rebuild which lands the pin re-reads
 * the hide the auto-show had just undid and puts the panel out of sight under a pin the user is still reading.
 */

/**
 * The auto-show's claim (`autoShowPending`/`sighted`) is a second cell for the same reason. A commit can land
 * — the pins are on the branch, so the branch may be read — while the panel is still showing a pin because
 * the auto-show brought it out of hiding, and the entries still hold the hide that showing was granted
 * permission to undo. Trusting the branch and letting the entries *settle the screen* are two questions.
 */
export {};
