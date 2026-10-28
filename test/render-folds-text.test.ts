/**
 * How each of the two text surfaces handles a pin whose text carries a break.
 *
 * The rail and the model-facing listing are one line per pin — that fold is their own guarantee, tested in
 * `render.test.ts` and `render-list-one-line.test.ts`. The `/pins` view is the user's surface and keeps the
 * breaks, indenting its continuation lines. The split is easy to undo by accident (one `toOneLine` call in
 * the wrong place makes all three agree and one of them wrong), so it is stated here as the pair it is:
 * folded where the fold is the contract, kept where the user reads it.
 */
import { expect, test } from "bun:test";

import { renderList, renderPinsText } from "../src/render.ts";
import { pin, view } from "./fixtures.ts";

test("the listing folds its pin text while the plain /pins view keeps its newlines", () => {
  // The model-facing listing is exactly one line per pin (the case itself lives in
  // test/render-list-one-line.test.ts): a text with a break in it must not print a row the
  // extension never made. The /pins view is the user's own surface and keeps the breaks.
  const pinned = view([pin(1, "a\n\n# fake header\nb")]);
  expect(renderList(pinned, 5)).toBe(
    "Pinned for the user now (1 of 5):\n#1 [info] a # fake header b",
  );
  // The /pins view indents its continuation lines, so it keeps the breaks rather than the raw text.
  expect(renderPinsText(pinned)).toInclude("a\n   \n   # fake header\n   b");
});
