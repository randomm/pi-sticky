/**
 * The cells `rebuildSession` reads and writes, as one extension instance answers them.
 *
 * `rebuildSession` (`session-rebuild.ts`) declares the shape; this module is the extension's half of the
 * pair, and the single place the user's sequence is written down: append, rebuild, draw. It is a factory
 * rather than a literal in `extension.ts` because both halves carry a rule with a reason:
 *
 * - The ledger's members are forwarded *whole* rather than re-implemented, so the answer a caller is given
 *   cannot part from the state the ledger keeps (`session-commits.ts`).
 * - The user's path rebuilds and the agent's does not. By the time `appendUserAction` runs the entry *is* on
 *   the session, so the rebuild can see the dismissal — unlike the tool's path, whose entry pi has not
 *   written yet. Reading the session rather than editing the live state is also what makes a dismissal stick
 *   session-wide, and what makes the rail show a replied pin's suffix.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { HostContext } from "./context.ts";
import type { PanelModeState } from "./panel-mode.ts";
import type { CommitLedger } from "./session-commits.ts";
import type { RebuildCells, Rebuilt } from "./session-rebuild.ts";
import { rebuildSession } from "./session-rebuild.ts";
import type { PinState, UserAction } from "./types.ts";

/** What one extension instance answers for a rebuild, and what the user's path reaches for. */
export interface UserCommitCells {
  /** The ledger whose members are forwarded whole into the rebuild cells. */
  commits: CommitLedger;
  /** The panel's mode cell, which a rebuild may correct and may not overwrite. */
  panel: PanelModeState;
  /** Whether either surface is on screen right now — the reason an entry is not an argument. */
  surfacesDrawn(): boolean;
  /** Re-read the branch and the entries (the extension's `reconstruct`, which it owns). */
  reconstruct(ctx: HostContext): Rebuilt;
  /** Publish the rebuilt state and view as the live ones. */
  publish(rebuilt: Rebuilt): void;
  /** Append the entry, at the extension's own type and version. */
  append(action: UserAction): void;
  /** The live context, read at call time — the one the rebuild reads the branch through. */
  live(): ExtensionContext | undefined;
  /** Draw both surfaces from the live state. */
  redraw(): void;
}

/**
 * The cells `rebuildSession` reads and writes, as one extension instance answers them.
 *
 * `Rebuilt` (`session-rebuild.ts`) is named rather than re-spelled here and at the extension's call site:
 * it is the canonical shape of a rebuild's output, and the array identity the frame cache's `pins` comparison
 * trusts comes out of it.
 */
export function createRebuildCells(cells: UserCommitCells): RebuildCells {
  return {
    reconstruct: cells.reconstruct,
    ...cells.commits,
    panel: cells.panel,
    surfacesDrawn: cells.surfacesDrawn,
    publish: cells.publish,
  };
}

/**
 * The user's path: append the action, reconcile with the session that now holds it, then draw.
 *
 * The redraw follows the rebuild rather than preceding it, because the dismissal the user just made is what
 * both surfaces must draw, and it is on the session only after the append.
 *
 * The redraw is owed by a `finally`, the way `settlePanel` (`panel-settle.ts`) owes its own: the entry that
 * `append` reached the session with is on the branch whether or not the rebuild that follows survives, and a
 * screen still drawing a pin the session no longer holds is the pins-drawn-twice failure this path exists to
 * prevent. The throw propagates — the caller hears — but it never skips the draw. The rebuild cells are
 * derived from the same object the append reads, so the ledger, the append and the screen cannot be split
 * across two cell objects.
 */
export function appendUserAction(cells: UserCommitCells, action: UserAction): void {
  try {
    cells.append(action);
    rebuildSession(cells.live(), createRebuildCells(cells));
  } finally {
    cells.redraw();
  }
}
