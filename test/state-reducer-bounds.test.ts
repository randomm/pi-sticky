/**
 * The three bounds that keep `applyAction` from returning a state `isPinState` rejects, none of
 * which is a check on the *shape* of a field but on its size or its uniqueness:
 *
 * 1. a `pin` text longer than `MAX_TEXT_UNITS` after cleaning — `isBoundedString` refuses the
 *    stored value, so accepting one is an ok result whose snapshot the next rebuild skips;
 * 2. a uid the source mints that a pin or a removal already holds — `isCoherent` refuses one address
 *    bound to two identities, so a colliding mint publishes a snapshot no rebuild reads back;
 * 3. `nextId` at `Number.MAX_SAFE_INTEGER` — the pin would be minted at the ceiling and the returned
 *    state would carry `nextId` past it, which `isPositiveSafeInteger` refuses outright.
 *
 * The sibling refusals (unknown op, over-long `now`, malformed uid) are in
 * state-reducer-refusals.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { MAX_TEXT_UNITS } from "../src/bounds.ts";
import { type ApplyLimits, EMPTY_STATE, applyAction, isPinState } from "../src/state.ts";
import { NOW, pin, removal, state, uidSource } from "./fixtures.ts";

const limits = (newUid: () => string = () => crypto.randomUUID()): ApplyLimits => ({
  maxPins: 5,
  newUid,
});

const pinAction = (text: string) =>
  ({ op: "pin", text, level: "info", source: "agent", now: NOW }) as never;

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
      } as never,
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.text).toBe("original");
    expect(result.state.pins[0]?.level).toBe("warning");
    expect(isPinState(result.state)).toBe(true);
  });
});

describe("applyAction refuses a uid the state already holds", () => {
  // `mintEach` hands out its list once each and then runs out: a source that repeated a spent address
  // is exactly the fault under test, and `uidSource()` restarting at `uid-1` would collide with the
  // fixtures' own `uid-<id>` addresses and make the refusal the fixture's doing, not the rule's.
  function mintEach(...uids: string[]): () => string {
    let n = 0;
    return () => uids[n++] ?? "";
  }

  test("a minted uid that duplicates an existing pin's uid is refused", () => {
    // `isCoherent` refuses one uid bound to two identities: a user dismissal addressed to that uid
    // would move both pins, retiring a pin the user never named. The reducer mints the address, so a
    // source that repeats one (a fixture, a broken generator, a collision) must be a refusal rather
    // than an ok result whose snapshot no rebuild reads back.
    const start = state([pin(1, "first")], 2);
    const result = applyAction(
      start,
      pinAction("second"),
      limits(() => "uid-1"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("uid is not a valid pin address");
    expect("state" in result).toBe(false);
    expect(start.pins).toHaveLength(1);
    expect(start.nextId).toBe(2);
  });

  test("a minted uid that duplicates a removal's uid is refused too", () => {
    // A removal keeps its uid: the pin may not take the address of a pin the user already dismissed,
    // because `removedByUser` reports the first record for an id and the second is unreadable.
    const start = state([pin(1, "kept", "info")], 11, [removal(10)]);
    const result = applyAction(
      start,
      pinAction("second"),
      limits(() => "uid-10"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("uid is not a valid pin address");
    expect("state" in result).toBe(false);
  });

  test("the duplicate uid is refused whatever the guard-valid path would otherwise return", () => {
    // Pinning twice with a constant source: the first call mints `dup` for a new pin, the second
    // finds no duplicate *text* and would append a second pin under the same address. `ok: false`
    // is the only acceptable answer for the second call, and every ok result stays guard-valid.
    const start = state([], 1);
    const first = applyAction(
      start,
      pinAction("first"),
      limits(() => "dup"),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(isPinState(first.state)).toBe(true);

    const second = applyAction(
      first.state,
      pinAction("second"),
      limits(() => "dup"),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("uid is not a valid pin address");
    // No state for the tool to commit: the refusal shape carries no `state` field at all.
    expect("state" in second).toBe(false);
  });

  test("a duplicate of an existing pin is still ok, and the refused call never grows state", () => {
    // The duplicate branch returns the state it was given, so the collision check must not turn a
    // legitimate re-pin into a refusal. The uid is minted in `applyAction` before the branch runs,
    // so what this pins down is the other half: the refused second call leaves no second pin and no
    // advanced counter behind.
    const start = state([pin(1, "same")], 2);
    const duplicate = applyAction(start, pinAction("same"), limits(mintEach("uid-9")));
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.duplicateOf).toBe(1);
    expect(duplicate.state).toBe(start);

    const refused = applyAction(start, pinAction("other"), limits(mintEach("uid-1")));
    expect(refused.ok).toBe(false);
    expect(start.pins).toHaveLength(1);
    expect(start.nextId).toBe(2);
  });

  test("a fresh uid from a working counter still mints a guard-valid pin", () => {
    // Belt for the tests above: with a source that does not repeat itself, pinning twice adds two
    // pins and both snapshots pass the guard.
    const uid = mintEach("uid-100", "uid-101");
    const first = applyAction(EMPTY_STATE, pinAction("one"), limits(uid));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyAction(first.state, pinAction("two"), limits(uid));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.pins.map((p) => p.uid)).toEqual(["uid-100", "uid-101"]);
    expect(isPinState(second.state)).toBe(true);
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
