/**
 * The guards an action that arrived as model-authored JSON has to trip. `applyAction` is the last
 * pure gate before the state, the tool-result `details` snapshot every renderer draws from, and
 * the snapshot a later `reconstruct` reads back — so a value the reducer copies into state without
 * checking it is a value `isPinState` may then reject, and pins that vanish on reload instead of
 * a refusal the model can read.
 *
 * The happy paths and the state arithmetic (duplicates, the limit, the removal window) are in
 * state-reducer.test.ts, the `ids` of an `unpin` in state-action-ids.test.ts, and the *limits* the
 * caller hands the reducer in state-action-limits.test.ts; this file is only about the `op`, `text`,
 * `level`, `source` and `id` a hostile JSON body may claim.
 */
import { describe, expect, test } from "bun:test";

import { type ApplyLimits, EMPTY_STATE, applyAction, isPinState } from "../src/state.ts";
import { LATER, NOW, pin, removal, state, uidSource } from "./fixtures.ts";

const limits = (maxPins = 5): ApplyLimits => ({ maxPins, newUid: uidSource() });

const two = state([pin(1, "a"), pin(2, "b")], 3);
const one = state([pin(1, "original", "info")], 2);

describe("applyAction refuses a pin with nothing to pin", () => {
  const pinWith = (text: unknown) =>
    applyAction(
      EMPTY_STATE,
      { op: "pin", text, level: "info", source: "agent", now: NOW },
      limits(),
    );

  test("a missing, non-string or empty text is refused with the 6.2 message", () => {
    // The regression: `textOrUndefined(action.text) ?? ""` turned all of these into a real pin
    // whose text was "". D5: a silent clamp teaches the model nothing — refuse it.
    for (const text of [undefined, 42, null, {}, [], ""]) {
      const result = pinWith(text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('text is required for action "pin"');
    }
  });

  test("a textless pin is refused before the duplicate lookup, so it cannot absorb later pins", () => {
    // With the coercion in place, the first textless pin had text "" and every later textless call
    // came back `duplicateOf: 1` for a pin the model never sent, with nextId never advancing.
    const first = pinWith(42);
    expect(first.ok).toBe(false);
    const start = state([pin(1, "")], 2);
    const result = applyAction(
      start,
      { op: "pin", text: 99, level: "info", source: "agent", now: NOW },
      limits(3),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('text is required for action "pin"');
    // The duplicate branch used to hand back the very state it was given as an ok result; a refusal
    // has no state field at all, so there is nothing for the tool to commit.
    expect("state" in result).toBe(false);
  });

  test("a textless pin never bypasses the limit through the duplicate branch", () => {
    // `findDuplicate` ran ahead of the limit check, so at maxPins a textless call was waved through
    // as a duplicate of the `""` pin. Refusing the text first closes both paths.
    const atLimit = state([pin(1, "a"), pin(2, "b"), pin(3, "")], 4);
    const result = applyAction(
      atLimit,
      { op: "pin", text: 7, level: "info", source: "agent", now: NOW },
      limits(3),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('text is required for action "pin"');
  });

  test("a refused action leaves the state alone and never advances nextId", () => {
    const full = state([pin(1, "a"), pin(2, "b")], 3);
    for (const text of [42, "", null]) {
      const result = applyAction(
        full,
        { op: "pin", text, level: "info", source: "agent", now: NOW },
        limits(2),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // An error result carries no state at all: nothing for a caller to commit, and the state it
      // was given is not grown, copied or renumbered on the way to saying no.
      expect("state" in result).toBe(false);
      expect(full.nextId).toBe(3);
      expect(full.pins.map((p) => p.id)).toEqual([1, 2]);
    }
  });

  test("a level or source outside its union is refused, not written into state", () => {
    for (const level of ["", "urgent", 5, {}, [], null, undefined]) {
      const result = applyAction(
        EMPTY_STATE,
        { op: "pin", text: "hello", level, source: "agent", now: NOW },
        limits(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('level must be "info", "action" or "warning"');
    }
    for (const source of ["", "evil", 5, null]) {
      const result = applyAction(
        EMPTY_STATE,
        { op: "pin", text: "hello", level: "info", source, now: NOW },
        limits(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('source must be "agent" or "user"');
    }
  });
});

describe("applyAction refuses an update whose fields are not what they claim", () => {
  test("an id that is not a pin number is refused as a missing id", () => {
    // `No pin #1.5.` would state a fact about pins that is really a fact about the model's call, so
    // the id is checked before the lookup — the same rule `unpin`'s normaliseIds applies to a batch.
    for (const id of [1.5, 0, -3, null, "1", {}, undefined, Number.NaN]) {
      const result = applyAction(
        one,
        { op: "update", id, text: "x", source: "agent", now: LATER },
        limits(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id is required for action "update"');
    }
  });

  test("a level or source outside its union is refused, not written into state", () => {
    // Both are copied into state and then drawn (`MARKER[pin.level]`) or named in an error, and
    // `isPinState` refuses a state carrying them — so without this check the pins would silently
    // vanish on the next rebuild.
    for (const level of ["", "urgent", 5, {}, [], null]) {
      const result = applyAction(
        one,
        { op: "update", id: 1, text: "x", level, source: "agent", now: LATER },
        limits(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('level must be "info", "action" or "warning"');
    }
    for (const source of ["", "evil", 5, null]) {
      const result = applyAction(
        one,
        { op: "update", id: 1, text: "x", source, now: LATER },
        limits(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('source must be "agent" or "user"');
    }
  });

  test("a non-string text is treated as absent, which an update may survive", () => {
    // The other half of the pin rule: a pin without text is nothing to pin, but an update that
    // carries no text is still an update as long as it changes the level.
    const textless = applyAction(
      one,
      { op: "update", id: 1, text: {}, source: "agent", now: LATER },
      limits(),
    );
    expect(textless.ok).toBe(false);
    if (textless.ok) return;
    expect(textless.error).toBe("update needs text or level");

    const levelled = applyAction(
      one,
      { op: "update", id: 1, text: [], level: "warning", source: "agent", now: LATER },
      limits(),
    );
    expect(levelled.ok).toBe(true);
    if (!levelled.ok) return;
    expect(levelled.state.pins[0]?.text).toBe("original");
    expect(levelled.state.pins[0]?.level).toBe("warning");
  });

  test("every action the reducer accepts yields a state its own guard accepts", () => {
    // The invariant the unvalidated `level`/`source` broke: `applyAction` is the last pure gate
    // before the snapshot the tool publishes as `details`, and `reconstruct` skips a snapshot
    // `isPinState` rejects. So an ok result whose state fails the guard is not a cosmetic problem —
    // it is a set of pins that silently vanishes on the next reload.
    //
    // One uid counter shared by the whole loop: `crypto.randomUUID()` — the real source — gives every
    // pin a fresh address, and a counter restarted per action would mint a pin whose uid a pin in the
    // previous result already holds, which the guard is right to reject.
    let minted = 0;
    const newUid = (): string => {
      minted += 1;
      return `fresh-${minted}`;
    };
    const accepted: Record<string, unknown>[] = [
      { op: "pin", text: "t", level: "warning", source: "agent", now: NOW },
      { op: "pin", text: "t", level: "action", source: "user", now: NOW },
      { op: "update", id: 1, level: "warning", source: "user", now: LATER },
      { op: "update", id: 1, text: "new", source: "agent", now: LATER },
      { op: "unpin", ids: [1], source: "user", now: LATER },
      { op: "unpin", ids: "all", source: "agent", now: LATER },
      { op: "unpin", ids: [1, 9], source: "agent", now: LATER },
      // The shape of each op with a `now` the guard accepts but no other caller would send: the
      // round trip has to hold for the timestamp fields too, not only text, level and source.
      { op: "pin", text: "now-t", level: "info", source: "agent", now: "" },
      { op: "update", id: 2, now: "not a date at all", source: "agent", level: "warning" },
      { op: "unpin", ids: [2], source: "user", now: " " },
    ];
    for (const action of accepted) {
      // A state whose nextId does not outrank its removal ids is not a state a rebuild could have
      // produced (isPinState rejects it), so the reducer starts from one that is: nextId above the
      // pin ids AND above the removal ids, uids unique across both lists.
      const start = state([pin(1, "a"), pin(2, "b")], 11, [removal(10)]);
      const result = applyAction(start, action, { maxPins: 5, newUid });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isPinState(result.state)).toBe(true);
    }
  });
});
