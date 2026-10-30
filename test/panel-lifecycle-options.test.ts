/**
 * The option keys at the surface that owns the editor: what a digit leaves in the draft, and what it does
 * not touch.
 *
 * `panel-component-options.test.ts` drives the keys over a hand-built host that records the call; this file
 * drives them through the extension's own wiring, where the merged draft is written by `replyMarker`
 * (`src/reply.ts`) — the one merge rule the digit key is required to reuse rather than copy — and read back
 * from the recorder the way the reply handler will read it on submit. So the assertion here is that marker
 * and option text are *one string* the reply flow still recognises, and that nothing was sent: the user
 * presses Enter.
 *
 * The sibling `panel-lifecycle-toggles.test.ts` owns the toggles and the Enter/d pair at this same surface.
 */
import { expect, test } from "bun:test";

import { OPTIONED, boot, panelComponent } from "./panel-lifecycle-fixture.ts";

/** A booted session whose panel is open over one pin with two options — the only state with rows to answer. */
async function openPanel() {
  const booted = await boot(OPTIONED, 120);
  // The focus key's open, not the auto-show's: an auto-show ends in the peek, and this file drives the keys
  // of the frame the user reached for by hand.
  booted.panel.autoOpen("focus");
  return booted;
}

/** The open panel's component, with the interaction handed back to the editor and then taken again. */
async function focused() {
  const { ctx } = await openPanel();
  const call = ctx.recorder.customCalls[0];
  call?.handle?.unfocus();
  panelComponent(call)?.focus();
  return { ctx, call };
}

test("a digit puts the chosen option behind the marker and hands focus back to the editor", async () => {
  const { ctx, call } = await focused();
  ctx.recorder.setEditorText("how about the blue one");
  call?.component?.handleInput?.("2");

  expect(ctx.recorder.getEditorText()).toBe("Re #1: Not yet how about the blue one");
  expect(panelComponent(call)?.isFocused()).toBe(false);
  // Nothing was sent and nothing was notified: the draft is the whole of what the key did.
  expect(ctx.recorder.notifications).toEqual([]);
});

test("a digit replaces a marker the draft already carries, the same rule Enter obeys", async () => {
  // The draft the user was already replying to is not stacked under a second marker: one merge rule, so the
  // digit answers the pin it was pressed on and keeps the rest verbatim.
  const { ctx, call } = await focused();
  ctx.recorder.setEditorText("Re #9: keep this draft");
  call?.component?.handleInput?.("1");

  expect(ctx.recorder.getEditorText()).toBe("Re #1: Passed on keep this draft");
});

test("a digit the pin has no option for leaves the draft and the focus alone", async () => {
  const { ctx, call } = await focused();
  ctx.recorder.setEditorText("how about the blue one");
  // `3` is past this pin's two options and `0` is unassigned; neither may write to the draft.
  call?.component?.handleInput?.("3");
  call?.component?.handleInput?.("0");

  expect(ctx.recorder.getEditorText()).toBe("how about the blue one");
  expect(panelComponent(call)?.isFocused()).toBe(true);
});
