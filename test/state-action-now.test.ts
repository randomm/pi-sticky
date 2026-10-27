/**
 * The timestamp field of a model-authored action. `now` is the one field the reducer copies into
 * state without rewriting it — `pin` stamps `createdAt`/`updatedAt` with it, `update` stamps
 * `updatedAt`, `unpin` stamps `removal.at` — and all three are read back by `isPinState`, which
 * requires a string. So a `now` that is not a string is not a cosmetic problem: the action comes
 * back `ok: true` carrying a snapshot the module's own guard rejects, and the pins vanish on the
 * next reload instead of the model reading a refusal.
 *
 * `crypto.randomUUID()` is the uid source, as in production: a counter restarted per test would mint
 * `uid-1` for the pin it adds and collide with the seed pin's uid, which the guard is right to
 * reject — a failure of the fixture, not of the rule under test.
 *
 * The other action fields (`text`, `level`, `source`, `ids`) are in state-action-input.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { type ApplyLimits, applyAction } from "../src/reducer.ts";
import { isPinState } from "../src/state-guards.ts";
import { formatLocalTime } from "../src/time.ts";
import { LATER, NOW, pin, removal, state } from "./fixtures.ts";

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: () => crypto.randomUUID() });

/**
 * A guard-valid starting state: one pin at id 1 (uid `uid-1`, the fixtures' own address) and one
 * user removal at id 10. `nextId` is 11 because `isPinState` requires it to outrank every id the
 * session has used — pins *and* removals — and a starting state that fails the guard itself would
 * make every result assertion below measure the fixture instead of the rule.
 */
const one = state([pin(1, "seed", "info")], 11, [removal(10, "user", LATER)]);

/** One action per op, with every field that op needs in order to reach its own arithmetic. */
const PER_OP: Record<string, unknown>[] = [
  { op: "pin", text: "t", level: "info", source: "agent" },
  // A textless, levelless update is refused for another reason, so this one carries a level.
  { op: "update", id: 1, level: "warning", source: "agent" },
  { op: "unpin", ids: [1], source: "agent" },
];

describe("applyAction refuses a now that is not a string", () => {
  test("every op refuses a non-string now, naming the field", () => {
    // The regression: with no check, all three of these returned `ok: true` with a state whose
    // timestamp field held the value verbatim, and `isPinState` rejected that state.
    for (const shape of PER_OP) {
      for (const now of [undefined, 12345, null, true, {}, [], new Date(), ["2026-10-23"]]) {
        const result = applyAction(one, { ...shape, now }, limits());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe('now must be a string for action "pin", "update" or "unpin"');
        // A refusal carries no state for the tool to commit, and the state it was given is
        // untouched: a broken `now` must not have stamped a pin or recorded a removal on the way to
        // saying no.
        expect("state" in result).toBe(false);
        expect(one.pins[0]?.updatedAt).toBe(NOW);
        // The starting state is the module-level `one`: a `now` that arrives broken must not have
        // stamped its pin or grown its removal window on the way to saying no.
        expect(one.removed).toHaveLength(1);
      }
    }
  });

  test("the starting state this file asserts against is itself guard-valid", () => {
    // Belt for every case below: `isPinState(result.state)` is only evidence about the reducer when
    // the state it started from passes the same guard.
    expect(isPinState(one)).toBe(true);
  });

  test("the refusal runs before the duplicate lookup and before the limit", () => {
    // Same ordering rule that keeps a textless pin from being absorbed as a duplicate of the `""`
    // pin: a refusal must not be reachable past the branches that mutate or reuse state. The first
    // case re-pins `seed` at `info` — the duplicate branch — and the second sends `third`, which
    // matches nothing, so at maxPins 2 it reaches the limit branch. Either way a bad `now` still
    // says `now`.
    const full = applyAction(
      one,
      { op: "pin", text: "second", level: "info", source: "agent", now: NOW },
      limits(2),
    );
    // Guard: the setup has to have worked, or the two cases below prove nothing about ordering.
    expect(full.ok).toBe(true);
    const fullState = full.ok ? full.state : one;
    const duplicate = applyAction(
      fullState,
      { op: "pin", text: "seed", level: "info", source: "agent", now: 7 },
      limits(2),
    );
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error).toBe('now must be a string for action "pin", "update" or "unpin"');

    const atLimit = applyAction(
      fullState,
      { op: "pin", text: "third", level: "info", source: "agent", now: null },
      limits(2),
    );
    expect(atLimit.ok).toBe(false);
    if (atLimit.ok) return;
    expect(atLimit.error).toBe('now must be a string for action "pin", "update" or "unpin"');
  });

  test("an empty now is accepted: it is a string, so the state stays guard-valid", () => {
    // Refusing `""` would invent a rule the spec does not state, and `formatLocalTime("")` already
    // answers `--:--` (render.test.ts): an empty timestamp is a bad clock, not a hostile value. The
    // promise here is only that it cannot produce a snapshot the guard rejects.
    for (const shape of PER_OP) {
      const result = applyAction(one, { ...shape, now: "" }, limits());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPinState(result.state)).toBe(true);
    }
  });

  test("an unparseable now is accepted for the same reason", () => {
    // `not a date` reaches `formatLocalTime` and draws `--:--`; it is not the reducer's business to
    // second-guess the caller's clock, only to refuse a value that is not a string at all.
    const result = applyAction(
      one,
      { op: "pin", text: "odd clock", level: "info", source: "agent", now: "not a date" },
      limits(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPinState(result.state)).toBe(true);
    // `pins[1]` — `pins[0]` is the seed pin, whose stamps must not move when a *new* pin is added.
    const stamped = result.state.pins[1];
    expect(result.state.pins[0]?.createdAt).toBe(NOW);
    expect(stamped?.createdAt).toBe("not a date");
    expect(stamped?.updatedAt).toBe("not a date");
    // The odd stamp reaches the model-facing surface and still draws: the guard's job is the shape,
    // `formatLocalTime`'s is an unusable clock.
    expect(formatLocalTime(stamped?.createdAt ?? "")).toBe("--:--");
  });
});
