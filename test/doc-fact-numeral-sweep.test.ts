/**
 * The numeral sweep over the run board's own operative sentences. `doc-fact-numerals.test.ts` pins the
 * card's decoding; this file drives every count the shared spelled table holds through the two sentences
 * the run board states its arithmetic in, and reads each back through the readers in
 * `skills-board-readers.ts`.
 *
 * The shape these tests exist for: an operative count pattern that was unanchored, with the spelled
 * alternatives joined in table order, so a count whose prefix is itself a spelled count captured the
 * prefix. `cardinal` accepts every one of those prefixes as a valid count, so the reader returned a
 * plausible wrong number — `fourteen` as 4, `twenty-one` as 20 — and every equality check downstream of
 * it was satisfied by the wrong value rather than by the count the file states.
 */
import { expect, test } from "bun:test";

import {
  BACKLOG_CAP,
  NOW_ROWS,
  NUMERALS,
  cardinal,
  fold,
  numeral,
  readDoc,
} from "./doc-fact-fixtures.ts";
import {
  BOARD_SKILLS,
  PLUS_THOSE_HEAD,
  boardPath,
  replaceSpaced,
  statedBacklogCounts,
  statedCounts,
  statedNowCount,
} from "./skills-board-readers.ts";

/** Every count the shared table spells, so the sweep covers each spelling the reader has to tell apart. */
const EVERY_COUNT = NUMERALS.map((_, n) => n);

/** One operative sentence: the shipped words around its count, and what follows the count. */
interface Sentence {
  /** The shipped sentence, whose last word before the count is the rewrite point. */
  head: string;
  /** The words after the count — `Now` for the Now row, nothing for `plus those N`. */
  tail: string;
}

/** The run board's two arithmetic sentences; noni states its counts in the card and its build rule. */
const RUN_BOARD_SENTENCES: Sentence[] = [
  { head: PLUS_THOSE_HEAD, tail: "" },
  // The `Now` of the sentence is the group's name, not a count, so only the numeral varies. The head keeps
  // the capital the file ships the sentence with: the readers are case-sensitive and the sweep asserts
  // through them, so a lowercase `the` here would sweep a sentence no file contains.
  { head: "The board is one", tail: " Now" },
];

test("the reader scrapes every count the numeral table holds, in the run board's own sentences", () => {
  // Digits and words are swept together: the digit forms are the control that says the sweep itself, and
  // not the fix, is what changed the answer.
  for (const dir of BOARD_SKILLS) {
    const board = readDoc(boardPath(dir));
    const sentences = dir === "sticky-run-board" ? RUN_BOARD_SENTENCES : [];
    for (const n of EVERY_COUNT) {
      for (const { head, tail } of sentences) {
        for (const form of [numeral(n), String(n)]) {
          const before = head.slice(0, head.lastIndexOf(" ") + 1);
          // The shipped form of a head is its own n: rewriting it is a no-op, so the take-guard below —
          // which exists to catch a control whose target vanished — would report the shipped file.
          if (head.endsWith(` ${form}${tail}`)) continue;
          const mutated = replaceSpaced(board, head, `${before}${form}${tail}`);
          expect(mutated, `${dir}: ${n} (${form}) mutation took`).not.toBe(board);
          const scraped = statedCounts(mutated, false);
          if (tail === "") {
            // `plus those N` is the only operative count outside the card, and the shipped Now row is the
            // third count the file states, so the scrape is the two copies of the cap, the Now row, and n.
            expect(scraped, `${dir}: "${before}${form}" scrapes ${n} and nothing else`).toEqual([
              BACKLOG_CAP,
              NOW_ROWS,
              n,
            ]);
          } else {
            // The Now row is the third number the board states; a dead pattern there reports only the two
            // copies of the cap and so agrees with everything.
            expect(
              scraped,
              `${dir}: "${before}${form} Now" scrapes ${n} beside the two cap counts`,
            ).toEqual([BACKLOG_CAP, n, BACKLOG_CAP]);
            expect(statedNowCount(fold(mutated)), `${dir}: ${form} Now scrapes ${n}`).toBe(n);
            // Once a row carries a spelled numeral, the Backlog scrape has to carry it too — otherwise a
            // dead `The board is (N) Now` pattern reports only the card's two counts and agrees with all.
            if (!/^\d+$/.test(form)) {
              expect(
                statedBacklogCounts(mutated),
                `${dir}: ${form} Now is scraped by the Backlog loop too`,
              ).toContain(n);
            }
          }
        }
      }
    }
  }
});

test("the spelled alternatives are sorted longest-first as well as anchored, and each half catches a case the other misses", () => {
  // The two halves of the count pattern are not redundant. Measured against `plus those <word>` over the
  // whole spelled table, in the words of the shipped sentence:
  //   unanchored + table order   → `fourteen` reads `four` (and sixteen/seventeen/eighteen/nineteen their
  //                                prefixes); `twenty-one` splits into `twenty` and `one`
  //   anchored   + table order   → `twenty-one` still splits into `twenty` and `one`: each part sits at a
  //                                word boundary of its own, so only the longest-first sort stops it
  // A fix that did only one half would leave a wrong count on the screen and this sweep green.
  for (const [word, prefixValue] of [
    ["fourteen", 4],
    ["sixteen", 6],
    ["twenty-one", 20],
  ] as [string, number][]) {
    const sentence = `The board is one Now plus those ${word}, which leaves a slot`;
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
