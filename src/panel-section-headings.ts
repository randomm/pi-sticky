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
import { foldBreaks, stripSequences } from "./escape.ts";
import { fitLine } from "./panel-draw.ts";
import { markerCell } from "./panel-frame.ts";
import { MARKER } from "./panel-rows.ts";
import type { PanelSection } from "./panel-sections.ts";
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

/**
 * One drawn heading row: the text the user reads, and the level whose glyph colours it.
 *
 * A discriminated pair rather than one shape with a sentinel: a **level** heading carries the level's own
 * glyph and the level it must be coloured as, and a **group** heading carries only its name, because a group
 * mixes levels and no single level's mark could stand for it without claiming one. A group therefore holds no
 * level at all — not even a placeholder that would colour a glyph the cell never draws.
 */
export type HeadingRow =
  | {
      readonly kind: "level";
      readonly level: PinLevel;
      readonly mark: string;
      readonly label: string;
    }
  | { readonly kind: "group"; readonly label: string };

/**
 * The heading row of `section`, as the row table prints it.
 *
 * For a level section the glyph is split from the word so a selected warning still reads as a warning under
 * the bar: `panel-rows.ts` colours a pin row's marker through `style.marker(level, glyph)` for the same
 * reason, and a heading whose glyph was baked into the text could not be coloured at all. The glyph itself is
 * the level's own — `MARKER` (`panel-rows.ts`), the table a pin row is drawn from — so the heading over a
 * section and the rows under it agree about what a warning looks like.
 *
 * A group heading carries no glyph at all, and what it carries instead is the group's own name, indented by
 * `INDENT` — two columns, the width the mark and its space would have taken — so the name still lines up with
 * the pin text under it and the section reads as a label over those rows rather than as a pin of its own. The
 * drawer never asks for a heading over an empty section (`panel-frame-layout.ts` skips one), so a group
 * section always has a name to read off.
 */
export function headingRow(section: PanelSection): HeadingRow {
  if (section.kind === "group") {
    // The name is the model's word and reaches the frame unfiltered if it is not passed through the one
    // folding policy here (`foldBreaks`, `escape.ts` — the fold `toOneLine` wraps): the heading is one row of
    // a frame whose every line is measured and closed to the same width, so a break the view still carried —
    // a snapshot written before the fields were cleaned, or a view built directly rather than through the
    // reducer — would be a row the builder closed over the chat. `pin-fields.ts` already sanitises and folds
    // what it stores; this is the drawn surface's own guarantee, the same one a pin's text gets from the row
    // table.
    return { kind: "group", label: `${INDENT}${foldBreaks(section.name)}` };
  }
  return {
    kind: "level",
    level: section.level,
    mark: MARKER[section.level],
    label: HEADINGS[section.level],
  };
}

/**
 * What a group name is indented by: two columns, the marker's own column plus the space after it. With the
 * one leading space `headingCell` puts in front of *both* kinds of cell, the name opens exactly where
 * `Warnings`/`Needs you`/`FYI` open, and one column right of the markers the rows under it carry. A name at
 * the marker's column would read as a pin competing with them.
 */
const INDENT = "  ";

/**
 * The heading of `row` as the row table prints it: ` ` + marker + ` ` + label, closed to `textWidth`.
 *
 * Two cases, and the width decides which: with no column at all (`textWidth` at or below zero) the cell is
 * the empty string, since a heading with nowhere to be drawn is not a row the frame should print; otherwise
 * the cell goes through `fitLine` (`panel-draw.ts`), the one escape policy every drawn line of both frames
 * passes through — padded with blanks to exactly `textWidth` when it fits, cut to it with no ellipsis when it
 * does not, because a heading is one row of a frame whose every line is measured to the same width and a row
 * that spilled its column would be the row the frame closed over the chat behind it.
 *
 * A heading shares the text column a pin row pays for — the same three columns `panelPinRows`
 * (`panel-rows.ts`) opens a pin row with — so the heading's word lines up with the pin text below it rather
 * than starting a column to the left of it. `label` is this module's word, or the model's for a group, and
 * `mark` is the level's own `MARKER` glyph. The two are trusted differently, and each is dealt with where it
 * is drawn: the group's name is the model's word, so it passes the unconditional strip (`stripSequences`,
 * `escape.ts`) at *this* boundary — before `fitLine` and independently of it — and can neither count as
 * columns it does not draw nor reach the screen with bytes of its own. The level heading's word is this
 * module's own (`HEADINGS`), so only its *marker* is the theme's bytes, and `markerCell` is what closes them
 * to the glyph's columns, colour kept. `fitLine` then closes the row whatever the theme added around it —
 * defence in depth, never the pass a group name leans on.
 */
export function headingCell(row: HeadingRow, textWidth: number, style: PanelStyle): string {
  if (textWidth <= 0) return "";
  // The glyph is coloured the way `panelPinRows` colours a pin row's marker, and `markerCell`
  // (`panel-frame.ts`) has already cut it to the columns the plain glyph owns, so a `marker` that wrapped it
  // in visible bytes cannot push the row past the column the frame set aside while still drawing the level
  // the user reads. A group heading has no glyph, so its cell is its label alone — already indented by
  // `headingRow` into the column a level heading's word occupies.
  const cell =
    row.kind === "group"
      ? // The group's name is the model's word and is stripped at this boundary, the drawer's own guarantee
        // rather than the frame's: `pin-fields.ts` cleans what it stores, but the view is also built directly.
        ` ${stripSequences(row.label)}`
      : ` ${markerCell(style.marker(row.level, row.mark), row.mark)} ${row.label}`;
  return fitLine(cell, textWidth);
}
