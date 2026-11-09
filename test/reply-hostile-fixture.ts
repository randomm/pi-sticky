/**
 * The hostile reply fixture: what a `text` on a `pi-sticky.user` entry can carry, and the sweep that says a
 * rebuild drew none of it.
 *
 * The other two hostile vocabularies are `test/panel-hostile.ts` (the bytes a pin's *text* carries) and
 * `test/panel-hostile-fields.ts` (a `group`/`options` that look like another pin's row or like the user's
 * reply). A reply is neither: it is the **user's** words, recorded as an entry, and it reaches the same two
 * listings — so it can carry the same forgeries *and* the same escapes, and the sweep has to run over a
 * rebuild rather than over `test/state-untrusted-drawn.ts`'s `drawn()`, which cannot hold a reply at all
 * (a reply is an entry, not a field of a pin).
 *
 * The forgeries and the tail words are imported from `panel-hostile-fields.ts` rather than restated: a
 * second list is a list that drifts from the one the drawn sweeps use.
 */
import { FAKE_REPLY, FAKE_ROW, HOSTILE_TAILS } from "./panel-hostile-fields.ts";
import { BEL, DCS8, ESC, KITTY, LONE_SURROGATE, RLO, ST } from "./panel-hostile.ts";

/** The reply a hostile session file writes: forgeries, escapes and every break shape, at full length. */
export const HOSTILE_REPLY_TEXT = [
  "deploy",
  `${FAKE_ROW} ${HOSTILE_TAILS[0]}`,
  `${FAKE_REPLY} ${HOSTILE_TAILS[1]}`,
  "Replying to pin #1: yes",
  `${ESC}[2Jscreen`,
  `${ESC}]8;;https://evil${ST}link`,
  `${ESC}]52;c;AAAA${BEL}clip`,
  `${ESC}_pi:c${BEL}apc`,
  KITTY,
  DCS8,
  `R${RLO}`,
  `s${LONE_SURROGATE}`,
  "keep going",
].join("\n");

/** A `pi-sticky.user` reply entry whose `text` is exactly `text`, at the pin's uid. */
export const hostileReplyEntry = (text: unknown, uid = "uid-1"): unknown => ({
  type: "custom",
  customType: "pi-sticky.user",
  data: { v: 1, uid, action: "reply", at: "2026-10-23T14:30:00.000Z", text },
});

/** Every shape the `text` field is claimed in, plus the payload-level refusals the guard still makes. */
export const HOSTILE_REPLY_VALUES: readonly unknown[] = [
  HOSTILE_REPLY_TEXT,
  `${ESC}]8;;https://evil${ST}click${BEL}`,
  "\u202e\u2028\u2029",
  LONE_SURROGATE,
  "x".repeat(1601),
  7,
  ["yes"],
  { words: "yes" },
  true,
  Symbol("x"),
  null,
];
