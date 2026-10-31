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
import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  BACKLOG_CAP,
  MAX_COUNT,
  NUMERALS,
  budgetCard,
  cardCounts,
  cardinal,
  fold,
  numeral,
} from "./doc-fact-fixtures.ts";
import {
  statedBacklogCap,
  statedBacklogCounts,
  statedBudget,
  statedCounts,
  statedNowCount,
  statedUndecodableOperatives,
} from "./skills-board-readers.ts";
import { cardUnreadable } from "./skills-card-readers.ts";

/** One card-shaped sentence with `cap` and `budget` written exactly as the doc would write them. */
const cardWith = (cap: string, budget: string): string =>
  `${cap} rows at the default budget of ${budget}; with a smaller \`PI_STICKY_MAX_PINS\`, drop Backlog rows from the bottom`;

test("a card whose digits no decoder accepts is a named failure, never a pair of in-range counts", () => {
  // The shape the reviewer flagged: `42` is longer than any count the docs state, and an accepting pattern
  // that lets a digit run be read in pieces would report `4` and `2` — two counts, each in range, each
  // plausible, and each satisfied by the cap comparison downstream. The readers refuse it outright: no
  // readable count ever comes back for it. Measured against the reader before the fix, the two `null`s
  // below were the *only* answer and every comparison against an empty result stayed green — the vacuous
  // pass this replaces is pinned by the controls at the bottom of this file.
  const text = cardWith("42", "5");
  expect(cardCounts(text), "the 42/5 card is a parse failure").toBeNull();
  expect(
    () => statedBacklogCap(text),
    "a card whose cap nothing decodes says which span is unreadable",
  ).toThrow(/42/);
  expect(() => statedBudget(text), "…and the budget reader refuses the same card").toThrow(/42/);
  expect(
    () => statedCounts(text, true),
    "and the scrapers refuse rather than report no 4 and no 2",
  ).toThrow(/42/);
  expect(() => statedBacklogCounts(text), "the cap-only scrape refuses it too").toThrow(/42/);
  // The same refusal for the budget half, which the cap-only reader never looks at.
  expect(cardCounts(cardWith("3", "42")), "an unreadable budget voids the card too").toBeNull();
  expect(
    () => statedBudget(cardWith("3", "42")),
    "…and the budget reader names the unreadable budget",
  ).toThrow(/42/);
  // The control that says these refusals are the bad numeral and not a dead reader: the same card shape
  // with both numerals inside the bound parses, and `cardUnreadable` — the reader's own "is this null
  // because a numeral is broken?" question — answers `null` for it.
  const good = cardWith("3", "5");
  expect(cardCounts(good), "the same card shape with readable numerals parses").toEqual({
    cap: 3,
    budget: 5,
  });
  expect(cardUnreadable(fold(good)), "and no span of it is unreadable").toBeNull();
  expect(cardUnreadable(fold(text)), "while the 42 card names its unreadable span").not.toBeNull();
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

test("the operative digit counts scrape whole, and a count above the bound is a named failure", () => {
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
  // Past the bound the span is still matched by the accepting pattern and refused by the decoder, which is
  // the case the readers used to answer with silence: `plus those 42` reported the Now count and nothing
  // else, and every comparison against that one-element list agreed. It now names the span.
  for (const digits of ["42", "34"]) {
    expect(
      () => statedCounts(`The board is one Now plus those ${digits}, which leaves a slot`, false),
      `plus those ${digits} names the unreadable span instead of reporting no count`,
    ).toThrow(new RegExp(`matched "${digits}"`));
    expect(
      () => statedNowCount(`The board is ${digits} Now`),
      `${digits} Now names its unreadable span`,
    ).toThrow(new RegExp(`matched "${digits}"`));
    // The control: the refusal tracks the *span*, so the same sentence with a count inside the bound
    // reads, and the unreadable-span reader sees exactly one bad span for the broken copy.
    const readable = "The board is one Now plus those 3, which leaves a slot";
    expect(statedCounts(readable, false), "the same sentence with a readable count reads").toEqual([
      1, 3,
    ]);
    expect(
      statedUndecodableOperatives(`The board is one Now plus those ${digits}, which leaves a slot`),
      `plus those ${digits} is recorded as the one unreadable span`,
    ).toEqual([{ raw: digits, at: expect.any(Number), of: "operative" }]);
    expect(statedUndecodableOperatives(readable), "and the readable sentence has none").toEqual([]);
  }
  // Three digits is a wider case than `42`, and it fails on the *accepting* side rather than the decoding
  // one: the pattern caps a digit run at as many digits as the largest count has (two) and anchors both
  // ends, so `100` is not matched at all — no span, no count, no complaint. That silence is honest here
  // (a three-digit run is not a count the readers claim to read), so what pins the boundary is that the
  // two-digit run the pattern *does* admit and the decoder refuses becomes a named failure.
  expect(cardinal("100"), "a three-digit run past the bound is no count").toBeNull();
  expect(
    statedUndecodableOperatives("The board is one Now plus those 100"),
    "and the accepting side never calls it a span, so nothing is silently dropped",
  ).toEqual([]);
  expect(
    () => statedCounts("The board is one Now plus those 34, which leaves a slot", false),
    "while the two-digit run both sides agree is a span fails by name",
  ).toThrow(/matched "34"/);
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
