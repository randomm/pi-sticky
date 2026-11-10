import { expect, test } from "bun:test";

import { MAX_REPLY_UNITS, MAX_TEXT_UNITS } from "../src/bounds.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { userActionFrom } from "../src/session-entries.ts";
import { reconstruct } from "../src/state.ts";
import { LATER, customEntry, pin, state, toolResultEntry } from "./fixtures.ts";
import { replyEntry, userActionWithText } from "./reply-entry-fixture.ts";

// `test/sanitize-reply.test.ts` pins the writer's cut. These two cases pin the reader's own two ceilings in
// `replyTextOf` (`src/session-entries.ts`) against the band each alone reaches: the raw bound `MAX_TEXT_UNITS`
// is judged before the cleaning pass and the reply ceiling `MAX_REPLY_UNITS` after it, so a fixture has to sit
// on one side of the first and the other side of the second to isolate either gate. Each test carries its own
// precondition expects — a fixture that drifted out of its band would otherwise certify nothing.

/** `CLEAR` is a screen clear — four units the cleaning pass eats and the raw length still counts. */
const CLEAR = "\u001B[2J";

/**
 * A pin whose uid is `uid-<id>`, on a branch of its own: the refused reply entry attaches its mark to it and
 * nothing else, so `repliedAt` standing can only come from the entry under test.
 */
const branchFor = (id: number) => [toolResultEntry(state([pin(id, "Decide X")], id + 1))];

test("a reply inside the pre-clean bound whose clean form is past the ceiling loses the words", () => {
  // The band the raw gate cannot reach: the raw text is inside MAX_TEXT_UNITS, so only
  // `cleaned.length > MAX_REPLY_UNITS` refuses it and deleting that gate is what this case catches.
  const tail = "x".repeat(MAX_REPLY_UNITS + 100);
  const band = `${CLEAR.repeat(Math.floor((MAX_TEXT_UNITS - tail.length) / CLEAR.length))}${tail}`;
  // Raw within the pre-clean bound, cleaned past the reply's own ceiling — the shape that isolates the gate.
  expect(band.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
  expect(cleanPinText(band).length).toBeGreaterThan(MAX_REPLY_UNITS);
  const entry = replyEntry(userActionWithText("uid-1", LATER, band));
  expect(userActionFrom(entry)).not.toHaveProperty("text");
  const rebuilt = reconstruct(branchFor(1), [entry]);
  expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  expect(rebuilt.view.pins[0]?.reply).toBeUndefined();
});

test("a reply whose words the pass empties loses the words and keeps the mark", () => {
  // The third verdict: what the pass leaves empty is no answer, so no key grows and the entry still reads as
  // a reply. Deleting `cleaned === ""` would record the bytes the pass threw away as the user's words.
  const escapes = `${CLEAR}\u0007\u0000\u200B`;
  // The pass empties it, and the raw text sits inside the pre-clean bound — so the emptiness is the only
  // gate that can refuse it. Both are preconditions: if either drifted the case would pin something else.
  expect(cleanPinText(escapes)).toBe("");
  expect(escapes.length).toBeLessThanOrEqual(MAX_TEXT_UNITS);
  // A reader refusal is the absence of the field on a payload the entry still has: `at` is what the mark is
  // read from, so it is checked on the identical payload without the tampered text before it is asserted.
  expect(
    userActionFrom(
      customEntry({ v: 1, uid: "uid-2", action: "reply", at: LATER }, "pi-sticky.user"),
    ),
  ).toEqual({ v: 1, uid: "uid-2", action: "reply", at: LATER });
  const entry = replyEntry(userActionWithText("uid-2", LATER, escapes));
  expect(userActionFrom(entry)).not.toHaveProperty("text");
  const rebuilt = reconstruct(branchFor(2), [entry]);
  expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  expect(rebuilt.view.pins[0]?.reply).toBeUndefined();
});
