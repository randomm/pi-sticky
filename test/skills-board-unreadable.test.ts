/**
 * A count the doc states and the reader cannot decode is a **failure**, never an absence. The defect this
 * file kills: `cardinal` answers `null` both for "this span is not a count" and for "this span is a count the
 * accepting pattern took and the numeral table cannot decode", and the readers exposed only the first
 * meaning. A run board whose operative sentence said `plus those 25` therefore scraped `[3, 1]` — the card's
 * cap and the Now row — and every downstream comparison against that shorter list stayed green, exactly the
 * vacuous pass this ticket's doc-fact layer exists to close. Measured against the reader before the fix, the
 * three mutations below each passed every assertion in the suite.
 *
 * Every refusal here is paired with a control that must still read: the same file with its shipped sentence
 * (so the throw belongs to the broken numeral and not to a dead reader), and the same sentence with a count
 * inside the bound (so the refusal tracks the span, not the sentence shape).
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";

import { BACKLOG_CAP, NOW_ROWS, NUMERALS, fold, numeral, readDoc } from "./doc-fact-fixtures.ts";
import {
  NOW_SENTENCE,
  PLUS_THOSE_HEAD,
  boardPath,
  replaceSpaced,
  statedBacklogCap,
  statedBacklogCounts,
  statedBudget,
  statedCounts,
  statedNowCount,
  statedUndecodableOperatives,
} from "./skills-board-readers.ts";
import { statedUndecodableCards } from "./skills-card-readers.ts";

/**
 * A count the accepting pattern admits and the decoder refuses: one past the top of the spelled table, which
 * `DIGITS` still matches (the bound is `MAX_COUNT`, and the digit cap is its digit count). `numeral` refuses
 * to emit it, which is what makes it a *doc* defect rather than one a builder could introduce by accident —
 * so it is written here as the bytes a hand-edited skill would carry.
 */
const UNREADABLE = String(NUMERALS.length);

/** The shipped run board, read once. */
const board = readDoc(boardPath("sticky-run-board"));

test("an operative count the table cannot decode fails by name instead of vanishing from the scrape", () => {
  // The run board's operative sentence, mutated to state a count in the band the accepting pattern admits
  // and `cardinal` refuses. Before the fix this mutation was invisible: the span dropped out of the scrape
  // and the file reported the two card counts plus the Now row, which agreed with everything.
  const mutated = replaceSpaced(board, PLUS_THOSE_HEAD, `plus those ${UNREADABLE}`);
  expect(mutated, "the unreadable-count mutation took").not.toBe(board);
  expect(fold(mutated), "and the operative sentence carries it").toContain(
    `plus those ${UNREADABLE}`,
  );
  // The readers no longer answer with an absence: each names the raw span and where it sits.
  expect(
    () => statedBacklogCounts(mutated),
    "the Backlog scrape names the unreadable span rather than reporting a shorter list",
  ).toThrow(new RegExp(`matched "${UNREADABLE}"`));
  expect(() => statedCounts(mutated, true), "the budget-inclusive scrape names it too").toThrow(
    new RegExp(`matched "${UNREADABLE}"`),
  );
  // The message identifies the span, not just "no counts": a reader that threw a bare error would leave the
  // author hunting for the sentence.
  const message = thrownMessage(() => statedBacklogCounts(mutated));
  expect(message, "the failure names the sentence it read").toContain("operative");
  expect(message, "and the raw bytes").toContain(UNREADABLE);
  expect(/offset \d+/.test(message), "and the offset").toBe(true);
  // The reader's non-throwing question, for a caller that wants the list rather than the exception.
  expect(
    statedUndecodableOperatives(mutated),
    "the broken span is recorded exactly once, as an operative count",
  ).toEqual([{ raw: UNREADABLE, at: expect.any(Number), of: "operative" }]);
  // The control: the shipped file reads, and states no unreadable span anywhere. Without this the throw
  // above would be indistinguishable from a dead pattern.
  expect(statedBacklogCounts(board), "the shipped run board still scrapes its counts").toEqual([
    BACKLOG_CAP,
    NOW_ROWS,
    BACKLOG_CAP,
  ]);
  expect(statedUndecodableOperatives(board), "and has no unreadable span").toEqual([]);
  expect(statedUndecodableCards(fold(board)), "or an unreadable card").toEqual([]);
  // …and the same sentence with a count the table does hold reads, so the refusal tracks the numeral and
  // not the shape of the sentence.
  const readable = replaceSpaced(board, PLUS_THOSE_HEAD, `plus those ${numeral(BACKLOG_CAP)}`);
  expect(statedBacklogCounts(readable), "the readable copy of the sentence reads").toEqual([
    BACKLOG_CAP,
    NOW_ROWS,
    BACKLOG_CAP,
  ]);
});

test("an unreadable Now row fails the Now reader instead of reporting no Now count", () => {
  // The other half of the conflation: `statedNowCount` returned `null` for an unreadable Now row, which is
  // the same answer a file with no Now group gives — and `skills-board-budget.test.ts` asserts exactly that
  // `null` for noni. A run board whose Now row no reader can decode therefore looked like a file that has no
  // Now row at all, and its budget line (`Now + Backlog + 1 <= maxPins`) was satisfied by `Now = 0`.
  const mutated = replaceSpaced(board, NOW_SENTENCE, `The board is ${UNREADABLE} Now`);
  expect(mutated, "the unreadable Now-row mutation took").not.toBe(board);
  expect(fold(mutated), "and the Now row carries it").toContain(`The board is ${UNREADABLE} Now`);
  expect(
    () => statedNowCount(fold(mutated)),
    "the Now reader names the unreadable span instead of reporting no Now group",
  ).toThrow(new RegExp(`matched "${UNREADABLE}"`));
  expect(
    () => statedBacklogCounts(mutated),
    "and it is refused by the Backlog scrape the budget test loops over",
  ).toThrow(new RegExp(`matched "${UNREADABLE}"`));
  // The message says which sentence, so the two readers' failures are not confusable.
  expect(String(thrownMessage(() => statedNowCount(fold(mutated)))), "names the Now row").toContain(
    "Now row",
  );
  // Controls: the shipped file answers `NOW_ROWS`, and the same sentence with a decodable count answers it
  // too — so neither refusal above is the reader having stopped matching.
  expect(statedNowCount(fold(board)), "the shipped Now row reads").toBe(NOW_ROWS);
  const readable = replaceSpaced(board, NOW_SENTENCE, `The board is ${numeral(2)} Now`);
  expect(statedNowCount(fold(readable)), "a readable two-row Now reads").toBe(2);
  // A file with no Now row at all still answers `null` rather than throwing: the absence is a real state
  // (noni has no Now group) and must stay distinguishable from the broken numeral.
  expect(statedNowCount(fold(readDoc(boardPath("sticky-noni")))), "noni has no Now row").toBeNull();
});

test("an unreadable card numeral fails the cap and budget readers instead of reading as no card", () => {
  // `cardCounts` folds "no card" and "a card whose numeral nothing decodes" into one `null`, so the two
  // readers over it used to report a broken card as a cardless file. The card is the one sentence every
  // budget assertion is anchored on, so a doc with a broken card numeral was reported as *having no budget*.
  // Only the cap half carries the unreadable numeral: the needle is the card's cap plus the words up to
  // its budget, so the budget side stays readable and the failure can be blamed on one span.
  const mutated = replaceSpaced(
    board,
    `${numeral(BACKLOG_CAP)} rows at the default budget of`,
    `${UNREADABLE} rows at the default budget of`,
  );
  expect(mutated, "the unreadable card mutation took").not.toBe(board);
  expect(
    () => statedBacklogCap(mutated),
    "the cap reader names the unreadable card instead of saying there is no card",
  ).toThrow(new RegExp(`a card's cap matched "${UNREADABLE}"`));
  expect(() => statedBudget(mutated), "…and so does the budget reader").toThrow(
    new RegExp(`a card's cap matched "${UNREADABLE}"`),
  );
  // The budget half, which the cap-only reader never looks at: the same conflation, its own span.
  const badBudget = replaceSpaced(
    board,
    `budget of ${numeral(BACKLOG_CAP + 2)};`,
    `budget of ${UNREADABLE};`,
  );
  expect(badBudget, "the budget-half mutation took").not.toBe(board);
  expect(() => statedBudget(badBudget), "an unreadable budget names itself as the budget").toThrow(
    /a card's budget/,
  );
  // Both readers refuse the file (a card is one object: an unreadable half voids the whole card), but the
  // message names the half that is actually broken — which is the distinction `cardCounts`' single `null`
  // could not carry.
  expect(
    () => statedBacklogCap(badBudget),
    "the cap reader refuses the file too, but names the budget as the broken half",
  ).toThrow(/a card's budget/);
  // Controls: the shipped card reads on both readers and states no unreadable span; the mutated files name
  // exactly the span that was broken, in the half it sits in.
  expect(statedBudget(board), "the shipped card still reads its budget").toBe(
    DEFAULT_CONFIG.maxPins,
  );
  expect(statedUndecodableCards(fold(board)), "the shipped card has no unreadable span").toEqual(
    [],
  );
  expect(statedUndecodableCards(fold(mutated)), "the cap mutation names its cap").toEqual([
    { raw: UNREADABLE, at: expect.any(Number), of: "cap" },
  ]);
  expect(statedUndecodableCards(fold(badBudget)), "the budget mutation names its budget").toEqual([
    { raw: UNREADABLE, at: expect.any(Number), of: "budget" },
  ]);
});

/** The message of the error `run` throws, so a test can assert on its contents rather than only its type. */
function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a throw, got none — the unreadable span was silently dropped again");
}
