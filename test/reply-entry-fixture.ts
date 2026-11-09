/**
 * The `pi-sticky.user` reply entry, as the session holds it: the fixture-side spelling of the payload a
 * reply writes and a rebuild reads.
 *
 * `test/fixtures.ts` is the shared shape vocabulary and stays byte-identical across the reply work, so the
 * one builder that grew a field is here: `userActionWithText` is `userAction` plus the reply's own words,
 * which only a reply can carry — omit the text and no key is minted, exactly as the writer does when the
 * draft cleans to nothing. The entry wrappers are re-exported from `fixtures.ts` rather than restated, so
 * a test that hands one of these to a reader hands the same object shape the real handler appends.
 *
 * The guard rule the shapes here are used to pin is `test/state-guards-reply.test.ts`; the write side is
 * `test/reply-handler.test.ts`.
 */
import type { UserAction } from "../src/types.ts";
import { NOW, customEntry } from "./fixtures.ts";

/** A `pi-sticky.user` entry holding a reply whose recorded words are `text` — no key when there are none. */
export function userActionWithText(uid: string, at: string = NOW, text?: string): UserAction {
  return text === undefined
    ? { v: 1, uid, action: "reply", at }
    : { v: 1, uid, action: "reply", at, text };
}

/** The same payload for a dismissal, which never carries words whatever the draft said. */
export function dismissAction(uid: string, at: string = NOW): UserAction {
  return { v: 1, uid, action: "dismiss", at };
}

/** A `pi-sticky.user` entry holding `action`, ready to hand a reader or `reconstruct`. */
export function replyEntry(action: UserAction): unknown {
  return customEntry(action, "pi-sticky.user");
}

/** A reply entry in one call: the entry, not its payload. */
export function replyEntryWithText(uid: string, at: string = NOW, text?: string): unknown {
  return replyEntry(userActionWithText(uid, at, text));
}

/** A `pi-sticky.user` entry whose `data` is exactly `data`, bypassing the typed payload. */
export function rawUserActionEntry(data: unknown): unknown {
  return customEntry(data, "pi-sticky.user");
}
