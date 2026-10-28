/**
 * The headings the panel draws between its sections.
 *
 * A level heading is read off the section `panelSections` built and is one of three fixed strings: a heading
 * the model could word is a heading a pin could forge, so the three are fixed in this file and the user is
 * taught to read them. A **group** heading is the one exception, and it is the model's own word — stored only
 * after `cleanField` (`pin-fields.ts`) has sanitized it, folded it onto one line and bounded it to
 * `MAX_FIELD_GRAPHEMES`, which is what makes a heading a pin can influence safe to draw. Nothing here reads a
 * pin's *text* for a heading, group included: text is untrusted (AGENTS.md, "Untrusted text") and no length
 * bound makes it a section name. The rail, `/pins` and the model-facing listing keep their own headers —
 * pins v2-3 changes the panel's frame title alone (operator resolution 6), and the frame's title is spelled
 * by its own module, `panel-frame-title.ts`, not here. A heading's glyph is not a fourth string to invent:
 * for a level it is the level's own glyph, read from `MARKER` in `panel-rows.ts` and coloured through
 * `style.marker` the way the rows under the heading are.
 *
 * The heading rows are produced here rather than by the drawer: `panel-rows.ts` owns how many rows a frame
 * holds and `panel-lines.ts` owns drawing them, and both were near the project's 300-line cap before
 * sections existed (operator resolution 7), so what a heading *is* lives beside the strings that spell it
 * and the two owners of the table and the drawing just ask for it.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "./escape.ts";
import { markerCell, padPlain } from "./panel-frame.ts";
import { MARKER } from "./panel-rows.ts";
import { groupOf } from "./panel-sections.ts";
import type { PanelSection, SectionKind } from "./panel-sections.ts";
import { toOneLine } from "./render.ts";
import type { PanelStyle } from "./render.ts";
import type { PinLevel } from "./types.ts";

/**
 * The heading of each level section, spelled once. Fixed strings, deliberately: a heading the model could
 * word would be a heading a pin could forge, and the three are what the user is taught to look for. A group
 * section's heading is its own stored name instead — see `headingRow`.
 */
const HEADINGS: Record<PinLevel, string> = {
  warning: "Warnings",
  action: "Needs you",
  info: "FYI",
};

/** One drawn heading row: the text the user reads, and the part of it the theme may colour. */
export interface HeadingRow {
  /** The heading without its leading glyph, e.g. `Warnings` — what the text column prints. */
  label: string;
  /** The heading's leading glyph — the level's own, from `MARKER` — drawn through `style.marker`. */
  mark: string;
  /**
   * The level the row was built from — the kind `headingRow` already read off the section, so the cell that
   * colours the glyph does not have to be told it a second time and cannot be told a different one.
   */
  kind: SectionKind;
}

/**
 * The heading row of `section`, as the row table prints it.
 *
 * For a level section the glyph is split from the word so a selected warning still reads as a warning under
 * the bar: `panel-rows.ts` colours a pin row's marker through `style.marker(level, glyph)` for the same
 * reason, and a heading whose glyph was baked into the text could not be coloured at all. The glyph itself is
 * the level's own — `MARKER` (`panel-rows.ts`), the table a pin row is drawn from — so the heading over a
 * section and the rows under it agree about what a warning looks like.
 *
 * A group heading carries no glyph at all: a group mixes levels, so no single level's mark could stand for
 * it without claiming one. What it carries instead is the group's own name, indented two columns — the width
 * the mark and its space would have taken — so the name still lines up with the pin text under it and the
 * section reads as a label over those rows rather than as a pin of its own. An empty group section has no
 * name to read off, so its label falls back to the level's own heading; the drawer skips an empty section
 * before it asks (`panel-frame-layout.ts`).
 */
export function headingRow(section: PanelSection): HeadingRow {
  const group = groupOf(section.kind);
  if (group !== undefined) {
    const best = section.pins[0];
    // The name is the model's word and reaches the frame unfiltered if it is not passed through the one
    // folding policy here (`toOneLine`, `render.ts`): the heading is one row of a frame whose every line is
    // measured and closed to the same width, so a break the view still carried — a snapshot written before
    // the fields were cleaned, or a view built directly rather than through the reducer — would be a row the
    // builder closed over the chat. `pin-fields.ts` already sanitises and folds what it stores; this is the
    // drawn surface's own guarantee, the same one a pin's text gets from the row table.
    // A group heading carries no glyph at all: a group mixes levels, so no single level's mark could stand for
    // it without claiming one. What it carries instead is the group's own name, indented three columns — the
    // width a level heading spends on `markerCell`'s leading space, the marker's own columns and the space
    // after them — so the name opens in exactly the column `Warnings`/`Needs you`/`FYI` open in, and lines up
    // with nothing but the labels beside it. A name at the marker's column would compete with the level glyphs
    // the rows under it carry. An empty group section has no name to read off, so its label falls back to the
    // level's own heading; the drawer skips an empty section before it asks (`panel-frame-layout.ts`).
    return { mark: "", label: `${INDENT}${toOneLine(group)}`, kind: best?.level ?? "info" };
  }
  const level = section.kind as PinLevel;
  return { mark: MARKER[level], label: HEADINGS[level], kind: section.kind };
}

/**
 * What a group name is indented by: two columns, the marker's own column plus the space after it. With the
 * one leading space `headingCell` puts in front of *both* kinds of cell, the name opens exactly where
 * `Warnings`/`Needs you`/`FYI` open, and one column right of the markers the rows under it carry. A name at
 * the marker's column would read as a pin competing with them.
 */
const INDENT = "  ";

/**
 * The heading of `row` as the row table prints it: ` ` + marker + ` ` + label, fitted to `textWidth`.
 *
 * Three cases, and the width decides which: with no column at all (`textWidth` at or below zero) the cell is
 * the empty string, since a heading with nowhere to be drawn is not a row the frame should print; narrower
 * than the column it is padded with blanks out to exactly `textWidth`; wider than it is cut to `textWidth`
 * with no ellipsis, because a heading is one row of a frame whose every line is measured to the same width
 * and a row that spilled its column would be the row the frame closed over the chat behind it.
 *
 * A heading shares the text column a pin row pays for — the same three columns `panelPinRows`
 * (`panel-rows.ts`) opens a pin row with — so the heading's word lines up with the pin text below it rather
 * than starting a column to the left of it. `label` comes from this module and `mark` is the level's own
 * `MARKER` glyph, so neither needs the sanitizer a pin's text goes through, and the builder still cuts every
 * drawn line to the frame's width the same way it cuts a pin row. Both measuring halves read the string with
 * `visibleWidth`, so a two-column glyph costs the two columns it really occupies.
 */
export function headingCell(row: HeadingRow, textWidth: number, style: PanelStyle): string {
  // The glyph is coloured the way `panelPinRows` colours a pin row's marker, and the theme's bytes are
  // refused before the cell is measured — the policy of `fitLine` (`panel-lines.ts`), which cuts the joined
  // row again when it still measures too wide. A `marker` that wrapped the glyph in visible bytes is
  // therefore cut back to the columns the plain glyph owns, so it cannot push the row past the column the
  // frame set aside while still drawing the level the user reads. A group heading has no glyph, so its cell
  // is its label alone — already indented by `headingRow` into the column a level heading's word occupies.
  const cell =
    row.mark === ""
      ? ` ${row.label}`
      : ` ${markerCell(style.marker(row.kind as PinLevel, row.mark), row.mark)} ${row.label}`;
  if (textWidth <= 0) return "";
  // In practice the padding branch is the one that runs: the three fixed headings are far shorter than any
  // frame the builder closes, so the cut is the guard rather than the path. Stripped after the cut rather
  // than before it, because the theme's colour is meant to survive a cell that fits — only the bytes the cut
  // itself injects are refused here, and `fitLine` (`panel-lines.ts`) is where the rest are. The group name
  // is cleaned before it is stored (`pin-fields.ts`) and this strips again whatever the theme added.
  return visibleWidth(cell) > textWidth
    ? padPlain(stripSequences(truncateToWidth(cell, textWidth, "")), textWidth)
    : padPlain(cell, textWidth);
}
