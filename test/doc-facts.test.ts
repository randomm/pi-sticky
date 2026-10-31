/**
 * The factual claims the README makes about the tool, pinned to the source each one describes. The
 * `docs/research-summary.md` and skill halves live in `doc-facts-research.test.ts`.
 *
 * Nothing else in the suite reads operator-facing prose, so every one of these facts was
 * untestable-by-construction and several of them drifted: the README said an `update` refusal named six
 * fields when it names five, quoted the focused border's hint as one pin's `1–4 answer`, restated a
 * 5-row Backlog the tool's own budget cannot hold beside the board's `Now` pin, and carried an env-table
 * default no test compared to the config. Each assertion below therefore compares the prose to the
 * constant or function that emits the string (`optionHint`, `updateNeedsChange`,
 * `DEFAULT_CONFIG.maxPins`), never to a literal the doc could simply be re-worded around, and each
 * carries a positive control so a pattern that stopped matching fails here rather than passing vacuously
 * — the habit of `doc-citations.test.ts` and `file-size.test.ts`.
 *
 * The two refusal strings the README quotes byte-for-byte live in `doc-citations.test.ts`, which keeps
 * its own job (plan citations resolving) in one file.
 */
import { expect, test } from "bun:test";

import { updateNeedsChange } from "../src/action.ts";
import { MAX_PINS } from "../src/bounds.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { optionHint } from "../src/panel-option-hint.ts";
import { MAX_FIELD_GRAPHEMES, MAX_OPTIONS, MIN_OPTIONS } from "../src/pin-fields.ts";
import {
  BACKLOG_CAP,
  BUDGET_CARD,
  budgetCard,
  cardCounts,
  fold,
  numeral,
  optionRange,
  readDoc,
  shippedSkills,
} from "./doc-fact-fixtures.ts";

const README = "README.md";

/** A quoted border label from the README: the backticked copy, not the prose around it. */
function quotedBorderLabel(readme: string): string | undefined {
  return /its row's border says `([^`]+)`/.exec(readme)?.[1];
}

test("README quotes the focused border's option hint the way optionHint spells it", () => {
  // `optionHint` prints the pin's own count, so the README must not quote a fixed digit range as the
  // border's label — `1–4 answer` was true only of a pin with four options. The key-reference rows
  // elsewhere in the README keep `1`–`4` legitimately: that is the accepted range, `MAX_OPTIONS`.
  const readme = readDoc(README);
  const quoted = quotedBorderLabel(readme);
  expect(quoted, "README quotes the border hint").toBeDefined();
  // The README names the count as a placeholder, so substituting a real count must give the label the
  // drawer really emits for that many options. The old copy could not pass this: it named one pin's
  // range as the label, so it matched for a 4-option pin and silently lied for every other.
  expect(optionHint(MAX_OPTIONS), "optionHint at MAX_OPTIONS").toContain(
    (quoted ?? "").replace("N", String(MAX_OPTIONS)),
  );
  expect(quoted, "the quoted hint is the generic form, not one pin's count").toContain("N");
  // Positive controls: the label really does name the count it was handed, and a README that went back
  // to quoting one pin's range as the label fails the shape check.
  expect(optionHint(2), "optionHint at two options").toContain("1\u20132 answer");
  expect(
    /border says `1\u20134 answer`/.test(readme),
    "README does not hard-code one pin's count into the border copy",
  ).toBe(false);
});

test("README counts the update refusal's fields the way the refusal lists them", () => {
  // The refusal names five fields; the README said six, which is a claim about the schema and reads to
  // the operator as a field the tool accepts. Both halves come from the refusal string itself.
  const readme = fold(readDoc(README));
  const refusal = updateNeedsChange();
  // The refusal is an `ApplyResult` union; only the refused branch has an `error`, and this test is
  // about that string. If the function ever returns ok the test has nothing to pin, and says so.
  if (refusal.ok) {
    expect(refusal, "updateNeedsChange must still return a refusal").not.toBeTruthy();
    return;
  }
  const fields: string = refusal.error;
  const listed: string[] = fields
    .replace("update needs ", "")
    .split(/,| or /)
    .filter((part) => part.trim() !== "");
  expect(listed, "the refusal lists five fields").toHaveLength(5);
  expect(readme, "README counts the fields as the refusal lists them").toContain(
    `none of the ${numeral(listed.length)} fields is refused: \`${fields}\``,
  );
  // Positive control: a README that names a different count is caught by the same assertion.
  expect(
    /none of the six fields is refused: `update needs/.test(readme),
    "README no longer says six fields",
  ).toBe(false);
});

test("README states the board's cardinality within the pin budget", () => {
  // The README restates what the two board skills ask for. Both must fit `DEFAULT_CONFIG.maxPins`, and
  // the card is the settled wording shared with `skills.test.ts`.
  const readme = fold(readDoc(README));
  const counts = cardCounts(readme);
  expect(counts, "README carries a parsable card").not.toBeNull();
  expect(readme, "README carries the budget card").toContain(BUDGET_CARD);
  // Both numerals of the card are read, not just the cap: a copy that kept the shape and went stale on
  // the *budget* half ("…at the default budget of nine") is the same class of drift this ticket fixed.
  expect(counts?.cap, "the card's cap").toBe(BACKLOG_CAP);
  expect(counts?.budget, "the card counts against the shipped default").toBe(
    DEFAULT_CONFIG.maxPins,
  );
  expect(readme, "README names one Now and the capped Backlog").toContain(
    `exactly one \`Now\`, at most ${numeral(BACKLOG_CAP)} \`Backlog\``,
  );
  // Positive controls: the stale cardinality this ticket corrected must not be back, and a card naming
  // another budget is not the shipped card even though it keeps the sentence's shape.
  expect(readme, "README no longer claims a five-row Backlog").not.toContain(
    `at most ${numeral(DEFAULT_CONFIG.maxPins)} \`Backlog\``,
  );
  const staleBudgetCard = readme.replaceAll(BUDGET_CARD, budgetCard(BACKLOG_CAP, MAX_PINS));
  expect(staleBudgetCard, "the README's card was found to mutate").not.toBe(readme);
  expect(
    cardCounts(staleBudgetCard),
    "a card naming another budget is not the shipped card",
  ).not.toEqual({ cap: BACKLOG_CAP, budget: DEFAULT_CONFIG.maxPins });
});

test("README's env table states the pin budget the card counts against", () => {
  // The env table's default cell is the operator's one source for the budget, and the card asserted
  // above is counted against it — yet no test read that cell, so it could say any number and stay
  // green. `BOUNDS` is module-private in `src/config.ts` (out of scope to export), so the range half is
  // a fixture the positive control below keeps honest.
  const readme = readDoc(README);
  const envRow = readme.split("\n").find((line) => line.includes("| `PI_STICKY_MAX_PINS` |")) ?? "";
  expect(envRow, "README's env table still has the PI_STICKY_MAX_PINS row").not.toBe("");
  expect(envRow, "the row's default cell is the shipped default").toContain(
    `\`PI_STICKY_MAX_PINS\` | \`${DEFAULT_CONFIG.maxPins}\``,
  );
  expect(envRow, "the row's allowed cell is the bound the config reads").toContain("1\u201320");
  // Positive control: a row whose default drifted — the state this ticket found the README in for the
  // other facts — fails the assertion above.
  expect(
    envRow
      .replace(`| \`${DEFAULT_CONFIG.maxPins}\` |`, `| \`${MAX_PINS}\` |`)
      .includes(`\`PI_STICKY_MAX_PINS\` | \`${DEFAULT_CONFIG.maxPins}\``),
    "a drifted default cell is caught",
  ).toBe(false);
});

test("README says it ships as many skills as the folder holds", () => {
  const readme = readDoc(README);
  const shipped = shippedSkills();
  expect(shipped.length, "the skills folder is not empty").toBeGreaterThan(0);
  expect(readme, "README counts the shipped skills").toContain(
    `ships ${numeral(shipped.length)} skills`,
  );
  // Positive control: a count that no longer matches the folder is a mismatch this catches.
  expect(
    readme.includes(`ships ${numeral(shipped.length + 1)} skills`),
    "README does not over-count its skills",
  ).toBe(false);
});

test("every noni link in the README says the repo is private", () => {
  const readme = readDoc(README);
  const sites = [...readme.matchAll(/\[noni\]\((https:\/\/github\.com\/randomm\/noni)\)/g)];
  expect(sites.length, "the README links noni").toBeGreaterThanOrEqual(3);
  for (const site of sites) {
    const after = readme.slice(site.index ?? 0, (site.index ?? 0) + 220);
    expect(after, `noni link ${site[1]}`).toMatch(/private/);
  }
  // Positive control: a bare link with no privacy note is what the assertion rejects — and it rejects
  // it, not just the pattern. Substituting the shipped note with a bare link (replace-all, so a fourth
  // site could not hide behind the first three) must leave an assertion firing rather than no-op.
  const bare = readme
    .replaceAll(
      "[noni](https://github.com/randomm/noni) (private)",
      "[noni](https://github.com/randomm/noni)",
    )
    .replace(
      "[noni](https://github.com/randomm/noni) (private at the time of writing)",
      "[noni](https://github.com/randomm/noni)",
    );
  expect(bare, "a privacy note was found to strip").not.toBe(readme);
  const bareSites = [...bare.matchAll(/\[noni\]\((https:\/\/github\.com\/randomm\/noni)\)/g)];
  expect(bareSites.length, "the stripped README still links noni").toBe(sites.length);
  const unmarked = bareSites.filter(
    (site) => !/private/.test(bare.slice(site.index ?? 0, (site.index ?? 0) + 220)),
  );
  expect(unmarked.length, "a bare noni link is caught").toBeGreaterThan(0);
});

test("README states each field bound as the source's own number", () => {
  // The README's field-bound sentences are the only place a model reads the `group` and `options` limits
  // before a refusal, and both stated them as literals while `pin-fields.ts` refuses past
  // `MAX_FIELD_GRAPHEMES` — so a bump to the bound would have left the prose quietly wrong. Composed from
  // the source here, with the control below to prove the sentences are found rather than absent.
  const readme = fold(readDoc(README));
  const bound = `${MAX_FIELD_GRAPHEMES} graphemes after sanitizing`;
  const groupBound = `\`group\` is one line of at most ${bound}`;
  const optionBound = `\`options\` is ${optionRange()} entries, each at most ${bound}`;
  expect(readme, "README states the group bound from the source").toContain(groupBound);
  expect(readme, "README states the options bound from the source").toContain(optionBound);
  // Positive control: a bound that drifted from the source is caught by the same assertions, so a pass
  // here is the number matching and not a pattern that stopped matching.
  const drifted = MAX_FIELD_GRAPHEMES + 1;
  expect(readme, "README does not state a group bound other than the source's").not.toContain(
    `\`group\` is one line of at most ${drifted} graphemes after sanitizing`,
  );
  expect(readme, "README does not state an options bound other than the source's").not.toContain(
    `\`options\` is ${optionRange()} entries, each at most ${drifted} graphemes after sanitizing`,
  );
  // Positive control for the range itself, which the grapheme control above cannot reach: a README that
  // drifted its lower bound while keeping the rest of the sentence word for word has to fail the
  // assertion above, so a pass there is the count matching and not a sentence the reader stopped finding.
  const driftedRange = `\`options\` is ${MIN_OPTIONS + 1} to ${MAX_OPTIONS} entries, each at most ${bound}`;
  expect(driftedRange, "the drifted range differs from the composed one").not.toBe(optionBound);
  expect(readme, "README does not state a drifted options range").not.toContain(driftedRange);
  expect(
    readme.replace(optionBound, driftedRange).includes(optionBound),
    "the README carries the options sentence the control mutates",
  ).toBe(false);
});
