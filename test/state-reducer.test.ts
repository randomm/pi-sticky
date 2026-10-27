/**
 * The pin reducer: what applyAction does to a state for each of the three operations, including
 * the guards a model can trip (the limit, a duplicate, an unknown id, an id the user removed).
 * The state guard and the session rebuild are in state-guards.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { type ApplyLimits, applyAction } from "../src/reducer.ts";
import { EMPTY_STATE } from "../src/state.ts";
import type { PinLevel } from "../src/types.ts";
import { LATER, LATER_TIME, NOW, pin, removal, state, uidSource } from "./fixtures.ts";

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: uidSource() });

const pinAction = (text = "check the migration", level: PinLevel = "info", now = NOW) =>
  ({ op: "pin", text, level, source: "agent", now }) as const;

describe("applyAction pin", () => {
  test("appends a pin with the next id and a fresh uid", () => {
    const result = applyAction(EMPTY_STATE, pinAction(), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1]);
    expect(result.state.pins).toHaveLength(1);
    const [only] = result.state.pins;
    expect(only?.id).toBe(1);
    expect(only?.uid).toBe("mint-1");
    expect(only?.createdAt).toBe(NOW);
    expect(only?.updatedAt).toBe(NOW);
    expect(result.state.nextId).toBe(2);
  });

  test("ids keep counting up from the state it was given", () => {
    const start = state([pin(1, "one")], 2);
    const result = applyAction(start, pinAction("two"), limits());
    expect(result.ok && result.affected).toEqual([2]);
  });

  test("an identical text and level is a duplicate, not a second pin", () => {
    const start = state([pin(1, "same", "warning")], 2);
    const result = applyAction(start, pinAction("same", "warning"), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicateOf).toBe(1);
    expect(result.affected).toEqual([1]);
    expect(result.state).toBe(start);
  });

  test("the same text at another level is a different pin", () => {
    const start = state([pin(1, "same", "warning")], 2);
    const result = applyAction(start, pinAction("same", "info"), limits());
    expect(result.ok && result.duplicateOf).toBeUndefined();
  });

  test("at maxPins a new pin is refused with the limit named", () => {
    const start = state([pin(1, "a"), pin(2, "b")], 3);
    const result = applyAction(start, pinAction("c"), limits(2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("2 pins are already shown");
  });

  test("a duplicate does not need a free slot", () => {
    const start = state([pin(1, "a")], 2);
    const result = applyAction(start, pinAction("a"), limits(1));
    expect(result.ok).toBe(true);
  });
});

describe("applyAction update", () => {
  const one = state([pin(1, "original", "info")], 2);

  test("replaces text and stamps updatedAt", () => {
    const result = applyAction(
      one,
      { op: "update", id: 1, text: "rewritten", source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe("rewritten");
    expect(result.state.pins[0]?.level).toBe("info");
    expect(result.state.pins[0]?.updatedAt).toBe(LATER);
    expect(result.state.pins[0]?.createdAt).toBe(NOW);
  });

  test("replaces level alone when text is absent", () => {
    const result = applyAction(
      one,
      { op: "update", id: 1, level: "warning", source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok && result.state.pins[0]?.level).toBe("warning");
  });

  test("an update with neither text nor level is refused", () => {
    const result = applyAction(one, { op: "update", id: 1, source: "agent", now: LATER }, limits());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("update needs text or level");
  });

  test("an unknown id reports no pin with that number", () => {
    const result = applyAction(
      one,
      { op: "update", id: 9, text: "x", source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No pin #9.");
  });

  test("an id the user removed names the user and the time", () => {
    const gone = state([], 2, [removal(1, "user", LATER)]);
    const result = applyAction(
      gone,
      { op: "update", id: 1, text: "x", source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("removed by the user");
    expect(result.error).toContain(LATER_TIME);
  });
});

describe("applyAction unpin", () => {
  const three = state([pin(1, "a"), pin(2, "b"), pin(3, "c")], 4);

  test("removes the named ids and records the removals newest first", () => {
    const result = applyAction(
      three,
      { op: "unpin", ids: [1, 3], source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([1, 3]);
    expect(result.state.pins.map((p) => p.id)).toEqual([2]);
    // Prepended in state order, not request order: the batch keeps the pins in the order they
    expect(result.state.removed[0]?.by).toBe("agent");
    expect(result.state.removed[0]?.at).toBe(LATER);
  });

  test("all removes every pin", () => {
    const result = applyAction(
      three,
      { op: "unpin", ids: "all", source: "user", now: LATER },
      limits(),
    );
    expect(result.ok && result.state.pins).toEqual([]);
    expect(result.ok && result.state.removed).toHaveLength(3);
  });

  test("nextId is never rewound, so an id cannot be reused", () => {
    const result = applyAction(
      three,
      { op: "unpin", ids: "all", source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok && result.state.nextId).toBe(4);
    const again = result.ok ? applyAction(result.state, pinAction("new"), limits()) : null;
    expect(again?.ok && again.affected).toEqual([4]);
  });

  test("an empty id list is a no-op, not an error", () => {
    const result = applyAction(
      three,
      { op: "unpin", ids: [], source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affected).toEqual([]);
    expect(result.state).toBe(three);
  });

  test("an unknown id reports no pin with that number", () => {
    const result = applyAction(
      three,
      { op: "unpin", ids: [9], source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No pin #9.");
  });

  test("removal history keeps the twenty most recent", () => {
    const many = state(
      Array.from({ length: 25 }, (_, i) => pin(i + 1, `p${i}`)),
      26,
    );
    const result = applyAction(
      many,
      { op: "unpin", ids: "all", source: "agent", now: LATER },
      limits(),
    );
    expect(result.ok && result.state.removed).toHaveLength(20);
    // The window keeps twenty and the batch is newer than anything recorded before it, so it is
    // prepended whole and cut from the front: the five that fall off are the highest ids.
    expect(result.ok && result.state.removed[0]?.id).toBe(1);
    expect(result.ok && result.state.removed[19]?.id).toBe(20);
  });
});
