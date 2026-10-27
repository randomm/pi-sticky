/**
 * The ranking memo: one owner, one invalidation, and an order the keys act on.
 *
 * `panel-component-rank.test.ts` asserts the *order* through a drawn frame, which is where the order matters
 * — the bar, `d` and `Enter` all index this array. What a frame cannot show is the memo itself: that a view
 * which has not moved costs no sort, that a *new array of the same pins* is treated as a new view, and that
 * `invalidate()` is the escape for the one caller that swaps the view behind the component's back. Those are
 * asserted here, at the class, because the failure each one prevents is invisible in a frame that happens to
 * draw correctly anyway.
 */
import { expect, test } from "bun:test";

import { RankedPins } from "../src/panel-ranked.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";

const VIEW: readonly ViewPin[] = [
  pin(1, "First", "info"),
  pin(2, "Second", "action"),
  pin(3, "Third", "warning"),
];

test("the ranking is the level order the panel promises, whatever order the view arrived in", () => {
  expect(new RankedPins().get(VIEW).map((p) => p.id)).toEqual([3, 2, 1]);
});

test("an unchanged view is answered from the memo, so a frame per key costs no sort", () => {
  const ranked = new RankedPins();
  const first = ranked.get(VIEW);
  expect(ranked.get(VIEW)).toBe(first);
});

test("a fresh array is a new view, even holding the very same pins", () => {
  // `commit`/`reconstruct` publish a new array for every change and none without one, which is what lets the
  // memo key on identity: a copy is the signal that something moved, and a memo that compared contents would
  // serve the old order to a view that had been rebuilt.
  const ranked = new RankedPins();
  const first = ranked.get(VIEW);
  expect(ranked.get([...VIEW])).not.toBe(first);
});

test("invalidate forgets the memo for the caller that replaces the view without publishing one", () => {
  const ranked = new RankedPins();
  const first = ranked.get(VIEW);
  ranked.invalidate();
  expect(ranked.get(VIEW)).not.toBe(first);
  // and the memo is a memo again afterwards
  expect(ranked.get(VIEW)).toBe(ranked.get(VIEW));
});

test("invalidate is safe before anything has been ranked", () => {
  const ranked = new RankedPins();
  ranked.invalidate();
  expect(ranked.get(VIEW).map((p) => p.id)).toEqual([3, 2, 1]);
});

test("one memo does not serve another owner's view", () => {
  // The reason this is a class and not a module-level `let`: two panels over two views would each invalidate
  // the other's order, and the bar would sit on a pin the drawer never drew.
  const a = new RankedPins();
  const b = new RankedPins();
  const viewA = a.get(VIEW);
  b.get([pin(9, "Other", "warning")]);
  expect(a.get(VIEW)).toBe(viewA);
});

test("an empty view ranks to an empty array rather than to nothing", () => {
  const ranked = new RankedPins();
  expect(ranked.get([])).toEqual([]);
  ranked.invalidate();
  expect(ranked.get([])).toEqual([]);
});

test("a replied pin ranks below an unreplied one of its own level, newest first within each", () => {
  const replied: readonly ViewPin[] = [
    { ...pin(1, "Answered", "info"), repliedAt: NOW },
    pin(2, "Waiting", "info"),
    pin(3, "Older waiting", "info"),
  ];
  expect(new RankedPins().get(replied).map((p) => p.id)).toEqual([3, 2, 1]);
});
