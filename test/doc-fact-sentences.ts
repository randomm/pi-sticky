/**
 * The doc-facing sentence builders: the strings the README and the two board skills must carry, composed
 * from the source constants that own each number. Split out of `doc-fact-fixtures.ts` to stay inside the
 * 300-line cap; the numeral table, its accept/decode pair and the card parser stay there.
 *
 * Nothing here spells a number a source already owns. `budgetCard` goes through `numeral`, `optionRange`
 * through `MIN_OPTIONS`/`MAX_OPTIONS`, `optionBound` through `MAX_FIELD_GRAPHEMES` at the call site — so a
 * bump on the config side makes the prose fail the doc-fact tests rather than stay green and go stale,
 * which is exactly how the 5-row Backlog outlived the budget.
 *
 * A builder that silently degraded (a digit fallback, a literal) builds a sentence its own readers cannot
 * read, and a decoy built that way looks like a clean file. `numeral` throws for that reason; these builders
 * inherit the refusal.
 */
import { DEFAULT_CONFIG } from "../src/config.ts";
import { MAX_OPTIONS, MIN_OPTIONS } from "../src/pin-fields.ts";

import { BACKLOG_CAP, numeral } from "./doc-fact-fixtures.ts";

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
