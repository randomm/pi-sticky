/**
 * The count readers' digit discipline, pinned at the two places a count reaches state: the card parser in
 * `doc-fact-fixtures.ts` and the operative scrapers in `skills-board-readers.ts`.
 *
 * A count is only useful if the number the reader reports is the number the doc wrote. Digits fail that
 * differently from words: an out-of-range digit string is refused by `cardinal` and so voids the card,
 * while `numeral` spells a count above the spelled table as digits that `cardinal` then refuses — a count
 * the same module writes and cannot read back. These tests pin both halves of that round-trip.
 */
import { expect, test } from "bun:test";

import { MAX_PINS } from "../src/bounds.ts";
import {
  BACKLOG_CAP,
  MAX_COUNT,
  NUMERALS,
  budgetCard,
  cardCounts,
  cardinal,
  numeral,
} from "./doc-fact-fixtures.ts";
import {
  statedBacklogCap,
  statedBacklogCounts,
  statedCounts,
  statedNowCount,
} from "./skills-board-readers.ts";

/** One card-shaped sentence with `cap` and `budget` written exactly as the doc would write them. */
const cardWith = (cap: string, budget: string): string =>
  `${cap} rows at the default budget of ${budget}; with a smaller \`PI_STICKY_MAX_PINS\`, drop Backlog rows from the bottom`;

test("a card whose digits no decoder accepts is no card, never a pair of in-range counts", () => {
  // The shape the reviewer flagged: `42` is longer than any count the docs state, and an accepting pattern
  // that lets a digit run be read in pieces would report `4` and `2` — two counts, each in range, each
  // plausible, and each satisfied by the cap comparison downstream. Measured against the shipped reader it
  // is `null` instead: `cardinal` refuses `42`, `cardCounts` refuses any card with an unreadable numeral,
  // and the scrapers report no count for it. This pins that so a future DIGITS widening cannot regress it.
  const text = cardWith("42", "5");
  expect(cardCounts(text), "the 42/5 card is a parse failure").toBeNull();
  expect(statedBacklogCap(text), "and yields no Backlog cap").toBeNull();
  expect(statedCounts(text, true), "and the scrapers report no 4 and no 2").not.toContain(4);
  expect(statedBacklogCounts(text), "and nothing to compare against the cap").toEqual([]);
  // The same refusal for the budget half, which the cap-only reader never looks at.
  expect(cardCounts(cardWith("3", "42")), "an unreadable budget voids the card too").toBeNull();
});

test("every digit 0..MAX_COUNT still scrapes through the card path, and MAX_COUNT+1 does not", () => {
  // The other direction of the same boundary: the refusal above must not become a refusal of everything.
  for (let n = 0; n <= MAX_COUNT; n++) {
    const text = cardWith(String(n), String(MAX_COUNT));
    expect(cardCounts(text), `the card reads ${n} in digits`).toEqual({
      cap: n,
      budget: MAX_COUNT,
    });
    expect(statedBacklogCap(text), `${n} reads through the scraper`).toBe(n);
  }
  expect(cardinal(String(MAX_COUNT + 1)), "one past the bound is no count").toBeNull();
  expect(
    cardCounts(cardWith(String(MAX_COUNT + 1), String(MAX_COUNT))),
    "and voids the card",
  ).toBeNull();
});

test("the operative digit counts scrape whole, and a count above the bound scrapes as nothing", () => {
  // The run board's sentences carry digits too, and their tails vary — including the empty tail after
  // `plus those N`, the one site with no following word to stop a digit run. The Now row is written in the
  // casing the file ships it in: the readers are case-sensitive, so a lowercase `the` would prove the digit
  // path against a sentence no file contains.
  for (let n = 0; n <= MAX_COUNT; n++) {
    expect(
      statedCounts(`The board is one Now plus those ${n}, which leaves a slot`, false),
      `plus those ${n} scrapes ${n}`,
    ).toEqual([1, n]);
    expect(statedNowCount(`The board is ${n} Now`), `${n} Now scrapes ${n}`).toBe(n);
  }
  for (const digits of ["42", "34", "100"]) {
    expect(
      statedCounts(`The board is one Now plus those ${digits}, which leaves a slot`, false),
      `plus those ${digits} reports no count`,
    ).toEqual([1]);
    expect(statedNowCount(`The board is ${digits} Now`), `${digits} Now is no count`).toBeNull();
  }
});

test("numeral refuses what cardinal cannot read, so the round-trip has no one-way spelling", () => {
  // Measured against the shipped fixtures: `numeral(25)` returned "25" while `cardinal("25")` returned
  // null, so a builder handed a count above the spelled table produced a doc no reader of the same module
  // could read — and the reader's answer was "no count", not "here is the bad numeral".
  for (const n of [25, 30, 100, -1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => numeral(n), `numeral(${n}) is refused`).toThrow();
  }
  // Every count the table holds still round-trips, digits included, so the guard above is a boundary and
  // not a refusal of the table itself.
  for (let n = 0; n < NUMERALS.length; n++) {
    expect(cardinal(numeral(n)), `numeral(${n}) spells a count cardinal reads back`).toBe(n);
    expect(cardinal(String(n)), `${n} in digits reads back too`).toBe(n);
  }
  // The top of the bound is spelled from the table, not emitted as digits — that is the whole point of the
  // guard: a count inside the bound always gets a word `cardinal` decodes by table index.
  // The gate is the TABLE, not the numeric bound `MAX_COUNT` it is supposed to mirror: the two are equal
  // today only because of the load-bearing check at the top of the module, so a `?? String(n)` fallback
  // behind the bound check is invisible until a bound moves. `MAX_COUNT + 1` is the first value past the
  // last word, and it used to come back as a digit card no reader of this module could parse.
  expect(() => numeral(MAX_COUNT + 1), "one past the bound throws, not digits").toThrow();
  expect(() => numeral(NUMERALS.length), "one past the last word throws too").toThrow();
  const top = NUMERALS[MAX_COUNT];
  const cap = NUMERALS[BACKLOG_CAP];
  if (top === undefined || cap === undefined)
    throw new Error("the numeral table is shorter than its bound");
  expect(numeral(MAX_COUNT), "the top of the bound is spelled, not emitted as digits").toBe(top);
  // MAX_COUNT is the bound the tests above sweep, so it cannot drift away from the config silently.
  expect(MAX_COUNT, "the bound covers the whole pin range").toBeGreaterThanOrEqual(MAX_PINS);
  expect(numeral(BACKLOG_CAP), "the shipped cap spells").toBe(cap);
});

test("the builders that go through numeral refuse an out-of-range count rather than emit digits", () => {
  // A decoy builder that silently degraded to digits built a sentence whose count the reader refused, so
  // the control it fed looked like a clean file.
  expect(() => budgetCard(MAX_COUNT + 1)).toThrow();
  expect(() => budgetCard(-1)).toThrow();
  expect(budgetCard(BACKLOG_CAP), "the shipped card still builds").toContain(
    `${NUMERALS[BACKLOG_CAP] ?? ""} rows at the default budget of`,
  );
});
