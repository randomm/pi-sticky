/**
 * The model-facing listing header the README quotes in **Tool reference**, pinned to `renderList`.
 *
 * Three headers in this codebase look alike and only one of them is the model's: `renderList` opens a tool
 * result with `Pinned for the user now (<n> of <maxPins>):`, `renderPinsText` opens the `/pins` output
 * with `Pinned for you (<n>):`, and the rail opens with `📌 Pinned for you (<n>) · /pins`. The README now
 * quotes the first, because that is the listing the Tool reference describes, and a doc that quietly
 * drifted to one of the other two would teach the reader a header no tool ever returns. So this file pins
 * the quote to `renderList(view, DEFAULT_CONFIG.maxPins).split("\n")[0]` and pins the absence of the other
 * two from the same sentence.
 *
 * The count inside the header is the shipped default rather than a literal, so a `maxPins` bump makes the
 * quote fail here instead of staying green and going stale.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { renderList, renderPinsText } from "../src/render.ts";
import { fold, readDoc } from "./doc-fact-fixtures.ts";
import { pin, view } from "./fixtures.ts";

const README = "README.md";

/** The words the README uses to introduce the quoted header. */
const INTRO = "Every listing the model sees opens with the header";

/** The placeholder the README leaves for the count and the budget, so a bump cannot be quoted past. */
const QUOTED_HEADER = "Pinned for the user now (<n> of <maxPins>):";

/** The header `renderList` draws for a view of `count` pins at the shipped budget. */
function listingHeader(count: number): string {
  const pins = Array.from({ length: count }, (_unused, i) => pin(i + 1, `pin ${i + 1} text`));
  return renderList(view(pins), DEFAULT_CONFIG.maxPins).split("\n")[0] ?? "";
}

/** The header the README quotes, folded, or `""` when the sentence or its quote is gone. */
function quotedHeader(readme: string): string {
  const at = fold(readme).indexOf(INTRO);
  if (at === -1) return "";
  const sentence = fold(readme).slice(at);
  return /opens with the header `([^`]*)`/.exec(sentence)?.[1] ?? "";
}

test("the Tool reference quotes the header renderList draws, at the shipped budget", () => {
  const readme = readDoc(README);
  const quoted = quotedHeader(readme);
  expect(quoted, "the README quotes the model's listing header").toBe(QUOTED_HEADER);
  // The placeholders stand for the two numbers `renderList` prints. Filled with the view's own count and
  // the shipped budget, the README's copy must be byte-for-byte that header — so neither number can be
  // quoted away from the emitter, and a `maxPins` bump fails here rather than in review.
  const headerAtTwo = quoted
    .replace("<n>", "2")
    .replace("<maxPins>", String(DEFAULT_CONFIG.maxPins));
  expect(headerAtTwo, "the quoted header, at real numbers, is the emitted header").toBe(
    listingHeader(2),
  );
  const headerAtZero = quoted
    .replace("<n>", "0")
    .replace("<maxPins>", String(DEFAULT_CONFIG.maxPins));
  expect(headerAtZero, "and the empty view spells the same header").toBe(listingHeader(0));
});

test("the README does not confuse the model's header with the /pins or the rail header", () => {
  // The conflation this guard exists for: three headers, one sentence. Each is composed from its emitter so
  // a reworded source changes the control rather than hiding it.
  const pins = [pin(1, "one")];
  const pinsHeader = renderPinsText(view(pins)).split("\n")[0] ?? "";
  const railHeader = "📌 Pinned for you (1) · /pins";
  expect(pinsHeader, "the /pins header is a different string").not.toBe(listingHeader(1));
  expect(railHeader, "and so is the rail's").not.toBe(listingHeader(1));
  const at = fold(readDoc(README)).indexOf(INTRO);
  expect(at, "the Tool reference still introduces the model's header").toBeGreaterThan(-1);
  const sentence = fold(readDoc(README)).slice(at, at + 320);
  expect(sentence, "that sentence names the model's header").toContain(QUOTED_HEADER);
  expect(sentence, "and not the /pins header").not.toContain(pinsHeader);
  expect(sentence, "and not the rail header").not.toContain(railHeader);
});

test("a README whose quoted header drifted from the emitter fails the guard", () => {
  // The positive control: swap the model's header for the `/pins` one — the confusion the doc would most
  // plausibly drift into — and the comparison above has to fail.
  const readme = readDoc(README);
  const drifted = readme.replace(QUOTED_HEADER, "Pinned for you (<n>):");
  expect(drifted, "the header control took").not.toBe(readme);
  const quoted = quotedHeader(drifted);
  expect(quoted, "the drifted copy is what the README now quotes").toBe("Pinned for you (<n>):");
  expect(
    quoted.replace("<n>", "2").replace("<maxPins>", String(DEFAULT_CONFIG.maxPins)),
    "and it is no longer the header renderList emits",
  ).not.toBe(listingHeader(2));
});
