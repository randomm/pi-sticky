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
import {
  NOW,
  customEntry,
  pin,
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
