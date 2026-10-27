/**
 * The limits `applyAction` is handed. Everything else about a model-authored action — its `op`, its
 * `text`, its `ids` — is the model's claim and is refused when false; `limits` is the *caller's*
 * arithmetic, and the reducer used to trust it outright. `maxPins` reaches `pinOp` while
 * `isPinState` bounds a snapshot by `MAX_PINS`, so a limit that could only produce a snapshot the
 * guard rejects is answered with the config's own numbers rather than a state no rebuild reads
 * back, and `newUid` is called only when it is a function — one string is a refusal-free TypeError
 * that leaves the tool with no result at all.
 *
 * `DEFAULT_CONFIG.maxPins` and `MAX_PINS` are quoted, never spelled out, so a bump on either side
 * moves these tables with it. The action-field refusals are in state-action-input.test.ts.
 */
import { describe, expect, test } from "bun:test";

import type { ActionInput } from "../src/action.ts";
import { MAX_PINS } from "../src/bounds.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { type ApplyLimits, applyAction } from "../src/reducer.ts";
import { isPinState } from "../src/state-guards.ts";
import { EMPTY_STATE } from "../src/state.ts";
import type { PinState } from "../src/types.ts";
import { NOW, pin, state, uidSource } from "./fixtures.ts";

const PIN: ActionInput = { op: "pin", text: "t", level: "info", source: "agent", now: NOW };

/**
 * Limits built from values the type forbids, presented as an `ApplyLimits`: the interface is the
 * caller's promise, and the reducer must not throw when the promise is broken — a session-entry
 * replay, a fixture or a JSON round trip can hand it anything. One cast, at the one place the
 * promise is deliberately broken.
 */
function badLimits(maxPins: unknown, newUid?: unknown): ApplyLimits {
  return { maxPins, newUid } as ApplyLimits;
}

/** How many pins a `pin` gets through from `start` under limits the caller does not vouch for. */
function pinsAccepted(limits: ApplyLimits, start: PinState = EMPTY_STATE): number | undefined {
  const result = applyAction(start, PIN, limits);
  expect(result.ok).toBe(true);
  if (!result.ok) return undefined;
  // The invariant, for every clamp below: the limits were unusable, so the state that answers is
  // one the module's own guard accepts — not the snapshot the broken limits would have allowed.
  expect(isPinState(result.state)).toBe(true);
  return result.state.pins.length;
}

/** `count` pins with distinct texts, numbered from 1, so neither the duplicate nor the uid guard answers. */
function filled(count: number, prefix = "p"): PinState {
  return state(
    Array.from({ length: count }, (_unused, i) => pin(i + 1, `${prefix}${i + 1}`)),
    count + 1,
  );
}

describe("applyAction clamps a maxPins that is not a limit", () => {
  // `[]` is left out of the table on purpose: bun's `test.each` reads a one-element array of cases
  // as a single case, so the row reports this file's name and times out instead of running. It has
  // its own test below.
  test.each([Number.POSITIVE_INFINITY, Number.NaN, 0, "5", -3, 1.5, null, {}])(
    "a maxPins of %p falls back to the config default rather than publishing an unbounded state",
    (maxPins) => {
      // The fill-up is the assertion: at `DEFAULT_CONFIG.maxPins` the next pin is refused, so the
      // limit that answered was the default and not the unusable value that was sent. `25` is not in
      // this table because it is a usable number above the bound and clamps to `MAX_PINS`, not the
      // default — it has its own case below.
      expect(pinsAccepted(badLimits(maxPins, uidSource()))).toBe(1);
      expect(
        applyAction(filled(DEFAULT_CONFIG.maxPins), PIN, badLimits(maxPins, uidSource())).ok,
      ).toBe(false);
      // Every value here had to become the default: were a `NaN` or an `Infinity` kept, the snapshot
      // above would carry more pins than the guard reads and all of them would vanish on reload.
      expect(DEFAULT_CONFIG.maxPins).toBeLessThan(MAX_PINS);
    },
  );

  test("a maxPins of an empty array falls back to the config default too", () => {
    expect(applyAction(EMPTY_STATE, PIN, badLimits([])).ok).toBe(true);
    expect(applyAction(filled(DEFAULT_CONFIG.maxPins), PIN, badLimits([])).ok).toBe(false);
  });

  test("a maxPins of 25 is cut to the snapshot bound, not replaced by the default", () => {
    // The two halves of the clamp differ, and the table above cannot show it: every value there
    // lands on the same `DEFAULT_CONFIG.maxPins`, so a `25` that clamped to `MAX_PINS` and one that
    // clamped to the default would look identical. 25 pins is more than a snapshot may hold, so the
    // limit that answered is `MAX_PINS`: 20 are accepted, the 21st is refused, and the refusal names
    // 20 and not 5.
    const mint = (n: number) => () => `minted-${n}`;
    const room = applyAction(filled(MAX_PINS - 1), PIN, { maxPins: 25, newUid: mint(1) });
    expect(room.ok).toBe(true);
    if (!room.ok) return;
    expect(room.state.pins).toHaveLength(MAX_PINS);
    expect(isPinState(room.state)).toBe(true);

    const full = applyAction(filled(MAX_PINS), PIN, { maxPins: 25, newUid: mint(2) });
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.error).toContain(`${MAX_PINS} pins are already shown`);
  });

  test.each([1, 5, MAX_PINS])("a maxPins of %p is a limit and is kept as sent", (maxPins) => {
    // Kept as sent is visible at the limit and nowhere else: the second call is refused naming the
    // number that was sent. A fresh uid source per call because the reducer refuses a uid the state
    // already holds, and a source that restarted would hand the second pin an address in use.
    let minted = 0;
    const fresh = (): string => {
      minted += 1;
      return `minted-${minted}`;
    };

    const room = applyAction(filled(maxPins - 1, "f"), PIN, { maxPins, newUid: fresh });
    expect(room.ok).toBe(true);
    if (!room.ok) return;
    expect(room.state.pins).toHaveLength(maxPins);
    expect(isPinState(room.state)).toBe(true);

    const full = applyAction(
      room.state,
      { op: "pin", text: "another", level: "info", source: "agent", now: NOW },
      { maxPins, newUid: fresh },
    );
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.error).toContain(`${maxPins} pins are already shown`);
  });
});

describe("applyAction refuses to call a newUid that is not a function", () => {
  test("a newUid that is not a function mints from crypto rather than throwing", () => {
    // `limits.newUid` is typed `() => string`, but the tool passes no source at all and any caller
    // can hand it a string: calling one is a TypeError that leaves the tool with no result at all.
    for (const newUid of ["x", 42, {}, [], null, true]) {
      const result = applyAction(EMPTY_STATE, PIN, badLimits(5, newUid));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.pins[0]?.uid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(isPinState(result.state)).toBe(true);
    }
  });

  test("a newUid of undefined still takes the crypto fallback", () => {
    // The optional field spelled out rather than omitted: `{ maxPins: 5, newUid: undefined }` is
    // what a JSON round trip of a source-less limits object looks like, and it must not be read as
    // "the caller gave me a source".
    const result = applyAction(EMPTY_STATE, PIN, { maxPins: 5, newUid: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pins[0]?.uid).not.toBe("");
    expect(isPinState(result.state)).toBe(true);
  });
});
