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

import { ELLIPSIS, padPlain } from "./panel-frame.ts";
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

/** The heading of `kind`, spelled once for whoever asks — the rail and `/pins` never do (resolution 6).
 *
 * Reserved for the group-section API (v2-6), which needs a heading for a section the table does not yet build;
 * nothing in the drawn frame reads it today — `headingRow` is what the layout asks for.
 */
export function headingText(kind: SectionKind): string {
  return HEADINGS[kind];
}

/**
 * The heading row's text column, at the width the pin rows of the same frame are laid out at.
 *
 * A heading shares the text column a pin row pays for: ` ` + marker + ` ` + label, the same three columns
 * `panelPinRows` (`panel-rows.ts`) opens a pin row with, so the heading's word lines up with the pin text
 * below it rather than starting a column to the left of it. `label` comes from this module and `mark` is a
 * fixed one, so neither needs the sanitizer a pin's text goes through, and the builder still cuts every
 * drawn line to the frame's width the same way it cuts a pin row.
 *
 * Padded rather than cut: a heading longer than the text column is a heading the frame has no room for,
 * and `padPlain` measures what it pads with `visibleWidth`, so a two-column glyph costs the two columns it
 * really occupies. The row is never empty — an empty row is the builder's signal for something the frame
 * should not have drawn — and the three fixed headings are far shorter than any frame the builder closes.
 */
export function headingCell(row: HeadingRow, textWidth: number): string {
  const cell = ` ${row.mark} ${row.label}`;
  // Cut rather than padded when the frame has given the heading fewer columns than the heading itself needs:
  // a heading is one row of a frame whose every line is measured to the same width, and a row that overflowed
  // its column would be the row the frame closes over the chat behind it. `padPlain` still does the padding,
  // because that is the case that actually happens — the headings are far shorter than any frame the builder
  // closes, so the cut is the guard and not the path.
  if (textWidth <= 0) return "";
  return visibleWidth(cell) > textWidth
    ? (truncateToWidth(cell, textWidth, "") ?? "")
    : padPlain(cell, textWidth);
}
