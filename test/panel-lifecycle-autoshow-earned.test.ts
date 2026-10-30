/**
 * How an earned open is produced, what it survives, and how the **focus key's** ending differs.
 *
 * Sibling of `panel-lifecycle-autoshow.test.ts`, which is the auto-show's side of U11 — the trigger levels
 * and the two endings that put an earned open back in the resting frame. This file holds what a test of the
 * *ending* must not be confused with:
 *
 * - **Which levels earn the frame at all** (U11's narrowing of U8): `action` and `warning` do, `info` does
 *   not, and a promotion by `update` counts (issue #40). The distinction is invisible from the ending side —
 *   both levels open and both rest as a peek — so it is pinned where a `hidden` assertion is the subject.
 * - **Persistence** (operator resolution 2 of pins v2-4): the open is not the frame of one draw. It
 *   outlives a redraw, a rebuild, a further pin and a steer, none of which is the user interacting with the
 *   pin. The two endings that *do* end it are in the sibling file, and this one asserts they are the only
 *   ones by pinning the four non-endings.
 * - **The focus key**, which is the other provenance (`EarnedKind` in `panel-mode.ts`): the user reached for
 *   the pins, so leaving the open ends back on **what they chose** — hidden stays hidden — where the
 *   auto-show's ends in the resting frame. The two cases differ in nothing but who asked for the open.
 *
 * Driven through `stubApi` (see `panel-lifecycle-fixture.ts`); the same paths on a live session are in
 * `integration-panel.test.ts`. The cell-level version is `panel-mode.test.ts`.
 */
import { expect, test } from "bun:test";

import { KEY } from "../src/types.ts";
import { blocked, blockedAction, bootWide, toolOf } from "./panel-lifecycle-autoshow-fixture.ts";
import { boot, panelComponent } from "./panel-lifecycle-fixture.ts";

test("an action pin auto-shows a hidden panel and records no entry", async () => {
  // Wide, so the auto-show is unobstructed: at a narrow terminal the rail is the only surface and the
  // assertion below would be about the width rather than about the auto-show.
  const { stub, ctx } = await bootWide();
  // Close it as the user would, so the auto-show has something to undo.
  await stub.commands.get("pins")?.handler("hide", ctx);
  stub.entries.length = 0;

  await toolOf(stub).execute(
    "c1",
    { action: "pin", text: "Decide X", level: "action" },
    undefined,
    undefined,
    ctx,
  );

  // Nothing recorded, and the rail stands down: the panel is shown again, so it owns the pins.
  expect(stub.entries).toEqual([]);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("an info pin leaves a hidden panel hidden and the rail drawing it (U11)", async () => {
  // The narrowing that supersedes U8's "any new pin": `info` is not something the user must act on, so a
  // chatty model cannot decide when the transcript gets covered. The rail — unchanged, as before — is what
  // draws it, which is the whole reason leaving the panel hidden is safe.
  const { stub, ctx } = await bootWide();
  await stub.commands.get("pins")?.handler("hide", ctx);
  stub.entries.length = 0;

  await toolOf(stub).execute("c1", { action: "pin", text: "FYI" }, undefined, undefined, ctx);

  expect(stub.entries).toEqual([]);
  // The rail is back on screen: nothing auto-showed, so nothing stood it down.
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
});

test("the open a pin earned persists across a redraw, a further pin and an agent turn (U11)", async () => {
  // Operator resolution 2 of pins v2-4, in one test: the earned open is not the frame of one draw. It
  // survives the redraw a command's listing causes, the rebuild a turn ending runs, a second pin landing on
  // top of it, and a submitted message which is *not* the user answering the pin — every one of which
  // reaches the cell through some writer other than the user's next interaction with the pin itself. Each of
  // those moves used to fold the panel back into the peek on the spot, which is the failure this case is the
  // regression for. What *does* end it — the user's next submitted message, and leaving a focused panel — is
  // `panel-lifecycle-autoshow.test.ts`, which is also where the peek ending lives.
  const { stub, ctx, panel: cell, tool } = await blocked();

  // A redraw driven by a command listing: the cell is settled from the session, which cannot see the screen.
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(cell.mode()).toBe("open");
  // The turn ends, so the branch is re-read and every entry of it reconciled.
  stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, ctx);
  expect(cell.mode()).toBe("open");
  // A further pin — which the spec also names — arrives while the first is still on screen.
  await tool.execute(
    "c2",
    { action: "pin", text: "And the migration", level: "info" },
    undefined,
    undefined,
    ctx,
  );
  expect(cell.mode()).toBe("open");
  // A message the user submits while the agent is still working (`source: "steer"`): the panel was shown to
  // carry information to them and they have not read it yet, so steering the agent is not an interaction
  // with the pin. The open stands.
  stub.emit("input", { type: "input", text: "what else", source: "steer" }, ctx);
  expect(cell.mode()).toBe("open");
  // The rail stayed stood down throughout, which is the user-visible half: the pins never went back to it
  // while the panel was open.
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("an update that promotes an existing pin to warning opens a hidden panel (issue #40)", async () => {
  // The criterion's "or updated" half, end to end: `updateOp` changes a pin without adding one, so the
  // commit says nothing about itself that a count could read — the ids it touched are what carry the fact
  // that a blocker arrived. Before that, a model promoting an existing pin left the user's blocker on the
  // rail with the panel hidden.
  const booted = await boot([], 120);
  const { stub, ctx, panel: cell } = booted;
  const tool = toolOf(stub);
  await tool.execute("c1", { action: "pin", text: "Migration pending" }, undefined, undefined, ctx);
  // A resting panel, not an open one: this test is about the promotion, and an open already on screen would
  // have nothing left to earn.
  cell.settle(false);
  stub.entries.length = 0;

  await tool.execute(
    "c2",
    { action: "update", id: 1, level: "warning", text: "Migration is BLOCKED" },
    undefined,
    undefined,
    ctx,
  );

  expect(cell.mode()).toBe("open");
  // It records nothing — an earned open is not the user's preference — and the rail stood down for it.
  expect(stub.entries).toEqual([]);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("a focus key from a hidden panel, and Esc there, restores the hide", async () => {
  // The other provenance at the surface, and the case that keeps the operator's override from becoming a
  // leak: a panel the user reached for with `ctrl+alt+p` is theirs, so leaving it puts back what they had
  // *chosen* — hidden stays hidden, and the rail takes the pins back. The auto-show's Esc case in the sibling
  // file is identical but for who asked for the open, which is exactly what `EarnedKind` carries.
  const { stub, ctx, panel: cell } = await blockedAction("Decide the provider");
  stub.entries.length = 0;

  stub.fireShortcut("ctrl+alt+p", ctx);
  expect(cell.mode()).toBe("open");
  // The key records nothing: reaching for a pin to read it is not a preference about the panel.
  expect(stub.entries).toEqual([]);

  // Esc: the handle is released and the owner's `onUnfocus` ends the open the *key* earned, restoring the
  // hide the user wrote — which is why the rail comes back.
  panelComponent(ctx.recorder.customCalls.at(-1))?.unfocus();
  expect(cell.mode()).toBe("hidden");
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
  expect(stub.entries).toEqual([]);
});

test("an open the focus key earned also ends on the user's next message, in their choice", async () => {
  // The other ending of the same provenance: both endings read the provenance and neither reads the event. An
  // auto-show ends in the resting frame however it is ended, and a focus-key open ends on what the user chose
  // however it is ended — so the same submitted message that leaves the sibling file's auto-show in the peek
  // puts this panel clean out of sight and hands the pins back to the rail.
  const { stub, ctx, panel: cell } = await blockedAction("Decide the provider");
  stub.fireShortcut("ctrl+alt+p", ctx);
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  stub.emit("input", { type: "input", text: "moved on", source: "interactive" }, ctx);
  expect(cell.mode()).toBe("hidden");
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
});
