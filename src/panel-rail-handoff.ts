/**
 * The rail's half of the panel's lifecycle: the one place that decides whether the rail has to be
 * re-installed, and the only owner of the minute the installed rail's ages were drawn at.
 *
 * `RailGuard` (`panel-rail.ts`) answers the question — is the answer it would install the one already
 * installed? — but the answer needs a fact the guard cannot see and the extension must not have to
 * remember: the instant the rail's rows were stamped at. pi keeps the component a factory returned until the
 * key is written again, so a rail nothing re-installs goes on printing the rows it cached, and the tick's
 * `redraw()` reaches this guard and nothing else on a terminal under the panel's boundary. A key that spelled
 * the view alone therefore answered "already installed" to the one frame whose whole job was to move `3m` to
 * `4m`.
 *
 * This module is the seam between the two: it holds the guard, records the minute the draw reports, and
 * hands the guard the four terms of its key. It is its own file rather than lines of `PanelOwner` because
 * the owner's job is the overlay — a record, an open call, a close — and the rail is the surface the owner
 * can *ask* for but never draws, which is the same division `PanelWiring.redrawRail` already draws.
 */
import { ageBucket } from "./panel-age.ts";
import type { PanelWiring } from "./panel-deps.ts";
import { RailGuard } from "./panel-rail.ts";

/**
 * The rail's install state, held for the owner that asks it to reconsider.
 *
 * One closure rather than two fields on the owner because the two are one decision: a guard consulted without
 * the recorded minute (or a minute recorded against no guard) is the split this file exists to close. Built
 * by `createRailHandoff` rather than as a class because the only reader — `PanelOwner` — holds exactly one per
 * owner, so a class here would declare a constructor no caller ever names while carrying the same two cells.
 */
export interface RailHandoff {
  /**
   * Report the minute the rail's rows were just stamped at, from the draw that stamped them.
   *
   * Paired with `redrawRail`: the guard asks for a rail through that member, and the draw it reaches names
   * the instant on its way in — before `drawPins` runs, because `drawPins` is reached from inside this
   * object's own decision and a record written after it returns is a minute the deciding call never saw.
   */
  drawn(iso: string): void;
  /**
   * Reconsider the rail. `open` is the caller's verdict on whether a panel is still open: `true` on a change
   * that may have moved the answer while the panel stayed (a frame, a toggle, a pin, a dismissal) — compare
   * and redraw only if it moved; `false` on the two lifecycle edges that just destroyed it (a fresh record,
   * a dropped one) — forget the answer, so the next frame compares against nothing. The answer, its cache
   * and both verdicts are the guard's: see `panel-rail.ts`.
   *
   * `columns` is the width the caller measured the visibility question at, passed in rather than re-read:
   * the caller is the frame that asked, and its measurement is the answer's subject.
   *
   * Where no draw has named a minute, the deps' own clock answers: the guard and the rail it would install
   * then read one clock rather than two, which is the difference between a key that moves once a minute and
   * one that moves every frame.
   */
  consider(wiring: PanelWiring, columns: number, open: boolean): void;
}

/** The rail's handoff of one owner: a guard of its own, and no minute recorded yet. */
export function createRailHandoff(): RailHandoff {
  /** The install guard: the one cache between a frame that changed nothing and a redraw. */
  const guard = new RailGuard();
  /**
   * The minute the rail was last installed for.
   *
   * Recorded rather than read from the clock at decision time because the instant belongs to the draw that
   * stamped the rows — the only caller that knows it is the extension's `drawRail`, through `drawn`. Kept
   * until the next draw rather than cleared after each: pi-tui asks the overlay's `visible()` on every render
   * cycle, and a bucket that fell back to the wall clock each frame would reopen the key every minute a rail
   * sat on screen.
   */
  let minute: number | undefined;

  function drawn(iso: string): void {
    minute = ageBucket(iso);
  }

  function consider(wiring: PanelWiring, columns: number, open: boolean): void {
    // A lifecycle edge (`open === false`) forgets both halves this object holds, and does it before the guard
    // is asked: a frame that compared the rail against no installed answer while still holding the previous
    // minute would be one comparison away from installing nothing. They are one edge, so they go together —
    // two verbs here would be two calls the owner could get half of.
    if (!open) minute = undefined;
    guard.consider(
      wiring.deps,
      columns,
      wiring.redrawRail,
      open,
      minute ?? ageBucket(wiring.deps.now()),
    );
  }

  return { drawn, consider };
}
