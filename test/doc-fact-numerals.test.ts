/**
 * The numeral half of the doc-fact readers, pinned. `doc-fact-fixtures.ts` composes the budget card from
 * `DEFAULT_CONFIG.maxPins` and its readers scrape the numerals back out, so the accepting side (the
 * pattern a card-shaped sentence has to match) and the decoding side (the table that turns a spelling
 * into a number) are two lists that can fall out of step — and did: the pattern accepted `eight`, `nine`
 * and `ten` while the table stopped at `seven`, so a card spelled with one of those three decoded to
 * `indexOf`'s `-1`.
 *
 * `-1` is not a "could not read" marker anywhere downstream: `cardCounts` only rejects cards that DISAGREE
 * with one another, so `-1` was pushed as a real count and the board test's `cap <= maxPins - Now - 1`
 * passed on it (−1 ≤ 3). The alarm these fixtures exist to sound was disarmed for exactly the numerals a
 * `PI_STICKY_MAX_PINS` bump (the config allows 1–20) needs. These tests pin the one table and the failure
 * shape: an unreadable count is `null`, never a number.
 */
import { expect, test } from "bun:test";

import { MAX_PINS } from "../src/bounds.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { MAX_FIELD_GRAPHEMES } from "../src/pin-fields.ts";
import {
  BACKLOG_CAP,
  BUDGET_CARD,
  NOW_ROWS,
  backlogFloorWithCap,
  backlogRuleWithCap,
  budgetCard,
  cardCounts,
  cardinal,
  fold,
  numeral,
  readDoc,
} from "./doc-fact-fixtures.ts";
import {
  BOARD_SKILLS,
  boardPath,
  replaceSpaced,
  statedBacklogCap,
  statedBacklogCounts,
} from "./skills-board-readers.ts";

/** The budget the env range permits at its top, so a spelled count cannot collide with the default. */
const TOP_BUDGET = MAX_PINS;
/** The counts the old spelling table was missing, and the ones this ticket proved broken. */
const ABOVE_THE_OLD_TABLE = [8, 9, 10];
/** A count no reader may accept: one past the widest bound any doc states. */
const BEYOND_EVERY_BOUND = MAX_FIELD_GRAPHEMES + 1;
/** Its written form. `numeral` refuses a count past the bound rather than emitting it, so the uncountable
 * string the tests feed to `cardinal` is built here — that refusal is what keeps a doc from spelling a
 * count its own readers cannot decode.
 */
const UNCOUNTABLE = String(BEYOND_EVERY_BOUND);
/** The same uncountable count as digits, for the accepting side of the same rule. */
const UNCOUNTABLE_DIGITS = String(BEYOND_EVERY_BOUND);
/** The room the board's own inequality allows: `cap <= maxPins - Now - 1`. */
const BUDGET_ROOM = DEFAULT_CONFIG.maxPins - NOW_ROWS - 1;

/**
 * One card-shaped sentence, terminated the way every shipped card terminates. `budgetCard` stops at the
 * `;` that ends the card clause, so the sentence a doc carries is the card plus the terminator that
 * closes it — and the readers match the card's own `;`, never this trailing one, which is why appending
 * it here changes what `cardCounts` sees rather than just restyling it.
 */
const cardSentence = (cap: number, budget: number): string => `${budgetCard(cap, budget)};`;

test("the readers decode every spelled count the docs can hold", () => {
  // `numeral(n)` composes the card and `cardinal` reads it back: one contract, so for every count a doc
  // may carry — up to `MAX_PINS`, the largest `PI_STICKY_MAX_PINS` accepts — spelling it and reading it
  // returns the number rather than a sentinel or a digit fallback the other side does not accept.
  for (let n = 0; n <= MAX_PINS; n += 1) {
    expect(cardinal(numeral(n)), `cardinal(numeral(${n}))`).toBe(n);
  }
  // The three the old table lacked, named outright because they are the regression.
  expect(cardinal("eight"), "eight is eight").toBe(8);
  expect(cardinal("nine"), "nine is nine").toBe(9);
  expect(cardinal("ten"), "ten is ten").toBe(10);
  // Digits read the same as words, and a spelled count is never the sentinel again.
  expect(cardinal("8"), "digits still read").toBe(8);
  expect(cardinal("eight")).not.toBe(cardinal("nine"));
});

test("a count the table does not hold is a parse failure, never a number", () => {
  // The bug was `NUMERALS.indexOf(spelled)` handing back -1 for a word the accepting pattern allowed. An
  // unreadable count has to be `null` so the reader reports "no parsable card" instead of a plausible
  // negative budget.
  // The failure shape is "no count", never a number: a spelled count outside the table and a malformed
  // digit string are both `null` rather than `indexOf`'s -1 or a NaN.
  for (const word of [
    UNCOUNTABLE,
    "eleventy",
    "eightteen",
    "",
    "  ",
    "5n",
    "08",
    UNCOUNTABLE_DIGITS,
    String(MAX_PINS * 3),
  ]) {
    expect(cardinal(word), `cardinal(${JSON.stringify(word)}) is not a count`).toBeNull();
  }
  // `cardinal` trims, so a padded spelling is still the count itself — and the padding must not smuggle a
  // count in from outside the table.
  expect(cardinal(`  ${numeral(8)}  `), "padded spelling still reads").toBe(8);
  expect(cardinal(`  ${UNCOUNTABLE}  `), "padded, still no count").toBeNull();
  // The table's boundary is explicit on both sides: `numeral` spells up to `MAX_PINS` and nothing past it
  // decodes, so a count outside the table cannot be a silent digit on one side and a sentinel on the other.
  expect(cardinal(numeral(MAX_PINS)), "the top of the pin range is a count").toBe(MAX_PINS);
  expect(cardinal(UNCOUNTABLE), "past every bound there is no count").toBeNull();
});

test("a card spelled with a count above the old table reads as that count", () => {
  // With all three decoded to -1 these cards were indistinguishable from each other, and a file whose
  // only card was spelled this way reported -1 as its cap.
  for (const n of ABOVE_THE_OLD_TABLE) {
    const card = cardSentence(n, TOP_BUDGET);
    expect(card, `${n}: the card spells both counts`).toContain(
      `${numeral(n)} rows at the default budget of ${numeral(TOP_BUDGET)};`,
    );
    expect(cardCounts(card), `${n}: the cap reads as the number`).toEqual({
      cap: n,
      budget: TOP_BUDGET,
    });
    // The whole-file form of the same regression: a board skill whose only card states `n` rows reports
    // that cap through the reader the board test compares against the budget. Before the fix the reader
    // reported -1, which is also what the two digits-free counts below decode to today.
    const spelled = replaceSpaced(readDoc(boardPath("sticky-run-board")), BUDGET_CARD, card);
    expect(statedBacklogCap(spelled), `${n}: the reader reports the cap`).toBe(n);
    // Digits and words for one count are one count: `numeral` used to fall back to "8" while the reader's
    // table had no 8, so the two spellings of the same card read as -1 and 8 at the same time.
    const digital = replaceSpaced(
      readDoc(boardPath("sticky-run-board")),
      BUDGET_CARD,
      `${n} rows at the default budget of ${TOP_BUDGET}; with a smaller \`PI_STICKY_MAX_PINS\`, drop Backlog rows from the bottom`,
    );
    expect(statedBacklogCap(digital), "the digit spelling reads the same").toBe(
      statedBacklogCap(spelled),
    );
  }
});

test("an unreadable count fails the budget inequality instead of passing it", () => {
  // The measured consequence: the board test's own check is `cap <= maxPins - NOW_ROWS - 1` and -1
  // satisfied it. A file whose ONLY card states eight rows has to fail that inequality.
  for (const dir of BOARD_SKILLS) {
    const eightOnly = replaceSpaced(
      readDoc(boardPath(dir)),
      BUDGET_CARD,
      cardSentence(8, TOP_BUDGET),
    );
    const cap = statedBacklogCap(eightOnly);
    expect(cap, `${dir}: the mutation's cap is a number, not a sentinel`).not.toBe(-1);
    expect(cap ?? -1, `${dir}: eight rows do not fit the budget`).toBeGreaterThan(BUDGET_ROOM);
  }
  // A card whose spelling nothing decodes is no card at all — which is what makes the inequality
  // unreachable for it rather than vacuously satisfied.
  for (const dir of BOARD_SKILLS) {
    const outside = replaceSpaced(
      readDoc(boardPath(dir)),
      BUDGET_CARD,
      `${UNCOUNTABLE_DIGITS} rows at the default budget of ${UNCOUNTABLE_DIGITS};`,
    );
    expect(statedBacklogCap(outside), `${dir}: a count nothing decodes is not a card`).toBeNull();
  }
});

test("a card contradicting the shipped one on a spelled count is rejected, not absorbed", () => {
  // `cardCounts` rejects cards that disagree, so it only sounded the alarm while every card decoded to a
  // real number: appended to a board skill, "Never eight rows at the default budget of nine." decoded to
  // -1, agreed with nothing — the shipped card alone was reported, and every card assertion stayed green.
  // Two shapes of the same defect, both read as no card now.
  for (const dir of BOARD_SKILLS) {
    const text = readDoc(boardPath(dir));
    // (a) A second card whose count nothing decodes. The shipped card is still in the file, so a reader
    // that stopped at the first match (or decoded the unknown word to a sentinel) reported it as clean.
    // The uncountable half is written out rather than built: `budgetCard` refuses a numeral past the bound,
    // which is what makes an unreadable card impossible to build by accident.
    const contradicted = `${text} 8 rows at the default budget of ${UNCOUNTABLE};`;
    expect(contradicted, `${dir}: the contradicting card took`).not.toBe(text);
    expect(
      cardCounts(fold(contradicted)),
      `${dir}: an unreadable count is no card, never the shipped one`,
    ).toBeNull();
    // (b) A second card that decodes to a real count the shipped one does not state.
    const disagreeing = `${text} ${budgetCard(8, TOP_BUDGET)}.`;
    expect(disagreeing, `${dir}: the disagreeing card took`).not.toBe(text);
    expect(cardCounts(fold(disagreeing)), `${dir}: two cards that disagree is a defect`).toBeNull();
    // …and the same file with a second card that agrees on both numerals still reads, so the null above
    // is the disagreement and not a dead reader.
    expect(
      cardCounts(fold(`${text} ${BUDGET_CARD}.`)),
      `${dir}: agreeing cards still read`,
    ).toEqual({ cap: BACKLOG_CAP, budget: DEFAULT_CONFIG.maxPins });
  }
});

test("the operative rule and floor spell their counts the way the reader reads them", () => {
  // The rule builders go through `numeral`, so `numeral(8)` used to fall back to the digit "8" while the
  // reader's pattern also accepted "eight": two spellings for one count, and only one of them decoded.
  for (const n of ABOVE_THE_OLD_TABLE) {
    expect(numeral(n), `numeral(${n}) is spelled`).not.toBe(String(n));
    for (const sentence of [backlogRuleWithCap(n), backlogFloorWithCap(n)]) {
      const spelled = new RegExp(`(${numeral(n)})`).exec(sentence)?.[1];
      expect(spelled, `${n}: the sentence spells its count`).toBe(numeral(n));
      expect(cardinal(spelled ?? ""), `${n}: and the reader decodes it`).toBe(n);
    }
  }
});
