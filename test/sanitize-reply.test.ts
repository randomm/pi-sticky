import { expect, test } from "bun:test";

import { MAX_REPLY_GRAPHEMES, MAX_REPLY_UNITS } from "../src/bounds.ts";
import { sanitizeReplyText } from "../src/sanitize-reply.ts";
import { MAX_MARKS_PER_GRAPHEME, graphemesOf } from "../src/sanitize.ts";

// The reply is the user's own words, quoted verbatim into the tool result the model reads, so it passes the
// same cleaning the pin text passes (`sanitize.ts`) and then the reply's own ceilings (`bounds.ts`). These
// cases are the regression net for the two ways a cut can be wrong: cutting mid-grapheme, and cutting to a
// ceiling nobody set. The escape-stripping itself is `test/sanitize.test.ts`'s; what is pinned here is the
// reply's half — and that *both* ceilings hold, since the row that draws the reply truncates by width and the
// entry that stores it is JSON-encoded.

/** `n` grapheme clusters of one code point each. */
const chars = (char: string, n: number) => char.repeat(n);

/** A cluster of one letter followed by `n` combining marks. */
const marks = (n: number) =>
  "a\u0300".repeat(n === 0 ? 0 : 1) + "\u0300".repeat(Math.max(0, n - 1));

const ELLIPSIS = "\u2026";

test("sanitizeReplyText trims and returns ordinary text untouched", () => {
  expect(sanitizeReplyText("  yes, ship it  ")).toBe("yes, ship it");
  expect(sanitizeReplyText("a")).toBe("a");
  // The ellipsis marks a cut and nothing else: text that already fits both ceilings is not decorated, and a
  // reply whose own last character happens to be an ellipsis is not doubled.
  expect(sanitizeReplyText(chars("a", MAX_REPLY_GRAPHEMES))).toBe(chars("a", MAX_REPLY_GRAPHEMES));
});

test("sanitizeReplyText returns undefined for empty, whitespace-only and non-string input", () => {
  expect(sanitizeReplyText("")).toBeUndefined();
  expect(sanitizeReplyText("   \n\t ")).toBeUndefined();
  // A reply of nothing but zero-width format characters is not an answer, and would draw as one.
  expect(sanitizeReplyText("\u200B\u200C\uFEFF")).toBeUndefined();
  expect(sanitizeReplyText("\u001B[2J")).toBeUndefined();
  // A non-string reaches this from a session entry whose `data` survived the shape guards as `unknown`: the
  // guard vouches for the entry's shape, never for a `text` that is a number or an object.
  expect(sanitizeReplyText(undefined)).toBeUndefined();
  expect(sanitizeReplyText(7)).toBeUndefined();
  expect(sanitizeReplyText(null)).toBeUndefined();
  expect(sanitizeReplyText({ text: "yes" })).toBeUndefined();
  expect(sanitizeReplyText(["yes"])).toBeUndefined();
});

test("sanitizeReplyText reaches the same sanitizer as the pin's text", () => {
  // The reply is quoted into the tool result the model reads, so an escape that survived here would be an
  // escape from untrusted text into the transcript. One line each for the classes that matter most.
  expect(sanitizeReplyText("\u001B]8;;http://evil\u0007click\u0007")).toBe("click");
  expect(sanitizeReplyText("a\u0000b\u001Fc\u202Ed")).toBe("abcd");
  expect(sanitizeReplyText("\u001B[31mred\u001B[0m ok")).toBe("red ok");
});

test("sanitizeReplyText cuts at a grapheme boundary and stays inside both ceilings", () => {
  // Ten times the grapheme ceiling of two-code-point clusters, so the unit ceiling cannot be the binding one
  // and the cut is the grapheme count.
  const wide = chars("a\u0300", MAX_REPLY_GRAPHEMES * 10);
  const cut = sanitizeReplyText(wide);
  expect(cut).toBeDefined();
  expect(cut?.endsWith(ELLIPSIS)).toBe(true);
  const body = cut?.slice(0, -1) ?? "";
  // No dangling marks: every survivor is the whole cluster the input was built from.
  expect(graphemesOf(body).every((cluster) => cluster === "a\u0300")).toBe(true);
  expect(graphemesOf(body).length).toBe(MAX_REPLY_GRAPHEMES - 1);
  expect(graphemesOf(cut ?? "").length).toBeLessThanOrEqual(MAX_REPLY_GRAPHEMES);
  expect(cut?.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
});

test("sanitizeReplyText's survivor is well-formed UTF-16 so it survives JSON", () => {
  // Surrogate pairs are two units each, so a `.slice()`-style cut would orphan half a pair and the entry would
  // round-trip through `JSON.stringify` with U+FFFD where the answer was. The input is the worst case for that
  // ceiling: clusters at the mark cap, so the unit count binds long before the grapheme count does.
  const crowded = `a${"\u0300".repeat(MAX_MARKS_PER_GRAPHEME)}`; // 6 units, 1 grapheme
  const cut = sanitizeReplyText(crowded.repeat(MAX_REPLY_UNITS));
  expect(cut).toBeDefined();
  expect(cut?.endsWith(ELLIPSIS)).toBe(true);
  expect(cut?.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
  expect(graphemesOf(cut ?? "").length).toBeLessThanOrEqual(MAX_REPLY_GRAPHEMES);
  // The survivor is whole clusters and nothing else — a lone combining mark or a split pair fails this.
  expect(graphemesOf(cut?.slice(0, -1) ?? "").every((cluster) => cluster === crowded)).toBe(true);
  expect(JSON.parse(JSON.stringify({ text: cut })).text).toBe(cut);
});

test("sanitizeReplyText holds the unit ceiling for wide clusters where the two ceilings disagree", () => {
  // The unit ceiling is the one that protects the drawn row: 200 graphemes of a six-unit cluster are 1200
  // units of text the model's listing has to carry. Whichever ceiling binds, the row stays inside both.
  const crowded = `a${"\u0300".repeat(MAX_MARKS_PER_GRAPHEME)}`;
  const cut = sanitizeReplyText(crowded.repeat(300));
  expect(cut).toBeDefined();
  expect(cut?.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
  expect(graphemesOf(cut ?? "").length).toBeLessThanOrEqual(MAX_REPLY_GRAPHEMES);
  expect(cut?.endsWith(ELLIPSIS)).toBe(true);
  expect(graphemesOf(cut?.slice(0, -1) ?? "").length).toBeLessThan(MAX_REPLY_GRAPHEMES);
});

test("sanitizeReplyText keeps the reply's ceilings distinct from the pin's", () => {
  // The pin's text ceiling is higher than the reply's: the same input must cut differently under the two,
  // which is the evidence that the reply did not quietly inherit the pin's ceiling.
  const long = chars("x", MAX_REPLY_GRAPHEMES + 100);
  expect(sanitizeReplyText(long)).toBe(chars("x", MAX_REPLY_GRAPHEMES - 1) + ELLIPSIS);
});

test("sanitizeReplyText caps combining marks per grapheme before the length cut", () => {
  // A cluster of ten thousand marks is one grapheme and would otherwise reach the row as one unbounded run.
  const cut = sanitizeReplyText(`\u{1F44D}${"\u0300".repeat(10_000)}`);
  expect(cut).toBeDefined();
  expect(cut?.includes("\u0300".repeat(MAX_MARKS_PER_GRAPHEME + 1))).toBe(false);
  expect(cut?.length).toBeLessThanOrEqual(MAX_MARKS_PER_GRAPHEME + 3);
});
