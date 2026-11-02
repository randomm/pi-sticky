/**
 * Keyboard focus never outlives the panel's visibility, on a booted extension (issue #84).
 *
 * The report was a panel whose arrows stopped moving. Two separate gaps wore that one symptom, and both are
 * invisible to an assertion that reads the component's own flag:
 *
 * 1. **The rebuild settled the frame out from under a focused panel.** `focusFromShortcut` opens transiently
 *    through `autoOpen("focus")` and records nothing, so at `turn_end` `rebuildSession` re-applied the user's
 *    recorded `shown: false` and hid the panel the user had just focused — and pi-tui's handle `focus()`
 *    (`tui.js:430-435`) is a silent no-op on an overlay its own `visible()` refuses, so the frame came back
 *    and the keys never did. What keeps the frame standing is the rebuild's two-part gate: the entries may not
 *    be read at all while a surface is drawn or the record says shown, and not while `autoShowPending()`
 *    reports a screen they do not account for. That cell answers one boolean and carries no provenance, so no
 *    booted case can say *which* transient the boundary honoured — what the cell cannot see,
 *    `test/session-rebuild.test.ts` pins at the cell.
 * 2. **Nothing ever released the keyboard.** When the turn ending hid the panel over a focused component —
 *    the user's recorded hide re-applied, or the last pin dismissed out from under the frame — the component
 *    stayed focused and the handle stayed held, so the editor answered no keys and neither did the panel.
 *
 * So every stop asserts the *pair* — the component's flag and the handle — rather than the mode alone, and the
 * handle here is the honest one: it grants focus only while the overlay's installed `visible()` answers true,
 * the way pi-tui's does. A handle that merely recorded the asking reported a keyboard pi had thrown away.
 *
 * Driven through the booted extension (`panel-lifecycle-fixture.ts`), so the overlay, the handle and the rail
 * are all the extension's own. The endings are `panel-lifecycle-autoshow-*.test.ts`; the rebuild's ledger
 * questions are `session-rebuild.test.ts`.
 */
import { expect, test } from "bun:test";

import type { PanelComponent } from "../src/panel-component.ts";
import { FOCUS_KEY } from "../src/panel-keys.ts";
import { KEY } from "../src/types.ts";
import { onScreen, overlayVisible, panelHandle, withHandle } from "./panel-handle.ts";
import { toolOf } from "./panel-lifecycle-autoshow-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";
import { boot, emptyBranch, frameWidth, pinEntry, uiEntry } from "./panel-lifecycle-fixture.ts";

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

  // and it is the reading `rebuildSession` weighs.
  const before = s.c.selection;
  s.c.handleInput(DOWN);
  expect(s.c.selection).toBe(before + 1);
  // The rail stayed stood down throughout — the pins never went back to it while the panel held them.
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("the focus key below the panel's boundary takes nothing with it", async () => {
  // The rail is the only surface at this width: the focus key is refused outright (no room) and must leave
  // nothing behind — no earned open for a later rebuild to defend, no keyboard held over a frame that is
  // never drawn, and the rail still holding the pins.
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

  // The counterweight: the focus key's open must not keep a frame the user put away on screen.
  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.panel.mode()).toBe("hidden");
  stranded(s);
});

test("a focused panel whose terminal narrows below the boundary releases the keyboard", async () => {
  // The width term of the release's guard, and the reason it is the owner's `isVisible()` rather than the mode
  // cell or the pin count: `isVisible()` asks the count *only while the cell says shown*, so the hidden panel
  // this case ends on answers false while the rail draws its pins. The *terminal* is what moves here, stated
  // by pi-tui through the installed `visible()` (`frameWidth`). The handle reads the width pi-tui states now.
  const stated = { columns: 120 };
  const s = await boot(HIDDEN_TWO, 120);
  await toolOf(s.stub).execute(
    "c1",
    { action: "pin", text: "One more", level: "action" },
    undefined,
    undefined,
    s.ctx,
  );
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  const c = onScreen(s);
  const hh = panelHandle(() => overlayVisible(s, stated.columns));
  c.setHandle(hh.handle);
  c.focus();
  expect([
    s.panel.shown(),
    s.panel.mode(),
    c.isFocused(),
    hh.held(),
    overlayVisible(s, 120),
  ]).toEqual([true, "open", true, true, true]);

  stated.columns = 80;
  frameWidth(s.ctx.recorder, 80);
  expect([c.isFocused(), hh.held(), overlayVisible(s, stated.columns)]).toEqual([
    true,
    true,
    false,
  ]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect([c.isFocused(), hh.held()]).toEqual([false, false]);
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(true);
});

test("a panel the owner is drawing keeps its keyboard across every rebuild", async () => {
  // The other half of the guard: a release that dropped that term would take the keys from a panel the user is
  // looking at. The entries settle nothing on this path, so the boundary is free to take the keyboard and
  // must not.
  const s = await withHandle(await boot(TWO, 120));
  await toolOf(s.stub).execute(
    "c9",
    { action: "pin", text: "One more", level: "action" },
    undefined,
    undefined,
    s.ctx,
  );
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([true, true, "open"]);
  expect([s.c.isFocused(), s.held(), s.visible()]).toEqual([true, true, true]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  // Still focused, still holding the handle — and the bar still moves, which is what a user who never left
  // the panel would notice first if the release had reached past the screen.
  expect([s.c.isFocused(), s.held(), s.visible()]).toEqual([true, true, true]);
  const before = s.c.selection;
  s.c.handleInput(DOWN);
  expect(s.c.selection).toBe(before + 1);
});

test("the focus key's open over the user's own hide survives the boundary that re-reads it", async () => {
  // The counterweight to the case below, and the one the focus key's claim has to carry on its own. The user
  // hid the panel with their verb; the model then pinned an `info` note, which does not demand attention
  // (`demandsAttention`, `panel-mode.ts`), so the ledger's auto-show claim is never raised and the panel stays
  // out of sight with the pins on the rail. The focus key is what puts the frame back over that hide, and the
  // boundary now has a settled answer in the entries — *hidden* — with nothing outstanding to hold it back.
  // Only the open the key earned stands between that answer and the screen, and the rebuild may not settle it
  // away: the keyboard and the bar are the observable form of the same verdict, because a frame the boundary
  // put out of sight takes the keys with it and the arrow stops moving.
  const s = await withHandle(await boot(HIDDEN_TWO, 120));
  await s.stub.commands.get("pins")?.handler("hide", s.ctx);
  await toolOf(s.stub).execute(
    "c9",
    { action: "pin", text: "A note, not a blocker", level: "info" },
    undefined,
    undefined,
    s.ctx,
  );
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  s.c.focus();
  expect([s.panel.shown(), s.panel.recorded(), s.panel.mode()]).toEqual([true, false, "open"]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect([s.panel.shown(), s.panel.mode(), s.c.isFocused(), s.held(), s.visible()]).toEqual([
    true,
    "open",
    true,
    true,
    true,
  ]);
  const before = s.c.selection;
  s.c.handleInput(DOWN);
  expect(s.c.selection).toBe(before + 1);
  expect(s.ctx.recorder.widgets.has(KEY)).toBe(false);
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

test("a release the host throws on still leaves the panel without the keyboard", async () => {
  // The throw would escape `rebuildSession` and skip the boundary's redraw; the flag is moved first and the
  // ending contained, the way `hidePanel` contains the same one. A component pi still holds focused is the
  // state the `catch` leaves behind, so `held()` stays true and the flag is what is asserted.
  const throwing = () => {
    throw new Error("host threw");
  };
  const s = await withHandle(await boot(HIDDEN_TWO, 120), throwing);
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  s.c.focus();
  expect([s.c.isFocused(), s.held()]).toEqual([true, true]);

  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.visible()).toBe(false);
  expect([s.c.isFocused(), s.held()]).toEqual([false, true]);
});

test("a panel whose pins have all gone from the branch leaves nothing holding the keyboard", async () => {
  // The branch really is emptied here (`emptyBranch`) rather than assumed: the pins the user is looking at are
  // the state the last commit published, so after the turn ending the *pin count* — not the mode cell, which
  // records nothing for a focus-key open — is what answers false for the frame.
  const s = await withHandle(await boot(HIDDEN_TWO, 120));
  s.stub.fireShortcut(FOCUS_KEY, s.ctx);
  const focused = s.c;
  focused.focus();
  expect([focused.pins.length, focused.isFocused(), s.held(), s.visible()]).toEqual([
    2,
    true,
    true,
    true,
  ]);

  emptyBranch(s.ctx);
  s.stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, s.ctx);
  expect(s.visible()).toBe(false);
  stranded(s);
});
