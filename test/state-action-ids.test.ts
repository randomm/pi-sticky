/**
 * The `ids` field of an `unpin` as the model actually sent it. `normaliseIds` is the only check a
 * batch passes on its way to `unpinOp`, and `unpinOp` compares the batch against the pins with
 * `includes` three times over, so a batch that is not a batch — a bare number, a string, an array
 * holding a hole or a fraction — is refused rather than compared, and a batch nobody could have
 * typed is refused before it is walked.
 *
 * The rest of the hostile-body checks (`text`, `level`, `source`, `id`, `op`) are in
 * state-action-input.test.ts; the state arithmetic an accepted batch produces is in
 * state-reducer.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { MAX_PINS } from "../src/bounds.ts";
import { type ApplyLimits, applyAction } from "../src/state.ts";
import { NOW, pin, state, uidSource } from "./fixtures.ts";

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: uidSource() });
const two = state([pin(1, "a"), pin(2, "b")], 3);

const unpin = (ids: unknown) =>
  applyAction(two, { op: "unpin", ids, source: "agent", now: NOW }, limits());

const INVALID_IDS: readonly unknown[] = [
  null,
  undefined,
  "1",
  1,
  {},
  ["1"],
  [1.5],
  [0],
  [-1],
  [null],
  [Number.NaN],
];

describe("applyAction refuses an ids that is not a batch of ids", () => {
  test.each(INVALID_IDS.map((ids) => [ids]))("an ids of %p is refused", (ids) => {
    const result = unpin(ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('id is required for action "unpin"');
  });

  test("a batch longer than a snapshot may hold pins is refused at once, not walked", () => {
    // `normaliseIds` used to compare every element against the ids already kept, so a hostile body
    // of 100k numbers cost a quadratic walk before the reducer answered. The cap is `MAX_PINS`:
    // that many pins exist, so a batch that cannot match more than that of them is not a batch a
    // real call contains. The refusal is the one naming the batch (state-action-oversize.test.ts
    // checks its wording), and it arrives without the walk having run.
    const huge = Array.from({ length: 100_000 }, (_unused, i) => i + 1);
    expect(huge.length).toBeGreaterThan(MAX_PINS);
    const started = performance.now();
    const result = unpin(huge);
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(`Too many ids: at most ${MAX_PINS} pins can be unpinned at once.`);
    expect(elapsed).toBeLessThan(100);
  });

  test("a batch of exactly the bound is walked and answered", () => {
    // The other side of the cap: a body of `MAX_PINS` ids is a batch as far as the check is
    // concerned, so the bound is `>`, not `>=`, and a real call is not refused one id early.
    const ids = Array.from({ length: MAX_PINS }, (_unused, i) => i + 1);
    const result = unpin(ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1, 2]);
  });

  test("a duplicate id counts once: affected and missing have no repeats", () => {
    const result = unpin([1, 1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1]);
    expect(result.missing).toEqual([]);
    expect(result.state.pins.map((p) => p.id)).toEqual([2]);
    expect(result.state.removed).toHaveLength(1);
  });

  test("a duplicate unknown id appears in missing once", () => {
    const result = unpin([9, 9, 1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1]);
    expect(result.missing).toEqual([9]);
  });

  test("a repeated id keeps first-seen order: [9,3,9,1] asks for 9, 3 then 1", () => {
    // `missing` reports the ids nothing matched, in the order they were asked and with repeats
    // collapsed, so the dedupe has to keep the first occurrence where it was rather than sorting the
    // batch. (`affected` is not the evidence: it is read off `state.pins`, so it is pin order.)
    const result = unpin([9, 3, 9, 1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1]);
    expect(result.missing).toEqual([9, 3]);
  });

  test("a repeated id that matches nothing reports the one id, not the batch", () => {
    const result = unpin([9, 9]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No pin #9.");
  });

  test("a source outside its union is refused before the batch is cut", () => {
    // `by` of a removal is drawn by the user-removal error and `isPinState` checks it, so a
    // `by: ""` written here is a state the guard rejects with the pins already gone.
    for (const source of ["", "evil", 5, null]) {
      const result = applyAction(two, { op: "unpin", ids: "all", source, now: NOW }, limits());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('source must be "agent" or "user"');
      // Nothing was removed on the way to saying no.
      expect(two.pins.map((p) => p.id)).toEqual([1, 2]);
      expect(two.removed).toEqual([]);
    }
  });
});
