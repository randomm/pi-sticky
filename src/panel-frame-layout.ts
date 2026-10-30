/**
 * The row table of one panel frame: which rows it holds, in what order, and how tall it comes to.
 *
 * `panelLayoutSections` is the one place a frame's rows are built, so the table `buildPanelLines` draws *is*
 * the table the frame's height was counted from — a pin is wrapped once per frame, and a caller cannot ask
 * for one frame and draw another. It is also the one place the frame is *grouped*: the caller hands over the
 * sections `panelSections` produced — one grouping per frame — and the layout carries that same `order` back
 * out on the layout it returns, which is the only copy the frame's title reads. Ranking and sectioning both
 * happen in `panel-sections.ts`; this module consumes its answer and never asks the question again.
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
import type { PanelRow } from "./panel-row.ts";
import { panelPinRows } from "./panel-rows.ts";
import { headingCell, headingRow } from "./panel-section-headings.ts";
import { hasHeadings } from "./panel-sections.ts";
import type { PanelSection, PanelSections } from "./panel-sections.ts";
import { GUTTER_COLUMNS } from "./panel-tail.ts";

import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * The instant an age is measured against when the caller has none: `new Date()` at the moment the table is
 * built, which is what the rows themselves answer with when their own `now` is left out.
 */
const atOnce = (): string => new Date().toISOString();

/** Rows of the table the pin at `index` owns; zero when the table tags no row with it. */
function countRowsOf(all: readonly PanelOwned[], index: number): number {
  let count = 0;
  for (const entry of all) if (entry.pin === index) count++;
  return count;
}

/**
 * The window's start for a selection, given the table `panelLayoutSections` built and the start of the
 * selected pin: never past the end of the table, so the last pin is always on screen.
 *
 * The table is passed rather than its rows and a parallel list of owners, because the two are one question —
 * which rows belong to which pin — and `PanelOwned.pin` is the only copy of that answer. A second, derived
 * list can drift from the table it was mapped out of, and nothing would notice.
 *
 * A row that belongs to no pin is a section heading, and a heading is read for its position rather than its
 * text — which rows are headings is the `null` the builder stamped on the entry. The window opens on the
 * heading of the section the selected pin belongs to, so the user reads the level of the pin the bar is on
 * rather than inferring it, and *which* pin of that section is selected does not matter: the walk starts one
 * row above the pin and keeps going while the rows it passes belong to siblings, because only the *first* pin
 * of a section has a heading directly above it. The heading is kept only while it and every row of the
 * selected pin still fit the window — `rowsOfSelected + (start - h) <= contentRows`, heading and pin end to
 * end — because the pin's own rows outrank the label: one row over, the window opens on the pin's first row
 * and drops the heading rather than a row of the text. Where the walk walks off the top of the table there is
 * no heading above this pin to keep. A single-section table has no heading rows at all, so its window is
 * byte-for-byte the one it drew before sections existed.
 *
 * Focus plays no part: the same selection at the same terminal draws the same rows whether or not the panel
 * holds the keyboard, and only the bar differs.
 *
 * `buildPanelLines` goes through this with the very table `panelLayoutSections` built, so drawing a window of
 * the pins costs one wrap of each pin rather than three.
 */
export function panelWindowOffset(
  contentRows: number,
  selection: number,
  all: readonly PanelOwned[],
  start: number,
): number {
  const total = all.length;
  if (contentRows <= 0 || total <= contentRows || selection < 0) return 0;
  if (start < 0) return total - contentRows;
  const capped = Math.min(start, total - contentRows);
  const rowsOfSelected = countRowsOf(all, selection);
  // Walk *up* past the rows of the pins above rather than testing only the row directly above: the heading
  // heads its section, so for the section's second and later pins that heading sits further up the table than
  // one row and a one-row test kept it for the first pin alone. Every row passed costs the window a row, so
  // `start - heading` is what the heading costs on top of the pin.
  let heading = start - 1;
  while (heading >= 0 && all[heading]?.pin !== null) heading--;
  // The heading **plus every row of the pin**, which is the fit the rule asks for: the window must hold the
  // heading and the whole pin end to end. At the exact equality the two are precisely the window, which is a
  // fit; one row over, the heading is the thing that does not fit, and a label never costs the selected pin a
  // row of its text — the window opens on the pin instead. A pin the table tags with no row at all owns
  // nothing to keep, so there is no heading to open on either.
  if (rowsOfSelected > 0 && heading >= 0 && rowsOfSelected + (start - heading) <= contentRows) {
    return Math.min(heading, total - contentRows);
  }
  return capped;
}

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
): PanelOwned[] {
  const owned: PanelOwned[] = [];
  for (const [index, pin] of pins.entries()) {
    for (const row of panelPinRows(pin, textWidth, style, metaColumns, inner, now))
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
function panelOwnedRows(
  sections: PanelSections,
  textWidth: number,
  headingWidth: number,
  style: PanelStyle,
  now: string,
  metaColumns: number,
  inner: number,
): PanelOwned[] {
  if (!hasHeadings(sections.order)) {
    return panelPinRowOwners(sections.flat, textWidth, style, now, metaColumns, 0, inner);
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
      ...panelPinRowOwners(section.pins, textWidth, style, now, metaColumns, offset, inner),
    );
    offset += section.pins.length;
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
 * `sections` is the one grouping the frame is built from, and the only one: the caller — `PanelComponent`
 * through `PanelMemory`, or the test helper that draws a frame the way the component does — sections the
 * view once and hands the result here, and this function hands the very same `order` back on the layout so
 * the drawer can print the frame's counts off it. A frame whose title grouped the pins for itself is the
 * failure this shape removes: two groupings can disagree, and one grouping cannot.
 *
 * `sections.flat` is the drawn order and `selection` indexes into it, never into the caller's own array; the
 * heading rows a multi-section view gains sit between the sections without shifting an index, because a
 * heading owns no slot. A caller that built no sections of its own passes the view's own array to
 * `panelSections` first — that is the one call site that legitimately ranks, and every caller that draws a
 * frame has already made it.
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
    // The width `pinRow` closes a row to, named rather than recovered: the wrap gives columns up to
    // `tailReserve`, and that figure clamps at the inner width, so a row can only be packed against a frame the
    // caller named. `frameWidth - GUTTER_COLUMNS` is the same subtraction `buildPanelLines` makes before it
    // draws — the corners sit outside the row, the gutters and their spaces are the four columns inside them.
    frameWidth - GUTTER_COLUMNS,
  );
  // As tall as the rows it draws, never past the terminal's half: `panelFrameRows` puts the two border rows
  // over `owned` and cuts the result to the ceiling, which is the only reason a frame is ever shorter than
  // its content (and the reason the window scrolls for it).
  return {
    owned,
    start: panelRowStartOf(owned, selection),
    height: panelFrameRows(owned.length, terminalRows),
    sections: sections.order,
  };
}
