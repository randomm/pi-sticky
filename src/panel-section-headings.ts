/**
 * The headings the panel draws between its level sections.
 *
 * The strings are read off the sections `panelSections` built — never off a pin's text. Pin text is
 * untrusted (AGENTS.md, "Untrusted text"), so nothing here infers a section from what a pin says: a
 * heading the model could word is a heading a pin could forge, so all three are fixed strings in this file
 * and the user is taught to read them. The rail, `/pins` and the model-facing listing keep their own
 * headers — pins v2-3 changes the panel's frame title alone (operator resolution 6), and the frame's title
 * is spelled by its own module, `panel-frame-title.ts`, not here.
 *
 * The heading rows are produced here rather than by the drawer: `panel-rows.ts` owns how many rows a frame
 * holds and `panel-lines.ts` owns drawing them, and both were near the project's 300-line cap before
 * sections existed (operator resolution 7), so what a heading *is* lives beside the strings that spell it
 * and the two owners of the table and the drawing just ask for it.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { padPlain } from "./panel-frame.ts";
import type { PanelSection, SectionKind } from "./panel-sections.ts";

/**
 * The heading of each level section, spelled once. Fixed strings, deliberately: a heading the model could
 * word would be a heading a pin could forge, and the three are what the user is taught to look for.
 */
const HEADINGS: Record<SectionKind, string> = {
  warning: "⚠ Warnings",
  action: "? Needs you",
  info: "· FYI",
};

/** The leading glyph of each heading, so the heading row can colour it the way a pin row colours its marker. */
const MARKS: Record<SectionKind, string> = { warning: "⚠", action: "?", info: "·" };

/** One drawn heading row: the text the user reads, and the part of it the theme may colour. */
export interface HeadingRow {
  /** The heading without its leading glyph, e.g. `Warnings` — what the text column prints. */
  label: string;
  /** The heading's leading glyph, e.g. `⚠` — drawn through `style.marker` at the section's kind. */
  mark: string;
}

/**
 * The heading row of `section`, as the row table prints it.
 *
 * The glyph is split from the word so a selected warning still reads as a warning under the bar: `panel-rows.ts`
 * colours a pin row's marker through `style.marker(level, glyph)` for the same reason, and a heading whose
 * glyph was baked into the text could not be coloured at all.
 */
export function headingRow(section: PanelSection): HeadingRow {
  const heading = HEADINGS[section.kind];
  const mark = MARKS[section.kind];
  return { mark, label: heading.slice(mark.length + 1) };
}

/**
 * The heading of `kind` as the row table prints it: ` ` + marker + ` ` + label, fitted to `textWidth`.
 *
 * Three cases, and the width decides which: with no column at all (`textWidth` at or below zero) the cell is
 * the empty string, since a heading with nowhere to be drawn is not a row the frame should print; narrower
 * than the column it is padded with blanks out to exactly `textWidth`; wider than it is cut to `textWidth`
 * with no ellipsis, because a heading is one row of a frame whose every line is measured to the same width
 * and a row that spilled its column would be the row the frame closed over the chat behind it.
 *
 * A heading shares the text column a pin row pays for — the same three columns `panelPinRows`
 * (`panel-rows.ts`) opens a pin row with — so the heading's word lines up with the pin text below it rather
 * than starting a column to the left of it. `label` comes from this module and `mark` is a fixed one, so
 * neither needs the sanitizer a pin's text goes through, and the builder still cuts every drawn line to the
 * frame's width the same way it cuts a pin row. Both measuring halves read the string with `visibleWidth`,
 * so a two-column glyph costs the two columns it really occupies.
 */
export function headingCell(row: HeadingRow, textWidth: number): string {
  const cell = ` ${row.mark} ${row.label}`;
  if (textWidth <= 0) return "";
  // In practice the padding branch is the one that runs: the three fixed headings are far shorter than any
  // frame the builder closes, so the cut is the guard rather than the path.
  return visibleWidth(cell) > textWidth
    ? truncateToWidth(cell, textWidth, "")
    : padPlain(cell, textWidth);
}
