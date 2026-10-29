/**
 * What the session file is allowed to say. A snapshot reaches `reconstruct` straight from a
 * session file written by an earlier run (or by another program), so its pin text is untrusted
 * and its numbers are self-reported: text goes through the sanitizer's passes and a snapshot that
 * does not add up is skipped in favour of the last valid one.
 *
 * The three optional fields pins v2-5 added are held to the same promise in
 * `state-untrusted-fields.test.ts`, and the helpers every case here shares — `drawn`, which rebuilds a
 * state and collects every string the surfaces draw for it, `offenders`, which names the code points
 * none of them may carry, and `drawnBreaks`, which names the break shapes — are in
 * `state-untrusted-drawn.ts`.
 */
import { describe, expect, test } from "bun:test";

import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { EMPTY_STATE, reconstruct } from "../src/state.ts";
import type { Pin, PinState, Removal } from "../src/types.ts";
import { LATER, NOW, customEntry, pin, removal, state, toolResultEntry } from "./fixtures.ts";
import { offenders } from "./panel-hostile.ts";
import { drawn, drawnBreaks } from "./state-untrusted-drawn.ts";
import { ESC, HOSTILE_PIN_TEXT, cp } from "./state-untrusted-hostile.ts";

/** A valid snapshot whose pin text is hostile; nextId clears both the pin id and the removal id. */
const hostile = state([pin(1, HOSTILE_PIN_TEXT, "warning")], 10, [removal(9, "agent", NOW)]);

describe("reconstruct sanitizes untrusted entry text", () => {
  test("a custom pi-sticky.state snapshot cannot carry escapes into state or the view", () => {
    const result = reconstruct([customEntry(hostile)], []);
    const clean = cleanPinText(HOSTILE_PIN_TEXT);
    expect(result.state.pins[0]?.text).toBe(clean);
    expect(result.view.pins[0]?.text).toBe(clean);
    expect(clean).toBe("deployABCDEFGHIfailed");
  });

  test("a pin_for_user tool-result snapshot cannot carry escapes into state or the view", () => {
    const result = reconstruct([toolResultEntry(hostile)], []);
    const clean = cleanPinText(HOSTILE_PIN_TEXT);
    expect(result.state.pins[0]?.text).toBe(clean);
    expect(result.view.pins[0]?.text).toBe(clean);
  });

  test("nothing drawn carries an escape, a C1 control, RLO, a lone surrogate or a break shape", () => {
    for (const text of drawn(hostile)) {
      expect(offenders(text)).toEqual([]);
      expect(drawnBreaks(text)).toEqual([]);
    }
  });

  test("a removal timestamp carrying escapes cannot reach the model either", () => {
    // The removal timestamp is drawn by the user-removal error, so it is cleaned as well.
    const polluted: PinState = {
      v: 1,
      pins: [],
      nextId: 10,
      removed: [{ id: 9, uid: "uid-9", by: "user", at: `${ESC}[2J${NOW}` }],
    };
    const result = reconstruct([customEntry(polluted)], []);
    expect(result.state.removed[0]?.at).toBe(NOW);
    expect(offenders(result.state.removed[0]?.at ?? "x")).toEqual([]);
  });

  test("a plain snapshot keeps its text, uid and timestamps untouched", () => {
    const result = reconstruct([customEntry(state([pin(1, "a → b")], 2))], []);
    expect(result.state.pins[0]?.text).toBe("a → b");
    expect(result.state.pins[0]?.uid).toBe("uid-1");
    expect(result.state.pins[0]?.createdAt).toBe(NOW);
  });

  test("the grapheme budget is not applied — reconstruct has no config", () => {
    const long = "x".repeat(500);
    const result = reconstruct([customEntry(state([pin(1, long)], 2))], []);
    expect(result.state.pins[0]?.text).toBe(long);
  });

  test("a reply marks the pin as replied with a cleaned timestamp", () => {
    // repliedAt is drawn by renderList and renderPinsText, so the entry's own string is not what
    // gets drawn: the escape a hostile user action carries is gone before a renderer sees it.
    const entry = customEntry(
      { v: 1, uid: "uid-1", action: "reply", at: `${ESC}[2J${LATER}` },
      "pi-sticky.user",
    );
    const result = reconstruct([toolResultEntry(state([pin(1, "a")], 2))], [entry]);
    expect(result.view.pins[0]?.repliedAt).toBe(LATER);
    // The replied marker is drawn by the listing and the model-facing text, so the cleaned stamp has to
    // survive into both — swept through the same helper rather than a one-off `renderList` call.
    for (const text of drawn(state([pin(1, "a")], 2))) {
      expect(offenders(text)).toEqual([]);
      expect(drawnBreaks(text)).toEqual([]);
    }
  });

  test("an empty uid in a user action matches no pin and is skipped", () => {
    // The guard refuses it, so a comparison against "" can never single out a pin that lost its uid.
    const entry = customEntry({ v: 1, uid: "", action: "dismiss", at: NOW }, "pi-sticky.user");
    const result = reconstruct([toolResultEntry(state([pin(1, "a")], 2))], [entry]);
    expect(result.state.pins.map((p) => p.id)).toEqual([1]);
  });
});

describe("isPinState rejects an inconsistent snapshot", () => {
  test("accepts a coherent state and one whose nextId merely exceeds every removal id", () => {
    expect(isPinState(state([pin(1, "a")], 2))).toBe(true);
    expect(isPinState(state([], 5, [removal(3), removal(1)]))).toBe(true);
  });

  test("rejects duplicate pin ids", () => {
    const dup: Pin = { ...pin(2, "b"), uid: "uid-2", id: 1 };
    expect(isPinState(state([pin(1, "a"), dup], 3))).toBe(false);
  });

  test("rejects duplicate pin uids", () => {
    const dup: Pin = { ...pin(2, "b"), uid: "uid-1" };
    expect(isPinState(state([pin(1, "a"), dup], 3))).toBe(false);
  });

  test("rejects an empty pin uid", () => {
    expect(isPinState(state([{ ...pin(1, "a"), uid: "" }], 2))).toBe(false);
  });

  test("rejects a pin id that is not a positive safe integer", () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPinState(state([{ ...pin(1, "a"), id }], 2))).toBe(false);
    }
  });

  test("rejects a nextId that is not a positive safe integer", () => {
    for (const nextId of [0, -2, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPinState({ v: 1, pins: [], nextId, removed: [] })).toBe(false);
    }
  });

  test("rejects a nextId that does not exceed the highest pin id", () => {
    expect(isPinState(state([pin(1, "a"), pin(3, "c")], 3))).toBe(false);
  });

  test("rejects a nextId that does not exceed a removal id", () => {
    expect(isPinState(state([pin(1, "a")], 2, [removal(4)]))).toBe(false);
  });

  test("rejects an empty removal uid", () => {
    expect(isPinState(state([pin(1, "a")], 2, [{ ...removal(1), uid: "" }]))).toBe(false);
  });

  test("a rejected snapshot is skipped and the previous valid one is used", () => {
    const good = state([pin(1, "good")], 2);
    const bad = state([pin(1, "bad"), { ...pin(1, "dupe") }], 3);
    const branch = [toolResultEntry(good), toolResultEntry(bad)];
    expect(reconstruct(branch, []).state).toEqual(good);
    expect(reconstruct([customEntry(bad), customEntry(good)], []).state).toEqual(good);
    expect(reconstruct([customEntry(bad)], []).state).toEqual(EMPTY_STATE);
  });
});

describe("reconstruct returns copies", () => {
  test("mutating the result changes neither the entry data nor EMPTY_STATE", () => {
    const snapshot = state([pin(1, "a"), pin(2, "b")], 3, [removal(1)]);
    const entryRemoval = (snapshot.removed[0] ?? {}) as Removal;
    const before = JSON.parse(JSON.stringify(snapshot)) as PinState;

    const result = reconstruct([customEntry(snapshot)], []);
    expect(result.state).not.toBe(snapshot);
    expect(result.state.pins).not.toBe(snapshot.pins);
    expect(result.state.removed).not.toBe(snapshot.removed);
    expect(result.view.pins).not.toBe(result.state.pins);

    // Deep mutation: the arrays and the objects inside them.
    result.state.pins.push(pin(9, "injected"));
    result.state.removed.push({ ...removal(9) });
    if (result.state.pins[0]) result.state.pins[0].text = "mutated";
    if (result.state.removed[0]) (result.state.removed[0] as { at: string }).at = "mutated";

    expect(snapshot).toEqual(before);
    expect(entryRemoval.at).not.toBe("mutated");
    expect(EMPTY_STATE.pins).toEqual([]);
    expect(EMPTY_STATE.removed).toEqual([]);
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.pins)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.removed)).toBe(true);
  });

  test("the result of an empty rebuild is a copy a caller may mutate", () => {
    const result = reconstruct([], []);
    expect(result.state).not.toBe(EMPTY_STATE);
    result.state.pins.push(pin(1, "injected"));
    expect(EMPTY_STATE.pins).toEqual([]);
  });
});
