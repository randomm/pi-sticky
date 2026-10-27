/**
 * The order the panel draws pins in, asserted at the ranking itself.
 *
 * `panel-component-rank.test.ts` asserts the order through a drawn frame, which is where the order matters —
 * the bar, `d` and `Enter` all index this array. What a frame cannot show is the two properties the ranking
 * has *as a function*: that it never hands back the caller's own array (the view is shared with the rail and
 * with the model, so an in-place sort would reorder pins for readers that were promised insertion order), and
 * that asking twice costs nothing to the first answer. Asserted here because the failure each one prevents is
 * invisible in a frame that happens to draw correctly anyway.
 */
import { expect, test } from "bun:test";

import { rankedPins } from "../src/panel-ranked.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";

const VIEW: readonly ViewPin[] = [
  pin(1, "First", "info"),
  pin(2, "Second", "action"),
  pin(3, "Third", "warning"),
];

test("the ranking is the level order the panel promises, whatever order the view arrived in", () => {
  expect(rankedPins(VIEW).map((p) => p.id)).toEqual([3, 2, 1]);
});

test("the ranking copies, so the view the caller holds keeps its insertion order", () => {
  // The rail and the model read the same array. A ranking that sorted in place would leave the panel's
  // order in a view that other readers were told stays in the order pins arrived.
  const view = [...VIEW];
  const ranked = rankedPins(view);
  expect(ranked).not.toBe(view);
  expect(view.map((p) => p.id)).toEqual([1, 2, 3]);
  expect(ranked.map((p) => p.id)).toEqual([3, 2, 1]);
});

test("an empty view ranks to an empty array rather than to nothing", () => {
  expect(rankedPins([])).toEqual([]);
});

test("a replied pin ranks below an unreplied one of its own level, newest first within each", () => {
  const replied: readonly ViewPin[] = [
    { ...pin(1, "Answered", "info"), repliedAt: NOW },
    pin(2, "Waiting", "info"),
    pin(3, "Older waiting", "info"),
  ];
  expect(rankedPins(replied).map((p) => p.id)).toEqual([3, 2, 1]);
});
