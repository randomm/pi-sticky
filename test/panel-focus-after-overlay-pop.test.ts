/**
 * The lockout, reproduced on the booted extension: pi pops the panel's entry and the keyboard goes with it (D7).
 *
 * This is the reported bug. pi clears an extension's overlays at a reload (`resetExtensionUI`) and at the
 * session boundaries, and `OverlayHandle.focus()` is a **silent no-op** from an entry that has left the stack
 * or whose `visible()` answers false (`tui.js:430-436`). So a panel that is still on the extension's record,
 * still drawn, and still holding its focus flag, cannot be focused again — and, worse, a panel pi had focused
 * before the pop keeps pi's focus cell while nothing can release it: every byte, Ctrl+C included, is routed to
 * a component with no answer for it.
 *
 * The harness makes this reproducible at all: `panel-handle.ts` models the stack membership and the focus cell
 * as the two cells they are in pi, with the guards `focus()` obeys. A handle that simply remembered a boolean
 * could not express a refused ask, which is why the bug survived the suite that had focus tests in it.
 */
import { expect, test } from "bun:test";

import { withHandle } from "./panel-handle.ts";
import { blockedAction } from "./panel-lifecycle-autoshow-fixture.ts";

/** The user's focus key, pressed on the component that is on screen. */
async function opened() {
  const booted = await withHandle(await blockedAction("Decide the provider"));
  booted.c.focus();
  expect([booted.c.isFocused(), booted.held()]).toEqual([true, true]);
  return booted;
}

test("an entry pi popped takes the keyboard with it, and the flag follows", async () => {
  const booted = await opened();
  // `resetExtensionUI` — what a reload does to every extension overlay: the entry is off the stack and hidden,
  // and pi's focus moves somewhere else. Nothing the extension does can undo either half.
  booted.model.pop();
  booted.model.setFocus(booted.model.preFocus());

  // The ask is now silently refused — this is the assertion that the harness models pi rather than hopes.
  booted.c.focus();
  expect(booted.held(), "the handle granted a focus pi had refused").toBe(false);
  // ...and the reconciliation answers the refusal by taking the flag down too, rather than leaving a panel
  // that believes it holds a keyboard pi is not routing to.
  expect(booted.c.isFocused(), "the panel still believes it holds a keyboard nobody granted").toBe(
    false,
  );
});

test("a focused panel pi left on the stack keeps its keyboard across the ask", async () => {
  // The half that must not regress: the reconciliation runs after every `focus()`, and a panel pi really did
  // grant must not have its focus taken back by the check that was meant to protect it.
  const booted = await opened();
  booted.c.focus();
  booted.c.focus();
  expect([booted.c.isFocused(), booted.held()]).toEqual([true, true]);
});

test("pi holding a forgotten component is answered through the owner's keyboard, not the flag", async () => {
  // The other half of the disagreement: pi routes to a component the extension has stopped tracking after a
  // reload, so no keyboard verb of the extension's reaches it any more. The owner's `keyboard()` is the one
  // door its own listener still has, and it answers with the handle — pi's cell, not the component's flag.
  const booted = await opened();
  // `ownerKeyboard` is the shape the extension's listener is handed: the handle's answer, and the component's
  // own ending. Built the same way here, over the component on screen.
  const handle = booted.c.handle();
  if (!handle) throw new Error("the panel was opened without a handle");
  const keyboard = { isFocused: () => handle.isFocused(), release: () => booted.c.unfocus() };
  expect(keyboard.isFocused(), "the hatch was offered a panel pi is not routing to").toBe(true);
  keyboard.release();
  expect([booted.c.isFocused(), booted.held()]).toEqual([false, false]);
});

test("Ctrl+C reaches the editor on the next press, which is what the release is for", async () => {
  const booted = await opened();
  // The key the locked-out user presses, then presses again: the first ends the modal, the second is pi's.
  booted.c.handleInput("\x03");
  expect(booted.c.isFocused()).toBe(false);
  expect(booted.held(), "pi still routes to a panel that let go").toBe(false);
  // A resting panel answers nothing: with the focus gone the bytes are the editor's, and pi's own Ctrl+C
  // binding is what runs.
  booted.c.handleInput("\x03");
  expect(booted.c.isFocused()).toBe(false);
});

test("no case here leaves a panel focused with pi somewhere else — the invariant the whole file guards", async () => {
  const booted = await opened();
  const states: [string, boolean, boolean][] = [];
  for (const key of ["\x03", "\x1b", "d", "j", "1", "\r"]) {
    const before = { focused: booted.c.isFocused(), held: booted.held() };
    booted.c.handleInput(key);
    states.push([key, booted.c.isFocused(), booted.held()]);
    expect(
      [key, booted.c.isFocused() === booted.held()],
      `${JSON.stringify(key)} left the flag (${before.focused}) and pi (${before.held}) disagreeing`,
    ).toEqual([key, true]);
  }
  expect(states.length).toBe(6);
});
