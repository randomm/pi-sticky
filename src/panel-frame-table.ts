/**
 * The assembly of one frame's row table: every section's heading row, then the rows of its pins, each row
 * tagged with the pin it belongs to.
 *
 * `panelLayoutSections` (`panel-frame-layout.ts`) owns the frame's *height* and the window's start; this module
 * owns the walk that builds the rows those two are counted from. The split is the two questions the layout
 * already held apart: which rows exist, and how tall the box around them is. `panel-frame-layout.ts` hands
 * `panelOwnedRows` the figures both halves need — the text column, the heading column, the reserve and the
 * inner width — so the wrap of a pin and the height counted from it stay one pass's two answers.
 *
 * Two rules the walk obeys:
 *
 * - **A heading owns a row and no slot.** The pin tags are numbered over the flattened pins alone, so adding a
 *   heading row never moves the index the bar, `d` and `Enter` address, while the row count the window scrolls
 *   by does include it. That is why headings are inserted *after* a section's pin rows are built.
 * - **The expansion is handed in, never asked here.** The pin whose entry grows arrives as a `ViewPin` the
 *   frame chose (`expandedPinOf`, `panel-expand.ts`) or as nothing; this walk compares its own pins against
 *   that one by reference, so it cannot grow an entry the frame did not choose.
 */
import type { ExpandedAt } from "./panel-expand.ts";
import type { PanelOwned } from "./panel-row-owner.ts";
import { panelPinRows } from "./panel-rows.ts";
import { headingCell, headingRow } from "./panel-section-headings.ts";
import { hasHeadings } from "./panel-sections.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * A pin's rows, in order, each tagged with the *position* `offset` numbers it at — the owner stamped on the
 * row as it is built, which is the only way the question stays answerable. `offset` is where the section
 * starts in the flattened drawn order, so the tag is the index the selection, the bar and the keys use
 * rather than one each section numbers from zero and someone has to translate.
 */
function panelPinRowOwners(
  pins: readonly ViewPin[],
  textWidth: number,
  style: PanelStyle,
  now: string,
  metaColumns: number,
  offset: number,
  inner: number,
  /** The pin the frame chose to expand, or `undefined` when it chose none. */
  selected: ViewPin | undefined,
): PanelOwned[] {
  // The expansion the table is built under, spelled once for the whole walk: the frame named one pin or none,
  // so the signal is the same object for every pin here and no pin answers a question of its own.
  const expanded: ExpandedAt = {
    // Compared by reference: this walk numbers the very pins the frame read its choice from, so the two cannot
    // disagree about which entry grows.
    isSelected: (candidate) => candidate === selected,
    // A chosen pin *is* the expansion — the gate lives in `expandedPinOf`, which only ever names a pin of a
    // frame that is open, takes keys and holds the keyboard.
    focused: selected !== undefined,
  };
  const owned: PanelOwned[] = [];
  for (const [index, pin] of pins.entries()) {
    for (const row of panelPinRows(pin, textWidth, style, metaColumns, inner, now, expanded))
      owned.push({ row, pin: offset + index });
  }
  return owned;
}

/**
 * The whole table: every section's heading row followed by the rows of its pins, each row tagged by the pin
 * it belongs to and a heading tagged by none.
 *
 * Headings are inserted between the sections *after* their pin rows are built, because a heading owns a row
 * and not a slot: the pin tags are numbered over the flattened pins alone, so adding a heading row never
 * moves the index the bar, `d` and `Enter` address, while the row count the window scrolls by does include
 * it. A view with **nothing to head** takes the shortcut at the top and is built as one run of pins, which is
 * what keeps a one-panel frame byte-for-byte what it was before sections existed (operator resolution 1).
 */
export function panelOwnedRows(
  sections: PanelSections,
  textWidth: number,
  headingWidth: number,
  style: PanelStyle,
  now: string,
  metaColumns: number,
  inner: number,
  /** The pin the frame chose to expand; `undefined` keeps every compact pin at its one cut row. */
  selected: ViewPin | undefined,
): PanelOwned[] {
  if (!hasHeadings(sections.order)) {
    return panelPinRowOwners(sections.flat, textWidth, style, now, metaColumns, 0, inner, selected);
  }
  // The offset is *running*, not looked up: `panelSections` builds `flat` by flattening `order`, so the pins
  // of the sections walked in order are the pins of `flat` read in order, and adding each section's length
  // as the walk goes answers the same number an `indexOf` into `flat` would — without re-searching the
  // flattened list once per section. A heading costs a row and no slot, so it never advances the offset.
  const owned: PanelOwned[] = [];
  let offset = 0;
  for (const section of sections.order) {
    // A level whose every pin carries a group is a *counting* section: it exists so the frame's title can
    // count that level, and it holds no pins, owns no rows and prints no heading — a heading over nothing
    // would be a blank row the window scrolls through and the bar could be parked on. The pins of its level
    // are drawn by the group sections beside it, which is exactly why this one holds none: a section that
    // held them too would draw them twice and give `d` two copies to dismiss.
    if (section.pins.length > 0) {
      owned.push({
        row: { text: headingCell(headingRow(section), headingWidth, style), tail: "" },
        pin: null,
      });
    }
    owned.push(
      ...panelPinRowOwners(
        section.pins,
        textWidth,
        style,
        now,
        metaColumns,
        offset,
        inner,
        selected,
      ),
    );
    offset += section.pins.length;
  }
  return owned;
}
