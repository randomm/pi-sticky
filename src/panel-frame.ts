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

import {
  sgrResetFor,
  themeBytes as sgrThemeBytes,
  skippedCell,
  themeMeasure,
} from "./escape-sgr.ts";
import { isSurrogate, stripSequences } from "./escape.ts";

import type { PanelStyle } from "./render.ts";
import type { PinLevel } from "./types.ts";

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
 * The selection marker: `fitLine`'s answer to a bar the theme was supposed to draw, and the reason the row
 * the keys moved to is visible in a terminal the theme cannot colour. It takes the columns the level's
 * marker owns on the bar's row only — replaced, never appended, so the row's width and the text column are
 * what the layout paid for (`pinRow`, `panel-draw.ts`).
 */
export const SELECTION_MARKER = String.fromCodePoint(0x203a);

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
 * One SGR reset on the end of a drawn line that is still wearing a colour, and nothing on one that is not.
 *
 * The panel is a flush-right overlay, so a theme whose `selected`/`dim`/`marker`/`border` opened a colour and
 * never closed it would bleed past the frame's last column and onto whatever pi-tui paints next. `fitLine`
 * (`panel-draw.ts`) runs this on every drawn line of both frames; `sgrResetFor` (`escape-sgr.ts`) is the
 * classifier, and it answers `""` for an uncoloured line so a plain frame keeps drawing no escape bytes at
 * all rather than one reset for nothing.
 */
export function selectionReset(line: string): string {
  return `${line}${sgrResetFor(line)}`;
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
 * around the glyph would otherwise put an LF or CR on the screen whatever branch the width took. What
 * *survives* is the theme's SGR (`stripNonSgr`, `escape.ts`) — the level's colour is the reason a warning
 * reads as a warning, and it costs no columns — while an OSC, a DCS or a non-colour CSI is refused here
 * rather than reaching the row.
 *
 * Both branches read one form of `marked`: the theme's bytes under the drawn policy (`themeBytes`,
 * `escape-sgr.ts`). The cut used to run over the stripped form and then re-attach its colours out of the
 * theme's *raw* string, so a byte the policy refused — a bare C0, a C1 that is not one of the scanner's six
 * introducers, half a surrogate pair — rode back in on the column of a colour that survived. Nothing is
 * copied out of the raw string now.
 */
export function markerCell(marked: string, glyphText: string): string {
  return closedCell(themeBytes(marked), visibleWidth(glyphText));
}

/**
 * Theme bytes closed to `columns`: cut to them if they are over, padded to them if they are under.
 *
 * The cut runs over the colour-free form because `truncateToWidth` measures the bytes a terminal draws and a
 * colour draws none, so cutting the coloured form would spend real columns on it; the colours are then put
 * back over the columns that survived (`keepColours`). A theme that wrote *visible* bytes around the glyph it
 * was handed — a `marker` wrapping the level's glyph, a `border` wrapping a corner — is what this closes:
 * those bytes are the ones that would take the panel past the width the overlay was given, and a flush-right
 * panel that overruns its own width is drawn over the chat beside it.
 */
function closedCell(theme: string, columns: number): string {
  // `themeBytes` again over the caller's already-filtered form — the policy is idempotent, so a caller that
  // ran it costs nothing. Running it here is what makes the two strings the offset walk reads agree byte for
  // byte, halves of a surrogate pair included now that the policy itself drops them: `keepColours` never
  // meets a half in one form and not the other and bills the cell a column for a character the terminal
  // cannot draw.
  const plain = themeBytes(theme);
  if (visibleWidth(plain) <= columns) return padPlain(plain, columns);
  // pi-tui's wrapper closes every cut with a reset of its own even when the caller asked for no ellipsis, so
  // the reset is taken out before the re-attach (and again, harmlessly, by `keepColours`'s walk): a cell that
  // kept the pair would pay its columns for bytes the terminal draws for nothing. `themeMeasure(plain)` is
  // the form the cut is counted on — the colours out too, because a colour draws no column and a cut that
  // counted on a form that carried them would spend the glyph's column on the wrapper's padding instead.
  const cut = normaliseInjected(truncateToWidth(themeMeasure(plain), columns, ""));
  return padPlain(keepColours(cut, plain), columns);
}

/**
 * The theme's own colours and nothing else: every other sequence, and every control, is gone.
 *
 * The drawn-line policy for a string whose bytes come from the theme, read from its owner (`themeBytes`,
 * `escape-sgr.ts`) rather than restated here: this file's marker and glyph, the border's label
 * (`fitLabel`, `panel-border.ts`), the tail (`drawnTail`, `panel-tail.ts`) and the closure of every row
 * (`fitPlain`, `panel-draw.ts`) all run the same passes in the same order, half pairs dropped.
 */
export const themeBytes = sgrThemeBytes;

/**
 * The theme's colours, put back over a cut that was measured on the colour-free form of the same string.
 *
 * `keepColours` is handed `themeBytes(marked)`, not the theme's raw output: every byte it can copy is one the
 * drawn policy already kept — a colour, or a character in the printable band. It walks the two forms together
 * and takes `safe`'s bytes wherever the cut still has one, so the colour the theme wrote is re-attached whole
 * and nothing else rides in with it.
 *
 * The walk advances by whole **code points**, not code units. A cut runs by visible columns, so an astral
 * glyph is one column that `truncateToWidth` keeps or drops as a pair; copying one code unit at a time out of
 * `safe` handed back half a surrogate pair — a character no terminal can draw, and one the drawn-line sweeps
 * name (`offenders`, `panel-hostile.ts`). `stripNonSgr` keeps a lone surrogate it was handed (it is neither a
 * sequence nor a C1), so the pair is the one shape the policy does not already filter: a cell whose walk
 * landed on half a pair is dropped, leaving the columns to `padPlain`.
 *
 * A cell at the offset is skipped whole (`skippedCell`, `escape-sgr.ts`) so a colour is never re-emitted in
 * pieces, and the columns the colours cost are free to `visibleWidth`, which is what the cell is measured in.
 */
function keepColours(cut: string, safe: string): string {
  let out = "";
  let at = 0;
  for (const kept of cut) {
    for (;;) {
      const cell = skippedCell(safe, at);
      if (cell === 0) break;
      at += cell;
    }
    if (at >= safe.length) break;
    // One code point per drawn column: the pair of a surrogate together, never one half of it.
    const step = String.fromCodePoint(safe.codePointAt(at) as number);
    if (!isSurrogate(step.charCodeAt(0))) out += step;
    at += step.length;
  }
  return out;
}

/**
 * pi-tui's own resets around the ellipsis of a cut, taken back out.
 *
 * `truncateToWidth` always wraps its `…` in `ESC [ 0 m`, even when the caller asked for no ellipsis at all —
 * `markerCell` does exactly that, and a cell that kept the pair would pay its columns for bytes the terminal
 * draws for nothing. The injected form is spelled at runtime because a literal does not survive the way a
 * source file is read.
 */
function normaliseInjected(text: string): string {
  // A reset, spelled from the introducer's own code point (a literal does not survive the way a source file
  // is read) with its bracket escaped: `[` opens a character class to `RegExp`, and a pattern with an
  // unescaped one is a syntax error rather than a match. `[^m]*m` is every SGR, not only pi-tui's reset —
  // `themeBytes` above already kept the only SGR that can be here, and a cell that paid its columns for the
  // bytes of any of them would be charging the frame for what the terminal draws for nothing.
  const sgr = new RegExp(`${String.fromCharCode(0x1b)}\\[[^m]*m`, "g");
  return text.replace(INJECTED_RESET, "").replace(sgr, "");
}

/**
 * One frame glyph — a gutter or a corner — drawn in the theme's colour and occupying exactly one column.
 *
 * The glyph goes through the theme's escape policy (`stripNonSgr`, `escape.ts`), because a corner is drawn
 * at the far right of a flush-right panel: a theme that smuggled a title or clipboard sequence in around it
 * would own the columns behind it. `visibleWidth` counts an OSC pair as free, so the sequence cannot be
 * traded for width — it is refused, and `padPlain` *rather than a cut* puts the column back, since
 * `truncateToWidth` spends a one-column cut on its own ellipsis and would turn a corner into `…`. The
 * theme's SGR survives — `panelThemeStyle` is what asks the theme for the frame's colour, and the test over
 * there is what pins that wiring, with the border's colour being the only thing a frame can be coloured by.
 */
export function glyph(frame: (text: string) => string, glyphText: string): string {
  // `themeBytes` is the escape policy and the control pass together, each told which sequence the frame
  // draws: a colour is walked over whole rather than having its introducer taken out and left on the screen
  // as the text `[94m`. Then the same cut `markerCell` runs, because the promise here is not "the escapes are
  // gone" but "this cell is one column": a theme that wrote visible bytes *around* the corner — `border` is
  // free to — widened the box by every one of them, and a panel that overruns its own width is drawn over the
  // chat beside it. `padPlain` puts back the column a cut to nothing leaves, so an empty gutter is a blank
  // column and never a missing one.
  // A cell's whole width is the glyph it stands for: `columns` is taken from the glyph and every byte the
  // theme wrote around it is cut away or refused, so a corner is one column whatever its theme did to it.
  const columns = visibleWidth(glyphText);
  return closedCell(themeBytes(frame(glyphText)), columns);
}

/**
 * The marker column of the row the bar sits on: the level's glyph *replaced* by `SELECTION_MARKER`, drawn
 * through the theme's `marker` so the selected row colours its marker the way every other row colours its own.
 *
 * One column for one column — `markerCell` closes both to the columns the plain glyph owns — which is why a
 * selection marker costs the frame nothing and the text column does not move. This is how a selection survives
 * in a terminal the theme cannot colour: the bar's colour is the theme's answer and the `›` is the panel's own.
 * The drawer asks for it (`barMarker`, `panel-draw.ts`), because the row table builds a pin's rows long before
 * anybody knows which of them the bar will sit on.
 */
export function selectionCell(style: PanelStyle, level: PinLevel): string {
  // The cell is the glyph's column *plus* the space after it, because that is what the row table wrote
  // (` ${markerCell(...)} `, `panelRows`) and what `textAfterMarkerCell` consumes: it takes the leading space
  // and this cell, so returning the glyph alone would leave the row holding a stray space and shifting the
  // text column by one — a width the layout did not pay for. `markerCell` closes the glyph to one column
  // either side, which is why the two columns this returns are the two the row spent.
  return `${markerCell(style.marker(level, SELECTION_MARKER), SELECTION_MARKER)} `;
}

/**
 * `│ ` + the inner columns + ` │`. The parts are *joined*, never handed to `fitLine` as one string: a
 * theme that colours a gutter adds bytes `visibleWidth` does not count, and a cut over the whole row
 * would spend the gutter's column on an ellipsis — an open box is the failure this function exists to
 * make impossible, so each of its four parts is measured on its own and cannot be traded away.
 */
export function gutter(inner: string, gutterAt: (text: string) => string): string {
  // One reset closes the *whole* row, not just its middle: the right-hand gutter is the last thing on the
  // line and a coloured gutter written after the inner content would leave the screen wearing the frame's
  // colour past the panel's last column. The panel is flush right, so that bleed lands on the chat.
  // `selectionReset` answers `""` for a row the theme did not colour, so a plain frame draws no escape byte.
  return selectionReset(`${gutterAt(GUTTER)} ${inner} ${gutterAt(GUTTER)}`);
}
