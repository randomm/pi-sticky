/**
 * The one copy of the sentences docs and skills must agree on, and of the readers that scrape them.
 *
 * The Backlog budget card is stated in two skill files and once in the README, so the assertions need
 * a string no prose edit can silently move. The card is composed from `DEFAULT_CONFIG.maxPins` rather
 * than spelled, so a bump on the config side makes the docs fail rather than stay green and go stale —
 * which is exactly how the 5-row Backlog outlived the budget.
 *
 * Shared module (not a `.test.ts`) so `skills.test.ts`, `doc-facts.test.ts` and
 * `doc-facts-research.test.ts` read the same card and the same scrapers.
 *
 * A test that reads this file must also assert that each scraper fires on the shipped text. A reader
 * whose pattern no longer matches returns no matches rather than failing, which is indistinguishable
 * from a clean pass: that is the vacuous pass the positive controls in those tests exist to catch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { MAX_PINS } from "../src/bounds.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { MAX_FIELD_GRAPHEMES, MAX_OPTIONS, MIN_OPTIONS } from "../src/pin-fields.ts";

/** The repo root, as the doc tests address files from it. */
const ROOT = join(import.meta.dir, "..");

/** Read a doc or skill from the repo root. */
export function readDoc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** The dirs under `skills/` that hold a `SKILL.md`, i.e. what pi is offered. */
export function shippedSkills(): string[] {
  return readdirSync(join(ROOT, "skills"), { encoding: "utf8" }).filter((entry) =>
    readdirSync(join(ROOT, "skills", entry), { encoding: "utf8" }).includes("SKILL.md"),
  );
}

/**
 * The prose as one long line. The docs are hard-wrapped, so a sentence compared to a source string
 * byte-for-byte has to be read with its line breaks folded — otherwise the assertion would be testing
 * where the author happened to break the line.
 */
export function fold(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Every count a doc may spell as a word, in order. `numeral` spells a count from this array, `cardinal`
 * decodes one with it, and the accepting pattern of every reader is generated from it — so the side that
 * matches a card-shaped sentence and the side that reads its numerals are one source of truth (they were
 * two, and a count the table lacked decoded to `indexOf`'s -1, which downstream read as a real count).
 *
 * The upper end is a named bound, not a silent fallback: the docs state a count as a word only up to the
 * largest bound they carry (`MAX_FIELD_GRAPHEMES`, the option and group bound), and `MAX_COUNT` below is
 * that same bound, so nothing can be spelled on one side and unreadable on the other.
 */
export const NUMERALS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "twenty-one",
  "twenty-two",
  "twenty-three",
  "twenty-four",
] as const;

/** The largest count the table spells as a word; the docs write a larger one in digits. */
const MAX_SPOKEN_COUNT = NUMERALS.length - 1;

/**
 * The largest number a reader accepts as a count: the widest bound any doc states, which is also the top
 * of the spelled table. Past it a numeral in a doc is a defect, not a count, and `cardinal` says so.
 */
export const MAX_COUNT = Math.max(MAX_PINS, MAX_SPOKEN_COUNT);

/**
 * The digits an accepting pattern allows for a count: no leading zero, and at most as many digits as the
 * largest count has — so a doc cannot state a number no decoder would read, and the accepting side and the
 * decoding side stay one boundary. Backslash-d doubled for `String.raw` below.
 */
const DIGITS = `0|[1-9]\\d{0,${String(MAX_COUNT).length - 1}}`;

/**
 * A count, spelled from the table or written in digits — the one accepting shape every reader shares.
 * `String.raw` is required: the digits alternative is `\\d`, which raw turns into the one backslash a
 * pattern needs.
 */
const COUNT = String.raw`(?:${NUMERALS.join("|")}|${DIGITS})`;

/** The accepting pattern for a count, handed to the readers so no file spells the numerals itself. */
export function countPattern(): string {
  return COUNT;
}

/**
 * A whole count that cannot match inside a longer word, with the spelled alternatives joined
 * longest-first — the one accepting shape `skills-board-readers.ts` compiles its operative patterns
 * from. Handed out as source so a test that claims to exercise the sort or the anchors drives them
 * through this string rather than through a second copy that could drift from it.
 */
export function anchoredCountPattern(): string {
  return String.raw`\b(?:${[...NUMERALS]
    .sort((a, b) => b.length - a.length)
    .join("|")}|${COUNT})\b`;
}

/**
 * A count as the docs spell it: a word from the table, never digits.
 *
 * Throws rather than falling back to digits. `cardinal` refuses a digit string above `MAX_COUNT`, so the
 * fallback made the round-trip one-way: a builder handed 25 emitted "25", every reader then reported *no
 * count* for the sentence, and a decoy built that way passed as a clean file. An out-of-range count is a
 * defect in the caller, and throwing is the only way it reaches one.
 *
 * The gate is the table's own length, not `MAX_COUNT`: `doc-fact-numerals.test.ts` asserts the two are
 * equal, but a bound the docs state and a table that lacks the word are separate facts, and a builder must
 * refuse what *this array* cannot spell even if the bound moved first.
 */
export function numeral(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= NUMERALS.length) {
    throw new RangeError(
      `numeral: ${n} is not a count the table spells (0..${NUMERALS.length - 1})`,
    );
  }
  return NUMERALS[n] as string;
}

/** The card sentence, global — so a file with two of them reports both numerals of each. */
const EVERY_CARD = new RegExp(`(${COUNT}) rows at the default budget of (${COUNT});`, "g");

/**
 * The two numerals of the card — its cap and the budget it counts against — read out of the sentence.
 * Both are read: a copy that kept the shape of the card and went stale on either numeral would still
 * "contain the card" to a substring test on the fixture, which is the same drift this ticket fixed.
 *
 * Every card in the text is read, not the first: a file that grew a second card-shaped sentence
 * contradicting the shipped one (documenting a non-default `PI_STICKY_MAX_PINS`, say) would otherwise
 * leave the reader anchored to whichever copy came first. `null` when the text carries no parsable
 * card, and also when its cards disagree — a file that states two different budgets is a defect, not
 * a pass.
 */
export function cardCounts(folded: string): CardCounts | null {
  const cards: CardCounts[] = [];
  for (const match of folded.matchAll(EVERY_CARD)) {
    const cap = cardinal(match[1] ?? "");
    const budget = cardinal(match[2] ?? "");
    if (cap === null || budget === null) return null;
    cards.push({ cap, budget });
  }
  const first = cards[0];
  if (first === undefined) return null;
  return cards.every((card) => card.cap === first.cap && card.budget === first.budget)
    ? first
    : null;
}

/** One board row, as the card counts them. */
export const NOW_ROWS = 1;

/** The highest Backlog cap the budget still leaves room for: one slot stays free for a warning or a question. */
export const BACKLOG_CAP = DEFAULT_CONFIG.maxPins - NOW_ROWS - 1;

/**
 * A count as a doc spells it, digits or word, or `null`. Shared by the scrapers in
 * `doc-facts.test.ts` and `skills.test.ts` so neither has its own table of spellings to fall out of
 * step with — a scraper whose pattern stopped matching is the vacuous pass this repo's positive
 * controls exist to catch.
 *
 * A count outside the table is `null` rather than a number: `indexOf`'s -1 read downstream as a real
 * count, so a card nobody could read satisfied `cap <= budget` and disarmed the drift alarm.
 */
export function cardinal(text: string): number | null {
  const spelled = new RegExp(`^(${COUNT})$`).exec(text.trim())?.[1];
  if (spelled === undefined) return null;
  const spelledIndex = NUMERALS.indexOf(spelled as (typeof NUMERALS)[number]);
  if (spelledIndex >= 0) return spelledIndex;
  const digits = Number(spelled);
  return digits >= 0 && digits <= MAX_COUNT ? digits : null;
}

/** The shape of one parsed card. */
export interface CardCounts {
  cap: number;
  budget: number;
}

/**
 * The card, in the settled wording, for a given Backlog cap and budget. Both skills and the README
 * carry it verbatim; the shipped card is `budgetCard()` at the shipped cap.
 */
export function budgetCard(cap = BACKLOG_CAP, budget = DEFAULT_CONFIG.maxPins): string {
  return `${numeral(cap)} rows at the default budget of ${numeral(budget)}; with a smaller \`PI_STICKY_MAX_PINS\`, drop Backlog rows from the bottom`;
}

/** The shipped card. */
export const BUDGET_CARD = budgetCard();

/**
 * The operative rules the board skills state for building the Backlog, in the words the files ship.
 * The card is instruction; these are the sentences the model actually follows when it opens the file,
 * so an assertion that reads only the card lets a contradicting count elsewhere survive — which is how
 * the 5-row Backlog outlived the budget.
 */
export const BACKLOG_RULE_HEAD = "Build the group from the first entries of that file";
export const BACKLOG_FLOOR_HEAD = "Fewer than three entries";

/** The rule with `n` rows named in it: what a card-contradicting copy of the same sentence looks like. */
export function backlogRuleWithCap(n: number): string {
  return `Build the group from the first ${numeral(n)} entries of that file`;
}

/** The floor sentence with `n` as its count, for the decoy the assertion must reject. */
export function backlogFloorWithCap(n: number): string {
  return `Fewer than ${numeral(n)} entries`;
}

/**
 * How `sticky-noni` frames one option against the bound: a floor to stay well under, never a target to
 * fill. The bound itself is composed from `MAX_FIELD_GRAPHEMES` at each site that checks it, so the
 * number cannot go stale; these strings are the clause around it.
 */
export const OPTION_FLOOR_HEAD = "Keep every option short —";

export const OPTION_FLOOR_TAIL = "the tool refuses a longer option rather than cutting it";

/**
 * The number of entries an `options` list may carry, as the docs state the range: both ends composed
 * from `MIN_OPTIONS`/`MAX_OPTIONS`, so a bound that moves fails the prose instead of leaving it green
 * and wrong. `spaced` writes the hyphenated form one skill uses; the docs keep their own dash elsewhere.
 */
export function optionRange(spaced = false): string {
  return spaced ? `${MIN_OPTIONS}-${MAX_OPTIONS}` : `${MIN_OPTIONS} to ${MAX_OPTIONS}`;
}

/** The bound as `pin-fields.ts` spells it, in the bold the skills carry it in. */
export function optionBound(budget: number): string {
  return `**${budget} graphemes after cleaning**`;
}

/** The floor sentence with `n` as its bound, for the decoy that the assertion must reject. */
export function optionFloorWithBound(n: number): string {
  return `${OPTION_FLOOR_HEAD} well under ${optionBound(n)}`;
}
