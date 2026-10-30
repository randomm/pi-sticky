/**
 * The rows `panelPinRows` builds outside a frame, and the two figures it needs to build them honestly.
 *
 * `panelPinRows` takes the frame's figures explicitly — the tail's reserve and the columns between the gutters
 * — because the wrap is sized against a *row*: the reserve `pinRow` cuts to is `tailReserve`, which clamps at
 * the inner width, so a text column alone cannot say how many columns a row keeps. See that parameter's own doc
 * in `panel-rows.ts`. A test that asks for a pin's rows directly therefore still has to name a frame, and a
 * file that guessed these figures differently from the frame it then drew would be asserting on rows no drawer
 * ever cut. So they are derived here, once, from the same constants `panelTextColumns` and `buildPanelLines`
 * read — and the two are derived *together*, because an `inner` reconstructed from a reserve the caller did not
 * name is exactly the mismatch the explicit parameters exist to close.
 */
import { META_COLUMNS, META_SEPARATOR_COLUMNS } from "../src/panel-frame-geometry.ts";
import { widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { GUTTER_COLUMNS } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";

/**
 * A frame's two figures for one pin drawn at a text column of `textWidth`, aged at `now`.
 *
 * The reserve is measured on `pin`'s own whole tail — the figure `panelPinRows` itself falls back to for a
 * caller with no view, and `widestMetaColumns` is a property of a *view*, so a one-pin test has a one-pin view.
 * `inner` is then the exact inverse of `panelTextColumns` at that reserve: the text column, the reserve, its
 * separator, and the two gutters with their spaces.
 *
 * `at` returns a row-table argument list so a caller spreads it into `panelPinRows` and cannot reorder the two
 * figures — which is the whole reason they are positional in the first place.
 */
export function frameAt(pin: ViewPin, textWidth: number, style: PanelStyle, now: string) {
  const metaColumns = widestMetaColumns([pin], style.dim, now);
  return { metaColumns, inner: textWidth + metaColumns + META_SEPARATOR_COLUMNS + GUTTER_COLUMNS };
}

/**
 * The columns between the gutters of a frame whose text column is `textWidth` at the reserve's *floor*.
 *
 * For the tests that already speak in `META_COLUMNS` — the flat floor the frame never charges less than — rather
 * than in a measured reserve, so the `inner` they name matches the reserve they named. A test that measures the
 * reserve should take both figures from `frameAt` instead of reaching for this.
 */
export const innerAt = (textWidth: number): number =>
  textWidth + META_COLUMNS + META_SEPARATOR_COLUMNS + GUTTER_COLUMNS;
