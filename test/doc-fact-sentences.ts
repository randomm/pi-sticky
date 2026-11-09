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
import { textBudgetRefusal } from "../src/text-budget.ts";

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

/**
 * The text budget as the model- and operator-facing docs state it. `textBudgetRefusal` owns the
 * wording and both numbers of the shipped instance; what these builders add are the placeholders the
 * docs put where the tool fills in a number, and the clause the skill wraps around the quote. The
 * limit is a parameter everywhere, so a copy that drifted from `DEFAULT_CONFIG.maxChars` fails the
 * comparison instead of matching a literal the doc was re-worded around.
 */
export const TEXT_BUDGET_HEAD =
  "Keep it inside the budget: a text longer than `PI_STICKY_MAX_CHARS`";
export const TEXT_BUDGET_MID = "**after cleaning** is refused, not cut \u2014";

/** Where each of the two numbers the tool fills in sits, in the docs' placeholder form. */
export const LIMIT_PLACEHOLDER = "<maxChars>";
export const COUNT_PLACEHOLDER = "<n>";
/** The probe measurement `textBudgetQuoted` substitutes out of the builder's own sentence. */
const LIMIT_PROBE = 7;
const COUNT_PROBE = 11;

/**
 * The refusal with either of the tool's two numbers left in the docs' placeholder form. Both ends are
 * parameters because the two docs quote them differently: the README blanks the limit as well as the
 * count (`LIMIT_PLACEHOLDER`), while the skill quotes the shipped default and blanks only the count.
 * One builder serves both readers plus the drifted decoy (`maxChars + 100`), and the wording still comes
 * only from `textBudgetRefusal` — so no copy of the sentence exists that the source did not compose.
 *
 * The probe measures at zero and the replacements are anchored to the sentence's own words (`at most `,
 * `(got `) rather than to a bare digit: `400` contains the `0` a digit-keyed replacement would also
 * match. Each replacement has to land or this throws — a builder that silently degraded would build a
 * sentence its own readers cannot match, and a decoy built that way looks like a clean file.
 */
export function textBudgetQuoted(
  limit: number | string,
  count: number | string = COUNT_PLACEHOLDER,
): string {
  const probe = textBudgetRefusal(LIMIT_PROBE, COUNT_PROBE);
  const withLimit = probe.replace(`at most ${LIMIT_PROBE} `, `at most ${String(limit)} `);
  if (withLimit === probe) throw new RangeError("textBudgetQuoted: the probe lost its limit slot");
  const withCount = withLimit.replace(`(got ${COUNT_PROBE})`, `(got ${String(count)})`);
  if (withCount === withLimit) {
    throw new RangeError("textBudgetQuoted: the probe lost its count slot");
  }
  return withCount;
}

/** The whole clause the skill ships, at a given limit — shipped one and decoy differ by that number. */
export function textBudgetClause(maxChars: number): string {
  return `${TEXT_BUDGET_HEAD} ${TEXT_BUDGET_MID} \`${textBudgetQuoted(maxChars)}\``;
}

/**
 * The env-table row for the budget. Composed whole so the test compares the README's line to the
 * config's own default and range — a row that kept its shape and went stale on either number fails.
 */
export function maxCharsEnvRow(defaultChars: number, min: number, max: number): string {
  return `| \`PI_STICKY_MAX_CHARS\` | \`${defaultChars}\` | ${min}\u2013${max} | The longest one pin's text may be after cleaning: longer is refused, not cut. |`;
}
