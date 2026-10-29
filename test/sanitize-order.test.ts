/**
 * Regression tests for the sanitizer's *pass order* — the cases where the pipeline as a whole leaks
 * what an individual pass would have removed, because a later pass undoes an assumption the earlier
 * one relied on. The single-pass behaviour is in sanitize.test.ts and escape.test.ts; the digit-edged
 * cases for the trim that runs last are in sanitize-digit-edge.test.ts, which also carries the full
 * account of the CR interpolation that put "1" and "3" into the edge class.
 *
 * The bug these lock down: a bare `ESC` that opens nothing is emitted as one character, and its low
 * byte 0x1b pairs with the low surrogate half of the tag character that follows —
 * `String.fromCharCode(0x1b, 0xe0041)` is the single unit U+DC41 U+E0041. The Segmenter folds that
 * pair into the cluster that follows, so while the lone surrogate still stands the tag is not a
 * cluster of its own, `isDroppedFormat` never sees it, and it reaches the screen. Dropping lone
 * surrogates before the invisible pass is what makes each cluster self-contained enough to test.
 *
 * These inputs need two tag characters: with only one the escape scanner swallows it whole, so the
 * shape never reaches the format pass at all. Controls are built at runtime — a literal escape
 * sequence written into a file is rewritten on its way in and silently changes what is compared.
 */
import { describe, expect, test } from "bun:test";

import { sanitizePinText } from "../src/sanitize.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
const TAG = cp(0xe0041);

/** Sanitized text, the usual case. */
function clean(raw: string, maxChars = 400): string {
  return sanitizePinText(raw, maxChars).text;
}

/** `[label, input, expected]` — every one of these leaked a tag or a joiner before the fix. */
const LEAKERS: [string, string, string][] = [
  ["tag, bare ESC, tag, BEL, text", `${TAG}${ESC}${TAG}${TAG}${BEL}b`, "b"],
  ["CJK, bare ESC, two tags, BEL, text", `中${ESC}${TAG}${TAG}${BEL}X`, "中X"],
  ["bare ESC, two tags", `${ESC}${TAG}${TAG}`, ""],
  ["a, bare ESC, tag, BEL, ZWJ, CJK", `a${ESC}${cp(0xe0067)}${BEL}${cp(0x200d)}中`, "a中"],
];

describe("a tag character sheltered behind a lone surrogate", () => {
  test.each(LEAKERS)("%s does not survive", (_name, raw, expected) => {
    expect(clean(raw)).toBe(expected);
  });

  test("no invisible character survives such an input at all", () => {
    for (const [, raw] of LEAKERS) {
      for (const ch of clean(raw)) {
        const code = ch.codePointAt(0) as number;
        const isTag = code >= 0xe0000 && code <= 0xe007f;
        const isJoiner = code === 0x200d || code === 0xfe0f;
        // A joiner may only survive inside an emoji family, which none of these inputs start with.
        expect(isTag || isJoiner).toBe(false);
      }
    }
  });

  test("a lone surrogate never survives to a cluster boundary", () => {
    for (const [, raw] of LEAKERS) {
      const text = clean(raw);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          expect(text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff).toBe(true);
          i += 1;
        } else {
          expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
        }
      }
    }
  });

  test("the emoji exception still survives the reordering", () => {
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(clean(family)).toBe(family);
    expect(clean(`${cp(0x1f3f4)}${cp(0xe0067)}${cp(0xe0062)}${cp(0xe007f)}`)).toBe(cp(0x1f3f4));
    expect(clean(`${cp(0x2764)}${cp(0xfe0f)}`)).toBe(`${cp(0x2764)}${cp(0xfe0f)}`);
  });
});
