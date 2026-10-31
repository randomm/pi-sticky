/**
 * The sweep over the run board's own operative sentences. `doc-fact-numerals.test.ts` pins the card's
 * decoding; this file drives every count the shared spelled table holds through the two sentences the run
 * board states its arithmetic in, and reads each back through the readers in `skills-board-readers.ts`. The
 * two halves of the operative count pattern those sentences are read with are driven beside it, in
 * `doc-fact-count-pattern.test.ts`, since a claim about a pattern is worth only what a mutated copy of that
 * pattern can actually fail on.
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
  anchoredCountPattern,
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

/**
 * The one accepting pattern the readers compile their operative counts from, and the matcher this sweep
 * asks a mutated sentence's count against. `skills-board-readers.ts` builds every operative pattern from
 * `anchoredCountPattern()`; the sweep used to claim it exercised that pattern while its inputs were
 * substituted straight into the shipped sentence, so the longest-first sort the claim rests on lived in
 * the readers and was never driven. Asking each form through the exported source is what makes "the
 * accepting pattern reads this form" a premise the sweep checks rather than assumes.
 */
const ACCEPTING = new RegExp(`(${anchoredCountPattern()})`, "g");

/**
 * Does the exported accepting pattern read `form` as exactly one count, and that count `n`? A form the
 * pattern will not take is not a count the reader can be blamed for misreading, so the sweep skips it —
 * but skips it *after* recording that it did, which is what keeps the sweep from quietly narrowing itself
 * to the forms that happen to match.
 */
function acceptsExactly(form: string, n: number): boolean {
  ACCEPTING.lastIndex = 0;
  const read = [...`x ${form} y`.matchAll(ACCEPTING)].map((m) => cardinal(m[1] ?? ""));
  return read.length === 1 && read[0] === n;
}

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
  let skipped = 0;
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
          // The premise, checked through the exported accepting pattern rather than assumed: if the one
          // pattern the readers share will not read this form as `n`, the scrape below cannot be expected
          // to report `n`, and the sweep would be asserting a defect the source does not have.
          const accepted = acceptsExactly(form, n);
          if (!accepted) {
            skipped += 1;
            continue;
          }
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
  // The sweep is only as wide as the accepting pattern lets it be. Every form the exported pattern
  // refuses is reported rather than silently dropped, so a narrowing of the accepting side (a count that
  // stopped being a count) shows up here as a widening list instead of as a shorter, greener sweep.
  expect(skipped, "every form in the table is accepted by the exported pattern").toBe(0);
});
