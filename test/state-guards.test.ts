/**
 * The state guard and the session rebuild: what a snapshot has to look like to be trusted, and
 * what a branch plus the session's user actions say the pins are. The reducer itself is in
 * state-reducer.test.ts, because that is a different question from what the entries say.
 */
import { describe, expect, test } from "bun:test";

import { EMPTY_STATE, isPinState, reconstruct } from "../src/state.ts";
import type { PinLevel, PinState } from "../src/types.ts";
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

describe("isPinState", () => {
  test("accepts the empty state and a populated one", () => {
    expect(isPinState(EMPTY_STATE)).toBe(true);
    expect(isPinState(state([pin(1, "a")], 2, [removal(1)]))).toBe(true);
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
  });

  test("rejects a pin with a bad level, source or non-integer id", () => {
    expect(isPinState(state([{ ...pin(1, "a"), level: "urgent" as PinLevel }]))).toBe(false);
    expect(isPinState(state([{ ...pin(1, "a"), source: "robot" as "agent" }]))).toBe(false);
    expect(isPinState(state([{ ...pin(1, "a"), id: 1.5 }]))).toBe(false);
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

  test("a state with no pins still reports its removals in the view", () => {
    const emptied: PinState = { v: 1, pins: [], nextId: 3, removed: [removal(2, "user", LATER)] };
    const result = reconstruct([customEntry(emptied)], []);
    expect(result.view.removed).toHaveLength(1);
    expect(result.view.pins).toEqual([]);
  });
});
