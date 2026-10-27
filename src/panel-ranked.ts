/**
 * The order the panel draws pins in, memoized on the view it was ranked from.
 *
 * The panel and the rail rank identically — `orderPins`, warning before action before info, newest first
 * within a level — and the panel must draw the order it *acts on*: `dispatchPanelKey` (`panel-input.ts`)
 * indexes this same array for `Enter` and `d`, so a bar on the third line has to sit on the third element
 * of the array the destructive key reads. That is the whole reason the ranking lives between the view and
 * the drawer rather than inside the drawer: a second reader of `getView().pins` gets insertion order, and
 * that is how `d` once came to dismiss the wrong pin.
 *
 * It is a module of its own rather than a private method because it is process state the moment it is a
 * module-level `let` — two panels over two views each invalidating the other's order — and a class makes
 * "one memo, one owner" the type rather than a comment. The component holds one; nothing else can.
 */
import { orderPins } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * The ranked view of one component.
 *
 * `get` is called per frame, per key and per clamp, so the memo is what keeps a view that has not moved
 * from costing a sort each time: `commit`/`reconstruct` publish a fresh array for every change and none
 * without one, and array identity is therefore a sound key.
 */
export class RankedPins {
  #source: readonly ViewPin[] | undefined;
  #ranked: readonly ViewPin[] | undefined;

  /** The pins in draw order — `orderPins` over a copy, so the view's own array stays in insertion order. */
  get(pins: readonly ViewPin[]): readonly ViewPin[] {
    if (this.#source !== pins || this.#ranked === undefined) {
      this.#source = pins;
      this.#ranked = orderPins(pins);
    }
    return this.#ranked;
  }

  /**
   * Forget the memo. The component does not call it — a view that has not moved has not moved — and it
   * exists for the one caller that replaces the view behind the component's back, which is a test host
   * handing over a different `PinView` without publishing a new array.
   */
  invalidate(): void {
    this.#source = undefined;
    this.#ranked = undefined;
  }
}
