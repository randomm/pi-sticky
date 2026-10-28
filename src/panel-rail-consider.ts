/**
 * The owner's one seam to the rail: the pair the rail guard is consulted through, and the pair's rules.
 *
 * `RailHandoff` (`panel-rail-handoff.ts`) holds the guard and the minute the installed rail's rows were
 * stamped at; this module is the owner's half of speaking to it. Two rules it owns, both of which the raw
 * handoff invites a caller to break:
 *
 * - One verb, not two fields. The guard is consulted *and* the minute is passed to it in the same call, so a
 *   caller cannot ask for a verdict that was keyed on a minute the owner meant to move.
 * - A lifecycle edge (`open === false`) forgets both halves at once, which is what an `open()` publishing a
 *   fresh record or a `close()` dropping one owes the next frame: nothing to compare against.
 *
 * What the guard is asked about is read at call time and what it is handed is not: `columns` comes from the
 * width this instance's terminal holder was last told (see `panel-width.ts`) and `ownsPins` from the *owner's*
 * `isVisible()` rather than the mode cell — a record the owner has forgotten, as a failed open leaves it, is
 * not a panel the rail should stand down for. Both are cells because both answers move. `wiring` is a plain
 * field: the owner builds one for its life and never replaces it, and `RailHandoff.consider` takes the
 * dependencies as a value, so a read-at-call-time thunk here would advertise a second answer it cannot give.
 * See `panel-rail.ts` for why the guard trusts the owner.
 */
import type { PanelWiring } from "./panel-deps.ts";
import type { RailHandoff } from "./panel-rail-handoff.ts";

/** The owner's calls into the rail's handoff, with both verdicts read from its own cells. */
export interface RailConsider {
  /**
   * Ask the guard whether the rail it would install is the one already installed, and let it redraw when it
   * is not. `open` is the caller's verdict on whether a panel is still open: `true` on a change that may have
   * moved the answer while the panel stayed (a frame, a toggle, a pin, a dismissal), `false` on the two
   * lifecycle edges that just destroyed it — which forget the answer.
   */
  consider(open: boolean): void;
  /** Report the minute the rail's rows were just stamped at, from the draw that stamped them. */
  drawn(iso: string): void;
}

/** The two verdicts, read from the owner's cells at the moment the answer is decided. */
export interface RailConsiderCells {
  /** The deps the guard spells its key from — the owner's own, held for its whole life. */
  wiring: PanelWiring;
  /** The width the visibility question is measured at — the frame that asked is the one that measured it. */
  columns(): number;
  /** The owner's own visibility verdict, not a re-derivation of it from the mode cell. */
  ownsPins(): boolean;
}

/** The rail's half of one owner, over the handoff the owner holds. */
export function createRailConsider(handoff: RailHandoff, cells: RailConsiderCells): RailConsider {
  return {
    consider(open: boolean): void {
      handoff.consider(cells.wiring, cells.columns(), open, cells.ownsPins);
    },
    drawn: (iso) => handoff.drawn(iso),
  };
}
