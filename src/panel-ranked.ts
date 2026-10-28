/**
 * The order the panel draws pins in.
 *
 * The panel and the rail rank identically — `orderPins`, warning before action before info, newest first
 * within a level — and the panel must draw the order it *acts on*: `dispatchPanelKey` (`panel-input.ts`)
 * indexes this same array for `Enter` and `d`, so a bar on the third line has to sit on the third element
 * of the array the destructive key reads. That is the whole reason the ranking lives between the view and
 * the drawer rather than inside the drawer: a second reader of `getView().pins` gets insertion order, and
 * that is how `d` once came to dismiss the wrong pin.
 *
 * It was a memo once — keyed on the array's identity, held by one component. The key only ever hit on a
 * caller that asked twice with the *same* array, and there is no such caller: `commit`/`reconstruct` publish
 * a fresh array for every change to the view and none without one, so every real ask arrived with an
 * array the memo had not seen. It was a branch no product path could enter, and the one test that entered
 * it had to hand the memo its own output back. `orderPins` is a pure sort over a copy, so the memo bought
 * nothing a fresh sort does not already give: the same array, the same order. This is that sort, named, in
 * one place, with no state to keep coherent — and no owner to keep it coherent for.
 */
import { orderPins } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * The pins in draw order — `orderPins` over a copy, so the view's own array stays in insertion order.
 *
 * Called per frame, per key and per clamp. It is a sort each time, and the frames it costs are the ones
 * the panel was going to draw anyway: the frame cache still holds the frame itself, so a key that changed
 * nothing asks for no repaint and never reaches this.
 */
export function rankedPins(pins: readonly ViewPin[]): readonly ViewPin[] {
  return orderPins(pins);
}
