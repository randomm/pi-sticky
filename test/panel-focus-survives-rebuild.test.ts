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
import { toolOf } from "./panel-lifecycle-autoshow-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";
import { boot, emptyBranch, pinEntry, uiEntry } from "./panel-lifecycle-fixture.ts";

/** The keystroke whose death the report was about, as pi-tui hands it. */
const DOWN = "\x1b[B";

/** The pins one test boots: two `action` pins, each with options so `d` dismisses. */
const TWO: readonly unknown[] = [
  pinEntry([
    { id: 1, uid: "aaaa1111", text: "Decide the provider", options: ["yes", "no"] },
    { id: 2, uid: "bbbb2222", text: "Watch the migration", options: ["yes", "no"] },
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
 * A panel the user has focused, holding three `action` pins — the state the report was filed against.
 *
 * Two things make the user's recorded `shown: false` a live bug rather than a moot one, and both are needed:
 * the hide is an **entry** (`HIDDEN_TWO`), because the boot's rebuild writes the live cell into the record
 * and a hide from the cell alone leaves the rebuild nothing to re-apply; and the later pins arrive
 * **through the tool**, because an outstanding commit is the only thing that lets a boundary run while the
 * screen and the entries disagree — the case `rebuildSession` decides about.
 */
async function focusedOverARecordedHide(): Promise<Driven> {
  const s = await withHandle(await boot(HIDDEN_TWO));
  // The user's own verb, after the boot read the entry back: this is what puts the record and the entries
  // back in agreement on the hide, which is the precondition the rebuild under test decides against.
  await s.stub.commands.get("pins")?.handler("hide", s.ctx);
  await pin(s, "c2", "One more");
  await pin(s, "c3", "And one more");
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
  // The rail is the only surface at this width: the focus key is refused outright (no room) and must leave
  // nothing behind — no earned open for a later rebuild to defend, no keyboard held over a frame that is
  // never drawn, and the rail still holding the pins. The pins are the branch's own, so the ledger's claim
  // cannot be what the rebuild ends up honouring.
  const s = await withHandle(await boot(HIDDEN_TWO, 80));
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([false, true, "hidden"]);
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
  // released the handle, so the editor answered no keys and neither did the panel. No commit is outstanding
  // here, so this is the rebuild deciding outright rather than one held back by the ledger.
  const s = await withHandle(await boot(HIDDEN_TWO, 120));
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  s.c.focus();
  expect([s.c.isFocused(), s.held(), s.panel.mode()]).toEqual([true, true, "open"]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect([s.panel.shown(), s.panel.mode()]).toEqual([false, "hidden"]);
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(true);
  stranded(s);
});

test("a panel whose pins have all gone from the branch leaves nothing holding the keyboard", async () => {
  // The dismissal that strands the keyboard is not the panel's own `d` — that one ends the interaction
  // through `unfocus()` — but the one nobody pressed: `/unpin` from the editor, or the model's own cleanup,
  // empties the branch while the frame the user is looking at still holds the keys. The view is the branch's
  // and the branch is empty, so the panel has nothing left to draw; the keyboard is the extension's, and
  // before the fix it stayed where it was.
  const s = await withHandle(await boot(HIDDEN_TWO, 120));
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  const focused = s.c;
  focused.focus();
  // The panel drew the pins it was booted with: the branch is empty, but what the user is looking at is the
  // state the last commit published, and pi is compositing it.
  expect([focused.pins.length, focused.isFocused(), s.held(), s.visible()]).toEqual([
    2,
    true,
    true,
    true,
  ]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.visible()).toBe(false);
  stranded(s);
});
