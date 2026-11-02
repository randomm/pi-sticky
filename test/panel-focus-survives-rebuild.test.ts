/**
 * Keyboard focus never outlives the panel's visibility, on a booted extension (issue #84).
 *
 * The report was a panel whose arrows stopped moving. Two separate gaps wore that one symptom, and both are
 * invisible to an assertion that reads the component's own flag:
 *
 * 1. **The rebuild took the frame from under a focused panel.** `focusFromShortcut` opens transiently through
 *    `autoOpen("focus")` and records nothing, so at `turn_end` `rebuildSession` re-applied the user's recorded
 *    `shown: false` and hid the panel the user had just focused — and pi-tui's handle `focus()`
 *    (`tui.js:430-435`) is a silent no-op on an overlay its own `visible()` refuses, so the frame came back
 *    and the keys never did. The rebuild's own gate is the fix: an open the *focus key* earned outranks the
 *    entries the way the commit ledger's auto-show claim already does, because the focus key appends nothing
 *    and touches no commit. `test/session-rebuild.test.ts` pins that gate at the cell — narrowing it to
 *    `"autoshow"` must turn that case red.
 * 2. **Nothing ever released the keyboard.** When the turn ending hid the panel over a focused component —
 *    the user's recorded hide re-applied, or the last pin dismissed out from under the frame — the component
 *    stayed focused and the handle stayed held, so the editor answered no keys and neither did the panel.
 *
 * So every stop asserts the *pair* — the component's flag and the handle — rather than the mode alone, and the
 * handle here is the honest one: it grants focus only while the overlay's installed `visible()` answers true,
 * the way pi-tui's does. A handle that merely recorded the asking reported a keyboard pi had thrown away,
 * which is precisely the state these two bugs left behind.
 *
 * Driven through the booted extension (`panel-lifecycle-fixture.ts`), so the overlay, the handle and the rail
 * are all the extension's own. The endings themselves are `panel-lifecycle-autoshow-*.test.ts`; the rebuild's
 * two ledger questions are `session-rebuild.test.ts`.
 */
import { expect, test } from "bun:test";

import type { PanelComponent } from "../src/panel-component.ts";
import { FOCUS_KEY } from "../src/panel-keys.ts";
import { KEY } from "../src/types.ts";
import { withHandle } from "./panel-handle.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";
import { boot, pinEntry, uiEntry } from "./panel-lifecycle-fixture.ts";
import { toolOf } from "./panel-lifecycle-autoshow-fixture.ts";

/** The keystroke whose death the report was about, as pi-tui hands it. */
const DOWN = "\x1b[B";

/** Two `action` pins the model pinned — one with options, so `d` dismisses. */
const TWO: readonly unknown[] = [
  pinEntry([
    { id: 1, uid: "aaaa1111", text: "Decide the provider", options: ["yes", "no"] },
    { id: 2, uid: "bbbb2222", text: "Watch the migration" },
  ]),
];

/** The same two pins with the user's hide last in the record — what a reload boots into. */
const HIDDEN_TWO = [...TWO, uiEntry(false)];

/** The focused panel plus the handle this file reads. */
type Driven = Booted & { c: PanelComponent; held: () => boolean; visible(): boolean };

/** What the user is left with when focus has outlived the panel: a keyboard routed to nothing. */
function stranded(s: Driven): void {
  expect([s.c.isFocused(), s.held()]).toEqual([false, false]);
}

/** Pin `text` through the tool as the model does. */
async function pin(s: Driven, id: string, text: string): Promise<void> {
  await toolOf(s.stub).execute(
    id,
    { action: "pin", text, level: "action" },
    undefined,
    undefined,
    s.ctx,
  );
}

/**
 * A panel the user has focused over their own recorded hide, holding three `action` pins — the state the
 * report was filed against. The pins arrive **through the tool**, the one path that leaves the commit ledger
 * with an outstanding commit, which is what makes the recorded `shown: false` a live bug: the boundary that
 * follows has a hide to re-apply and, before the fix, nothing in the cell it would not settle against.
 */
async function focusedOverARecordedHide(columns = 120): Promise<Driven> {
  const s = await withHandle(await boot(TWO, columns));
  await pin(s, "c2", "One more");
  await pin(s, "c3", "And one more");
  // The user's own verb: it records, so the session now holds a hide the next rebuild can read back.
  await s.stub.commands.get("pins")?.handler("hide", s.ctx);
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  return s;
}

test("the focus key survives turn_end over a recorded hide: the bar still moves", async () => {
  const s = await focusedOverARecordedHide();
  // The focus key put the frame back over the user's recorded hide: `recorded()` still answers that hide,
  // and it is the reading `rebuildSession` weighs.
  expect([s.panel.shown(), s.panel.mode()]).toEqual([true, "open"]);
  expect(s.panel.recorded()).toBe(false);
  expect(s.visible()).toBe(true);
  s.c.focus();
  expect([s.c.isFocused(), s.held()]).toEqual([true, true]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  // The frame, the record and the keyboard all survived the boundary that used to settle them away.
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([true, false, "open"]);
  expect([s.c.isFocused(), s.held(), s.visible()]).toEqual([true, true, true]);

  // The keyboard is still a keyboard: the bar moved, which is what the user asked of the arrow.
  const before = s.c.selection;
  s.c.handleInput(DOWN);
  expect(s.c.selection).toBe(before + 1);
  // The rail stayed stood down throughout — the pins never went back to it while the panel held them.
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("the focus key below the panel's boundary takes nothing with it", async () => {
  // The rail is the only surface at this width: the focus key is refused outright (no room) and leaves
  // nothing behind — no open for a later rebuild to defend, no keyboard held over a frame that is never
  // drawn, and the rail still holding the pins.
  const s = await focusedOverARecordedHide(80);
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([false, false, "hidden"]);
  stranded(s);
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(true);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.panel.mode()).toBe("hidden");
  stranded(s);
});

test("the user's hide over a focused panel ends the open and gives the keyboard back", async () => {
  const s = await focusedOverARecordedHide();
  s.c.focus();
  expect([s.c.isFocused(), s.held()]).toEqual([true, true]);

  // The user's own verb ends the interaction exactly as `Escape` does, and records the hide.
  await s.stub.commands.get("pins")?.handler("hide", s.ctx);
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([false, false, "hidden"]);
  stranded(s);
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(true);

  // The turn that follows is the counterweight: the focus key's open must not stand in the way of the
  // entries once the user has hidden the panel themselves, or one press would keep a frame the user put
  // away on screen for the rest of the session.
  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.panel.mode()).toBe("hidden");
  stranded(s);
});

test("a focused panel the turn ending hides releases the keyboard and hands the pins to the rail", async () => {
  // The second symptom, on the path the report took: the panel is open because the focus key opened it, the
  // turn ending re-reads the user's `shown: false` from the entries and the rail comes back — but nothing
  // released the handle, so the editor answered no keys and neither did the panel.
  const s = await withHandle(await boot(HIDDEN_TWO, 120));
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  s.c.focus();
  expect([s.c.isFocused(), s.held(), s.panel.mode()]).toEqual([true, true, "open"]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect([s.panel.shown(), s.panel.mode()]).toEqual([false, "hidden"]);
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(true);
  stranded(s);
});

test("every pin dismissed under a focused panel leaves nothing holding the keyboard", async () => {
  const s = await focusedOverARecordedHide();
  const focused = s.c;
  focused.focus();
  expect([focused.isFocused(), s.held(), s.visible()]).toEqual([true, true, true]);

  // Dismiss every pin the way the panel's own key does: the view ends empty, so the owner no longer claims
  // the pins, and the boundary after that is where the keyboard used to be stranded over a frame with
  // nothing left to draw.
  for (let left = 5; left > 0; left--) focused.handleInput("d");
  expect(focused.pins.length).toBe(0);
  expect(s.visible()).toBe(false);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.visible()).toBe(false);
  stranded(s);
});

test("a model's auto-show over the user's recorded hide is settled once the ledger has been handed the branch", async () => {
  // The counterweight that keeps the focus key's claim from becoming a latch. The panel is on screen because
  // the *model* earned it, the hide is still what the user chose, and while the commit that auto-show came
  // from is unappended the branch is not the last word. Once a rebuild has been handed the branch the user's
  // verb wins — the same branch of the gate the focus key now shares, and the reason that gate reads the
  // provenance rather than "any open is up".
  const s = await withHandle(await boot(TWO));
  await s.stub.commands.get("pins")?.handler("hide", s.ctx);
  await pin(s, "c9", "The deploy is blocked");
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([true, false, "open"]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.panel.mode()).toBe("hidden");
  stranded(s);
});
