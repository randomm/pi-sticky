/**
 * The escape-sequence scanner's *decision*: how long the sequence at an offset is, and whether it is SGR.
 *
 * `escape.ts` owns the walk and `escape-chars.ts` the introducers; this module is the one question the walk
 * asks at each introducer, split out so the pass that strips everything and the pass that keeps the theme's
 * colours share a definition of a sequence. Two copies of the CSI/OSC/DCS walk would be two definitions, and
 * the panel's drawn-line policy rests on the two passes agreeing about what an escape is.
 *
 * Control characters appear here only as numeric code points, as in `escape.ts`: a literal escape sequence
 * in source is rewritten on its way into the file, which silently changes what a comparison matches.
 */
import {
  APC8,
  CAN,
  CSI8,
  DCS8,
  ESC,
  PM8,
  SOS8,
  ST8,
  SUB,
  is8BitIntroducer,
  isC1Control,
} from "./escape-chars.ts";

const BEL = 0x07;
const BACKSLASH = 0x5c;
/** `m`, the one CSI final whose parameters are colours rather than a cursor or a screen. */
const SGR_FINAL = 0x6d;

/** One sequence: how many code units it occupies, and whether the screen may see it. */
export interface Sequence {
  /**
   * Code units to skip, counted from the introducer. A negative value is not a length: it is the absolute
   * offset the scan resumes at, for an unterminated string that died at an ESC opening another sequence.
   */
  readonly length: number;
  /**
   * A CSI closed by `m` **written in its 7-bit form** — a colour the drawn panel may show. The 8-bit
   * spelling is deliberately excluded: `CSI8` is U+009B, a character `visibleWidth` charges a column for,
   * so a pass that *keeps* rather than strips cannot emit it for free. `stripNonSgr` refuses it as the
   * introducer it is, and every caller that re-attaches a kept colour therefore vouches for a byte it can
   * actually draw (`isSgr`, `panel-frame.ts`).
   */
  readonly kept: boolean;
}

/** Is code a byte a CSI may carry before its final byte? */
function isCsiMiddle(code: number): boolean {
  return (code >= 0x20 && code <= 0x2f) || (code >= 0x30 && code <= 0x3f);
}

/** Is code the byte that closes a CSI? */
function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/**
 * The sequence at `start`, where `code` is the code unit there — an ESC or one of the six 8-bit
 * introducers, which is the same dispatch both strip passes run.
 *
 * ESC G opens the Kitty graphics prefix, which is a string sequence: the plan requires that an image prefix
 * cannot survive, so it dies with its payload.
 */
export function scanSequence(text: string, start: number, code: number): Sequence {
  if (code === ESC) {
    const next = start + 1 < text.length ? text.charCodeAt(start + 1) : -1;
    switch (next) {
      case 0x5b:
        return csi(text, start, 2);
      case 0x5d:
      case 0x50:
      case 0x58:
      case 0x5e:
      case 0x5f:
      case 0x47:
        return refused(stringLength(text, start, start + 2, true));
      case -1:
        // A trailing bare ESC is a sequence of one.
        return refused(1);
      default:
        // Any other ESC final makes a two-character sequence: ESC M, and so on.
        return refused(2);
    }
  }
  // The 8-bit CSI is still dispatched as a CSI, so the walk takes the introducer, its parameters and its
  // final whole — but never as a colour: see `Sequence.kept`.
  if (code === CSI8) return refused(csi(text, start, 1).length);
  if (is8BitIntroducer(code)) return refused(stringLength(text, start, start + 1, false));
  return refused(1);
}

/**
 * One CSI: an introducer, parameter and intermediate bytes, and one final byte. A CSI carries no terminator
 * of its own, so a run that reaches no final byte was never a CSI — only the introducer dies, and a kept
 * test on an unclosed run would put its parameters on the screen as text.
 */
function csi(text: string, start: number, introducerWidth: number): Sequence {
  let i = start + introducerWidth;
  while (i < text.length && isCsiMiddle(text.charCodeAt(i))) i += 1;
  if (i >= text.length) return refused(introducerWidth);
  const final = text.charCodeAt(i);
  // A C1 control is neither a CSI byte nor text, so it terminates the attempt and goes with it.
  if (isC1Control(final)) return refused(i + 1 - start);
  if (!isCsiFinal(final)) return refused(introducerWidth);
  return { length: i + 1 - start, kept: final === SGR_FINAL };
}

/**
 * Length of a string sequence — OSC, DCS, SOS, PM or APC — counted from its introducer at `start`.
 *
 * ST (ESC plus a backslash) and BEL, CAN, SUB and 8-bit ST terminate the string and go with it. A lone ESC
 * that is not ST opens the next sequence instead: the scan is handed back to that ESC by returning the
 * absolute offset as a negative number, so the sequence it opens decides how much more of the input dies,
 * and two introducers can never merge. Inside an 8-bit string a stray ESC is payload, so the scan only
 * steps over it. With no terminator anywhere the payload runs to the end of the input.
 */
function stringLength(text: string, start: number, body: number, escaped: boolean): number {
  let i = body;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === ESC) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === BACKSLASH) return i + 2 - start;
      if (escaped) return 0 - i;
      i += 1;
      continue;
    }
    if (code === BEL || code === CAN || code === SUB || code === ST8) return i + 1 - start;
    i += 1;
  }
  return text.length - start;
}

/** A sequence no surface may draw: the walker drops its whole length. */
function refused(length: number): Sequence {
  return { length, kept: false };
}
