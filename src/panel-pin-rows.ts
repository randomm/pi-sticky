/**
 * The rows one pin's text turns into, and the one question that decides how many of them there are.
 *
 * A pin is either **collapsed** — a `compact` pin held to the single row the panel's own promise about
 * density depends on — or **expanded**, which is the same pin drawn as though the flag were not set: every
 * row its text wraps to, at the frame's own arithmetic. This module is the *branch* — which wrap each of the
 * two states gets — and the decision cannot live in the drawer: the window scrolls, the bar sits and
 * `d`/`Enter` index *this* row count, so rows the table did not count are rows the keys are out on, in either
 * direction.
 *
 * The other two parts live elsewhere and both arrive as arguments: `expands()` (`panel-rows.ts`) is the per-pin
 * rule that says *this* pin is the expanded one, and the frame is the input that chose it (`expandedPinOf` /
 * `ExpandedAt`, `panel-expand.ts`). This function reads no cell and holds no rule of its own; the answer lands
 * as one boolean beside the pin it is building. The peek, the rail and every caller outside a frame has no bar
 * to name and must be handed the collapsed rows whatever the frame's bar is doing — which is why the boolean is
 * an argument and not a lookup, and why `compact` alone can never reach this branch.
 */
import { foldBreaks } from "./escape.ts";
import { wrapAtDrawnWidth } from "./panel-wrap.ts";

/**
 * The rows `pin`'s text owns: one cut line for a collapsed `compact` pin, the whole wrap for every other
 * pin and for a `compact` pin the frame has expanded.
 *
 * Collapsing happens *here*, in the table, rather than as a cut the drawer makes afterwards: a pin that
 * wrapped into four rows and was then trimmed would leave three rows counted for a pin that shows one.
 * `foldBreaks` folds what breaks the model put in (the fold `toOneLine` wraps, read from its owner rather
 * than through `render.ts`, one of this module's callers) and the drawer's `fitLine` spends the ellipsis on
 * the tail of it.
 *
 * How wide a wrap packs a line, and why it pays the marker cell twice, is `panel-wrap.ts`'s account —
 * `wrapAtDrawnWidth` is the one place that answers the drawer's question back to it, and this function only
 * chooses which of its two answers a pin gets.
 *
 * `plain` is the pin's text already stripped of every escape sequence: the caller runs that pass at the
 * boundary that puts a model's words into a drawn row, so the wrap and the collapsed line are both built
 * from text that can no longer carry one.
 */
export function pinTextRows(
  plain: string,
  compact: boolean,
  expanded: boolean,
  textWidth: number,
  metaColumns: number,
  inner: number,
): string[] {
  return expanded || !compact
    ? wrapAtDrawnWidth(plain, textWidth, metaColumns, inner)
    : [foldBreaks(plain)];
}
