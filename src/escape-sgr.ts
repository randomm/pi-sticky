/**
 * The escape sequence that closes a colour, and the classifier that says whether a line needs it.
 *
 * A panel is a flush-right overlay: an unclosed background from a theme's `selected`, or a faint from its
 * `dim`, would bleed onto the columns beside the frame and onto whatever pi-tui paints next. So every drawn
 * line asks `sgrResetFor` once and appends its answer — the guarantee the frame owes the screen now that a
 * theme's colour survives to it (`selectionReset`, `panel-frame.ts`).
 *
 * The decision is made by the same walk that strips the sequences (`escape-scan.ts`), not by a second parser
 * that could disagree with it about what an escape is.
 */
import { isIntroducer } from "./escape-chars.ts";
import { scanSequence } from "./escape-scan.ts";
import { dropControls, isSurrogate, stripNonSgr, stripSequences } from "./escape.ts";

/** `ESC [`, spelled from code points as everywhere in this corner of the codebase. */
export const SGR_PREFIX = `${String.fromCharCode(0x1b)}[`;

/** `ESC [ 0 m` — the one sequence that closes every attribute a theme may have opened. */
export const SGR_RESET = `${SGR_PREFIX}0m`;

/**
 * An SGR reset for `line` when it opened a colour and never closed it, and `""` when it did not — a line
 * that needs no reset is left exactly as it was measured, so an uncoloured frame keeps drawing no escape
 * bytes at all.
 */
export function sgrResetFor(line: string): string {
  return opensColour(line) ? SGR_RESET : "";
}

/**
 * Is the last SGR the line kept an opening rather than a reset?
 *
 * A reset is `ESC [ 0 m` (or the bare `ESC [ m`), so the walk ends there with nothing owed; anything else it
 * ends with — `ESC [ 7 m`, a `48;2;…` background — is a colour the terminal is still wearing. Sequences the
 * walk does not keep never open anything: a theme's OSC or DCS is refused before a line reaches here, and a
 * refused sequence cannot bleed.
 */
function opensColour(text: string): boolean {
  let open = false;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (!isIntroducer(code)) {
      i += 1;
      continue;
    }
    const sequence = scanSequence(text, i, code);
    const consumed = sequence.length;
    if (consumed < 0) {
      i = 0 - consumed;
      continue;
    }
    if (sequence.kept) open = !isSgrReset(text.slice(i, i + consumed));
    i += consumed;
  }
  return open;
}

/** Is `sequence` a full SGR reset — `ESC [ m`, `ESC [ 0 m`, or the `0;0` spelling of the same thing? */
export function isSgrReset(sequence: string): boolean {
  if (!sequence.endsWith("m") || !sequence.startsWith(SGR_PREFIX)) return false;
  const params = sequence.slice(SGR_PREFIX.length, -1);
  return params === "" || /^0+(?:;0+)*$/.test(params);
}

/** The introducer, spelled at runtime: a literal does not survive the way a source file is read. */
const E = String.fromCharCode(0x1b);

/**
 * A colour that came through this file's policy whole: introducer, parameters and final.
 *
 * The marker cell's re-attach (`keepColours`, `panel-frame.ts`) walks a cut back into the theme's coloured
 * string, and the columns it takes out of that string have to be whole sequences — never one code unit at a
 * time, or a colour is re-emitted one character after its own introducer and the row carries `ESC ESC [`
 * where it should carry one `ESC`.
 */
const COLOUR_CELL = new RegExp(`${E}\\[[0-9;]*m`);

/**
 * Does the sequence at `at` name a colour, i.e. is it the one class `stripNonSgr` keeps?
 *
 * The vote is the scanner's `kept`, which recognises a colour only in its 7-bit spelling — an 8-bit `CSI8`
 * introducer is refused even when its parameters end in `m`, because U+009B is a *character*
 * `visibleWidth` charges for and a pass that emits what it keeps cannot draw it. A colour whose introducer
 * was kept but whose parameters were not would print the text `31m` where a colour cost nothing.
 */
function isSgr(text: string, at: number): boolean {
  return scanSequence(text, at, text.charCodeAt(at)).kept;
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
 * The drawn-line policy for a string whose bytes come from the *theme*: every surface that puts theme bytes
 * on a row — `markerCell` and `glyph` (`panel-frame.ts`), the border's label (`fitLabel`,
 * `panel-border.ts`), the tail (`drawnTail`, `panel-tail.ts`) and the closure of every row (`fitPlain`,
 * `panel-draw.ts`) — needs both passes in this order, *and* the half-pair drop below, and one definition is
 * what keeps them from holding opposite policies. The drop is here rather than in the marker cell because a
 * filter in one cell is what left the other three surfaces drawing the byte the cut had just dropped.
 */
export function themeBytes(marked: string): string {
  return dropLoneSurrogates(dropControls(stripNonSgr(marked), isSgr));
}

/**
 * How many code units the zero-width cell at `at` occupies, or `0` where a real drawn column begins.
 *
 * Three classes, all of them free to `visibleWidth` and so all of them absent from a cut this offset is
 * matched against: a colour (`COLOUR_CELL`), a refused `ESC`-led sequence, and an 8-bit introducer with its
 * payload. The last is the one a byte-range test misses — U+009B is *printable* to `visibleWidth`, so a walk
 * that stopped at the first byte above C1 would copy the introducer back onto the line `stripNonSgr` had
 * just refused it on.
 */
export function skippedCell(text: string, at: number): number {
  if (at >= text.length) return 0;
  const code = text.charCodeAt(at);
  const colour = text.slice(at).match(COLOUR_CELL)?.[0];
  if (code === 0x1b && colour !== undefined && text.startsWith(colour, at)) return colour.length;
  if (isIntroducer(code)) {
    const length = scanSequence(text, at, code).length;
    return length < 0 ? 0 - length : Math.max(1, length);
  }
  return 0;
}

/**
 * The columns the marker cell may be cut at: the theme's colours, every other sequence and every control
 * gone, so it is the one form `visibleWidth`, pi-tui's wrapper and the cell's own cut all agree on.
 *
 * `stripSequences` and not `stripNonSgr` — a colour costs no columns either way, and taking the colours out
 * too means the offsets this yields land *inside* `themeBytes(marked)`, where the kept colour starts, rather
 * than inside the theme's raw string. That is what lets a cut re-attach colours it can vouch for.
 */
export function themeMeasure(marked: string): string {
  return dropLoneSurrogates(dropControls(stripNonSgr(stripSequences(marked)), isSgr));
}

/**
 * Every code point of `text` that is not half a surrogate pair, in order.
 *
 * A pair is a character; a half of one is not. `stripNonSgr` and `dropControls` are a sequence pass and a
 * control pass, and neither one is a surrogate pass: the band sits inside the printable range both of them
 * keep, so a lone half rides through both and `visibleWidth` charges it nothing — a row that kept one
 * measured the width it owed while handing the terminal a character it cannot draw. That is the byte the
 * drawn-line sweeps name (`offenders`, `panel-hostile.ts`), so it is the class `themeBytes` owes to *every*
 * surface that reads a theme, not only to the marker cell: the border's label, the tail and the closure of
 * each row are held to it by the frame-level sweeps, because a guard in one cell is what left the other
 * three drawing the half the cut had just dropped. A pair, by contrast, is a character and stays whole — the
 * theme's own glyph is what the user asked to see.
 */
function dropLoneSurrogates(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (!isSurrogate(code)) {
      out += text.charAt(i);
      continue;
    }
    // A high half followed by a low half is one character and both units are kept. The walk is over *code
    // units* deliberately: iterating a string yields code points, so `charCodeAt(0)` of a whole astral glyph
    // is 0x1F4CC — above the band — and a `for..of` filter reads a real emoji as text and keeps it by
    // accident while a grapheme counter charges the same pair one column. Only a half with no partner goes.
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += text.charAt(i) + text.charAt(i + 1);
      i += 1;
    }
  }
  return out;
}
