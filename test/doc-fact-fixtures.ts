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
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "../src/config.ts";

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

/** The shape of one parsed card. */
export interface CardCounts {
  cap: number;
  budget: number;
}

/** A small count, spelled or digital — the same spellings `cardinal` reads. */
const COUNT = String.raw`(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;

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

const NUMERALS = ["zero", "one", "two", "three", "four", "five", "six", "seven"];

/** A count as the docs spell it. */
export function numeral(n: number): string {
  return NUMERALS[n] ?? String(n);
}

/**
 * A count as a doc spells it, digits or word, or `null`. Shared by the scrapers in
 * `doc-facts.test.ts` and `skills.test.ts` so neither has its own table of spellings to fall out of
 * step with — a scraper whose pattern stopped matching is the vacuous pass this repo's positive
 * controls exist to catch.
 */
export function cardinal(text: string): number | null {
  const spelled = new RegExp(`^(${COUNT})$`).exec(text.trim())?.[1];
  if (spelled === undefined) return null;
  const digits = Number(spelled);
  if (Number.isFinite(digits)) return digits;
  return NUMERALS.indexOf(spelled);
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

/** The bound as `pin-fields.ts` spells it, in the bold the skills carry it in. */
export function optionBound(budget: number): string {
  return `**${budget} graphemes after cleaning**`;
}

/** The floor sentence with `n` as its bound, for the decoy that the assertion must reject. */
export function optionFloorWithBound(n: number): string {
  return `${OPTION_FLOOR_HEAD} well under ${optionBound(n)}`;
}
