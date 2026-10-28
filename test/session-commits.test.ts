/**
 * The ledger of commits the branch cannot be read for (`src/session-commits.ts`).
 *
 * pi appends a tool result only after `execute()` returns, so the live state runs ahead of the session for
 * one window, and three cells cover it: "a commit exists the branch does not hold" (which the rebuild reads
 * before it may trust the entries), "which pins that commit touched" (which is what the level test is asked
 * of — a count cannot answer it, because an `update` changes a pin without adding one) and "the draw now
 * running is the one that follows that commit" (the only draw allowed to ask the auto-show question — which
 * is why `autoShow` takes no flag and reads that cell itself).
 *
 * The regression these tests pin is the one `extension.ts` could not see from the inside: an *ordinary* draw
 * — a command's listing, the minute's tick, a resize — reaching the auto-show, which both opened a panel the
 * user had not been shown a reason for and spent the commit, leaving the next `turn_end` rebuild to trust a
 * branch that did not hold the pin and re-read the hide the auto-show had just undid.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createPanelMode } from "../src/panel-mode.ts";
import type { PanelModeState } from "../src/panel-mode.ts";
import { createCommitLedger } from "../src/session-commits.ts";
import type { PinView, ViewPin } from "../src/types.ts";

const pin = (id: number, level: ViewPin["level"]): ViewPin => ({
  id,
  uid: `u${id}`,
  text: `pin ${id}`,
  level,
  source: "agent",
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
});

const view = (...pins: ViewPin[]): PinView => ({ pins, removed: [] });

/** The cell of a session the user has hidden, so an auto-show has something to undo. */
const hidden = (): PanelModeState => {
  const cell = createPanelMode({ ...DEFAULT_CONFIG, panel: "peek" });
  cell.settle(false);
  return cell;
};

test("the tool's own draw opens the panel for a pin that asks, and answers the commit", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note([1], [pin(1, "action")]);
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("open");
  expect(cell.recorded()).toBe(false);
});

test("an ordinary draw opens nothing, because no commit is waiting for it", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  // No `note()`: this is a command's listing, a tick, a resize. The auto-show question is not its to ask.
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("hidden");
  expect(ledger.unseen()).toBe(false);
});

test("the commit stays unseen until a boundary settles it, not until the draw has asked", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note([1], [pin(1, "warning")]);
  // The rebuild asks this between the commit and the draw, and must keep getting "do not trust the branch".
  expect(ledger.unseen()).toBe(true);
  ledger.autoShow(cell, view(pin(1, "warning")));
  // Still unseen after the auto-show — and this is the half that matters. pi has not appended the tool
  // result yet; only `turn_end` has, and `settleSession` rebuilds from the branch at that point. A ledger
  // that spent its commit here would tell that rebuild the branch was trustworthy, and it would re-read the
  // hide the auto-show had just undid and put the panel out of sight under a pin the user was reading.
  expect(ledger.unseen()).toBe(true);
  // The claim on the screen is recorded from the showing, and is what keeps a *trusted* rebuild from
  // settling the panel back over a pin the user is reading (see `session-rebuild.test.ts`).
  expect(ledger.autoShowPending()).toBe(true);
  // What the draw does *not* spend is the commit: `landed()` is the only writer of that bit, and a rebuild
  // which has not read the published pins off the branch has not earned the right to clear it. The claim
  // outlives it for the same reason — it is settled by a rebuild which was *handed* the branch, and this one
  // was not, so a second draw of the same view changes neither.
  ledger.autoShow(cell, view(pin(1, "warning")));
  expect(ledger.unseen()).toBe(true);
  expect(ledger.autoShowPending()).toBe(true);
  ledger.sighted();
  expect(ledger.autoShowPending()).toBe(false);
  ledger.landed();
  expect(ledger.unseen()).toBe(false);
  ledger.clear();
  expect(ledger.unseen()).toBe(false);
  expect(ledger.autoShowPending()).toBe(false);
});

test("a commit which showed nothing claims nothing", () => {
  // The other half of recording the claim from the *outcome*: a commit whose pins did not earn an open left
  // nothing on the screen for the entries to be wrong about, so a rebuild handed the branch must be free to
  // settle the panel straight away. A claim written at `note()` instead would have every later rebuild ignore
  // a recorded hide the user wrote and nothing ever undid.
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note([2], [pin(2, "info")]);
  ledger.autoShow(cell, view(pin(2, "info")));
  expect(cell.mode()).toBe("hidden");
  expect(ledger.autoShowPending()).toBe(false);
  ledger.clear();
  expect(ledger.unseen()).toBe(false);
  expect(ledger.autoShowPending()).toBe(false);
});

test("an info pin leaves a hidden panel hidden (U11) and still answers the commit", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note(undefined, [pin(1, "info")]);
  // The narrowing that supersedes U8's "any new pin": `info` is not something the user must act on, so a
  // chatty model cannot decide when the transcript gets covered. "No, these levels do not ask" is still an
  // answer, and the commit is spent by it.
  ledger.autoShow(cell, view(pin(1, "info")));
  expect(cell.mode()).toBe("hidden");
  // The answer was given, which is what the next draw cares about: the same view drawn again opens nothing.
  ledger.autoShow(cell, view(pin(1, "info")));
  expect(cell.mode()).toBe("hidden");
});

test("one commit answers the draws of its own window, and no later one", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note([1], [pin(1, "action")]);
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("open");

  // The user leaves the panel (the earned open ends) and the *same* commit is still the one the branch does
  // not hold — pi has not written the result yet. A draw of that window is still the commit's own: the rail
  // reconsidering, the minute ticking or the frame being resized must not cost the user the auto-show the
  // commit earned, and a draw which re-opened the panel here would be a second showing of one commit.
  cell.afterUnfocus();
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("open");

  // What ends the entitlement is the branch, not a draw: once a rebuild has read the pins off it (`landed`),
  // the commit is over and every later draw of the same view is an ordinary one — a command's listing, a
  // tick, a resize — which draws what the cell says and asks nothing of the panel.
  ledger.landed();
  cell.afterUnfocus();
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("hidden");
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("hidden");
});

test("an update of an existing pin is a commit, and reaches the level test (issue #40)", () => {
  // The case a length comparison dropped: `updateOp` returns the same number of pins, so nothing about the
  // commit says "new" — and yet the pin it became is a warning the user has to act on. The ids the commit
  // touched are what carry that, and one of them is old.
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note([4], [pin(9, "info"), pin(4, "warning")]);
  ledger.autoShow(cell, view(pin(9, "info"), pin(4, "warning")));
  expect(cell.mode()).toBe("open");
});

test("clear forgets both cells, which is what a session boundary is", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note([1], [pin(1, "action")]);
  ledger.clear();
  expect(ledger.unseen()).toBe(false);
  // The draw that had been marked as the tool's is ordinary again: a commit the boundary settled is not a
  // reason to open a panel for the branch the user has just moved to.
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("hidden");
});
