/**
 * The state guard: what a snapshot has to look like to be trusted. `isPinState` is a *shape* guard,
 * not a sanitizer — the pass that decides what may be drawn is `cleanPinText` — so every case here
 * asks whether a claim a session file could make is a state at all. The session rebuild that reads
 * those snapshots is in state-reconstruct.test.ts, and the reducer that writes them is in
 * state-reducer.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import type { HostContext } from "../src/context.ts";
import { initialShown } from "../src/panel-deps.ts";
import { latestUIShown } from "../src/session-entries.ts";
import { isPinState, isUIShown, isUserAction } from "../src/state-guards.ts";
import { EMPTY_STATE, reconstruct } from "../src/state.ts";

/** The members `initialShown` asks of a context, spelled for a guard test with no ui to give. */
function context(entries: readonly unknown[]): HostContext {
  return {
    sessionManager: { getEntries: () => [...entries] },
    ui: { notify: () => {} },
    mode: "tui",
    hasUI: true,
  } as unknown as HostContext;
}
import type { Pin, PinLevel, Removal } from "../src/types.ts";
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

describe("isUIShown", () => {
  // The read half of the `pi-sticky.ui` persistence contract, asserted at its own boundary rather than
  // through a lifecycle toggle two steps away: the rule that decides whether a malformed entry means
  // "hidden" or "no opinion" is safety-critical (the guard's own doc calls it out), and the only
  // consumer is `latestUIShown`, which reads the *last* well-formed entry of the session.
  const entry = (data: unknown): unknown => ({
    type: "custom",
    customType: "pi-sticky.ui",
    data,
  });

  test("accepts a boolean choice and refuses anything else", () => {
    expect(isUIShown({ v: 1, shown: true })).toBe(true);
    expect(isUIShown({ v: 1, shown: false })).toBe(true);
    expect(isUIShown({ v: 2, shown: true })).toBe(false);
    expect(isUIShown({ v: 1, shown: "yes" })).toBe(false);
    expect(isUIShown({ v: 1, shown: 1 })).toBe(false);
    expect(isUIShown({ v: 1 })).toBe(false);
    expect(isUIShown(null)).toBe(false);
    expect(isUIShown("shown")).toBe(false);
  });

  test("a malformed entry is no opinion at all, so the last good one still wins", () => {
    // The direction the guard exists for: an entry saying `"yes"` must not be read as *hidden* — a
    // panel the user never turned off would go out of sight, silently, for the rest of the session.
    const entries = [entry({ v: 1, shown: true }), entry({ v: 1, shown: "yes" })];
    expect(latestUIShown(entries)).toBe(true);
    expect(initialShown(context(entries))).toBe(true);
  });

  test("the last entry of the session wins, and no entry means shown", () => {
    const hidden = [entry({ v: 1, shown: false })];
    expect(latestUIShown(hidden)).toBe(false);
    expect(initialShown(context(hidden))).toBe(false);
    expect(latestUIShown([])).toBeUndefined();
    // Only this entry type is read: a pins or user-action entry is not an opinion about visibility.
    expect(
      latestUIShown([{ type: "custom", customType: "pi-sticky.user", data: {} }]),
    ).toBeUndefined();
    expect(initialShown(undefined)).toBe(true);
  });
});
