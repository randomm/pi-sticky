/**
 * Which pin, if any, a frame draws expanded — the one predicate the whole panel asks.
 *
 * A `compact` pin is held to one cut row by the row table (`panelPinRows`, `panel-rows.ts`), and the one case
 * in which it is not is the case the user is looking at: the pin the bar rests on, in a frame that takes keys.
 * Nothing else expands an entry, because the row count is what the window scrolls, what the bar sits on and
 * what `d`/`Enter` index — an entry that grew anywhere other than under the bar would put the keys out on rows
 * nobody can see.
 *
 * Before this module the rule was spelled three times: the layout resolved it from `selection` against the
 * drawn focus, the frame key re-derived it from the mode, the gate, the focus and the pins, and the row table
 * asked a third question of each pin. Three spellings of one rule is how a frame came to be memorised around
 * the table one of them had built and handed back for the state another would have drawn. So there is now one
 * predicate (`expandedPinOf`), called once per frame by `drawFrame` (`panel-frame-draw.ts`), and the value it
 * answers travels to every reader: the cache's key term, the open frame's table, and the table's own per-pin
 * answer (`ExpandedAt`, `panel-rows.ts`).
 *
 * The predicate speaks the **selection** coordinate — a pin's index in the flattened drawn order
 * (`panelSections`'s `flat`) — because that is the coordinate the bar, `d`, `Enter`, the scroll window and the
 * table's row owners already speak. Storing a number rather than a `ViewPin` keeps the frame's key, the layout
 * and the drawer naming one fact in one shape.
 */
import type { PanelMode } from "./panel-mode.ts";
import type { ViewPin } from "./types.ts";

/**
 * The pin a frame expands, in the **selection** coordinate, or `undefined` when it expands nothing.
 *
 * Five inputs, one answer, and every one of them read from the frame the caller is about to draw:
 *
 * - `mode`/`keys` — the two halves of the cell's answer (`panel-mode.ts`). The peek draws no bar, so the
 *   frame's mode gates; `keys` is the gate `dispatchPanelKey` obeys, so under `PI_STICKY_PANEL=open`, where
 *   the cell keeps answering `open` after the earned open ended, a frame that advertises no keys expands
 *   nothing — a pin whose digits no keystroke reaches has no reason to show them.
 * - `focused` — the component's own flag: an unfocused panel has a selection and no bar the user is looking at.
 * - `pins[selection]` — the pin the bar, `d` and `Enter` address, and the only pin whose `compact` flag is
 *   read. A selection past the end of the array names no pin, so an empty or shrunk view expands nothing.
 */
export function expandedPinOf(
  pins: readonly ViewPin[],
  mode: PanelMode,
  keys: boolean,
  focused: boolean,
  selection: number,
): number | undefined {
  if (mode !== "open" || !keys || !focused) return undefined;
  return pins[selection]?.compact === true ? selection : undefined;
}

/**
 * The frame's expansion as the row table reads it: which pin the frame chose, and whether it chose one at all.
 *
 * An argument and not a cell, because the table is pure and shared: the peek, the rail and every caller that
 * counts rows outside a frame has no bar to name and passes nothing (`undefined`). It may never be reached by a
 * caller that simply forgot to ask — a caller that passes no signal gets the collapsed table byte-for-byte,
 * which is the table drawn before expansion existed, and `test/panel-compact-expand-rows.test.ts` holds it to
 * that.
 */
export interface ExpandedAt {
  /**
   * Whether `pin` — the very object this call is building rows for — is the pin the frame chose to expand.
   *
   * A predicate rather than an index because the table is built one pin at a time and has no coordinate to
   * compare an index against: the layout stamps each row with the owner it had already named, while the peek,
   * which draws the best-ranked pin with no bar at all, can answer only "never".
   */
  isSelected: (pin: ViewPin) => boolean;
  /**
   * Whether the frame made the choice at all.
   *
   * The frame hands a chosen pin and nothing else: an unfocused panel, a peek or a rail never names one, so
   * both halves of the rule are the frame's answer and neither is a fact about the pin handed to the table.
   */
  focused: boolean;
}
