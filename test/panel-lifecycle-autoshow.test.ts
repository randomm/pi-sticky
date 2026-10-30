/**
 * How an **auto-show's** earned open ends, on a booted extension.
 *
 * Sibling of `panel-lifecycle-autoshow-earned.test.ts`, which is the trigger side (U8 narrowed to U11: which
 * levels earn the frame at all, what the open records, and what an open survives) and the focus key's
 * contrasting ending. Both endings — Esc and the user's next submitted message — are this file's, because the
 * operator's decision is about the auto-show: an open the model earned goes back to the **resting frame**,
 * the peek, even over a panel the user had hidden. A `/pins hide` holds only until the next auto-show,
 * because closing a panel is not the same as agreeing to miss a blocker. The record still says hidden
 * throughout, which is the half the rebuild follows through in `session-rebuild.test.ts`.
 *
 * Every case here reaches the panel through a real verb or a real pin — `/pins show` and `/pins hide` for
 * the starting state, `pin_for_user` for the open — never by settling the cell to the state under test.
 *
 * Driven through `stubApi` (see `panel-lifecycle-fixture.ts`); the same paths on a live session are in
 * `integration-panel.test.ts`. The cell-level version of the same rule is `panel-mode.test.ts`, and the
 * rebuild's reading of the peek these endings leave behind is `session-rebuild.test.ts`.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { KEY } from "../src/types.ts";
import { blocked, bootWide, toolOf } from "./panel-lifecycle-autoshow-fixture.ts";
import { boot, panelComponent } from "./panel-lifecycle-fixture.ts";

test("the user's next submitted message ends the open a pin earned, in the peek", async () => {
  // Operator resolution 2's other half, and the end the panel is actually dismissed by: the next message the
  // user *sends* is the interaction that says the pin was read. The open is transient, so the panel gives up
  // the full frame — and under the operator's decision it gives it up to the **resting frame**, the peek, and
  // not to the hide the auto-show overrode. The rail stays stood down, because a drawn panel owns the pins
  // whichever frame it draws. What else does *not* end it is the sibling file's first case.
  const { stub, ctx, panel: cell } = await blocked();
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  stub.emit("input", { type: "input", text: "ok I saw it", source: "interactive" }, ctx);
  expect(cell.mode()).toBe("peek");
  // The rail does not take the pins back: the panel is still drawn, just at three rows. And the user's hide
  // is untouched as the *record*, so their own verb is still what moves the panel.
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
  expect(cell.recorded()).toBe(false);
});

test("an auto-show that starts from a peek ends in the peek, and the ledger stays empty", async () => {
  // The peek-starting half of the acceptance criteria, entered the way the user enters a peek — `/pins show`
  // — and not by a bare `cell.settle(true)`, which would skip the handoff (the rail standing down and the
  // `pi-sticky.ui` append) the verb actually performs. The assertion that matters is the ledger: an
  // auto-show and its peek ending are the model speaking twice, and neither is a preference, so the entries
  // must still hold only the user's own show.
  const { stub, ctx, panel: cell } = await bootWide();
  // `/pins hide` then `/pins show`: the panel rests as a peek and the record says shown, as after any user
  // who closed the panel and thought better of it.
  await stub.commands.get("pins")?.handler("hide", ctx);
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(cell.mode()).toBe("peek");
  const ledgerBefore = [...stub.entries];

  await toolOf(stub).execute(
    "c1",
    { action: "pin", text: "Decide the provider", level: "action" },
    undefined,
    undefined,
    ctx,
  );
  expect(cell.mode()).toBe("open");
  stub.emit("input", { type: "input", text: "fine", source: "interactive" }, ctx);

  expect(cell.mode()).toBe("peek");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
  expect(stub.entries).toEqual(ledgerBefore);
});

test("a reply to a pin ends the earned open like any other submitted message", async () => {
  // `Re #1: …` is the user answering the pin, which is the strongest form of having read it — and it travels
  // through the reply path (`src/reply.ts`), which appends its own entry and never reaches the panel's
  // writer. A reply that left the panel open would be a dismissal the user could not perform, and a reply
  // that put the panel back out of sight would hide the pin the user is still talking about.
  const { stub, ctx, panel: cell } = await blocked("Decide the provider");
  expect(cell.mode()).toBe("open");

  stub.emit("input", { type: "input", text: "Re #1: the blue one", source: "interactive" }, ctx);
  expect(cell.mode()).toBe("peek");
  // The reply itself still landed: one user entry, addressed to the pin, from the reply path rather than
  // from anything the panel did — and the rail is still stood down for the panel that remains drawn.
  expect(stub.entries.filter((entry) => entry.customType === "pi-sticky.user")).toHaveLength(1);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
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

test("a warning pin auto-shows too, and leaving the panel ends the open in the peek", async () => {
  // This time `warning` rather than `action`, and the ending is Esc: the user focuses the panel to read the
  // blocker and leaves. Under the old rule the panel went back to what they had chosen — hidden — which is
  // the behaviour the operator overrode: a blocker the user has read leaves the **peek** behind, not the hide
  // the auto-show overrode. The rail stays stood down, because the panel is still the surface that draws the
  // pins, and the hide the user wrote is still the record.
  const { stub, ctx, panel: cell } = await blocked("Careful");
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  const component = panelComponent(ctx.recorder.customCalls[0]);
  component?.focus();
  component?.unfocus();
  expect(cell.mode()).toBe("peek");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
  expect(cell.recorded()).toBe(false);
  // …and because the record never moved, the user's own hide is still an available verb afterwards.
  await stub.commands.get("pins")?.handler("hide", ctx);
  expect(cell.mode()).toBe("hidden");
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

  // The peek never happens: a hide and a show come back to the full frame, because the resting frame is
  // already the full one and no ending has a peek to put the panel into.
  await stub.commands.get("pins")?.handler("hide", ctx);
  expect(cell.mode()).toBe("hidden");
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(cell.mode()).toBe("open");

  // …and an auto-show's ending under `open` is the full frame too: the rule is "end in the resting mode",
  // and the operator's value says what that mode is. `panel-mode.test.ts` pins the same thing at the cell;
  // this is the case where the extension, not a hand-built cell, made the open — and it is made twice over,
  // once by a `warning` pin and once by the focus key, because under this configuration the two provenances
  // have nowhere lower to go and must agree on the full frame.
  await tool.execute(
    "c2",
    { action: "pin", text: "Deploy is blocked", level: "warning" },
    undefined,
    undefined,
    ctx,
  );
  expect(cell.mode()).toBe("open");
  const component = panelComponent(ctx.recorder.customCalls.at(-1));
  component?.focus();
  component?.unfocus();
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  stub.fireShortcut("ctrl+alt+p", ctx);
  expect(cell.mode()).toBe("open");
  panelComponent(ctx.recorder.customCalls.at(-1))?.unfocus();
  expect(cell.mode()).toBe("open");
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});
