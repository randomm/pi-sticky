/**
 * The order the panel draws its pins in, and the one place that order is worked out.
 *
 * The rail, the model-facing listing and `/pins` have always ranked through `orderPins`
 * (`render.ts`): warning, then action, then info; unreplied before replied; newest id first. The panel
 * drew `getView().pins` as the state holds it — insertion order — so the one pin the user came to read
 * could sit eleventh of twelve while the rail put it first. Same pins, two surfaces, two orders: the
 * bar, `d` and `Enter` addressed the unranked array, so what the user selected was not what the ranking
 * promised.
 *
 * So the ranking lives here, in front of the drawer *and* in front of the keys: `PanelComponent` asks
 * this for the array it draws, selects, scrolls, dismisses and replies from, and one ranking serves all
 * five. Ranking inside the drawer instead would leave `panel-input.ts` indexing the unranked array and
 * `d` acting on the wrong pin.
 *
 * `orderPins` copies and sorts, which on a stable view is a fresh array every frame, so `rankPins`
 * memoizes on the identity of the array it was handed. `commit` and `reconstruct` publish a new array
 * for every change and none without one, which is why identity is enough to know whether the order has
 * to be worked out again — and it is the same test `PanelComponent`'s frame cache keys on, so the panel
 * pays one sort per view and not one per frame.
 */
import { orderPins } from "./render.ts";
import type { ViewPin } from "./types.ts";

/** The last array ranked, and the order it came out in — one pair, so neither can be stale alone. */
interface RankedView {
  source: readonly ViewPin[];
  ranked: readonly ViewPin[];
}

/**
 * The view's pins in the order the panel draws them, memoized on the array it was handed.
 *
 * One cell: a panel draws one view at a time, and a view that has been swapped out is never asked
 * about again.
 */
let last: RankedView | undefined;

export function rankPins(pins: readonly ViewPin[]): readonly ViewPin[] {
  if (last !== undefined && last.source === pins) return last.ranked;
  const ranked = orderPins(pins);
  last = { source: pins, ranked };
  return ranked;
}
