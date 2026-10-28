import type { PanelDeps } from "./panel-deps.ts";
import { railStamp } from "./panel-geometry.ts";
/**
 * The rail's install guard: the one cache between "the answer may have changed" and the expensive
 * `setExtensionWidget` call.
 *
 * pi's `setExtensionWidget` disposes the old component, builds a new one and re-renders every widget, so
 * reinstalling on every overlay frame re-wraps every pin to draw the strip that is already there. The owner
 * asks this object whether to draw — and tells it to forget the answer when it opens or closes a panel — and
 * it answers from the exact terms the owner uses to decide who owns the pins: the width, the owner's own
 * visibility verdict (`PanelOwner.isVisible`), what the view draws, and the minute the ages in that view are
 * drawn at. So the cache cannot hold an answer the predicate has moved away from, and the two surfaces are
 * never handed two answers to the one question.
 *
 * The ownership term is the **owner's** answer rather than a reading of the mode cell: a failed open has
 * forgotten its record and still leaves the cell saying *shown*, and a guard that re-derived ownership from
 * the cell would stand the rail down for a panel that is not on screen — the pins on neither surface. One
 * question, one answerer.
 *
 * The view is in the key by *what it draws* rather than by reference (`railStamp`, in
 * `panel-geometry.ts`): `RailComponent` snapshots the view it was built with, so a same-count change to
 * which pins the rail shows — a dismissal immediately followed by a pin — or to a pin's text has to reopen
 * the key, and a re-published but identical view, which `commit` and `reconstruct` do on every change, must
 * not.
 *
 * The minute is in the key because the rail is a component pi keeps, not one it re-asks. `RailComponent`
 * caches its rows by width, and a rail that is never re-installed never renders again: on a terminal under
 * the panel's boundary the tick's `redraw()` reaches this guard and nothing else, so a key that spelled
 * only the view would answer "already installed" to the one frame whose whole job was to move `3m` to `4m`.
 * The owner hands the key the bucket it read its own view at, so the age in the key is the age the rows
 * print — and a minute that did not move costs a comparison, exactly as a frame that changed nothing does.
 */

export class RailGuard {
  /** The last answer the rail was installed for, or `undefined` when nothing is installed. */
  #key: string | undefined;

  /**
   * Draw the rail through `redraw` when the answer it would install is not the one already installed,
   * or forget the installed answer — whichever of the two `open` asks for.
   *
   * `redraw` is **bound** by its caller: this method invokes it detached, so a bare method reference
   * arrives with no receiver and a `this`-reading implementation throws — a failure the guard cannot
   * report, because a throw here escapes the frame or the refresh that asked for the draw.
   *
   * `columns` is the width `isVisible()` was measured at, passed in rather than re-read: the caller is
   * the frame that asked, and its measurement is the answer's subject. `ownsPins` is the **owner's** own
   * verdict on whether the panel holds the pins right now (`PanelOwner.isVisible`): a peek stands the rail
   * down exactly as an open panel does, and a failed open does not. `ageBucket` is the minute that caller
   * aged its view at, for the reason the frame cache carries it: two calls that read the clock twice could
   * disagree about the age of a view they agreed about in every other respect. `open` is the
   * caller's own verdict on whether a panel is open at all: `false` on the two lifecycle edges that have
   * just destroyed the answer (an `open()` publishing a fresh record, a `close()` dropping it), where the
   * next frame must be compared against nothing, and `true` on every change that may have moved the answer
   * while the panel stayed open — a frame, a toggle, a pin, a dismissal.
   *
   * One method, not a `consider()`/`reset()` pair, because both operations belong to the same cache:
   * a caller could forget to reset and hold a `#key` for an answer that no longer exists — the rail
   * left standing down for a panel that had already been closed. A reopening has to *clear* the cache
   * rather than compare against it, and a frame has to compare and not clear: two verbs on one object
   * invite the caller to pick the wrong one, one verb with a flag cannot be picked wrongly.
   */
  consider(
    deps: PanelDeps,
    columns: number,
    redraw: () => void,
    open: boolean,
    ageBucket: number,
    ownsPins: () => boolean,
  ): void {
    if (this.#settled(open)) return;
    const view = deps.getView();
    const key = `${columns}|${ownsPins()}|${railStamp(view.pins)}|${ageBucket}`;
    if (this.#same(key)) return;
    this.#install(key, redraw);
  }

  /**
   * Record the answer and draw for it, in that order: the mark comes first so a callback that throws
   * leaves a key the next frame compares against rather than an answer the guard forgot it ever made.
   */
  #install(key: string, redraw: () => void): void {
    this.#key = key;
    redraw();
  }

  /**
   * The caller's verdict on whether a panel is still open, applied and answered as *done* or *not done*:
   * `false` is one of the two lifecycle edges, and forgetting the installed answer is all it does — the
   * caller that destroyed the record is not asking for a rail, so there is nothing left to consider.
   * `true` means the answer may have moved and the caller's question still has to be answered.
   */
  #settled(open: boolean): boolean {
    if (open) return false;
    this.#key = undefined;
    return true;
  }

  /** Whether the guard's installed answer is the one `key` spells — a fresh rail is compared against nothing. */
  #same(key: string): boolean {
    return this.#key !== undefined && this.#key === key;
  }
}
