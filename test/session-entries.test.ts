/**
 * The two snapshot readers of src/session-entries.ts read directly: `snapshotFromEntry` (a
 * `pin_for_user` tool result) and `snapshotFromCustom` (a `pi-sticky.state` custom entry). Every
 * other test reaches them through `reconstruct`, where a reader that handed back the *entry's own
 * object*, or read a field off a prototype, would be invisible — the copy and the own-property rules
 * are only visible at the reader itself. What a shape means is decided in state-guards.test.ts and
 * what cleaned text looks like in sanitize.test.ts; this file asks only: given an entry, does the
 * reader hand back a snapshot, and whose object is it?
 */
import { describe, expect, test } from "bun:test";

import { cleanPinText } from "../src/sanitize.ts";
import { snapshotFromCustom, snapshotFromEntry } from "../src/session-entries.ts";
import { isPinState } from "../src/state-guards.ts";
import { DIGIT_GROUP, DIGIT_OPTIONS, NOW_DIGIT, digitPin } from "./digit-fixtures.ts";
import {
  NOW,
  customEntry,
  pin,
  removal,
  state,
  toolResultEntry,
  userAction,
  userEntry,
} from "./fixtures.ts";
import {
  BEL,
  ESC,
  NON_ENTRIES,
  cp,
  protoPoisoned,
  snapshotShape,
  validSnapshot,
} from "./session-entries-hostile.ts";

describe("snapshotFromEntry", () => {
  test("returns a copy of the details of a pin_for_user tool result", () => {
    const details = validSnapshot();
    expect(snapshotFromEntry(toolResultEntry(details))).toEqual(details);
  });

  test("hands back a private copy, never the object inside the entry", () => {
    const details = validSnapshot();
    const snapshot = snapshotFromEntry(toolResultEntry(details));
    if (!snapshot || !snapshot.pins[0]) throw new Error("a valid snapshot must read back");
    expect(snapshot).not.toBe(details);
    expect(snapshot.pins).not.toBe(details.pins);
    expect(snapshot.pins[0]).not.toBe(details.pins[0]);
    expect(snapshot.removed).not.toBe(details.removed);
    expect(snapshot.removed[0]).not.toBe(details.removed[0]);
    if (!details.pins[0]) throw new Error("the fixture pin is missing");
    snapshot.pins.push(pin(4, "later"));
    snapshot.pins[0].text = "mutated";
    expect(details.pins.length).toBe(2);
    expect(details.pins[0].text).toBe("a");
  });

  test("cleans the drawn strings and keeps uid verbatim", () => {
    const hostile = `${ESC}]8;;https://evil${ESC}${cp(0x5c)}${BEL}evil`;
    const hostileTime = `${ESC}[2J${NOW}`;
    // A uid made of markup is not an address at all — isUid admits only [A-Za-z0-9_-] — so a snapshot
    // carrying one is refused outright rather than rebuilt with a pin nothing can address again.
    expect(
      snapshotFromEntry(toolResultEntry(state([pin(1, "a", "info", { uid: "uid-<raw>" })], 2))),
    ).toBeUndefined();
    // A legal uid that looks nothing like a uuid is still copied *as stored*: it is an address compared
    // with ===, never drawn, so the reader runs the text and the two timestamps through the sanitizer
    // and leaves this one alone.
    const uglyUid = "uid-_a-Z_9";
    const details = state([pin(1, hostile, "info", { uid: uglyUid, createdAt: hostileTime })], 2);
    const snapshot = snapshotFromEntry(toolResultEntry(details));
    if (!snapshot || !snapshot.pins[0]) throw new Error("a valid snapshot must read back");
    expect(snapshot.pins[0].text).toBe(cleanPinText(hostile));
    expect(snapshot.pins[0].text).not.toContain(ESC);
    expect(snapshot.pins[0].createdAt).toBe(cleanPinText(hostileTime));
    expect(snapshot.pins[0].uid).toBe(uglyUid);
  });

  test("re-cleans group and every option, and keeps compact as stored", () => {
    // The three fields pins v2-5 added are drawn by a later surface, so they owe the reader the same
    // re-clean pin text does. `uid` stays verbatim (see the module header); `compact` is a boolean and
    // has nothing to sanitize, so it is copied as it was written.
    const hostile = `${ESC}[2JA${ESC}]8;;https://evil${ESC}${cp(0x5c)}${BEL}B${cp(0x202e)}C`;
    const details = state(
      [
        pin(1, "a", "info", {
          group: hostile,
          options: [hostile, `x${cp(0xdc00)}y`],
          compact: true,
        }),
      ],
      2,
    );
    const snapshot = snapshotFromEntry(toolResultEntry(details));
    const stored = snapshot?.pins[0];
    expect(stored?.group).toBe("ABC");
    expect(stored?.options).toEqual(["ABC", "xy"]);
    expect(stored?.compact).toBe(true);
    expect(stored?.group).not.toContain(ESC);
    expect(stored?.options?.[1]).not.toContain(cp(0xdc00));
  });

  test("a digit at the edge of a group or an option survives every re-clean", () => {
    // The reader runs cleanPinText again over what the session file already holds, and the reducer
    // cleaned it on the way in: an edge class carrying the characters "1" and "3" would shave one digit
    // off per pass until a name came back truncated, an all-digit option fell under MIN_OPTIONS and the
    // whole `options` key disappeared. The shared digit fixture carries the hostile stamp too, so the
    // escape in front of it proves the fold and the trim both ran.
    const hostileStamp = `${ESC}[2J${NOW_DIGIT}`;
    for (const [read, entryFor] of [
      [snapshotFromEntry, toolResultEntry],
      [snapshotFromCustom, customEntry],
    ] as const) {
      const stored = read(entryFor(state([digitPin(1)], 3, [removal(2, "user", hostileStamp)])))
        ?.pins[0];
      if (!stored) throw new Error("a valid snapshot must read back");
      expect(stored.text).toBe("Ship 1");
      expect(stored.group).toBe(DIGIT_GROUP);
      expect(stored.options).toEqual(DIGIT_OPTIONS);
      // An ISO stamp ending in a digit is the shape no fixture had: the one the suite uses ends in Z.
      expect(stored.createdAt).toBe(NOW_DIGIT);
      expect(stored.updatedAt).toBe(NOW_DIGIT);
    }
  });

  test("a group or an option that cleans to nothing leaves no key the guard would refuse", () => {
    // The reader vouches for what it returns, so a value the sanitizer empties must not come back as
    // `group: ""` or as a `""` among the options — both are shapes `isPinState` rejects, and a snapshot
    // it rejects is skipped by the next rebuild, which loses every pin on the branch rather than one.
    const escapeOnly = `${ESC}[2J`;
    expect(cleanPinText(escapeOnly)).toBe("");
    const snapshot = snapshotFromCustom(
      customEntry(
        state([pin(1, "a", "info", { group: escapeOnly, options: [escapeOnly, "yes", "no"] })], 2),
      ),
    );
    const stored = snapshot?.pins[0];
    if (!stored) throw new Error("a valid snapshot must read back");
    expect(Object.keys(stored)).not.toInclude("group");
    expect(stored.options).toEqual(["yes", "no"]);
    expect(isPinState(snapshot)).toBe(true);
  });

  test("an option list whose real choices fall under two leaves no list at all", () => {
    // One entry left standing is a choice of nothing — the count rule refusing — so the reader drops the
    // whole key instead of storing a 1-entry list the guard rejects.
    const snapshot = snapshotFromCustom(
      customEntry(
        state([pin(1, "a", "info", { options: [`${ESC}[2J`, `${BEL}${cp(0x200b)}`, "yes"] })], 2),
      ),
    );
    const stored = snapshot?.pins[0];
    if (!stored) throw new Error("a valid snapshot must read back");
    expect(Object.keys(stored)).not.toInclude("options");
    expect(isPinState(snapshot)).toBe(true);
  });

  test("a pin with none of the three fields gains none on the way back", () => {
    // Byte-identity for the snapshots an earlier run wrote: the reader copies the fields by name, so a
    // pin that has none comes back with the seven keys it went in with and no new ones.
    const details = state([pin(1, "a")], 2);
    const snapshot = snapshotFromCustom(customEntry(details));
    expect(Object.keys(snapshot?.pins[0] ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "level",
      "source",
      "text",
      "uid",
      "updatedAt",
    ]);
  });

  test("a combining-mark flood and a two-column grapheme survive read-back as the sanitizer leaves them", () => {
    const flood = `e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}`;
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const snapshot = snapshotFromCustom(
      customEntry(state([pin(1, "a", "info", { group: family, options: [flood, "no"] })], 2)),
    );
    expect(snapshot?.pins[0]?.group).toBe(family);
    expect(snapshot?.pins[0]?.options).toEqual([cleanPinText(flood), "no"]);
  });

  test("refuses entries that are not tool results, nulls, primitives and arrays", () => {
    const snapshot = state([pin(1, "a")], 2);
    expect(snapshotFromEntry(customEntry(snapshot))).toBeUndefined();
    expect(snapshotFromEntry(userEntry(userAction("uid-1", "dismiss")))).toBeUndefined();
    expect(snapshotFromEntry({ type: "message", message: { role: "assistant" } })).toBeUndefined();
    expect(snapshotFromEntry({ type: "message" })).toBeUndefined();
    expect(snapshotFromEntry({ type: "message", message: null })).toBeUndefined();
    expect(snapshotFromEntry({ type: "message", message: "toolResult" })).toBeUndefined();
    for (const [name, value] of NON_ENTRIES) {
      expect(snapshotFromEntry(value), name).toBeUndefined();
    }
  });

  test("refuses the wrong tool, the wrong role and malformed details", () => {
    const snapshot = state([pin(1, "a")], 2);
    expect(snapshotFromEntry(toolResultEntry(snapshot, "read"))).toBeUndefined();
    expect(snapshotFromEntry(toolResultEntry(snapshot, ""))).toBeUndefined();
    const wrongRole = toolResultEntry(snapshot) as { message: Record<string, unknown> };
    wrongRole.message.role = "user";
    expect(snapshotFromEntry(wrongRole)).toBeUndefined();
    for (const details of [null, undefined, 1, "state", [], { ...snapshot, v: 2 }]) {
      expect(snapshotFromEntry(toolResultEntry(details)), JSON.stringify(details)).toBeUndefined();
    }
  });

  test("a __proto__ payload reads as nothing: the poisoned keys are not own properties", () => {
    const poisoned = protoPoisoned(snapshotShape());
    // The own key survives `JSON.parse` verbatim, and reading through it yields nothing: `__proto__`
    // is not a data property here, so the payload has none of the fields a snapshot is made of.
    expect(Object.getOwnPropertyNames(poisoned)).toEqual(["__proto__"]);
    expect(poisoned.v).toBeUndefined();
    expect(poisoned.pins).toBeUndefined();
    expect(snapshotFromEntry(poisoned)).toBeUndefined();
    expect(snapshotFromEntry(toolResultEntry(poisoned))).toBeUndefined();
    expect(
      snapshotFromEntry(
        toolResultEntry(Object.assign(poisoned, { role: "toolResult", toolName: "pin_for_user" })),
      ),
    ).toBeUndefined();
  });

  test("a payload whose valid-looking fields are inherited is refused", () => {
    // isPlainObject demands Object.prototype as the prototype, so an object carrying every valid field
    // — and nothing of its own — never reaches the field checks at all. The fields being valid is
    // beside the point: nothing is read off a prototype, which is what an `Object.create` payload with
    // a hostile prototype and getters could otherwise use to hand the reader values it never wrote.
    expect(snapshotFromEntry(Object.create(snapshotShape()))).toBeUndefined();
    const inherited = Object.create(snapshotShape());
    inherited.v = 1;
    expect(snapshotFromEntry(toolResultEntry(inherited))).toBeUndefined();
    const withGetter = Object.create({
      get pins(): unknown[] {
        throw new Error("reader walked the prototype");
      },
    });
    expect(snapshotFromEntry(toolResultEntry(withGetter))).toBeUndefined();
  });
});

describe("snapshotFromCustom", () => {
  test("returns a copy of the data of a pi-sticky.state entry", () => {
    const data = validSnapshot();
    const snapshot = snapshotFromCustom(customEntry(data));
    expect(snapshot).toEqual(data);
    expect(snapshot).not.toBe(data);
    expect(snapshot?.pins[0]).not.toBe(data.pins[0]);
    expect(snapshot?.removed[0]).not.toBe(data.removed[0]);
  });

  test("refuses the wrong entry or custom type, and malformed data", () => {
    const snapshot = state([pin(1, "a")], 2);
    expect(snapshotFromCustom(toolResultEntry(snapshot))).toBeUndefined();
    expect(snapshotFromCustom(customEntry(snapshot, "pi-sticky.reminder"))).toBeUndefined();
    expect(snapshotFromCustom(customEntry(snapshot, "pi-sticky.ui"))).toBeUndefined();
    expect(snapshotFromCustom({ type: "custom", data: snapshot })).toBeUndefined();
    for (const data of [null, "v", {}, { ...snapshot, pins: "[]" }, { ...snapshot, nextId: 0 }]) {
      expect(snapshotFromCustom(customEntry(data)), JSON.stringify(data)).toBeUndefined();
    }
    for (const [name, value] of NON_ENTRIES) {
      expect(snapshotFromCustom(value), name).toBeUndefined();
    }
  });

  test("a __proto__ payload and an inherited payload both read as nothing", () => {
    expect(snapshotFromCustom(customEntry(protoPoisoned(snapshotShape())))).toBeUndefined();
    expect(snapshotFromCustom(customEntry(Object.create(snapshotShape())))).toBeUndefined();
    const entryPoisoned = protoPoisoned({ type: "custom", customType: "pi-sticky.state" });
    expect(snapshotFromCustom(entryPoisoned)).toBeUndefined();
  });
});
