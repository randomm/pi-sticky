/**
 * The reply flow end-to-end: the user submits `Re #1: yes`, the faux model receives the rewritten
 * message, the branch holds a `pi-sticky.user` reply entry, and both surfaces draw the pin as replied —
 * after a reload and after a `/tree` jump, which is the whole claim that the reply is a session fact
 * rather than a variable.
 *
 * Everything runs on the harness's real session: `h.run(prompt)` reaches pi's `prompt()`, which fires the
 * `input` event with `source: "interactive"` before any agent processing, so the transform lands in the
 * same model request as the user's reply — the assertion at the top of this file is the one that proves
 * the feature works inside pi rather than against a stand-in of it. The parser's own branches are
 * `test/reply.test.ts`.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { KEY, USER_TYPE } from "../src/types.ts";
import { LATER, LATER_TIME, localTime, pin as pinFixture, userAction } from "./fixtures.ts";
import { userEntry } from "./fixtures.ts";
import { call, createHarness, reply } from "./harness.ts";
import { detailsOf, pin, rows, userEntries } from "./integration-support.ts";
import { pinEntry } from "./panel-lifecycle-fixture.ts";
import { RecordingUi } from "./recording-ui.ts";
import { replyTo } from "./reply-support.ts";
import { stubApi } from "./wiring-stubs.ts";

/**
 * A fresh extension instance for one harness.
 *
 * `integration-support.ts` exports a single module-level instance for the files that never reload a
 * session. This file reloads one, and pi's `session.reload()` tears the runner down and re-runs the
 * factories it was handed: with an instance two harnesses share, the harness the `print` case builds
 * afterwards ends up driving handlers whose closure belongs to a session that has been torn down, and its
 * reply stops being rewritten at all. One instance per harness is what the extension's own rule — a
 * context is a snapshot of one session — already says; the clock stays the shared `LATER` so the stamps
 * stay assertable.
 */
const sticky = () => createStickyExtension(DEFAULT_CONFIG, () => LATER);

/**
 * What the model must receive for a `Decide X` pin answered with `yes`, spelled out rather than built:
 * the code span around the pin text is the fix this file guards, so it is pinned by a literal here as well
 * as by the golden string in `test/reply-support.ts`.
 */
const REPLY_TEXT = "Replying to pin #1 (info): `Decide X`\n\nyes";

/** The text of the last user message of the most recent request, which is the message just submitted. */
function lastUserText(h: Awaited<ReturnType<typeof createHarness>>): string {
  const request = h.requests[h.requests.length - 1];
  if (!request) throw new Error("no model request was made");
  const users = request.messages.filter((message) => message.role === "user");
  const last = users[users.length - 1];
  if (!last) throw new Error("the last request holds no user message");
  const content = last.content;
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

/** Script one pin from the model and run a turn for it, leaving the session idle with pin #1 live. */
async function pinned(...texts: string[]) {
  const h = await createHarness({ factories: [sticky()] });
  const steps = texts.map((text) => call("pin_for_user", { action: "pin", text }));
  h.script([...steps, reply("ok")]);
  await h.run("go");
  return h;
}

test("a reply reaches the model as the rewritten text, in the same request", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");

    expect(lastUserText(h)).toBe(REPLY_TEXT);
  } finally {
    await h.dispose();
  }
});

test("a reply records one pi-sticky.user entry addressed by the pin's uid", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");

    // The uid is minted per pin, so it is matched by shape and re-read from the snapshot rather than
    // hardcoded: what matters is that the entry addresses *that* pin by the address a branch edit cannot
    // change, and that there is exactly one entry, stamped with the injected clock.
    const uid = (detailsOf(h).pins as { uid: string }[])[0]?.uid;
    expect(uid).toBeTruthy();
    expect(userEntries(h)).toEqual([{ v: 1, uid, action: "reply", at: LATER }]);
  } finally {
    await h.dispose();
  }
});

test("the rail draws the replied pin dimmed with a leading ↩, and no trailing one", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");

    const [, line] = rows(h);
    // Exact string, not `toContain("↩")`: the mark moved from the end of the row to the front of the
    // text column, and an assertion that accepted either form would pass against the old drawing. The
    // clock the extension runs on is `LATER`, which is the stamp every pin of this harness carries.
    expect(line).toBe(` • #1 ${localTime(LATER)}  ↩ Decide X`);
    expect(line).not.toMatch(/↩\s*$/);
  } finally {
    await h.dispose();
  }
});

test("a reload keeps the replied display, rebuilt from the entry rather than the memory", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");
    const before = rows(h)[1];

    await h.session.reload();
    await h.session.waitForIdle();

    expect(rows(h)[1]).toBe(before);
    expect(rows(h)[1]).toInclude("↩ Decide X");
  } finally {
    await h.dispose();
  }
});

test("the dimming comes from the session and not the branch: a reply entry off the branch still dims", () => {
  // The U10 claim, made where it can actually be falsified. pi appends a custom entry at the *leaf*, and
  // during a `prompt()` the user's own message has not been appended yet — so the entry this handler
  // writes hangs below the messages of the turn that produced it, and a `/tree` jump back to the turn
  // that pinned the message leaves the reply off the branch it lands on while the pin's own tool result
  // stays on it. A `reconstruct` that read `getBranch()` alone would draw that pin undimmed.
  //
  // The harness's own session cannot be driven into that shape (pi's branch move prunes and unregisters
  // the widget rather than redrawing it from a branch that still holds the pin), so the two readers the
  // rebuild is made of are handed to the *real* extension separately: one branch, one entry list that
  // holds an action no branch contains. Nothing here reimplements the rebuild — the rail is drawn by
  // `createStickyExtension`'s own `session_start` handler.
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);

  const branch = [pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X" }])];
  const entries = [...branch, userEntry(userAction("aaaa1111", "reply", LATER))];
  const recorder = new RecordingUi();
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: recorder,
    sessionManager: { getBranch: () => branch, getEntries: () => entries },
  };

  stub.emit("session_start", { reason: "startup" }, ctx);

  // The reply is off the branch the rebuild walks, so only a session-wide read can have put the mark here.
  expect(branch.some((entry) => (entry as { customType?: string }).customType === USER_TYPE)).toBe(
    false,
  );
  expect(recorder.renderWidget(KEY, 80)[1]).toBe(` • #1 ${localTime(LATER)}  ↩ Decide X`);
});

test("a reply to an unknown id is sent unchanged and the user is warned", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("answered anyway")]);
    await h.run("Re #7: hello");

    expect(lastUserText(h)).toBe("Re #7: hello");
    expect(h.ui.notifications).toEqual([{ message: "No pin #7 to reply to.", type: "warning" }]);
    expect(userEntries(h)).toEqual([]);
    // The pin is untouched: an unknown reply leaves the drawing alone.
    expect(rows(h)[1]).not.toInclude("↩");
  } finally {
    await h.dispose();
  }
});

test("the tool's listing says the pin was replied, in the wording its tests pin", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");

    h.appendScript([call("pin_for_user", { action: "list" }), reply("ok")]);
    await h.run("what is pinned?");

    const listing = JSON.stringify(h.requests[h.requests.length - 1]);
    expect(listing).toInclude(`(replied by the user at ${LATER_TIME})`);
  } finally {
    await h.dispose();
  }
});

test("a reply to a multi-line pin quotes one line and keeps the rest of the draft", async () => {
  const h = await pinned("first\nsecond");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: the first one");

    // Literal, not `replyTo(...)`: this is the case whose text the suite pins character for character,
    // and a written-out expectation is what catches the shared helper drifting from the source.
    expect(lastUserText(h)).toBe("Replying to pin #1 (info): `first second`\n\nthe first one");
  } finally {
    await h.dispose();
  }
});

test("a reply whose draft the panel made is rewritten like one typed", async () => {
  // The panel's Enter produces exactly `Re #<id>: <draft>`; what the user then submits is what this
  // case submits, so the producer and the parser meet here rather than in a shared constant.
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: how about the blue one");

    // Built from the shared fixture for a pin of the same id, level and text this harness pinned — the
    // `pin` of this file's scope is the harness's pin-a-session helper, not a pin value.
    expect(lastUserText(h)).toBe(
      replyTo({ ...pinFixture(1, "Decide X", "info") }, "how about the blue one"),
    );
  } finally {
    await h.dispose();
  }
});

test("a plain message is neither rewritten nor recorded", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("plain")]);
    await h.run("an ordinary question");

    expect(lastUserText(h)).toBe("an ordinary question");
    expect(userEntries(h)).toEqual([]);
    expect(h.ui.notifications).toEqual([]);
  } finally {
    await h.dispose();
  }
});

test("print mode rewrites and records without notifying", async () => {
  // No uiContext is bound in print mode, so `hasUI` is false: the reply must still reach the model and
  // still be written down, and the warning branch must stay silent rather than throw.
  const h = await createHarness({ factories: [sticky()], mode: "print" });
  try {
    await pin(h, "Decide X");
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");

    expect(lastUserText(h)).toBe(REPLY_TEXT);
    const uid = (detailsOf(h).pins as { uid: string }[])[0]?.uid;
    expect(userEntries(h)).toEqual([{ v: 1, uid, action: "reply", at: LATER }]);
    expect(h.ui.notifications).toEqual([]);
  } finally {
    await h.dispose();
  }
});
