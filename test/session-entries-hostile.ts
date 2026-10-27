/**
 * The hostile-entry vocabulary shared by the two files that read src/session-entries.ts directly:
 * `session-entries.test.ts` (the snapshot readers) and `session-entries-actions.test.ts` (the user
 * action and panel-visibility readers). Everything here is a *payload shaped to be refused or copied*,
 * not a fixture of a healthy session — those live in fixtures.ts.
 */
import { pin, removal, state } from "./fixtures.ts";

/** Build a string from code points, so no control character appears literally in these sources. */
export const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
export const ESC = cp(0x1b);
export const BEL = cp(0x07);

/** A valid snapshot spelled out for poisoning or inheriting: nextId clears both ids in use. */
export function snapshotShape(): Record<string, unknown> {
  return { v: 1, pins: [pin(1, "inherited")], removed: [removal(3, "user")], nextId: 4 };
}

/** A valid snapshot with two pins and one removal, for the copy and clean-read tests. */
export function validSnapshot(): ReturnType<typeof state> {
  return state([pin(1, "a"), pin(2, "b")], 4, [removal(3, "user")]);
}

/** A `pi-sticky.user` entry holding anything at all — a malformed action reads as no action. */
export function rawUserEntry(data: unknown): unknown {
  return { type: "custom", customType: "pi-sticky.user", data };
}

/** A `pi-sticky.ui` entry as the extension appends one. */
export function uiEntry(data: unknown): unknown {
  return { type: "custom", customType: "pi-sticky.ui", data };
}

/**
 * A payload whose only own key is the literal string `__proto__`, the shape a session file carries
 * after `JSON.parse('{"__proto__":…}')`. Built from a serialised source rather than an object
 * literal: a literal `{ __proto__: x }` *sets* the prototype and leaves no own key, and bun's
 * `JSON.stringify` of such a literal drops the key entirely, so the literal form tests nothing.
 */
export function protoPoisoned(prototype: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(`{"__proto__":${JSON.stringify(prototype)}}`);
}

/**
 * Things that are not entries at all: each must read as "nothing here" rather than throw, since a
 * session file holds whatever an earlier run — or a hand edit — left in it.
 */
export const NON_ENTRIES: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["undefined", undefined],
  ["a number", 42],
  ["a string", "pi-sticky.state"],
  ["a boolean", true],
  ["an empty array", []],
  ["an array of snapshots", [state([pin(1, "a")], 2)]],
  ["a null-prototype object", Object.create(null)],
  [
    "a null-prototype custom entry",
    Object.assign(Object.create(null), {
      type: "custom",
      customType: "pi-sticky.state",
      data: state(),
    }),
  ],
  [
    "a null-prototype tool result",
    Object.assign(Object.create(null), {
      type: "message",
      message: Object.assign(Object.create(null), {
        role: "toolResult",
        toolName: "pin_for_user",
        details: state(),
      }),
    }),
  ],
  [
    "an entry whose fields live only on the prototype",
    Object.create({ type: "custom", customType: "pi-sticky.state", data: state() }),
  ],
];
