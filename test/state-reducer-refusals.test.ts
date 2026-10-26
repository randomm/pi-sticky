/**
 * The three refusals that keep `applyAction` from ever returning a state `isPinState` rejects: an
 * `op` no case handles, a `now` too long for a snapshot, and a uid source that mints something the
 * guard's pattern refuses. All three arrive as hand-built actions — the tool's schema (Task 5) is
 * what stops the *model* sending them, and the reducer cannot count on having been called by the
 * tool: `reconstruct` and any future caller hand it an object directly.
 *
 * The text-cleaning half of the same invariant is in state-reducer-clean.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { type ApplyLimits, EMPTY_STATE, applyAction, isPinState } from "../src/state.ts";
import { LATER, NOW, pin, removal, state, uidSource } from "./fixtures.ts";

/**
 * Deterministic uid source, namespaced so a pin this file mints cannot collide with a fixture pin's
 * `uid-<id>`: `isCoherent` refuses a state that binds one address to two identities, and a source
 * that handed out `uid-1` here would refuse the reducer for a fault of the fixture.
 */
function mint(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `minted-${n}`;
  };
}

const limits = (newUid: () => string): ApplyLimits => ({ maxPins: 5, newUid });

/**
 * A starting state whose numbers outrank everything the session has used: `isPinState` requires
 * `nextId` above every pin id *and* every removal id, and one uid per identity — so the pin the
 * `pin` actions add is addressed `uid-11`, which no seed pin or removal holds. A start the guard
 * rejects would make every result assertion below measure the fixture instead of the rule.
 */
const one = state([pin(1, "seed", "info"), pin(2, "other", "info")], 11, [removal(10)]);

const PIN = { op: "pin", text: "t", level: "info", source: "agent" } as const;
const UPDATE = { op: "update", id: 1, level: "warning", source: "agent" } as const;
const UNPIN = { op: "unpin", ids: [1], source: "agent" } as const;

/** One action per op, each carrying every field that op needs to reach its own arithmetic. */
const PER_OP: readonly Record<string, unknown>[] = [PIN, UPDATE, UNPIN];

/** The bound `isBoundedString` in state-guards.ts enforces, spelled out for the boundary tests. */
const MAX_TEXT_UNITS = 8000;

describe("applyAction refuses an op it has no case for", () => {
  test("an unknown op is refused with the op named, not returned as undefined", () => {
    for (const op of ["remove", "", "PIN", 42, null, undefined, "unpin-all"]) {
      const result = applyAction(
        EMPTY_STATE,
        { op, text: "t", now: NOW } as never,
        limits(uidSource()),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(`unknown action "${String(op)}"`);
      // A refusal has no state for the tool to commit.
      expect("state" in result).toBe(false);
    }
  });

  test("an unknown op reaches the refusal whatever the other fields claim", () => {
    // No case ran, so neither the text, level, source nor id checks are what answers this call —
    // a body that would fail every one of them is still answered by its `op`.
    const result = applyAction(
      one,
      { op: "explode", id: 1, text: "", level: "urgent", source: "evil", now: "clock" } as never,
      limits(uidSource()),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown action "explode"');
  });

  test("the three real ops still dispatch, so the default branch did not swallow them", () => {
    // A state and a uid source of their own per op: `one` is module-level, so a loop that ran three
    // ops over it in sequence would have the second and third act on what the first left behind.
    for (const shape of PER_OP) {
      const result = applyAction(
        state([pin(1, "seed", "info")], 11, [removal(10)]),
        { ...shape, now: NOW } as never,
        limits(mint()),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPinState(result.state)).toBe(true);
    }
  });
});

describe("applyAction refuses a now longer than a snapshot may carry", () => {
  test("every op refuses an over-long now with the field named", () => {
    // `isBoundedString` refuses a timestamp over the bound, so accepting one here is an ok result
    // whose snapshot the next rebuild skips: the pins are gone and nothing ever said so.
    const long = "x".repeat(MAX_TEXT_UNITS + 1);
    for (const shape of PER_OP) {
      const result = applyAction(one, { ...shape, now: long } as never, limits(uidSource()));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('now must be a string for action "pin", "update" or "unpin"');
      expect("state" in result).toBe(false);
    }
  });

  test("a now at exactly the bound is accepted and stays guard-valid", () => {
    // The boundary belongs to the guard, and the reducer quotes the same number, so a caller must
    // not lose a pin one unit before the guard would have. `newUid` is `crypto.randomUUID()`, the
    // production source: the seed pin holds the fixtures' `uid-1`, so a counter restarted per op
    // would collide with it and the loop would measure the fixture instead of the rule.
    for (const shape of PER_OP) {
      const result = applyAction(
        one,
        { ...shape, now: "y".repeat(MAX_TEXT_UNITS) } as never,
        limits(() => crypto.randomUUID()),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPinState(result.state)).toBe(true);
    }
  });

  test("a non-string now is still refused, whatever its length", () => {
    for (const now of [12345, null, {}, [], new Date()]) {
      const result = applyAction(one, { ...PIN, now } as never, limits(uidSource()));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('now must be a string for action "pin", "update" or "unpin"');
    }
  });

  test("an over-long now is refused before the removal window is written", () => {
    // `unpin` stamps `removal.at` with `now`, so a refusal has to arrive with the batch intact —
    // the same ordering rule the non-string case is held to in state-action-now.test.ts.
    const withRemoval = state([pin(1, "a")], 2, []);
    const result = applyAction(
      withRemoval,
      { ...UNPIN, now: "z".repeat(MAX_TEXT_UNITS + 1) } as never,
      limits(uidSource()),
    );
    expect(result.ok).toBe(false);
    expect(withRemoval.removed).toHaveLength(0);
    expect(withRemoval.pins).toHaveLength(1);
  });
});

describe("applyAction refuses a uid the guard would reject", () => {
  const BAD_UIDS = ["", "x".repeat(65), "uid with spaces", `uid${String.fromCharCode(0x1b)}[2J`];

  test("a pin whose minted uid breaks the guard's pattern is refused", () => {
    // `pinOp` used to drop whatever `newUid` returned straight into the snapshot. A counter that
    // minted `uid:1`, a generator that padded with a control, or an empty string all produced an ok
    // result whose state `isPinState` rejects, so the pins vanished on reload instead of refusing.
    for (const uid of BAD_UIDS) {
      const result = applyAction(
        EMPTY_STATE,
        { ...PIN, now: NOW } as never,
        limits(() => uid),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("uid is not a valid pin address");
      expect("state" in result).toBe(false);
    }
  });

  test("a source that returns a non-string is refused the same way", () => {
    // `ApplyLimits.newUid` is typed `() => string`, so a source that breaks its own signature reaches
    // the reducer only through an unchecked cast — and still may not mint a pin the guard rejects.
    const badSources: readonly unknown[] = [null, undefined, 42, {}];
    for (const uid of badSources) {
      const result = applyAction(
        EMPTY_STATE,
        { ...PIN, now: NOW } as never,
        limits(() => uid as string),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("uid is not a valid pin address");
    }
  });

  test("the uid is checked before the pin is added, so a refusal leaves nextId alone", () => {
    const before = state([pin(1, "a")], 2);
    const result = applyAction(
      before,
      { ...PIN, now: NOW } as never,
      limits(() => ""),
    );
    expect(result.ok).toBe(false);
    expect(before.nextId).toBe(2);
    expect(before.pins).toHaveLength(1);
  });

  test("a uuid-shaped or counter-shaped uid still mints a guard-valid pin", () => {
    const uuid = applyAction(
      EMPTY_STATE,
      { ...PIN, now: NOW } as never,
      limits(() => "0f8f1f3a-2c6b-4a1e-9d5c-7b0e8a6f1c2d"),
    );
    expect(uuid.ok).toBe(true);
    if (!uuid.ok) return;
    expect(isPinState(uuid.state)).toBe(true);
    const counter = applyAction(EMPTY_STATE, { ...PIN, now: LATER } as never, limits(uidSource()));
    expect(counter.ok && counter.state.pins[0]?.uid).toBe("uid-1");
  });

  test("a bad uid is refused before the duplicate lookup and before the limit", () => {
    // The order the textless pin is held to: a refusal must not be reachable past the branches that
    // reuse or grow state. At the limit, with a duplicate waiting, a broken uid still says `uid`.
    // Both mints are non-empty here, so the only thing that can answer either call is the uid check:
    // the first re-pins `t` at `info` (the duplicate branch), the second matches nothing at maxPins 1
    // (the limit branch). The uid is minted before either runs, so the refusal is what the model
    // reads; a source handed a uuid-shaped string by the same call reaches both branches instead.
    const full = state([pin(1, "t", "info")], 2);
    const duplicate = applyAction(
      full,
      { ...PIN, now: NOW } as never,
      limits(() => "not-an-address!"),
    );
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error).toBe("uid is not a valid pin address");

    const atLimit = applyAction(
      full,
      { op: "pin", text: "other", level: "info", source: "agent", now: NOW } as never,
      { maxPins: 1, newUid: () => "" },
    );
    expect(atLimit.ok).toBe(false);
    if (atLimit.ok) return;
    expect(atLimit.error).toBe("uid is not a valid pin address");
  });
});
