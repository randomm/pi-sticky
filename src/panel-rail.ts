import type { PanelDeps } from "./panel-deps.ts";
/**
 * The rail's install guard: the one cache between "the answer may have changed" and the expensive
 * `setExtensionWidget` call.
 *
 * pi's `setExtensionWidget` disposes the old component, builds a new one and re-renders every widget, so
 * reinstalling on every overlay frame re-wraps every pin to draw the strip that is already there. The
 * owner asks this object whether to draw, and it answers from the exact terms `PanelOwner.isVisible()`
 * and `drawPins` read to make that call — the width, the user's flag, and what the view draws — so the
 * cache cannot hold an answer the predicate has moved away from.
 *
 * The view is in the key by *what it draws* rather than by reference (`railStamp`, in
 * `panel-geometry.ts`): `RailComponent` snapshots the view it was built with, so a same-count change to
 * which pins the rail shows — a dismissal immediately followed by a pin — or to a pin's text has to
 * reopen the key, and a re-published but identical view, which `commit` and `reconstruct` do on every
 * change, must not.
 */
import { railStamp } from "./panel-geometry.ts";

export class RailGuard {
  /** The last answer the rail was installed for, or `undefined` when nothing is installed. */
  #key: string | undefined;

  /** Forget the installed answer, so the next `consider()` draws whatever the state now says. */
  reset(): void {
    this.#key = undefined;
  }

  /**
   * Draw the rail through `redraw`, unless the answer it would install is the one already installed.
   *
   * `columns` is the width `isVisible()` was measured at, passed in rather than re-read: the caller is
   * the frame that asked, and its measurement is the answer's subject.
   */
  consider(deps: PanelDeps, columns: number, redraw: () => void): void {
    const view = deps.getView();
    const key = `${columns}|${deps.isPanelShown()}|${railStamp(view.pins)}`;
    if (key === this.#key) return;
    this.#key = key;
    redraw();
  }
}
