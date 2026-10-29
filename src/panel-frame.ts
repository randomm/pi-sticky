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

import { is8BitIntroducer } from "./escape-chars.ts";
import { scanSequence } from "./escape-scan.ts";
import { sgrResetFor } from "./escape-sgr.ts";
import { dropControls, stripNonSgr, stripSequences } from "./escape.ts";

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
 */
export function markerCell(marked: string, glyphText: string): string {
  const columns = visibleWidth(glyphText);
  // One string does the measuring and, when it has to, the cutting: `plain`, the theme's `marker` with every
  // sequence gone. It is the only form whose width `visibleWidth`, pi-tui's wrapper and this file all agree
  // on, and cutting from it is what stops a marker's colour from buying the row columns the glyph does not
  // own — `visibleWidth` counts a colour as free, so a cut over the *kept* form spends real columns on bytes
  // that drew nothing. The colours the theme asked for are put back over the columns that survived.
  const plain = dropControls(stripSequences(marked));
  if (visibleWidth(plain) <= columns) return padPlain(themeBytes(marked), columns);
  // The cut runs over `plain`, so no colour of the theme's survives it: what comes back is the surviving
  // text plus any colour `themeBytes` puts over it, and `keepColours` re-attaches them one column at a time.
  // The `themeBytes` after the re-attach is the one that closes the hole: `keepColours` copies columns out
  // of the *coloured* string, so a control standing after a kept colour came back with it.
  const cut = dropControls(normaliseInjected(truncateToWidth(plain, columns, "")));
  return padPlain(themeBytes(keepColours(cut, marked)), columns);
}

/**
 * The theme's own colours and nothing else: every other sequence, and every control, is gone.
 *
 * Two passes over the same walk, in the order that matters. `stripNonSgr` first: it keeps a CSI closed by
 * `m` and refuses every other sequence. `dropControls` second, and *told* the same class so it walks over
 * that colour instead of stripping its introducer and leaving the parameters behind as the text `[33m`.
 *
 * The order is not cosmetic. `stripNonSgr` is a sequence pass, not a control pass: a bare BEL, CR, VT, BS,
 * FF or DEL is not an escape sequence, so it passes straight through it — and those are exactly the bytes a
 * hostile `theme.marker` writes in between its colours. Run second, `dropControls` is the pass that removes
 * them, and because it walks a kept colour whole rather than cutting into it, the colour the theme asked
 * for stays intact. Run first, it is the pass that orphaned the parameters.
 *
 * Exported as the drawn-line policy for a string whose bytes come from the *theme*: every surface that puts
 * theme bytes on a row — this file's marker and glyph, the border's label (`fitLabel`,
 * `panel-border.ts`), the tail (`drawnTail`, `panel-tail.ts`), and the closure of every row (`fitPlain`,
 * `panel-draw.ts`) — needs both passes in this order, and one definition is what keeps them from holding
 * opposite policies.
 */
export function themeBytes(marked: string): string {
  return dropControls(stripNonSgr(marked), isSgr);
}

/**
 * Does the sequence at `at` name a colour, i.e. is it the one class `stripNonSgr` keeps?
 *
 * The vote is the scanner's `kept`, which recognises a colour only in its 7-bit spelling — an 8-bit `CSI8`
 * introducer is refused even when its parameters end in `m`, because U+009B is a *character*
 * `visibleWidth` charges for and this pass emits what it keeps. A colour whose introducer was kept but
 * whose parameters were not would print the text `31m` where a colour was supposed to cost nothing.
 */
function isSgr(text: string, at: number): boolean {
  return scanSequence(text, at, text.charCodeAt(at)).kept;
}

/** The introducer, spelled at runtime: a literal does not survive the way a source file is read. */
const E = String.fromCharCode(0x1b);

/**
 * A colour that came through `stripNonSgr`/`dropControls` whole: introducer, parameters and final.
 *
 * The cut branch measures on the sequence-free form of the string, so `keepColours` walks that form back
 * into the coloured one a column at a time — and the columns it copies out of `marked` must be whole
 * sequences, never one code unit at a time, or a colour is re-emitted one character after its own
 * introducer and the row carries `ESC ESC [` where it should carry one `ESC`.
 */
const COLOUR_CELL = new RegExp(`${E}\\[[0-9;]*m`);

/**
 * The theme's colours, put back over a cut that was measured on the sequence-free form of the same string.
 *
 * `plain` and `marked` differ only by sequences, so walking the two together and taking `marked`'s bytes
 * wherever `plain` still has one re-attaches exactly the SGR the theme wrote and nothing else: an OSC, a DCS
 * or a stray control that `stripSequences` removed is absent from `plain`, so it has no column to be put back
 * into. A cut that ends in the middle of a colour's parameters ends before it, which is why the reset at the
 * end of a drawn line (`selectionReset`, above) is the thing that closes a cell that was cut mid-colour.
 *
 * Every byte copied out of `marked` is either text or a colour: the walk skips each *whole* sequence — an
 * introducer is never re-emitted a code unit at a time, and an 8-bit introducer, which this file's drawn
 * policy refuses, is skipped like any other rather than copied as if it were text.
 */
function keepColours(cut: string, marked: string): string {
  let out = "";
  let at = 0;
  for (const kept of cut) {
    // Skip what draws no columns: the refused sequences the cut took out, and the parameters of a colour
    // the cut ended before. Each is skipped as a whole cell so a colour is never re-emitted in pieces.
    for (;;) {
      const cell = skippedCell(marked, at);
      if (cell === 0) break;
      at += cell;
    }
    if (at >= marked.length) break;
    out += marked[at];
    at += 1;
  }
  return out;
}

/**
 * How many code units the zero-width cell at `at` occupies, or `0` where a real drawn column begins.
 *
 * Three classes, all of them free to `visibleWidth` and so all of them absent from the cut this walk is
 * matched against: a colour (`COLOUR_CELL`), a refused `ESC`-led sequence, and an 8-bit introducer with its
 * payload. The last is the one a byte-range test misses — U+009B is *printable* to `visibleWidth`, so a
 * walk that stopped at the first byte above C1 would copy the introducer back onto the line that
 * `stripNonSgr` had just refused it on.
 */
function skippedCell(text: string, at: number): number {
  if (at >= text.length) return 0;
  const code = text.charCodeAt(at);
  const colour = text.slice(at).match(COLOUR_CELL)?.[0];
  if (code === 0x1b && colour !== undefined && text.startsWith(colour, at)) return colour.length;
  if (code === 0x1b || is8BitIntroducer(code)) return skipLength(text, at);
  return 0;
}

/** The units the scanner walks over at `at`, with the resume-offset form of a negative length folded back. */
function skipLength(text: string, at: number): number {
  const length = scanSequence(text, at, text.charCodeAt(at)).length;
  return length < 0 ? 0 - length : Math.max(1, length);
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
  return text.replace(INJECTED_RESET, "").replace(new RegExp(`${E}\\[0m`, "g"), "");
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
  // `stripNonSgr` is the escape policy and `dropControls` the control pass, each told which sequence the
  // frame draws: a colour is walked over whole by both rather than having its introducer taken out by the
  // second and left on the screen as the text `[94m`.
  return padPlain(themeBytes(frame(glyphText)), 1);
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
