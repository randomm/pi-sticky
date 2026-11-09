/**
 * The guard half of the recorded reply: `isUserAction` and the `text` a `pi-sticky.user` reply entry may
 * carry. The rule this file exists to pin is the one a malformed entry is judged by —
 *
 * **a `text` the guard will not vouch for is *no text*, never a refused entry.**
 *
 * Absent is valid, `""` reads as no words, and so does a value that is not a string or runs past
 * `MAX_REPLY_UNITS`. The mark that the user answered a pin belongs to the reducer and the rail and is
 * carried by the *entry*; refusing the whole entry over one bad field would take that mark back for a
 * form the reader already treats as nothing to draw. It is `optionalGroup`'s rule in
 * `state-guards.ts` — the three optional pin fields are judged the same way, for the same reason — and the
 * `copiedGroup`/`copiedOptions` precedent in `session-entries.ts`.
 *
 * The reader and the projection are `test/reply-text-recorded.test.ts`; the write side, which can never
 * produce an over-long `text`, is `test/sanitize-reply.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { MAX_REPLY_GRAPHEMES, MAX_REPLY_UNITS, MAX_TEXT_UNITS } from "../src/bounds.ts";
import { sanitizeReplyText } from "../src/sanitize-reply.ts";
import { userActionFrom } from "../src/session-entries.ts";
import { isUserAction } from "../src/state-guards.ts";
import { reconstruct } from "../src/state.ts";
import type { UserAction } from "../src/types.ts";
import { LATER, pin, state, toolResultEntry } from "./fixtures.ts";

/** The one shape that is a well-formed reply apart from the field under test. */
const base = { v: 1, uid: "uid-1", action: "reply", at: LATER } as const;

/** One over the reply's ceiling, in single-unit clusters so the count is the length. */
const OVER = "x".repeat(MAX_REPLY_UNITS + 1);

/**
 * The over-long shapes a hand-edited session file can hold and no writer can produce, in three flavours:
 * ASCII one unit over, the same field wildly over, and the 25-unit wide cluster of `test/sanitize-reply.ts`
 * pushed past the ceiling. All three are strings, so a guard that speaks for the *field* must drop the field
 * for each of them and still read the entry as a reply.
 */
const C25 = `\u{1F468}${"\u{1F3FB}".repeat(11)}\uFE0F`;
const OVER_SHAPES: readonly unknown[] = [OVER, "x".repeat(8000), C25.repeat(70)];

/** A `pi-sticky.user` entry holding exactly `data` — what a hand-edited session file writes. */
const raw = (data: unknown): unknown => ({ type: "custom", customType: "pi-sticky.user", data });

/** The same payload as the fixture builds it, for the shapes a writer really produces. */
const replyEntry = (text?: string): unknown => raw({ ...base, text });

describe("isUserAction reads a bad `text` as no text, never as a bad entry", () => {
  test("an absent text is a valid reply", () => {
    expect(isUserAction(base)).toBe(true);
    // The whole entry shape a pre-v2 session holds: nothing after `at`.
    expect(isUserAction({ v: 1, uid: "uid-1", action: "reply", at: LATER })).toBe(true);
  });

  test("an over-long text costs the field, never the entry, and never the mark", () => {
    // PM ruling 3 of issue #111. A `text` this guard will not vouch for is *no text* — the same verdict a
    // number or an object gets — so the entry is still read as a reply and the pin keeps the mark that says
    // the user answered it. Three shapes, because the guard must not learn the field by its flavour: ASCII one
    // unit over, the same field wildly over, and the wide-cluster shape the writer's own cut produces.
    const stillAReply: UserAction = { v: 1, uid: "uid-1", action: "reply", at: LATER };
    for (const text of OVER_SHAPES) {
      expect(typeof text).toBe("string");
      expect((text as string).length).toBeGreaterThan(MAX_REPLY_UNITS);
      expect(isUserAction({ ...base, text })).toBe(true);
      const read = userActionFrom(raw({ ...base, text }));
      expect(read).toEqual(stillAReply);
      expect(read).not.toHaveProperty("text");
    }
  });

  test("an over-long text followed by a good reply leaves the good words standing", () => {
    // The entry order the pair takes in a session that was tampered with and then answered properly: the
    // broken entry says nothing (it has no words to say) and must not take the surviving answer with it.
    const branch = [toolResultEntry(state([pin(1, "Decide X")], 2))];
    const rebuilt = reconstruct(branch, [
      raw({ ...base, text: OVER }),
      raw({ ...base, text: "ship it" }),
    ]);
    expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
    expect(rebuilt.view.pins[0]?.reply).toBe("ship it");
    // And the broken entry alone still marks the pin, which is the half the old guard lost.
    const alone = reconstruct(branch, [raw({ ...base, text: OVER })]);
    expect(alone.view.pins[0]?.repliedAt).toBe(LATER);
    expect(alone.view.pins[0]?.reply).toBeUndefined();
  });

  test("a non-string text means the field is absent, and the entry is still read as a reply", () => {
    // The optionalGroup precedent: a value that cannot be words is judged as *no field*, never as a bad entry.
    // The shape checks above are what decide whether the payload is an action, so a number, an array, an
    // object or a boolean costs the words and leaves the replied mark standing.
    const stillAReply: UserAction = { v: 1, uid: "uid-1", action: "reply", at: LATER };
    for (const text of [7, ["yes"], { words: "yes" }, true, 0, Number.NaN, Symbol("x")]) {
      expect(isUserAction({ ...base, text })).toBe(true);
      expect(isUserAction({ ...base, text: undefined })).toBe(true);
      const read = userActionFrom(raw({ ...base, text }));
      expect(read).toEqual(stillAReply);
      expect(read).not.toHaveProperty("text");
    }
  });

  test("an empty or blank text reads as a reply with no words", () => {
    // `""` is what a draft of nothing but spaces cleans to, and the writer stores no key for it at all; a
    // hand-written entry may still carry it, and the answer it claims is the same one: the user answered,
    // with nothing to quote.
    for (const text of ["", "   ", "\u200B", "\u001B[2J"]) {
      expect(isUserAction({ ...base, text })).toBe(true);
      const read = userActionFrom(raw({ ...base, text }));
      expect(read).toEqual({ v: 1, uid: "uid-1", action: "reply", at: LATER });
      expect(read).not.toHaveProperty("text");
    }
  });

  test("the writer's maximum output survives the guard whole", () => {
    // The other side of the same rule: the ceiling has to sit where the writer's own cut leaves it, or a
    // reply the extension wrote itself would read back as no words at all. Two shapes, because the reader
    // cuts nothing it did not have to: a value already inside both ceilings (ASCII at the unit ceiling) is
    // handed back verbatim, and so is the cut's own maximum output — `sanitizeReplyText`'s longest answer,
    // the cluster fill of the grapheme ceiling plus its reserved ellipsis. A guard set one unit low, or a
    // reader that re-cut what it read, breaks one of these two.
    const atUnitCeiling = "x".repeat(MAX_REPLY_UNITS);
    expect(isUserAction({ ...base, text: atUnitCeiling })).toBe(true);
    expect(userActionFrom(replyEntry(atUnitCeiling))?.text).toBe(atUnitCeiling);

    const written = sanitizeReplyText("x".repeat(MAX_REPLY_UNITS * 2));
    expect(written).toBe(`${"x".repeat(MAX_REPLY_GRAPHEMES - 1)}\u2026`);
    expect(isUserAction({ ...base, text: written })).toBe(true);
    expect(userActionFrom(replyEntry(written))?.text).toBe(written);
  });

  test("a text within the ceiling is vouched for whatever it contains", () => {
    // A shape guard, not a sanitizer: escapes survive it by design, because the pass that decides what may
    // be drawn is `sanitizeReplyText` on the reader.
    expect(isUserAction({ ...base, text: "yes" })).toBe(true);
    expect(isUserAction({ ...base, text: "x".repeat(MAX_REPLY_UNITS) })).toBe(true);
    expect(isUserAction({ ...base, text: "ok\u001B[2J\u202E" })).toBe(true);
  });

  test("a bad text does not make a non-action into an action", () => {
    // The order inside the guard: the verb and the uid are judged before the text, so a payload that is not
    // a user action at all is refused whatever it carries — it cannot read as a reply by bringing its own.
    expect(isUserAction({ ...base, action: "explode", text: "yes" })).toBe(false);
    expect(isUserAction({ ...base, v: 2, text: "yes" })).toBe(false);
    expect(isUserAction({ ...base, uid: "u\u200b", text: "yes" })).toBe(false);
    // `at` keeps its own bound (`isBoundedString`, never the reply's), so an over-long stamp still refuses
    // the entry even when the text is a good one.
    expect(isUserAction({ ...base, at: "x".repeat(MAX_TEXT_UNITS + 1), text: "yes" })).toBe(false);
    // A `text` hanging off the prototype is reached through the chain by a plain property read, so the
    // guard reads plain objects only and this payload is no action at all.
    expect(isUserAction(Object.create({ ...base, text: "inherited" }))).toBe(false);
  });

  test("a dismiss entry is unaffected by the reply's field", () => {
    expect(isUserAction({ v: 1, uid: "uid-1", action: "dismiss", at: LATER })).toBe(true);
    const dismissed = userActionFrom(raw({ v: 1, uid: "uid-1", action: "dismiss", at: LATER }));
    expect(dismissed).toEqual({ v: 1, uid: "uid-1", action: "dismiss", at: LATER });
    expect(dismissed).not.toHaveProperty("text");
  });
});
