/**
 * The one thing a reply is only ever right about *session-wide*: the entry that records it is not on the
 * branch `reconstruct` walks, and the pin still reads as answered.
 *
 * pi appends a custom entry at the leaf and advances the leaf, and `getBranch()` is a pure walk from that
 * leaf — so an entry is on the branch only while nothing newer hangs beneath it. The reply handler writes
 * its entry mid-`prompt()`, and the turn's own messages land below it (pi has not appended the user's
 * submission yet when the handler runs), so every rebuild inside that turn walks a branch holding the
 * pin's tool result and not the reply. That window is the whole reason `reconstruct` has two readers — the
 * branch for agent state, all entries for the user's — and `repliedAt` alone could not show it: a
 * branch-only rebuild keeps the mark and loses the text, so only the row the model reads tells the two
 * readings apart.
 *
 * Split from `test/integration-reply.test.ts`, which drives the rest of the flow on one harness.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { renderList } from "../src/render.ts";
import { reconstruct } from "../src/state.ts";
import { USER_TYPE } from "../src/types.ts";
import { KEY } from "../src/types.ts";
import { RAIL_AGE } from "./fixtures-age.ts";
import { LATER, LATER_TIME, userAction, userEntry } from "./fixtures.ts";
import { pinEntry } from "./panel-lifecycle-fixture.ts";
import { RecordingUi } from "./recording-ui.ts";
import { stubApi } from "./wiring-stubs.ts";

/** The one `pi-sticky.user` entry of a branch, read the way `reconstruct` reads one. */
const isUserEntry = (entry: unknown): boolean =>
  (entry as { type?: string; customType?: string }).type === "custom" &&
  (entry as { customType?: string }).customType === USER_TYPE;
import { reply } from "./harness.ts";
import { pinned } from "./integration-reply-fixture.ts";
import { rows, uidOf } from "./integration-support.ts";

test("the reply entry sits off the branch the rebuild walks, and the reply still answers the pin", async () => {
  const h = await pinned("Decide X");
  try {
    h.appendScript([reply("noted")]);
    await h.run("Re #1: yes");

    const manager = h.session.sessionManager as unknown as {
      getBranch(): unknown[];
      getEntries(): { type: string; customType?: string; data?: unknown }[];
    };
    const recorded = manager
      .getEntries()
      .filter((entry) => entry.type === "custom" && entry.customType === USER_TYPE);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.data).toEqual({
      v: 1,
      uid: uidOf(h, 1),
      action: "reply",
      at: LATER,
      text: "yes",
    });

    // The branch as the turn's rebuild walked it: everything up to the reply entry, which is where the leaf
    // stood while the turn ran. The pin is on it, the reply is not.
    const settled = manager.getBranch();
    const midTurn = settled.slice(0, settled.findIndex(isUserEntry));
    expect(
      midTurn.some((entry) => (entry as { customType?: string }).customType === USER_TYPE),
    ).toBe(false);
    // The rail was drawn from the rebuild that read both readers, so the mark on screen is the same fact.
    expect(rows(h)[1]).toInclude("↩ Decide X");

    // The listing the model reads names the answer, taken from that entry and not from the snapshot.
    const rebuilt = reconstruct(midTurn, manager.getEntries());
    expect(rebuilt.view.pins[0]?.reply).toBe("yes");
    expect(renderList(rebuilt.view, DEFAULT_CONFIG.maxPins)).toInclude(
      `#1 [info] Decide X (replied by the user at ${LATER_TIME}: "yes")`,
    );
    // …and the branch alone draws the pin unanswered: the reply is nowhere in the snapshot, so a rebuild that
    // read `getBranch()` only loses the answer — the failure the second reader exists to prevent.
    const branchOnly = reconstruct(midTurn, midTurn);
    expect(branchOnly.view.pins[0]?.reply).toBeUndefined();
    expect(renderList(branchOnly.view, DEFAULT_CONFIG.maxPins)).not.toInclude(
      "replied by the user",
    );
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
  expect(recorder.renderWidget(KEY, 80)[1]).toBe(` • #1 ${RAIL_AGE}  ↩ Decide X`);
});
