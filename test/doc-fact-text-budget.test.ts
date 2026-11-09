/**
 * The three copies of the text-budget refusal, each pinned to the builder that owns its wording.
 *
 * `PI_STICKY_MAX_CHARS` was pinned by no doc test when this was written: the README's `text` bullet said
 * the tool *cut* text and named the cut back to the model, the env-table row described a "character
 * budget" no test read, and the sticky-basics skill — the file the model opens before it writes a pin —
 * named no length limit at all. Every number here comes from `DEFAULT_CONFIG.maxChars` or the clamp in
 * `src/config.ts`, and every sentence from `textBudgetRefusal` through `doc-fact-sentences.ts`, so a
 * reworded builder or a moved default fails the prose instead of leaving it green and stale.
 *
 * Two directions of staleness, and a control for each: the doc drifted (its copy reworded, or its number
 * moved while the source stood) and the source drifted (the builder reworded while the docs kept quoting
 * the old line). The tool's own answer is the witness for the second — the README's placeholder copy,
 * with its placeholders filled by what a real refusal filled them with, has to be that answer
 * byte-for-byte, which is the pattern `doc-fact-refusals.test.ts` uses for the duplicate-pin line.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { textBudgetRefusal } from "../src/text-budget.ts";
import { escapeRegExp, replaceSpaced } from "./doc-fact-controls-support.ts";
import { fold, readDoc } from "./doc-fact-fixtures.ts";
import {
  COUNT_PLACEHOLDER,
  LIMIT_PLACEHOLDER,
  TEXT_BUDGET_HEAD,
  TEXT_BUDGET_MID,
  maxCharsEnvRow,
  textBudgetClause,
  textBudgetQuoted,
} from "./doc-fact-sentences.ts";
import { harness, text } from "./tool-harness.ts";

const README = "README.md";
const BASICS_SKILL = "skills/sticky-basics/SKILL.md";
/** The clamp `src/config.ts` applies to `PI_STICKY_MAX_CHARS`, which the env table states as `40–2000`. */
const MIN_CHARS = 40;
const MAX_CHARS = 2000;
/** How far over the budget the driven text goes, so `n` is a number no other case produces. */
const OVER = 50;
/** The README's copy: the builder's sentence with both of the tool's numbers left as placeholders. */
const README_QUOTED = textBudgetQuoted(LIMIT_PLACEHOLDER);

/** An over-long pin driven through the tool at the shipped default; its refusal is the witness. */
async function overLongRefusal(): Promise<string> {
  const h = harness();
  const result = await h.call({
    action: "pin",
    text: "x".repeat(DEFAULT_CONFIG.maxChars + OVER),
  });
  if (!result.isError) throw new Error("the tool stopped refusing an over-long text");
  return text(result);
}

/**
 * The README's `text` bullet: the refusal it quotes in backticks, or `""` when the bullet lost it.
 *
 * The extractor keys on the *quote itself* rather than on the bullet's first backtick pair: the bullet
 * names two other things in backticks ahead of the refusal (`text`, then `PI_STICKY_MAX_CHARS`), so a
 * first-pair capture answers one of those. The pattern is the builder's own sentence with the limit the
 * tool fills in widened to a digit run, so it can only match the copy it is looking for, and a README
 * that dropped or reworded the quote reaches `""` rather than a wrong capture. The bullet is located by
 * its opening phrase and captured from the folded document — slicing the document at the bullet is not an
 * option, because the placeholders belong to the bullet's own text and a `- ` split would cut
 * `<maxChars>` in half. Same shape as `doc-fact-refusals.test.ts`, which finds its bullet by a phrase and
 * captures from the whole file.
 */
function quotedBudgetRefusal(readme: string): string {
  const document = fold(readme);
  // Two conditions, both about the bullet the extractor is contracted to read: it opens with the phrase
  // that identifies it, and it names the variable the limit comes from. The second is what stops the
  // pattern below from being a document-wide search — without it, deleting the bullet would let an
  // identical sentence anywhere else in the README satisfy the capture, and the control that reworded
  // the bullet's variable would find the quote in the env table and report a clean file.
  if (!document.includes("`text` is sanitized")) return "";
  if (!document.includes("longer than `PI_STICKY_MAX_CHARS` after cleaning")) return "";
  // The quote itself is located by the builder's wording with both numbers in the docs' placeholder
  // form — the README blanks the limit as well as the length received, since the limit is whatever the
  // operator set `PI_STICKY_MAX_CHARS` to. Those two slots are the only loose parts of the pattern, and
  // the assertion that reads the capture compares it to `README_QUOTED`, composed from the builder and
  // `DEFAULT_CONFIG.maxChars`: a quote that reworded the sentence therefore returns `""` rather than a
  // wrong capture, which is the vacuous pass the controls exist to close.
  const shape = escapeRegExp(textBudgetQuoted("#LIMIT#", "#COUNT#"))
    .replace("#LIMIT#", "[^)]*?")
    .replace("#COUNT#", "[^)]*");
  return new RegExp(`\`(${shape})\``).exec(document)?.[1] ?? "";
}

/** The README's env-table row for the budget, or `""` when the table lost it. */
function envRow(readme: string): string {
  return readme.split("\n").find((line) => line.includes("| `PI_STICKY_MAX_CHARS` |")) ?? "";
}

test("the README's text bullet quotes the refusal the tool returns, placeholders and all", async () => {
  const readme = readDoc(README);
  const quoted = quotedBudgetRefusal(readme);
  // The extractor first: a bullet that lost its backticks or its sentence returns `""`, and an empty
  // capture compared against an empty expectation is the vacuous pass this repo's controls exist to close.
  expect(quoted, "the README still quotes the budget refusal").toBe(README_QUOTED);

  // The tool's own answer, with the README's placeholders filled the way the README leaves them to be
  // filled: the limit by the config's default and the count by what the driven text really measured.
  const shipped = await overLongRefusal();
  const filled = README_QUOTED.replace(LIMIT_PLACEHOLDER, String(DEFAULT_CONFIG.maxChars)).replace(
    COUNT_PLACEHOLDER,
    String(DEFAULT_CONFIG.maxChars + OVER),
  );
  expect(shipped, "the quoted copy is the line the tool actually returns").toBe(filled);
  expect(shipped, "and that line is the builder at the shipped default").toBe(
    textBudgetRefusal(DEFAULT_CONFIG.maxChars, DEFAULT_CONFIG.maxChars + OVER),
  );

  // Controls, one per direction of drift. (a) The doc reworded its quote while the tool still answered
  // the shipped way: the extractor then finds nothing, so the equality the test above asserts fails.
  const rewordedDoc = replaceSpaced(readme, README_QUOTED, "text is too long (<n> characters).");
  expect(rewordedDoc, "the doc control took").not.toBe(readme);
  expect(quotedBudgetRefusal(rewordedDoc), "a reworded README quotes something else").not.toBe(
    README_QUOTED,
  );
  // (b) The doc kept the sentence but stopped naming the variable the limit comes from: the bullet is no
  // longer the one the extractor is contracted to read.
  const unnamed = replaceSpaced(
    readme,
    "a text longer than `PI_STICKY_MAX_CHARS` after cleaning",
    "a text longer than the budget after cleaning",
  );
  expect(unnamed, "the variable control took").not.toBe(readme);
  expect(
    quotedBudgetRefusal(unnamed),
    "a bullet that stopped naming the variable is not read",
  ).toBe("");
});

test("the README's env row states the budget the refusal names, from the config's own numbers", () => {
  // The row is the operator's only source for the limit and the range, and it was pinned by nothing: it
  // could name any default and any clamp and stay green. `BOUNDS` is module-private in `src/config.ts`,
  // so the range half is the fixture's, and the controls below are what keep it honest.
  const readme = readDoc(README);
  const row = envRow(readme);
  expect(row, "the env table still has the PI_STICKY_MAX_CHARS row").not.toBe("");
  expect(row, "the row is composed from the shipped default and the clamp").toBe(
    maxCharsEnvRow(DEFAULT_CONFIG.maxChars, MIN_CHARS, MAX_CHARS),
  );
  expect(row, "the row states the refusal rather than a cut").toInclude("refused, not cut");
  // Positive controls: the same row with either number drifted is not the composed row, which is what
  // makes the equality above a comparison and not a pattern that stopped matching.
  const driftedDefault = maxCharsEnvRow(MAX_CHARS, MIN_CHARS, MAX_CHARS);
  expect(driftedDefault, "a drifted default differs from the composed row").not.toBe(row);
  expect(row, "the README states no other default for the budget").not.toBe(driftedDefault);
  const driftedRange = maxCharsEnvRow(DEFAULT_CONFIG.maxChars, 1, 20);
  expect(driftedRange, "a drifted range differs too").not.toBe(row);
  expect(row, "the README does not borrow another variable's range").not.toBe(driftedRange);
});

test("the sticky-basics skill states the refusal the model reads before it writes a pin", () => {
  // The skill is the file the model opens to learn how to write `text`, and it named no limit at all, so
  // a long pin was a refusal the model met with no warning and no idea what to shorten. Same shape as the
  // option-bound line `doc-facts-research.test.ts` pins for noni: the clause comes from the fixture, the
  // number from the config, and the controls prove the sentence is found rather than absent.
  const skill = fold(readDoc(BASICS_SKILL));
  const clause = textBudgetClause(DEFAULT_CONFIG.maxChars);
  expect(skill, "the skill names the config variable").toContain("PI_STICKY_MAX_CHARS");
  expect(skill, "the skill says refused rather than cut").toContain(TEXT_BUDGET_MID);
  expect(skill, "the skill quotes the builder's sentence at the shipped default").toContain(clause);
  expect(skill, "and frames it as an instruction the model acts on").toContain(TEXT_BUDGET_HEAD);
  // Positive controls: a clause whose limit drifted from the config is not the shipped clause…
  const stale = textBudgetClause(DEFAULT_CONFIG.maxChars + 100);
  expect(stale, "the drifted clause differs from the composed one").not.toBe(clause);
  expect(skill, "the skill states no other limit").not.toContain(stale);
  // …and a clause that promised a cut instead of a refusal is not one the model can act on. The decoy is
  // built by `replaceSpaced`, which throws rather than returning the input unchanged, so a control that
  // missed its target fails here instead of silently reporting the shipped bytes.
  const promisedACut = replaceSpaced(
    skill,
    TEXT_BUDGET_MID,
    "**after cleaning** is cut, with the cut named back —",
  );
  expect(promisedACut, "the cut control took").not.toBe(skill);
  expect(
    promisedACut.includes(clause),
    "a clause that promised a cut is not the clause the tool enforces",
  ).toBe(false);
});
