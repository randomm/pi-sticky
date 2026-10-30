/**
 * The row table of one panel frame: which rows it holds, in what order, and how tall it comes to.
 *
 * `panelLayoutSections` is the one place a frame's rows are built, so the table `buildPanelLines` draws *is*
 * the table the frame's height was counted from — a pin is wrapped once per frame, and a caller cannot ask
 * for one frame and draw another. It is also the one place the frame is *grouped*: the caller hands over the
 * sections `panelSections` produced — one grouping per frame — and the layout carries that same `order`
 * back out on the layout it returns, which is the only copy the frame's title reads. Ranking and sectioning
 * both happen in `panel-sections.ts`; this module consumes its answer and never asks the question again.
 *
 * The rows are counted *after* the expansion has been decided: a `compact` pin owns its full entry while it
 * is the pin the bar is on in a frame that takes keys, and one cut row otherwise — the rule U13 once denied.
 * The frame hands this module the answer (`OpenFrame.expanded`, `panel-component-open.ts`), an index in the
 * same selection coordinate as `selection` or `undefined`, and this function expands exactly the pin that
 * index names — never a pin re-read off `selection` here, which is how a hand-built frame came to grow one
 * entry while its bar was drawn over another. The predicate that decided it is `expandedPinOf`
 * (`panel-expand.ts`); the peek, the rail and every caller outside a frame hand nothing.
 *
 * Two coordinates run through this module and only one of them is the caller's. `selection` is the pin's
 * position in the flattened drawn order (`panelSections`'s `flat`), which is what the keys, the bar's clamp,
 * `d` and `Enter` index; the *table position* of a row is what the window scrolls by and what the bar is
 * drawn on. They are the same numbering until a heading appears: a section heading owns a row and no pin, so
 * it costs the frame a row without costing the user a slot (operator resolution 2 of pins v2-3). Each entry
 * of the table therefore carries both — `pin` for the first, its index in the array for the second — and
 * `null` in `pin` is what makes a heading impossible to select, scroll onto, dismiss or answer.
 *
 * The rows themselves — what one pin's text turns into at a given width — are `panel-rows.ts`; the window rule
 * that cuts them is `panelWindowOffset`, below, and the table's assembly is `panel-frame-table.ts`; the strings
 * a heading prints are `panel-section-headings.ts`; the columns are `panel-frame-geometry.ts`. Nothing here
 * draws a glyph or colours a byte.
 */
import { headingColumns, panelTextColumns, widestMetaColumns } from "./panel-frame-geometry.ts";
import { panelOwnedRows } from "./panel-frame-table.ts";
import { panelFrameRows } from "./panel-height.ts";
import type { PanelLayout, PanelOwned } from "./panel-row-owner.ts";
import type { PanelSections } from "./panel-sections.ts";
import { GUTTER_COLUMNS } from "./panel-tail.ts";

import type { PanelStyle } from "./render.ts";

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
 * `expanded` is the **selection** coordinate of the one `compact` pin whose entry the frame grows, or
 * `undefined` to expand nothing. Resolved once by `expandedPinOf` (`panel-expand.ts`) from the mode, the
 * key gate, the focus, the drawn pins and the bar, and handed here by the frame that was built from it — so
 * the row table cannot grow a pin the drawer's bar is not on, and the cache's term and this layout are the
 * same number rather than two readings of `selection`.
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
  now: string,
  /** The selection coordinate of the compact pin to expand, from `expandedPinOf`; `undefined` expands none. */
  expanded: number | undefined,
): PanelLayout {
  // The expansion is read from the caller's number and never re-derived from `selection`: the predicate that
  // decided it lives in `expandedPinOf` (`panel-expand.ts`), and a layout that re-ran it here — or resolved the
  // pin from `selection` and the focus, as this function used to — would be a second answer to a question the
  // frame has already settled, which is precisely the disagreement the cache could not see. The pin handed to
  // the table is therefore the one the caller named, and only when its index is the bar's own.
  const grown =
    expanded === undefined || expanded !== selection ? undefined : sections.flat[expanded];
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
    grown,
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
