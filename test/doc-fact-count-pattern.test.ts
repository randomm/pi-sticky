/**
 * The two halves of the operative count pattern, each pinned to a case the other misses. The readers in
 * `skills-board-readers.ts` compile every operative count from `anchoredCountPattern()`: the spelled
 * alternatives joined longest-first and wrapped in word boundaries. Only one of those halves is
 * load-bearing in the way the header beside it claimed, and the measurement that found so is pinned here
 * rather than left in a comment — the defect class this ticket is about is a doc-fact assertion that
 * cannot fail, and a half-fix control that cannot fail is the same defect wearing a test's clothes.
 *
 * Measured in the run board's `plus those <word>` — `operative("plus those ", "")`, the readers' one
 * tail-less slot. Over the whole spelled table and all six operative slots it is the only shape in which
 * either half is observable: any trailing literal makes the engine backtrack off a short match onto the
 * longer alternative, so in `The board is N Now` or `cap is **N rows**` even a pattern with both halves
 * broken reads every count, and a control written there could never fail.
 */
import { expect, test } from "bun:test";

import { MAX_COUNT, NUMERALS, anchoredCountPattern, cardinal } from "./doc-fact-fixtures.ts";
import { statedCounts } from "./skills-board-readers.ts";

/**
 * The digits leg of the accepting pattern, spelled out of `MAX_COUNT` rather than re-typed as a literal,
 * so a bound that moves cannot leave the half-fix patterns below describing an older accepting side.
 *
 * The shipped pattern nests the full spelled table inside its own alternation, so a half-fix that dropped
 * the spelled words from the outer list alone would still match them through the inner one and read every
 * count correctly — a control that cannot fail. Table order is therefore substituted into **both** spelled
 * legs of the forms below, which is the only shape that re-creates the bug the sort was added to fix.
 */
const COUNT_DIGITS = String.raw`(?:0|[1-9]\d{0,${String(MAX_COUNT).length - 1}})`;
/** The spelled-or-digit alternation the shipped pattern nests inside its own longest-first list. */
const COUNT_FORM = String.raw`(?:${NUMERALS.join("|")}|${COUNT_DIGITS})`;

/** One mutated copy of the accepting pattern, named for the half of it it puts back. */
interface Form {
  label: string;
  /** Which of the two halves this form gives up. */
  givesUp: "sort" | "anchors" | "both" | "neither";
  body: string;
}

/** Longest-first, the way `anchoredCountPattern()` orders its spelled alternatives. */
function byLengthDesc(a: string, b: string): number {
  return b.length - a.length;
}

/** The spelled alternatives in table order — the order they are declared in, not sorted. */
function tableOrder(): string {
  return NUMERALS.join("|");
}

/** The four shapes: shipped, sort given up, anchors given up, both given up. */
const FORMS: Form[] = [
  { label: "the shipped pattern", givesUp: "neither", body: anchoredCountPattern() },
  { label: "table order", givesUp: "sort", body: `\\b(?:${tableOrder()}|${COUNT_FORM})\\b` },
  {
    label: "unanchored",
    givesUp: "anchors",
    body: `(?:${[...NUMERALS].sort(byLengthDesc).join("|")}|${COUNT_FORM})`,
  },
  {
    label: "table order, unanchored",
    givesUp: "both",
    body: `(?:${tableOrder()}|${COUNT_FORM})`,
  },
];

/** Is `text` one of the spelled alternatives the table holds? */
function isSpelled(text: string): boolean {
  return (NUMERALS as readonly string[]).includes(text);
}

/**
 * The run board's tail-less `plus those N` slot, read through `body`: the only one of the readers'
 * operative sentences in which the order of the spelled alternatives, or their anchors, is observable at
 * all. The `The board is one Now` prefix is the sentence the file ships the clause in.
 */
function readSlot(body: string, word: string): (number | null)[] {
  const slot = new RegExp(`plus those (${body})`, "g");
  return [...`The board is one Now plus those ${word}`.matchAll(slot)].map((m) =>
    cardinal(m[1] ?? ""),
  );
}

/**
 * Does the whole-word gate `^(body)$` read `text` as exactly this count and nothing else? The shape the
 * readers decode through — `cardinal` wraps the same body in `^…$` — so a form that matches a *prefix* of a
 * word here is a form whose count the reader would take for the whole word.
 */
function readsWhole(body: string, text: string): boolean {
  const match = new RegExp(`^(${body})$`).exec(text);
  return match !== null && match[1] === text;
}

test("each half of the count pattern catches a case the other misses, measured in the tail-less slot", () => {
  // What the sweep measures, in the run board's own `plus those <word>` — the readers'
  // `operative("plus those ", "")`, which puts nothing after the count:
  //
  // * **The slot has to be tail-less.** Over the whole spelled table and all six operative slots, the
  //   tail-less one is the only shape in which either half of the pattern is observable: any trailing
  //   literal makes the engine backtrack off a short match onto the longer alternative, so in
  //   `The board is N Now` or `cap is **N rows**` even a pattern with both halves broken reads every
  //   count. A control written in a tailed slot cannot fail; the assertions below use the tail-less one.
  // * **The sort is load-bearing for the `twenty-*` words.** Joined in table order, `twenty-one` splits and
  //   the reader reports 20: `twenty` and `one` each sit at a word boundary of their own, so the word
  //   boundaries do not stop it. That is the case only the sort settles, and the reason the sort exists.
  // * **The anchors are NOT what stops a short word reading a longer one.** That claim stood here before,
  //   and it is false against the shipped pattern: the pattern nests the whole spelled table as a second
  //   alternation, so with the anchors removed `fourteen` still matches whole through that leg — measured
  //   below over every word the table holds, for the form that drops only the anchors. The other two forms
  //   give up the sort as well, so the prefix readings they produce belong to that half and are asserted
  //   for it, not blamed on the anchors.
  const tableForm = FORMS.find((form) => form.givesUp === "sort");
  const bothForm = FORMS.find((form) => form.givesUp === "both");
  const anchorsForm = FORMS.find((form) => form.givesUp === "anchors");
  if (!tableForm || !bothForm || !anchorsForm) {
    throw new Error("a half-fix form this sweep compares against is missing");
  }
  for (const { label, givesUp, body } of FORMS) {
    for (const word of NUMERALS) {
      const count = cardinal(word);
      if (count === null) throw new Error(`"${word}" is not a count the reader's table decodes`);
      const read = readSlot(body, word);
      const parts = word.split("-").filter(isSpelled);
      if (givesUp === "anchors") {
        // The nested spelled leg still matches every whole word, so no count in the table changes. This is
        // the measurement that retires the old "the anchors stop `fourteen` reading `four`" claim.
        expect(read, `${label}: "${word}" still reads ${count}`).toEqual([count]);
      } else if (givesUp === "sort") {
        if (parts.length > 1) {
          const prefix = cardinal(parts[0] ?? "");
          expect(
            read,
            `${label}: joined in table order, "${word}" splits and the reader reports its prefix`,
          ).toEqual([prefix]);
          expect(read, `${label}: "${word}" is not the count the file wrote`).not.toEqual([count]);
          expect(
            readSlot(anchoredCountPattern(), word),
            `${label}: the shipped pattern reads "${word}" where this one reads its prefix`,
          ).toEqual([count]);
        } else {
          expect(read, `${label}: "${word}" still reads whole`).toEqual([count]);
        }
      } else if (givesUp === "both") {
        // Every word that another table entry prefixes — the five `-*teen` words and the `twenty-*` pair —
        // is read as that shorter entry. The whole spelled table is swept; a subset chosen by hand would
        // hide whichever half stopped paying.
        const shadowed = NUMERALS.filter((other) => other !== word && word.startsWith(other)).sort(
          byLengthDesc,
        );
        if (shadowed.length > 0) {
          const prefix = cardinal(shadowed[0] ?? "");
          expect(
            read,
            `${label}: "${word}" is read as the shorter table word "${shadowed[0]}"`,
          ).toEqual([prefix]);
          expect(read, `${label}: "${word}" is not the count the file wrote`).not.toEqual([count]);
        } else {
          expect(read, `${label}: "${word}" still reads whole`).toEqual([count]);
        }
      } else {
        expect(read, `${label}: "${word}" reads ${count}`).toEqual([count]);
      }
    }
  }
  // The two forms must actually differ from the shipped pattern where each names its half, or the form is
  // a copy and proves nothing: the sort's form splits `twenty-one`, and the both-halves form additionally
  // reads `fourteen` as its prefix where the anchors-only form does not.
  expect(
    readSlot(anchorsForm.body, "fourteen"),
    "dropping the anchors alone does not break a count",
  ).toEqual([14]);
  expect(
    readSlot(bothForm.body, "fourteen"),
    "…and dropping the sort with it does — so the prefix reading is the sort's absence, not the anchors'",
  ).toEqual([4]);
  // The readings the fix was for, stated against the reader itself rather than a copy of its pattern: a
  // tail-less `plus those <word>` must give the reader one count, the right one, never its prefix.
  for (const [word, prefixValue] of [
    ["fourteen", 4],
    ["sixteen", 6],
    ["twenty-one", 20],
  ] as [string, number][]) {
    const sentence = `The board is one Now plus those ${word}`;
    const count = cardinal(word);
    // The prefix a half-fix would still report: `fourteen` as `four`, `twenty-one` as `twenty`.
    if (count === null) throw new Error(`"${word}" is not a count the reader's table decodes`);
    expect(
      statedCounts(sentence, false),
      `"plus those ${word}": one count, and the right one`,
    ).toEqual([1, count]);
    expect(
      count,
      `"plus those ${word}": the count is not the ${prefixValue} its prefix spells`,
    ).not.toBe(prefixValue);
  }
  // `twenty-one` is the case only the sort settles, since both of its parts are table words at boundaries.
  expect(cardinal("twenty-one"), "twenty-one is one count").toBe(21);
  expect(cardinal("twenty"), "and twenty is a different count").toBe(20);
});

test("the word boundaries are what keep a spelled count from being read inside a longer word", () => {
  // The narrow, true claim about the anchors, measured where the nested spelled leg cannot mask it: a word
  // that *contains* a table count but is not one. Such a word never reaches `cardinal` today — the `^(…)$`
  // gate the readers decode through refuses it — but an operative pattern with its boundaries removed does
  // match the count inside it, which is what an un-anchored leg would hand the reader.
  const notCounts = ["eighty", "seventy", "ninety", "fourteenfold", "oneness", "thirteenfold"];
  const spelledAlone = `(?:${[...NUMERALS].sort(byLengthDesc).join("|")})`;
  for (const { label, givesUp, body } of FORMS) {
    const anchored = givesUp === "sort" || givesUp === "neither";
    for (const word of notCounts) {
      const slotReads = readSlot(body, word);
      const gateReads = readsWhole(body, word);
      if (anchored) {
        // Anchored, in either order: no non-count reaches the reader, at the slot or through the gate.
        expect(slotReads, `${label}: "${word}" is not read as a count at the slot`).toEqual([]);
        expect(gateReads, `${label}: "${word}" is not a count through the gate`).toBe(false);
      } else {
        // Un-anchored: the spelled leg finds a count inside the word. This is the assertion the anchors
        // have to be able to fail on, and the reason they are load-bearing.
        expect(
          new RegExp(spelledAlone).test(word),
          `${label}: "${word}" does contain a spelled count for an un-anchored leg to find`,
        ).toBe(true);
        expect(
          slotReads.length,
          `${label}: the anchors are gone, so a spelled count inside "${word}" is matched at the slot`,
        ).toBe(1);
        // …and the gate is what still refuses it, so the claim stays honest about which half saves which.
        expect(gateReads, `${label}: the gate still refuses "${word}"`).toBe(false);
      }
    }
  }
  // The gate is the readers' own shape — `cardinal` wraps the same body in ^…$ — so the shipped pattern
  // accepts every table count and refuses every non-count above.
  for (const word of NUMERALS) {
    expect(
      readsWhole(anchoredCountPattern(), word),
      `the shipped pattern reads "${word}" as the whole word`,
    ).toBe(true);
  }
  for (const word of notCounts) {
    expect(
      readsWhole(anchoredCountPattern(), word),
      `the shipped pattern refuses "${word}" as a count`,
    ).toBe(false);
  }
  // Each half-fix form must actually differ from the shipped one where it names its half, or it is a copy
  // of the shipped pattern and proves nothing.
  const anchorsForm = FORMS.find((form) => form.givesUp === "anchors");
  const tableForm = FORMS.find((form) => form.givesUp === "sort");
  if (!anchorsForm || !tableForm)
    throw new Error("a half-fix form this test compares against is missing");
  expect(
    readSlot(anchorsForm.body, "eighty").length,
    "un-anchored, the slot matches a spelled count inside `eighty`",
  ).toBe(1);
  expect(readSlot(anchoredCountPattern(), "eighty"), "…and the shipped pattern does not").toEqual(
    [],
  );
  expect(
    readSlot(anchoredCountPattern(), "twenty-one"),
    "the shipped form reads twenty-one whole",
  ).toEqual([21]);
  expect(readSlot(tableForm.body, "twenty-one"), "…and the table-order form does not").toEqual([
    20,
  ]);
});
