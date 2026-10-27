/**
 * A uid source that throws. `applyAction` calls `limits.newUid` once per `pin`, and every other
 * failure in the reducer is a returned `ok: false` — the tool (Task 5) turns that into a failed
 * tool result the model reads. A throw is nothing the tool receives: the call disappears with the
 * stack, which is how a reducer documented as never throwing loses a pin and its explanation
 * together. The three sources below are what a fixture, a replayed session entry or a future
 * caller's own generator actually look like when they are broken: a class (callable only with
 * `new`, so calling it is a TypeError), a Proxy whose `apply` trap throws, and a plain thrower.
 *
 * The refusal is the same one a uid the guard refuses gets (`badUid` in action.ts), because from
 * the tool's side the two are the same fact: no addressable pin was minted.
 */
import { describe, expect, test } from "bun:test";

import type { ApplyResult } from "../src/action.ts";
import { type ApplyLimits, applyAction } from "../src/reducer.ts";
import { EMPTY_STATE } from "../src/state.ts";
import type { PinState } from "../src/types.ts";
import { NOW, pin, state } from "./fixtures.ts";

const PIN = { op: "pin", text: "t", level: "info", source: "agent", now: NOW } as const;

/** A callable the reducer must not let reach the tool as an exception. One cast per source. */
const THROWERS: readonly [string, unknown][] = [
  ["a class", class PinUid {}],
  [
    "a Proxy whose apply trap throws",
    new Proxy(() => "minted-1", {
      apply() {
        throw new Error("uid source is down");
      },
    }),
  ],
  [
    "a function that throws",
    () => {
      throw new Error("uid source is down");
    },
  ],
];

describe("applyAction never throws when the uid source does", () => {
  for (const [label, newUid] of THROWERS) {
    test(`${label} is refused as a bad uid instead of throwing`, () => {
      const limits = { maxPins: 5, newUid } as ApplyLimits;
      // Declared with the result's own type rather than left to inference: a `let` with no
      // initializer is only a `never` until an assignment flows into it, and the assignment happens
      // inside the callback below, which the compiler does not read as one.
      let result: ApplyResult | undefined;
      expect(() => {
        result = applyAction(EMPTY_STATE, PIN, limits);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (!result || result.ok) return;
      expect(result.error).toBe("uid is not a valid pin address");
      expect("state" in result).toBe(false);
    });
  }

  test("a throwing source does not stop the other ops from answering", () => {
    // The catch belongs to the pin path alone: `update` and `unpin` mint nothing, so a source that
    // throws must not become a reason the user cannot dismiss a pin.
    const limits = {
      maxPins: 5,
      newUid: () => {
        throw new Error("uid source is down");
      },
    } as ApplyLimits;
    const start: PinState = state([pin(1, "seed")], 2);
    expect(
      applyAction(start, { op: "unpin", ids: [1], source: "agent", now: NOW }, limits).ok,
    ).toBe(true);
    expect(
      applyAction(
        start,
        { op: "update", id: 1, level: "warning", source: "agent", now: NOW },
        limits,
      ).ok,
    ).toBe(true);
  });
});
