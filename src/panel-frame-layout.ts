/**
 * The row table of one panel frame: which rows it holds, in what order, and how tall it comes to.
 *
 * `panelLayout` is the one place a frame's rows are built, so the table `buildPanelLines` draws *is* the
 * table the frame's height was counted from — a pin is wrapped once per frame, and a caller cannot ask for
 * one frame and draw another. It is also the one place the order the view was pinned in becomes the panel's
 * **drawn** order: `panelSections` groups the pins into level sections and flattens them, and every row of
 * the table — and every index in it — comes out of that flattening.
 *
 * Two coordinates run through this file and only one of them is the caller's. `selection` is the pin's
 * position in the flattened drawn order (`panelSections`'s `flat`), which is what the keys, the bar's clamp,
 * `d` and `Enter` index; the *table position* of a row is what the window scrolls by and what the bar is
 * drawn on. They are the same numbering until a heading appears: a section heading owns a row and no pin, so
 * it costs the frame a row without costing the user a slot (operator resolution 2 of pins v2-3). Each entry
 * of the table therefore carries both — `pin` for the first, its index in the array for the second — and
 * `null` in `pin` is what makes a heading impossible to select, scroll onto, dismiss or answer.
 *
 * The rows themselves — what one pin's text turns into at a given width — are `panel-rows.ts`; the strings
 * a heading prints are `panel-section-headings.ts`; the columns are `panel-frame-geometry.ts`. This module
 * assembles the three and owns the height, and nothing here draws a glyph or colours a byte.
 */
import { headingColumns, panelTextColumns, widestMetaColumns } from "./panel-frame-geometry.ts";
import { panelFrameRows } from "./panel-height.ts";
import { panelPinRows } from "./panel-rows.ts";
import type { PanelRow } from "./panel-rows.ts";
import { headingCell, headingRow } from "./panel-section-headings.ts";
import { hasMultipleSections, panelSections } from "./panel-sections.ts";
import type { PanelSections } from "./panel-sections.ts";

import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * The instant an age is measured against when the caller has none: `new Date()` at the moment the table is
 * built, which is what the rows themselves answer with when their own `now` is left out.
 */
const atOnce = (): string => new Date().toISOString();

/**
 * The pin a row of the table belongs to, or `null` for a row that belongs to no pin: the heading over a
 * level section. `null` rather than an out-of-range sentinel, because "no pin" is what a heading is and an
 * index of `-1` would be a pin number one before the first — which `panelRowStartOf` reads as "no such pin",
 * and a heading must not be answerable at all.
 */
export type RowOwner = number | null;

/**
 * One drawn row together with the *pin* that owns it (or nothing, for a heading), as the window needs it.
 *
 * Two coordinates meet on this one entry and neither is redundant. `pin` is the **selection** coordinate —
 * the pin's position in the flattened drawn order (`panelSections`'s `flat`), which is what the keys, `d`,
 * `Enter` and the bar's clamp index. The entry's *position in the table* is the **row** coordinate — what
 * the window scrolls by and what the bar is drawn on. A heading owns a row and no pin, and a pin that wraps
 * owns several rows and one pin, so the two come apart and only this pair holds both.
 */
export interface PanelOwned {
  row: PanelRow;
  /** The pin this row belongs to, or `null` when the row is a section heading. */
  pin: RowOwner;
}

/**
 * One frame's rows: the table, the row the selection starts at, and the rows the frame needs.
 *
 * Returned by `panelLayout`, the one place the pins are wrapped for a frame, so the builder draws the very
 * rows the height was counted from.
 */
export interface PanelLayout {
  owned: PanelOwned[];
  /** Table position of the selected pin's first row, or -1 when the selection names no pin. */
  start: number;
  height: number;
}

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
): PanelOwned[] {
  const owned: PanelOwned[] = [];
  for (const [index, pin] of pins.entries()) {
    for (const row of panelPinRows(pin, textWidth, style, now, metaColumns))
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
 * it. A single-section view takes the shortcut at the top and is built as one run of pins, which is what
 * keeps a one-panel frame byte-for-byte what it was before sections existed (operator resolution 1).
 */
function panelOwnedRows(
  sections: PanelSections,
  textWidth: number,
  headingWidth: number,
  style: PanelStyle,
  now: string,
  metaColumns: number,
): PanelOwned[] {
  if (!hasMultipleSections(sections.order)) {
    return panelPinRowOwners(sections.flat, textWidth, style, now, metaColumns, 0);
  }
  // The running offset is taken from `flat` rather than counted up from each section's length: `flat` *is*
  // `order` flattened, and reading the offset off the array the selection indexes means the tag a row carries
  // and the index a key addresses cannot come apart if the two ever stop agreeing on where a section begins.
  // `section.pins` are the section's own pins in drawn order, so its last one is the pin whose tag is last.
  const owned: PanelOwned[] = [];
  for (const section of sections.order) {
    owned.push({
      row: { text: headingCell(headingRow(section), headingWidth), tail: "" },
      pin: null,
    });
    const first = section.pins[0] as ViewPin;
    const offset = sections.flat.indexOf(first);
    owned.push(...panelPinRowOwners(section.pins, textWidth, style, now, metaColumns, offset));
  }
  return owned;
}

/**
 * Table position of the pin at `index`, or -1 when there is no such pin, from the owner stamped on each row
 * of the table: the window starts at the first row the builder attributed to that pin, so a pin that owns
 * several rows is scrolled as a whole rather than opening mid-entry. A heading owns no index, so the search
 * never lands on one.
 */
function panelRowStartOf(all: readonly PanelOwned[], index: number): number {
  return index < 0 ? -1 : all.findIndex((entry) => entry.pin === index);
}

/**
 * The row table of one frame, wrapped *once* per pin at the text column `panelTextColumns` computes for
 * `frameWidth` — the table `buildPanelLines` draws and the height is counted from, which is what makes a
 * frame as tall as its rows and keeps a resize from sizing the box at a width it is not drawn at. The
 * builder pads each row out to the inner width when it draws it.
 *
 * `pins` may arrive in **the order the view was pinned in**: this is the one place that order becomes the
 * panel's drawn order, through `panelSections`. `selection` is therefore an index into
 * `panelSections(pins).flat`, never into the caller's array, and the heading rows a multi-section view gains
 * sit between the sections without shifting an index — a heading owns no slot. A caller that built the
 * sections first (`PanelComponent`, through `PanelMemory`) hands over that very `flat`, and the table built
 * from it is the same table, because a section of already-ranked pins is those pins in the order they came.
 *
 * The text column is what gives up width, never the id/age tail: the wrap is sized so a first row still has
 * a column of text to draw *and* room for its tail beside it, because a row whose text column is zero
 * collapses to a blank line `pinRow` draws without its tail — which is how a `#id` used to disappear on a
 * narrow panel. See `panel-frame-geometry.ts` for the arithmetic and `test/panel-id-never-cut.test.ts` for
 * the sweep that pins it.
 *
 * `now` is the instant every age in the table is measured against; the component passes the extension's
 * clock so a minute's passage re-ages the frame.
 *
 * This is the *only* owner of a frame's height: `height` is the row count the frame draws, counted from
 * `owned` and the terminal the caller was given (`tui.terminal.rows`, or `undefined` when none can be
 * asked, which `panelMaxRows` answers with its fallback). `buildPanelLines` draws the `height` it is handed
 * and builds no table of its own, so a caller cannot ask for one frame and draw another.
 *
 * The height is `owned.length` — the wrapped rows the table actually holds, **heading rows included** — over
 * the frame's own border rows, cut to the ceiling (`panelFrameRows`), so a one-pin panel is three rows and
 * the prompt stays visible beside it while a list of a thousand pins stops at half the terminal and scrolls.
 * A heading is a row like any other for the purposes of the half-height cap: two sections over a short
 * terminal scroll their headings with their pins rather than pushing the frame past the ceiling.
 */
export function panelLayout(
  pins: readonly ViewPin[],
  frameWidth: number,
  terminalRows: number | undefined,
  selection: number,
  style: PanelStyle,
  now: string = atOnce(),
): PanelLayout {
  return panelLayoutSections(panelSections(pins), frameWidth, terminalRows, selection, style, now);
}

/**
 * `panelLayout` for a caller that has already built the sections — which is every caller that also draws a
 * frame, because the frame's title reads the same sections the rows were built from and a view grouped once
 * for both is a view that cannot disagree with itself.
 *
 * Split from `panelLayout` rather than given an optional argument: the sections are the one input two panel
 * modules genuinely share, and naming the sharing is what keeps a caller from handing the rows one grouping
 * and the drawer another.
 */
export function panelLayoutSections(
  sections: PanelSections,
  frameWidth: number,
  terminalRows: number | undefined,
  selection: number,
  style: PanelStyle,
  now: string = atOnce(),
): PanelLayout {
  // The reserve is measured once, before the wrap, and handed to the rows: the same figure decides how many
  // text columns the pins get and whether a pin's `#<id> <age>` fits beside its id. Measuring it twice, or
  // letting the rows measure their own, is how a frame came to charge the text for one tail and draw another.
  // Measured across the *whole view* rather than one section at a time, so a wide id in one section cannot
  // wrap another section's rows at a width the builder then has to cut to fit it.
  const metaColumns = widestMetaColumns(sections.flat, style.dim, now);
  const owned = panelOwnedRows(
    sections,
    panelTextColumns(frameWidth, metaColumns),
    headingColumns(frameWidth),
    style,
    now,
    metaColumns,
  );
  // As tall as the rows it draws, never past the terminal's half: `panelFrameRows` puts the two border rows
  // over `owned` and cuts the result to the ceiling, which is the only reason a frame is ever shorter than
  // its content (and the reason the window scrolls for it).
  return {
    owned,
    start: panelRowStartOf(owned, selection),
    height: panelFrameRows(owned.length, terminalRows),
  };
}
