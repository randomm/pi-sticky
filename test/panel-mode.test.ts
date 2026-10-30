/**
 * The panel's three-state cell: hidden / peek / open, and the three facts behind the one read.
 *
 * `mode()` is the only read and `settle`/`autoOpen`/`endEarnedOpen` the only writes
 * (`src/panel-mode.ts`), so the whole of the cell's contract is a sequence of those five calls and the mode
 * each leaves. What is *not* obvious from any single transition is why there are three cells behind one
 * read — `chosen` (what the user's verbs said), `shown` (what is on screen) and `earned` (whether a pin put
 * it there) — and each test below names the failure the split exists to prevent, since folding any two of
 * the three together passes every assertion but one:
 *
 * - fold `chosen` into `shown` and the focus key's own demote hides a panel the user had shown;
 * - fold `earned` into `shown` and the user's own `/pins hide` cannot survive the peek it caused;
 * - drop `recorded` and one transient auto-open teaches the cell that the user asked for a shown panel, so
 *   every later rebuild re-shows a panel the user closed.
 *
 * The third cell also answers *who* earned the open — `autoOpen("autoshow")` is the model's, `autoOpen("focus")`
 * the user's focus key — and the two end differently, so every case below says which one it opened with:
 * the auto-show's ending goes to the resting mode (the peek) whatever the user had chosen, and the focus
 * key's goes back to `chosen`. `test/panel-lifecycle-autoshow.test.ts` and its `_earned` sibling are the
 * same rule at the surface.
 *
 * The resting mode comes from the config (`PI_STICKY_PANEL`), so each test says which one it is written for.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createPanelMode } from "../src/panel-mode.ts";
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
  cell.autoOpen("autoshow");
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
  cell.autoOpen("autoshow");
  cell.endEarnedOpen();
  // "Never peek" is what `PI_STICKY_PANEL=open` means, and a demote that put the panel into the state the
  // operator refused is the bug this assertion is about.
  expect(cell.mode()).toBe("open");
  expect(cell.shown()).toBe(true);
});

test("an auto-show moves the screen and records nothing, so the user's hide survives it", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(false);
  expect(cell.recorded()).toBe(false);

  cell.autoOpen("autoshow");
  expect(cell.mode()).toBe("open");
  expect(cell.shown()).toBe(true);
  // The half that makes U8's "records nothing" a property of the cell rather than of the caller: the
  // auto-show has no path to the record, so there is no flag for it to get wrong.
  expect(cell.recorded()).toBe(false);
});

test("leaving an auto-show's open ends it in the peek, not in the hide it overrode", () => {
  // The operator's decision this change is about: a panel the model pulled out of hiding to deliver a
  // blocker stays on screen as a peek once the user has read it, because a `/pins hide` holds only until the
  // next auto-show. The *record* still says hidden, which is the half the next test pins.
  const cell = createPanelMode(resting("peek"));
  cell.settle(false);
  cell.autoOpen("autoshow");
  cell.endEarnedOpen();
  expect(cell.mode()).toBe("peek");
  expect(cell.shown()).toBe(true);
});

test("an auto-show's peek ending records nothing, so the user's hide can still be honoured", () => {
  // The consequence of the case above for the persistence contract: the panel is drawn and the session still
  // says hidden. Were the peek ending to move the record, the user's hide would be silently overwritten by a
  // pin they never asked to keep on screen — and `settle(false)` below is the verb that has to still be able
  // to put it away.
  const cell = createPanelMode(resting("peek"));
  cell.settle(false);
  cell.autoOpen("autoshow");
  cell.endEarnedOpen();
  expect(cell.recorded()).toBe(false);
  cell.settle(false);
  expect(cell.mode()).toBe("hidden");
  expect(cell.recorded()).toBe(false);
});

test("leaving an open the user's own focus key earned restores what they chose", () => {
  // The other provenance, and the reason `autoOpen` takes a kind rather than both verbs sharing one ending:
  // the user pulled the panel over their transcript from a hidden state, and Esc must put it back hidden.
  const cell = createPanelMode(resting("peek"));
  cell.settle(false);
  cell.autoOpen("focus");
  cell.endEarnedOpen();
  expect(cell.mode()).toBe("hidden");
  expect(cell.shown()).toBe(false);
});

test("leaving a panel the user showed leaves it shown, in its resting frame", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(true);
  // The model earned the open on a panel the user had shown: leaving it must neither hide a panel they had
  // shown nor leave them looking at the full frame they never asked to keep.
  cell.autoOpen("autoshow");
  cell.endEarnedOpen();
  expect(cell.mode()).toBe("peek");
  expect(cell.shown()).toBe(true);
});

test("leaving a focus-key open on a panel the user had shown leaves the frame the key opened", () => {
  // The focus key's own provenance, and the half of the operator's decision that keeps the *open*: the user
  // reached for the panel while it was shown to them, so `Esc` hands the keyboard back and leaves the frame
  // they are reading. It is the contrast with the case above that `EarnedKind` exists to draw.
  const cell = createPanelMode(resting("peek"));
  cell.settle(true);
  cell.autoOpen("focus");
  cell.endEarnedOpen();
  expect(cell.mode()).toBe("open");
  expect(cell.shown()).toBe(true);
});

test("an auto-show on a panel the user had shown earns an open and returns to the peek", () => {
  const cell = createPanelMode(resting("peek"));
  cell.autoOpen("autoshow");
  expect(cell.mode()).toBe("open");
  cell.endEarnedOpen();
  expect(cell.mode()).toBe("peek");
});

test("under PI_STICKY_PANEL=open an auto-show's ending is the full frame, not a peek", () => {
  // The same rule as the peek case above, read through the operator's other resting mode: the auto-show's
  // ending is the *resting* mode, and the operator refused the peek, so there is nowhere lower to go.
  const cell = createPanelMode(resting("open"));
  cell.settle(false);
  cell.autoOpen("autoshow");
  cell.endEarnedOpen();
  expect(cell.mode()).toBe("open");
  expect(cell.shown()).toBe(true);
  expect(cell.recorded()).toBe(false);
});

test("a second unfocus does not hide a panel the user had shown", () => {
  const cell = createPanelMode(resting("peek"));
  cell.settle(true);
  cell.autoOpen("autoshow");
  cell.endEarnedOpen();
  cell.endEarnedOpen();
  expect(cell.shown()).toBe(true);
});

test("the write a session boundary makes forgets the transience and keeps the operator's resting mode", () => {
  const cell = createPanelMode(resting("open"));
  cell.settle(false);
  cell.forgetEarnedOpen();
  // A session boundary is not the user's next interaction: the earned open is over, and the record the new
  // session's entries will settle has not been read yet — but the resting mode is the operator's, so it
  // survives.
  expect(cell.mode()).toBe("hidden");
  cell.settle(true);
  expect(cell.mode()).toBe("open");
});

test("a boundary forgets a focus-key open over a shown panel, which the interactive ending keeps", () => {
  // The pair the two endings exist for, in one cell: the *same* state — the user's own focus key over a panel
  // they had shown — ends in the full frame when the user leaves it and in nothing at all when the session
  // goes. A boundary that kept the open would hand the next session a full overlay and a held keyboard, which
  // is the TUI mode panel.ts says the user cannot otherwise enter.
  const cell = createPanelMode(resting("peek"));
  cell.settle(true);
  cell.autoOpen("focus");
  cell.forgetEarnedOpen();
  expect(cell.mode()).toBe("hidden");
  expect(cell.shown()).toBe(false);
  // …and it reads no provenance, so the model's auto-show is forgotten the same way.
  cell.settle(true);
  cell.autoOpen("autoshow");
  cell.forgetEarnedOpen();
  expect(cell.mode()).toBe("hidden");
});
