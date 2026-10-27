/**
 * The session's three boundaries that all do the same thing: take the context, re-read the branch, draw.
 *
 * `session_start` and `session_tree` both (re)open the overlay; `turn_end` does not, because a turn ending
 * has not changed which overlay the user is looking at. The two share everything else, and sharing it is
 * what keeps the *order* fixed: a `redrawAll` before the `rebuild` draws the previous branch, and an
 * `open` before the rebuild opens the overlay on a view nobody has read. `session_shutdown` is deliberately
 * not here — it clears state, closes the overlay and forgets the terminal width, a different job with a
 * different order, and it stays where the state it clears is declared.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { HostContext } from "./context.ts";
import type { PanelOwner } from "./panel.ts";
import type { SessionTick } from "./session-tick.ts";

/** What the three handlers may touch, all through the extension instance's own cells. */
export interface SessionDraw {
  /** The context to remember as live, so a later redraw with no context of its own has one. */
  adopt(ctx: ExtensionContext): void;
  /** Re-read the branch and the session entries into the live state and view. */
  rebuild(ctx: HostContext | undefined): void;
  /** Draw the rail and refresh the panel, at the context this event came from. */
  redraw(ctx: ExtensionContext | undefined): void;
  /** The owner, held in a cell because its wiring and the rail's draw are mutually recursive. */
  panel(): PanelOwner | undefined;
  /** The minute hand, whose lifetime is the session's: these events give it, and the boundaries take it back. */
  tick: SessionTick;
}

/**
 * Re-read the session and draw both surfaces for it, then hand the minute hand to it.
 *
 * Called by `session_start` and `session_tree` — the two events that open the overlay, and the only ones
 * that build a hand. The tick restart comes *last*, after the open, because a timer whose first tick landed
 * before this frame had nothing to be late for and a hand that asked about the panel before it was opened
 * would be told nothing is drawn. It restarts rather than keeps because a reload re-fires `session_start`
 * over a session that already had a hand — the old one is stopped first, and the new one carries no memory
 * of the minute the other drew, which is what makes a branch change (`session_tree`) not redraw the branch
 * you came from on the schedule you left.
 */
export function drawSession(ctx: ExtensionContext, draw: SessionDraw): void {
  adoptAndDraw(ctx, draw);
  // The panel of the branch the user left is closed and a fresh one opened, so the overlay on screen is
  // always the one that belongs to the branch being drawn. `open()` closes the record it is replacing
  // itself, so nothing here has to close it first.
  draw.panel()?.open(ctx);
  // The hand is the last move: it asks which surfaces are drawn, and until the overlay was opened the
  // panel was not one of them.
  draw.tick.restart(ctx.mode);
}

/**
 * Re-read the session and draw both surfaces, without touching the overlay or the hand.
 *
 * The half every boundary shares: a turn's appends have landed, so the branch is re-read, but which surface
 * the user is looking at has not changed and reopening it would hand the panel a fresh record every turn.
 * `turn_end` is the whole of it; `drawSession` adds the open and the hand on top.
 */
export function settleSession(ctx: ExtensionContext, draw: SessionDraw): void {
  adoptAndDraw(ctx, draw);
  // Nothing is asked of the hand here, on purpose. Every change to which surfaces are drawn reaches the
  // hand through the redraw itself — the rail's install, the panel's open and close, the component's
  // teardown each report to it — and a boundary that *also* re-decided would re-arm a hand the surface it
  // just tore down had already asked to stop: `turn_end` lands after a dismissal that emptied the view,
  // and a hand rebuilt there would wake once a minute over a screen that draws neither surface.
}

/** The two moves every session boundary makes in the same fixed order: adopt the context, then rebuild and draw. */
function adoptAndDraw(ctx: ExtensionContext, draw: SessionDraw): void {
  draw.adopt(ctx);
  draw.rebuild(ctx);
  draw.redraw(ctx);
}

/**
 * The `SessionDraw` of one extension instance, built from the cells it owns.
 *
 * One builder rather than a literal at the call site because the three boundaries below must reach the same
 * cells in the same way — a `panel` that read a captured owner instead of the holder would draw the branch
 * the user left, which is the whole reason the owner is in a cell at all.
 */
export function drawFrom(opts: {
  adopt(ctx: ExtensionContext): void;
  rebuild(ctx: HostContext | undefined): void;
  redraw(ctx: ExtensionContext | undefined): void;
  panel(): PanelOwner | undefined;
  tick: SessionTick;
}): SessionDraw {
  return opts;
}
