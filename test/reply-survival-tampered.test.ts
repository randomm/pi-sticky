/**
 * A reply entry that a hand-edit broke, seen through the real extension.
 *
 * The ruling of AC3 end-to-end: **one malformed word never costs the replied mark**. The entry is handed to
 * `createStickyExtension`'s own `session_start` handler, so nothing here reimplements the rebuild — the rail
 * row below is one the extension drew itself.
 *
 * The session-lifetime half of the same field is `test/reply-survival.test.ts`; the guard cases are
 * `test/state-guards-reply.test.ts`.
 */
import { expect, test } from "bun:test";

import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { reconstruct } from "../src/state.ts";
import { RAIL_AGE } from "./fixtures-age.ts";
import { LATER } from "./fixtures.ts";
import { pinEntry } from "./panel-lifecycle-fixture.ts";
import { RecordingUi } from "./recording-ui.ts";
import { replyEntryWithText } from "./reply-entry-fixture.ts";
import { stubApi } from "./wiring-stubs.ts";

test("a tampered reply entry keeps the mark and drops only the words", () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);

  const branch = [pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X" }])];
  const entries = [
    ...branch,
    // The over-long entry a session file can hold and no writer can produce, followed by a good reply. PM
    // ruling 3 of issue #111: the broken entry is read as a reply with **no text** — it is not refused, and
    // the words it cannot carry do not take the mark or the later answer with them.
    replyEntryWithText("aaaa1111", LATER, "x".repeat(1601)),
    replyEntryWithText("aaaa1111", LATER, "ship it"),
  ];
  const recorder = new RecordingUi();
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: recorder,
    sessionManager: { getBranch: () => branch, getEntries: () => entries },
  };

  stub.emit("session_start", { reason: "startup" }, ctx);

  const rebuilt = reconstruct(branch, entries);
  expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  expect(rebuilt.view.pins[0]?.reply).toBe("ship it");
  expect(recorder.renderWidget("pi-sticky", 80)[1]).toBe(` • #1 ${RAIL_AGE}  ↩ Decide X`);
});

test("a tampered entry alone still marks the pin, in the extension's own rebuild", () => {
  // The half the pair above cannot show: with no good reply behind it, the over-long entry is the only claim
  // on the branch, and the mark is all it is allowed to lose. Drawn through the extension rather than
  // `reconstruct` alone, because the rail row is the surface that must still say the user answered.
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);

  const branch = [pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X" }])];
  const c25 = `\u{1F468}${"\u{1F3FB}".repeat(11)}\uFE0F`; // one grapheme, 25 units
  const entries = [...branch, replyEntryWithText("aaaa1111", LATER, c25.repeat(70))];
  const recorder = new RecordingUi();
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: recorder,
    sessionManager: { getBranch: () => branch, getEntries: () => entries },
  };

  stub.emit("session_start", { reason: "startup" }, ctx);

  const rebuilt = reconstruct(branch, entries);
  expect(rebuilt.view.pins[0]?.repliedAt).toBe(LATER);
  expect(rebuilt.view.pins[0]?.reply).toBeUndefined();
  // The mark without the quote: the row says the user answered and quotes nothing they did not say.
  expect(recorder.renderWidget("pi-sticky", 80)[1]).toBe(` • #1 ${RAIL_AGE}  ↩ Decide X`);
});
