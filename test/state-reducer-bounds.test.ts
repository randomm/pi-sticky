/**
 * The two size bounds that keep `applyAction` from returning a state `isPinState` rejects — neither
 * a check on the *shape* of a field but on how big a value it may hold:
 *
 * 1. a `pin` text longer than `MAX_TEXT_UNITS` after cleaning — `isBoundedString` refuses the
 *    stored value, so accepting one is an ok result whose snapshot the next rebuild skips;
 * 2. `nextId` at `Number.MAX_SAFE_INTEGER` — the pin would be minted at the ceiling and the returned
 *    state would carry `nextId` past it, which `isPositiveSafeInteger` refuses outright.
 *
 * The third bound, a minted uid a pin or a removal already holds, is in
 * state-reducer-uid-collision.test.ts; the sibling refusals (unknown op, over-long `now`, malformed
 * uid) are in state-reducer-refusals.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { MAX_TEXT_UNITS } from "../src/bounds.ts";
import {
  type ActionInput,
  type ApplyLimits,
  EMPTY_STATE,
  applyAction,
  isPinState,
} from "../src/state.ts";
import { NOW, pin, removal, state, uidSource } from "./fixtures.ts";

const limits = (newUid: () => string = () => crypto.randomUUID()): ApplyLimits => ({
  maxPins: 5,
  newUid,
});

const pinAction = (text: string) =>
  ({ op: "pin", text, level: "info", source: "agent", now: NOW }) as ActionInput;

describe("applyAction refuses a pin text longer than a snapshot may carry", () => {
  // The bound is the guard's own number, quoted from bounds.ts rather than restated, so a bump moves
  // the reducer and `isBoundedString` together instead of losing a pin one unit early.
  const AT = "x".repeat(MAX_TEXT_UNITS);
  const OVER = "x".repeat(MAX_TEXT_UNITS + 1);

  test("a text at exactly the bound is accepted and stays guard-valid", () => {
    const result = applyAction(EMPTY_STATE, pinAction(AT), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe(AT);
    expect(result.state.pins[0]?.text).toHaveLength(MAX_TEXT_UNITS);
    expect(isPinState(result.state)).toBe(true);
  });

  test("a text one unit over the bound is refused with the 6.2 missing-text message", () => {
    // The regression: `cleanTextOrUndefined` bounded nothing, so this call returned ok with a pin
    // whose text `isBoundedString` rejects — the whole snapshot is then skipped by `reconstruct` and
    // every pin in it vanishes on reload, not just the over-long one.
    const result = applyAction(EMPTY_STATE, pinAction(OVER), limits());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('text is required for action "pin"');
    expect("state" in result).toBe(false);
  });

  test("the bound is measured after cleaning, not before", () => {
    // The boundary judges what gets *stored*, so bytes the sanitizer drops cost nothing: the five
    // units of an SGR prefix carry the input over the bound while the cleaned text sits one unit over
    // it and is refused, and the same text at the bound is kept.
    const withEscapes = `\u001b[31m${AT}`;
    expect(withEscapes.length).toBe(MAX_TEXT_UNITS + 5);
    const result = applyAction(EMPTY_STATE, pinAction(withEscapes), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe(AT);
    expect(result.state.pins[0]?.text).toHaveLength(MAX_TEXT_UNITS);
    expect(isPinState(result.state)).toBe(true);

    // One stored unit past the bound, escapes and all: refused, so the bound really is the cleaned
    // length and not the length of whatever the model typed.
    const over = applyAction(EMPTY_STATE, pinAction(`${withEscapes}y`), limits());
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error).toBe('text is required for action "pin"');
  });

  test("an over-long text is refused before the duplicate lookup and before the limit", () => {
    // Same ordering rule as the textless pin: a refusal must not be reachable past the branches that
    // reuse or grow state. Both calls would otherwise hit a branch — the first a duplicate (the seed
    // pin holds the same text one unit shorter, so only the text bound can answer), the second the
    // limit — and a branch that answered first would be a silent ok.
    const duplicate = applyAction(state([pin(1, AT)], 2), pinAction(OVER), limits());
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error).toBe('text is required for action "pin"');
    // The guard: the setup did have a near-duplicate to absorb the call, and it is a real pin.
    const wouldBeDuplicate = applyAction(state([pin(1, AT)], 2), pinAction(AT), limits());
    expect(wouldBeDuplicate.ok).toBe(true);

    const atLimit = applyAction(state([pin(1, "a")], 2), pinAction(OVER), {
      maxPins: 1,
      newUid: () => crypto.randomUUID(),
    });
    expect(atLimit.ok).toBe(false);
    if (atLimit.ok) return;
    expect(atLimit.error).toBe('text is required for action "pin"');
  });

  test("an update whose text is over the bound leaves the old text in place", () => {
    // An over-long text is absent, exactly as one that cleans to nothing is: the level change still
    // lands and the text the user is reading is not replaced by a snapshot the guard rejects.
    const start = state([pin(1, "original", "info")], 2);
    const result = applyAction(
      start,
      {
        op: "update",
        id: 1,
        text: OVER,
        level: "warning",
        source: "agent",
        now: NOW,
      },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe("original");
    expect(result.state.pins[0]?.level).toBe("warning");
    expect(isPinState(result.state)).toBe(true);
  });
});

describe("applyAction refuses to mint a pin id past the safe-integer ceiling", () => {
  test("a state at nextId = MAX_SAFE_INTEGER is refused with a short error", () => {
    // The pin would take `nextId` itself (fine) but return `nextId + 1`, which is not a safe integer:
    // `isCoherent` refuses it through `isPositiveSafeInteger`, so the tool would publish a snapshot
    // whose pins all vanish on the next rebuild. A refusal names the exhausted counter instead.
    const atCeiling = state([pin(Number.MAX_SAFE_INTEGER - 1, "old")], Number.MAX_SAFE_INTEGER);
    expect(isPinState(atCeiling)).toBe(true);
    const result = applyAction(atCeiling, pinAction("one more"), limits());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No more pin ids are available.");
    expect(result.error.length).toBeLessThan(80);
    expect("state" in result).toBe(false);
    expect(atCeiling.pins).toHaveLength(1);
  });

  test("the refusal runs after the duplicate and limit branches, which need no new id", () => {
    // A duplicate or an over-limit call at the ceiling is still answered by the branch that matches
    // it: neither mints an id, so the exhausted counter must not turn a re-pin into `no ids left`.
    const atCeiling = state([pin(Number.MAX_SAFE_INTEGER - 1, "old")], Number.MAX_SAFE_INTEGER);
    const duplicate = applyAction(atCeiling, pinAction("old"), limits());
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.duplicateOf).toBe(Number.MAX_SAFE_INTEGER - 1);

    const atLimit = applyAction(atCeiling, pinAction("new"), {
      maxPins: 1,
      newUid: uidSource(),
    });
    expect(atLimit.ok).toBe(false);
    if (atLimit.ok) return;
    expect(atLimit.error).toContain("1 pins are already shown");
  });

  test("one id below the ceiling still mints a pin, so the refusal is not off by one", () => {
    const nearTop = state([pin(Number.MAX_SAFE_INTEGER - 2, "old")], Number.MAX_SAFE_INTEGER - 1);
    const result = applyAction(nearTop, pinAction("one more"), limits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[1]?.id).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(result.state.nextId).toBe(Number.MAX_SAFE_INTEGER);
    expect(isPinState(result.state)).toBe(true);
  });

  test("update and unpin are unaffected: neither mints an id", () => {
    const atCeiling = state([pin(Number.MAX_SAFE_INTEGER - 1, "old")], Number.MAX_SAFE_INTEGER);
    const updated = applyAction(
      atCeiling,
      {
        op: "update",
        id: Number.MAX_SAFE_INTEGER - 1,
        level: "warning",
        source: "agent",
        now: NOW,
      },
      limits(),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.state.nextId).toBe(Number.MAX_SAFE_INTEGER);
    expect(isPinState(updated.state)).toBe(true);

    const unpinned = applyAction(
      atCeiling,
      { op: "unpin", ids: "all", source: "agent", now: NOW },
      limits(),
    );
    expect(unpinned.ok).toBe(true);
    if (!unpinned.ok) return;
    expect(unpinned.state.pins).toEqual([]);
    expect(unpinned.state.nextId).toBe(Number.MAX_SAFE_INTEGER);
    expect(isPinState(unpinned.state)).toBe(true);
  });
});
