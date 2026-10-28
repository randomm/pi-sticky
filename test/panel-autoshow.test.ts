/**
 * The narrowed auto-show, read at the seam that decides it (`src/panel-autoshow.ts`).
 *
 * The ledger tests drive the same rule one layer up; these ask the predicate itself, because the two cases
 * below are the acceptance criterion of issue #40 — "a **new or updated** action or warning pin opens the
 * panel fully, even from hidden" — and both were invisible from a view alone:
 *
 * 1. an `update` that promotes a pin which already existed to `action`/`warning`, and
 * 2. a commit whose pin is nowhere near the front of the *drawn* order (the level-gate used to sample the
 *    best-ranked pin of the whole view rather than the pins the commit touched, so a view led by an unreplied
 *    `info` pin answered the question with the pin the commit never touched).
 *
 * The argument is therefore the ids the reducer reported as affected, and the view is only where their levels
 * are read.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { autoShowForCommits } from "../src/panel-autoshow.ts";
import { createPanelMode } from "../src/panel-mode.ts";
import type { PanelModeState } from "../src/panel-mode.ts";
import type { ViewPin } from "../src/types.ts";

const pin = (id: number, level: ViewPin["level"], replied = false): ViewPin => ({
  id,
  uid: `u${id}`,
  text: `pin ${id}`,
  level,
  source: "agent",
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
  ...(replied ? { repliedAt: "2026-10-23T12:30:00.000Z" } : {}),
});

/** The cell of a session the user has hidden, so an auto-show has something to undo. */
const hidden = (): PanelModeState => {
  const cell = createPanelMode({ ...DEFAULT_CONFIG, panel: "peek" });
  cell.settle(false);
  return cell;
};

test("an action pin among the affected opens a hidden panel, and records nothing", () => {
  const cell = hidden();
  expect(autoShowForCommits(cell, [pin(1, "action")], [1])).toBe(true);
  expect(cell.mode()).toBe("open");
  expect(cell.recorded()).toBe(false);
});

test("a commit that touched no pin opens nothing", () => {
  // A `list`, or a commit the reducer reported as affecting nothing: the user has not been shown a reason.
  const cell = hidden();
  expect(autoShowForCommits(cell, [pin(1, "warning")], [])).toBe(false);
  expect(cell.mode()).toBe("hidden");
});

test("an empty affected list means no commit, whatever the view holds", () => {
  // An empty list is the answer the reducer gives for a commit that touched nothing: read as "nothing was
  // touched", which is the answer that leaves the panel alone rather than the one that covers the transcript.
  const cell = hidden();
  expect(autoShowForCommits(cell, [pin(1, "warning")], [])).toBe(false);
  expect(cell.mode()).toBe("hidden");
});

test("an info pin among the affected leaves a hidden panel hidden (U11)", () => {
  const cell = hidden();
  expect(autoShowForCommits(cell, [pin(1, "info")], [1])).toBe(false);
  expect(cell.mode()).toBe("hidden");
});

test("an update that promotes an existing pin to warning opens the panel (issue #40)", () => {
  // The id is old — an `update` keeps the id it was given — so any rule that looked at "the newest pin"
  // misses this commit entirely. The level of the pin it *became* is what asks for the panel.
  const cell = hidden();
  expect(autoShowForCommits(cell, [pin(4, "warning")], [4])).toBe(true);
  expect(cell.mode()).toBe("open");
});

test("the gate reads the affected pins, not the best-ranked pin of the view", () => {
  // The drawn order leads with the unreplied info pin, so sampling the view would have answered this
  // commit with #9 and never looked at #4 — the pin the commit actually touched.
  const view = [pin(9, "info"), pin(4, "action")];
  const cell = hidden();
  expect(autoShowForCommits(cell, view, [4])).toBe(true);
  expect(cell.mode()).toBe("open");
});

test("a well-ranked info pin cannot carry the panel open for a warning the commit did not touch", () => {
  // The other direction of the same rule: #4 is the warning and the first of the drawn order, but the
  // commit answered for #9 only, and #9 is a fact the rail already draws.
  const view = [pin(4, "warning"), pin(9, "info")];
  const cell = hidden();
  expect(autoShowForCommits(cell, view, [9])).toBe(false);
  expect(cell.mode()).toBe("hidden");
});

test("an id the view no longer holds is skipped rather than thrown on", () => {
  // A commit can name a pin a later removal in the same turn has taken out of the view; the question the
  // gate asks is about the pins it can still see.
  const cell = hidden();
  expect(autoShowForCommits(cell, [pin(1, "info")], [7, 1])).toBe(false);
  expect(cell.mode()).toBe("hidden");
});
