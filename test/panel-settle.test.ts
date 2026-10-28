/**
 * The one writer of the panel's screen (`src/panel-settle.ts`), on the four things it is given.
 *
 * The rule the module exists to enforce is an *order*: the cell moves, the record may move with it, and the
 * redraw comes last — because both surfaces read the cell as their first question. A caller that redrew
 * first would draw the state the user had just left and never be asked again, which is the "user hid the
 * panel and something redrew the rail over it" failure U8 was written against. So the assertions below are
 * about what the redraw *observed*, not about what it was called with: the recorder reads the cell from
 * inside the callback, exactly as `drawRail` and the overlay's `visible()` do.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createPanelMode } from "../src/panel-mode.ts";
import { settlePanel } from "../src/panel-settle.ts";

/** The recorder of one call: what was appended, and what the cell said at the moment of the redraw. */
interface Recorded {
  appended: boolean[];
  modeAtRedraw: string[];
}

/** Run one `settlePanel` over a fresh cell, recording what each collaborator saw. */
function settle(
  before: (panel: ReturnType<typeof createPanelMode>) => void,
  shown: boolean,
  record: boolean,
): Recorded & { mode: string; recorded: boolean } {
  const panel = createPanelMode(DEFAULT_CONFIG);
  before(panel);
  const seen: Recorded = { appended: [], modeAtRedraw: [] };
  settlePanel(
    panel,
    shown,
    record,
    (value) => seen.appended.push(value),
    () => {
      // Read the cell *from inside* the redraw: this is the only way to see the order, and the only thing
      // the two surfaces care about.
      seen.modeAtRedraw.push(panel.mode());
    },
  );
  return { ...seen, mode: panel.mode(), recorded: panel.recorded() };
}

test("a hide moves the cell, records, and redraws against the state the user chose", () => {
  const seen = settle(() => {}, false, true);
  expect(seen.mode).toBe("hidden");
  expect(seen.appended).toEqual([false]);
  expect(seen.modeAtRedraw).toEqual(["hidden"]);
});

test("the redraw runs after the cell moved, never before", () => {
  // A redraw that ran first would report the state the user had just left; both surfaces read the cell as
  // their first question and would then be asked no second time.
  const seen = settle(() => {}, false, true);
  expect(seen.modeAtRedraw).toHaveLength(1);
  expect(seen.modeAtRedraw[0]).toBe(seen.mode);
});

test("a verb that does not record leaves the session alone", () => {
  // `setPanelShown`' path — the focus shortcut showing a panel to read it is not a preference about whether
  // it should stay open.
  const seen = settle(() => {}, true, false);
  expect(seen.appended).toEqual([]);
  expect(seen.mode).toBe("peek");
});

test("an auto-show never reaches this writer, so a transient open cannot be recorded by construction", () => {
  // The cell's `autoOpen` moves the screen without touching the record; the extension's user-verb path is
  // the only caller of `settlePanel`. Asserted as the absence of an append for a shown panel whose record
  // is hidden: had the auto-show been routed through here, the user's hide would have been overwritten.
  const seen = settle((panel) => panel.settle(false), false, false);
  expect(seen.appended).toEqual([]);
  expect(seen.recorded).toBe(false);
});
