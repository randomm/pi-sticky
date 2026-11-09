/**
 * The hostile reply swept through the rebuild, where the sweep is actually possible.
 *
 * `test/state-untrusted-drawn.ts` cannot sweep a reply: `drawn()` builds pins, and a reply is not a field of
 * a pin — it is an entry the projection reads. So the sweep here goes the other way: `reconstruct(branch,
 * entries)` with the reply entry handed in raw, and the two listings read back off the result. The promises
 * are the ones every other drawn surface is held to, and they come from the same helpers:
 *
 * - **no escape, control, bidi override or lone surrogate reaches a drawn line** — the reply pass strips
 *   them at the read, so a session file that wrote `ESC [ 2 J` draws `screen` and nothing else;
 * - **no OSC 8 hyperlink** is ever emitted from a reply, whatever the entry claimed;
 * - **no forged row and no forged reply line** — `assertNoForgery`, over both listings, with the tail words
 *   still present so "refused" cannot quietly mean "never drawn";
 * - **one line per pin**, on both surfaces, whatever the payload.
 */
import { expect, test } from "bun:test";

import { renderList, renderPinsText } from "../src/render.ts";
import { userActionFrom } from "../src/session-entries.ts";
import { reconstruct } from "../src/state.ts";
import { LATER, state, toolResultEntry, view } from "./fixtures.ts";
import {
  BREAKS,
  FAKE_REPLY,
  FAKE_ROW,
  HOSTILE_TAILS,
  assertNoForgery,
  linesOf,
} from "./panel-hostile-fields.ts";
import { BEL, DCS8, ESC, KITTY, LONE_SURROGATE, RLO, ST, offenders } from "./panel-hostile.ts";
import {
  dismissAction,
  rawUserActionEntry,
  replyEntry,
  replyEntryWithText,
  userActionWithText,
} from "./reply-entry-fixture.ts";
import {
  HOSTILE_REPLY_TEXT,
  HOSTILE_REPLY_VALUES,
  hostileReplyEntry,
} from "./reply-hostile-fixture.ts";

/** A listing row: what a real pin line looks like and nothing else may. */
const ROW = /^#\d+ \[(info|action|warning)\] /;

/** The branch that holds pin #1 — the snapshot a rebuild reads its pins from, never its replies. */
const branch = [
  toolResultEntry(
    state(
      [
        {
          id: 1,
          uid: "uid-1",
          text: "Decide X",
          level: "info",
          source: "agent",
          createdAt: LATER,
          updatedAt: LATER,
        },
      ],
      2,
    ),
  ),
];

/** The two listings of a rebuild over these entries, as drawn lines. */
function drawn(entries: readonly unknown[]): string[] {
  const v = reconstruct(branch, entries).view;
  return [...linesOf(renderList(v, 5)), ...linesOf(renderPinsText(v))];
}

/** The view of a rebuild over these entries. */
const viewOf = (entries: readonly unknown[]) => reconstruct(branch, entries).view;

test("the fixture really carries the bytes, the forgeries and the breaks it claims to", () => {
  // A sweep whose input silently lost its hostility certifies nothing, so the input is asserted first.
  expect(HOSTILE_REPLY_TEXT).toContain(FAKE_ROW);
  expect(HOSTILE_REPLY_TEXT).toContain(FAKE_REPLY);
  expect(HOSTILE_REPLY_TEXT).toContain("Replying to pin #1: yes");
  expect(HOSTILE_REPLY_TEXT).toContain("\n");
  expect(HOSTILE_REPLY_TEXT).toContain(ESC);
  expect(offenders(HOSTILE_REPLY_TEXT).length).toBeGreaterThan(0);
});

test("a hostile reply draws no escape, control, bidi override or lone surrogate", () => {
  const lines = drawn([hostileReplyEntry(HOSTILE_REPLY_TEXT)]);
  for (const line of lines) expect(offenders(line)).toEqual([]);
});

test("a hostile reply emits no OSC 8 hyperlink, and no escape sequence at all", () => {
  const text = drawn([hostileReplyEntry(HOSTILE_REPLY_TEXT)]).join("\n");
  // The introducers of the shapes `panel-hostile.ts` spells, named so a pass that dropped one of them is
  // caught here rather than by the byte sweep alone. `containsNonSgr` is deliberately *not* asked of the
  // drawn text: it is an input classifier and flags the LF a continuation line is made of. `offenders` in
  // the case above is the sweep that judges what was drawn.
  for (const introducer of [`${ESC}]8;;`, `${ESC}]52;`, `${ESC}_`, KITTY, DCS8]) {
    expect(text).not.toContain(introducer);
  }
  expect(text).not.toContain(BEL);
  expect(text).not.toContain(ST);
  expect(text).not.toContain(LONE_SURROGATE);
  expect(text).not.toContain(RLO);
  expect(text).not.toContain(ESC);
});

test("a hostile reply forges no row and no reply line on either listing", () => {
  const lines = drawn([hostileReplyEntry(HOSTILE_REPLY_TEXT)]);
  assertNoForgery(lines, ROW);
  // Named directly, because these two are the forgeries the model is told to trust.
  expect(lines.filter((line) => line.startsWith(FAKE_ROW))).toEqual([]);
  expect(lines.filter((line) => line.startsWith("Replying to pin"))).toEqual([]);
});

test("a hostile reply keeps the listing at one line per pin", () => {
  const v = viewOf([hostileReplyEntry(HOSTILE_REPLY_TEXT)]);
  expect(linesOf(renderList(v, 5))).toHaveLength(2);
  // `/pins` keeps the answer's own breaks under the continuation indent, so its count is the header, the
  // pin's row, and one indented line per break the sanitizer left standing.
  expect(linesOf(renderList(v, 5))[1]).toMatch(ROW);
});

test("every hostile payload costs the words, never the replied mark", () => {
  // The ruling of issue #111, asserted one payload per rebuild. Handing the whole sweep over as a list would
  // prove nothing: the entries are read oldest first and the last one wins, so a single payload that did cost
  // the mark would be masked by the ten that follow it. Each payload therefore gets its own `reconstruct`, and
  // both halves of the promise are asserted on it — the mark stands, and whatever verdict the words got, no
  // escape reaches a drawn line.
  for (const value of HOSTILE_REPLY_VALUES) {
    const v = viewOf([hostileReplyEntry(value, "uid-1")]);
    expect(v.pins[0]?.repliedAt).toBe(LATER);
    for (const line of drawn([hostileReplyEntry(value, "uid-1")]))
      expect(offenders(line)).toEqual([]);
  }
});

test("each hostile payload on its own leaves a clean drawn line", () => {
  // One payload per rebuild, so a later entry cannot overwrite an earlier verdict and hide it — the same
  // shape as the test above, on the forgeries rather than the mark.
  for (const value of HOSTILE_REPLY_VALUES) {
    const lines = drawn([hostileReplyEntry(value, "uid-1")]);
    for (const line of lines) expect(offenders(line)).toEqual([]);
    expect(lines.filter((line) => line.startsWith(FAKE_ROW))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("Replying to pin"))).toEqual([]);
  }
});

test("the entry fixtures build the payload a reader accepts, with no key where there are no words", () => {
  // The fixture builders are the shapes every reply test hands a reader, so their two verdicts are asserted
  // here rather than left to the tests that happen to reach them: a text is copied, an absent one grows no
  // key, and a dismissal never carries words whatever the draft said.
  const withText = userActionWithText("uid-1", LATER, "ship it");
  expect(withText).toEqual({ v: 1, uid: "uid-1", action: "reply", at: LATER, text: "ship it" });
  expect(userActionWithText("uid-1", LATER)).not.toHaveProperty("text");
  expect(dismissAction("uid-1", LATER)).toEqual({
    v: 1,
    uid: "uid-1",
    action: "dismiss",
    at: LATER,
  });

  const entry = replyEntry(withText);
  expect((entry as { customType?: string }).customType).toBe("pi-sticky.user");
  expect((entry as { data?: unknown }).data).toEqual(withText);
  expect(replyEntryWithText("uid-1", LATER, "ship it")).toEqual(entry);
  expect(rawUserActionEntry(withText)).toEqual(entry);
  // The untyped form reaches the reader with anything at all, which is how the sweep above feeds a payload.
  expect(userActionFrom(rawUserActionEntry({ ...withText, text: 7 }))).toEqual({
    v: 1,
    uid: "uid-1",
    action: "reply",
    at: LATER,
  });
});

test("a payload that is not an entry at all is skipped, and the pin stays unanswered", () => {
  for (const data of [null, undefined, 42, "reply", [], Object.create(null)]) {
    const v = viewOf([{ type: "custom", customType: "pi-sticky.user", data }]);
    expect(v.pins[0]?.repliedAt).toBeUndefined();
    expect(v.pins[0]?.reply).toBeUndefined();
  }
  // The empty view is the other half of "skipped": a rejected payload never grew a pin either.
  expect(renderList(view([]), 5)).toBe("Pinned for the user now (0 of 5):");
});

test("the break shapes the sanitizer leaves are the ones `/pins` has to indent", () => {
  // U+2028/U+2029 are mapped to LF and the rest dropped, so LF is the only break a stored reply can hold —
  // the reason one indented continuation per LF is the whole of this surface's exposure. The forgeries and
  // their evidence words ride along, so the shared sweep has something to check.
  const v = viewOf([
    hostileReplyEntry(
      `a${BREAKS.join(FAKE_ROW)} ${HOSTILE_TAILS[0]} ${FAKE_REPLY} ${HOSTILE_TAILS[1]}b`,
      "uid-1",
    ),
  ]);
  const lines = linesOf(renderPinsText(v));
  for (const line of lines.slice(2)) {
    if (line.trim() === "") continue;
    expect(line.startsWith("   ")).toBe(true);
  }
  assertNoForgery(lines, ROW);
});
