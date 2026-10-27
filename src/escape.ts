/**
 * The escape-sequence scanner the sanitizer runs first, split out because recognising sequences
 * is a self-contained problem with its own vocabulary of introducers, final bytes and terminators.
 *
 * Neither pi-tui's stripTerminalSequences (which recognises CSI only with final bytes m/G/K/H/J)
 * nor pi's unexported stripAnsi removes 8-bit CSI, DCS or an unterminated OSC, so delegating would
 * leak. Three rules come from docs/research-summary.md and are what pi-tui gets wrong: an
 * unterminated string ends at the first ESC, BEL, 0x18, 0x1A or 0x9C; a CSI carries no terminator
 * of its own, so a run that reaches no final byte was never a CSI and only the introducer dies; and
 * a Kitty image prefix, like pi-tui's own private APC markers, cannot survive.
 *
 * Control characters appear in this file only as numeric code points. A literal escape sequence in
 * source is rewritten on its way into the file, which silently changes what a comparison matches.
 */
const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
/** CSI and the five string introducers, in their 8-bit form. */
const CSI8 = 0x9b;
const OSC8 = 0x9d;
const DCS8 = 0x90;
const SOS8 = 0x98;
const PM8 = 0x9e;
const APC8 = 0x9f;
/** CAN, SUB and 8-bit ST end an unterminated string, and go with it. */
const CAN = 0x18;
const SUB = 0x1a;
const ST8 = 0x9c;

/** Is code one half of a surrogate pair? Those are not printable on their own. */
export function isSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff;
}

/** Is code a C1 control: neither a byte a CSI may carry nor text? */
function isC1Control(code: number): boolean {
  return code >= 0x80 && code <= 0x9f;
}

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

/**
 * Every run of line breaks in `text` replaced by a single space. Shared by the two surfaces that
 * owe their reader exactly one line per record — the rail and the model-facing listing — so neither
 * can be surprised by a break shape the other one missed.
 */
export function foldBreaks(text: string): string {
  return text.replace(new RegExp(`[${BREAK_SHAPES}]+`, "g"), " ");
}

/** Is code one of the six introducers in their 8-bit form? */
function is8BitIntroducer(code: number): boolean {
  return (
    code === CSI8 ||
    code === OSC8 ||
    code === DCS8 ||
    code === SOS8 ||
    code === PM8 ||
    code === APC8
  );
}

/**
 * Is code a byte a CSI may carry before its final byte? Written as two explicit ranges rather
 * than one test over 0x20-0x3f, and deliberately excluding 0x1b: an ESC inside a CSI belongs to no
 * sequence and terminates the attempt.
 */
function isCsiMiddle(code: number): boolean {
  return (code >= 0x20 && code <= 0x2f) || (code >= 0x30 && code <= 0x3f);
}

/** Is code the byte that closes a CSI? */
function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/**
 * Length of a CSI, counted from its introducer at start, which occupies introducerWidth units.
 * Parameter and intermediate bytes are consumed, then one final byte closes it. A CSI carries no
 * terminator of its own, so a run that reaches no final byte was never a CSI: only the introducer
 * dies and the text after it survives. A C1 control is neither a CSI byte nor text, so it
 * terminates the attempt and goes with it.
 */
function csiLength(text: string, start: number, introducerWidth: number): number {
  let i = start + introducerWidth;
  while (i < text.length && isCsiMiddle(text.charCodeAt(i))) i += 1;
  if (i < text.length && isCsiFinal(text.charCodeAt(i))) return i + 1 - start;
  if (i < text.length && isC1Control(text.charCodeAt(i))) return i + 1 - start;
  return introducerWidth;
}

/**
 * Length of a string sequence — OSC, DCS, SOS, PM or APC — counted from its introducer at start.
 *
 * ST (ESC plus a backslash) and BEL, CAN, SUB and 8-bit ST terminate the string and go with it. A
 * lone ESC that is not ST opens the next sequence instead: the scan is handed back to that ESC by
 * returning the absolute offset as a negative number, so the sequence it opens decides how much
 * more of the input dies, and two introducers can never merge. Inside an 8-bit string a stray ESC
 * is payload, so the scan only steps over it. With no terminator anywhere the payload runs to the
 * end of the input.
 */
function stringLength(text: string, start: number, body: number, escaped: boolean): number {
  let i = body;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === ESC) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === BACKSLASH) {
        return i + 2 - start;
      }
      if (escaped) return 0 - i;
      i += 1;
      continue;
    }
    if (code === BEL || code === CAN || code === SUB || code === ST8) {
      return i + 1 - start;
    }
    i += 1;
  }
  return text.length - start;
}

/**
 * How many code units the sequence at start occupies. A negative result is not a length: it is the
 * absolute offset the scan resumes at, for an unterminated string that died at an ESC opening
 * another sequence. ESC G opens the Kitty graphics prefix, which is a string sequence: the plan
 * requires that an image prefix cannot survive, so it dies with its payload.
 */
function sequenceLength(text: string, start: number, code: number): number {
  if (code === ESC) {
    const next = start + 1 < text.length ? text.charCodeAt(start + 1) : -1;
    switch (next) {
      case 0x5b:
        return csiLength(text, start, 2);
      case 0x5d:
      case 0x50:
      case 0x58:
      case 0x5e:
      case 0x5f:
      case 0x47:
        return stringLength(text, start, start + 2, true);
      case -1:
        // A trailing bare ESC is a sequence of one.
        return 1;
      default:
        // Any other ESC final makes a two-character sequence: ESC M, and so on.
        return 2;
    }
  }
  if (code === CSI8) return csiLength(text, start, 1);
  if (is8BitIntroducer(code)) {
    return stringLength(text, start, start + 1, false);
  }
  return 1;
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
    if (code !== ESC && !is8BitIntroducer(code)) {
      out += text[i];
      i += 1;
      continue;
    }
    const consumed = sequenceLength(text, i, code);
    i = consumed < 0 ? 0 - consumed : i + consumed;
  }
  return out;
}
