/**
 * The recorded answer, seen only through a real session: five lifetimes in which a variable would have been
 * lost and an entry is not.
 *
 * AC2 of issue #111. The mark (`repliedAt`) already survived these — it is drawn from the same entry — but
 * the mark alone cannot falsify anything: a rebuild that read the branch only keeps the mark and loses the
 * words. Every case below therefore asserts on `view.pins[n].reply` or on the row the model reads, never on
 * the dimming.
 *
 * The five: a `/reload` (pi clears the widgets and the extension rebuilds), an entry that is not on the
 * branch the rebuild walks, a `navigateTree` onto a branch that does not hold it, a resumed process reading
 * the persisted session file, and the post-compaction reminder, which is the model's whole account of the
 * pins once the transcript has been summarised away.
 *
 * The pure side of the same field is `test/reply-text-recorded.test.ts`; the write is
 * `test/reply-handler.test.ts`; the ordinary flow is `test/integration-reply.test.ts`.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { reminderText } from "../src/reminder.ts";
import { renderList } from "../src/render.ts";
import { reconstruct } from "../src/state.ts";
import { USER_TYPE } from "../src/types.ts";
import { RAIL_AGE } from "./fixtures-age.ts";
import { LATER, LATER_TIME } from "./fixtures.ts";
import { reply } from "./harness.ts";
import { call, createHarness } from "./harness.ts";
import { harness, pinned } from "./integration-reply-fixture.ts";
import { pinEntry } from "./panel-lifecycle-fixture.ts";
import { RecordingUi } from "./recording-ui.ts";
import { replyEntryWithText } from "./reply-entry-fixture.ts";
import { resumeWithExtensions } from "./resume-harness.ts";
import { stubApi } from "./wiring-stubs.ts";

/** Padding to make a turn big enough for the compaction budget to want it. */
const PAD = "y".repeat(3000);

/** Every `pi-sticky.user` payload of an entry list, oldest first. */
function userPayloads(entries: readonly unknown[]): unknown[] {
  return entries
    .filter(
      (entry) =>
        (entry as { type?: string; customType?: string }).type === "custom" &&
        (entry as { customType?: string }).customType === USER_TYPE,
    )
    .map((entry) => (entry as { data?: unknown }).data);
}

/** The row the model reads for pin #1, from a rebuild of these entries. */
function modelRow(branch: readonly unknown[], all: readonly unknown[]): string {
  const rebuilt = reconstruct(branch, all);
  const rows = renderList(rebuilt.view, DEFAULT_CONFIG.maxPins).split("\n");
  return rows.find((line) => line.startsWith("#1 ")) ?? "";
}

/**
 * A reply survives a `/reload`, with its words, not just its mark.
 *
 * pi clears extension widgets on reload and the `session_start` handler redraws from the session; the rail
 * row cannot tell a surviving answer from a surviving mark, so the assertion is on the rebuilt view — the
 * object the panel, the listing and `/pins` are all drawn from.
 */
test("a reload rebuilds the reply text, not only the replied mark", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: ship it");

    await h.session.reload();
    await h.session.waitForIdle();

    const manager = h.session.sessionManager as unknown as {
      getBranch(): unknown[];
      getEntries(): unknown[];
    };
    const rebuilt = reconstruct(manager.getBranch(), manager.getEntries());
    expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
    expect(rebuilt.view.pins[0]?.reply).toBe("ship it");
    // And the rail still draws the answered pin, so the surface the user reads agrees with the view.
    expect(h.ui.renderWidget("pi-sticky", 80)[1]).toInclude("↩ Decide X");
  } finally {
    await h.dispose();
  }
});

/**
 * A reply entry that is not on the branch still answers the pin, words included.
 *
 * pi appends a custom entry at the leaf, and the reply handler writes mid-`prompt()` before the user's own
 * message is appended — so the turn's rebuild walked a branch holding the pin and not the answer. The
 * mid-turn branch is cut out here and handed to `reconstruct` as the branch it was, which is the only way to
 * observe the two readers disagreeing: a branch-only rebuild keeps the mark and drops the text.
 */
test("an off-branch reply entry still carries its words into the view", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: ship it");

    const manager = h.session.sessionManager as unknown as {
      getBranch(): unknown[];
      getEntries(): unknown[];
    };
    const all = manager.getEntries();
    const settled = manager.getBranch();
    const firstUserEntry = settled.findIndex(
      (entry) => (entry as { customType?: string }).customType === USER_TYPE,
    );
    expect(firstUserEntry).toBeGreaterThan(-1);
    const midTurn = settled.slice(0, firstUserEntry);
    expect(userPayloads(midTurn)).toEqual([]);

    // The rebuild that actually ran during the turn: the branch as it stood, all the entries as they were.
    expect(reconstruct(midTurn, all).view.pins[0]?.reply).toBe("ship it");
    expect(modelRow(midTurn, all)).toContain(
      `#1 [info] Decide X (replied by the user at ${LATER_TIME}: "ship it")`,
    );
    // …and the branch alone keeps the mark and loses the answer — the failure the second reader exists for.
    const branchOnly = reconstruct(midTurn, midTurn);
    expect(branchOnly.view.pins[0]?.reply).toBeUndefined();
    expect(branchOnly.view.pins[0]?.repliedAt).toBeUndefined();
  } finally {
    await h.dispose();
  }
});

/**
 * `navigateTree` onto a branch that does not hold the reply entry.
 *
 * The pin's own tool result follows the branch; the user's entry does not, and a branch move can land the
 * leaf above it. This is the shape the second reader is for, driven through pi's own tree navigation rather
 * than a stub: the entries of the session still hold the answer, and the branch the extension now walks does
 * not, so the row the model reads is the only place the two can be told apart.
 */
test("navigateTree to a branch without the entry keeps the answer the session recorded", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: ship it");

    // The turn that pinned the message: a leaf above the reply entry and above the pin's own result's
    // follow-up messages.
    const pinResult = h
      .branch()
      .find(
        (entry) =>
          entry.type === "message" &&
          (entry.message as { toolName?: string } | undefined)?.toolName === "pin_for_user",
      );
    expect(pinResult).toBeDefined();

    const moved = await h.session.navigateTree(pinResult?.id ?? "");
    expect(moved.cancelled).toBe(false);
    await h.session.waitForIdle();

    const manager = h.session.sessionManager as unknown as {
      getBranch(): unknown[];
      getEntries(): unknown[];
    };
    const branch = manager.getBranch();
    const all = manager.getEntries();
    // The answer is off the branch this navigation landed on, and still in the session. The uid is minted
    // per pin, so it is read back off the entry rather than hardcoded.
    expect(userPayloads(branch)).toEqual([]);
    const [recorded] = userPayloads(all) as { text?: string; action?: string }[];
    expect(recorded?.action).toBe("reply");
    expect(recorded?.text).toBe("ship it");

    const rebuilt = reconstruct(branch, all);
    expect(rebuilt.view.pins[0]?.reply).toBe("ship it");
    expect(modelRow(branch, all)).toInclude(`(replied by the user at ${LATER_TIME}: "ship it")`);
  } finally {
    await h.dispose();
  }
});

/**
 * A resumed process reads the answer out of the session file.
 *
 * The one claim an in-memory harness cannot make: the second process sees nothing but the persisted entries.
 * `resumeWithExtensions` is pi's own resume path (`reason: "resume"`), and the assertion is on the rebuild
 * the resumed extension drew its rail from — the view, not the widget.
 */
test("a resumed session rebuilds the reply text from the persisted entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sticky-reply-resume-"));
  try {
    const h = await pinned("Decide X");
    let kept: string;
    try {
      h.appendScript([reply("noted")]);
      await h.run("Re #1: ship it");
      // pi persists a message as its turn ends, so the copy has to wait for the idle.
      await h.session.waitForIdle();
      kept = join(dir, "session.jsonl");
      await copyFile(h.session.sessionFile ?? "", kept);
    } finally {
      await h.dispose();
    }

    const resumed = await resumeWithExtensions({
      path: kept,
      factories: [createStickyExtension(DEFAULT_CONFIG, () => LATER)],
    });
    try {
      const manager = resumed.session.sessionManager as unknown as {
        getBranch(): unknown[];
        getEntries(): unknown[];
      };
      const rebuilt = reconstruct(manager.getBranch(), manager.getEntries());
      expect(rebuilt.view.pins[0]?.text).toBe("Decide X");
      expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
      expect(rebuilt.view.pins[0]?.reply).toBe("ship it");
      // The rail the resumed extension drew agrees with the view it rebuilt from the file alone.
      expect(resumed.ui.renderWidget("pi-sticky", 80).join("\n")).toInclude("↩ Decide X");
    } finally {
      await resumed.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The post-compaction reminder carries the answer.
 *
 * After a compaction the reminder is the model's *only* account of the pins, and the transcript that held the
 * user's submission is gone — so this is the surface where a lost reply would actually cost something. The
 * script order is the one the frozen harness needs (issue #111 resolution 5): the pin call and the reply for
 * the pinning turn, the reply for the summary `session.compact()` consumes, and the reply for the turn after
 * the compaction — which is the turn that reads the answer back.
 */
/**
 * A harness whose compaction budget is small enough for a scripted run to have something to cut.
 *
 * `integration-reply-fixture.ts` owns the one-extension-instance rule these files reload by, but it does not
 * take the two token knobs, and `harness.ts` is a protected file: this is the same factory call with the
 * budget set, which is what `session.compact()` needs to do something rather than throw.
 */
function compactable() {
  return createHarness({
    factories: [createStickyExtension(DEFAULT_CONFIG, () => LATER)],
    keepRecentTokens: 1100,
    reserveTokens: 100,
  });
}

test("the post-compaction reminder names the answer the user gave", async () => {
  // A compaction needs a transcript the budget wants to cut, which is what these two knobs say: without them
  // `session.compact()` refuses with "session too small" and the run proves nothing.
  const h = await compactable();
  h.script([
    call("pin_for_user", { action: "pin", text: `Decide X ${"y".repeat(200)}` }),
    reply(`r1 ${PAD}`),
  ]);
  await h.run(`p1 ${PAD}`);
  try {
    // The reply for the pinning turn — the submission whose answer is being recorded.
    h.appendScript([reply(`r2 ${PAD}`)]);
    await h.run("Re #1: ship it");
    // One more padded turn, which is what the compaction budget has enough to cut.
    h.appendScript([reply(`r3 ${PAD}`)]);
    await h.run(`p3 ${PAD}`);

    // The reply for the summary `session.compact()` consumes, and the compaction itself.
    h.summarizeWith("COMPACTED SUMMARY");
    await h.session.compact();
    await h.session.waitForIdle();

    h.appendScript([reply("understood")]);
    await h.run("what did I say?");

    const manager = h.session.sessionManager as unknown as {
      getBranch(): unknown[];
      getEntries(): unknown[];
    };
    // The answer outlived the summarising: the entry is still there, and so is its text.
    const [recorded] = userPayloads(manager.getEntries()) as { text?: string }[];
    expect(recorded?.text).toBe("ship it");

    // The reminder the extension composes from that rebuild, and the listing inside it. The pin's text is
    // padded, so the row is matched on the part that matters rather than on the whole line.
    const rebuilt = reconstruct(manager.getBranch(), manager.getEntries());
    const reminder = reminderText(rebuilt.view, DEFAULT_CONFIG.maxPins);
    expect(reminder).toContain(`(replied by the user at ${LATER_TIME}: "ship it")`);
    // The reminder is handed to the model, not just built: read it back out of the request.
    const carried = JSON.stringify(h.requests.at(-1)?.messages ?? "");
    expect(carried).toInclude("Messages pinned for the user");
    expect(carried).toInclude(`(replied by the user at ${LATER_TIME}: \\"ship it\\")`);
  } finally {
    await h.dispose();
  }
});
