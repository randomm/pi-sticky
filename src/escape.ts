/**
 * The escape-sequence scanner the sanitizer and the drawn panel run, split out because recognising
 * sequences is a self-contained problem with its own vocabulary of introducers, final bytes and terminators.
 *
 * Neither pi-tui's stripTerminalSequences (which recognises CSI only with final bytes m/G/K/H/J)
 * nor pi's unexported stripAnsi removes 8-bit CSI, DCS or an unterminated OSC, so delegating would
 * leak. Three rules come from docs/research-summary.md and are what pi-tui gets wrong: an
 * unterminated string ends at the first ESC, BEL, 0x18, 0x1A or 0x9C; a CSI carries no terminator
 * of its own, so a run that reaches no final byte was never a CSI and only the introducer dies; and
 * a Kitty image prefix, like pi-tui's own private APC markers, cannot survive.
 *
 * Two passes share that walk: `stripSequences`, which is what untrusted text is drawn under, and
 * `stripNonSgr`, which is what a *theme's* bytes are drawn under — it keeps a CSI closed by `m` and refuses
 * every other sequence. The dispatch runs on whether a byte is an introducer, never on whether it is kept,
 * because the 8-bit introducers are members of the printable range above C1 and a kept-test would let them
 * through as text.
 *
 * Control characters appear in this file only as numeric code points. A literal escape sequence in
 * source is rewritten on its way into the file, which silently changes what a comparison matches.
 */
import { isC1Control, isIntroducer, isSurrogate } from "./escape-chars.ts";
import { scanSequence } from "./escape-scan.ts";

export { isC1Control, isSurrogate } from "./escape-chars.ts";

const ESC_CODE = 0x1b;

/**
 * The six line-break shapes a terminal or a reader may end a line on, spelled from code points: LF,
 * CR, NEL and the two U+202x separators, plus vertical tab and form feed — which the sanitizer maps
 * away but a raw `now` copied verbatim into state reaches `renderList` with. TAB is deliberately not
 * one of them: it aligns text, it does not break a line, and folding it would rewrite a benign value
 * that every other pass leaves alone.
 *
 * A surface that promises its reader one line per record folds every one of these: folding only the
 * `\n` the sanitizer leaves behind would borrow the guarantee from that pass's ordering rather than
 * owning it, and a value that never went through it — a timestamp, a view built directly — would still
 * be able to split a row.
 */
const BREAK_SHAPES = `${String.fromCodePoint(0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029)}`;

/** Tab: the one control character a drawn surface keeps. */
const TAB = 0x09;

/**
 * Every run of line breaks in `text` replaced by a single space. Shared by the two surfaces that
 * owe their reader exactly one line per record — the rail and the model-facing listing — so neither
 * can be surprised by a break shape the other one missed.
 */
export function foldBreaks(text: string): string {
  return text.replace(new RegExp(`[${BREAK_SHAPES}]+`, "g"), " ");
}

/**
 * Every C0 control, C1 control and DEL dropped, TAB kept — the removal the sanitizer runs over a pin's
 * text, exported for the two surfaces that draw a *theme's* bytes and owe the same promise. A theme's
 * `marker` that folded a line break in around a glyph would otherwise put an LF or CR on the screen, where
 * nothing between the panel's gutters consumes it. TAB stays because it aligns text rather than breaking a
 * line — the same reasoning `BREAK_SHAPES` gives for leaving it alone — and `padPlain` may still pad after
 * this pass, so a row cannot come back short.
 *
 * An escape sequence that `keep` accepts is walked over whole rather than filtered byte by byte. The
 * introducer of a sequence is a control, so the naive pass would take it out of a colour the caller has
 * just decided to draw and leave its parameters behind as the *text* `[94m` — visible bytes, charged for
 * columns, where a colour was supposed to cost none. The caller's own policy therefore survives this pass
 * instead of being undone by it, and a sequence the caller did not vouch for is still walked into and
 * dropped whole by the shared scanner.
 */
export function dropControls(text: string, keep?: (text: string, at: number) => boolean): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    if (isIntroducer(code)) {
      const sequence = scanSequence(text, i, code);
      const consumed = sequence.length;
      const length = consumed < 0 ? 0 - consumed : consumed;
      // A kept sequence is a colour and is text for this pass's purposes; a refused one is an escape
      // sequence and goes, introducer, parameters and final alike.
      if (length > 0 && keep?.(text, i)) out += text.slice(i, i + length);
      i += length;
      continue;
    }
    if (code === TAB || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xfffd)) {
      out += text[i];
    }
    i += 1;
  }
  return out;
}

/**
 * One left-to-right pass: keep text, drop every escape sequence. An introducer is dispatched on
 * whether it is one, never on whether it is kept, because the 8-bit introducers are members of the
 * printable range above C1 and a kept-test would let them through as text.
 */
export function stripSequences(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (!isIntroducer(code)) {
      out += text[i];
      i += 1;
      continue;
    }
    const consumed = scanSequence(text, i, code).length;
    i = consumed < 0 ? 0 - consumed : i + consumed;
  }
  return out;
}

/**
 * The same walk as `stripSequences` with one class kept: a CSI closed by `m`, which is a colour and is
 * what a theme is for. Everything else dies — OSC (its 8 hyperlinks and its 52 clipboard writes), DCS,
 * SOS, PM, APC, the Kitty image prefix, and every other CSI (`ESC [ 1 ; 1 H`, `ESC [ 2 J`, `ESC [ K`,
 * `ESC [ ? 25 l`) — plus the six 8-bit introducers and any C1 control, which are not text.
 *
 * This is the policy for bytes whose *source is the theme*, never for a pin: untrusted text is drawn under
 * `stripSequences` at its own boundary, and the frame applies this pass as defence in depth on the way out.
 * A colouring that is not SGR is not colour, and `visibleWidth` counts an OSC pair as free columns, so a
 * kept one would be padded across the chat behind a flush-right panel for nothing.
 */
export function stripNonSgr(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (!isIntroducer(code)) {
      // A C1 control is neither an introducer's payload nor text; the 8-bit introducers went through the
      // branch above, so what is left in 0x80-0x9f is a byte no terminal should be handed.
      if (!isC1Control(code)) out += text[i];
      i += 1;
      continue;
    }
    const sequence = scanSequence(text, i, code);
    const consumed = sequence.length;
    if (sequence.kept && consumed > 0) out += text.slice(i, i + consumed);
    i = consumed < 0 ? 0 - consumed : i + consumed;
  }
  return out;
}

/**
 * Does `text` carry an escape sequence that is not SGR — a hyperlink, a title or clipboard write, a
 * cursor or screen move, a DCS/APC payload, an 8-bit introducer or a stray C1 control? The one question
 * the panel's drawn-line sweeps ask once theme colours are allowed, and the only difference from
 * `containsEscape` is that it is read on the bytes a theme produced rather than on a pin's.
 */
export function containsNonSgr(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    // The same dispatch the two strip passes run, on the same test: an introducer is looked at because
    // it *is* one, never because it survived a pass. The 8-bit introducers are members of the printable
    // range above C1, so a guard that asked only "is this byte an ESC or a control" would wave `CSI8` on
    // through as text and certify a screen-clear as clean.
    if (!isIntroducer(code)) {
      if (isC1Control(code)) return true;
      i += 1;
      continue;
    }
    const sequence = scanSequence(text, i, code);
    if (!sequence.kept) return true;
    const consumed = sequence.length;
    i = consumed < 0 ? 0 - consumed : i + consumed;
  }
  return false;
}

/** Does `text` carry any escape byte at all? The sweep over a pin's own bytes. */
export function containsEscape(text: string): boolean {
  return text.includes(String.fromCharCode(ESC_CODE));
}
