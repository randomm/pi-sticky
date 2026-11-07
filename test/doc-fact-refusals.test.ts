/**
 * The refusal line the README quotes for a re-pin, `Already pinned as #<id>.`, pinned to the line the tool
 * actually returns.
 *
 * The sentence lives in `src/tool.ts`'s `outcomeLine`, which is module-private, so the README's copy is
 * pinned through the tool's own answer rather than a copy of it: the shared harness drives a duplicate
 * `pin` call and the quoted template must be exactly the head of the result the tool returns, placeholder
 * `<id>` and all. Nothing here retypes the sentence — a guard that spelled `Already pinned as` would pass
 * on a source that had reworded it.
 *
 * `tool.test.ts:55` pins the whole result byte-for-byte; this file's job is the README half, which that
 * file cannot see. `doc-citations.test.ts` holds the two refusal strings the README quotes verbatim; the
 * duplicate line is quoted with a placeholder instead, so it is pinned here.
 */
import { expect, test } from "bun:test";

import { fold, readDoc } from "./doc-fact-fixtures.ts";
import { harness, text } from "./tool-harness.ts";

const README = "README.md";

/** The README's bullet: the re-pin refusal quoted with the id left as a placeholder. */
const QUOTED_REFUSAL = "Already pinned as #<id>.";

/** The duplicate refusal, at the id the harness mints for it. */
const REFUSAL_AT_1 = "Already pinned as #1.";

/**
 * The outcome line of a result: the words before the listing the tool appends.
 *
 * Cut on ` Pinned for the user now`, the listing's own header (`renderList`), rather than on a space: the
 * sentence has spaces in it, and a first-word cut would answer `Already`.
 */
function outcomeOf(result: string): string {
  const head = fold(result).split(" Pinned for the user now")[0] ?? "";
  return head === "" ? fold(result) : head;
}

/** Drive a pin and then the same pin again, and answer with the second result's text. */
async function duplicateOutcome(): Promise<string> {
  const h = harness();
  await h.call({ action: "pin", text: "Decide X", level: "info" });
  const again = await h.call({ action: "pin", text: "  Decide X  ", level: "info" });
  return text(again);
}

/** The bullet's own line in the README, with its list marker and the quote's backticks removed. */
function quotedRefusal(readme: string): string {
  const bullet = readme
    .split("\n")
    .find((line) => line.includes("is not added: `") && line.includes(QUOTED_REFUSAL));
  return bullet === undefined ? "" : (/.`([^`]*)`/.exec(fold(bullet))?.[1] ?? "");
}

test("the README quotes the re-pin refusal the tool returns, placeholder and all", async () => {
  const readme = readDoc(README);
  const quoted = quotedRefusal(readme);
  // The extractor first: a bullet that lost its backticks or its sentence returns `""`, and an empty
  // capture compared against an empty expectation is the vacuous pass this repo's controls exist to close.
  expect(quoted, "the README still quotes the re-pin refusal").toBe(QUOTED_REFUSAL);
  const outcome = await duplicateOutcome();
  // The quoted copy, with its placeholder filled by the id the harness minted, is the line the tool sent.
  expect(quoted.replace("<id>", "1"), "the quoted refusal is the tool's own outcome line").toBe(
    REFUSAL_AT_1,
  );
  expect(outcome, "and the tool really returns it").toStartWith(`${REFUSAL_AT_1} `);
});

test("a README that reworded the refusal, or a tool that reworded it, fails the guard", async () => {
  // Two independent ways this fact goes stale, each proven to fire. (a) The doc drifted: the README's copy
  // reworded while the tool still answers the shipped way.
  const readme = readDoc(README);
  const rewordedDoc = readme.replace(QUOTED_REFUSAL, "Already pinned, see #<id>.");
  expect(rewordedDoc, "the doc control took").not.toBe(readme);
  expect(quotedRefusal(rewordedDoc), "a reworded README quotes something else").toBe("");
  expect(quotedRefusal(rewordedDoc), "so the equality the first test asserts would fail").not.toBe(
    QUOTED_REFUSAL,
  );
  // (b) The source drifted: whatever the tool answers now, the README's placeholder form has to be that
  // line with the id blanked — so a reworded source fails the same comparison. The decoy is aimed at the
  // result text itself, so it fails the equality the first test asserts rather than at a string nothing
  // reads.
  const outcome = await duplicateOutcome();
  const shipped = outcomeOf(outcome);
  expect(shipped, "the tool's outcome line is the quoted form at id 1").toBe(REFUSAL_AT_1);
  expect(shipped.replace("1", "<id>"), "and blanking the id gives the README's copy back").toBe(
    QUOTED_REFUSAL,
  );
  const rewordedSource = shipped.replace("Already pinned as", "Duplicate of");
  expect(rewordedSource, "the source control changed the line").not.toBe(shipped);
  expect(
    rewordedSource.replace("1", "<id>"),
    "a source that reworded the line no longer matches the README's copy",
  ).not.toBe(QUOTED_REFUSAL);
});
