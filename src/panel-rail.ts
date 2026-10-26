import type { PanelDeps } from "./panel-deps.ts";
/**
 * The rail's install guard: the one cache between "the answer may have changed" and the expensive
 * `setExtensionWidget` call.
 *
 * pi's `setExtensionWidget` disposes the old component, builds a new one and re-renders every widget, so
 * reinstalling on every overlay frame re-wraps every pin to draw the strip that is already there. The
 * owner asks this object whether to draw — and tells it to forget the answer when it opens or closes a
 * panel — and it answers from the exact terms `PanelOwner.isVisible()` and `drawPins` read to make
 * that call: the width, the user's flag, and what the view draws. So the cache cannot hold an answer
 * the predicate has moved away from.
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

  /**
   * Draw the rail through `redraw` when the answer it would install is not the one already installed,
   * or forget the installed answer — whichever of the two `open` asks for.
   *
   * `columns` is the width `isVisible()` was measured at, passed in rather than re-read: the caller is
   * the frame that asked, and its measurement is the answer's subject. `open` is the caller's own
   * verdict on whether a panel is open at all: `false` on the two lifecycle edges that have just
   * destroyed the answer (an `open()` publishing a fresh record, a `close()` dropping it), where the
   * next frame must be compared against nothing, and `true` on every change that may have moved the
   * answer while the panel stayed open — a frame, a toggle, a pin, a dismissal.
   *
   * One method, not a `consider()`/`reset()` pair, because both operations belong to the same cache:
   * a caller could forget to reset and hold a `#key` for an answer that no longer exists — the rail
   * left standing down for a panel that had already been closed. A reopening has to *clear* the cache
   * rather than compare against it, and a frame has to compare and not clear: two verbs on one object
   * invite the caller to pick the wrong one, one verb with a flag cannot be picked wrongly.
   */
  consider(deps: PanelDeps, columns: number, redraw: () => void, open: boolean): void {
    if (!open) {
      this.#key = undefined;
      return;
    }
    const view = deps.getView();
    const key = `${columns}|${deps.isPanelShown()}|${railStamp(view.pins)}`;
    if (key === this.#key) return;
    this.#key = key;
    redraw();
  }
}
