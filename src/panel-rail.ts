import type { PanelDeps } from "./panel-deps.ts";
import { railStamp } from "./panel-geometry.ts";
import type { PanelMode } from "./panel-mode.ts";
/**
 * The rail's install guard: the one cache between "the answer may have changed" and the expensive
 * `setExtensionWidget` call.
 *
 * pi's `setExtensionWidget` disposes the old component, builds a new one and re-renders every widget, so
 * reinstalling on every overlay frame re-wraps every pin to draw the strip that is already there. The owner
 * asks this object whether to draw — and tells it to forget the answer when it opens or closes a panel — and
 * it answers from the exact terms the owner uses to decide who owns the pins: the width, the owner's own
 * visibility verdict (`PanelOwner.isVisible`), which frame the panel would draw for the pins it holds, what
 * the view draws, and the minute the ages in that view are drawn at. So the cache cannot hold an answer the
 * predicate has moved away from, and the two surfaces are never handed two answers to the one question.
 *
 * The ownership term is the **owner's** answer rather than a reading of the mode cell: a failed open has
 * forgotten its record and still leaves the cell saying *shown*, and a guard that re-derived ownership from
 * the cell would stand the rail down for a panel that is not on screen — the pins on neither surface. One
 * question, one answerer.
 *
 * The **frame** is a term beside that verdict rather than folded into it, because the verdict alone cannot
 * see every move that hands the pins back — see `#frame` for the one case that proves it.
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

/**
 * The frame term of the guard's key: the cell's own name for the two frames that own the pins, and `"none"`
 * for the frame in which the rail owes the user its strip. Not exported: `#frame` below is its only producer
 * and the key is a string, so nothing outside this class can name one or be checked against one.
 */
type RailFrame = Extract<PanelMode, "open" | "peek"> | "none";

/**
 * The deps the rail path reads, narrowed from `PanelDeps` on purpose so a wider reach has to be a change
 * here: the pins it stamps and the frame it would draw (`RailGuard.consider`), and the clock the handoff
 * falls back to when no draw has reported a minute (`RailWiring`, `panel-rail-handoff.ts`).
 */
export type RailDeps = Pick<PanelDeps, "getView" | "panelMode" | "now">;

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
    // The members the key is spelled from, and nothing more (`RailDeps`): a wider parameter would let this
    // class reach for a fourth member without the caller having to know it exists.
    deps: RailDeps,
    columns: number,
    redraw: () => void,
    open: boolean,
    ageBucket: number,
    ownsPins: () => boolean,
  ): void {
    if (this.#settled(open)) return;
    const view = deps.getView();
    // The verdict is read once, into a local, so the two terms of the key that speak about the same question
    // are answered by one call rather than by two that could disagree.
    const owns = ownsPins();
    // The frame is a term of the key beside the ownership verdict, and not folded into it — the case that
    // proves it is in `#frame`: a demote can hand the pins back without moving `ownsPins()` at all.
    const key = `${columns}|${owns}|${this.#frame(deps)}|${railStamp(view.pins)}|${ageBucket}`;
    if (this.#same(key)) return;
    this.#install(key, redraw);
  }

  /**
   * The frame name the key spells: the cell's own, or the rail's strip for a panel that draws nothing.
   *
   * Read from the cell **alone**, deliberately: it is a term beside the ownership verdict, not a refinement of
   * it, and folding the verdict in here would collapse two distinct answers into one string. The case the term
   * exists for is a demote under an emptied view — the last pin dismissed while the frame was open, then
   * `Esc`: `isVisible()` answers false for want of pins both before and after, so a key that spelled only the
   * verdict would answer "already installed" to the one frame whose job was to put the rail back.
   *
   * Exhaustive `switch`, with no `default`: a fourth `PanelMode` would fail to compile here rather than be
   * silently stamped `"none"` and never redrawn for. The two frames the cell names are not collapsed into a
   * ternary either — a cell between them is a *resting* panel, and a name that called both an `open` would
   * let a hide-to-peek and a peek-to-hidden move the key identically.
   */
  #frame(deps: RailDeps): RailFrame {
    switch (deps.panelMode().mode()) {
      case "open":
        return "open";
      case "peek":
        return "peek";
      case "hidden":
        return "none";
    }
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
