/**
 * The two border rows of the pins panel: the corners, the label each carries, and the rule between them.
 *
 * The panel is a *closed* box, and a closed box is the part a theme can break: a corner wrapped in visible
 * bytes pushes the frame past the width the overlay was given, and a label whose bytes the theme smuggled
 * into an escape sequence reaches a border column that reads as blank. So both rows are drawn under the
 * same policy — every escape byte refused, the label measured on what survives, the rule counted in columns
 * rather than styled — and the policy is stated once, here, for the top and the bottom alike.
 *
 * It is a module of its own rather than a few functions in `panel-lines.ts` for a plain reason: the frame
 * and the rows are two responsibilities, and the file that held both had outgrown the project's size limit.
 * Nothing about the rows moves here, and nothing about the border belongs to the rows — the builder asks
 * for a border row and gets a string, exactly as it asks for a pin row.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "./escape.ts";
import {
  CORNER_COLUMNS,
  ELLIPSIS,
  INJECTED_RESET,
  RULE,
  frameGlyphs,
  glyph,
  padPlain,
} from "./panel-frame.ts";

/**
 * The label a border row carries, at the room the border gives it, under the same escape policy as every
 * other drawn line: the theme's bytes are refused before the label is measured, so nothing a theme wraps the
 * label in can reach a border column (the frame is drawn from the *stripped* label, never the styled one).
 *
 * A label that fits is cut by nothing and padded by nothing — the rule is the padding, and a pad here would
 * put a blank between the label and the corner. A label too long is cut with `…`, minus the reset bytes
 * pi-tui wraps its own ellipsis in: those are the cut's bytes, and a border row is drawn at one column per
 * character, so the ellipsis is put back and the line carries no escape the builder introduced.
 */
function fitLabel(label: string, room: number): string {
  const plain = stripSequences(label);
  if (visibleWidth(plain) <= room) return plain;
  const cut = stripSequences(truncateToWidth(plain, room, ELLIPSIS)).replace(
    INJECTED_RESET,
    ELLIPSIS,
  );
  return padPlain(cut, room);
}

/**
 * One border row: the corner, the label it carries (the header at the top, the hint at the bottom), the
 * rule filling what is left, and the other corner. The label is padded to the room it was given — the
 * border's own right margin, the one space that keeps the rule off the label's last character — and the
 * rule, not blanks, is what then fills the rest of the border: the panel is flush right, so a run of blanks
 * at its right edge would read as a border that was never drawn. A label too long for the room is cut with
 * `…` instead, so a header or hint loses a character rather than pushing a corner past the width. The
 * corners are measured glyphs and the rule is counted columns, so no theme colouring can move the rule out
 * from under a corner: the box closes at every size the builder draws at.
 */
export function borderLine(
  label: string,
  labelStyle: (text: string) => string,
  left: string,
  right: string,
  width: number,
  frame: (text: string) => string,
): string {
  const text = label === "" ? "" : ` ${fitLabel(labelStyle(label), width - CORNER_COLUMNS - 2)} `;
  // The rule reaches the right corner of the border whatever the label does with the room it was given:
  // a cut ends at the last column it was allowed, a label shorter than its room leaves the rest to the
  // rule. No border ever ends in a blank — the panel is flush right, and blanks at its edge would read
  // as a frame that was never drawn.
  const rule = Math.max(0, width - CORNER_COLUMNS - visibleWidth(text));
  return `${glyph(frame, left)}${text}${RULE.repeat(rule)}${glyph(frame, right)}`;
}

/**
 * Whether every glyph of one frame measures a single column through the theme.
 *
 * Six glyphs make the box — four corners, the gutter on each side and the rule — and each of them is drawn
 * at a column the panel promised to fill, so a theme that wraps one in *visible* bytes is asking for a frame
 * wider than the overlay was given, whichever of the six it wrapped. Measuring only some of them would leave
 * the rest to be padded out over the chat behind a flush-right panel.
 */
export function frameIsOneColumn(frame: (text: string) => string): boolean {
  return frameGlyphs().every((glyphText) => visibleWidth(frame(glyphText)) === 1);
}
