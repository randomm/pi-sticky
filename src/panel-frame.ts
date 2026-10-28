/**
 * The glyphs and colours of one panel frame, resolved once per frame.
 *
 * The frame is the only part of a drawn panel whose bytes come from the *theme* rather than from a pin,
 * and it is drawn at the far edges of a flush-right overlay — a corner owns the column the chat behind
 * the panel ends at. So both halves of the frame's promise are decided here: the glyphs are the four
 * corners, the gutter on each side and the rule between them, and each of them is measured through the
 * theme before a row is assembled, because a theme that coloured a glyph with *visible* bytes would ask
 * for a frame wider than the overlay was given. `buildPanelLines` (`panel-lines.ts`) draws the rows;
 * nothing here knows about pins, heights or the scroll window. The six glyphs are also exported as one
 * list (`frameGlyphs`), which is what lets that guard ask all of them rather than the two it once read.
 *
 * The module is also where a level's *marker* is cut to its glyph's columns (`markerCell`): the same promise
 * one row in from either gutter, since a `marker` that wrapped the glyph in visible bytes asks for a row
 * wider than the frame was given. Pin rows (`panel-rows.ts`) and section headings
 * (`panel-section-headings.ts`) both draw theirs through that one helper, so neither can disagree with the
 * other about what one level looks like.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { dropControls, stripSequences } from "./escape.ts";

import type { PanelStyle } from "./render.ts";

/** The four glyphs of the rounded box, the gutter drawn on each side, and the rule between them. */
export const FRAME_TOP_LEFT = "╭";
export const FRAME_TOP_RIGHT = "╮";
export const FRAME_BOTTOM_LEFT = "╰";
export const FRAME_BOTTOM_RIGHT = "╯";
const GUTTER = "│";
export const RULE = "─";

/** The columns the frame's two corners own; the gutters own `GUTTER_COLUMNS` (`panel-tail.ts`). */
export const CORNER_COLUMNS = 2;

/**
 * Every glyph the frame draws itself, in the order the box is assembled: the four corners, the gutter
 * and the rule. One list rather than six call sites, so the guard that asks each of them to measure one
 * column (`panel-lines.ts`) cannot be written against two of them and leave four unmeasured.
 */
export function frameGlyphs(): string[] {
  return [FRAME_TOP_LEFT, FRAME_TOP_RIGHT, FRAME_BOTTOM_LEFT, FRAME_BOTTOM_RIGHT, GUTTER, RULE];
}

/** pi-tui's cut ellipsis, spelled from its own code point. */
export const ELLIPSIS = String.fromCodePoint(0x2026);

/**
 * The escape sequences `truncateToWidth` introduces when it cuts: a reset before the ellipsis and one
 * after it, spelled at runtime from code points (a literal escape in source is rewritten on its way into
 * the file). A border label that was cut would otherwise carry them onto the screen, where nothing
 * consumes them — the same idiom `render.ts`'s `cut` uses for a rail line.
 */
export const INJECTED_RESET = new RegExp(
  `${String.fromCharCode(0x1b)}\\[0m${String.fromCodePoint(0x2026)}${String.fromCharCode(0x1b)}\\[0m`,
  "g",
);

/** Pad an already-safe line out to the width. */
export function padPlain(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

/**
 * A theme's marker for a level's glyph, cut to the columns the plain glyph owns and padded back to them.
 *
 * The one marker policy of the panel, shared by the pin row (`panelPinRows`, `panel-rows.ts`) and the
 * heading over its section (`headingCell`, `panel-section-headings.ts`): the two draw the same glyph, and a
 * `marker` that wrapped it in visible bytes would otherwise give the heading one version of it and the row
 * under it another — each string closed to its own width by its own caller, neither one measuring the
 * other's marker. `fitLine` (`panel-draw.ts`) closes the *line*; this closes the marker alone, before the
 * row is joined, so a theme cannot make a row ask the frame for columns the glyph does not own.
 *
 * Escapes and C0/C1 controls and DEL go on both branches, not only the cut one: the cell is returned to its
 * caller unpainted, the way `glyph` below returns one, and a theme's `marker` that folded a line break in
 * around the glyph would otherwise put an LF or CR on the screen whatever branch the width took.
 */
export function markerCell(marked: string, glyphText: string): string {
  const stripped = dropControls(stripSequences(marked));
  const columns = visibleWidth(glyphText);
  if (visibleWidth(stripped) <= columns) return padPlain(stripped, columns);
  return padPlain(dropControls(stripSequences(truncateToWidth(stripped, columns, ""))), columns);
}

/**
 * One frame glyph — a gutter or a corner — drawn in the theme's colour and occupying exactly one column.
 *
 * The glyph goes through the same escape policy as every other drawn line (`stripSequences`), because a
 * corner is drawn at the far right of a flush-right panel: a theme that smuggled a title or clipboard
 * sequence in around it would own the columns behind it. `visibleWidth` counts an OSC pair as free, so the
 * sequence cannot be traded for width — it is refused, and `padPlain` *rather than a cut* puts the column
 * back, since `truncateToWidth` spends a one-column cut on its own ellipsis and would turn a corner into
 * `…`. A theme's SGR colour is refused with the rest; `panelThemeStyle` is what asks the theme for the
 * frame's colour, and the test over there is what pins that wiring.
 */
export function glyph(frame: (text: string) => string, glyphText: string): string {
  return padPlain(stripSequences(frame(glyphText)), 1);
}

/**
 * `│ ` + the inner columns + ` │`. The parts are *joined*, never handed to `fitLine` as one string: a
 * theme that colours a gutter adds bytes `visibleWidth` does not count, and a cut over the whole row
 * would spend the gutter's column on an ellipsis — an open box is the failure this function exists to
 * make impossible, so each of its four parts is measured on its own and cannot be traded away.
 */
export function gutter(inner: string, gutterAt: (text: string) => string): string {
  return `${gutterAt(GUTTER)} ${inner} ${gutterAt(GUTTER)}`;
}
