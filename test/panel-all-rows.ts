/**
 * The rows of *every* pin in a list, built outside a frame — the caller these rows have in `src/` does not
 * have, because a frame builds its table one section at a time through `panelFrameTable`.
 *
 * `panelPinRows` (`src/panel-rows.ts`) is the authority on what one pin contributes; this is the walk over a
 * whole list that a row-counting test wants, and the two defaults the src-side caller never uses: the tail's
 * reserve, measured on the pin alone when the caller names none, and the columns between the gutters,
 * reconstructed from `panelTextColumns`' own subtraction at the reserve's *floor* when the caller names no
 * inner width. Naming a floor rather than a measured reserve can only under-count the options rows, never
 * count them against columns the drawer never had.
 *
 * This table takes **no** expansion signal: it is the caller that counts rows outside a frame, so every
 * compact pin it builds owns its one collapsed row whatever the bar of any frame would have done.
 */
import {
  META_COLUMNS,
  META_SEPARATOR_COLUMNS,
  widestMetaColumns,
} from "../src/panel-frame-geometry.ts";
import type { PanelRow } from "../src/panel-row.ts";
import { panelPinRows } from "../src/panel-rows.ts";
import { GUTTER_COLUMNS } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";

/** Rows of every pin in `pins`, which must be the panel's *drawn* order (`panelSections`'s `flat`). */
export function panelAllRows(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
  metaColumns?: number,
  inner?: number,
  now: string = new Date().toISOString(),
): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const pin of pins) {
    // Each figure defaults on its own. Name `inner` alone and the reserve is measured from this pin alone;
    // name `metaColumns` alone and `betweenGutters` is reconstructed below at that reserve's floor. A caller
    // that is laying a frame out names both and gets neither default — which is why frame callers do.
    const reserve = metaColumns ?? widestMetaColumns([pin], style.dim, now);
    const betweenGutters =
      inner ?? textWidth + META_COLUMNS + META_SEPARATOR_COLUMNS + GUTTER_COLUMNS;
    rows.push(...panelPinRows(pin, textWidth, style, reserve, betweenGutters, now, undefined));
  }
  return rows;
}
