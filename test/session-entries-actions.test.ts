/**
 * The two readers of src/session-entries.ts that serve the user rather than the pins:
 * `userActionFrom` (a `pi-sticky.user` custom entry) and `latestUIShown` (the last well-formed
 * `pi-sticky.ui` entry of the session). Both are read through `reconstruct` / `initialShown`
 * elsewhere, which hides the two properties that matter here: that the action handed back is a fresh
 * object with only `at` sanitized, and that a visibility entry the guard does not recognise is
 * *skipped* rather than honoured — so a malformed entry can neither hide a panel the user never
 * turned off nor pin one shut. The shapes themselves are covered in state-guards.test.ts.
 */
import { describe, expect, test } from "bun:test";

import { cleanPinText } from "../src/sanitize.ts";
import { latestUIShown, userActionFrom } from "../src/session-entries.ts";
import { NOW_DIGIT } from "./digit-fixtures.ts";
import { NOW, customEntry, state, toolResultEntry, userAction, userEntry } from "./fixtures.ts";
import {
  ESC,
  NON_ENTRIES,
  protoPoisoned,
  rawUserEntry,
  uiEntry,
} from "./session-entries-hostile.ts";

describe("userActionFrom", () => {
  test("returns the action with a copy of at, and keeps uid as stored", () => {
    const action = userAction("uid-7", "dismiss", `${ESC}[2J${NOW}`);
    const read = userActionFrom(userEntry(action));
    expect(read).toEqual({ v: 1, uid: "uid-7", action: "dismiss", at: cleanPinText(action.at) });
    expect(read).not.toBe(action);
    expect(read?.at).not.toContain(ESC);
  });

  test("a stamp ending in a digit is copied verbatim, not trimmed", () => {
    // Every timestamp the readers clean ends in a digit rather than the `Z` the fixtures use, and `at`
    // is what the user-removal refusal prints: an edge class carrying the characters "1" and "3" shaved
    // one digit off it per rebuild. `NOW_DIGIT` is that shape.
    for (const kind of ["dismiss", "reply"] as const) {
      const action = userAction("uid-7", kind, `${ESC}[2J${NOW_DIGIT}`);
      expect(userActionFrom(userEntry(action))?.at).toBe(NOW_DIGIT);
    }
  });

  test("refuses the wrong entry or custom type", () => {
    const action = userAction("uid-7", "reply");
    expect(userActionFrom(customEntry(action, "pi-sticky.state"))).toBeUndefined();
    expect(userActionFrom(customEntry(action, "pi-sticky.ui"))).toBeUndefined();
    expect(userActionFrom(toolResultEntry(action))).toBeUndefined();
    expect(userActionFrom({ type: "custom", data: action })).toBeUndefined();
  });

  test("refuses malformed actions, nulls, primitives and arrays", () => {
    const malformed: readonly unknown[] = [
      null,
      undefined,
      "dismiss",
      7,
      [],
      [userAction("uid-1", "dismiss")],
      { v: 2, uid: "uid-1", action: "dismiss", at: NOW },
      { v: 1, action: "dismiss", at: NOW },
      { v: 1, uid: "", action: "dismiss", at: NOW },
      { v: 1, uid: "uid with spaces", action: "dismiss", at: NOW },
      { v: 1, uid: "uid-1", action: "delete", at: NOW },
      { v: 1, uid: "uid-1", action: "dismiss", at: 123 },
      { v: 1, uid: "uid-1", action: "dismiss" },
    ];
    for (const data of malformed) {
      expect(userActionFrom(rawUserEntry(data)), JSON.stringify(data)).toBeUndefined();
    }
    for (const [name, value] of NON_ENTRIES) {
      expect(userActionFrom(value), name).toBeUndefined();
    }
  });

  test("a __proto__ payload carries no own fields, so it is refused", () => {
    const poisoned = protoPoisoned({ v: 1, uid: "uid-1", action: "dismiss", at: NOW });
    expect(Object.getOwnPropertyNames(poisoned)).toEqual(["__proto__"]);
    expect(userActionFrom(rawUserEntry(poisoned))).toBeUndefined();
    expect(userActionFrom(poisoned)).toBeUndefined();
  });

  test("a user action whose fields are inherited is refused", () => {
    const inherited = Object.create({ v: 1, uid: "uid-1", action: "dismiss", at: NOW });
    expect(userActionFrom(rawUserEntry(inherited))).toBeUndefined();
    expect(
      userActionFrom(Object.create({ type: "custom", customType: "pi-sticky.user" })),
    ).toBeUndefined();
  });
});

describe("latestUIShown", () => {
  test("reports the choice of the last well-formed entry", () => {
    expect(latestUIShown([uiEntry({ v: 1, shown: true })])).toBe(true);
    expect(latestUIShown([uiEntry({ v: 1, shown: false })])).toBe(false);
    expect(latestUIShown([uiEntry({ v: 1, shown: true }), uiEntry({ v: 1, shown: false })])).toBe(
      false,
    );
    expect(latestUIShown([uiEntry({ v: 1, shown: false }), uiEntry({ v: 1, shown: true })])).toBe(
      true,
    );
  });

  test("an opinion-less list is no opinion", () => {
    expect(latestUIShown([])).toBeUndefined();
    expect(latestUIShown(NON_ENTRIES.map(([, value]) => value))).toBeUndefined();
    expect(latestUIShown([uiEntry({ v: 1, shown: "yes" }), uiEntry(null)])).toBeUndefined();
  });

  test("a malformed entry is skipped, so the last good one still wins", () => {
    const good = uiEntry({ v: 1, shown: true });
    for (const bad of [uiEntry(null), uiEntry({ v: 1 }), uiEntry({ v: 1, shown: 1 })]) {
      expect(latestUIShown([good, bad])).toBe(true);
    }
  });

  test("only pi-sticky.ui entries are read", () => {
    expect(latestUIShown([customEntry(state(), "pi-sticky.state")])).toBeUndefined();
    expect(latestUIShown([userEntry(userAction("uid-1", "dismiss"))])).toBeUndefined();
    expect(latestUIShown([uiEntry({ v: 1, shown: true }), { type: "message" }])).toBe(true);
  });

  test("a __proto__ or inherited ui payload is skipped, not honoured", () => {
    // The direction the reader exists for: an entry that looks as if it says `shown: false` only by
    // inheritance must not be able to put a panel the user never turned off out of sight.
    expect(latestUIShown([uiEntry(protoPoisoned({ shown: false, v: 1 }))])).toBeUndefined();
    expect(latestUIShown([uiEntry(Object.create({ v: 1, shown: false }))])).toBeUndefined();
    const poisoned = uiEntry(protoPoisoned({ shown: false }));
    expect(latestUIShown([uiEntry({ v: 1, shown: true }), poisoned])).toBe(true);
    expect(
      latestUIShown([protoPoisoned({ type: "custom", customType: "pi-sticky.ui" })]),
    ).toBeUndefined();
  });
});
