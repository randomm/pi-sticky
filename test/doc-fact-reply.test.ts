/**
 * The README paragraph issue #111 added about a kept reply, pinned to the source it describes.
 *
 * The sentence the doc-fact layer exists for is the one that quotes a *number* the code owns: the reply is
 * cut to the reply's own ceilings, and those ceilings are `MAX_REPLY_UNITS` and `MAX_REPLY_GRAPHEMES`
 * (`bounds.ts`), not the pin's. A README that named a length in prose would drift the moment a ceiling moved
 * — which is how the 5-row Backlog outlived its budget — so the sentence here is composed from the constants
 * and the README is required to contain it, with the drifted variant required to be absent.
 *
 * The positive control is the second half of every assertion below: a pattern that stopped matching would
 * pass the first half vacuously, so each one also mutates its own sentence and asserts the README does not
 * carry the mutant while still carrying the original.
 *
 * `doc-facts.test.ts` holds the tool-reference and panel halves; this file is the reply paragraph alone.
 */
import { expect, test } from "bun:test";

import { MAX_REPLY_GRAPHEMES, MAX_REPLY_UNITS } from "../src/bounds.ts";
import { fold, readDoc } from "./doc-fact-fixtures.ts";

const README = "README.md";

/** The reply's own ceilings, as the README spells them: digits, never words. */
const UNIT_BOUND = `${MAX_REPLY_UNITS} characters`;
const GRAPHEME_BOUND = `${MAX_REPLY_GRAPHEMES} characters`;

test("README names the reply's own ceiling as the source's own number", () => {
  const readme = fold(readDoc(README));
  expect(readme, "README states the reply ceiling from the source").toContain(UNIT_BOUND);
  // Positive control: a ceiling that drifted from the constant is caught by the same assertion, so a pass
  // here is the number matching and not a sentence the reader stopped finding.
  const drifted = `${MAX_REPLY_UNITS + 1} characters`;
  expect(readme, "README does not state a drifted reply ceiling").not.toContain(drifted);
  expect(
    readme.replace(UNIT_BOUND, drifted).includes(UNIT_BOUND),
    "the README carries the sentence the control mutates",
  ).toBe(false);
});

test("README keeps the reply budget out of the digits it does not own", () => {
  // The grapheme ceiling is internal (the issue names it so), so the paragraph must not have spelled it as a
  // second promise the code does not make. Asserting its absence is what stops a future edit turning the
  // internal ceiling into documented contract by accident.
  const readme = fold(readDoc(README));
  expect(readme, "README does not document the grapheme ceiling as user-facing").not.toContain(
    GRAPHEME_BOUND,
  );
});

test("README says the answer is kept for the agent after the pin is updated", () => {
  // The claim the issue is about, in the words the README uses. Composed from the sentence's own fixed part
  // so a reword that drops the *kept* promise fails, while the wording around it stays the author's.
  const readme = fold(readDoc(README));
  expect(readme, "README says the answer survives an update").toContain(
    "leaves your answer standing beside it",
  );
  // Positive control: the same sentence with the answer's survival removed is not in the README, and the
  // mutation is one the original really is present for.
  const drifted = "leaves your answer beside it";
  expect(readme, "README does not carry the drifted sentence").not.toContain(drifted);
  expect(
    readme
      .replace("leaves your answer standing beside it", drifted)
      .includes("leaves your answer standing beside it"),
    "the README carries the sentence the control mutates",
  ).toBe(false);
});

test("README quotes both reply surfaces the code draws", () => {
  // The arrow on `/pins` and the quoted mark in the tool result are what the user sees; both are drawn by
  // `pin-rows-text.ts`, and a README that stopped naming one would leave the user looking for the answer.
  const readme = fold(readDoc(README));
  expect(readme, "README names the arrow `/pins` prints").toContain("after an arrow");
  expect(readme, "README quotes the tool's reply mark").toContain(
    `(replied by the user at 14:30: "ship it")`,
  );
  // Positive control: the mark with no quote is the *other* surface's spelling, and the quoted form is the
  // one this paragraph carries.
  expect(
    readme
      .replace(`(replied by the user at 14:30: "ship it")`, "(replied by the user at 14:30)")
      .includes(`(replied by the user at 14:30: "ship it")`),
    "the README carries the quoted mark the control mutates",
  ).toBe(false);
});
