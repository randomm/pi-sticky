/**
 * The session boundaries the extension registers, and the one move it makes when a session dies.
 *
 * `session_start` and `session_tree` do the same thing (`drawSession`, `session-draw.ts`), `turn_end` does
 * the same thing without reopening the overlay, and `session_shutdown` clears the instance. What is left
 * here is the wiring of the handlers to the cells, and the teardown order — which is the one place this
 * extension has to say what goes when, and why.
 *
 * Teardown order, and the reason it is not alphabetical:
 * - The timer goes *first*: a `setInterval` that outlives its session fires into the redraw of whichever
 *   session comes next.
 * - The live context and the state go next. The panel's own close fires host handles that may throw, and a
 *   host that cannot close its overlay is no reason to keep a dead session's pins, flag and width in this
 *   instance.
 * - The cell's *transience* goes and its configuration stays: `endEarnedOpen` forgets an open no entry ever
 *   wrote and keeps the operator's resting mode; the recorded flag is settled from the new session when it
 *   starts (`session-rebuild.ts`).
 * - The terminal is *forgotten*, not zeroed: a session belongs to a terminal, the next one has stated
 *   nothing about its width, and what is forgotten is the number, never the fact that the host gets asked
 *   again (`panel-width.ts`).
 * - The panel closes last: pi's teardown has already popped the overlay, so its `close()` is a no-op against
 *   an entry that is gone.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PanelOwner } from "./panel.ts";
import type { SessionDraw } from "./session-draw.ts";
import { drawFrom, drawSession, settleSession } from "./session-draw.ts";
import type { SessionTick } from "./session-tick.ts";

/** What the boundaries reach, all through the extension instance's own cells. */
export interface SessionHandlerCells {
  /** Adopt the context of the boundary that fired, so a later redraw has one to draw through. */
  adopt(ctx: ExtensionContext): void;
  /** Re-read the branch and the entries into the live state and view. */
  rebuild(ctx: ExtensionContext): void;
  /** Draw both surfaces, at whichever context is still live. */
  redraw(ctx: ExtensionContext | undefined): void;
  /** The owner, in the cell its wiring and the rail's draw are mutually recursive through. */
  panel(): PanelOwner | undefined;
  /** The minute hand, whose lifetime is the session's. */
  tick: SessionTick;
  /** Stop the hand, drop the live context, and empty the state, the cell's transience and the width. */
  shutdown(): void;
}

/**
 * Register the four boundaries. Each handler is one call: the order lives in `session-draw.ts` for the two
 * that draw, and in the extension's own `shutdown` closure for the one that tears down.
 */
export function registerSessionHandlers(pi: ExtensionAPI, cells: SessionHandlerCells): void {
  const draw: SessionDraw = drawFrom({
    adopt: cells.adopt,
    rebuild: cells.rebuild,
    redraw: cells.redraw,
    panel: cells.panel,
    tick: cells.tick,
  });
  pi.on("session_start", (_event, ctx) => drawSession(ctx, draw));
  pi.on("session_tree", (_event, ctx) => drawSession(ctx, draw));
  // Reconcile with the session now that every append of the turn has landed; a commit pi never got to
  // write is dropped here rather than living on into the next turn. `settleSession` and not `drawSession`:
  // a turn ending has not changed which overlay the user is looking at, and reopening one would hand the
  // panel a fresh record every turn.
  pi.on("turn_end", (_event, ctx) => settleSession(ctx, draw));
  pi.on("session_shutdown", () => {
    cells.shutdown();
  });
}
