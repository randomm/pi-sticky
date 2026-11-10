import { expect, test } from "bun:test";

import { MAX_REPLY_GRAPHEMES, MAX_REPLY_UNITS, MAX_TEXT_UNITS } from "../src/bounds.ts";
import { sanitizeReplyText } from "../src/sanitize-reply.ts";
import { MAX_MARKS_PER_GRAPHEME, cleanPinText, graphemesOf } from "../src/sanitize.ts";
import { userActionFrom } from "../src/session-entries.ts";
import { reconstruct } from "../src/state.ts";
import { LATER, pin, state, toolResultEntry } from "./fixtures.ts";
import { replyEntry, userActionWithText } from "./reply-entry-fixture.ts";

// The reply is the user's own words, quoted verbatim into the tool result the model reads, so it passes the
// same cleaning the pin text passes (`sanitize.ts`) and then the reply's own ceilings (`bounds.ts`). These
// cases are the regression net for the two ways a cut can be wrong: cutting mid-grapheme, and cutting to a
// ceiling nobody set. The escape-stripping itself is `test/sanitize.test.ts`'s; what is pinned here is the
// reply's half — and that *both* ceilings hold, since the row that draws the reply truncates by width and the
// entry that stores it is JSON-encoded.

/** `n` grapheme clusters of one code point each. */
const chars = (char: string, n: number) => char.repeat(n);

/** `CLEAR` is a screen clear — four units the cleaning pass eats; `SHORT` is the plain words it keeps. */
const CLEAR = "\u001B[2J";
const SHORT = "confirmed";

/** A cluster of one letter followed by `n` combining marks. */
const marks = (n: number) =>
  "a\u0300".repeat(n === 0 ? 0 : 1) + "\u0300".repeat(Math.max(0, n - 1));

const ELLIPSIS = "\u2026";

/**
 * One grapheme cluster of 25 UTF-16 units: a man, eleven skin-tone modifiers and a variation selector.
 *
 * The mark cap of `sanitize.ts` counts `\p{M}` only, so neither the modifiers nor the selector are capped and
 * a cluster this wide is legal input. It is the shape that makes the two reply ceilings disagree hardest —
 * sixty-three of them fill the unit ceiling while the grapheme ceiling still has room — and therefore the
 * shape a cut that appends its ellipsis *after* the budget overshoots on.
 */
const C25 = `\u{1F468}${"\u{1F3FB}".repeat(11)}\uFE0F`;

/** 4 975 units in, 63 clusters retained: the unit ceiling binds, the grapheme ceiling does not. */
const C25_RUN = 199;

/**
 * A second uncapped wide cluster — regional-indicator pairs with a skin-tone modifier and the mark cap's four
 * combining marks — 10 units to the grapheme. Its run overshoots the same ceiling in the same way, so the
 * reserve is not proven on one lucky shape alone.
 */
const C10 = cleanPinText(`\u{1F1E6}\u{1F1E6}\u{1F3FB}${"\u0300".repeat(MAX_MARKS_PER_GRAPHEME)}`);

/** 1 610 units in, 159 clusters retained — the mirror of `C25_RUN` on `C10`. */
const C10_RUN = 161;

/**
 * The same cut as `sanitizeReplyText`'s, but with the ellipsis appended **after** the budget instead of inside
 * it: the loop breaks on `taken.length + cluster.length > MAX_REPLY_UNITS` and then adds U+2026. Kept here
 * because it is the only way to show a fixture really tests the reserve — a fixture the mutant satisfies
 * certifies nothing.
 */
function cutWithoutTheReserve(text: string): string {
  const kept = graphemesOf(cleanPinText(text));
  if (cleanPinText(text).length <= MAX_REPLY_UNITS && kept.length <= MAX_REPLY_GRAPHEMES) {
    return cleanPinText(text);
  }
  let taken = "";
  let count = 0;
  for (const cluster of kept) {
    if (count + 1 > MAX_REPLY_GRAPHEMES - 1) break;
    if (taken.length + cluster.length > MAX_REPLY_UNITS) break;
    taken += cluster;
    count += 1;
  }
  return `${taken}${ELLIPSIS}`;
}

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

test("the reply's ceilings are their own literals, not a derivation of anything else", () => {
  // Both numbers are the reply's own decision (issue #111, PM ruling 1): neither is derivable from a pin's
  // ceiling, the mark cap or the drawn width, so a change to either of those must not move these. Pinned as
  // literals on purpose — a test that recomputed them from the same expression could not notice a drift.
  expect(MAX_REPLY_UNITS).toBe(1600);
  expect(MAX_REPLY_GRAPHEMES).toBe(200);
});

test("sanitizeReplyText keeps 199 graphemes plus the ellipsis for one grapheme over the ceiling", () => {
  // The grapheme ceiling on its own, with the unit ceiling nowhere near binding: one grapheme over, and the
  // answer is 199 survivors plus the reserved U+2026 — 200 graphemes and 200 units, both ceilings met.
  const cut = sanitizeReplyText("a".repeat(MAX_REPLY_GRAPHEMES + 1));
  expect(cut).toBe(`${"a".repeat(MAX_REPLY_GRAPHEMES - 1)}${ELLIPSIS}`);
  expect(cut?.length).toBe(MAX_REPLY_GRAPHEMES);
  expect(graphemesOf(cut ?? "").length).toBe(MAX_REPLY_GRAPHEMES);
});

test("sanitizeReplyText reserves the ellipsis's units for a cut of 25-unit clusters", () => {
  // The overshoot the review found. `C25` is one grapheme of 25 units and the run below is far over the unit
  // ceiling but under the grapheme one, so the unit ceiling alone decides how many clusters survive — and a
  // cut that filled the budget and *then* appended U+2026 answered 1 601 units, one past the ceiling its own
  // header says is reserved. Both ceilings are asserted on the same answer, with the exact retained cluster
  // count and the exact unit length, because "shorter than the ceiling" is not the promise the cut makes.
  const input = C25.repeat(C25_RUN);
  const cut = sanitizeReplyText(input);
  expect(cut).toBeDefined();
  expect(cut?.endsWith(ELLIPSIS)).toBe(true);
  const body = cut?.slice(0, -1) ?? "";
  expect(graphemesOf(body).every((cluster) => cluster === C25)).toBe(true);
  expect(graphemesOf(body).length).toBe(63);
  expect(cut?.length).toBe(graphemesOf(body).length * C25.length + ELLIPSIS.length);
  expect(cut?.length).toBe(1576);
  expect(cut?.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
  expect(graphemesOf(cut ?? "").length).toBeLessThanOrEqual(MAX_REPLY_GRAPHEMES);
  // The mutant this fixture exists to catch, shown rather than asserted elsewhere: without the reserve the
  // same input lands one unit past the ceiling, so the numbers above could not have come from it.
  expect(cutWithoutTheReserve(input).length).toBe(MAX_REPLY_UNITS + 1);
  // And the shape is stable as the input grows: more clusters never lengthen the answer past the reserve.
  for (const run of [C25_RUN + 1, 250, 400]) {
    const longer = sanitizeReplyText(C25.repeat(run));
    expect(longer).toBe(cut);
    expect(longer?.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
  }
});

test("sanitizeReplyText reserves the ellipsis's units for a second wide-cluster shape", () => {
  // The reserve is not proven on one lucky cluster alone. `C10` is unrelated to `C25` — regional indicators,
  // a modifier and four combining marks, 10 units to the grapheme — and its run overshoots the same ceiling in
  // the same way, so a cut that reserved units for the ellipsis on one shape and not the other fails here.
  expect(graphemesOf(C10).length).toBe(1);
  expect(C10.length).toBe(10);
  const input = C10.repeat(C10_RUN);
  const cut = sanitizeReplyText(input);
  expect(cut).toBeDefined();
  expect(cut?.endsWith(ELLIPSIS)).toBe(true);
  const body = cut?.slice(0, -1) ?? "";
  expect(graphemesOf(body).every((cluster) => cluster === C10)).toBe(true);
  expect(graphemesOf(body).length).toBe(159);
  expect(cut?.length).toBe(graphemesOf(body).length * C10.length + ELLIPSIS.length);
  expect(cut?.length).toBe(1591);
  expect(cut?.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
  expect(graphemesOf(cut ?? "").length).toBeLessThanOrEqual(MAX_REPLY_GRAPHEMES);
  expect(cutWithoutTheReserve(input).length).toBe(MAX_REPLY_UNITS + 1);
});

test("sanitizeReplyText caps combining marks per grapheme before the length cut", () => {
  // A cluster of ten thousand marks is one grapheme and would otherwise reach the row as one unbounded run.
  const cut = sanitizeReplyText(`\u{1F44D}${"\u0300".repeat(10_000)}`);
  expect(cut).toBeDefined();
  expect(cut?.includes("\u0300".repeat(MAX_MARKS_PER_GRAPHEME + 1))).toBe(false);
  expect(cut?.length).toBeLessThanOrEqual(MAX_MARKS_PER_GRAPHEME + 3);
});

test("every text sanitizeReplyText returns survives userActionFrom unchanged", () => {
  // The one round trip the two ceilings have to earn: a reply the writer kept — cleaned, or cut to the
  // reply's own ceilings — is a reply the reader has to hand back whole, or the words the user gave are
  // lost twice over. Each case below is a writer answer: a clean fit, a cut at the grapheme ceiling, a cut
  // of a wide cluster and a cut of an ASCII run, plus one reply that only the pass could have cleaned.
  const cases: string[] = [
    "yes, ship it",
    "\u001B]8;;http://evil\u0007see\u0007 \u202Enow",
    chars("a", MAX_REPLY_GRAPHEMES),
    chars("a", MAX_REPLY_GRAPHEMES + 1),
    C25.repeat(C25_RUN),
    C10.repeat(C10_RUN),
    chars("x", 5000),
    `\u001B[2J${chars("x", MAX_REPLY_UNITS)}`,
    "\u001B[2Jyes, ship it",
  ];
  for (const raw of cases) {
    const kept = sanitizeReplyText(raw);
    expect(kept).toBeDefined();
    const read = userActionFrom(replyEntry(userActionWithText("uid-1", LATER, kept)));
    expect(read?.text).toBe(kept);
  }
});

test("a multi-megabyte reply entry is refused before the clean runs", () => {
  // A hand-edited session entry can carry a reply of any size, and a rebuild reads every entry back.
  // The raw length is refused before the clean runs, so a multi-megabyte `text` costs no more than an
  // over-long one. What is pinned is the outcome, not the wall clock: the words are gone and the mark stands.
  const big = `${"\u001B[2J".repeat(1000000)}${"x".repeat(1000000)}`;
  const read = userActionFrom(replyEntry(userActionWithText("uid-1", LATER, big)));
  expect(read).toBeDefined();
  expect(read).not.toHaveProperty("text");
  const rebuilt = reconstruct(
    [toolResultEntry(state([pin(1, "Decide X")], 2))],
    [replyEntry(userActionWithText("uid-1", LATER, big))],
  );
  expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  expect(rebuilt.view.pins[0]?.reply).toBeUndefined();
});

test("a hostile raw reply entry past the bound drops the words and keeps the mark", () => {
  // The refusal is the raw gate's, not the cleaned ceiling's: the fixture is long before the pass and short
  // after it, so deleting `text.length > MAX_TEXT_UNITS` from `replyTextOf` would let this text through on
  // `cleaned.length` alone. The refusal is still the field's, not the entry's: the words are gone and the
  // mark stands.
  // Counts derived from the bounds so a bump to either keeps the shape honest: `CLEAR` is four units the pass
  // eats, so the repeat puts the raw length past MAX_TEXT_UNITS while `SHORT` is all that survives it — and
  // the cleaned text has to fit MAX_REPLY_UNITS for this to isolate the raw gate rather than the ceiling.
  const hostile = `${CLEAR.repeat(Math.ceil((MAX_TEXT_UNITS + 1) / CLEAR.length))}${SHORT}`;
  // Raw past the pre-clean bound, cleaned within the reply's own ceiling — the shape that isolates the gate.
  expect(hostile.length).toBeGreaterThan(MAX_TEXT_UNITS);
  expect(cleanPinText(hostile).length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
  const read = userActionFrom(replyEntry(userActionWithText("uid-1", LATER, hostile)));
  expect(read).toBeDefined();
  expect(read).not.toHaveProperty("text");
});
