/**
 * The session rebuild: what a branch of entries plus the session's user actions say the pins are.
 * `reconstruct` is handed `sessionManager.getBranch()` and `getEntries()` and owns no clock of its
 * own, so every case here is a question about which entries are read, in what order, and what a
 * snapshot that does not add up costs. The shape guard those entries pass through, `isPinState`, is
 * in state-guards.test.ts; the reducer that produces the snapshots is in state-reducer.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { REMOVAL_HISTORY } from "../src/bounds.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { EMPTY_STATE, reconstruct } from "../src/state.ts";
import type { Pin, PinState, Removal } from "../src/types.ts";
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

  test("dismissals past the window keep only the newest REMOVAL_HISTORY, session-wide", () => {
    // The window is the reducer's `withRemovals` rule; the user path used to spell the same slice
    // out in its own words. `removedByUser` reads the front of the list and `isPinState` refuses a
    // snapshot longer than the cap, so a user path that kept its own number would publish a state
    // the next rebuild skips — which is what this pins down, at the shared helper's own number.
    //
    // The window is grown by a *dismissal*, and `applyUserAction` records one only for a pin the state
    // still holds — so the removals have to be minted by dismissals that find their pin. Each round of
    // `REMOVAL_HISTORY` dismissals therefore follows a snapshot that carries those pins again: the
    // rebuild starts from the last snapshot before it and replays that round's entries, so one round
    // contributes exactly `REMOVAL_HISTORY` removals, and the later rounds push the earlier ones out
    // of the window. A snapshot big enough to be dismissed 25 times without repeats is not available:
    // `isPinState` bounds `pins` by `MAX_PINS`, and a snapshot it refuses is skipped outright.
    const pinsFor = (base: number) =>
      Array.from({ length: REMOVAL_HISTORY }, (_unused, k) => pin(base + k, `p${base + k}`));
    const rounds = 3;
    const branch: unknown[] = [];
    const entries: unknown[] = [];
    for (let round = 0; round < rounds; round++) {
      const base = round * REMOVAL_HISTORY + 1;
      const snapshot = toolResultEntry({
        v: 1,
        pins: pinsFor(base),
        nextId: base + REMOVAL_HISTORY,
        removed: [],
      });
      branch.push(snapshot);
      entries.push(snapshot);
      for (let k = 0; k < REMOVAL_HISTORY; k++) {
        // Two-digit minutes so the stamp is one `formatLocalTime` reads, and distinct per round
        // through the id it names: the assertion below identifies a removal by both.
        entries.push(
          userEntry(
            userAction(
              `uid-${base + k}`,
              "dismiss",
              `2026-10-23T14:${String(k + 1).padStart(2, "0")}:00.000Z`,
            ),
          ),
        );
      }
    }
    // The guard: the last snapshot was read, or `removed` is short for the wrong reason.
    expect(reconstruct([branch[rounds - 1]], []).state.pins).toHaveLength(REMOVAL_HISTORY);

    const { state: rebuilt } = reconstruct([branch[rounds - 1]], entries);
    // Newest first and cut to the window: only the last round's dismissals survive, and they are in
    // the order `withRemovals` prepends them — the round's last dismissal at the front.
    expect(rebuilt.removed).toHaveLength(REMOVAL_HISTORY);
    expect(rebuilt.removed.map((entry) => entry.id)).toEqual(
      Array.from(
        { length: REMOVAL_HISTORY },
        (_unused, k) => (rounds - 1) * REMOVAL_HISTORY + REMOVAL_HISTORY - k,
      ),
    );
    expect(rebuilt.removed.map((entry) => entry.at)).toEqual(
      Array.from(
        { length: REMOVAL_HISTORY },
        (_unused, k) => `2026-10-23T14:${String(REMOVAL_HISTORY - k).padStart(2, "0")}:00.000Z`,
      ),
    );
    expect(rebuilt.pins).toEqual([]);
    expect(isPinState(rebuilt)).toBe(true);
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
