/**
 * The panel's side of a pin arriving: which levels earn an open panel, what the open records, and how the
 * earned one ends.
 *
 * The counterpart to `panel-lifecycle-toggles.test.ts`, which is the *user's* side (what each verb changes
 * and records). The three tests below are the whole of U11 as the extension behaves it: U8 said any new pin
 * un-hid a hidden panel, and U11 narrowed that to the two levels whose purpose is a decision or a blocker —
 * `action` and `warning` — because a chatty model was deciding when the user's transcript got covered, and
 * the rail draws an `info` pin whether or not the panel is open. What survives of U8 is the half that
 * mattered: a pin the user must act on must not arrive silently, and the open that answers it records
 * nothing, so the user's own hide is still the record when the open ends.
 *
 * Driven through `stubApi` (see `panel-lifecycle-fixture.ts`); the same paths on a live session are in
 * `integration-panel.test.ts`. The persistence half of U11 — an open outliving every redraw, pin and agent turn — is
 * `panel-lifecycle-autoshow`'s own first case below, since no user interaction is what ends it.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { KEY } from "../src/types.ts";
import { boot, panelComponent } from "./panel-lifecycle-fixture.ts";

/** The tool's `execute`, reached the way pi reaches it: one call, one context. */
type Execute = (
  id: string,
  args: unknown,
  s: undefined,
  u: undefined,
  c: unknown,
) => Promise<unknown>;

const toolOf = (stub: { tools: unknown[] }): { execute: Execute } =>
  stub.tools[0] as { execute: Execute };

test("an action pin auto-shows a hidden panel and records no entry", async () => {
  // Wide, so the auto-show is unobstructed: at a narrow terminal the rail is the only surface and the
  // assertion below would be about the width rather than about the auto-show.
  const { stub, ctx } = await boot([], 120);
  // Close it as the user would, so the auto-show has something to undo.
  await stub.commands.get("pins")?.handler("hide", ctx);
  stub.entries.length = 0;

  const tool = toolOf(stub);
  await tool.execute(
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
  const { stub, ctx } = await boot([], 120);
  await stub.commands.get("pins")?.handler("hide", ctx);
  stub.entries.length = 0;

  const tool = toolOf(stub);
  await tool.execute("c1", { action: "pin", text: "FYI" }, undefined, undefined, ctx);

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
  // regression for. What *does* end it is the user's own next submitted message — the case below.
  const booted = await boot([], 120);
  const { stub, ctx, panel: cell } = booted;
  await stub.commands.get("pins")?.handler("hide", ctx);
  const tool = toolOf(stub);
  await tool.execute(
    "c1",
    { action: "pin", text: "Deploy is blocked", level: "warning" },
    undefined,
    undefined,
    ctx,
  );
  expect(cell.mode()).toBe("open");

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

test("the user's next submitted message ends the open a pin earned", async () => {
  // Operator resolution 2's other half, and the end the panel is actually dismissed by: the next message the
  // user *sends* is the interaction that says the pin was read. The open is transient, so the panel goes
  // back to what the user chose — hidden here — and the rail takes the pins back with it. Nothing else in
  // the session ends it: the tests above pin the redraw, the turn, the further pin and the steer.
  const booted = await boot([], 120);
  const { stub, ctx, panel: cell } = booted;
  await stub.commands.get("pins")?.handler("hide", ctx);
  const tool = toolOf(stub);
  await tool.execute(
    "c1",
    { action: "pin", text: "Deploy is blocked", level: "warning" },
    undefined,
    undefined,
    ctx,
  );
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  stub.emit("input", { type: "input", text: "ok I saw it", source: "interactive" }, ctx);
  expect(cell.mode()).toBe("hidden");
  // The pins are the rail's again, which is the half the user sees: the panel came down and nothing was lost.
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
});

test("a reply to a pin ends the earned open like any other submitted message", async () => {
  // `Re #1: …` is the user answering the pin, which is the strongest form of having read it — and it travels
  // through the reply path (`src/reply.ts`), which appends its own entry and never reaches the panel's
  // writer. A reply that left the panel open would be a dismissal the user could not perform.
  const booted = await boot([], 120);
  const { stub, ctx, panel: cell } = booted;
  await stub.commands.get("pins")?.handler("hide", ctx);
  const tool = toolOf(stub);
  await tool.execute(
    "c1",
    { action: "pin", text: "Decide the provider", level: "action" },
    undefined,
    undefined,
    ctx,
  );
  expect(cell.mode()).toBe("open");

  stub.emit("input", { type: "input", text: "Re #1: the blue one", source: "interactive" }, ctx);
  expect(cell.mode()).toBe("hidden");
  // The reply itself still landed: one user entry, addressed to the pin, from the reply path rather than
  // from anything the panel did.
  expect(stub.entries.filter((entry) => entry.customType === "pi-sticky.user")).toHaveLength(1);
});

test("a message submitted with no open standing settles nothing", async () => {
  // The end has to be an *end*: a submitted message over a panel that was already resting as a peek (or
  // hidden by the user's own verb) must not move the cell at all, or a plain turn of the conversation would
  // be able to re-show or re-hide a panel the user is looking at.
  const booted = await boot([], 120);
  const { stub, ctx, panel: cell } = booted;
  await stub.commands.get("pins")?.handler("hide", ctx);
  expect(cell.mode()).toBe("hidden");
  expect(cell.mode()).toBe("hidden");
  stub.emit("input", { type: "input", text: "hello", source: "interactive" }, ctx);
  expect(cell.mode()).toBe("hidden");
  expect(cell.recorded()).toBe(false);
});

test("a warning pin auto-shows too, and the open ends when the user leaves the panel", async () => {
  const booted = await boot([], 120);
  const { stub, ctx, panel: cell } = booted;
  await stub.commands.get("pins")?.handler("hide", ctx);
  const tool = toolOf(stub);
  await tool.execute(
    "c1",
    { action: "pin", text: "Careful", level: "warning" },
    undefined,
    undefined,
    ctx,
  );
  // The earned open, read from the cell the extension runs on — the same object the overlay's `visible()`
  // and the rail's handoff read, so the assertion is about the state the screen is drawn from.
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  // The earned open is transient: the user focuses the panel to read it and leaves, and the panel goes back
  // to what they chose — hidden here, because that is what they had chosen and the auto-show never recorded
  // over it. The rail takes the pins back with it.
  const component = panelComponent(ctx.recorder.customCalls[0]);
  component?.focus();
  component?.unfocus();
  expect(cell.mode()).toBe("hidden");
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
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

test("under PI_STICKY_PANEL=open a shown panel never rests as a peek (resolution 6)", async () => {
  // The never-peek case, which no lifecycle test reached before: `panel-mode.test.ts` asserts the fold, but
  // nothing booted the extension with `panel: "open"`, so an extension that ignored the configuration and
  // always rested as a peek passed the whole suite. Driven through the config seam the fixture names, not
  // through `process.env`.
  const booted = await boot([], 120, {}, { ...DEFAULT_CONFIG, panel: "open" });
  const { stub, ctx, panel: cell } = booted;
  const tool = toolOf(stub);
  await tool.execute("c1", { action: "pin", text: "FYI" }, undefined, undefined, ctx);
  expect(cell.mode()).toBe("open");

  // The peek never happens: a hide and a show come back to the full frame, because a demote has no peek to
  // put the panel into.
  await stub.commands.get("pins")?.handler("hide", ctx);
  expect(cell.mode()).toBe("hidden");
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(cell.mode()).toBe("open");

  // …and an earned open under `open` ends the same way it does under `peek`: the operator's value says how
  // a shown panel rests, not that the user can never leave one.
  const component = panelComponent(ctx.recorder.customCalls.at(-1));
  component?.focus();
  component?.unfocus();
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});
