/**
 * The owner of one row of the panel's frame: the row itself and the pin it belongs to.
 *
 * The pair is its own module because three callers need the *shape* and none of them may import the layout
 * that builds it: the layout and the window rule (`panelWindowOffset`, `panel-frame-layout.ts`) both read it,
 * and the drawer (`panel-lines.ts`) reads the rows out of a table it was handed. A type that lived only with
 * the builder would make the drawer import the layout for one field list — the tangle `panel-row.ts` and
 * `panel-tail.ts` were each carved out of, for the same reason.
 *
 * Two coordinates meet on this one entry and neither is redundant. `pin` is the **selection** coordinate —
 * the pin's position in the flattened drawn order (`panelSections`'s `flat`), which is what the keys, `d`,
 * `Enter` and the bar's clamp index. The entry's *position in the table* is the **row** coordinate — what the
 * window scrolls by and what the bar is drawn on. A heading owns a row and no pin, and a pin that wraps owns
 * several rows and one pin, so the two come apart and only this pair holds both.
 */
import type { PanelRow } from "./panel-row.ts";
import type { PanelSection } from "./panel-sections.ts";

/**
 * The pin a row of the table belongs to, or `null` for a row that belongs to no pin: the heading over a
 * level section. `null` rather than an out-of-range sentinel, because "no pin" is what a heading is and an
 * index of `-1` would be a pin number one before the first — which `panelRowStartOf` reads as "no such pin",
 * and a heading must not be answerable at all.
 */
export type RowOwner = number | null;

/** One drawn row together with the *pin* that owns it (or nothing, for a heading), as the window needs it. */
export interface PanelOwned {
  row: PanelRow;
  /** The pin this row belongs to, or `null` when the row is a section heading. */
  pin: RowOwner;
}

/**
 * One frame's rows, the row the selection starts at, the rows the frame needs, and the sections the rows
 * were laid out from. Returned by `panelLayoutSections`, the one place the pins are wrapped for a frame.
 */
export interface PanelLayout {
  owned: PanelOwned[];
  /** Table position of the selected pin's first row, or -1 when the selection names no pin. */
  start: number;
  height: number;
  /**
   * The very `PanelSections.order` the caller handed in, carried back out so the drawer prints its frame's
   * counts off the grouping the rows were built from rather than asking the pins again — a second grouping
   * is a second answer to the same question, and one value in and back out is what makes a title that
   * disagrees with its headings unrepresentable rather than merely unlikely.
   */
  sections: readonly PanelSection[];
}
