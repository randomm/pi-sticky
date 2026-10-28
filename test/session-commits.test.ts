/**
 * The ledger of commits the branch cannot be read for (`src/session-commits.ts`).
 *
 * pi appends a tool result only after `execute()` returns, so the live state runs ahead of the session for
 * one window, and two cells cover it: "a commit exists the branch does not hold" (which the rebuild reads
 * before it may trust the entries) and "the draw now running is the one that follows that commit" (the only
 * draw allowed to ask the auto-show question — which is why `autoShow` takes no flag and reads the second
 * cell itself).
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
  ledger.note();
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
  ledger.note();
  // The rebuild asks this between the commit and the draw, and must keep getting "do not trust the branch".
  expect(ledger.unseen()).toBe(true);
  ledger.autoShow(cell, view(pin(1, "warning")));
  // Still unseen after the auto-show — and this is the half that matters. pi has not appended the tool
  // result yet; only `turn_end` has, and `settleSession` rebuilds from the branch at that point. A ledger
  // that spent its commit here would tell that rebuild the branch was trustworthy, and it would re-read the
  // hide the auto-show had just undid and put the panel out of sight under a pin the user was reading.
  expect(ledger.unseen()).toBe(true);
  // What the draw *does* spend is the right to ask: a second draw of the same view is ordinary.
  ledger.autoShow(cell, view(pin(1, "warning")));
  expect(cell.mode()).toBe("open");
  ledger.clear();
  expect(ledger.unseen()).toBe(false);
});

test("an info pin leaves a hidden panel hidden (U11) and still answers the commit", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note();
  // The narrowing that supersedes U8's "any new pin": `info` is not something the user must act on, so a
  // chatty model cannot decide when the transcript gets covered. "No, these levels do not ask" is still an
  // answer, and the commit is spent by it.
  ledger.autoShow(cell, view(pin(1, "info")));
  expect(cell.mode()).toBe("hidden");
  // The answer was given, which is what the next draw cares about: the same view drawn again opens nothing.
  ledger.autoShow(cell, view(pin(1, "info")));
  expect(cell.mode()).toBe("hidden");
});

test("one draw answers one commit, so a later draw cannot re-open the panel", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note();
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("open");

  // The user leaves the panel (the earned open ends); the next draw of the same view is ordinary.
  cell.afterUnfocus();
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("hidden");
});

test("clear forgets both cells, which is what a session boundary is", () => {
  const ledger = createCommitLedger();
  const cell = hidden();
  ledger.note();
  ledger.clear();
  expect(ledger.unseen()).toBe(false);
  // The draw that had been marked as the tool's is ordinary again: a commit the boundary settled is not a
  // reason to open a panel for the branch the user has just moved to.
  ledger.autoShow(cell, view(pin(1, "action")));
  expect(cell.mode()).toBe("hidden");
});
