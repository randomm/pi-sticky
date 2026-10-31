/**
 * The run board's own operative mutations, and the case policy that makes them readable. Split out of
 * `skills-board-budget.test.ts` to stay inside the 300-line cap; the cap arithmetic over both board skills
 * stays there, and the readers both files assert through live in `skills-board-readers.ts`.
 *
 * The run board states its counts only in the card and in "The board is one Now plus those three", so a
 * control over that sentence is the copy a card-only reader never sees — and the proof the pattern behind it
 * is live: a dead pattern reports no counts, which agrees with every cap.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { BACKLOG_CAP, NOW_ROWS, fold, numeral, readDoc } from "./doc-fact-fixtures.ts";
import {
  NOW_SENTENCE,
  NOW_SENTENCE_LOWER,
  PLUS_THOSE_HEAD,
  RUN_BOARD_ARITHMETIC,
  UNSPELLABLE_DIGITS as UNREADABLE_DIGITS,
  boardPath,
  replaceSpaced,
  statedBacklogCap,
  statedBacklogCounts,
  statedNowCount,
} from "./skills-board-readers.ts";
import { hasNowSentence } from "./skills-card-readers.ts";

test("the run board's operative mutations are read back through the reader, not through the bytes", () => {
  // A run board that instructs a three-row Now has to fail the checks the board test runs, not just report
  // a bigger scrape: `three` is the shipped Backlog cap, so folding the Now count into the cap comparison
  // blessed it — scrape [3,3,3], allAgree true, budget line green, 6+ pins on a 5-pin budget.
  const board = readDoc(boardPath("sticky-run-board"));
  const threeNow = replaceSpaced(board, NOW_SENTENCE, `The board is ${numeral(3)} Now`);
  expect(threeNow, "the three-Now mutation took").not.toBe(board);
  // The take-guard reads the reader. `replaceSpaced` builds a case-insensitive pattern, so a control written
  // in another casing rewrites whichever occurrence the file happens to use and reports the shipped text
  // back as mutated — the old `!== board` guard passed on a count that never moved.
  expect(
    statedNowCount(fold(threeNow)),
    "the three-Now control moved the count the assertions below read",
  ).not.toBe(statedNowCount(fold(board)));
  const threeNowCounts = statedBacklogCounts(threeNow);
  const threeNowCount = statedNowCount(fold(threeNow));
  expect(
    threeNowCount,
    "a run board instructing a three-row Now is not the shipped one Now",
  ).not.toBe(NOW_ROWS);
  expect(threeNowCounts, "the three-Now scrape is non-empty").not.toEqual([]);
  // The vacuous pass this replaces: `three` is the shipped cap, so the all-counts-agree loop the board test
  // runs over every stated count — cap comparison included — was satisfied by a 3-row Now.
  expect(
    threeNowCounts.every((count) => count === statedBacklogCap(threeNow)),
    "the all-counts-agree check alone would still bless a three-row Now",
  ).toBe(true);
  // …which is why the Now row is compared to its own count, and the board's own arithmetic to the budget.
  expect(
    (threeNowCount ?? 0) + BACKLOG_CAP + 1,
    "a run board whose own arithmetic overflows the budget fails the budget line",
  ).toBeGreaterThan(DEFAULT_CONFIG.maxPins);
  const boardCopy = replaceSpaced(board, PLUS_THOSE_HEAD, `plus those ${numeral(4)}`);
  expect(boardCopy, "the run board mutation took").not.toBe(board);
  const boardCounts = statedBacklogCounts(boardCopy);
  expect(boardCounts, "the mutated operative count is reported").toContain(BACKLOG_CAP + 1);
  expect(
    boardCounts.every((count) => count === statedBacklogCap(boardCopy)),
    "the mutated run board fails the all-counts-agree check",
  ).toBe(false);
  // …and the shipped copy still passes it, so the failure above is the mutation and not the reader. The Now
  // row's own count is the size of the Now group, not a Backlog count, so it is excluded from the all-agree
  // loop by name; an empty scrape is vacuously true for `every`, so it is proven non-empty first.
  const shippedBoardCounts = statedBacklogCounts(board);
  expect(
    shippedBoardCounts,
    "the shipped run board states counts the reader can scrape",
  ).not.toEqual([]);
  expect(
    shippedBoardCounts
      .filter((count) => count !== NOW_ROWS)
      .every((count) => count === statedBacklogCap(board)),
    "the shipped run board agrees with itself, its Now row excluded by name",
  ).toBe(true);
  // The `The board is (N) Now` pattern has its own control: that count is the size of the Now group, so it
  // is not compared to the cap, but it still has to be scraped — and scraped by the reader, not by bytes.
  const twoNow = replaceSpaced(board, NOW_SENTENCE, `The board is ${numeral(2)} Now`);
  expect(twoNow, "the Now-row mutation took").not.toBe(board);
  expect(
    statedNowCount(fold(twoNow)),
    "the two-Now control moved the count the assertions below read",
  ).not.toBe(statedNowCount(fold(board)));
  expect(statedBacklogCounts(twoNow), "the Now count is scraped too").toContain(NOW_ROWS + 1);
});

test("a reworded Now sentence fails by name, not as a smaller budget", () => {
  // The hole this closes: `statedNowCount` answers `null` for a sentence the scrape can no longer reach,
  // and `skills-board-budget.test.ts` reads that `null` as "no Now group" — the same answer noni legitimately
  // gives. Its budget line is `(nowCount ?? 0) + cap + 1 <= maxPins`, so a vanished Now row makes the
  // inequality *easier*: the shipped board sits exactly on the line (1 + 3 + 1 = 5) and the broken one lands
  // under it (0 + 3 + 1 = 4). Measured against the shipped text, every one of these mutations kept the whole
  // suite green before the presence assertion in `skills-board-budget.test.ts` was added.
  const board = readDoc(boardPath("sticky-run-board"));
  const rewordings: [string, string][] = [
    ["a reworded verb", "The board holds one Now"],
    ["a reworded noun", "The panel is one Now"],
    ["a line-initial lowercase", "the board is one Now"],
    ["the sentence deleted", "plus those"],
  ];
  // The run board hard-wraps its arithmetic sentence, so the needle is the folded file and the replacement
  // is written to the same fold. `replaceSpaced` is the repo's own spaced-replacement builder, which keeps
  // this immune to where the prose happens to be wrapped.
  const boardText = fold(board);
  for (const [label, replacement] of rewordings) {
    const mutated = replaceSpaced(boardText, RUN_BOARD_ARITHMETIC, replacement);
    expect(mutated, `"${label}": the mutation took`).not.toBe(boardText);
    // The reader's answer — the number the budget line actually consumes — is what makes the hole real:
    // `null`, indistinguishable from noni's legitimate absence.
    expect(statedNowCount(fold(mutated)), `"${label}": the reader reports no Now count`).toBeNull();
    expect(
      (statedNowCount(fold(mutated)) ?? 0) + BACKLOG_CAP + 1,
      `"${label}": the budget line is satisfied by the vanished Now row`,
    ).toBeLessThanOrEqual(DEFAULT_CONFIG.maxPins);
    // …which is why the presence assertion is the one that catches it, and it catches it by name.
    expect(
      fold(mutated),
      `"${label}": the board's own arithmetic is gone from the file`,
    ).not.toContain(RUN_BOARD_ARITHMETIC);
    expect(
      hasNowSentence(fold(mutated)),
      `"${label}": the Now row is no longer where it is read`,
    ).toBe(false);
  }
  // The control that says these failures belong to the reword and not to a dead presence check: the shipped
  // file satisfies both halves, and a copy that keeps the words but moves the count still carries them.
  expect(hasNowSentence(fold(board)), "the shipped board carries its Now row").toBe(true);
  expect(fold(board), "and states its arithmetic").toContain(RUN_BOARD_ARITHMETIC);
  // …through `statedNowCount`, not by rewriting the needle string: `NOW_SENTENCE` contains the word `one`,
  // which a plain string replacement of `one` would also hit in `is`/`Now`-adjacent words.
  const movedCount = replaceSpaced(board, PLUS_THOSE_HEAD, `plus those ${numeral(4)}`);
  expect(movedCount, "the moved-count control took").not.toBe(board);
  expect(hasNowSentence(fold(movedCount)), "a moved count keeps the Now row").toBe(true);
  expect(statedNowCount(fold(movedCount)), "and leaves the Now row the reader's own count").toBe(
    NOW_ROWS,
  );
  // A count the table cannot read still fails as a broken numeral, never as an absence — the distinction
  // this file exists for, asserted against the same sentence the presence check reads.
  const unreadableNow = replaceSpaced(board, NOW_SENTENCE, `The board is ${UNREADABLE_DIGITS} Now`);
  expect(unreadableNow, "the unreadable-count mutation took").not.toBe(boardText);
  expect(hasNowSentence(fold(unreadableNow)), "a broken count still carries the sentence").toBe(
    true,
  );
  expect(
    () => statedNowCount(fold(unreadableNow)),
    "…and fails by name rather than as no Now group",
  ).toThrow(new RegExp(`matched "${UNREADABLE_DIGITS}"`));
});

test("both readers agree on the Now sentence whatever casing it is written in", () => {
  // The regression: `statedNowCount` compiled its pattern with `i` while `operative("The board is ", " Now")`
  // compiled the same sentence with `g` alone. One sentence, two answers — the file reported a Now count to
  // one reader and none to the other — and the `!== original` take-guards could not see it, because the
  // case-insensitive control rewrote whichever occurrence the file happened to use. The file writes the
  // sentence at the head of a line, right after the card's bold, so the capital IS the shipped form and the
  // mid-sentence lowercase is the casing no reader may read.
  const board = readDoc(boardPath("sticky-run-board"));
  // The shipped file states its Now count to both readers, so the agreement below is about a count that
  // exists rather than about two readers that both read nothing.
  expect(statedNowCount(fold(board)), "the Now reader reads the shipped capital").toBe(NOW_ROWS);
  expect(statedBacklogCounts(board), "the Backlog reader reads it too").toContain(NOW_ROWS);
  // A sentence in the casing the file does not use states no count to either reader — an agreement worth
  // nothing, which is why it is pinned here once and never counted as a control that took.
  expect(
    statedNowCount(fold("the board is three Now")),
    "no reader reads a mid-sentence casing",
  ).toBeNull();
  expect(statedBacklogCounts("the board is three Now"), "nor the Backlog reader").toEqual([]);
  for (const casing of [NOW_SENTENCE, NOW_SENTENCE_LOWER]) {
    // The mutation moves the Now row to the Backlog cap's own numeral, which is the whole point: `three`
    // is what the shipped card states, so a three-row Now is indistinguishable from a legitimate board to
    // any check that compares counts without naming which is which. Named as a count, not written as a
    // literal, so the expectations below stay the reader's answers rather than numbers of the same family
    // as `maxPins`.
    const mutatedNow = casing.replace("one", numeral(BACKLOG_CAP));
    // The take-guard, made semantic. A control built on the casing the file does NOT use rewrites the
    // shipped capital and still reports the file back as mutated, so the byte guard passes on a file whose
    // Now row the readers can no longer read at all.
    const mutated = replaceSpaced(board, NOW_SENTENCE, mutatedNow);
    expect(mutated, `"${casing}": the rewrite itself took`).not.toBe(board);
    expect(statedNowCount(fold(mutated)), `"${casing}": the Now reader's answer`).toBe(
      casing === NOW_SENTENCE ? BACKLOG_CAP : null,
    );
    // Measured against the shipped file: a real mutation carries its count into the Backlog scrape too, and
    // a control on the unreadable casing leaves the scrape with only the two copies of the card's cap. Both
    // sides composed from `BACKLOG_CAP` — the scrape is the card's cap, the bold restatement and the moved
    // Now row (or the two card copies alone), and each of those is `BACKLOG_CAP` by construction. A literal
    // here was a sibling of the number `maxPins` sets, so raising the budget silently inverted the claim.
    expect(
      statedBacklogCounts(mutated),
      `"${casing}": the Backlog scrape of the mutated file`,
    ).toEqual(
      casing === NOW_SENTENCE
        ? [BACKLOG_CAP, BACKLOG_CAP, BACKLOG_CAP]
        : [BACKLOG_CAP, BACKLOG_CAP],
    );
    // A real control's answer is the answer the same sentence gives on its own: one function, one reply,
    // whether it is handed the file or the sentence pulled out of it.
    if (casing === NOW_SENTENCE) {
      expect(statedNowCount(fold(mutated)), `"${casing}": file and sentence agree`).toBe(
        statedNowCount(fold(mutatedNow)),
      );
    }
  }
});
