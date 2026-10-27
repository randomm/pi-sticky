/**
 * The tails a pin's rows carry: the id on the first row, the age on the second.
 *
 * The panel lays a pin's text out *before* it can say how many rows it owns, and the operator's layout for
 * those rows (pins v2-2) puts the age on the second row's meta slot — or beside the id on the first when the
 * pin owns one row and the pair fits. So the tail cannot be a constant, and it cannot be spelled twice:
 * `panelPinRows` (`panel-rows.ts`) prints these strings and `widestMetaColumns` (`panel-frame-geometry.ts`)
 * measures the same ones for the columns the text gives up. Two owners of one format is how a frame came to
 * charge the text for a tail it never drew and cut the `#id` out of the row, so this module is the only one
 * that decides which row gets which — and every string it hands back is one `panel-tail.ts` stamped.
 *
 * It is a module of its own rather than a function in `panel-rows.ts` for the reason `panel-tail.ts` is one:
 * the row table and the frame's geometry both need it, and while each owned half of that arithmetic the pair
 * formed an import cycle whose constants were read before their own module finished evaluating. The tails
 * themselves are stamped in `panel-tail.ts`, the root of the graph, so this file can be read by both halves
 * of that pair without either becoming the other's dependency.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

import { ageStamp, fullStamp, idStamp } from "./panel-tail.ts";
import type { MetaDimmer } from "./panel-tail.ts";
import type { ViewPin } from "./types.ts";

/** One pin's tails, as the row table prints them and the reserve measures them. */
export interface PinTails {
  /**
   * The first row's tail: the id alone when the age has a row of its own, or `#<id> <age>` when the pin owns
   * a single row and the pair fits its column. Never empty — an empty `meta` is the builder's signal for a
   * continuation row, and a continuation row is not one that has said which pin it belongs to.
   */
  first: string;
  /** The second row's tail when the age lives there; `undefined` when it lives beside the id. */
  second: string | undefined;
}

/**
 * Whether `pair` fits the one row that would have to carry it whole.
 *
 * The figure is the drawn width of the pair against the columns a first row really has for a tail: the
 * reserve the frame was charged, which is what `drawnTail` (`panel-tail.ts`) pads the tail into and cuts it
 * to. So the pair fits exactly when it fits that reserve — measured on the string with its escape sequences,
 * not its bytes, because a theme's `dim` can wrap the tail in visible bytes and a pair measured on its
 * length would be accepted into a row that then cut it.
 *
 * The reserve is passed in rather than re-derived here because it is the *view's* figure
 * (`widestMetaColumns`): a frame holding one twenty-digit id pays twenty columns of tail, and judging a fit
 * against the floor instead would put a pair on a row whose tail had already been cut to the wider figure —
 * the `#id` disappearing through the very door the reserve was meant to close.
 */
function pairFits(pair: string, metaColumns: number): boolean {
  return visibleWidth(pair) <= metaColumns;
}

/**
 * The tails of `pin`'s rows at `now`.
 *
 * The age goes on the second row — the slot the row table guarantees is otherwise empty — and comes up beside
 * the id only for a pin that owns one row *and* whose `#<id> <age>` fits. Never the id, always the age: a
 * pair that does not fit leaves the id on the first row and moves the age down, which is the shape a two-row
 * pin has anyway.
 */
export function pinTails(
  pin: ViewPin,
  rows: number,
  metaColumns: number,
  now: string,
  dim: MetaDimmer,
): PinTails {
  const bare = idStamp(pin, dim);
  const pair = fullStamp(pin, dim, now);
  if (rows > 1 || !pairFits(pair, metaColumns))
    return { first: bare, second: ageStamp(pin, dim, now) };
  return { first: pair, second: undefined };
}
