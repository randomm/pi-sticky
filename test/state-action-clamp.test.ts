/**
 * `clampMaxPins` read directly. The fill-up tests in state-action-limits.test.ts prove the reducer
 * honours *a* limit when handed an unusable one, but they cannot see the arithmetic itself: with
 * `pinOp`'s comparison as the only reader, a clamp that simply returned what it was sent still
 * refused the next pin — at `Infinity` it refused nothing, and the state it published was one
 * `isPinState` bounds out of existence on the next reload. So the table here calls the function
 * directly and names the number that comes back, and the last test is the end-to-end half: one
 * pin past the snapshot bound, refused by the number `25` never was allowed to become.
 */
import { describe, expect, test } from "bun:test";

import { clampMaxPins } from "../src/action.ts";
import { MAX_PINS } from "../src/bounds.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { type ApplyLimits, applyAction, isPinState } from "../src/state.ts";
import type { PinState } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";

const PIN = { op: "pin", text: "t", level: "info", source: "agent", now: NOW } as const;

/** `count` pins with distinct texts and addresses, numbered from 1, so neither guard answers early. */
function filled(count: number): PinState {
  return {
    v: 1,
    pins: Array.from({ length: count }, (_unused, i) =>
      pin(i + 1, `p${i + 1}`, "info", { uid: `addr-${i + 1}` }),
    ),
    nextId: count + 1,
    removed: [],
  };
}

describe("clampMaxPins answers with a limit the snapshot guard accepts", () => {
  test.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["0", 0],
    ["-3", -3],
    ["1.5", 1.5],
    ['"5"', "5"],
  ])("a maxPins of %s falls back to the config default", (_label, maxPins) => {
    expect(clampMaxPins(maxPins)).toBe(DEFAULT_CONFIG.maxPins);
  });

  test("a maxPins above the snapshot bound is cut to it, and one at the bound is kept", () => {
    // Two halves of the clamp the fill-up tests cannot separate: everything below lands on the same
    // `DEFAULT_CONFIG.maxPins`, so a `25` cut to `MAX_PINS` and one replaced by the default look
    // identical from `pinOp`. Both boundaries of the comparison are stated here.
    expect(clampMaxPins(25)).toBe(MAX_PINS);
    expect(clampMaxPins(21)).toBe(MAX_PINS);
    expect(clampMaxPins(MAX_PINS)).toBe(MAX_PINS);
    expect(clampMaxPins(MAX_PINS + 1)).toBe(MAX_PINS);
  });

  test("a maxPins that is already a limit is kept exactly as sent", () => {
    expect(clampMaxPins(20)).toBe(20);
    expect(clampMaxPins(1)).toBe(1);
    expect(clampMaxPins(7)).toBe(7);
  });

  test("a 21st pin is refused under maxPins 25, naming the bound rather than the number sent", () => {
    // The end-to-end half: without the clamp the limit handed to `pinOp` is `25`, twenty-one pins
    // are accepted, and `isPinState` bounds a snapshot at `MAX_PINS` — so the pins do not overflow
    // loudly, they vanish on the next rebuild. The refusal, and the bound it names, is the clamp.
    const limits: ApplyLimits = { maxPins: 25, newUid: () => "fresh-addr" };
    expect(isPinState(filled(MAX_PINS))).toBe(true);

    const refused = applyAction(filled(MAX_PINS), PIN, limits);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBe(
      "20 pins are already shown, which is the limit. Update or unpin one first.",
    );

    const accepted = applyAction(filled(MAX_PINS - 1), PIN, limits);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.state.pins).toHaveLength(MAX_PINS);
    expect(isPinState(accepted.state)).toBe(true);
  });
});
