/**
 * The bound a minted uid may not cross: the reducer hands every new pin an address from `newUid`,
 * and `isCoherent` refuses one uid bound to two identities — a user dismissal addressed to that uid
 * would move both of them, retiring a pin the user never named. So a source that repeats an address
 * already in `pins` or `removed` is a refusal, not an ok result whose snapshot no rebuild reads back.
 *
 * The other two size bounds (an over-long `pin` text, a `nextId` at the safe-integer ceiling) are in
 * state-reducer-bounds.test.ts; the malformed-uid refusals are in state-reducer-refusals.test.ts.
 */
import { describe, expect, test } from "bun:test";

import {
  type ActionInput,
  type ApplyLimits,
  EMPTY_STATE,
  applyAction,
  isPinState,
} from "../src/state.ts";
import { NOW, pin, removal, state } from "./fixtures.ts";

const pinAction = (text: string) =>
  ({ op: "pin", text, level: "info", source: "agent", now: NOW }) as ActionInput;

const limits = (newUid: () => string): ApplyLimits => ({ maxPins: 5, newUid });

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
