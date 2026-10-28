/**
 * The panel's three-state cell: hidden / peek / open, and the three facts behind the one read.
 *
 * `mode()` is the only read and `settle`/`autoOpen`/`afterUnfocus`/`reset` the only writes
 * (`src/panel-mode.ts`), so the whole of the cell's contract is a sequence of those five calls and the mode
 * each leaves. What is *not* obvious from any single transition is why there are three cells behind one
 * read — `chosen` (what the user's verbs said), `shown` (what is on screen) and `earned` (whether a pin put
 * it there) — and each test below names the failure the split exists to prevent, since folding any two of
 * the three together passes every assertion but one:
 *
 * - fold `chosen` into `shown` and a demote hides a panel the user had shown;
 * - fold `earned` into `shown` and the user's own `/pins hide` cannot survive the peek it caused;
 * - drop `recorded` and one transient auto-open teaches the cell that the user asked for a shown panel, so
 *   every later rebuild re-shows a panel the user closed.
 *
 * The resting mode comes from the config (`PI_STICKY_PANEL`), so each test says which one it is written for.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createPanelMode, panelOpensPins } from "../src/panel-mode.ts";
import type { StickyConfig } from "../src/types.ts";

/** The config of one resting mode — the only config member the cell reads. */
const resting = (panel: StickyConfig["panel"]): StickyConfig => ({
  ...DEFAULT_CONFIG,
  panel,
});

test("a shown panel with nothing earned rests in the configured mode", () => {
  const peek = createPanelMode(resting("peek"));
  expect(peek.mode()).toBe("peek");
  expect(peek.shown()).toBe(true);

  const open = createPanelMode(resting("open"));
  expect(open.mode()).toBe("open");
});

test("settle moves the screen and the record together, and ends an earned open", () => {
  const cell = createPanelMode(resting("peek"));
  cell.autoOpen();
  expect(cell.mode()).toBe("open");

  cell.settle(false);
  expect(cell.mode()).toBe("hidden");
  expect(cell.shown()).toBe(false);
  expect(cell.recorded()).toBe(false);

  // Back to the resting frame, not to a bare "shown": the operator's `open` is not something a demote
  // restores into a peek.
  cell.settle(true);
  expect(cell.mode()).toBe("peek");
  expect(cell.recorded()).toBe(true);
});

test("an operator who configured open never sees a peek, not even after a demote", () => {
  const cell = createPanelMode(resting("open"));
  cell.autoOpen();
  cell.afterUnfocus();
  // "Never peek" is what `PI_STICKY_PANEL=open` means, and a demote that put the panel into the state the
  // operator refused is the bug this assertion is about.
  expect(cell.mode()).toBe("open");
  expect(cell.shown()).toBe(true);
});

test("an auto-show moves the screen and records nothing, so the user's hide survives it", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(false);
  expect(cell.recorded()).toBe(false);

  cell.autoOpen();
  expect(cell.mode()).toBe("open");
  expect(cell.shown()).toBe(true);
  // The half that makes U8's "records nothing" a property of the cell rather than of the caller: the
  // auto-show has no path to the record, so there is no flag for it to get wrong.
  expect(cell.recorded()).toBe(false);
});

test("leaving a panel ends the open the user did not ask for and restores what they chose", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(false);
  cell.autoOpen();
  cell.afterUnfocus();
  expect(cell.mode()).toBe("hidden");
  expect(cell.shown()).toBe(false);
});

test("leaving a panel the user showed leaves it shown, in its resting frame", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(true);
  // The user opened it themselves: an earned open they then left must not hide a panel they had shown.
  cell.autoOpen();
  cell.afterUnfocus();
  expect(cell.mode()).toBe("peek");
  expect(cell.shown()).toBe(true);
});

test("an auto-show on a panel the user had shown earns an open and returns to the peek", () => {
  const cell = createPanelMode(resting("peek"));
  cell.autoOpen();
  expect(cell.mode()).toBe("open");
  cell.afterUnfocus();
  expect(cell.mode()).toBe("peek");
});

test("a second unfocus does not hide a panel the user had shown", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(true);
  cell.autoOpen();
  cell.afterUnfocus();
  cell.afterUnfocus();
  expect(cell.shown()).toBe(true);
});

test("reset forgets the session's transience and keeps the operator's resting mode", () => {
  const cell = createPanelMode(resting("open"));
  cell.settle(false);
  cell.autoOpen();
  cell.reset();
  // A session boundary is not the user's next interaction: the earned open is over, and the record the new
  // session's entries will settle has not been read yet — but the resting mode is the operator's, so it
  // survives.
  expect(cell.mode()).toBe("hidden");
  cell.settle(true);
  expect(cell.mode()).toBe("open");
});

test("panelOpensPins is true for everything but hidden", () => {
  // The rail's handoff question, spelled once: a peek stands the rail down exactly as an open does, or the
  // same pin is drawn on two surfaces.
  expect(panelOpensPins("hidden")).toBe(false);
  expect(panelOpensPins("peek")).toBe(true);
  expect(panelOpensPins("open")).toBe(true);
});
