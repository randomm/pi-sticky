/**
 * The state guard and the session rebuild: what a snapshot has to look like to be trusted, and
 * what a branch plus the session's user actions say the pins are. The reducer itself is in
 * state-reducer.test.ts, because that is a different question from what the entries say.
 */
import { describe, expect, test } from "bun:test";

import { EMPTY_STATE, isPinState, isUserAction, reconstruct } from "../src/state.ts";
import type { Pin, PinLevel, PinState, Removal } from "../src/types.ts";
import {
  LATER,
  NOW,
  customEntry,
  pin,
  removal,
  state,
  toolResultEntry,
  userAction,
  userEntry,
} from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

/** A hostile uid: an escape, a zero-width space, empty, or too long to be an address. */
const BAD_UIDS = [`uid${cp(0x1b)}[2J`, `uid${cp(0x200b)}`, "", "x".repeat(65)];

/**
 * A list of `n` valid pins / removals with one hole in the middle — the shape that fooled the old
 * guard, because `Array.prototype.every` skips holes and reports a list of pins that is not one.
 * Built by assignment and `delete` rather than a literal elision, so Biome's rules about literal
 * holes stay live in this file.
 */
function sparsePins(n: number): Pin[] {
  const pins: Pin[] = new Array(n);
  for (let i = 0; i < n; i++) pins[i] = pin(i + 1, `p${i}`);
  delete pins[Math.floor(n / 2)];
  return pins;
}

function sparseRemovals(n: number): Removal[] {
  const removed: Removal[] = new Array(n);
  for (let i = 0; i < n; i++) removed[i] = removal(i + 1);
  delete removed[Math.floor(n / 2)];
  return removed;
}

describe("isPinState", () => {
  test("accepts the empty state and a populated one", () => {
    expect(isPinState(EMPTY_STATE)).toBe(true);
    // The removal's uid must not collide with a live pin's: a retired pin and a shown one are
    // different identities, so the removal uses its own id/uid (2), not the pin's (1).
    expect(isPinState(state([pin(1, "a")], 3, [removal(2)]))).toBe(true);
  });

  test("rejects a wrong version, a non-object and a null", () => {
    expect(isPinState({ ...EMPTY_STATE, v: 2 })).toBe(false);
    expect(isPinState(null)).toBe(false);
    expect(isPinState("state")).toBe(false);
    expect(isPinState(EMPTY_STATE.pins)).toBe(false);
  });

  test("rejects a missing or malformed array, and a bad nextId", () => {
    expect(isPinState({ v: 1, pins: [], removed: [], nextId: 0 })).toBe(false);
    expect(isPinState({ v: 1, pins: [], removed: [], nextId: 1.5 })).toBe(false);
    expect(isPinState({ v: 1, pins: null, removed: [], nextId: 1 })).toBe(false);
    // nextId has to outrank every id the session has used, or the next pin reuses one.
    expect(isPinState(state([pin(1, "a")], 1))).toBe(false);
  });

  test("rejects a pin with a bad level, source or non-integer id", () => {
    expect(isPinState(state([{ ...pin(1, "a"), level: "urgent" as PinLevel }]))).toBe(false);
    expect(isPinState(state([{ ...pin(1, "a"), source: "robot" as "agent" }]))).toBe(false);
    expect(isPinState(state([{ ...pin(1, "a"), id: 1.5 }]))).toBe(false);
  });

  test("rejects a pin that shares a uid with a removal", () => {
    // One uid addresses one identity. If a pin may carry the uid of a removal, a single user
    // dismiss addressed to that uid moves both identities out of `pins` at once.
    expect(isPinState(state([pin(1, "a")], 5, [{ ...removal(4), uid: "uid-1" }]))).toBe(false);
  });

  test("rejects duplicate removal uids", () => {
    expect(isPinState(state([], 5, [removal(3), { ...removal(4), uid: "uid-3" }]))).toBe(false);
  });

  test("rejects duplicate removal ids", () => {
    // Two removals of one id make `removedByUser` report the first and hide the second: a dismissed
    // pin would then carry a record of a dismissal nothing can ever read back, and the id is free
    // to mean two different retirements in the same snapshot.
    expect(isPinState(state([], 5, [removal(3), { ...removal(3), uid: "uid-3b" }]))).toBe(false);
    expect(
      isPinState(
        state([pin(1, "a"), { ...pin(700, "live"), uid: "uc" }], 900, [
          { ...removal(700), uid: "ua" },
          { ...removal(700), uid: "ub" },
        ]),
      ),
    ).toBe(false);
  });

  test("rejects a class instance that otherwise looks like a state", () => {
    class Fake {
      v = 1;
      pins = [];
      nextId = 1;
      removed = [];
    }
    expect(isPinState(new Fake())).toBe(false);
  });

  test("rejects a sparse pins or removed array, which .every() would sail past", () => {
    expect(isPinState(state(sparsePins(3), 4))).toBe(false);
    expect(isPinState(state([], 4, sparseRemovals(3)))).toBe(false);
    expect(isPinState({ v: 1, pins: [], nextId: 1, removed: new Array(5) })).toBe(false);
    expect(isPinState({ v: 1, pins: new Array(3), nextId: 1, removed: [] })).toBe(false);
  });

  test("rejects a snapshot over the structural bounds", () => {
    const many = Array.from({ length: 21 }, (_, i) => pin(i + 1, `p${i}`));
    expect(isPinState(state(many, 22))).toBe(false);
    expect(isPinState(state(many.slice(0, 20), 21))).toBe(true);
    const manyRemovals = Array.from({ length: 21 }, (_, i) => removal(i + 1));
    expect(isPinState(state([], 22, manyRemovals))).toBe(false);
    expect(isPinState(state([], 22, manyRemovals.slice(0, 20)))).toBe(true);
    expect(isPinState(state([pin(1, "x".repeat(8001))], 2))).toBe(false);
    expect(isPinState(state([pin(1, "x".repeat(8000))], 2))).toBe(true);
    expect(isPinState(state([{ ...pin(1, "a"), createdAt: "t".repeat(8001) }], 2))).toBe(false);
    expect(isPinState(state([pin(1, "a")], 2, [{ ...removal(1), at: "t".repeat(8001) }]))).toBe(
      false,
    );
  });

  test("rejects a uid that is not a safe opaque address", () => {
    for (const uid of BAD_UIDS) {
      expect(isPinState(state([{ ...pin(1, "a"), uid }], 2))).toBe(false);
      expect(isPinState(state([pin(1, "a")], 2, [{ ...removal(1), uid }]))).toBe(false);
    }
    // A uuid is what applyAction mints, so it has to be a shape the guard accepts.
    const uuid = "0f8f1f3a-2c6b-4a1e-9d5c-7b0e8a6f1c2d";
    expect(isPinState(state([{ ...pin(1, "a"), uid: uuid }], 2))).toBe(true);
  });
});

describe("isUserAction", () => {
  const snapshot = state([pin(1, "a"), pin(2, "b")], 3);
  const action = (uid: string) => ({ v: 1, uid, action: "dismiss", at: NOW });

  test("accepts a well-shaped action and refuses a bad version or action", () => {
    expect(isUserAction(action("uid-1"))).toBe(true);
    expect(isUserAction({ ...action("uid-1"), v: 2 })).toBe(false);
    expect(isUserAction({ ...action("uid-1"), action: "explode" })).toBe(false);
    expect(isUserAction(null)).toBe(false);
  });

  test("refuses a uid that is not a safe opaque address", () => {
    for (const uid of BAD_UIDS) expect(isUserAction(action(uid))).toBe(false);
  });

  test("an action with a hostile uid is skipped by the rebuild, leaving the pin alone", () => {
    const branch = [toolResultEntry(snapshot)];
    for (const uid of BAD_UIDS) {
      const entries = [userEntry(userAction(uid, "dismiss", LATER))];
      expect(reconstruct(branch, entries).state.pins.map((p) => p.id)).toEqual([1, 2]);
    }
  });
});

describe("reconstruct", () => {
  const snapshot = state([pin(1, "a"), pin(2, "b")], 3);

  test("an empty branch and no entries give the empty state", () => {
    expect(reconstruct([], [])).toEqual({ state: EMPTY_STATE, view: { pins: [], removed: [] } });
  });

  test("the last snapshot on the branch wins", () => {
    const first = state([pin(1, "old")], 2);
    const branch = [toolResultEntry(first), toolResultEntry(snapshot)];
    expect(reconstruct(branch, []).state).toEqual(snapshot);
  });

  test("a tool result from another tool is ignored", () => {
    const branch = [toolResultEntry(snapshot, "read")];
    expect(reconstruct(branch, []).state).toEqual(EMPTY_STATE);
  });

  test("a malformed snapshot is ignored rather than trusted", () => {
    const branch = [toolResultEntry({ v: 1, pins: "not an array" }), toolResultEntry(snapshot)];
    expect(reconstruct(branch, []).state).toEqual(snapshot);
  });

  test("a sparse snapshot is skipped and never makes the rebuild throw", () => {
    // The regression: holes passed `.every(isPin)` because every() skips them, the shape guard
    // said yes and the coherence walk then threw on a hole it read as an object.
    const sparse = state(sparsePins(3), 4);
    const holes = { v: 1, pins: [], nextId: 1, removed: new Array(3) };
    const branch = [toolResultEntry(sparse), toolResultEntry(holes)];
    expect(() => reconstruct(branch, [])).not.toThrow();
    expect(reconstruct(branch, []).state).toEqual(EMPTY_STATE);
    // The previous valid snapshot is what stands, not the sparse one that followed it.
    expect(reconstruct([toolResultEntry(snapshot), toolResultEntry(sparse)], []).state).toEqual(
      snapshot,
    );
  });

  test("an over-bound snapshot is skipped", () => {
    const tooMany = state(
      Array.from({ length: 21 }, (_, i) => pin(i + 1, `p${i}`)),
      22,
    );
    expect(reconstruct([customEntry(tooMany)], []).state).toEqual(EMPTY_STATE);
    const tooLong = state([pin(1, "x".repeat(8001))], 2);
    expect(reconstruct([customEntry(tooLong)], []).state).toEqual(EMPTY_STATE);
  });

  test("a custom pi-sticky.state entry provides a snapshot", () => {
    expect(reconstruct([customEntry(snapshot)], []).state).toEqual(snapshot);
  });

  test("a custom entry of another type provides nothing", () => {
    expect(reconstruct([customEntry(snapshot, "pi-sticky.other")], []).state).toEqual(EMPTY_STATE);
  });

  test("a dismissal recorded outside the branch still hides its pin", () => {
    const branch = [toolResultEntry(snapshot)];
    const entries = [userEntry(userAction("uid-1", "dismiss", LATER))];
    const result = reconstruct(branch, entries);
    expect(result.state.pins.map((p) => p.id)).toEqual([2]);
    expect(result.state.removed[0]?.id).toBe(1);
    expect(result.state.removed[0]?.by).toBe("user");
  });

  test("a reply marks the pin as replied without removing it", () => {
    const branch = [toolResultEntry(snapshot)];
    const entries = [userEntry(userAction("uid-1", "reply", LATER))];
    const result = reconstruct(branch, entries);
    expect(result.state.pins).toHaveLength(2);
    expect(result.view.pins[0]?.repliedAt).toBe(LATER);
    expect(result.view.pins[1]?.repliedAt).toBeUndefined();
  });

  test("a reply to an unknown uid marks nothing", () => {
    const branch = [toolResultEntry(snapshot)];
    const entries = [userEntry(userAction("uid-99", "reply", LATER))];
    const result = reconstruct(branch, entries);
    expect(result.view.pins.every((p) => p.repliedAt === undefined)).toBe(true);
  });

  test("actions are applied in the order they appear", () => {
    const branch = [toolResultEntry(snapshot)];
    const entries = [
      userEntry(userAction("uid-1", "reply", NOW)),
      userEntry(userAction("uid-1", "dismiss", LATER)),
    ];
    const result = reconstruct(branch, entries);
    expect(result.state.pins.map((p) => p.id)).toEqual([2]);
    // The pin is gone, so its reply is no longer drawn.
    expect(result.view.pins.every((p) => p.repliedAt === undefined)).toBe(true);
  });

  test("a malformed user action is skipped", () => {
    const branch = [toolResultEntry(snapshot)];
    const entries = [
      userEntry({ v: 1, uid: "uid-1", action: "explode", at: NOW } as never),
      userEntry(userAction("uid-2", "dismiss", NOW)),
    ];
    const result = reconstruct(branch, entries);
    expect(result.state.pins.map((p) => p.id)).toEqual([1]);
  });

  test("reconstructing twice from the same entries gives the same result", () => {
    const branch = [toolResultEntry(snapshot)];
    const entries = [userEntry(userAction("uid-1", "dismiss", NOW))];
    expect(reconstruct(branch, entries)).toEqual(reconstruct(branch, entries));
  });

  test("a snapshot cannot bind one uid to a pin and a removal so one dismiss retires both", () => {
    // The regression: when only pin uids were checked this shape passed isPinState, and the
    // dismiss of uid-1 moved the pin (id 1) and the unrelated removal (id 4) out together.
    const shared: PinState = {
      v: 1,
      pins: [pin(1, "a")],
      nextId: 5,
      removed: [{ ...removal(4, "agent", NOW), uid: "uid-1" }],
    };
    expect(isPinState(shared)).toBe(false);
    // Refused, so the rebuild starts empty rather than honouring the colliding snapshot.
    const branch = [customEntry(shared)];
    const entries = [userEntry(userAction("uid-1", "dismiss", LATER))];
    expect(reconstruct(branch, entries).state.pins.map((p) => p.id)).toEqual([]);
  });

  test("a state with no pins still reports its removals in the view", () => {
    const emptied: PinState = { v: 1, pins: [], nextId: 3, removed: [removal(2, "user", LATER)] };
    const result = reconstruct([customEntry(emptied)], []);
    expect(result.view.removed).toHaveLength(1);
    expect(result.view.pins).toEqual([]);
  });
});
