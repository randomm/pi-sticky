/**
 * The single gate every pin text passes — from the model, from the user, from anywhere — before
 * it reaches state, the screen or the model again.
 *
 * Owns its own scanner: neither pi-tui's stripTerminalSequences (which recognises CSI only with
 * final bytes m/G/K/H/J) nor pi's unexported stripAnsi removes 8-bit CSI, DCS or an unterminated
 * OSC, so delegating would leak.
 *
 * Pass order is load-bearing and fixed: escapes first (a surviving introducer would be measured as
 * printable), then lone surrogates, then controls, then invisible format characters, then the
 * combining-mark cap, then newline collapse and trim, and the grapheme budget last so the ellipsis
 * can never be cut away. Width is NOT bounded here; render.ts owns display width.
 *
 * Surrogates are dropped before the invisible pass on purpose, and the order is a correctness
 * fix, not a preference: Segmenter folds an unpaired low surrogate into the cluster that follows it
 * (`\u{dc41}` + U+E0041 is one cluster), so a tag character sheltered behind one is never tested and
 * survives the pass. Dropping surrogates first makes every cluster self-contained.
 *
 * Three rules come from docs/research-summary.md and are what pi-tui gets wrong. An unterminated
 * string ends at the first ESC, BEL, 0x18, 0x1A or 0x9C. A CSI carries no terminator of its own,
 * so a run that reaches no final byte was never a CSI and only the introducer dies. And a Kitty
 * image prefix, like pi-tui's own private APC markers, cannot survive.
 *
 * Control characters appear in this file only as numeric code points or as strings built at
 * runtime. A literal escape sequence in source is rewritten on its way into the file, which
 * silently changes what a comparison or a character class matches.
 */

import { isSurrogate, stripSequences } from "./escape.ts";

/** The code points the control pass names: line feed, carriage return, and the tab it spaces out. */
const LF = 0x0a;
const CR = 0x0d;
const TAB = 0x09;

const LF_CHAR = String.fromCodePoint(LF);
const NEL = String.fromCodePoint(0x85);
const LINE_SEP = String.fromCodePoint(0x2028);
const PARA_SEP = String.fromCodePoint(0x2029);
/** Three or more newlines, built from LF_CHAR rather than written as a literal. */
const REPEAT_NEWLINE = new RegExp(`(?:${LF_CHAR}){3,}`, "g");
/** Edge whitespace, spelled out instead of using trim(), which also strips the two U+202x. */
const EDGE = `\\s${LF_CHAR}${CR}${NEL}${LINE_SEP}${PARA_SEP}`;
const TRIM_EDGE = new RegExp(`^(?:[${EDGE}])+|(?:(?:[${EDGE}])+$)`, "g");
/** Property tests, built at runtime for the same reason as the patterns above. */
const CF_TEST = /\p{Cf}/u;
/** Every combining mark, not just Mn: enclosing marks (U+20E3) and spacing marks count too. */
const MARK_TEST = /\p{M}/u;
/** Combining marks kept per grapheme before the rest are dropped. */
export const MAX_MARKS_PER_GRAPHEME = 4;
/** Horizontal ellipsis, U+2026. */
const ELLIPSIS = String.fromCodePoint(0x2026);

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The code unit at i. Every caller indexes inside a loop bounded by length, so the index is
 * in range; the compiler cannot see that and types an indexed read as possibly-undefined.
 */
function at(text: string, i: number): string {
  return text[i] ?? "";
}

/**
 * Grapheme clusters, in order. Delegates to the module's Intl.Segmenter: after the escape and Cf
 * passes there is nothing left for a hand-rolled clusterer to add, and a hand-rolled one gets the
 * edge cases wrong. A run of base-less combining marks is folded into a single cluster by `\p{M}`
 * continuator rules, so the budget would under-count it, and a cut can end on a bare combining mark
 * or variation selector detached from its base (a keycap's U+20E3, a heart's VS16). The earlier
 * passes leave each cluster self-contained (the surrogate pass runs before this one, which is what
 * makes it true): ZWJ and VS16 survive only inside an emoji cluster, so Segmenter keeps the family
 * intact and the budget counts it as one, while the tag block is already gone and cannot split a
 * flag.
 */
function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

/**
 * C0 and C1 controls and DEL go; TAB becomes a space; every line break (LF, CR, CR LF, U+0085,
 * U+2028, U+2029) becomes a single LF so later passes see one newline shape. The newline test
 * comes first: the printable test is a pair of ranges, and a range must not settle a character
 * the newline test already claims.
 */
function stripControls(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === LF || code === 0x85 || code === 0x2028 || code === 0x2029) {
      out += LF_CHAR;
    } else if (code === CR) {
      if (text.charCodeAt(i + 1) === LF) i += 1;
      out += LF_CHAR;
    } else if (
      isSurrogate(code) ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xfffd)
    ) {
      out += at(text, i);
    } else if (code === TAB) {
      out += " ";
    }
  }
  return out;
}

/**
 * ZWJ and VS16 are format characters like the rest of this set: they stay only when dropInvisible
 * has established the cluster is an emoji sequence, so this function has no exception for them.
 * The tag block U+E0000-U+E007F is not all Cf and needs its own range; the property catches the
 * rest.
 */
function isDroppedFormat(cp: number): boolean {
  if (cp === 0x200b || cp === 0x200c || cp === 0x200e || cp === 0x200f) return true;
  if (cp === 0x200d || cp === 0xfe0f) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2060 && cp <= 0x2064) return true;
  if (cp >= 0x2066 && cp <= 0x2069) return true;
  if (cp === 0xfeff || cp === 0x61c) return true;
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return CF_TEST.test(String.fromCodePoint(cp));
}

/**
 * Does the cluster start with something whose ZWJ and VS16 joiners are meaningful? Only an emoji
 * base gives a joiner meaning: a letter or digit carrying VS16 is an invisible character dressed up
 * as emoji and has to go, so membership is decided by the base code point and never by the mere
 * presence of VS16 in the cluster.
 */
function isEmojiBase(cluster: string): boolean {
  // codePointAt, not charCodeAt: an astral base arrives as a surrogate pair, and a range test
  // against half of one is never true, which would drop the joiners that hold the cluster together.
  const base = cluster.codePointAt(0) ?? 0;
  return (
    (base >= 0x1f000 && base <= 0x1fbff) ||
    (base >= 0x2300 && base <= 0x23ff) ||
    (base >= 0x2600 && base <= 0x27bf) ||
    (base >= 0x2b50 && base <= 0x2b55) ||
    (base >= 0x1f3f4 && base <= 0x1f3ff) ||
    (base >= 0x1f900 && base <= 0x1f9ff) ||
    base === 0xa9 ||
    base === 0xae
  );
}

/**
 * Drop invisible characters cluster by cluster, so a family's ZWJ survives as a unit. Surrogate
 * pairs are read whole because `isEmojiBase` decides the ZWJ/VS16 exception from the cluster's base
 * code point, and a pair split in half would give that test half a number to decide on.
 */
function dropInvisible(text: string): string {
  let out = "";
  for (const cluster of graphemes(text)) {
    const emoji = isEmojiBase(cluster);
    let kept = "";
    for (let j = 0; j < cluster.length; j += 1) {
      let unit = at(cluster, j);
      const cp = cluster.codePointAt(j) ?? 0;
      if (isSurrogate(cluster.charCodeAt(j)) && j + 1 < cluster.length) {
        unit += at(cluster, j + 1);
        j += 1;
      }
      if (emoji && (cp === 0x200d || cp === 0xfe0f)) {
        kept += unit;
        continue;
      }
      if (!isDroppedFormat(cp)) kept += unit;
    }
    out += kept;
  }
  return out;
}

/** Lone surrogates would become U+FFFD downstream and break String.fromCodePoint. */
function dropLoneSurrogates(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += at(text, i) + at(text, i + 1);
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += at(text, i);
  }
  return out;
}

/** Keep at most MAX_MARKS_PER_GRAPHEME combining marks per cluster, in order. */
function capMarks(text: string): string {
  let out = "";
  for (const cluster of graphemes(text)) {
    let marks = 0;
    let kept = "";
    for (let j = 0; j < cluster.length; j += 1) {
      let unit = at(cluster, j);
      if (isSurrogate(cluster.charCodeAt(j)) && j + 1 < cluster.length) {
        unit += at(cluster, j + 1);
        j += 1;
      }
      if (MARK_TEST.test(unit)) {
        marks += 1;
        if (marks > MAX_MARKS_PER_GRAPHEME) continue;
      }
      kept += unit;
    }
    out += kept;
  }
  return out;
}

/** Collapse runs of more than two breaks to two, then trim edges; whitespace-only is empty. */
function tidyNewlines(text: string): string {
  return text.replace(REPEAT_NEWLINE, LF_CHAR + LF_CHAR).replace(TRIM_EDGE, "");
}

/**
 * Cut to maxChars graphemes. The ellipsis is itself one of the graphemes a cut may keep, so a cut
 * keeps maxChars - 1 clusters and is flagged; text that fits comes back untouched and unflagged.
 */
function cutToBudget(text: string, maxChars: number): { text: string; truncated: boolean } {
  const clusters = graphemes(text);
  if (clusters.length <= maxChars) return { text, truncated: false };
  const budget = maxChars > 1 ? maxChars - 1 : 0;
  return { text: clusters.slice(0, budget).join("") + ELLIPSIS, truncated: true };
}

/**
 * Every pass except the budget cut, in the fixed order documented at the top of the file. The
 * budget is a per-session setting, so a caller that has no config — `reconstruct`, which rebuilds
 * pins from a session file — still gets the whole defence against escapes, controls, surrogates,
 * invisible characters and runaway combining marks. No pass throws.
 */
export function cleanPinText(raw: string): string {
  let text = stripSequences(raw);
  text = dropLoneSurrogates(text);
  text = stripControls(text);
  text = dropInvisible(text);
  text = capMarks(text);
  return tidyNewlines(text);
}

/**
 * The one entry point for text about to be shown: `cleanPinText` and then the grapheme budget.
 * maxChars is a positive integer by contract (config.ts clamps it).
 */
export function sanitizePinText(
  raw: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  return cutToBudget(cleanPinText(raw), maxChars);
}
