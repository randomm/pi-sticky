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
 * `integration-panel.test.ts`.
 */
import { expect, test } from "bun:test";

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

test("a warning pin auto-shows too, and the open ends at the user's next message", async () => {
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
