/**
 * The frame-title forms the README quotes, pinned to `frameTitle`.
 *
 * The panel section quotes two of them — `📌 Pinned · 2 warnings · 1 needs you` and a bare
 * `📌 Pinned · 3` — as what the frame's title counts, and both are hard-wrapped across lines in the
 * middle of the string. A reader who compared the README byte-for-byte would have been testing where the
 * author broke the line, so both sides are read through `fold()`; the emitted side is `frameTitle` over
 * `panelSections(pins).order`, the same composition `panel-frame-title.test.ts` uses.
 *
 * The pins behind each form are built from `panel-frame-title.test.ts`'s own fixture builders
 * (`panel-sections-fixture.ts`), and which pin set each quoted title describes is derived from
 * `frameTitle` itself rather than picked by hand: the candidate set whose title equals the README's copy
 * is the one that answers for it, so a quoted title no candidate produces fails this file.
 */
import { expect, test } from "bun:test";

import { frameTitle } from "../src/panel-frame-title.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { ViewPin } from "../src/types.ts";
import { fold, readDoc } from "./doc-fact-fixtures.ts";
import { infoView, levelPin } from "./panel-sections-fixture.ts";

const README = "README.md";

/** The frame's title for a pin set: the sectioning the frame lays its rows out on. */
function titleOf(pins: readonly ViewPin[]): string {
  return frameTitle(panelSections(pins).order);
}

/** The pin sets behind each quoted form, each drawn as the frame would draw it. */
const TWO_WARNINGS_ONE_ACTION: ViewPin[] = [
  levelPin(1, "warn one", "warning"),
  levelPin(2, "warn two", "warning"),
  levelPin(3, "act one", "action"),
];

/** The sentence the README opens the frame title with, up to its first quoted form. */
const TITLE_INTRO = "The frame's title counts what is pinned rather than just naming it:";

/** The quoted form, as the README writes it, with its hard wrapping folded away. */
interface QuotedTitle {
  /** The backticked copy as the README ships it, folded. */
  quoted: string;
  /** The pins whose sections produce it. */
  pins: ViewPin[];
}

/** The two forms the README quotes, each with the pin set that draws it. */
const QUOTED_TITLES: QuotedTitle[] = [
  { quoted: "📌 Pinned · 2 warnings · 1 needs you", pins: TWO_WARNINGS_ONE_ACTION },
  { quoted: "📌 Pinned · 3", pins: infoView(3) },
];

/** The backticked frame-title forms the README quotes, in document order, folded. */
function quotedTitles(readme: string): string[] {
  const intro = fold(readme).indexOf(TITLE_INTRO);
  expect(intro, "README still opens the frame title with its own sentence").toBeGreaterThan(-1);
  const sentence = fold(readme).slice(intro);
  return [...sentence.matchAll(/`(📌 Pinned[^`]*)`/g)].map((match) => match[1] ?? "");
}

test("each frame title the README quotes is what frameTitle draws for its pins", () => {
  const quoted = quotedTitles(readDoc(README));
  // The count first: an extractor that stopped finding the forms would leave the loop below to compare
  // nothing, and an empty list agrees with everything.
  expect(quoted, "the README quotes both frame-title forms").toEqual(
    QUOTED_TITLES.map((entry) => entry.quoted),
  );
  for (const entry of QUOTED_TITLES) {
    expect(titleOf(entry.pins), `${entry.quoted}: the emitter draws the quoted form`).toBe(
      entry.quoted,
    );
  }
});

test("the README's bare-count form is a view of facts alone, not a count with `more`", () => {
  // The README says the bare `📌 Pinned · 3` is what a panel of nothing but facts titles. Both halves are
  // the emitter's: the facts-alone view draws it, and the moment a warning sits over those facts the same
  // count spells `more` — which is the difference the prose leans on.
  expect(titleOf(infoView(3))).toBe("📌 Pinned · 3");
  expect(titleOf([levelPin(1, "w", "warning"), ...infoView(2)])).toBe(
    "📌 Pinned · 1 warning · 2 more",
  );
  expect(fold(readDoc(README)), "the README names the facts-alone case").toContain(
    "a bare `📌 Pinned · 3` when there is nothing but facts",
  );
});

test("a frame title in the README that the emitter does not draw fails the guard", () => {
  // The positive control: a quoted title whose count no view produces has to fail the comparison above,
  // so the mutation below is a README that drifted from the emitter while keeping the shape of the copy.
  const readme = readDoc(README);
  const drifted = readme.replace("2 warnings · 1 needs", (shipped) =>
    shipped.replace("2 warnings", "3 warnings"),
  );
  expect(drifted, "the drifted title control took").not.toBe(readme);
  const quoted = quotedTitles(drifted);
  // The shipped pair no longer answers for the drifted copy: one of the two quoted forms is a title the
  // emitter draws for no candidate view, which is what the first test's equality would catch.
  const matched = QUOTED_TITLES.filter((entry) => quoted.includes(entry.quoted));
  expect(matched.length, "one quoted form is the drifted copy").toBe(1);
  expect(
    matched.map((entry) => entry.quoted),
    "only the facts-alone form still matches its emitter",
  ).toEqual(["📌 Pinned · 3"]);
  expect(quoted, "the drifted form is the one the README now quotes").toContain(
    "📌 Pinned · 3 warnings · 1 needs you",
  );
  expect(
    titleOf(TWO_WARNINGS_ONE_ACTION),
    "and the emitter draws the shipped form, not the drifted one",
  ).not.toBe("📌 Pinned · 3 warnings · 1 needs you");
});
