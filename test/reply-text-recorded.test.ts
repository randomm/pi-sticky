/**
 * The recorded reply, end to end: the guard that lets an entry through, the reader that copies its `text`, the
 * projection that puts the words back on the pin, and the two rows that print them. One field spanning four
 * files, so the question each boundary answers is the same one — *does the model still see what the user
 * answered, after the agent rewrote the pin?* — and it is only answerable with all four in one place.
 *
 * The rule that holds the boundaries together: a reply the guard will not vouch for is **no text**, never a
 * refused entry. The mark that the user answered belongs to the reducer and the rail, and a malformed word
 * must not take it back.
 *
 * The lifecycle that writes the entry is `test/reply-handler.test.ts`; the session that rebuilds it is
 * `test/integration-reply.test.ts`; the ceilings themselves are `test/sanitize-reply.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { MAX_REPLY_GRAPHEMES, MAX_REPLY_UNITS } from "../src/bounds.ts";
import { modelRow, pinsTextRow } from "../src/pin-rows-text.ts";
import { decideReply } from "../src/reply.ts";
import { userActionFrom } from "../src/session-entries.ts";
import { isUserAction } from "../src/state-guards.ts";
import { reconstruct } from "../src/state.ts";
import { LATER_TIME } from "./fixtures.ts";
import {
  LATER,
  NOW,
  NOW_TIME,
  customEntry,
  pin,
  state,
  toolResultEntry,
  userAction,
  userEntry,
} from "./fixtures.ts";
import { userActionWithText } from "./reply-entry-fixture.ts";
import { DECIDE, REWRITTEN, submitted } from "./reply-support.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

/** A `pi-sticky.user` entry whose `data` is exactly `data`, bypassing the fixture's typing. */
const raw = (data: unknown): unknown => ({ type: "custom", customType: "pi-sticky.user", data });

/** The one shape that is a well-formed action apart from the field under test. */
const base = { v: 1, uid: "uid-1", action: "reply", at: LATER } as const;

/** A reply at the ceiling and one over it, in single-code-point clusters so the count is the length. */
const AT_CEILING = "x".repeat(MAX_REPLY_UNITS);
const OVER_CEILING = "x".repeat(MAX_REPLY_UNITS + 1);

describe("isUserAction and a `text`", () => {
  test("a text within the reply's ceiling is vouched for, whatever it contains", () => {
    // A shape guard, not a sanitizer: escapes survive it by design, because the pass that decides what may be
    // drawn is `cleanPinText`/`sanitizeReplyText` on the reader. Asserting that here is what stops a later
    // "harden the guard" change from silently dropping hostile-but-real replies.
    expect(isUserAction({ ...base, text: "yes" })).toBe(true);
    expect(isUserAction({ ...base, text: AT_CEILING })).toBe(true);
    expect(isUserAction({ ...base, text: `replied${cp(0x1b)}[2J\u202E` })).toBe(true);
    expect(isUserAction({ ...base, text: "\n" })).toBe(true);
  });

  test("a text is optional, so a pre-reply entry and a dismiss still read", () => {
    expect(isUserAction(base)).toBe(true);
    expect(isUserAction({ ...base, action: "dismiss" })).toBe(true);
    // An explicit `undefined` is the same claim as no key: the entry was written by a version that had the
    // field and chose not to fill it (a reply the pass emptied), which is a replied pin with no words. And an
    // empty string reads the same way on purpose — the mark belongs to the reducer and the rail, and refusing
    // the entry over a blank would take the mark back for a form the *reader* already treats as no words.
    expect(isUserAction({ ...base, text: undefined })).toBe(true);
    expect(isUserAction({ ...base, text: "" })).toBe(true);
  });

  test("a text the guard will not vouch for costs the words, not the entry", () => {
    // The ruling, stated where the reader is asserted: a `text` the reader cannot use is judged as *no field*
    // — a non-string, an over-long string or one the pass empties all read the same way — and the entry is
    // still a reply. `test/state-guards-reply.test.ts` owns the guard cases themselves.
    for (const bad of [7, ["yes"], { words: "yes" }, true, OVER_CEILING, "x".repeat(8000)]) {
      expect(isUserAction({ ...base, text: bad })).toBe(true);
      expect(userActionFrom(raw({ ...base, text: bad }))).toEqual({
        v: 1,
        uid: "uid-1",
        action: "reply",
        at: LATER,
      });
      expect(userActionFrom(raw({ ...base, text: bad }))).not.toHaveProperty("text");
    }
  });

  test("a bad text does not make a non-action into an action", () => {
    // The order inside the guard: the verb is checked before the text, so a payload that is not a user action
    // at all is refused whatever it carries, and cannot read as a reply by bringing its own `text`.
    expect(isUserAction({ ...base, action: "explode", text: "yes" })).toBe(false);
    expect(isUserAction({ ...base, action: "reply", uid: `u${cp(0x200b)}`, text: "yes" })).toBe(
      false,
    );
    expect(isUserAction({ ...base, v: 2, text: "yes" })).toBe(false);
  });

  test("a text hanging off the prototype is no text, and refuses the entry", () => {
    // The same inheritance hole the ui payload is pinned against: `x.text === undefined` on an
    // `Object.create({text})` reads as *present* through the prototype chain, so the guard has to look at the
    // entry's own fields. It reads plain objects only, so this payload is not an action at all.
    expect(isUserAction(Object.create({ ...base, text: "inherited" }))).toBe(false);
  });
});

describe("userActionFrom copies `text` by name", () => {
  const snapshot = state([pin(1, "Decide X")], 2);
  /** The branch that holds pin #1 — the snapshot a rebuild reads its pin from, never its replies. */
  const branchOf = (details: unknown): unknown[] => [toolResultEntry(details)];

  test("a reply's words are copied, cleaned of everything the pin text is cleaned of", () => {
    expect(userActionFrom(userEntry(userActionWithText("uid-1", LATER, " yes ")))).toEqual({
      v: 1,
      uid: "uid-1",
      action: "reply",
      at: LATER,
      text: "yes",
    });
    const cleaned = userActionFrom(
      userEntry(
        userActionWithText("uid-1", LATER, "\u001B]8;;http://evil\u0007see\u0007 \u202Enow"),
      ),
    );
    expect(cleaned?.text).toBe("see now");
  });

  test("a text the pass empties grows no key, so the entry reads as a reply with no words", () => {
    // The rule that keeps a dismiss entry byte-identical to one a pre-reply version wrote: nothing is stored,
    // rather than a key whose presence claims the user answered with an empty string.
    expect(userActionFrom(raw({ ...base, text: "   " }))).toEqual({
      v: 1,
      uid: "uid-1",
      action: "reply",
      at: LATER,
    });
    expect(userActionFrom(raw({ ...base, text: "\u200B" }))).not.toHaveProperty("text");
    expect(userActionFrom(userEntry(userAction("uid-1", "dismiss", LATER)))).not.toHaveProperty(
      "text",
    );
  });

  test("a text past the reply's ceiling costs the words and keeps the mark", () => {
    // PM ruling 3 of issue #111, on the reader: the ceiling is judged where the field is, in
    // `userActionFrom`, and what it drops is the field — never the entry. The mark belongs to the reducer and
    // the rail, so an entry no writer could have produced still says the user answered; only its words are
    // gone. `test/reply-text-recorded`'s companion `test/reply-survival-tampered.test.ts` walks the same
    // shape through the real extension.
    const branch = branchOf(snapshot);
    const c25 = `\u{1F468}${"\u{1F3FB}".repeat(11)}\uFE0F`; // one grapheme, 25 units
    for (const over of [OVER_CEILING, "x".repeat(8000), c25.repeat(70)]) {
      expect(over.length).toBeGreaterThan(MAX_REPLY_UNITS);
      const read = userActionFrom(raw({ ...base, text: over }));
      expect(read).toEqual({ v: 1, uid: "uid-1", action: "reply", at: LATER });
      expect(read).not.toHaveProperty("text");
      const rebuilt = reconstruct(branch, [raw({ ...base, text: over })]);
      expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
      expect(rebuilt.view.pins[0]?.reply).toBeUndefined();
    }
  });

  test("a text at the reply's own ceilings is read back whole", () => {
    // The boundary the two files share: a text the guard vouches for is the text the reader hands on uncut,
    // and the view projects it verbatim. Anything shorter than the *cut*'s ceiling is untouched by it, so
    // `MAX_REPLY_GRAPHEMES - 1` ASCII characters clear the grapheme, the unit and the guard ceiling at once —
    // which is the equality that matters, because a reader that quietly trimmed would fail it.
    const branch = branchOf(snapshot);
    const fits = "x".repeat(MAX_REPLY_GRAPHEMES - 1);
    expect(userActionFrom(raw({ ...base, text: fits }))?.text).toBe(fits);
    expect(reconstruct(branch, [raw({ ...base, text: fits })]).view.pins[0]?.reply).toBe(fits);
    // And the wide form, where the two reply ceilings disagree: still read back whole.
    const wide = "\u{1F44D}".repeat(MAX_REPLY_GRAPHEMES);
    expect(userActionFrom(raw({ ...base, text: wide }))?.text).toBe(wide);
  });

  test("an entry without a text still marks the pin replied, on the surface the model reads", () => {
    // The regression the whole rule exists for: an entry written before replies carried text must not lose
    // its mark, and an entry whose text was emptied must not lose it either. `repliedAt` is the proof; the
    // row without a quote is the surface.
    const branch = branchOf(snapshot);
    const without = reconstruct(branch, [userEntry(userAction("uid-1", "reply", LATER))]);
    expect(without.view.pins[0]?.repliedAt).toBe(LATER);
    expect(without.view.pins[0]?.reply).toBeUndefined();
    const emptied = reconstruct(branch, [raw({ ...base, text: "  " })]);
    expect(emptied.view.pins[0]?.repliedAt).toBe(LATER);
    expect(emptied.view.pins[0]?.reply).toBeUndefined();
  });

  test("a dismiss entry never carries words, whatever its `text` claims", () => {
    // A dismissal is a verb, not an utterance: `dismissAction` mints no `text` and the reader must not grow
    // one. A hand-edited session file can put the key on a dismiss entry, and the copy that came back with a
    // `text` on it would be a payload the writer could never have produced — with words on it the projection
    // would be reading an answer nobody gave. The field is dropped before it is looked at, so the pass never
    // runs over it either.
    const dismissed = userActionFrom(raw({ ...base, action: "dismiss", text: "  ship it  " }));
    expect(dismissed).toEqual({ v: 1, uid: "uid-1", action: "dismiss", at: LATER });
    expect(dismissed).not.toHaveProperty("text");
    // The over-long shape too: a dismiss entry whose `text` is past the ceiling is still just a dismissal.
    const long = userActionFrom(raw({ ...base, action: "dismiss", text: OVER_CEILING }));
    expect(long).toEqual({ v: 1, uid: "uid-1", action: "dismiss", at: LATER });
    expect(long).not.toHaveProperty("text");
    // And through the rebuild: the pin is gone, and no other pin inherits the words.
    const rebuilt = reconstruct(branchOf(snapshot), [
      userEntry(userAction("uid-1", "reply", LATER)),
      raw({ ...base, action: "dismiss", text: "not an answer" }),
    ]);
    expect(rebuilt.view.pins).toEqual([]);
    expect(rebuilt.view.removed.map((r) => r.id)).toEqual([1]);
  });

  test("only a pi-sticky.user entry is read, and `uid` is copied uncleaned", () => {
    expect(userActionFrom(customEntry(base, "pi-sticky.state"))).toBeUndefined();
    expect(userActionFrom({ type: "custom", customType: "pi-sticky.user", data: base })).toEqual({
      v: 1,
      uid: "uid-1",
      action: "reply",
      at: LATER,
    });
    // The uid is the pin's address, compared with `===` and never drawn: cleaning it would break the match.
    expect(userActionFrom(raw({ ...base, uid: "uid-1" }))?.uid).toBe("uid-1");
  });
});

describe("the projection puts the recorded words on the pin the agent rewrote", () => {
  const snapshot = state([pin(1, "Decide X")], 2);
  const branch = [toolResultEntry(snapshot)];

  test("the agent's update moves the text and leaves the answer standing beside it", () => {
    // The bug the issue names: the answer lived only in the rewrite the model itself composed, so the moment
    // it updated the pin the model had no record of what the user said. The projection reads the entry, not
    // the snapshot, so the update and the answer are independent — and `updated` proves the pin really moved.
    const rewritten = state([pin(1, "Decide Y")], 2);
    const rebuilt = reconstruct(
      [toolResultEntry(rewritten)],
      [userEntry(userActionWithText("uid-1", LATER, "yes"))],
    );
    expect(rebuilt.view.pins[0]?.text).toBe("Decide Y");
    expect(rebuilt.view.pins[0]?.reply).toBe("yes");
    expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  });

  test("the last reply in entry order is the one projected, whatever the clocks say", () => {
    // `at` is the writer's clock and two submissions can carry the same stamp; array order is the session's
    // own record of which came last, and the model must read the answer the user wrote last.
    const rebuilt = reconstruct(branch, [
      userEntry(userActionWithText("uid-1", LATER, "first")),
      userEntry(userActionWithText("uid-1", LATER, "second")),
    ]);
    expect(rebuilt.view.pins[0]?.reply).toBe("second");
  });

  test("a later reply with no words does not erase the words of the reply before it", () => {
    // The rule that makes "no text at all, never a refused entry" safe to hold: an entry that carries nothing
    // says nothing, so it must not take the surviving answer with it. It is also the shape a second, empty
    // submission of the same pin produces.
    const rebuilt = reconstruct(branch, [
      userEntry(userActionWithText("uid-1", NOW, "yes")),
      userEntry(userAction("uid-1", "reply", LATER)),
    ]);
    expect(rebuilt.view.pins[0]?.reply).toBe("yes");
    expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  });

  test("a reply to a uid the branch no longer holds projects nothing, and answers no other pin", () => {
    // Uids are never reused, so an answer to a gone pin is a fact about nothing. Asserted with `every` rather
    // than a `not.toContain` so a row that never drew cannot certify it.
    const rebuilt = reconstruct(branch, [userEntry(userActionWithText("uid-gone", LATER, "yes"))]);
    expect(rebuilt.view.pins.every((p) => p.reply === undefined)).toBe(true);
    expect(rebuilt.view.pins.every((p) => p.repliedAt === undefined)).toBe(true);
  });

  test("a reply to a pin the user then dismissed projects nothing", () => {
    // The dismissed pin is gone from the view, so there is no pin for the answer to ride on — and no other
    // pin may inherit it: uids are never reused, so these words are a fact about nothing.
    const rebuilt = reconstruct(branch, [
      userEntry(userActionWithText("uid-1", LATER, "yes")),
      userEntry(userAction("uid-1", "dismiss", NOW)),
    ]);
    expect(rebuilt.view.pins).toEqual([]);
    expect(rebuilt.state.removed.map((r) => r.id)).toEqual([1]);
  });
});
