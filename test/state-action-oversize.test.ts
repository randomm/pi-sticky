/**
 * The refusal for an `unpin` whose `ids` is not a batch of ids, split by *why* it is not one.
 * A body with more than `MAX_PINS` elements cannot match more pins than exist, so it is a generated
 * payload and the answer has to say so; anything else — a bare number, a string, an array with a
 * hole, a fraction — is the model having written the `ids` field wrong, and keeps the 6.2 wording.
 * Both arrive as `ok: false`; what they must not share is a message that sends the model off to fix
 * the field it wrote correctly. The walk itself (duplicates, first-seen order, the cap's cost) is in
 * state-action-ids.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { MAX_PINS } from "../src/bounds.ts";
import { type ApplyLimits, applyAction } from "../src/state.ts";
import { NOW, pin, state, uidSource } from "./fixtures.ts";

const limits: ApplyLimits = { maxPins: 5, newUid: uidSource() };
const two = state([pin(1, "a"), pin(2, "b")], 3);

const unpin = (ids: unknown) =>
  applyAction(two, { op: "unpin", ids, source: "agent", now: NOW }, limits);

const WRONG_FIELD = 'id is required for action "unpin"';
const TOO_MANY = `Too many ids: at most ${MAX_PINS} pins can be unpinned at once.`;

describe("applyAction names an oversized ids batch as oversized", () => {
  test.each([MAX_PINS + 1, MAX_PINS * 2, 100_000])(
    "an array of %i ids is refused with the batch named, not the field",
    (length) => {
      const ids = Array.from({ length }, (_unused, i) => i + 1);
      const result = unpin(ids);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TOO_MANY);
      // Refused on the length alone: the elements were never looked at, and nothing was removed.
      expect(two.pins.map((p) => p.id)).toEqual([1, 2]);
    },
  );

  test("an oversized batch of garbage answers the batch, not its contents", () => {
    // Which check answers first is the whole difference between the two messages, so the oversized
    // body is built from elements that would each answer "wrong field" on their own.
    const result = unpin(Array.from({ length: MAX_PINS + 1 }, () => "1"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(TOO_MANY);
  });

  test.each([
    ["a bare number", 1],
    ["a string", "1"],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
    ["an array with a hole", new Array(3).fill(1).map((one, i) => (i === 1 ? undefined : one))],
    ["an array holding a fraction", [1.5]],
    ["an array holding zero", [0]],
    ["an array holding a string", ["1"]],
  ])("%s keeps the refusal that names the ids field", (_label, ids) => {
    const result = unpin(ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(WRONG_FIELD);
  });

  test("a batch of exactly the bound is a batch and answers normally", () => {
    // The boundary both messages sit either side of: `>` the bound, not `>=`, so a real call that
    // asks for every pin in a full state is never told it asked for too many.
    const ids = Array.from({ length: MAX_PINS }, (_unused, i) => i + 1);
    const result = unpin(ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1, 2]);
  });
});
